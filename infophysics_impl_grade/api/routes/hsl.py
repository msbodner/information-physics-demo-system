"""HSL data routes + rebuild-from-aios + MRO linking + needle search.

V4.4 structural changes (migration 023):

* ``hsl_data`` now has a UNIQUE INDEX on ``(tenant_id, hsl_name)`` so
  concurrent rebuilds are structurally safe and bulk INSERTs can use
  ``ON CONFLICT DO NOTHING`` instead of round-trip existence probes.
* Members live in a side table ``hsl_member(hsl_id, member_value,
  member_kind, …)`` keyed on ``(hsl_id, member_value)``. The legacy
  ``hsl_element_1..100`` columns are dual-written for backward
  compatibility with the ``elements_text`` GIN index (migration 016)
  and the chat.py fallback paths, but the side table is the source of
  truth for reads — overflow members beyond 100 are no longer dropped.
* ``synth_hsls_for_aio`` ensures every AIO insert/update grows the
  HSL topology in place, so ``rebuild-from-aios`` is now a recovery
  tool rather than a routine action.
* ``rebuild-from-aios`` accepts an ``as_of`` query param for forensic
  point-in-time rebuilds (only AIOs whose ``created_at <= as_of`` are
  scanned).
* ``POST /v1/hsl-data/prune`` is the dual function: any HSL whose
  surviving member count drops below 2 is removed.
"""

from __future__ import annotations

import logging
import re as _re
import uuid
from datetime import datetime, timezone
from typing import Iterable, List, Optional, Tuple

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from api.db import db, set_tenant
from api.routes.aio import _AIO_COLS

logger = logging.getLogger("infophysics.api.hsl")

router = APIRouter()


_HSL_ELEMENTS = [f"hsl_element_{i}" for i in range(1, 101)]
_HSL_COLS = ", ".join(_HSL_ELEMENTS)
_HSL_PLACEHOLDERS = ", ".join(["%s"] * 100)

# Values that are too noisy or generic to anchor an HSL on.
_SKIP_VALUES = {"unknown", "n/a", "none", "null", "", "0", "0.0", "false", "true"}
_VALUE_RE = _re.compile(r"\[([^.\]]+)\.(.+?)\]")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class HslDataOut(BaseModel):
    hsl_id: uuid.UUID
    hsl_name: str
    elements: List[Optional[str]]
    created_at: datetime
    updated_at: datetime


class HslDataRequest(BaseModel):
    hsl_name: str
    elements: List[Optional[str]] = Field(default_factory=lambda: [None] * 100)


class MroLinkRequest(BaseModel):
    mro_id: str


class HslFindByNeedlesRequest(BaseModel):
    needles: List[str]
    limit: int = 20


# ---------------------------------------------------------------------------
# Member-table helpers
# ---------------------------------------------------------------------------

def _members_for_hsl(cur, hsl_id: str) -> List[str]:
    """Return ordered member_value list for one hsl_id from hsl_member."""
    cur.execute(
        "SELECT member_value FROM hsl_member WHERE hsl_id = %s "
        "ORDER BY created_at, member_value",
        (hsl_id,),
    )
    return [r[0] for r in cur.fetchall()]


def _members_for_hsls(cur, hsl_ids: Iterable[str]) -> dict[str, List[str]]:
    """Bulk fetch members for a set of hsl_ids in one round-trip."""
    ids = list(hsl_ids)
    if not ids:
        return {}
    cur.execute(
        "SELECT hsl_id::text, member_value FROM hsl_member "
        "WHERE hsl_id = ANY(%s) "
        "ORDER BY hsl_id, created_at, member_value",
        (ids,),
    )
    out: dict[str, List[str]] = {i: [] for i in ids}
    for hid, val in cur.fetchall():
        out.setdefault(hid, []).append(val)
    return out


def _columns_from_members(members: List[str]) -> List[Optional[str]]:
    """Pad/truncate a member list into the legacy 100-slot column shape."""
    elems: List[Optional[str]] = list(members[:100])
    while len(elems) < 100:
        elems.append(None)
    return elems


