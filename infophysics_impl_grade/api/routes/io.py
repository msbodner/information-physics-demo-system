"""Information Object (/v1/io) routes.

IOs are the untyped source records that feed downstream AIO conversion.
Each is tenant-scoped via ``X-Tenant-Id``.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from api.db import db, set_tenant

logger = logging.getLogger("infophysics.api.io")

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class RawIn(BaseModel):
    raw_uri: Optional[str] = None
    raw_hash: Optional[str] = None
    mime_type: Optional[str] = None
    size_bytes: Optional[int] = None


class ContextIn(BaseModel):
    source_system: Optional[str] = None
    source_object_id: Optional[str] = None
    author: Optional[str] = None
    permissions_ref: Optional[str] = None
    policy_scope_id: Optional[str] = None


class CreateIORequest(BaseModel):
    type: str
    raw: RawIn
    context: ContextIn
    dedupe: Dict[str, Any] = Field(default_factory=lambda: {"mode": "hash_or_source"})


class IOOut(BaseModel):
    io_id: uuid.UUID
    tenant_id: str
    type: str
    created_at: datetime
    raw: Dict[str, Any] = Field(default_factory=dict)
    context: Dict[str, Any] = Field(default_factory=dict)


class ListIOResponse(BaseModel):
    items: List[IOOut]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/v1/io", response_model=Dict[str, IOOut], status_code=201)
def create_io(payload: CreateIORequest, x_tenant_id: str = Header(..., alias="X-Tenant-Id")):
    logger.info(
        "create_io tenant=%s type=%s source=%s",
        x_tenant_id, payload.type, payload.context.source_object_id,
    )
    io_id = uuid.uuid4()
    created_at = datetime.now(timezone.utc)

    with db() as conn:
        set_tenant(conn, x_tenant_id)
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO tenants(tenant_id, name) VALUES(%s, %s) ON CONFLICT (tenant_id) DO NOTHING",
                (x_tenant_id, x_tenant_id),
            )
            cur.execute(
                """
                INSERT INTO information_objects(
                    io_id, tenant_id, type, created_at,
                    raw_uri, raw_hash, mime_type, size_bytes,
                    source_system, source_object_id, author, policy_scope_id
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    str(io_id), x_tenant_id, payload.type, created_at,
                    payload.raw.raw_uri, payload.raw.raw_hash,
                    payload.raw.mime_type, payload.raw.size_bytes,
                    payload.context.source_system, payload.context.source_object_id,
                    payload.context.author, payload.context.policy_scope_id,
                ),
            )
        conn.commit()

    return {
        "item": IOOut(
            io_id=io_id,
            tenant_id=x_tenant_id,
            type=payload.type,
            created_at=created_at,
            raw=payload.raw.model_dump(),
            context=payload.context.model_dump(),
        )
    }


@router.get("/v1/io", response_model=ListIOResponse)
def list_ios(
    x_tenant_id: str = Header(..., alias="X-Tenant-Id"),
    type: Optional[str] = Query(None),
    source_system: Optional[str] = Query(None),
    created_after: Optional[datetime] = Query(None),
    created_before: Optional[datetime] = Query(None),
    limit: int = Query(5000, ge=1, le=100000),
):
    logger.info(
        "list_ios tenant=%s type=%s source=%s limit=%d",
        x_tenant_id, type, source_system, limit,
    )

    conditions = ["tenant_id = %s", "is_deleted = false"]
    params: List[Any] = [x_tenant_id]

    if type:
        conditions.append("type = %s")
        params.append(type)
    if source_system:
        conditions.append("source_system = %s")
        params.append(source_system)
    if created_after:
        conditions.append("created_at >= %s")
        params.append(created_after)
    if created_before:
        conditions.append("created_at <= %s")
        params.append(created_before)

    params.append(limit)
    sql = f"""
        SELECT io_id, tenant_id, type, created_at, raw_uri, raw_hash, mime_type, size_bytes,
               source_system, source_object_id, author, policy_scope_id
        FROM information_objects
        WHERE {" AND ".join(conditions)}
        ORDER BY created_at DESC
        LIMIT %s
    """

    with db() as conn:
        set_tenant(conn, x_tenant_id)
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

    items = [
        IOOut(
            io_id=row[0],
            tenant_id=row[1],
            type=row[2],
            created_at=row[3],
            raw={"raw_uri": row[4], "raw_hash": row[5], "mime_type": row[6], "size_bytes": row[7]},
            context={
                "source_system": row[8], "source_object_id": row[9],
                "author": row[10], "policy_scope_id": row[11],
            },
        )
        for row in rows
    ]
    return ListIOResponse(items=items)


@router.get("/v1/io/{io_id}", response_model=IOOut)
def get_io(io_id: str, x_tenant_id: str = Header(..., alias="X-Tenant-Id")):
    logger.info("get_io tenant=%s io_id=%s", x_tenant_id, io_id)
    with db() as conn:
        set_tenant(conn, x_tenant_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT io_id, tenant_id, type, created_at, raw_uri, raw_hash, mime_type, size_bytes,
                       source_system, source_object_id, author, policy_scope_id
                FROM information_objects
                WHERE io_id = %s AND is_deleted = false
                """,
                (io_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Not found")
    return IOOut(
        io_id=row[0],
        tenant_id=row[1],
        type=row[2],
        created_at=row[3],
        raw={"raw_uri": row[4], "raw_hash": row[5], "mime_type": row[6], "size_bytes": row[7]},
        context={
            "source_system": row[8], "source_object_id": row[9],
            "author": row[10], "policy_scope_id": row[11],
        },
    )
