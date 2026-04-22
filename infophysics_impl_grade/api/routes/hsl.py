"""HSL data routes + rebuild-from-aios + MRO linking + needle search."""

from __future__ import annotations

import logging
import re as _re
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from api.db import db, set_tenant
from api.routes.aio import _AIO_COLS

logger = logging.getLogger("infophysics.api.hsl")

router = APIRouter()


_HSL_ELEMENTS = [f"hsl_element_{i}" for i in range(1, 101)]
_HSL_COLS = ", ".join(_HSL_ELEMENTS)
_HSL_PLACEHOLDERS = ", ".join(["%s"] * 100)


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


def _hsl_row_to_out(row) -> HslDataOut:
    return HslDataOut(
        hsl_id=row[0],
        hsl_name=row[1],
        elements=list(row[2:102]),
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
                f"SELECT hsl_id, hsl_name, {_HSL_COLS}, created_at, updated_at FROM hsl_data ORDER BY created_at DESC LIMIT %s",
                (limit,),
            )
            rows = cur.fetchall()
    return [_hsl_row_to_out(r) for r in rows]


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
        conn.commit()
    return _hsl_row_to_out(row)


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
        conn.commit()
    return _hsl_row_to_out(row)


@router.delete("/v1/hsl-data/{hsl_id}")
def delete_hsl_data(
    hsl_id: str,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    tenant = x_tenant_id or "tenantA"
    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            cur.execute("DELETE FROM hsl_data WHERE hsl_id = %s RETURNING hsl_id", (hsl_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="HSL record not found")
        conn.commit()
    return {"deleted": hsl_id}


# ---------------------------------------------------------------------------
# HSL ↔ MRO linking
# ---------------------------------------------------------------------------

@router.post("/v1/hsl-data/{hsl_id}/link-mro")
def link_mro_to_hsl(
    hsl_id: str,
    payload: MroLinkRequest,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    """Append [MRO.<mro_id>] to the next free hsl_element_* slot."""
    tenant = x_tenant_id or "tenantA"
    mro_ref = f"[MRO.{payload.mro_id}]"
    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            cur.execute(f"SELECT {_HSL_COLS} FROM hsl_data WHERE hsl_id = %s", (hsl_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="HSL not found")
            elements = list(row)
            if mro_ref in elements:
                return {"updated": False, "reason": "already_linked", "mro_ref": mro_ref}
            idx = next((i for i, e in enumerate(elements) if not e), None)
            if idx is None:
                return {"updated": False, "reason": "no_free_slots", "mro_ref": mro_ref}
            col_name = f"hsl_element_{idx + 1}"
            cur.execute(
                f"UPDATE hsl_data SET {col_name} = %s, updated_at = %s WHERE hsl_id = %s",
                (mro_ref, datetime.now(timezone.utc), hsl_id),
            )
        conn.commit()
    return {"updated": True, "slot": idx + 1, "mro_ref": mro_ref}


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
                # Single indexed LIKE per needle against the
                # lowercased generated elements_text column
                # (pg_trgm GIN, migration 016). Replaces the prior
                # Python-side scan of 1000 rows × 100 element columns.
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


@router.post("/v1/hsl-data/rebuild-from-aios")
def rebuild_hsls_from_aios(x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id")):
    """Scan every AIO and create one HSL record per shared [Key.Value] element group (≥2 AIOs)."""
    tenant = x_tenant_id or "tenantA"
    _SKIP_VALUES = {"unknown", "n/a", "none", "null", "", "0", "0.0", "false", "true"}
    _VALUE_RE = _re.compile(r"\[([^.\]]+)\.(.+?)\]")

    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            cur.execute(f"SELECT aio_name, {_AIO_COLS} FROM aio_data")
            aio_rows = cur.fetchall()

        index: dict[str, dict[str, list]] = {}
        for row in aio_rows:
            aio_name = row[0]
            if not aio_name:
                continue
            for el in row[1:]:
                if not el or not isinstance(el, str):
                    continue
                for m in _VALUE_RE.finditer(el):
                    key = m.group(1).strip()
                    val = m.group(2).strip()
                    if val.lower() in _SKIP_VALUES or len(val) < 2:
                        continue
                    if key not in index:
                        index[key] = {}
                    if val not in index[key]:
                        index[key][val] = []
                    index[key][val].append(aio_name)

        created = 0
        skipped = 0
        already_existed = 0
        now = datetime.now(timezone.utc)

        with conn.cursor() as cur:
            for key, val_map in index.items():
                for val, aio_names in val_map.items():
                    if len(aio_names) < 2:
                        skipped += 1
                        continue
                    hsl_name = f"[{key}.{val}].hsl"
                    cur.execute("SELECT hsl_id FROM hsl_data WHERE hsl_name = %s LIMIT 1", (hsl_name,))
                    if cur.fetchone():
                        already_existed += 1
                        continue
                    elems: List[Optional[str]] = aio_names[:100]
                    while len(elems) < 100:
                        elems.append(None)
                    hsl_id = uuid.uuid4()
                    cur.execute(
                        f"INSERT INTO hsl_data (hsl_id, hsl_name, {_HSL_COLS}, created_at, updated_at, tenant_id) "
                        f"VALUES (%s, %s, {_HSL_PLACEHOLDERS}, %s, %s, %s)",
                        [str(hsl_id), hsl_name] + elems + [now, now, tenant],
                    )
                    created += 1

        conn.commit()

    logger.info("HSL rebuild: %d created, %d skipped (single-AIO), %d already existed",
                created, skipped, already_existed)
    return {
        "created": created,
        "skipped_single_aio": skipped,
        "already_existed": already_existed,
        "total_aios_scanned": len(aio_rows),
    }
