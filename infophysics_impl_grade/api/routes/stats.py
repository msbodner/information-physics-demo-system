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


@router.get("/v1/chat-stats/{stat_id}/mro")
def get_stat_mro(stat_id: str, x_tenant_id: Optional[str] = Header(default="tenantA")):
    """Resolve the MRO that was saved for a given chat-stats row.

    Stats rows do not carry an explicit FK to mro_objects (the table only
    records ``mro_saved`` boolean), so we look up the MRO by matching
    tenant + query_text and choosing the row whose created_at is closest
    to the stat's timestamp. Returns the full MRO record or 404.
    """
    tenant = x_tenant_id or "tenantA"
    with db() as conn:
        with conn.cursor() as cur:
            set_tenant(conn, tenant)
            cur.execute(
                "SELECT query_text, created_at, mro_saved FROM chat_search_stats "
                "WHERE stat_id = %s AND tenant_id = %s",
                (stat_id, tenant),
            )
            stat = cur.fetchone()
            if not stat:
                raise HTTPException(status_code=404, detail="stat not found")
            query_text, stat_created, mro_saved = stat
            if not mro_saved:
                raise HTTPException(status_code=404, detail="no MRO was saved for this stat")
            # Strategy: match by tenant and nearest timestamp.
            # The MRO's query_text may be normalized/cleaned vs the raw stat
            # query_text, so we don't require exact equality. We do a tiered
            # lookup: (1) exact query_text match nearest-in-time; (2) trimmed
            # case-insensitive match nearest-in-time; (3) any MRO within
            # +/- 5 minutes of the stat (typical save latency is < 1 s).
            r = None
            for sql in (
                """
                SELECT mro_id, mro_key, query_text, intent, seed_hsls,
                       matched_aios_count, search_terms, result_text,
                       confidence, COALESCE(trust_score, 0)::float,
                       context_bundle, policy_scope,
                       created_at, updated_at
                FROM mro_objects
                WHERE tenant_id = %s AND query_text = %s
                ORDER BY ABS(EXTRACT(EPOCH FROM (created_at - %s))) ASC
                LIMIT 1
                """,
                """
                SELECT mro_id, mro_key, query_text, intent, seed_hsls,
                       matched_aios_count, search_terms, result_text,
                       confidence, COALESCE(trust_score, 0)::float,
                       context_bundle, policy_scope,
                       created_at, updated_at
                FROM mro_objects
                WHERE tenant_id = %s AND LOWER(TRIM(query_text)) = LOWER(TRIM(%s))
                ORDER BY ABS(EXTRACT(EPOCH FROM (created_at - %s))) ASC
                LIMIT 1
                """,
                """
                SELECT mro_id, mro_key, query_text, intent, seed_hsls,
                       matched_aios_count, search_terms, result_text,
                       confidence, COALESCE(trust_score, 0)::float,
                       context_bundle, policy_scope,
                       created_at, updated_at
                FROM mro_objects
                WHERE tenant_id = %s
                  AND ABS(EXTRACT(EPOCH FROM (created_at - %s))) <= 300
                ORDER BY ABS(EXTRACT(EPOCH FROM (created_at - %s))) ASC
                LIMIT 1
                """,
            ):
                if "ABS(EXTRACT(EPOCH FROM (created_at - %s))) <= 300" in sql:
                    cur.execute(sql, (tenant, stat_created, stat_created))
                else:
                    cur.execute(sql, (tenant, query_text, stat_created))
                r = cur.fetchone()
                if r:
                    break
            if not r:
                raise HTTPException(status_code=404, detail="MRO not found for this stat")
            return {
                "mro_id": str(r[0]),
                "mro_key": r[1],
                "query_text": r[2],
                "intent": r[3],
                "seed_hsls": r[4],
                "matched_aios_count": r[5],
                "search_terms": r[6],
                "result_text": r[7],
                "confidence": r[8],
                "trust_score": float(r[9]) if r[9] is not None else None,
                "context_bundle": r[10],
                "policy_scope": r[11],
                "parent_mro_ids": None,
                "model_used": None,
                "derivation_method": None,
                "created_at": str(r[12]),
                "updated_at": str(r[13]) if r[13] else None,
            }


# ── AIO Search quality readback (P14) ───────────────────────────────
#
# Reads from the per-query log written by api/search_quality.py
# (migration 024). Returns aggregate timings + retrieval shape so the
# next round of perf changes can be evaluated against real numbers
# instead of gut feel. Tenant-scoped via RLS; returns zeros when the
# table is empty or the migration hasn't run.

