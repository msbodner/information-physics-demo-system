"""MRO (Memory Result Object) routes — persisted retrieval episodes."""

from __future__ import annotations

import json
import logging
import math
import uuid
from datetime import datetime, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from api.db import db, set_tenant
from api import mro_compact as _mro_compact

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
    trust_score: float = 0.0
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


_MRO_SELECT = "mro_id, mro_key, query_text, intent, seed_hsls, matched_aios_count, search_terms, result_text, context_bundle, confidence, policy_scope, tenant_id, COALESCE(trust_score, 0)::float, created_at, updated_at"


def _mro_from_row(r):
    return MroObjectOut(
        mro_id=r[0], mro_key=r[1], query_text=r[2], intent=r[3], seed_hsls=r[4],
        matched_aios_count=r[5], search_terms=r[6], result_text=r[7], context_bundle=r[8],
        confidence=r[9], policy_scope=r[10], tenant_id=r[11], trust_score=float(r[12] or 0.0),
        created_at=r[13], updated_at=r[14],
    )


@router.get("/v1/mro-objects", response_model=List[MroObjectOut])
def list_mro_objects(
    limit: int = Query(200, ge=1, le=10000),
    summary: bool = Query(True, description="When true (default), omit heavy fields (result_text, context_bundle). Pass summary=false to get the full record."),
    fields: Optional[str] = Query(None, description="Alias for summary; set to 'summary' to use the lightweight projection"),
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    """List MROs ordered by recency.

    summary=true (or fields=summary) returns only the fields needed for
    prior ranking (cue_set / search_terms, confidence, created_at) and
    replaces ``result_text`` and ``context_bundle`` with empty strings
    — cuts payload size ~80% on corpora with long answers. Callers fetch
    the full record by id once they pick which priors to actually use.

    Default ``limit`` is 200: enough headroom for Jaccard ranking to
    pick the top-K priors without dragging down dialog-open latency on
    larger corpora. Pass an explicit limit when you need everything
    (e.g. the System Admin MRO browser).
    """
    tenant = x_tenant_id or "tenantA"
    # Accept either ?summary=true or ?fields=summary; the latter is the
    # canonical name suggested by the perf review and matches the way
    # other paginated APIs in this codebase project a sparse view.
    if fields is not None and fields.strip().lower() == "summary":
        summary = True
    if summary:
        # Lightweight projection: skip the two large free-text columns.
        cols = "mro_id, mro_key, query_text, intent, seed_hsls, matched_aios_count, search_terms, confidence, policy_scope, tenant_id, COALESCE(trust_score, 0)::float, created_at, updated_at"
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
                trust_score=float(r[10] or 0.0),
                created_at=r[11], updated_at=r[12],
            ))
        return out
    return [_mro_from_row(r) for r in rows]