def _hsl_row_to_out(row, members: Optional[List[str]] = None) -> HslDataOut:
    """row layout: hsl_id, hsl_name, hsl_element_1..100, created_at, updated_at."""
    if members is not None:
        # Source of truth: side table. Pad to 100 for client compatibility.
        elements = _columns_from_members(members)
    else:
        elements = list(row[2:102])
    return HslDataOut(
        hsl_id=row[0],
        hsl_name=row[1],
        elements=elements,
        created_at=row[102],
        updated_at=row[103],
    )


# ---------------------------------------------------------------------------
# HSL CRUD
# ---------------------------------------------------------------------------

@router.get("/v1/hsl-data", response_model=List[HslDataOut])
def list_hsl_data(
    limit: int = Query(5000, ge=1, le=100000),
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    tenant = x_tenant_id or "tenantA"
    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT hsl_id, hsl_name, {_HSL_COLS}, created_at, updated_at "
                f"FROM hsl_data ORDER BY created_at DESC LIMIT %s",
                (limit,),
            )
            rows = cur.fetchall()
            members_map = _members_for_hsls(cur, [str(r[0]) for r in rows])
    return [_hsl_row_to_out(r, members_map.get(str(r[0]))) for r in rows]


@router.post("/v1/hsl-data", response_model=HslDataOut, status_code=201)
def create_hsl_data(
    payload: HslDataRequest,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    if not payload.hsl_name.strip():
        raise HTTPException(status_code=400, detail="hsl_name is required")
    tenant = x_tenant_id or "tenantA"
    hsl_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    elems = (payload.elements + [None] * 100)[:100]
    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO hsl_data (hsl_id, hsl_name, {_HSL_COLS}, created_at, updated_at, tenant_id) "
                f"VALUES (%s, %s, {_HSL_PLACEHOLDERS}, %s, %s, %s) "
                f"RETURNING hsl_id, hsl_name, {_HSL_COLS}, created_at, updated_at",
                [str(hsl_id), payload.hsl_name.strip()] + elems + [now, now, tenant],
            )
            row = cur.fetchone()
            # Side-table dual-write: one row per non-null member.
            _replace_members(cur, str(hsl_id), tenant, elems, now)
        conn.commit()
    return _hsl_row_to_out(row, [e for e in elems if e])


@router.put("/v1/hsl-data/{hsl_id}", response_model=HslDataOut)
def update_hsl_data(
    hsl_id: str,
    payload: HslDataRequest,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    if not payload.hsl_name.strip():
        raise HTTPException(status_code=400, detail="hsl_name is required")
    tenant = x_tenant_id or "tenantA"
    now = datetime.now(timezone.utc)
    elems = (payload.elements + [None] * 100)[:100]
    sets = "hsl_name = %s, " + ", ".join([f"hsl_element_{i} = %s" for i in range(1, 101)]) + ", updated_at = %s"
    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE hsl_data SET {sets} WHERE hsl_id = %s "
                f"RETURNING hsl_id, hsl_name, {_HSL_COLS}, created_at, updated_at",
                [payload.hsl_name.strip()] + elems + [now, hsl_id],
            )
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="HSL record not found")
            # Re-sync side table to match the supplied elements.
            _replace_members(cur, hsl_id, tenant, elems, now)
        conn.commit()
    return _hsl_row_to_out(row, [e for e in elems if e])


