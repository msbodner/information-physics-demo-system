"""AIO data + Information Elements routes.

Also exports the shared AIO column constants and sync helpers that are
consumed by other modules (notably ``routes.hsl`` for rebuild-from-aios).
"""

from __future__ import annotations

import logging
import re as _re
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from api.db import db, set_tenant

logger = logging.getLogger("infophysics.api.aio")

router = APIRouter()


# ---------------------------------------------------------------------------
# Shared AIO column constants (re-used by routes.hsl rebuild-from-aios)
# ---------------------------------------------------------------------------

_AIO_ELEMENTS = [f"element_{i}" for i in range(1, 51)]
_AIO_COLS = ", ".join(_AIO_ELEMENTS)
_AIO_PLACEHOLDERS = ", ".join(["%s"] * 50)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class AioDataOut(BaseModel):
    aio_id: uuid.UUID
    aio_name: str
    elements: List[Optional[str]]
    created_at: datetime
    updated_at: datetime


class AioDataRequest(BaseModel):
    aio_name: str
    elements: List[Optional[str]] = Field(default_factory=lambda: [None] * 50)


def _aio_row_to_out(row) -> AioDataOut:
    # row: aio_id, aio_name, element_1..50, created_at, updated_at
    return AioDataOut(
        aio_id=row[0],
        aio_name=row[1],
        elements=list(row[2:52]),
        created_at=row[52],
        updated_at=row[53],
    )


# ---------------------------------------------------------------------------
# Information-element helpers (shared with rebuild endpoint)
# ---------------------------------------------------------------------------

def _extract_field_names(elements: list) -> list[str]:
    """Extract unique [FieldName.Data] field names from AIO element strings."""
    names = set()
    for el in elements:
        if el and isinstance(el, str):
            m = _re.match(r"\[([^.\]]+)\.", el)
            if m:
                names.add(m.group(1))
    return list(names)


def _sync_information_elements(conn, field_names: list[str]):
    """Upsert field names into information_elements and recount AIOs for each.

    Caller is responsible for committing (so this can participate in a larger
    transaction, e.g. alongside the AIO insert).
    """
    if not field_names:
        return
    with conn.cursor() as cur:
        for fn in field_names:
            like_pattern = f"[{fn}.%"
            cur.execute(
                f"SELECT COUNT(DISTINCT aio_id) FROM aio_data WHERE "
                + " OR ".join([f"element_{i} LIKE %s" for i in range(1, 51)]),
                [like_pattern] * 50,
            )
            count = cur.fetchone()[0]
            cur.execute(
                """INSERT INTO information_elements (field_name, aio_count, updated_at)
                   VALUES (%s, %s, now())
                   ON CONFLICT (field_name) DO UPDATE SET aio_count = %s, updated_at = now()""",
                (fn, count, count),
            )


# ---------------------------------------------------------------------------
# AIO Data routes
# ---------------------------------------------------------------------------

@router.get("/v1/aio-data", response_model=List[AioDataOut])
def list_aio_data(
    limit: int = Query(5000, ge=1, le=100000),
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    tenant = x_tenant_id or "tenantA"
    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT aio_id, aio_name, {_AIO_COLS}, created_at, updated_at FROM aio_data ORDER BY created_at DESC LIMIT %s",
                (limit,),
            )
            rows = cur.fetchall()
    return [_aio_row_to_out(r) for r in rows]


@router.post("/v1/aio-data", response_model=AioDataOut, status_code=201)
def create_aio_data(
    payload: AioDataRequest,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    if not payload.aio_name.strip():
        raise HTTPException(status_code=400, detail="aio_name is required")
    tenant = x_tenant_id or "tenantA"
    aio_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    elems = (payload.elements + [None] * 50)[:50]
    # Single connection, single transaction: INSERT ... RETURNING + info-elements sync.
    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO aio_data (aio_id, aio_name, {_AIO_COLS}, created_at, updated_at, tenant_id) "
                f"VALUES (%s, %s, {_AIO_PLACEHOLDERS}, %s, %s, %s) "
                f"RETURNING aio_id, aio_name, {_AIO_COLS}, created_at, updated_at",
                [str(aio_id), payload.aio_name.strip()] + elems + [now, now, tenant],
            )
            row = cur.fetchone()
        try:
            field_names = _extract_field_names(elems)
            if field_names:
                _sync_information_elements(conn, field_names)
        except Exception as e:
            logger.warning(f"Failed to sync information_elements: {e}")
        conn.commit()
    return _aio_row_to_out(row)


