"""Static + unit checks for V4.4 P13: per-query quality + timing logger.

Covers:
  * migration 024 exists and creates the aio_search_quality table.
  * api/search_quality.py exposes is_enabled() / log() and is gated
    by AIO_SEARCH_LOG_QUALITY env flag.
  * is_enabled() default is OFF (zero side-effect for deployments
    that don't opt in).
  * chat.py wires the logger at the four expected sites: cache-hit
    short-circuit and post-LLM completion on both the JSON and the
    streaming endpoints.
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
CHAT_PY = REPO_ROOT / "api" / "routes" / "chat.py"
QUALITY_PY = REPO_ROOT / "api" / "search_quality.py"
MIGRATION = REPO_ROOT / "migrations" / "024_aio_search_quality.sql"


# ── Migration ──────────────────────────────────────────────────────

def test_migration_024_creates_aio_search_quality():
    assert MIGRATION.is_file(), "migration 024 missing"
    sql = MIGRATION.read_text()
    assert "CREATE TABLE IF NOT EXISTS aio_search_quality" in sql
    # RLS must be enabled+forced (tenant isolation).
    assert "ENABLE ROW LEVEL SECURITY" in sql
    assert "FORCE  ROW LEVEL SECURITY" in sql
    # Tenant-scoped policy
    assert "current_setting('app.tenant_id'" in sql


# ── search_quality module ──────────────────────────────────────────

def test_search_quality_module_exposes_public_api():
    assert QUALITY_PY.is_file()
    src = QUALITY_PY.read_text()
    assert "def is_enabled()" in src
    assert "def log(" in src


def test_search_quality_default_off(monkeypatch):
    monkeypatch.delenv("AIO_SEARCH_LOG_QUALITY", raising=False)
    from importlib import reload
    import api.search_quality as sq
    reload(sq)
    assert sq.is_enabled() is False


def test_search_quality_env_flag_on(monkeypatch):
    monkeypatch.setenv("AIO_SEARCH_LOG_QUALITY", "1")
    from importlib import reload
    import api.search_quality as sq
    reload(sq)
    assert sq.is_enabled() is True


def test_search_quality_log_is_silent_noop_when_off(monkeypatch):
    """log() must return None and raise nothing when env is off."""
    monkeypatch.delenv("AIO_SEARCH_LOG_QUALITY", raising=False)
    from importlib import reload
    import api.search_quality as sq
    reload(sq)
    # No DB needed — gate short-circuits before any connection attempt.
    sq.log(
        tenant="tenantA", mode="aio-search", query_text="hello",
        num_cues=1, hsls_matched=0, aios_matched=0, aios_shipped=0,
        parse_ms=0, retrieval_ms=0, llm_ms=0, total_ms=0,
    )


# ── chat.py wiring ─────────────────────────────────────────────────

def test_chat_py_imports_search_quality():
    src = CHAT_PY.read_text()
    assert "from api import search_quality as _quality" in src


def test_chat_py_logs_on_json_cache_hit():
    src = CHAT_PY.read_text()
    body = src.split("def aio_search(", 1)[-1].split("\ndef ", 1)[0]
    cache_block = body.split("aio-search cache HIT", 1)[-1].split("return AioSearchResponse", 1)[0]
    assert "_quality.log(" in cache_block, (
        "JSON aio_search cache-hit path must emit a quality log row"
    )
    assert "served_from_cache=True" in cache_block


def test_chat_py_logs_on_json_post_llm():
    src = CHAT_PY.read_text()
    body = src.split("def aio_search(", 1)[-1].split("\ndef ", 1)[0]
    # Post-LLM block sits between budget.record_usage and the response.
    post_llm = body.split("_budget.record_usage", 1)[-1].split("return AioSearchResponse", 1)[0]
    assert "_quality.log(" in post_llm, (
        "JSON aio_search post-LLM path must emit a quality log row"
    )
    assert 'mode="aio-search"' in post_llm


def test_chat_py_logs_on_stream_cache_hit():
    src = CHAT_PY.read_text()
    body = src.split("def aio_search_stream(", 1)[-1].split("\ndef ", 1)[0]
    cache_block = body.split("aio-search-stream cache HIT", 1)[-1].split("def gen_cached", 1)[0]
    assert "_quality.log(" in cache_block, (
        "stream cache-hit path must emit a quality log row"
    )
    assert 'mode="aio-search-stream"' in cache_block


def test_chat_py_logs_on_stream_completion():
    src = CHAT_PY.read_text()
    body = src.split("def aio_search_stream(", 1)[-1].split("\ndef ", 1)[0]
    # Streaming completion log lives inside gen() after the meta yield.
    after_meta = body.split('"served_from_cache": False,', 1)[-1]
    assert "_quality.log(" in after_meta, (
        "stream completion path must emit a quality log row"
    )
    assert 'mode="aio-search-stream"' in after_meta
