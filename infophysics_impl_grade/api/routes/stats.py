"""Chat search statistics (per-tenant telemetry for ChatAIO queries)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from api.db import db, set_tenant

logger = logging.getLogger("infophysics.api.stats")

router = APIRouter()


class ChatStatRequest(BaseModel):
    search_mode: str
    query_text: str
    result_preview: Optional[str] = None
    elapsed_ms: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    context_records: int = 0
    matched_hsls: int = 0
    matched_aios: int = 0
    cue_count: int = 0
    neighborhood_size: int = 0
    prior_count: int = 0
    mro_saved: bool = False


class ChatStatOut(BaseModel):
    stat_id: str
    tenant_id: str
    search_mode: str
    query_text: str
    result_preview: Optional[str]
    elapsed_ms: int
    input_tokens: int
    output_tokens: int
    total_tokens: int
    context_records: int
    matched_hsls: int
    matched_aios: int
    cue_count: int
    neighborhood_size: int
    prior_count: int
    mro_saved: bool
    created_at: str


@router.get("/v1/chat-stats", response_model=List[ChatStatOut])
def list_chat_stats(
    limit: int = Query(5000, ge=1, le=100000),
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    tenant = x_tenant_id or "tenantA"
    try:
        with db() as conn:
            set_tenant(conn, tenant)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT stat_id, tenant_id, search_mode, query_text, result_preview,
                           elapsed_ms, input_tokens, output_tokens, total_tokens,
                           context_records, matched_hsls, matched_aios,
                           cue_count, neighborhood_size, prior_count, mro_saved, created_at
                    FROM chat_search_stats
                    WHERE tenant_id = %s
                    ORDER BY created_at DESC
                    LIMIT %s
                    """,
                    (tenant, limit),
                )
                rows = cur.fetchall()
    except Exception:
        logger.warning("chat_search_stats table not ready yet — returning empty list")
        return []
    return [
        ChatStatOut(
            stat_id=str(r[0]), tenant_id=r[1], search_mode=r[2],
            query_text=r[3], result_preview=r[4],
            elapsed_ms=r[5] or 0, input_tokens=r[6] or 0,
            output_tokens=r[7] or 0, total_tokens=r[8] or 0,
            context_records=r[9] or 0, matched_hsls=r[10] or 0,
            matched_aios=r[11] or 0, cue_count=r[12] or 0,
            neighborhood_size=r[13] or 0, prior_count=r[14] or 0,
            mro_saved=bool(r[15]), created_at=str(r[16]),
        )
        for r in rows
    ]


@router.post("/v1/chat-stats", response_model=ChatStatOut, status_code=201)
def create_chat_stat(
    payload: ChatStatRequest,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    tenant = x_tenant_id or "tenantA"
    stat_id = str(uuid.uuid4())
    now = datetime.utcnow()
    try:
        with db() as conn:
            set_tenant(conn, tenant)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO chat_search_stats (
                        stat_id, tenant_id, search_mode, query_text, result_preview,
                        elapsed_ms, input_tokens, output_tokens, total_tokens,
                        context_records, matched_hsls, matched_aios,
                        cue_count, neighborhood_size, prior_count, mro_saved, created_at
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        stat_id, tenant, payload.search_mode, payload.query_text,
                        payload.result_preview, payload.elapsed_ms,
                        payload.input_tokens, payload.output_tokens, payload.total_tokens,
                        payload.context_records, payload.matched_hsls, payload.matched_aios,
                        payload.cue_count, payload.neighborhood_size, payload.prior_count,
                        payload.mro_saved, now,
                    ),
                )
    except Exception as exc:
        logger.exception("Failed to save chat stat")
        raise HTTPException(status_code=500, detail=str(exc))
    return ChatStatOut(
        stat_id=stat_id, tenant_id=tenant, search_mode=payload.search_mode,
        query_text=payload.query_text, result_preview=payload.result_preview,
        elapsed_ms=payload.elapsed_ms, input_tokens=payload.input_tokens,
        output_tokens=payload.output_tokens, total_tokens=payload.total_tokens,
        context_records=payload.context_records, matched_hsls=payload.matched_hsls,
        matched_aios=payload.matched_aios, cue_count=payload.cue_count,
        neighborhood_size=payload.neighborhood_size, prior_count=payload.prior_count,
        mro_saved=payload.mro_saved, created_at=str(now),
    )


@router.delete("/v1/chat-stats/{stat_id}")
def delete_chat_stat(stat_id: str):
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM chat_search_stats WHERE stat_id = %s RETURNING stat_id",
                (stat_id,),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Stat not found")
        conn.commit()
    return {"deleted": stat_id}
