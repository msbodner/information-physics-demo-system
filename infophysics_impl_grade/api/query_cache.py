"""(mode, normalized_query, tenant) → MRO/answer micro-cache.

Skips the LLM round-trip on exact repeat queries. The hash is the SHA-256
of the lower-cased, whitespace-collapsed query plus the mode + tenant —
deliberately exact-match-only. Paraphrase resolution lives in the alias /
tsvector / embedding layers; this layer is the *cheapest* short-circuit.

Public API:
  - normalize(text) — stable form used both for hashing and for storage
  - lookup(tenant, mode, query) → optional CacheHit
  - store(tenant, mode, query, answer, mro_id) — best-effort write
  - invalidate(tenant, mode=None) — admin-side clear (unused today)
"""

from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass
from typing import Optional

from api.db import db, set_tenant

logger = logging.getLogger("infophysics.api.query_cache")


def normalize(text: str) -> str:
    """Lower-case, strip, collapse whitespace, drop trailing punctuation."""
    if not text:
        return ""
    s = text.strip().lower()
    s = re.sub(r"\s+", " ", s)
    s = s.rstrip(".?!")
    return s


def _hash(tenant: str, mode: str, normalized: str) -> str:
    h = hashlib.sha256()
    h.update(tenant.encode("utf-8"))
    h.update(b"|")
    h.update(mode.encode("utf-8"))
    h.update(b"|")
    h.update(normalized.encode("utf-8"))
    return h.hexdigest()


@dataclass
class CacheHit:
    answer_text: str
    mro_id: Optional[str]
    cache_id: str
    hit_count: int


def lookup(tenant: str, mode: str, query: str) -> Optional[CacheHit]:
    """Return the cached entry for this query, or None.

    Side-effect on hit: increments ``hit_count`` and updates
    ``last_hit_at`` so the GC sweep can prefer cold rows.
    Best-effort — any DB error returns None and the caller proceeds with
    the full retrieval pipeline.
    """
    norm = normalize(query)
    if not norm:
        return None
    qhash = _hash(tenant, mode, norm)
    try:
        with db() as conn:
            set_tenant(conn, tenant)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE query_cache
                       SET hit_count = hit_count + 1,
                           last_hit_at = now()
                     WHERE tenant_id = %s
                       AND mode = %s
                       AND query_hash = %s
                       AND expires_at > now()
                     RETURNING cache_id::text, answer_text, mro_id::text, hit_count
                    """,
                    (tenant, mode, qhash),
                )
                row = cur.fetchone()
            conn.commit()
        if row:
            return CacheHit(
                cache_id=row[0],
                answer_text=row[1],
                mro_id=row[2],
                hit_count=int(row[3] or 0),
            )
    except Exception:
        logger.info("query_cache lookup failed (table may be absent)", exc_info=True)
    return None


def store(
    tenant: str,
    mode: str,
    query: str,
    answer_text: str,
    mro_id: Optional[str] = None,
    ttl_hours: int = 24,
) -> None:
    """Write-or-refresh a cache entry. Silent on any failure."""
    norm = normalize(query)
    if not norm or not answer_text:
        return
    qhash = _hash(tenant, mode, norm)
    try:
        with db() as conn:
            set_tenant(conn, tenant)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO query_cache
                      (tenant_id, mode, query_hash, normalized_query,
                       answer_text, mro_id, expires_at)
                    VALUES
                      (%s, %s, %s, %s, %s, %s, now() + (%s || ' hours')::interval)
                    ON CONFLICT (tenant_id, mode, query_hash)
                    DO UPDATE SET
                      answer_text = EXCLUDED.answer_text,
                      mro_id      = COALESCE(EXCLUDED.mro_id, query_cache.mro_id),
                      expires_at  = EXCLUDED.expires_at,
                      last_hit_at = now()
                    """,
                    (tenant, mode, qhash, norm, answer_text, mro_id, str(ttl_hours)),
                )
            conn.commit()
    except Exception:
        logger.info("query_cache store failed", exc_info=True)


def invalidate(tenant: str, mode: Optional[str] = None) -> int:
    """Drop all cached entries for a tenant (optionally scoped to one mode).

    Returns the number of rows deleted, or 0 on failure.
    """
    try:
        with db() as conn:
            set_tenant(conn, tenant)
            with conn.cursor() as cur:
                if mode:
                    cur.execute(
                        "DELETE FROM query_cache WHERE tenant_id = %s AND mode = %s",
                        (tenant, mode),
                    )
                else:
                    cur.execute(
                        "DELETE FROM query_cache WHERE tenant_id = %s",
                        (tenant,),
                    )
                deleted = cur.rowcount or 0
            conn.commit()
        return int(deleted)
    except Exception:
        logger.info("query_cache invalidate failed", exc_info=True)
        return 0
