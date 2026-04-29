"""Static checks for V4.4 P6/P7: parse-cache + env-driven parse model.

P6: Phase 1 parse result is cached under mode "aio-search-parse" in the
    existing query_cache table; cache hits skip the LLM round trip.
P7: Parse model is read from AIO_SEARCH_PARSE_MODEL env var (default
    "claude-sonnet-4-6") so operators can opt into Haiku without a deploy.
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
CHAT_PY = REPO_ROOT / "api" / "routes" / "chat.py"


def _src() -> str:
    return CHAT_PY.read_text()


# ── P6: parse cache ────────────────────────────────────────────────

def test_p6_parse_cache_lookup_present():
    src = _src()
    body = src.split("def _aio_search_prepare", 1)[-1].split("\ndef ", 1)[0]
    assert '_qcache.lookup(tenant, "aio-search-parse"' in body, (
        "Phase 1 parse must consult the parse cache before calling the LLM"
    )


def test_p6_parse_cache_store_present():
    src = _src()
    body = src.split("def _aio_search_prepare", 1)[-1].split("\ndef ", 1)[0]
    assert '_qcache.store(' in body and '"aio-search-parse"' in body, (
        "successful parse must be persisted into the parse cache"
    )


def test_p6_parse_cache_uses_distinct_mode():
    """The parse cache mode must NOT collide with the answer cache mode."""
    src = _src()
    # answer cache uses "aio-search"; parse cache uses "aio-search-parse"
    assert '"aio-search-parse"' in src
    # And the JSON serialization round-trip is in place.
    body = src.split("def _aio_search_prepare", 1)[-1].split("\ndef ", 1)[0]
    assert "json.loads(cached_parse.answer_text)" in body
    assert "json.dumps(search_terms)" in body


# ── P7: env-driven parse model ─────────────────────────────────────

def test_p7_parse_model_is_env_configurable():
    """V4.5: parse-phase model is selectable via system_settings →
    AIO_SEARCH_PARSE_MODEL env → default. The selection is now
    centralized in api.llm.get_parse_model(), called from
    _aio_search_prepare instead of inlining os.environ.get().
    """
    src = _src()
    body = src.split("def _aio_search_prepare", 1)[-1].split("\ndef ", 1)[0]
    # _aio_search_prepare must call get_parse_model() to honor the
    # resolution chain.
    assert "get_parse_model()" in body, (
        "_aio_search_prepare must call get_parse_model() (V4.5 model selection)"
    )
    # That helper must read AIO_SEARCH_PARSE_MODEL as part of its chain.
    from api import llm as _llm
    import inspect
    helper_src = inspect.getsource(_llm.get_parse_model)
    assert "AIO_SEARCH_PARSE_MODEL" in helper_src, (
        "get_parse_model must consult AIO_SEARCH_PARSE_MODEL env var"
    )
    # Used in the messages.create call (not still hardcoded).
    create_block = body.split("client.messages.create(", 1)[-1].split(")", 1)[0]
    assert "parse_model" in create_block, (
        "messages.create must use the env-driven parse_model variable"
    )
