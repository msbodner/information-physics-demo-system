"""MRO compaction (#11) — cluster near-duplicates into a canonical row.

Why:
  As ChatAIO is exercised, near-identical queries persist many MROs that
  retrieved overlapping HSL seed sets. Left alone the ranker's tsvector
  prior gets noisy and the trust-score signal is diluted across siblings.
  Compaction folds duplicates into a single canonical MRO so that:

    * the ranker sees ONE strong prior per topic instead of N weak ones,
    * trust_score accumulates (sum of cluster) rather than scattering,
    * matched_aios_count, seed_hsls, and search_terms become a UNION
      of the cluster — strictly more useful than any single member.

Clustering rule
---------------
Two MROs A, B are mergeable when BOTH:
    jaccard(seed_hsl_ids(A), seed_hsl_ids(B))           >= 0.85
    jaccard(query_tokens(A),  query_tokens(B))           >= 0.60

Single-link clustering: a chain A↔B↔C collapses to a single cluster
even when A↔C alone are below threshold. The CANONICAL row is the
member with the highest (confidence_tier, trust_score, created_at).

Merge semantics
---------------
For each cluster of size > 1:
    result_text          = canonical row's text (most recent / trusted)
    trust_score          = sum across cluster
    matched_aios_count   = max across cluster
    confidence           = best tier across cluster (verified > derived)
    seed_hsls            = union of comma-split tokens, sorted, dedup'd
    search_terms         = union of cue/exclusion lists per key

Non-canonical members are deleted (cascade NULLs from query_cache.mro_id
via the FK ``ON DELETE SET NULL`` set up in migration 020).

The whole pass is gated by ``dry_run`` so an operator can preview the
clusters before committing.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

from api.db import db, set_tenant

logger = logging.getLogger("infophysics.api.mro_compact")


_CONFIDENCE_RANK = {"verified": 3, "reviewed": 2, "derived": 1, "draft": 0}
_TOKEN_RE = re.compile(r"\b[\w]{3,}\b")
_STOPWORDS = {
    "the", "and", "for", "with", "from", "this", "that", "into", "what",
    "where", "when", "show", "list", "give", "find", "have", "are",
    "was", "were", "all", "any",
}


@dataclass
class _MroRow:
    mro_id: str
    query_text: str
    intent: Optional[str]
    seed_hsls: Optional[str]
    matched_aios_count: int
    search_terms: Any
    result_text: str
    confidence: str
    trust_score: float
    created_at: Any
    # derived
    seed_set: Set[str] = field(default_factory=set)
    query_tokens: Set[str] = field(default_factory=set)


def _seed_set(s: Optional[str]) -> Set[str]:
    if not s:
        return set()
    return {t.strip() for t in re.split(r"[,\s]+", s) if t.strip()}


def _query_tokens(s: Optional[str]) -> Set[str]:
    if not s:
        return set()
    return {t.lower() for t in _TOKEN_RE.findall(s) if t.lower() not in _STOPWORDS}


def _jaccard(a: Set[str], b: Set[str]) -> float:
    if not a and not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


def _load_rows(tenant: str) -> List[_MroRow]:
    rows: List[_MroRow] = []
    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT mro_id::text, query_text, intent, seed_hsls,
                       matched_aios_count, search_terms, result_text,
                       confidence, trust_score, created_at
                  FROM mro_objects
                 WHERE tenant_id = %s
                """,
                (tenant,),
            )
            for r in cur.fetchall():
                row = _MroRow(
                    mro_id=r[0], query_text=r[1] or "", intent=r[2],
                    seed_hsls=r[3], matched_aios_count=int(r[4] or 0),
                    search_terms=r[5], result_text=r[6] or "",
                    confidence=r[7] or "derived", trust_score=float(r[8] or 0),
                    created_at=r[9],
                )
                row.seed_set = _seed_set(row.seed_hsls)
                row.query_tokens = _query_tokens(row.query_text)
                rows.append(row)
    return rows


class _UnionFind:
    def __init__(self, n: int):
        self.p = list(range(n))

    def find(self, x: int) -> int:
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[ra] = rb


def _cluster(rows: List[_MroRow], hsl_thresh: float, query_thresh: float) -> List[List[int]]:
    n = len(rows)
    uf = _UnionFind(n)
    # O(n^2) — fine for tens of thousands; if it ever explodes we can
    # pre-bucket by any shared seed HSL token to skip empty pairs.
    for i in range(n):
        si = rows[i].seed_set
        if not si:
            continue
        qi = rows[i].query_tokens
        for j in range(i + 1, n):
            sj = rows[j].seed_set
            if not sj:
                continue
            if _jaccard(si, sj) < hsl_thresh:
                continue
            if _jaccard(qi, rows[j].query_tokens) < query_thresh:
                continue
            uf.union(i, j)
    buckets: Dict[int, List[int]] = {}
    for i in range(n):
        buckets.setdefault(uf.find(i), []).append(i)
    return [b for b in buckets.values() if len(b) > 1]


