"""Demo Reset routes — backup, wipe, and restore tenant data tables.

Provides admin-grade endpoints to:

* Snapshot all demo-data tables for a tenant into ``demo_backups`` (JSONB).
* List, view, and delete previously created backups.
* Wipe ("erase") all demo data for the active tenant — preserving users,
  roles, system_settings, tenants, and demo_backups themselves — with an
  optional pre-wipe backup pass.
* Restore a tenant from a named backup.

The set of tables touched is the curated ``DEMO_TABLES`` list below. Order
matters for restore (parents first); for wipe we rely on
``TRUNCATE ... RESTART IDENTITY CASCADE`` inside a single transaction so
FK chains drop cleanly without manual ordering.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from api.db import db, set_tenant

logger = logging.getLogger("infophysics.api.demo_reset")

router = APIRouter()


# ---------------------------------------------------------------------------
# Configuration: which tables are part of demo data
# ---------------------------------------------------------------------------
# Order is dependency-safe for restore: parents before children. For wipe
# we use TRUNCATE ... CASCADE so order does not matter, but we list the
# parents explicitly in TRUNCATE to ensure CASCADE picks up dependents.
#
# Preserved (NEVER touched by reset/restore):
#   users, roles, system_settings, tenants, demo_backups
DEMO_TABLES: List[str] = [
    # Core data
    "information_objects",
    "aio_data",
    "hsl_data",
    "information_elements",
    "information_element_refs",
    "saved_prompts",
    # Derived / auxiliary
    "field_map_keys",
    "field_map_members",
    "io_links",
    "citations",
    "entities",
    "entity_aliases",
    "entity_mentions",
    "chunk_versions",
    "embedding_versions",
    "extracted_text_versions",
    "structured_view_versions",
    "summary_versions",
    "derivation_events",
    "derivation_event_inputs",
    "derivation_event_outputs",
    "policy_scopes",
    "aio_embeddings",
    "chat_search_stats",
    "query_cache",
    "mro_objects",
    "tenant_token_usage",
]

PROTECTED_TABLES = {"users", "roles", "system_settings", "tenants", "demo_backups"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _table_exists(cur, name: str) -> bool:
    cur.execute(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
        "WHERE table_schema='public' AND table_name=%s)",
        (name,),
    )
    return bool(cur.fetchone()[0])


def _column_has(cur, table: str, column: str) -> bool:
    cur.execute(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name=%s AND column_name=%s)",
        (table, column),
    )
    return bool(cur.fetchone()[0])


def _writable_columns(cur, table: str) -> List[str]:
    """Return columns excluding GENERATED ALWAYS columns (cannot be inserted)."""
    cur.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema='public' AND table_name=%s
              AND is_generated = 'NEVER'
        ORDER BY ordinal_position
        """,
        (table,),
    )
    return [r[0] for r in cur.fetchall()]


def _snapshot_table(cur, table: str, tenant: str) -> List[Dict[str, Any]]:
    """Return all rows of ``table`` for tenant as JSONB-serializable dicts.

    Uses ``to_jsonb(t.*)`` so we get column→value maps that survive
    round-trip back through ``jsonb_populate_recordset`` on restore.
    """
    if not _table_exists(cur, table):
        return []
    if _column_has(cur, table, "tenant_id"):
        cur.execute(
            f"SELECT to_jsonb(t.*) FROM {table} t WHERE t.tenant_id = %s",
            (tenant,),
        )
    else:
        # Tables without tenant_id are linked to a tenant-scoped parent
        # via FK. We snapshot all rows and rely on FK chain on restore.
        cur.execute(f"SELECT to_jsonb(t.*) FROM {table} t")
    return [r[0] for r in cur.fetchall()]


