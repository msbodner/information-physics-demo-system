"""Per-query AIO Search quality + timing logger.

Pure observability: writes one row per AIO Search invocation to the
``aio_search_quality`` table (migration 024). Gated by env flag
``AIO_SEARCH_LOG_QUALITY=1`` — defaults OFF so this is a no-op for
deployments that don't opt in.

All writes are best-effort. Any DB error (missing migration, RLS
quirk, transient connection drop) is swallowed and logged at INFO so
the hot path never fails because of telemetry.

Public API:
  - is_enabled() — env-gate check, used at the call site to avoid
    constructing the payload when logging is off.
  - log(...)     — fire-and-forget write; returns None.
"""

from __future__ import annotations

import hashlib
import logging
import os
from typing import Optional

from api.db import db, set_tenant
from api.query_cache import normalize as _normalize_query

logger = logging.getLogger("infophysics.api.search_quality")


def is_enabled() -> bool:
    """True when AIO_SEARCH_LOG_QUALITY env flag is on.

    Read fresh on each call so operators can flip the flag without a
    restart (the env-driven cap helpers in chat.py follow the same
    pattern).
    """
    return os.environ.get("AIO_SEARCH_LOG_QUALITY", "").strip() in ("1", "true", "yes")


def _hash(tenant: str, mode: str, normalized: str) -> str:
    h = hashlib.sha256()
    h.update(tenant.encode("utf-8"))
    h.update(b"|")
    h.update(mode.encode("utf-8"))
    h.update(b"|")
    h.update(normalized.encode("utf-8"))
    return h.hexdigest()


def log(
    *,
    tenant: str,
    mode: str,
    query_text: str,
    num_cues: int,
    hsls_matched: int,
    aios_matched: int,
    aios_shipped: int,
    parse_ms: int,
    retrieval_ms: int,
    llm_ms: int,
    total_ms: int,
    served_from_cache: bool = False,
    parse_cache_hit: bool = False,
    sources_cited: Optional[int] = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
) -> None:
    """Best-effort write of a quality row. No-op when env flag is off.

    Caller is expected to have measured timings via ``time.perf_counter``
    around each phase. ``sources_cited`` may be None when called from
    the streaming path (citations are computed only on the JSON path).
    """
    if not is_enabled():
        return
    if not query_text:
        return

    norm = _normalize_query(query_text)
    qhash = _hash(tenant, mode, norm)
    density = (aios_matched / num_cues) if num_cues > 0 else None

    try:
        with db() as conn:
            set_tenant(conn, tenant)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO aio_search_quality
                      (tenant_id, mode, query_text, query_hash,
                       num_cues, hsls_matched, aios_matched, aios_shipped,
                       sources_cited, density_per_cue,
                       parse_ms, retrieval_ms, llm_ms, total_ms,
                       served_from_cache, parse_cache_hit,
                       input_tokens, output_tokens)
                    VALUES
                      (%s, %s, %s, %s,
                       %s, %s, %s, %s,
                       %s, %s,
                       %s, %s, %s, %s,
                       %s, %s,
                       %s, %s)
                    """,
                    (
                        tenant, mode, query_text, qhash,
                        num_cues, hsls_matched, aios_matched, aios_shipped,
                        sources_cited, density,
                        parse_ms, retrieval_ms, llm_ms, total_ms,
                        served_from_cache, parse_cache_hit,
                        input_tokens, output_tokens,
                    ),
                )
            conn.commit()
    except Exception:
        logger.info("aio_search_quality log failed (table may be absent)", exc_info=True)
