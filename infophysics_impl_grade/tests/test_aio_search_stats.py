"""Static + unit checks for V4.4 P14: AIO Search quality readback.

The endpoint reads from the table written by P13 (migration 024) and
returns aggregate timings + retrieval shape so the next round of perf
work can be evaluated against real numbers.

Covers:
  * /v1/aio-search/stats endpoint exists on the stats router and is
    wired into the FastAPI app.
  * The endpoint declares the expected query parameters.
  * Returns a well-formed empty payload when the table is absent
    (no migration / no rows) — the readback must never 500 just because
    logging hasn't been enabled.
  * Empty payload contains the canonical shape (timings_ms phases,
    retrieval_shape_avg fields, by_mode list).
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
STATS_PY = REPO_ROOT / "api" / "routes" / "stats.py"


def test_aio_search_stats_endpoint_declared():
    src = STATS_PY.read_text()
    assert '@router.get("/v1/aio-search/stats")' in src, (
        "stats router must expose GET /v1/aio-search/stats"
    )


def test_aio_search_stats_accepts_expected_params():
    src = STATS_PY.read_text()
    body = src.split('@router.get("/v1/aio-search/stats")', 1)[-1].split("\n@router.", 1)[0]
    # Window + mode filter + tenant header.
    assert "since_hours" in body
    assert "mode" in body
    assert "X-Tenant-Id" in body


def test_aio_search_stats_returns_empty_when_table_missing():
    """The endpoint must degrade gracefully — no DB / no table → empty,
    never an HTTP 500. Operators can deploy the readback before they
    flip the AIO_SEARCH_LOG_QUALITY flag."""
    from fastapi.testclient import TestClient
    from api.main import app

    client = TestClient(app)
    r = client.get("/v1/aio-search/stats?since_hours=24")
    # Must not 500 even without DB.
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total_queries"] == 0
    assert body["window_hours"] == 24


def test_aio_search_stats_payload_shape():
    """Empty payload must carry the canonical keys so the frontend can
    bind dashboard widgets without null-checking every field."""
    from fastapi.testclient import TestClient
    from api.main import app

    client = TestClient(app)
    body = client.get("/v1/aio-search/stats").json()

    for key in (
        "window_hours", "tenant_id", "mode_filter", "total_queries",
        "answer_cache_hit_rate", "parse_cache_hit_rate",
        "timings_ms", "retrieval_shape_avg", "tokens_avg", "by_mode",
    ):
        assert key in body, f"missing key: {key}"

    for phase in ("parse", "retrieval", "llm", "total"):
        assert phase in body["timings_ms"]
        for stat in ("p50", "p95", "p99", "avg"):
            assert stat in body["timings_ms"][phase], f"timings_ms.{phase}.{stat} missing"

    for k in ("num_cues", "hsls_matched", "aios_matched",
              "aios_shipped", "sources_cited", "density_per_cue"):
        assert k in body["retrieval_shape_avg"], f"retrieval_shape_avg.{k} missing"

    assert isinstance(body["by_mode"], list)


def test_aio_search_stats_uses_percentile_cont():
    """Must use Postgres percentile_cont for true p50/p95/p99 — avg is
    not a substitute and the tuning loop depends on tail latency."""
    src = STATS_PY.read_text()
    body = src.split('@router.get("/v1/aio-search/stats")', 1)[-1].split("\n@router.", 1)[0]
    assert "percentile_cont(0.50)" in body
    assert "percentile_cont(0.95)" in body
    assert "percentile_cont(0.99)" in body


def test_aio_search_stats_breaks_down_by_mode():
    """Per-mode breakdown lets dashboards compare JSON vs streaming
    cost without a second endpoint."""
    src = STATS_PY.read_text()
    body = src.split('@router.get("/v1/aio-search/stats")', 1)[-1].split("\n@router.", 1)[0]
    assert "GROUP BY mode" in body