def _pick_canonical(cluster: List[_MroRow]) -> _MroRow:
    return max(
        cluster,
        key=lambda r: (
            _CONFIDENCE_RANK.get(r.confidence, 0),
            r.trust_score,
            r.created_at,
        ),
    )


def _merge_search_terms(cluster: List[_MroRow]) -> Optional[Dict[str, Any]]:
    merged: Dict[str, Any] = {}
    saw_any = False
    for r in cluster:
        st = r.search_terms
        if isinstance(st, str):
            try:
                st = json.loads(st)
            except Exception:
                st = None
        if not isinstance(st, dict):
            continue
        saw_any = True
        for k, v in st.items():
            if isinstance(v, list):
                cur = merged.setdefault(k, [])
                if isinstance(cur, list):
                    for item in v:
                        if item not in cur:
                            cur.append(item)
            elif k not in merged:
                merged[k] = v
    return merged if saw_any else None


def _merge_seed_hsls(cluster: List[_MroRow]) -> Optional[str]:
    union: Set[str] = set()
    for r in cluster:
        union |= r.seed_set
    if not union:
        return None
    return ",".join(sorted(union))


@dataclass
class CompactionPlan:
    canonical_id: str
    absorbed_ids: List[str]
    canonical_query: str
    cluster_size: int
    summed_trust: float
    union_seed_count: int


@dataclass
class CompactionReport:
    tenant: str
    total_mros: int
    clusters: int
    absorbed: int
    plans: List[CompactionPlan]
    applied: bool


def compact(
    tenant: str,
    hsl_thresh: float = 0.85,
    query_thresh: float = 0.60,
    dry_run: bool = True,
) -> CompactionReport:
    """Cluster + (optionally) merge near-duplicate MROs for a tenant."""
    rows = _load_rows(tenant)
    if len(rows) < 2:
        return CompactionReport(tenant, len(rows), 0, 0, [], applied=False)

    cluster_idx = _cluster(rows, hsl_thresh=hsl_thresh, query_thresh=query_thresh)
    plans: List[CompactionPlan] = []

    # Build the merge plan first so dry_run can show it without mutating.
    merges: List[Tuple[_MroRow, List[_MroRow], Optional[Dict[str, Any]], Optional[str], int, float, str]] = []
    for cluster in cluster_idx:
        members = [rows[i] for i in cluster]
        canonical = _pick_canonical(members)
        absorbed = [m for m in members if m.mro_id != canonical.mro_id]
        merged_terms = _merge_search_terms(members)
        merged_seeds = _merge_seed_hsls(members)
        max_aio = max(m.matched_aios_count for m in members)
        trust_sum = sum(m.trust_score for m in members)
        best_conf = max(
            (m.confidence for m in members),
            key=lambda c: _CONFIDENCE_RANK.get(c, 0),
        )
        plans.append(CompactionPlan(
            canonical_id=canonical.mro_id,
            absorbed_ids=[m.mro_id for m in absorbed],
            canonical_query=canonical.query_text,
            cluster_size=len(members),
            summed_trust=trust_sum,
            union_seed_count=len(canonical.seed_set | set().union(*(m.seed_set for m in absorbed))),
        ))
        merges.append((canonical, absorbed, merged_terms, merged_seeds, max_aio, trust_sum, best_conf))

    absorbed_total = sum(len(p.absorbed_ids) for p in plans)
    if dry_run or not merges:
        return CompactionReport(tenant, len(rows), len(plans), absorbed_total, plans, applied=False)

    # Apply.
    with db() as conn:
        set_tenant(conn, tenant)
        with conn.cursor() as cur:
            for canonical, absorbed, merged_terms, merged_seeds, max_aio, trust_sum, best_conf in merges:
                cur.execute(
                    """
                    UPDATE mro_objects
                       SET seed_hsls         = %s,
                           matched_aios_count = %s,
                           search_terms      = %s::jsonb,
                           confidence        = %s,
                           trust_score       = %s,
                           updated_at        = now()
                     WHERE mro_id = %s
                    """,
                    (
                        merged_seeds,
                        max_aio,
                        json.dumps(merged_terms) if merged_terms is not None else None,
                        best_conf,
                        trust_sum,
                        canonical.mro_id,
                    ),
                )
                if absorbed:
                    cur.execute(
                        "DELETE FROM mro_objects WHERE mro_id = ANY(%s::uuid[])",
                        ([m.mro_id for m in absorbed],),
                    )
        conn.commit()

    logger.info(
        "mro_compact tenant=%s clusters=%d absorbed=%d (applied)",
        tenant, len(plans), absorbed_total,
    )
    return CompactionReport(tenant, len(rows), len(plans), absorbed_total, plans, applied=True)


__all__ = ["compact", "CompactionReport", "CompactionPlan"]
