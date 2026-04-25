"""Pluggable embedding-provider module for the Phase 3 re-rank.

The chat pipeline calls ``embed_query()`` once per request and
``cosine_rerank()`` to fold vector similarity into the lexical ordering.
Both calls are no-ops when no provider is configured — the rest of the
pipeline keeps working unchanged. This is intentional: embeddings are a
quality dial, not a hard dependency.

Provider selection
------------------
Currently supports Voyage AI (Anthropic's recommended embedding partner)
gated by the ``VOYAGE_API_KEY`` environment variable. Default model is
``voyage-3.5-lite`` (1024-dim, fast, cheap) which is plenty for re-rank
over the small (~AIO_CAP) candidate set.

Add new providers by extending ``_PROVIDERS`` — each provider just has
to expose ``embed(texts: list[str]) -> list[list[float]]`` and a
``model_ref: str`` so the persisted vector knows which model produced it.
"""

from __future__ import annotations

import logging
import math
import os
from dataclasses import dataclass
from typing import List, Optional, Sequence

import httpx

logger = logging.getLogger("infophysics.api.embeddings")


# ── Provider protocol ──────────────────────────────────────────────────


@dataclass
class EmbeddingResult:
    model_ref: str
    vectors: List[List[float]]


class _VoyageProvider:
    """Voyage AI embeddings via REST. Lazy-init; no client when key absent."""

    BASE_URL = "https://api.voyageai.com/v1/embeddings"

    def __init__(self, api_key: str, model: str = "voyage-3.5-lite") -> None:
        self.api_key = api_key
        self.model = model

    @property
    def model_ref(self) -> str:
        return f"voyage:{self.model}"

    def embed(self, texts: Sequence[str], *, input_type: str = "query") -> EmbeddingResult:
        # Voyage caps batch size at 128; the chat pipeline never exceeds
        # AIO_CAP so a single request is the common path. We still chunk
        # defensively for the document side.
        out: List[List[float]] = []
        chunk = 128
        with httpx.Client(timeout=20.0) as client:
            for i in range(0, len(texts), chunk):
                batch = list(texts[i : i + chunk])
                resp = client.post(
                    self.BASE_URL,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "input": batch,
                        "model": self.model,
                        "input_type": input_type,
                    },
                )
                resp.raise_for_status()
                payload = resp.json()
                # Voyage returns {data: [{embedding: [...], index: N}, ...]}
                # — sort by index to be defensive against out-of-order responses.
                items = sorted(payload.get("data", []), key=lambda d: d.get("index", 0))
                for item in items:
                    vec = item.get("embedding")
                    if vec is None:
                        raise RuntimeError("Voyage response missing 'embedding'")
                    out.append([float(x) for x in vec])
        return EmbeddingResult(model_ref=self.model_ref, vectors=out)


# ── Public API ─────────────────────────────────────────────────────────


def get_provider() -> Optional[_VoyageProvider]:
    """Return the active embedding provider or None when disabled.

    Resolution order (first match wins):
      1. ``VOYAGE_API_KEY`` env var → Voyage provider with the model from
         ``VOYAGE_EMBED_MODEL`` (default ``voyage-3.5-lite``).
      2. None — embeddings disabled.
    """
    voyage_key = os.environ.get("VOYAGE_API_KEY")
    if voyage_key:
        model = os.environ.get("VOYAGE_EMBED_MODEL", "voyage-3.5-lite")
        return _VoyageProvider(api_key=voyage_key, model=model)
    return None


def is_enabled() -> bool:
    return get_provider() is not None


def embed_query(text: str) -> Optional[EmbeddingResult]:
    """Embed a single query string. Returns None when no provider is configured."""
    provider = get_provider()
    if provider is None or not text.strip():
        return None
    try:
        return provider.embed([text], input_type="query")
    except Exception as exc:  # pragma: no cover — provider outages must not break chat
        logger.warning("embed_query failed: %s", exc)
        return None


def embed_documents(texts: Sequence[str]) -> Optional[EmbeddingResult]:
    """Embed a batch of document strings (used by the AIO embedder backfill job)."""
    provider = get_provider()
    if provider is None or not texts:
        return None
    try:
        return provider.embed(list(texts), input_type="document")
    except Exception as exc:
        logger.warning("embed_documents failed: %s", exc)
        return None


# ── Math ──────────────────────────────────────────────────────────────


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    """Cosine similarity. Returns 0.0 on shape mismatch or zero-vector inputs."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


def cosine_rerank(
    query_vec: Sequence[float],
    candidates: Sequence[tuple],
    *,
    weight: float = 0.35,
) -> List[tuple]:
    """Fold cosine similarity into a (id, score, vector) candidate list.

    Returns a new list of ``(id, blended_score)`` sorted descending. The
    blend is ``(1 - weight) * lexical + weight * cosine`` so embeddings
    are a tie-breaker / smoother on the lexical ordering, not a
    replacement. Candidates with no vector keep their lexical score
    unchanged (cosine contribution is zero).
    """
    out: List[tuple] = []
    for cand in candidates:
        cid, lex_score, vec = cand
        cos = cosine(query_vec, vec) if vec else 0.0
        blended = (1.0 - weight) * float(lex_score) + weight * cos
        out.append((cid, blended))
    out.sort(key=lambda t: t[1], reverse=True)
    return out
