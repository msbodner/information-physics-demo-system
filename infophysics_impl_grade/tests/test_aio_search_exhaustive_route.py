"""Integration tests for the V5.0 ?mode=exhaustive route dispatch.

Exercises the FastAPI route handler end-to-end with mocked DB +
Anthropic so we can verify what the route layer ADDS on top of the
chunk-loop orchestrator (covered separately in test_exhaustive.py):

  * ?mode=exhaustive dispatches to _aio_search_exhaustive (not the
    legacy Live single-call path)
  * Response shape carries the V5.0 metadata fields (mode, coverage,
    chunk_model, partial_warning, chunks_total, chunks_failed)
  * Cache namespace is "aio-search-exhaustive" (cannot collide with
    Live's "aio-search" namespace)
  * Cache HIT path returns coverage=1.0 + chunks_failed=0
  * Cache STORE is gated on coverage == 1.0 AND failed_chunks == 0
    so partial-coverage replies never get re-served
  * /stream endpoint emits a meta event carrying the V5.0 fields

The chunk-loop's pure logic (chunking, JSON validation, merge by
similarity, retry-once, hallucination guard) is covered by the
27 unit tests in test_exhaustive.py. Here we only test wiring.
"""

from __future__ import annotations

import json
from typing import Any, List
from unittest.mock import patch

import pytest


# ─── Stub builders ────────────────────────────────────────────────


class _StubUsage:
    def __init__(self, in_tok: int = 100, out_tok: int = 50):
        self.input_tokens = in_tok
        self.output_tokens = out_tok


class _StubContent:
    def __init__(self, text: str):
        self.text = text


class _StubResponse:
    def __init__(self, text: str, in_tok: int = 100, out_tok: int = 50):
        self.content = [_StubContent(text)]
        self.usage = _StubUsage(in_tok, out_tok)


def make_stub_anthropic_class(scripted_responses: list):
    """Return a class that mimics ``anthropic.Anthropic``.

    The ``messages.create`` method pops responses from a shared queue
    each call. Strings become ``_StubResponse`` (canned text + token
    usage). Exception instances are raised. ``_StubResponse`` instances
    pass through verbatim.

    The returned class also exposes a ``.calls`` list (shared across
    instances) so tests can assert what kwargs were sent.
    """
    queue = list(scripted_responses)
    calls: List[dict] = []

    class _StubMessages:
        def create(self, **kwargs):
            calls.append(kwargs)
            if not queue:
                raise RuntimeError("stub_anthropic exhausted")
            item = queue.pop(0)
            if isinstance(item, Exception):
                raise item
            if isinstance(item, str):
                return _StubResponse(item)
            return item

    class _StubClient:
        def __init__(self, *args, **kwargs):
            self.messages = _StubMessages()

    _StubClient.calls = calls  # type: ignore[attr-defined]
    return _StubClient


def chunk_match_json(matches: list, failures: list = None) -> str:
    """Build a strict-schema ChunkOutput JSON string."""
    return json.dumps({
        "matches": matches,
        "failures": failures or [],
    })


def render_prose(matches: list) -> str:
    """Build a plausible render-LLM prose reply for the given matches.
    Format doesn't matter to the route — only that it's a non-empty string."""
    body = "\n".join(f"- {m['aio_name']}" for m in matches)
    return f"Found {len(matches)} matches:\n{body}"


def make_prep_dict(matched_aio_lines: list, num_cues: int = 2) -> dict:
    """Return what _aio_search_prepare normally hands back. Mirrors the
    real return shape in chat.py:_aio_search_prepare so the route's
    downstream reads (prep["matched_aio_lines"], prep["api_key"], ...)
    all hit valid keys."""
    return {
        "api_key": "test-key",
        "answer_system": "stub answer system",
        "search_terms": {"field_values": [], "keywords": ["list", "all"]},
        "matched_hsl_ids": ["hsl-uuid-1", "hsl-uuid-2"],
        "matched_hsl_count": 2,
        "matched_aio_count": len(matched_aio_lines),
        "matched_aio_lines": list(matched_aio_lines),
        "parse_in_tok": 50,
        "parse_out_tok": 25,
        "applied_filters": "",
        "exclusions": [],
        "shipped_records": [],
        "user_prompt": "list all aios",
        "tenant": "tenantA",
        "parse_ms": 100,
        "retrieval_ms": 50,
        "parse_cache_hit": False,
        "num_cues": num_cues,
    }