@router.delete("/v1/hsl-data/{hsl_id}")
def delete_hsl_data(
    hsl_id: str,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    tenant = x_tenant_id or "tenantA"
    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            # ON DELETE CASCADE on hsl_member.hsl_id handles the side table.
            cur.execute("DELETE FROM hsl_data WHERE hsl_id = %s RETURNING hsl_id", (hsl_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="HSL record not found")
        conn.commit()
    return {"deleted": hsl_id}


def _replace_members(cur, hsl_id: str, tenant: str, elems: List[Optional[str]], now: datetime) -> None:
    """Replace the side-table members for one HSL with the supplied list."""
    cur.execute("DELETE FROM hsl_member WHERE hsl_id = %s", (hsl_id,))
    rows = []
    for e in elems:
        if e and isinstance(e, str) and e.strip():
            kind = "mro" if e.strip().startswith("[MRO.") else "aio"
            rows.append((hsl_id, e.strip(), kind, tenant, now))
    if rows:
        cur.executemany(
            "INSERT INTO hsl_member (hsl_id, member_value, member_kind, tenant_id, created_at) "
            "VALUES (%s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
            rows,
        )


# ---------------------------------------------------------------------------
# HSL ↔ MRO linking
# ---------------------------------------------------------------------------

@router.post("/v1/hsl-data/{hsl_id}/link-mro")
def link_mro_to_hsl(
    hsl_id: str,
    payload: MroLinkRequest,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    """Append [MRO.<mro_id>] to the HSL's member list (and the next free
    column for elements_text continuity)."""
    tenant = x_tenant_id or "tenantA"
    mro_ref = f"[MRO.{payload.mro_id}]"
    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            cur.execute(f"SELECT {_HSL_COLS} FROM hsl_data WHERE hsl_id = %s", (hsl_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="HSL not found")

            # Side-table write — authoritative.
            cur.execute(
                "INSERT INTO hsl_member (hsl_id, member_value, member_kind, tenant_id) "
                "VALUES (%s, %s, 'mro', %s) ON CONFLICT DO NOTHING RETURNING hsl_id",
                (hsl_id, mro_ref, tenant),
            )
            inserted = cur.fetchone() is not None
            if not inserted:
                return {"updated": False, "reason": "already_linked", "mro_ref": mro_ref}

            # Legacy column dual-write — best-effort (cap of 100 still applies).
            elements = list(row)
            idx = next((i for i, e in enumerate(elements) if not e), None)
            if idx is not None:
                col_name = f"hsl_element_{idx + 1}"
                cur.execute(
                    f"UPDATE hsl_data SET {col_name} = %s, updated_at = %s WHERE hsl_id = %s",
                    (mro_ref, datetime.now(timezone.utc), hsl_id),
                )
                slot = idx + 1
            else:
                # Member persisted in the side table; legacy slots are full.
                cur.execute(
                    "UPDATE hsl_data SET updated_at = %s WHERE hsl_id = %s",
                    (datetime.now(timezone.utc), hsl_id),
                )
                slot = None
        conn.commit()
    return {"updated": True, "slot": slot, "mro_ref": mro_ref}


@router.post("/v1/hsl-data/find-by-needles")
def find_hsls_by_needles(
    payload: HslFindByNeedlesRequest,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    """Return HSL IDs whose elements or name contain any of the given needle strings."""
    if not payload.needles:
        return {"hsl_ids": []}
    tenant = x_tenant_id or "tenantA"
    needles = [n.lower().strip() for n in payload.needles if n.strip()]
    if not needles:
        return {"hsl_ids": []}
    matched_ids: List[str] = []
    try:
        with db() as conn:
            set_tenant(conn, tenant)
            with conn.cursor() as cur:
                or_clause = " OR ".join(["elements_text LIKE %s"] * len(needles))
                params = [f"%{n}%" for n in needles] + [payload.limit]
                cur.execute(
                    f"SELECT hsl_id FROM hsl_data WHERE {or_clause} LIMIT %s",
                    params,
                )
                matched_ids = [str(r[0]) for r in cur.fetchall()]
    except Exception:
        logger.warning("find_hsls_by_needles failed")
    return {"hsl_ids": matched_ids}


# ---------------------------------------------------------------------------
# Per-AIO synth (incremental rebuild on insert/update)
# ---------------------------------------------------------------------------

def _extract_kv_pairs(elements: Iterable[Optional[str]]) -> List[Tuple[str, str]]:
    """Pull every (key, value) pair out of the AIO's element strings."""
    pairs: List[Tuple[str, str]] = []
    seen: set[Tuple[str, str]] = set()
    for el in elements:
        if not el or not isinstance(el, str):
            continue
        for m in _VALUE_RE.finditer(el):
            key = m.group(1).strip()
            val = m.group(2).strip()
            if not key or not val:
                continue
            if val.lower() in _SKIP_VALUES or len(val) < 2:
                continue
            kv = (key, val)
            if kv in seen:
                continue
            seen.add(kv)
            pairs.append(kv)
    return pairs


def synth_hsls_for_aio(
    conn,
    tenant: str,
    aio_name: str,
    elements: Iterable[Optional[str]],
) -> dict:
    """Grow the HSL topology in place for one AIO.

    For each (Key, Value) pair this AIO carries:
      * If an HSL [Key.Value].hsl already exists for this tenant — append
        the AIO to the side table.
      * Else if at least one *other* AIO in this tenant already carries
        the same (Key, Value) — create the HSL with both members.
      * Else — skip; a single-member anchor is not yet a Hyper-Semantic
        Layer.

    Idempotent. Cheap enough to call on every AIO write. Returns a small
    counters dict.
    """
    if not aio_name:
        return {"appended": 0, "created": 0, "skipped_single": 0}

    pairs = _extract_kv_pairs(elements)
    if not pairs:
        return {"appended": 0, "created": 0, "skipped_single": 0}

    appended = 0
    created = 0
    skipped_single = 0
    now = datetime.now(timezone.utc)

    with conn.cursor() as cur:
        for key, val in pairs:
            hsl_name = f"[{key}.{val}].hsl"

            # Does the HSL already exist?
            cur.execute(
                "SELECT hsl_id FROM hsl_data WHERE tenant_id = %s AND hsl_name = %s LIMIT 1",
                (tenant, hsl_name),
            )
            row = cur.fetchone()

            if row:
                hsl_id = str(row[0])
                # Append to side table. ON CONFLICT covers the
                # already-a-member case.
                cur.execute(
                    "INSERT INTO hsl_member (hsl_id, member_value, member_kind, tenant_id, created_at) "
                    "VALUES (%s, %s, 'aio', %s, %s) ON CONFLICT DO NOTHING RETURNING hsl_id",
                    (hsl_id, aio_name, tenant, now),
                )
                if cur.fetchone():
                    appended += 1
                    # Best-effort legacy column dual-write — into the
                    # next free slot only. Capped at 100; overflow stays
                    # in the side table.
                    cur.execute(
                        f"SELECT {_HSL_COLS} FROM hsl_data WHERE hsl_id = %s",
                        (hsl_id,),
                    )
                    elem_row = cur.fetchone()
                    if elem_row is not None:
                        idx = next((i for i, e in enumerate(elem_row) if not e), None)
                        if idx is not None:
                            col_name = f"hsl_element_{idx + 1}"
                            cur.execute(
                                f"UPDATE hsl_data SET {col_name} = %s, updated_at = %s WHERE hsl_id = %s",
                                (aio_name, now, hsl_id),
                            )
                continue

            # No HSL yet — does another AIO carry this (Key, Value)?
            # NB: ``elements_text`` is a ``lower(...)`` generated column
            # (migration 016) so the LIKE pattern must also be lowercased.
            like_pat = f"%[{key}.{val}]%".lower()
            cur.execute(
                "SELECT aio_name FROM aio_data "
                "WHERE tenant_id = %s AND aio_name <> %s AND elements_text LIKE %s "
                "LIMIT 1",
                (tenant, aio_name, like_pat),
            )
            other = cur.fetchone()
            if not other:
                skipped_single += 1
                continue

            other_name = other[0]
            hsl_id = str(uuid.uuid4())

            # Legacy 100-column shape: this AIO + the partner.
            elems: List[Optional[str]] = [other_name, aio_name] + [None] * 98
            cur.execute(
                f"INSERT INTO hsl_data (hsl_id, hsl_name, {_HSL_COLS}, created_at, updated_at, tenant_id) "
                f"VALUES (%s, %s, {_HSL_PLACEHOLDERS}, %s, %s, %s) "
                f"ON CONFLICT (tenant_id, hsl_name) DO NOTHING "
                f"RETURNING hsl_id",
                [hsl_id, hsl_name] + elems + [now, now, tenant],
            )
            inserted = cur.fetchone()
            if inserted:
                created += 1
                real_id = str(inserted[0])
                cur.executemany(
                    "INSERT INTO hsl_member (hsl_id, member_value, member_kind, tenant_id, created_at) "
                    "VALUES (%s, %s, 'aio', %s, %s) ON CONFLICT DO NOTHING",
                    [
                        (real_id, other_name, tenant, now),
                        (real_id, aio_name, tenant, now),
                    ],
                )
            else:
                # Lost a concurrent race — the HSL now exists. Append
                # ourselves to the side table.
                cur.execute(
                    "SELECT hsl_id FROM hsl_data WHERE tenant_id = %s AND hsl_name = %s",
                    (tenant, hsl_name),
                )
                existing = cur.fetchone()
                if existing:
                    cur.execute(
                        "INSERT INTO hsl_member (hsl_id, member_value, member_kind, tenant_id, created_at) "
                        "VALUES (%s, %s, 'aio', %s, %s) ON CONFLICT DO NOTHING",
                        (str(existing[0]), aio_name, tenant, now),
                    )
                    appended += 1

    return {"appended": appended, "created": created, "skipped_single": skipped_single}


# ---------------------------------------------------------------------------
# Bulk rebuild
# ---------------------------------------------------------------------------

@router.post("/v1/hsl-data/rebuild-from-aios")
def rebuild_hsls_from_aios(
    as_of: Optional[datetime] = Query(
        None,
        description="Only scan AIOs whose created_at <= this timestamp. "
                    "Use for forensic / regression rebuilds. ISO 8601.",
    ),
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    """Tenant-wide rebuild — recovery tool, not a routine action.

    Routine HSL growth happens via :func:`synth_hsls_for_aio` on every
    AIO insert. This endpoint exists for forensic point-in-time
    rebuilds (``--as_of``) and for recovering from out-of-band aio_data
    edits that bypassed the API.
    """
    tenant = x_tenant_id or "tenantA"
    now = datetime.now(timezone.utc)

    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            if as_of is not None:
                cur.execute(
                    f"SELECT aio_name, {_AIO_COLS} FROM aio_data WHERE created_at <= %s",
                    (as_of,),
                )
            else:
                cur.execute(f"SELECT aio_name, {_AIO_COLS} FROM aio_data")
            aio_rows = cur.fetchall()

        # Build the full (Key, Value) → [aio_names] index.
        index: dict[str, dict[str, list[str]]] = {}
        for row in aio_rows:
            aio_name = row[0]
            if not aio_name:
                continue
            seen_kv: set[Tuple[str, str]] = set()
            for el in row[1:]:
                if not el or not isinstance(el, str):
                    continue
                for m in _VALUE_RE.finditer(el):
                    key = m.group(1).strip()
                    val = m.group(2).strip()
                    if val.lower() in _SKIP_VALUES or len(val) < 2:
                        continue
                    kv = (key, val)
                    if kv in seen_kv:
                        continue
                    seen_kv.add(kv)
                    index.setdefault(key, {}).setdefault(val, []).append(aio_name)

        # Build the candidate batch: only (Key, Value) groups with ≥ 2 AIOs.
        candidates: list[Tuple[str, List[str]]] = []
        skipped_single = 0
        for key, val_map in index.items():
            for val, names in val_map.items():
                if len(names) < 2:
                    skipped_single += 1
                    continue
                candidates.append((f"[{key}.{val}].hsl", names))

        # ── Phase 1: bulk INSERT … ON CONFLICT DO NOTHING into hsl_data.
        # Batched in chunks to keep the parameter count under PG limits.
        created = 0
        already_existed = 0
        candidate_id_map: dict[str, str] = {}  # hsl_name → hsl_id (real)
        with conn.cursor() as cur:
            for start in range(0, len(candidates), 200):
                batch = candidates[start:start + 200]
                values_sql_parts = []
                params: list = []
                for hsl_name, names in batch:
                    hsl_id = str(uuid.uuid4())
                    candidate_id_map[hsl_name] = hsl_id
                    elems = list(names[:100]) + [None] * max(0, 100 - len(names))
                    values_sql_parts.append(
                        "(%s, %s, " + _HSL_PLACEHOLDERS + ", %s, %s, %s)"
                    )
                    params.extend([hsl_id, hsl_name] + elems[:100] + [now, now, tenant])

                if not values_sql_parts:
                    continue

                values_sql = ", ".join(values_sql_parts)
                cur.execute(
                    f"INSERT INTO hsl_data (hsl_id, hsl_name, {_HSL_COLS}, "
                    f"created_at, updated_at, tenant_id) VALUES {values_sql} "
                    f"ON CONFLICT (tenant_id, hsl_name) DO NOTHING "
                    f"RETURNING hsl_id, hsl_name",
                    params,
                )
                inserted_rows = cur.fetchall()
                for hid, hname in inserted_rows:
                    candidate_id_map[hname] = str(hid)
                created += len(inserted_rows)
                already_existed += len(batch) - len(inserted_rows)

            # Resolve hsl_ids for names that lost the conflict — they
            # already exist; we want to top up their member side-table.
            existing_names = [
                hname for hname, _ in candidates
                if candidate_id_map.get(hname) is None
                or len(candidates) > 0
            ]
            # Simpler: re-query everything from candidates.
            if candidates:
                names_only = [hname for hname, _ in candidates]
                cur.execute(
                    "SELECT hsl_name, hsl_id FROM hsl_data "
                    "WHERE tenant_id = %s AND hsl_name = ANY(%s)",
                    (tenant, names_only),
                )
                for hname, hid in cur.fetchall():
                    candidate_id_map[hname] = str(hid)

            # ── Phase 2: bulk member INSERT … ON CONFLICT DO NOTHING.
            member_rows: list[Tuple[str, str, str, str, datetime]] = []
            for hsl_name, names in candidates:
                hid = candidate_id_map.get(hsl_name)
                if not hid:
                    continue
                for n in names:
                    member_rows.append((hid, n, "aio", tenant, now))

            for start in range(0, len(member_rows), 1000):
                cur.executemany(
                    "INSERT INTO hsl_member (hsl_id, member_value, member_kind, "
                    "tenant_id, created_at) VALUES (%s, %s, %s, %s, %s) "
                    "ON CONFLICT DO NOTHING",
                    member_rows[start:start + 1000],
                )

        conn.commit()

    logger.info(
        "HSL rebuild: %d created, %d already existed, %d skipped (single-AIO), as_of=%s",
        created, already_existed, skipped_single, as_of,
    )
    return {
        "created": created,
        "skipped_single_aio": skipped_single,
        "already_existed": already_existed,
        "total_aios_scanned": len(aio_rows),
        "as_of": as_of.isoformat() if as_of else None,
    }


# ---------------------------------------------------------------------------
# Prune (dual of rebuild)
# ---------------------------------------------------------------------------

@router.post("/v1/hsl-data/prune")
def prune_hsls(x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id")):
    """Remove HSLs whose surviving member count is below the anchor floor.

    A "surviving" member is an ``hsl_member`` row of kind 'aio' whose
    ``member_value`` is still present in ``aio_data.aio_name`` for the
    same tenant. MRO members (``[MRO.<id>]``) do not count toward the
    floor — an HSL with one AIO and three MRO refs is still pruned.

    Pruned in one statement under FORCE RLS: SELECT the doomed hsl_ids
    via a CTE, DELETE them, ON DELETE CASCADE handles ``hsl_member``.
    """
    tenant = x_tenant_id or "tenantA"

    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            cur.execute(
                """
                WITH live_member_counts AS (
                    SELECT m.hsl_id, COUNT(*) AS surviving
                    FROM hsl_member m
                    JOIN aio_data  a
                      ON a.aio_name = m.member_value
                     AND a.tenant_id = m.tenant_id
                    WHERE m.member_kind = 'aio'
                      AND m.tenant_id   = %s
                    GROUP BY m.hsl_id
                ),
                doomed AS (
                    SELECT h.hsl_id
                    FROM hsl_data h
                    LEFT JOIN live_member_counts lmc USING (hsl_id)
                    WHERE h.tenant_id = %s
                      AND COALESCE(lmc.surviving, 0) < 2
                )
                DELETE FROM hsl_data h
                USING doomed d
                WHERE h.hsl_id = d.hsl_id
                RETURNING h.hsl_id, h.hsl_name
                """,
                (tenant, tenant),
            )
            pruned = cur.fetchall()
        conn.commit()

    logger.info("HSL prune: removed %d HSLs (tenant=%s)", len(pruned), tenant)
    return {
        "pruned": len(pruned),
        "names": [r[1] for r in pruned[:50]],  # sample, capped
    }
