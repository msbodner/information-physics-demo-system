"""Smoke tests for V4.4 /v1/op/mro-search.

Two layers, in line with the rest of the test suite:

1. Always-runs static checks — verify the route is registered, the
   handler imports cleanly, the SQL builds the expected predicates,
   and an empty/whitespace query short-circuits to an empty list
   without hitting the DB. These run on any machine, no Postgres.

2. DB-gated integration test (``require_db`` fixture) — seeds three
   MROs with distinct query_texts, calls /v1/op/mro-search with three
   probes (exact match, paraphrase, unrelated), and asserts the
   ranking + summary-truncation invariants hold.

The integration test is the actual smoke test. The static checks
catch regressions where someone edits the route in a way that breaks
the contract without breaking SQL.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
MRO_PY = REPO_ROOT / "api" / "routes" / "mro.py"


# ── Static checks ───────────────────────────────────────────────────


def test_mro_search_route_is_registered(client):
    """The endpoint must exist on the FastAPI app under /v1/op/mro-search."""
    paths = {r.path for r in client.app.routes}
    assert "/v1/op/mro-search" in paths


def test_mro_search_uses_pg_trgm_and_tsrank():
    """The handler must combine trigram similarity + ts_rank (paraphrase tolerance)."""
    src = MRO_PY.read_text()
    assert "similarity(query_text" in src, "must use pg_trgm similarity()"
    assert "ts_rank(query_tsv" in src, "must use ts_rank() against query_tsv"
    assert "GREATEST(" in src, "final score must be GREATEST(similarity, ts_rank)"
    assert "trust_score" in src, "ranking must factor trust_score"


def test_mro_search_empty_query_short_circuits(client):
    """Empty/whitespace query → 200 with empty matches, no DB call."""
    res = client.get("/v1/op/mro-search?query=%20%20")
    assert res.status_code == 200
    body = res.json()
    assert body["matches"] == []
    assert body["k"] >= 1


def test_mro_search_validates_min_length(client):
    """A truly empty query is rejected by FastAPI's min_length validator."""
    res = client.get("/v1/op/mro-search?query=")
    # FastAPI returns 422 on Query(min_length=1) failure.
    assert res.status_code == 422


def test_mro_search_response_model_shape(client):
    """The Pydantic response model exposes the contract the pipeline depends on."""
    from api.routes.mro import MroSearchHit, MroSearchResponse

    hit_fields = set(MroSearchHit.model_fields.keys())
    expected = {
        "mro_id", "mro_key", "query_text",
        "similarity", "ts_rank", "score", "trust_weighted_score",
        "search_terms", "seed_hsls",
        "result_summary", "result_full_available",
        "confidence", "trust_score", "created_at",
    }
    assert expected <= hit_fields, f"missing fields: {expected - hit_fields}"

    resp_fields = set(MroSearchResponse.model_fields.keys())
    assert {"query", "k", "matches"} <= resp_fields


# ── Integration test (DB-gated) ─────────────────────────────────────