# ─── Common patch context ─────────────────────────────────────────


def _route_patches(stub_anthropic_class, prep_dict, lookup_returns=None):
    """Set up the standard mocks every route test needs.

    Returns a list of context managers that the test enters. Mocks:
      * api.routes.chat._aio_search_prepare → returns prep_dict
      * api.routes.chat._qcache.lookup       → returns lookup_returns
                                                (None = cache miss)
      * api.routes.chat._qcache.store        → no-op (track via mock)
      * api.routes.chat._budget.{check_budget,record_usage} → no-op
      * api.routes.chat._quality.log         → no-op
      * api.routes.chat.cite_aios            → returns []
      * api.routes.chat.summarize_citations  → returns {cited:0,shipped:0}
      * anthropic.Anthropic                  → stub class
    """
    return [
        patch("api.routes.chat._aio_search_prepare", return_value=prep_dict),
        patch("api.routes.chat._qcache.lookup", return_value=lookup_returns),
        patch("api.routes.chat._qcache.store"),
        patch("api.routes.chat._budget.check_budget"),
        patch("api.routes.chat._budget.record_usage"),
        patch("api.routes.chat._quality.log"),
        patch("api.routes.chat.cite_aios", return_value=[]),
        patch(
            "api.routes.chat.summarize_citations",
            return_value={"cited": 0, "shipped": 0, "rate": 0.0},
        ),
        # Patch on the `anthropic` module so both the chunk loop's
        # Anthropic() and the render step's Anthropic() get the stub.
        patch("anthropic.Anthropic", stub_anthropic_class),
    ]


# ─── Tests ────────────────────────────────────────────────────────


