"""MRO (Memory Result Object) routes — persisted retrieval episodes."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from api.db import db, set_tenant

logger = logging.getLogger("infophysics.api.mro")

router = APIRouter()


class MroObjectOut(BaseModel):
    mro_id: uuid.UUID
    mro_key: str
    query_text: str
    intent: Optional[str] = None
    seed_hsls: Optional[str] = None
    matched_aios_count: int = 0
    search_terms: Optional[Any] = None
    result_text: str
    context_bundle: Optional[str] = None
    confidence: str = "derived"
    policy_scope: str = "tenantA"
    tenant_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class CreateMroObjectRequest(BaseModel):
    mro_key: str
    query_text: str
    intent: Optional[str] = None
    seed_hsls: Optional[str] = None
    matched_aios_count: int = 0
    search_terms: Optional[Any] = None
    result_text: str
    context_bundle: Optional[str] = None
    confidence: str = "derived"
    policy_scope: str = "tenantA"


_MRO_SELECT = "mro_id, mro_key, query_text, intent, seed_hsls, matched_aios_count, search_terms, result_text, context_bundle, confidence, policy_scope, tenant_id, created_at, updated_at"


def _mro_from_row(r):
    return MroObjectOut(
        mro_id=r[0], mro_key=r[1], query_text=r[2], intent=r[3], seed_hsls=r[4],
        matched_aios_count=r[5], search_terms=r[6], result_text=r[7], context_bundle=r[8],
        confidence=r[9], policy_scope=r[10], tenant_id=r[11], created_at=r[12], updated_at=r[13],
    )


@router.get("/v1/mro-objects", response_model=List[MroObjectOut])
def list_mro_objects(
    limit: int = Query(5000, ge=1, le=100000),
    summary: bool = Query(False, description="When true, omit heavy fields (result_text, context_bundle)"),
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    """List MROs ordered by recency.

    summary=true returns only the fields needed for prior ranking
    (cue_set / search_terms, confidence, created_at) and replaces
    ``result_text`` and ``context_bundle`` with empty strings — cuts
    payload size ~80% on corpora with long answers. Callers fetch the
    full record by id once they pick which priors to actually use.
    """
    tenant = x_tenant_id or "tenantA"
    if summary:
        # Lightweight projection: skip the two large free-text columns.
        cols = "mro_id, mro_key, query_text, intent, seed_hsls, matched_aios_count, search_terms, confidence, policy_scope, tenant_id, created_at, updated_at"
    else:
        cols = _MRO_SELECT
    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT {cols} FROM mro_objects ORDER BY updated_at DESC LIMIT %s",
                (limit,),
            )
            rows = cur.fetchall()
    if summary:
        out: List[MroObjectOut] = []
        for r in rows:
            out.append(MroObjectOut(
                mro_id=r[0], mro_key=r[1], query_text=r[2], intent=r[3], seed_hsls=r[4],
                matched_aios_count=r[5], search_terms=r[6],
                result_text="", context_bundle=None,
                confidence=r[7], policy_scope=r[8], tenant_id=r[9],
                created_at=r[10], updated_at=r[11],
            ))
        return out
    return [_mro_from_row(r) for r in rows]


@router.get("/v1/mro-objects/{mro_id}", response_model=MroObjectOut)
def get_mro_object(
    mro_id: str,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    """Fetch a single MRO with all heavy fields populated."""
    tenant = x_tenant_id or "tenantA"
    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT {_MRO_SELECT} FROM mro_objects WHERE mro_id = %s",
                (mro_id,),
            )
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="MRO object not found")
    return _mro_from_row(row)


@router.post("/v1/mro-objects", response_model=MroObjectOut, status_code=201)
def create_mro_object(
    payload: CreateMroObjectRequest,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    if not payload.mro_key.strip():
        raise HTTPException(status_code=400, detail="mro_key is required")
    if not payload.query_text.strip():
        raise HTTPException(status_code=400, detail="query_text is required")
    if not payload.result_text.strip():
        raise HTTPException(status_code=400, detail="result_text is required")
    tenant = x_tenant_id or "tenantA"
    mro_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    search_terms_json = json.dumps(payload.search_terms) if payload.search_terms is not None else None
    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO mro_objects (mro_id, mro_key, query_text, intent, seed_hsls, matched_aios_count, search_terms, result_text, context_bundle, confidence, policy_scope, tenant_id, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (str(mro_id), payload.mro_key.strip(), payload.query_text.strip(), payload.intent, payload.seed_hsls,
                 payload.matched_aios_count, search_terms_json, payload.result_text.strip(), payload.context_bundle,
                 payload.confidence, payload.policy_scope, tenant, now, now),
            )
        conn.commit()
    return MroObjectOut(
        mro_id=mro_id, mro_key=payload.mro_key.strip(), query_text=payload.query_text.strip(),
        intent=payload.intent, seed_hsls=payload.seed_hsls, matched_aios_count=payload.matched_aios_count,
        search_terms=payload.search_terms, result_text=payload.result_text.strip(),
        context_bundle=payload.context_bundle, confidence=payload.confidence, policy_scope=payload.policy_scope,
        tenant_id=tenant, created_at=now, updated_at=now,
    )


@router.delete("/v1/mro-objects/{mro_id}")
def delete_mro_object(
    mro_id: str,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    tenant = x_tenant_id or "tenantA"
    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            cur.execute("DELETE FROM mro_objects WHERE mro_id = %s RETURNING mro_id", (mro_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="MRO object not found")
        conn.commit()
    return {"deleted": mro_id}