@router.put("/v1/aio-data/{aio_id}", response_model=AioDataOut)
def update_aio_data(
    aio_id: str,
    payload: AioDataRequest,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    if not payload.aio_name.strip():
        raise HTTPException(status_code=400, detail="aio_name is required")
    tenant = x_tenant_id or "tenantA"
    now = datetime.now(timezone.utc)
    elems = (payload.elements + [None] * 50)[:50]
    sets = "aio_name = %s, " + ", ".join([f"element_{i} = %s" for i in range(1, 51)]) + ", updated_at = %s"
    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE aio_data SET {sets} WHERE aio_id = %s "
                f"RETURNING aio_id, aio_name, {_AIO_COLS}, created_at, updated_at",
                [payload.aio_name.strip()] + elems + [now, aio_id],
            )
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="AIO record not found")
        conn.commit()
    return _aio_row_to_out(row)


@router.delete("/v1/aio-data/{aio_id}")
def delete_aio_data(
    aio_id: str,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    tenant = x_tenant_id or "tenantA"
    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            cur.execute("DELETE FROM aio_data WHERE aio_id = %s RETURNING aio_id", (aio_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="AIO record not found")
        conn.commit()
    return {"deleted": aio_id}


# ---------------------------------------------------------------------------
# Information Elements
# ---------------------------------------------------------------------------

class InformationElementOut(BaseModel):
    element_id: str
    field_name: str
    aio_count: int
    created_at: str
    updated_at: str


class InformationElementRequest(BaseModel):
    field_name: str
    aio_count: int = 0


@router.get("/v1/information-elements")
def list_information_elements():
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT element_id, field_name, aio_count, created_at, updated_at FROM information_elements ORDER BY field_name")
            rows = cur.fetchall()
    return [InformationElementOut(element_id=str(r[0]), field_name=r[1], aio_count=r[2], created_at=str(r[3]), updated_at=str(r[4])) for r in rows]


@router.post("/v1/information-elements", status_code=201)
def create_information_element(payload: InformationElementRequest):
    eid = uuid.uuid4()
    now = datetime.now(timezone.utc)
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO information_elements (element_id, field_name, aio_count, created_at, updated_at) VALUES (%s, %s, %s, %s, %s)",
                (str(eid), payload.field_name.strip(), payload.aio_count, now, now),
            )
        conn.commit()
    return InformationElementOut(element_id=str(eid), field_name=payload.field_name.strip(), aio_count=payload.aio_count, created_at=str(now), updated_at=str(now))


@router.put("/v1/information-elements/{element_id}")
def update_information_element(element_id: str, payload: InformationElementRequest):
    now = datetime.now(timezone.utc)
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE information_elements SET field_name = %s, aio_count = %s, updated_at = %s WHERE element_id = %s",
                (payload.field_name.strip(), payload.aio_count, now, element_id),
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Element not found")
        conn.commit()
    return InformationElementOut(element_id=element_id, field_name=payload.field_name.strip(), aio_count=payload.aio_count, created_at=str(now), updated_at=str(now))


@router.delete("/v1/information-elements/{element_id}")
def delete_information_element(element_id: str):
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM information_elements WHERE element_id = %s RETURNING element_id", (element_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Element not found")
        conn.commit()
    return {"deleted": element_id}


@router.post("/v1/information-elements/rebuild")
def rebuild_information_elements(x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id")):
    """Scan all AIOs and rebuild the information_elements table from scratch."""
    tenant = x_tenant_id or "tenantA"
    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            cur.execute(f"SELECT {_AIO_COLS} FROM aio_data")
            rows = cur.fetchall()
        all_fields: dict[str, int] = {}
        for row in rows:
            for el in row:
                if el and isinstance(el, str):
                    m = _re.match(r"\[([^.\]]+)\.", el)
                    if m:
                        fn = m.group(1)
                        all_fields[fn] = all_fields.get(fn, 0) + 1
        with conn.cursor() as cur:
            for fn, count in all_fields.items():
                cur.execute(
                    """INSERT INTO information_elements (field_name, aio_count, updated_at)
                       VALUES (%s, %s, now())
                       ON CONFLICT (field_name) DO UPDATE SET aio_count = %s, updated_at = now()""",
                    (fn, count, count),
                )
        conn.commit()
    return {"rebuilt": len(all_fields), "fields": list(all_fields.keys())}