def test_exhaustive_mode_returns_v50_metadata_fields(client):
    """?mode=exhaustive populates mode, coverage, chunk_model, and
    chunks_total in the response. Default mode (Live) leaves them None."""
    aio_lines = ["aio.0: [F.0]", "aio.1: [F.1]", "aio.2: [F.2]"]
    # Three responses: one chunk classification + one render call.
    StubAnthropic = make_stub_anthropic_class([
        chunk_match_json([
            {"aio_name": "aio.0", "similarity": 0.9, "why_match": "hit"},
            {"aio_name": "aio.1", "similarity": 0.85, "why_match": "hit"},
        ]),
        render_prose([{"aio_name": "aio.0"}, {"aio_name": "aio.1"}]),
    ])

    with patch.multiple(
        "api.routes.chat",
        _aio_search_prepare=lambda *a, **kw: make_prep_dict(aio_lines, num_cues=1),
    ), patch("api.routes.chat._qcache.lookup", return_value=None), \
         patch("api.routes.chat._qcache.store"), \
         patch("api.routes.chat._budget.check_budget"), \
         patch("api.routes.chat._budget.record_usage"), \
         patch("api.routes.chat._quality.log"), \
         patch("api.routes.chat.cite_aios", return_value=[]), \
         patch(
             "api.routes.chat.summarize_citations",
             return_value={"cited": 0, "shipped": 0, "rate": 0.0},
         ), \
         patch("anthropic.Anthropic", StubAnthropic):
        r = client.post(
            "/v1/op/aio-search?mode=exhaustive&chunk_model=claude-haiku-4-5",
            json={"messages": [{"role": "user", "content": "list all aios"}]},
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mode"] == "exhaustive"
    assert body["coverage"] == pytest.approx(1.0)
    assert body["chunk_model"] == "claude-haiku-4-5"
    assert body["chunks_total"] == 1
    assert body["chunks_failed"] == 0
    assert body["partial_warning"] is None
    # Render LLM produced the prose; the route returns it as `reply`.
    assert "Found 2 matches" in body["reply"]


def test_legacy_live_mode_leaves_v50_fields_unset(client):
    """?mode unset (or empty) routes to the legacy Live path.
    Response defaults to mode='live' and the V5.0 fields stay None."""
    StubAnthropic = make_stub_anthropic_class([
        # Legacy path makes ONE call (the synthesis).
        "Live answer text",
    ])

    with patch(
        "api.routes.chat._aio_search_prepare",
        return_value=make_prep_dict(["aio.0: [F.0]"], num_cues=1),
    ), patch("api.routes.chat._qcache.lookup", return_value=None), \
         patch("api.routes.chat._qcache.store"), \
         patch("api.routes.chat._budget.check_budget"), \
         patch("api.routes.chat._budget.record_usage"), \
         patch("api.routes.chat._quality.log"), \
         patch("api.routes.chat.cite_aios", return_value=[]), \
         patch(
             "api.routes.chat.summarize_citations",
             return_value={"cited": 0, "shipped": 0, "rate": 0.0},
         ), \
         patch("anthropic.Anthropic", StubAnthropic):
        r = client.post(
            "/v1/op/aio-search",
            json={"messages": [{"role": "user", "content": "what is X?"}]},
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mode"] == "live"
    assert body["coverage"] is None
    assert body["chunk_model"] is None
    assert body["partial_warning"] is None
    assert body["chunks_total"] is None
    assert body["chunks_failed"] is None


def test_exhaustive_uses_separate_cache_namespace(client):
    """Cache lookup MUST use 'aio-search-exhaustive' on Exhaustive runs
    so a Live cache hit doesn't shadow an Exhaustive request."""
    StubAnthropic = make_stub_anthropic_class([
        chunk_match_json([{"aio_name": "aio.0", "similarity": 0.9}]),
        render_prose([{"aio_name": "aio.0"}]),
    ])
    lookup_calls: List[tuple] = []

    def fake_lookup(tenant, mode, query):
        lookup_calls.append((tenant, mode, query))
        return None  # cache miss

    with patch(
        "api.routes.chat._aio_search_prepare",
        return_value=make_prep_dict(["aio.0: [F.0]"], num_cues=1),
    ), patch("api.routes.chat._qcache.lookup", side_effect=fake_lookup), \
         patch("api.routes.chat._qcache.store"), \
         patch("api.routes.chat._budget.check_budget"), \
         patch("api.routes.chat._budget.record_usage"), \
         patch("api.routes.chat._quality.log"), \
         patch("api.routes.chat.cite_aios", return_value=[]), \
         patch(
             "api.routes.chat.summarize_citations",
             return_value={"cited": 0, "shipped": 0, "rate": 0.0},
         ), \
         patch("anthropic.Anthropic", StubAnthropic):
        client.post(
            "/v1/op/aio-search?mode=exhaustive",
            json={"messages": [{"role": "user", "content": "q1"}]},
        )

    # Exhaustive run hit the cache lookup once with the dedicated namespace.
    assert any(c[1] == "aio-search-exhaustive" for c in lookup_calls), lookup_calls
    # And it did NOT use the Live namespace.
    assert not any(c[1] == "aio-search" for c in lookup_calls), lookup_calls


def test_exhaustive_cache_hit_returns_coverage_one(client):
    """When the cache returns a hit, the response must surface
    coverage=1.0 and chunks_failed=0 (cached replies are complete by
    definition; partial replies don't get cached). The mode='exhaustive'
    flag is preserved so the UI footer renders the V5.0 chrome."""
    # Build a synthetic CacheHit-shaped object.
    class _Hit:
        cache_id = "cache-1"
        mro_id = None
        hit_count = 1
        answer_text = "Cached exhaustive reply"

    with patch("api.routes.chat._qcache.lookup", return_value=_Hit()), \
         patch("api.routes.chat._budget.check_budget"), \
         patch("api.routes.chat._quality.log"):
        r = client.post(
            "/v1/op/aio-search?mode=exhaustive&chunk_model=claude-sonnet-4-6",
            json={"messages": [{"role": "user", "content": "q1"}]},
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["served_from_cache"] is True
    assert body["mode"] == "exhaustive"
    assert body["coverage"] == pytest.approx(1.0)
    assert body["chunks_failed"] == 0
    assert body["partial_warning"] is None
    assert body["chunk_model"] == "claude-sonnet-4-6"
    assert body["reply"] == "Cached exhaustive reply"


def test_partial_coverage_skips_cache_store(client):
    """When at least one chunk fails terminally (parse error after retry),
    the store call MUST be skipped. Otherwise the partial reply text
    would re-serve as if it were a complete answer."""
    aio_lines = [f"aio.{i}: [F.{i}]" for i in range(400)]  # 2 chunks at size 200
    # Three chunk attempts: chunk 1 succeeds, chunk 2 fails twice (initial + retry).
    # Then one render call with the partial result.
    StubAnthropic = make_stub_anthropic_class([
        chunk_match_json([{"aio_name": "aio.0", "similarity": 0.9}]),
        "this is not json — first attempt",
        "still not json — retry",
        render_prose([{"aio_name": "aio.0"}]),
    ])

    with patch(
        "api.routes.chat._aio_search_prepare",
        return_value=make_prep_dict(aio_lines, num_cues=1),
    ), patch("api.routes.chat._qcache.lookup", return_value=None), \
         patch("api.routes.chat._qcache.store") as store_mock, \
         patch("api.routes.chat._budget.check_budget"), \
         patch("api.routes.chat._budget.record_usage"), \
         patch("api.routes.chat._quality.log"), \
         patch("api.routes.chat.cite_aios", return_value=[]), \
         patch(
             "api.routes.chat.summarize_citations",
             return_value={"cited": 0, "shipped": 0, "rate": 0.0},
         ), \
         patch("anthropic.Anthropic", StubAnthropic):
        r = client.post(
            "/v1/op/aio-search?mode=exhaustive",
            json={"messages": [{"role": "user", "content": "list all"}]},
        )

    assert r.status_code == 200, r.text
    body = r.json()
    # Partial: 1 of 2 chunks succeeded → coverage=0.5, partial warning set.
    assert body["chunks_total"] == 2
    assert body["chunks_failed"] == 1
    assert body["coverage"] == pytest.approx(0.5)
    assert body["partial_warning"] is not None
    assert "1 of 2 chunks failed" in body["partial_warning"]
    # Cache STORE must not have been called.
    store_mock.assert_not_called()


def test_full_coverage_stores_in_exhaustive_namespace(client):
    """A complete (coverage=1.0, no failed chunks) Exhaustive run
    persists the rendered reply to the 'aio-search-exhaustive' cache."""
    StubAnthropic = make_stub_anthropic_class([
        chunk_match_json([{"aio_name": "aio.0", "similarity": 0.9}]),
        render_prose([{"aio_name": "aio.0"}]),
    ])

    with patch(
        "api.routes.chat._aio_search_prepare",
        return_value=make_prep_dict(["aio.0: [F.0]"], num_cues=1),
    ), patch("api.routes.chat._qcache.lookup", return_value=None), \
         patch("api.routes.chat._qcache.store") as store_mock, \
         patch("api.routes.chat._budget.check_budget"), \
         patch("api.routes.chat._budget.record_usage"), \
         patch("api.routes.chat._quality.log"), \
         patch("api.routes.chat.cite_aios", return_value=[]), \
         patch(
             "api.routes.chat.summarize_citations",
             return_value={"cited": 0, "shipped": 0, "rate": 0.0},
         ), \
         patch("anthropic.Anthropic", StubAnthropic):
        client.post(
            "/v1/op/aio-search?mode=exhaustive",
            json={"messages": [{"role": "user", "content": "list all"}]},
        )

    # Cache STORE was called exactly once with the dedicated namespace.
    assert store_mock.call_count == 1
    args = store_mock.call_args
    # store(tenant, mode, query, answer_text, mro_id=None)
    # tenant could be positional or kw; mode is positional[1]
    if args.args and len(args.args) >= 2:
        assert args.args[1] == "aio-search-exhaustive"
    else:
        assert args.kwargs.get("mode") == "aio-search-exhaustive"


def test_chunk_model_param_threads_through_to_anthropic(client):
    """?chunk_model=… reaches the per-chunk LLM call. The render step
    uses get_default_model() so isn't affected by this param."""
    StubAnthropic = make_stub_anthropic_class([
        chunk_match_json([{"aio_name": "aio.0", "similarity": 0.9}]),
        render_prose([{"aio_name": "aio.0"}]),
    ])

    with patch(
        "api.routes.chat._aio_search_prepare",
        return_value=make_prep_dict(["aio.0: [F.0]"], num_cues=1),
    ), patch("api.routes.chat._qcache.lookup", return_value=None), \
         patch("api.routes.chat._qcache.store"), \
         patch("api.routes.chat._budget.check_budget"), \
         patch("api.routes.chat._budget.record_usage"), \
         patch("api.routes.chat._quality.log"), \
         patch("api.routes.chat.cite_aios", return_value=[]), \
         patch(
             "api.routes.chat.summarize_citations",
             return_value={"cited": 0, "shipped": 0, "rate": 0.0},
         ), \
         patch("anthropic.Anthropic", StubAnthropic):
        client.post(
            "/v1/op/aio-search?mode=exhaustive&chunk_model=claude-opus-4-7",
            json={"messages": [{"role": "user", "content": "list all"}]},
        )

    # First call to messages.create is the chunk classification — its
    # `model` kwarg should be the operator's choice.
    assert len(StubAnthropic.calls) >= 1
    assert StubAnthropic.calls[0]["model"] == "claude-opus-4-7"


def test_stream_endpoint_exhaustive_emits_meta_with_v50_fields(client):
    """The /aio-search/stream endpoint, on ?mode=exhaustive, emits the
    rendered reply as a single text frame followed by a meta event
    that carries every V5.0 field the JSON endpoint exposes."""
    StubAnthropic = make_stub_anthropic_class([
        chunk_match_json([{"aio_name": "aio.0", "similarity": 0.9}]),
        render_prose([{"aio_name": "aio.0"}]),
    ])

    with patch(
        "api.routes.chat._aio_search_prepare",
        return_value=make_prep_dict(["aio.0: [F.0]"], num_cues=1),
    ), patch("api.routes.chat._qcache.lookup", return_value=None), \
         patch("api.routes.chat._qcache.store"), \
         patch("api.routes.chat._budget.check_budget"), \
         patch("api.routes.chat._budget.record_usage"), \
         patch("api.routes.chat._quality.log"), \
         patch("api.routes.chat.cite_aios", return_value=[]), \
         patch(
             "api.routes.chat.summarize_citations",
             return_value={"cited": 0, "shipped": 0, "rate": 0.0},
         ), \
         patch("anthropic.Anthropic", StubAnthropic):
        r = client.post(
            "/v1/op/aio-search/stream?mode=exhaustive&chunk_model=claude-haiku-4-5",
            json={"messages": [{"role": "user", "content": "list all"}]},
        )

    assert r.status_code == 200, r.text
    sse_text = r.text
    # SSE event-stream format: event: text\n data: <json>\n\n
    assert "event: text" in sse_text
    assert "event: meta" in sse_text
    # The meta event payload is JSON; pull it out and assert V5.0 fields.
    # Find the data: line that follows "event: meta".
    meta_line = None
    chunks = sse_text.split("\n\n")
    for c in chunks:
        if c.startswith("event: meta"):
            for ln in c.split("\n"):
                if ln.startswith("data: "):
                    meta_line = ln[len("data: "):]
                    break
            break
    assert meta_line is not None, sse_text
    meta = json.loads(meta_line)
    assert meta["mode"] == "exhaustive"
    assert meta["coverage"] == pytest.approx(1.0)
    assert meta["chunk_model"] == "claude-haiku-4-5"
    assert meta["chunks_total"] == 1
    assert meta["chunks_failed"] == 0
    assert meta["partial_warning"] is None