@router.get("/v1/mro-objects-ranked", response_model=List[MroObjectOut])
def list_mro_objects_ranked(
    q: str = Query(..., description="Query text — used for tsvector text similarity"),
    limit: int = Query(50, ge=1, le=500),
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    """Rank MROs against a query using tsvector + trust_score.

    Returns the lightweight projection (no result_text / context_bundle)
    sorted by ``ts_rank(query_tsv, plainto_tsquery(q)) * (1 + log(1 + trust_score))``.
    Callers hydrate the chosen priors via /v1/mro-objects/{id}.

    Falls back to recency ordering when no rows score above zero — keeps
    the empty-corpus / cold-start case from returning nothing useful.
    """
    tenant = x_tenant_id or "tenantA"
    cols = "mro_id, mro_key, query_text, intent, seed_hsls, matched_aios_count, search_terms, confidence, policy_scope, tenant_id, COALESCE(trust_score, 0)::float, created_at, updated_at"
    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT {cols},
                       ts_rank(query_tsv, plainto_tsquery('english', %s)) AS rank
                  FROM mro_objects
                 WHERE query_tsv @@ plainto_tsquery('english', %s)
                 ORDER BY rank * (1 + ln(1 + COALESCE(trust_score, 0))) DESC,
                          updated_at DESC
                 LIMIT %s
                """,
                (q, q, limit),
            )
            rows = cur.fetchall()
            if not rows:
                cur.execute(
                    f"SELECT {cols} FROM mro_objects ORDER BY updated_at DESC LIMIT %s",
                    (limit,),
                )
                rows = cur.fetchall()
    out: List[MroObjectOut] = []
    for r in rows:
        out.append(MroObjectOut(
            mro_id=r[0], mro_key=r[1], query_text=r[2], intent=r[3], seed_hsls=r[4],
            matched_aios_count=r[5], search_terms=r[6],
            result_text="", context_bundle=None,
            confidence=r[7], policy_scope=r[8], tenant_id=r[9],
            trust_score=float(r[10] or 0.0),
            created_at=r[11], updated_at=r[12],
        ))
    return out


class TrustBumpRequest(BaseModel):
    parent_mro_ids: List[str]
    delta: float = 1.0


@router.post("/v1/mro-objects/bump-trust")
def bump_trust(
    payload: TrustBumpRequest,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    """Increment ``trust_score`` for a list of parent MROs.

    Called by the chat pipeline whenever a new MRO is saved that used the
    listed priors as context. Acts as a gradient-reinforcement signal —
    priors that get reused drift up the ranking; priors that never get
    reused stay flat. Idempotent failures are swallowed (a missing parent
    just gets skipped) so a partial-id list doesn't poison the save flow.
    """
    if not payload.parent_mro_ids:
        return {"updated": 0}
    tenant = x_tenant_id or "tenantA"
    delta = float(payload.delta or 0.0)
    if delta == 0.0:
        return {"updated": 0}
    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE mro_objects SET trust_score = COALESCE(trust_score, 0) + %s "
                "WHERE mro_id = ANY(%s::uuid[]) RETURNING mro_id",
                (delta, list(payload.parent_mro_ids)),
            )
            updated = len(cur.fetchall())
        conn.commit()
    return {"updated": updated}


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
        tenant_id=tenant, trust_score=0.0, created_at=now, updated_at=now,
    )


class UpdateMroObjectRequest(BaseModel):
    """Partial-update payload. Only fields explicitly set are written.

    Most fields are user-editable from the System Admin MRO browser.
    Provenance fields (``trust_score``, ``tenant_id``, ``created_at``)
    are intentionally NOT in the update surface — they're owned by the
    pipeline (trust bumps from chat) or by the row's identity.
    """
    mro_key: Optional[str] = None
    query_text: Optional[str] = None
    intent: Optional[str] = None
    seed_hsls: Optional[str] = None
    matched_aios_count: Optional[int] = None
    search_terms: Optional[Any] = None
    result_text: Optional[str] = None
    context_bundle: Optional[str] = None
    confidence: Optional[str] = None
    policy_scope: Optional[str] = None


@router.put("/v1/mro-objects/{mro_id}", response_model=MroObjectOut)
def update_mro_object(
    mro_id: str,
    payload: UpdateMroObjectRequest,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    """Partial update of an MRO. Returns the full updated row.

    Builds the SET clause dynamically from the fields the caller passed
    in — omitted fields are left untouched. ``updated_at`` is always
    refreshed; ``query_tsv`` regenerates automatically because it's a
    GENERATED STORED column off ``query_text``.
    """
    tenant = x_tenant_id or "tenantA"
    fields = payload.dict(exclude_unset=True)
    if not fields:
        # No-op update — just return the current row.
        return get_mro_object(mro_id, x_tenant_id=x_tenant_id)
    if "search_terms" in fields and fields["search_terms"] is not None:
        fields["search_terms"] = json.dumps(fields["search_terms"])
    set_clauses = []
    values: List[Any] = []
    for k, v in fields.items():
        if k == "search_terms":
            set_clauses.append(f"{k} = %s::jsonb")
        else:
            set_clauses.append(f"{k} = %s")
        values.append(v)
    set_clauses.append("updated_at = now()")
    values.append(mro_id)
    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE mro_objects SET {', '.join(set_clauses)} "
                f"WHERE mro_id = %s RETURNING {_MRO_SELECT}",
                values,
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="MRO object not found")
        conn.commit()
    return _mro_from_row(row)


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


@router.get("/v1/mro-objects/{mro_id}/hsls")
def list_mro_linked_hsls(
    mro_id: str,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    """Return every HSL that has a back-link pointing at this MRO.

    A successful Recall or Live Search creates an MRO and then writes
    `[MRO.<mro_id>]` into the `hsl_member` side table for every HSL that
    contributed to the answer. This endpoint inverts that lookup so an
    operator can verify the link landed for a given query, audit which
    HSLs were responsible for an MRO, and spot orphaned MROs whose
    link writes silently failed.

    Returns each HSL's id, name, member count from hsl_member, and the
    MRO's own `seed_hsls` field (pipe-separated UUIDs captured at MRO
    creation) so the UI can compare what the MRO claims it came from
    against what HSLs actually carry the back-pointer.
    """
    tenant = x_tenant_id or "tenantA"
    mro_ref = f"[MRO.{mro_id}]"
    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            # First confirm the MRO exists and pull its own seed_hsls.
            cur.execute(
                "SELECT mro_id, seed_hsls FROM mro_objects WHERE mro_id = %s",
                (mro_id,),
            )
            mro_row = cur.fetchone()
            if not mro_row:
                raise HTTPException(status_code=404, detail="MRO object not found")
            seed_hsls_field = mro_row[1] or ""

            # Linked HSLs via the side table (authoritative).
            cur.execute(
                """
                SELECT h.hsl_id, h.hsl_name, h.created_at, h.updated_at,
                       (SELECT COUNT(*) FROM hsl_member m2
                          WHERE m2.hsl_id = h.hsl_id) AS member_count
                  FROM hsl_member m
                  JOIN hsl_data h ON h.hsl_id = m.hsl_id
                 WHERE m.member_kind = 'mro'
                   AND m.member_value = %s
                   AND h.tenant_id = %s
              ORDER BY h.hsl_name
                """,
                (mro_ref, tenant),
            )
            linked = [
                {
                    "hsl_id": str(r[0]),
                    "hsl_name": r[1],
                    "created_at": r[2].isoformat() if r[2] else None,
                    "updated_at": r[3].isoformat() if r[3] else None,
                    "member_count": int(r[4] or 0),
                }
                for r in cur.fetchall()
            ]

    seed_ids = [s for s in seed_hsls_field.split("|") if s.strip()]
    linked_ids = {h["hsl_id"] for h in linked}
    seed_set = set(seed_ids)
    return {
        "mro_id": mro_id,
        "mro_ref": mro_ref,
        "seed_hsl_ids": seed_ids,
        "seed_count": len(seed_ids),
        "linked_count": len(linked),
        "linked_hsls": linked,
        "seed_minus_linked": [s for s in seed_ids if s not in linked_ids],
        "linked_minus_seed": [h["hsl_id"] for h in linked if h["hsl_id"] not in seed_set],
    }


# ---------------------------------------------------------------------------
# #11 MRO compaction (admin)
# ---------------------------------------------------------------------------

class MroCompactPlan(BaseModel):
    canonical_id: str
    absorbed_ids: List[str]
    canonical_query: str
    cluster_size: int
    summed_trust: float
    union_seed_count: int


class MroCompactResponse(BaseModel):
    tenant: str
    total_mros: int
    clusters: int
    absorbed: int
    applied: bool
    plans: List[MroCompactPlan]


@router.post("/v1/op/mro-compact", response_model=MroCompactResponse)
def mro_compact_endpoint(
    dry_run: bool = Query(True, description="When true, only return the cluster plan; do not mutate."),
    hsl_threshold: float = Query(0.85, ge=0.0, le=1.0),
    query_threshold: float = Query(0.60, ge=0.0, le=1.0),
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    """Cluster near-duplicate MROs and (optionally) merge them.

    Defaults are conservative — high HSL overlap (≥85%) AND meaningful
    query overlap (≥60%) — so a single dry-run pass on a healthy tenant
    typically reports zero clusters. Operators raise the rate by
    lowering thresholds or running the merge after they've reviewed the
    plan.
    """
    tenant = x_tenant_id or "tenantA"
    report = _mro_compact.compact(
        tenant=tenant,
        hsl_thresh=hsl_threshold,
        query_thresh=query_threshold,
        dry_run=dry_run,
    )
    return MroCompactResponse(
        tenant=report.tenant,
        total_mros=report.total_mros,
        clusters=report.clusters,
        absorbed=report.absorbed,
        applied=report.applied,
        plans=[MroCompactPlan(
            canonical_id=p.canonical_id,
            absorbed_ids=p.absorbed_ids,
            canonical_query=p.canonical_query,
            cluster_size=p.cluster_size,
            summed_trust=p.summed_trust,
            union_seed_count=p.union_seed_count,
        ) for p in report.plans],
    )


# ---------------------------------------------------------------------------
# V4.4 — MRO-assisted retrieval (first slice of MRO-as-prior pipeline)
#
# /v1/op/mro-search powers three behaviors in the Substrate chat pipeline:
#
#   1. Cache short-circuit. When the top hit's combined similarity score
#      crosses ~0.85 AND its lineage AIOs/HSLs still resolve in the corpus,
#      the caller may serve the prior result_text without ever calling
#      Claude.
#
#   2. Cue seeding. The top-K hits' ``search_terms`` are unioned into the
#      cue set extracted from the new query — converts "guess from value
#      vocabulary" into "what cues did similar past queries actually need".
#
#   3. Bundle augmentation. The top-1 hit's ``result_summary`` (first
#      ~500 chars) is appended to the substrate bundle as a prior episode
#      — pulls Claude toward consistent answers across sessions.
#
# Combines two signals so paraphrases score above zero even when their
# tokens don't overlap exactly:
#   * ``similarity(query_text, q)`` — pg_trgm trigram similarity (lexical).
#   * ``ts_rank(query_tsv, plainto_tsquery(q))`` — tsvector relevance.
# Final ordering is GREATEST(both) * (1 + ln(1 + trust_score)) so MROs
# that have been useful before drift up.
# ---------------------------------------------------------------------------


class MroSearchHit(BaseModel):
    mro_id: str
    mro_key: str
    query_text: str
    similarity: float           # trigram similarity (0..1)
    ts_rank: float              # tsvector rank (0..~1, typically <0.5)
    score: float                # GREATEST(similarity, ts_rank) — primary signal
    trust_weighted_score: float # score * (1 + ln(1 + trust_score)) — final ranking
    search_terms: Optional[Any] = None
    seed_hsls: Optional[str] = None  # pipe-separated lineage hint (HSL/AIO names)
    result_summary: str         # first ~500 chars of result_text
    result_full_available: bool # true when result_text was non-empty (i.e. hydratable)
    confidence: str
    trust_score: float
    created_at: datetime


class MroSearchResponse(BaseModel):
    query: str
    k: int
    matches: List[MroSearchHit]


@router.get("/v1/op/mro-search", response_model=MroSearchResponse)
def mro_search(
    query: str = Query(..., min_length=1, description="Natural-language query to match against prior MROs"),
    k: int = Query(5, ge=1, le=50, description="Maximum hits to return"),
    min_score: float = Query(0.10, ge=0.0, le=1.0, description="Floor on GREATEST(similarity, ts_rank). Hits below this are dropped."),
    summary_chars: int = Query(500, ge=0, le=4000, description="Truncate result_text to this many characters in result_summary."),
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    """Fast similarity search over prior MROs for the substrate pipeline.

    Combines pg_trgm trigram similarity with tsvector ts_rank so both
    surface-form matches and paraphrases score. Returns a lightweight
    projection — full ``result_text`` is truncated to ``summary_chars``.
    Callers that need the full episode hydrate via /v1/mro-objects/{id}.
    """
    tenant = x_tenant_id or "tenantA"

    # Empty / whitespace-only queries: short-circuit. Trigram and tsquery
    # both behave oddly on empty strings.
    q = query.strip()
    if not q:
        return MroSearchResponse(query=query, k=k, matches=[])

    sql = """
        SELECT
            mro_id::text,
            mro_key,
            query_text,
            search_terms,
            seed_hsls,
            result_text,
            confidence,
            COALESCE(trust_score, 0)::float AS trust_score,
            created_at,
            similarity(query_text, %s) AS sim,
            COALESCE(ts_rank(query_tsv, plainto_tsquery('english', %s)), 0) AS tsr
          FROM mro_objects
         WHERE
            similarity(query_text, %s) >= %s
            OR query_tsv @@ plainto_tsquery('english', %s)
         ORDER BY
            GREATEST(
                similarity(query_text, %s),
                COALESCE(ts_rank(query_tsv, plainto_tsquery('english', %s)), 0)
            ) * (1 + ln(1 + COALESCE(trust_score, 0))) DESC,
            updated_at DESC
         LIMIT %s
    """
    params = (q, q, q, float(min_score), q, q, q, int(k))

    matches: List[MroSearchHit] = []
    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

    for r in rows:
        (mro_id, mro_key, query_text, search_terms, seed_hsls,
         result_text, confidence, trust_score, created_at,
         sim, tsr) = r
        sim_f = float(sim or 0.0)
        tsr_f = float(tsr or 0.0)
        score = max(sim_f, tsr_f)
        twscore = score * (1.0 + (math.log1p(trust_score) if trust_score and trust_score > 0 else 0.0))
        full = result_text or ""
        summary = full[:summary_chars] if summary_chars > 0 else ""
        matches.append(MroSearchHit(
            mro_id=str(mro_id),
            mro_key=mro_key,
            query_text=query_text,
            similarity=round(sim_f, 4),
            ts_rank=round(tsr_f, 4),
            score=round(score, 4),
            trust_weighted_score=round(twscore, 4),
            search_terms=search_terms,
            seed_hsls=seed_hsls,
            result_summary=summary,
            result_full_available=bool(full),
            confidence=confidence or "derived",
            trust_score=float(trust_score or 0.0),
            created_at=created_at,
        ))

    return MroSearchResponse(query=query, k=k, matches=matches)