@pytest.mark.integration
def test_mro_search_ranking_and_truncation(require_db):
    """Seed 3 MROs, probe with 3 queries, assert ranking + truncation.

    Uses a unique tenant id so the test is isolated from any seeded data.
    Cleans up its own rows on the way out.
    """
    from fastapi.testclient import TestClient
    from api.main import app

    tenant = f"test-mro-{uuid.uuid4().hex[:8]}"
    headers = {"X-Tenant-Id": tenant}

    long_answer = "A" * 1500  # exceeds default summary_chars (500)

    fixtures = [
        {
            "mro_key": f"k-{uuid.uuid4().hex[:6]}",
            "query_text": "what is the total revenue for Q3 by product line",
            "result_text": long_answer,
            "search_terms": [
                {"key": "Quarter", "value": "Q3", "raw": "[Quarter.Q3]"},
                {"key": "Metric", "value": "revenue", "raw": "[Metric.revenue]"},
            ],
            "seed_hsls": "hsl-revenue|hsl-q3",
            "policy_scope": "default",
        },
        {
            "mro_key": f"k-{uuid.uuid4().hex[:6]}",
            "query_text": "show Q3 revenue grouped by product line",
            "result_text": "short answer",
            "search_terms": [
                {"key": "Quarter", "value": "Q3", "raw": "[Quarter.Q3]"},
            ],
            "seed_hsls": "hsl-revenue",
            "policy_scope": "default",
        },
        {
            "mro_key": f"k-{uuid.uuid4().hex[:6]}",
            "query_text": "color of the sky on a clear day",
            "result_text": "blue",
            "search_terms": [],
            "seed_hsls": "hsl-sky",
            "policy_scope": "default",
        },
    ]

    # Use a single TestClient that DOES start the lifespan, so the DB
    # pool is open. Distinct from the session-scoped `client` fixture.
    with TestClient(app) as live:
        created_ids = []
        try:
            for f in fixtures:
                r = live.post("/v1/mro-objects", json=f, headers=headers)
                assert r.status_code == 201, r.text
                created_ids.append(r.json()["mro_id"])

            # Probe 1 — exact match → top hit must be fixture[0],
            # similarity ≈ 1.0, score ≥ 0.85 (would short-circuit).
            r = live.get(
                "/v1/op/mro-search",
                params={"query": fixtures[0]["query_text"], "k": 5},
                headers=headers,
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert len(body["matches"]) >= 1
            top = body["matches"][0]
            assert top["query_text"] == fixtures[0]["query_text"]
            assert top["score"] >= 0.85, f"exact-match score too low: {top['score']}"
            assert top["similarity"] >= 0.85
            # Summary must be truncated to <= summary_chars (default 500).
            assert len(top["result_summary"]) <= 500
            assert top["result_summary"].startswith("AAAA")
            assert top["result_full_available"] is True
            # search_terms round-trips JSONB.
            assert isinstance(top["search_terms"], list)
            assert any(c.get("key") == "Quarter" for c in top["search_terms"])

            # Probe 2 — paraphrase ("Q3 revenue by product") should still
            # surface fixtures 0 and 1 (both share Q3 + revenue tokens).
            # Either may rank first; what matters is that the unrelated
            # fixture[2] is excluded or scores far below.
            r = live.get(
                "/v1/op/mro-search",
                params={"query": "Q3 revenue by product", "k": 5},
                headers=headers,
            )
            assert r.status_code == 200
            matches = r.json()["matches"]
            top_two_qs = {m["query_text"] for m in matches[:2]}
            assert any("Q3" in q or "revenue" in q for q in top_two_qs)
            # Unrelated sky-color fixture must NOT lead the ranking.
            assert matches[0]["query_text"] != fixtures[2]["query_text"]

            # Probe 3 — unrelated probe ("annual budget forecast") should
            # either return zero matches or no high-confidence hit.
            r = live.get(
                "/v1/op/mro-search",
                params={"query": "annual budget forecast", "k": 5, "min_score": 0.30},
                headers=headers,
            )
            assert r.status_code == 200
            matches = r.json()["matches"]
            # All returned hits must be below the short-circuit threshold,
            # otherwise the cache layer would falsely fire.
            for m in matches:
                assert m["score"] < 0.85, (
                    f"unrelated probe scored too high: {m['score']} on "
                    f"{m['query_text']!r}"
                )

            # Probe 4 — summary_chars=0 yields empty result_summary (still
            # signals result_full_available so caller can hydrate).
            r = live.get(
                "/v1/op/mro-search",
                params={"query": fixtures[0]["query_text"], "k": 1, "summary_chars": 0},
                headers=headers,
            )
            assert r.status_code == 200
            top = r.json()["matches"][0]
            assert top["result_summary"] == ""
            assert top["result_full_available"] is True

        finally:
            for mid in created_ids:
                live.delete(f"/v1/mro-objects/{mid}", headers=headers)


# ── Curl recipe (for hand-driven smoke test against a running backend) ───
#
# 1. Start the backend:
#       cd infophysics_impl_grade && uvicorn api.main:app --reload --port 8080
#
# 2. Seed an MRO (any tenant):
#       curl -sS -X POST http://localhost:8080/v1/mro-objects \
#         -H 'Content-Type: application/json' -H 'X-Tenant-Id: tenantA' \
#         -d '{"mro_key":"smoke-1","query_text":"top customers by revenue",
#              "result_text":"Acme, Globex, Initech","search_terms":[]}'
#
# 3. Search:
#       curl -sS 'http://localhost:8080/v1/op/mro-search?query=top%20customers&k=3' \
#         -H 'X-Tenant-Id: tenantA' | jq
#
# Expected: top hit's query_text matches, score ≥ ~0.4, result_summary
# is truncated to ≤500 chars, result_full_available is true.