@router.get("/v1/aio-search/stats")
def aio_search_stats(
    since_hours: int = Query(24, ge=1, le=24 * 30,
                             description="Look back N hours (default 24, max 720)"),
    mode: Optional[str] = Query(None,
                                description="Filter by mode: 'aio-search' or 'aio-search-stream'"),
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    """Aggregate AIO Search quality + timing stats over a time window.

    Source: ``aio_search_quality`` table (migration 024), populated when
    ``AIO_SEARCH_LOG_QUALITY=1`` is set on the API. Returns p50/p95/p99
    of each timing phase, cache hit rates, and retrieval-shape averages.
    """
    tenant = x_tenant_id or "tenantA"

    where = ["tenant_id = %s",
             "created_at >= now() - (%s || ' hours')::interval"]
    params: list = [tenant, str(since_hours)]
    if mode:
        where.append("mode = %s")
        params.append(mode)
    where_sql = " AND ".join(where)

    empty = {
        "window_hours": since_hours,
        "tenant_id": tenant,
        "mode_filter": mode,
        "total_queries": 0,
        "answer_cache_hit_rate": 0.0,
        "parse_cache_hit_rate": 0.0,
        "timings_ms": {
            "parse":     {"p50": 0, "p95": 0, "p99": 0, "avg": 0},
            "retrieval": {"p50": 0, "p95": 0, "p99": 0, "avg": 0},
            "llm":       {"p50": 0, "p95": 0, "p99": 0, "avg": 0},
            "total":     {"p50": 0, "p95": 0, "p99": 0, "avg": 0},
        },
        "retrieval_shape_avg": {
            "num_cues": 0.0, "hsls_matched": 0.0,
            "aios_matched": 0.0, "aios_shipped": 0.0,
            "sources_cited": 0.0, "density_per_cue": 0.0,
        },
        "tokens_avg": {"input": 0.0, "output": 0.0},
        "by_mode": [],
    }

    try:
        with db() as conn:
            set_tenant(conn, tenant)
            with conn.cursor() as cur:
                # Aggregate over the window. percentile_cont handles small
                # samples gracefully (returns the only value).
                cur.execute(
                    f"""
                    SELECT
                      COUNT(*)::int                                  AS total,
                      AVG(CASE WHEN served_from_cache THEN 1.0 ELSE 0.0 END)::float,
                      AVG(CASE WHEN parse_cache_hit   THEN 1.0 ELSE 0.0 END)::float,

                      percentile_cont(0.50) WITHIN GROUP (ORDER BY parse_ms),
                      percentile_cont(0.95) WITHIN GROUP (ORDER BY parse_ms),
                      percentile_cont(0.99) WITHIN GROUP (ORDER BY parse_ms),
                      AVG(parse_ms)::float,

                      percentile_cont(0.50) WITHIN GROUP (ORDER BY retrieval_ms),
                      percentile_cont(0.95) WITHIN GROUP (ORDER BY retrieval_ms),
                      percentile_cont(0.99) WITHIN GROUP (ORDER BY retrieval_ms),
                      AVG(retrieval_ms)::float,

                      percentile_cont(0.50) WITHIN GROUP (ORDER BY llm_ms),
                      percentile_cont(0.95) WITHIN GROUP (ORDER BY llm_ms),
                      percentile_cont(0.99) WITHIN GROUP (ORDER BY llm_ms),
                      AVG(llm_ms)::float,

                      percentile_cont(0.50) WITHIN GROUP (ORDER BY total_ms),
                      percentile_cont(0.95) WITHIN GROUP (ORDER BY total_ms),
                      percentile_cont(0.99) WITHIN GROUP (ORDER BY total_ms),
                      AVG(total_ms)::float,

                      AVG(num_cues)::float,
                      AVG(hsls_matched)::float,
                      AVG(aios_matched)::float,
                      AVG(aios_shipped)::float,
                      AVG(sources_cited)::float,
                      AVG(density_per_cue)::float,

                      AVG(input_tokens)::float,
                      AVG(output_tokens)::float
                    FROM aio_search_quality
                    WHERE {where_sql}
                    """,
                    params,
                )
                row = cur.fetchone()
                if not row or not row[0]:
                    return empty

                # Per-mode breakdown so dashboards can compare JSON vs stream.
                cur.execute(
                    f"""
                    SELECT mode,
                           COUNT(*)::int,
                           AVG(total_ms)::float,
                           percentile_cont(0.95) WITHIN GROUP (ORDER BY total_ms),
                           AVG(CASE WHEN served_from_cache THEN 1.0 ELSE 0.0 END)::float
                    FROM aio_search_quality
                    WHERE {where_sql}
                    GROUP BY mode
                    ORDER BY mode
                    """,
                    params,
                )
                by_mode_rows = cur.fetchall()
    except Exception:
        logger.info("aio_search_quality not ready — returning empty stats", exc_info=True)
        return empty

    def _i(v):  # nullable -> int
        return int(v) if v is not None else 0

    def _f(v):  # nullable -> float
        return float(v) if v is not None else 0.0

    return {
        "window_hours": since_hours,
        "tenant_id": tenant,
        "mode_filter": mode,
        "total_queries": _i(row[0]),
        "answer_cache_hit_rate": round(_f(row[1]), 4),
        "parse_cache_hit_rate":  round(_f(row[2]), 4),
        "timings_ms": {
            "parse":     {"p50": _i(row[3]),  "p95": _i(row[4]),  "p99": _i(row[5]),  "avg": _i(row[6])},
            "retrieval": {"p50": _i(row[7]),  "p95": _i(row[8]),  "p99": _i(row[9]),  "avg": _i(row[10])},
            "llm":       {"p50": _i(row[11]), "p95": _i(row[12]), "p99": _i(row[13]), "avg": _i(row[14])},
            "total":     {"p50": _i(row[15]), "p95": _i(row[16]), "p99": _i(row[17]), "avg": _i(row[18])},
        },
        "retrieval_shape_avg": {
            "num_cues":        round(_f(row[19]), 2),
            "hsls_matched":    round(_f(row[20]), 2),
            "aios_matched":    round(_f(row[21]), 2),
            "aios_shipped":    round(_f(row[22]), 2),
            "sources_cited":   round(_f(row[23]), 2),
            "density_per_cue": round(_f(row[24]), 2),
        },
        "tokens_avg": {
            "input":  round(_f(row[25]), 1),
            "output": round(_f(row[26]), 1),
        },
        "by_mode": [
            {
                "mode": r[0],
                "count": _i(r[1]),
                "total_ms_avg": _i(r[2]),
                "total_ms_p95": _i(r[3]),
                "answer_cache_hit_rate": round(_f(r[4]), 4),
            }
            for r in by_mode_rows
        ],
    }


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