def _wipe_tenant(cur, tenant: str) -> Dict[str, int]:
    """DELETE rows for tenant from each demo table; returns row counts deleted.

    Cannot use TRUNCATE because we want to preserve other tenants' data.
    We DELETE in reverse order (children first) to avoid FK violations.
    """
    counts: Dict[str, int] = {}
    # Reverse for child-first deletion
    for table in reversed(DEMO_TABLES):
        if table in PROTECTED_TABLES:
            continue
        if not _table_exists(cur, table):
            continue
        if _column_has(cur, table, "tenant_id"):
            cur.execute(f"DELETE FROM {table} WHERE tenant_id = %s", (tenant,))
            counts[table] = cur.rowcount
        else:
            # Best-effort: only wipe if the table is empty of FKs in current
            # tenant. We skip non-tenant-scoped tables on per-tenant wipe.
            counts[table] = 0
    return counts


def _restore_tenant(cur, tenant: str, snapshot: Dict[str, List[Dict[str, Any]]]) -> Dict[str, int]:
    """Wipe tenant then re-insert rows from snapshot. Returns rows-restored counts."""
    _wipe_tenant(cur, tenant)
    counts: Dict[str, int] = {}
    for table in DEMO_TABLES:
        rows = snapshot.get(table) or []
        if not rows:
            counts[table] = 0
            continue
        if not _table_exists(cur, table):
            counts[table] = 0
            continue
        cols = _writable_columns(cur, table)
        if not cols:
            counts[table] = 0
            continue
        col_list = ", ".join(f'"{c}"' for c in cols)
        # Build a CTE-style insert from JSONB array using jsonb_to_recordset,
        # but we need column types — easiest path: insert per row using
        # column subset present in the JSON object.
        inserted = 0
        for row in rows:
            present = [c for c in cols if c in row]
            if not present:
                continue
            placeholders = ", ".join(["%s"] * len(present))
            values = []
            for c in present:
                v = row.get(c)
                # JSON/JSONB values come back as Python dict/list — cast back
                if isinstance(v, (dict, list)):
                    values.append(json.dumps(v))
                else:
                    values.append(v)
            col_sql = ", ".join(f'"{c}"' for c in present)
            try:
                cur.execute(
                    f"INSERT INTO {table} ({col_sql}) VALUES ({placeholders}) ON CONFLICT DO NOTHING",
                    values,
                )
                inserted += cur.rowcount
            except Exception as exc:
                logger.warning("restore: %s row failed: %s", table, exc)
        counts[table] = inserted
    return counts


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class CreateBackupRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    note: Optional[str] = None


class BackupSummary(BaseModel):
    backup_id: uuid.UUID
    tenant_id: str
    name: str
    note: Optional[str]
    counts: Dict[str, int]
    created_at: datetime
    created_by: Optional[str]


class ResetRequest(BaseModel):
    create_backup_first: bool = True
    backup_name: Optional[str] = None
    backup_note: Optional[str] = None
    confirm: str = Field(..., description="Must equal 'ERASE' to confirm the wipe")


class ResetResponse(BaseModel):
    wiped: Dict[str, int]
    backup_id: Optional[uuid.UUID] = None


class RestoreResponse(BaseModel):
    restored: Dict[str, int]
    from_backup_id: uuid.UUID


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/v1/op/demo-backup", response_model=BackupSummary)
def create_backup(payload: CreateBackupRequest, x_tenant_id: str = Header(default="tenantA")):
    """Snapshot all demo-data tables for the active tenant into demo_backups."""
    snapshot: Dict[str, List[Dict[str, Any]]] = {}
    counts: Dict[str, int] = {}
    backup_id = uuid.uuid4()
    with db() as conn:
        with conn.cursor() as cur:
            set_tenant(conn, x_tenant_id)
            for table in DEMO_TABLES:
                if table in PROTECTED_TABLES:
                    continue
                rows = _snapshot_table(cur, table, x_tenant_id)
                snapshot[table] = rows
                counts[table] = len(rows)
            cur.execute(
                """
                INSERT INTO demo_backups (backup_id, tenant_id, name, note, counts, snapshot, created_at, created_by)
                VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s)
                RETURNING backup_id, tenant_id, name, note, counts, created_at, created_by
                """,
                (
                    str(backup_id),
                    x_tenant_id,
                    payload.name,
                    payload.note,
                    json.dumps(counts),
                    json.dumps(snapshot, default=str),
                    datetime.now(timezone.utc),
                    None,
                ),
            )
            row = cur.fetchone()
        conn.commit()
    return BackupSummary(
        backup_id=row[0], tenant_id=row[1], name=row[2], note=row[3],
        counts=row[4] or {}, created_at=row[5], created_by=row[6],
    )


@router.get("/v1/op/demo-backups", response_model=List[BackupSummary])
def list_backups(x_tenant_id: str = Header(default="tenantA")):
    """List all backups for the active tenant, newest first."""
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT backup_id, tenant_id, name, note, counts, created_at, created_by
                FROM demo_backups
                WHERE tenant_id = %s
                ORDER BY created_at DESC
                """,
                (x_tenant_id,),
            )
            rows = cur.fetchall()
    return [
        BackupSummary(
            backup_id=r[0], tenant_id=r[1], name=r[2], note=r[3],
            counts=r[4] or {}, created_at=r[5], created_by=r[6],
        ) for r in rows
    ]


@router.delete("/v1/op/demo-backups/{backup_id}")
def delete_backup(backup_id: uuid.UUID, x_tenant_id: str = Header(default="tenantA")):
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM demo_backups WHERE backup_id = %s AND tenant_id = %s",
                (str(backup_id), x_tenant_id),
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="backup not found")
        conn.commit()
    return {"ok": True}


@router.post("/v1/op/demo-reset", response_model=ResetResponse)
def reset_demo(payload: ResetRequest, x_tenant_id: str = Header(default="tenantA")):
    """Erase all demo data for the active tenant.

    Preserves: users, roles, system_settings, tenants, demo_backups.
    Optionally creates a pre-wipe backup. Requires ``confirm='ERASE'``.
    """
    if payload.confirm != "ERASE":
        raise HTTPException(status_code=400, detail="confirm must equal 'ERASE'")

    backup_id: Optional[uuid.UUID] = None
    with db() as conn:
        with conn.cursor() as cur:
            set_tenant(conn, x_tenant_id)
            if payload.create_backup_first:
                snapshot: Dict[str, List[Dict[str, Any]]] = {}
                counts: Dict[str, int] = {}
                for table in DEMO_TABLES:
                    rows = _snapshot_table(cur, table, x_tenant_id)
                    snapshot[table] = rows
                    counts[table] = len(rows)
                backup_id = uuid.uuid4()
                cur.execute(
                    """
                    INSERT INTO demo_backups (backup_id, tenant_id, name, note, counts, snapshot)
                    VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb)
                    """,
                    (
                        str(backup_id),
                        x_tenant_id,
                        payload.backup_name or f"Pre-reset backup {datetime.now(timezone.utc).isoformat(timespec='seconds')}",
                        payload.backup_note or "Auto-created before demo-reset",
                        json.dumps(counts),
                        json.dumps(snapshot, default=str),
                    ),
                )
            wiped = _wipe_tenant(cur, x_tenant_id)
        conn.commit()
    return ResetResponse(wiped=wiped, backup_id=backup_id)


@router.post("/v1/op/demo-restore/{backup_id}", response_model=RestoreResponse)
def restore_demo(backup_id: uuid.UUID, x_tenant_id: str = Header(default="tenantA")):
    """Restore tenant state from a prior backup. Wipes current tenant data first."""
    with db() as conn:
        with conn.cursor() as cur:
            set_tenant(conn, x_tenant_id)
            cur.execute(
                "SELECT snapshot FROM demo_backups WHERE backup_id=%s AND tenant_id=%s",
                (str(backup_id), x_tenant_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="backup not found")
            snapshot = row[0] or {}
            restored = _restore_tenant(cur, x_tenant_id, snapshot)
        conn.commit()
    return RestoreResponse(restored=restored, from_backup_id=backup_id)
