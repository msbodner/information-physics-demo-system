"""Unit tests for V5.0 Exhaustive Live (api/exhaustive.py).

All tests run without a database or live Anthropic call. The orchestrator
tests inject a stub client that mimics ``anthropic.Anthropic.messages.create``
so we can exercise the chunk loop, retry-once logic, JSON validation,
and merge step deterministically.
"""

from __future__ import annotations

import json
from typing import Any, Iterable, List

import pytest

from api import exhaustive as ex
from api.exhaustive import (
    ChunkMatch,
    ChunkOutput,
    chunk_aios,
    chunk_size_for,
    coverage_for,
    decrement_trust_for_coverage,
    merge_results,
    parse_chunk_output,
    render_table_fallback,
    run_exhaustive,
)


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def test_chunk_size_floor_and_ceiling():
    """Settled formula: clamp(100 + 100·cues, 200, 800)."""
    assert chunk_size_for(0) == 200      # floor (100 + 0 = 100, clamped up)
    assert chunk_size_for(1) == 200      # 100 + 100 = 200
    assert chunk_size_for(2) == 300      # 100 + 200 = 300
    assert chunk_size_for(7) == 800      # 100 + 700 = 800 (ceiling exact)
    assert chunk_size_for(8) == 800      # 100 + 800 = 900, clamped to 800
    assert chunk_size_for(50) == 800     # ceiling
    assert chunk_size_for(-5) == 200     # negative cues → floor


def test_chunk_aios_evenly_divides():
    lines = [f"aio.{i}: [Key.{i}]" for i in range(10)]
    chunks = chunk_aios(lines, 3)
    assert len(chunks) == 4
    assert [len(c) for c in chunks] == [3, 3, 3, 1]
    # No data loss; ordering preserved.
    flat = [r for c in chunks for r in c]
    assert flat == lines


def test_chunk_aios_empty_input():
    assert chunk_aios([], 100) == []


def test_chunk_aios_zero_size_returns_single_chunk():
    """Defensive: size <= 0 means "don't chunk", return the whole list."""
    lines = ["a", "b"]
    chunks = chunk_aios(lines, 0)
    assert chunks == [["a", "b"]]


def test_coverage_basic():
    assert coverage_for(0, 0) == 1.0    # no chunks → fully covered
    assert coverage_for(5, 5) == 1.0
    assert coverage_for(3, 5) == pytest.approx(0.6)
    assert coverage_for(0, 5) == 0.0
    # Robustness: never out of bounds.
    assert coverage_for(10, 5) == 1.0
    assert coverage_for(-1, 5) == 0.0


def test_decrement_trust_full_coverage_unchanged():
    assert decrement_trust_for_coverage(1.0, 1.0) == 1.0
    assert decrement_trust_for_coverage(0.7, 1.0) == 0.7


def test_decrement_trust_partial_proportional():
    # 50% coverage halves trust.
    assert decrement_trust_for_coverage(1.0, 0.5) == 0.5
    assert decrement_trust_for_coverage(0.8, 0.5) == pytest.approx(0.4)
    # Floor at 0; ceiling at 1.
    assert decrement_trust_for_coverage(0.5, 0.0) == 0.0
    assert decrement_trust_for_coverage(2.0, 1.0) == 1.0  # ceiling clamp


# ---------------------------------------------------------------------------
# JSON parsing
# ---------------------------------------------------------------------------


def test_parse_chunk_output_plain_json():
    raw = json.dumps({
        "matches": [
            {"aio_name": "a.1", "similarity": 0.92, "why_match": "matches X"},
        ],
        "failures": [],
    })
    out = parse_chunk_output(raw)
    assert isinstance(out, ChunkOutput)
    assert len(out.matches) == 1
    assert out.matches[0].aio_name == "a.1"
    assert out.matches[0].similarity == 0.92


def test_parse_chunk_output_handles_fenced_block():
    """Haiku occasionally wraps JSON in ```json fences. Strip them."""
    raw = "```json\n" + json.dumps({"matches": [], "failures": []}) + "\n```"
    out = parse_chunk_output(raw)
    assert out.matches == []


def test_parse_chunk_output_handles_bare_fence():
    raw = "```\n" + json.dumps({"matches": [], "failures": []}) + "\n```"
    out = parse_chunk_output(raw)
    assert out.matches == []


def test_parse_chunk_output_rejects_invalid_similarity():
    """Pydantic constraint: similarity ∈ [0, 1]."""
    raw = json.dumps({
        "matches": [{"aio_name": "a.1", "similarity": 1.5}],
        "failures": [],
    })
    with pytest.raises(Exception):  # ValidationError
        parse_chunk_output(raw)


def test_parse_chunk_output_rejects_malformed():
    with pytest.raises(json.JSONDecodeError):
        parse_chunk_output("not json at all")


# ---------------------------------------------------------------------------
# Merge step
# ---------------------------------------------------------------------------


def test_merge_dedups_by_max_similarity():
    """Conflict policy #3: winner = max(candidates, key=lambda m: m.similarity).

    Same aio_name appears in two chunks with different similarity scores;
    the higher score wins, the loser is dropped.
    """
    chunk_a = ChunkOutput(matches=[
        ChunkMatch(aio_name="a.1", similarity=0.55, why_match="weak"),
        ChunkMatch(aio_name="a.2", similarity=0.91, why_match="strong"),
    ])
    chunk_b = ChunkOutput(matches=[
        ChunkMatch(aio_name="a.1", similarity=0.88, why_match="strong"),
        ChunkMatch(aio_name="a.3", similarity=0.70, why_match="medium"),
    ])
    sent = {"a.1", "a.2", "a.3"}
    merged = merge_results([chunk_a, chunk_b], sent)
    by_name = {m.aio_name: m for m in merged}
    assert len(merged) == 3
    # a.1: higher (0.88) won
    assert by_name["a.1"].similarity == 0.88
    assert by_name["a.1"].why_match == "strong"
    # Sort: highest similarity first.
    assert merged[0].similarity >= merged[1].similarity >= merged[2].similarity


def test_merge_drops_hallucinated_names():
    """LLM occasionally invents aio_names. The merge guards against this."""
    sent = {"a.1", "a.2"}
    chunk = ChunkOutput(matches=[
        ChunkMatch(aio_name="a.1", similarity=0.9),
        ChunkMatch(aio_name="a.fake", similarity=0.95),  # not in sent set
        ChunkMatch(aio_name="a.2", similarity=0.7),
    ])
    merged = merge_results([chunk], sent)
    names = {m.aio_name for m in merged}
    assert names == {"a.1", "a.2"}
    assert "a.fake" not in names


def test_merge_empty_per_chunk_returns_empty():
    merged = merge_results([], {"a.1", "a.2"})
    assert merged == []


def test_merge_no_sent_names_keeps_everything():
    """When sent_names is empty, the hallucination guard is bypassed —
    useful for tests that don't bother building a sent-set."""
    chunk = ChunkOutput(matches=[
        ChunkMatch(aio_name="any.thing", similarity=0.5),
    ])
    merged = merge_results([chunk], set())
    assert len(merged) == 1


# ---------------------------------------------------------------------------
# Stub Anthropic client (used by orchestrator tests below)
# ---------------------------------------------------------------------------


class _StubUsage:
    def __init__(self, in_tok: int, out_tok: int):
        self.input_tokens = in_tok
        self.output_tokens = out_tok


class _StubContent:
    def __init__(self, text: str):
        self.text = text


class _StubResponse:
    def __init__(self, text: str, in_tok: int = 100, out_tok: int = 50):
        self.content = [_StubContent(text)]
        self.usage = _StubUsage(in_tok, out_tok)


class _StubMessages:
    """Mimics ``client.messages`` with a scriptable ``create`` method.

    Constructor takes a list of responses (str or Exception). Each call
    pops the next one — strings become _StubResponse, Exceptions raise.
    """

    def __init__(self, scripted: Iterable[Any]):
        self._queue = list(scripted)
        self.calls: List[dict] = []

    def create(self, **kwargs) -> _StubResponse:
        self.calls.append(kwargs)
        if not self._queue:
            raise RuntimeError("stub exhausted: no more scripted responses")
        item = self._queue.pop(0)
        if isinstance(item, Exception):
            raise item
        if isinstance(item, _StubResponse):
            return item
        return _StubResponse(item)


class _StubClient:
    def __init__(self, scripted: Iterable[Any]):
        self.messages = _StubMessages(scripted)


def _ok_chunk_response(matches: List[dict], failures: List[str] = None) -> str:
    return json.dumps({
        "matches": matches,
        "failures": failures or [],
    })


# ---------------------------------------------------------------------------
# Orchestrator: run_exhaustive
# ---------------------------------------------------------------------------


def test_run_exhaustive_empty_input_returns_clean_result():
    """No matched AIOs → no LLM calls, full coverage, full trust."""
    client = _StubClient([])  # no responses needed
    result = run_exhaustive(
        client=client,
        matched_aio_lines=[],
        user_prompt="anything",
        num_cues=2,
        chunk_model="claude-haiku-4-5",
    )
    assert result.matches == []
    assert result.total_chunks == 0
    assert result.coverage == 1.0
    assert result.trust_score == 1.0
    assert result.warning == ""
    assert client.messages.calls == []


def test_run_exhaustive_single_chunk_full_match():
    """All records in one chunk, all match — coverage=1, all merged."""
    aio_lines = [f"aio.{i}: [Field.Val{i}]" for i in range(5)]
    matches_response = _ok_chunk_response([
        {"aio_name": f"aio.{i}", "similarity": 0.9, "why_match": f"hit {i}"}
        for i in range(5)
    ])
    client = _StubClient([matches_response])
    result = run_exhaustive(
        client=client,
        matched_aio_lines=aio_lines,
        user_prompt="list all aios",
        num_cues=1,
        chunk_model="claude-haiku-4-5",
    )
    assert result.total_chunks == 1
    assert result.successful_chunks == 1
    assert result.failed_chunks == 0
    assert result.coverage == 1.0
    assert result.trust_score == 1.0
    assert result.warning == ""
    assert len(result.matches) == 5
    assert {m.aio_name for m in result.matches} == {f"aio.{i}" for i in range(5)}
    # Token accounting flowed through.
    assert result.input_tokens == 100
    assert result.output_tokens == 50


def test_run_exhaustive_multiple_chunks_dedups():
    """Two chunks, same aio_name in both — winner has higher similarity."""
    aio_lines = [f"aio.{i}: [F.{i}]" for i in range(400)]  # 2 chunks at size 200
    chunk_1 = _ok_chunk_response([
        {"aio_name": "aio.0", "similarity": 0.55, "why_match": "weak"},
        {"aio_name": "aio.1", "similarity": 0.92, "why_match": "strong"},
    ])
    chunk_2 = _ok_chunk_response([
        {"aio_name": "aio.0", "similarity": 0.88, "why_match": "strong"},
        {"aio_name": "aio.200", "similarity": 0.70, "why_match": "ok"},
    ])
    client = _StubClient([chunk_1, chunk_2])
    result = run_exhaustive(
        client=client,
        matched_aio_lines=aio_lines,
        user_prompt="enumerate",
        num_cues=1,  # → chunk_size 200
        chunk_model="claude-haiku-4-5",
    )
    assert result.total_chunks == 2
    by_name = {m.aio_name: m for m in result.matches}
    assert len(result.matches) == 3
    assert by_name["aio.0"].similarity == 0.88  # winner from chunk 2
    assert by_name["aio.0"].why_match == "strong"


def test_run_exhaustive_partial_coverage_decrements_trust():
    """One chunk fails terminally → partial warning + trust decrement."""
    aio_lines = [f"aio.{i}: [F.{i}]" for i in range(400)]  # 2 chunks
    chunk_1 = _ok_chunk_response([
        {"aio_name": "aio.0", "similarity": 0.9},
    ])
    # Both attempts return malformed JSON → terminal failure on chunk 2.
    client = _StubClient([chunk_1, "this is not json", "still not json"])
    result = run_exhaustive(
        client=client,
        matched_aio_lines=aio_lines,
        user_prompt="enumerate",
        num_cues=1,
        chunk_model="claude-haiku-4-5",
        base_trust=1.0,
    )
    assert result.total_chunks == 2
    assert result.successful_chunks == 1
    assert result.failed_chunks == 1
    assert result.failed_chunk_indices == [1]
    assert result.coverage == 0.5
    assert result.trust_score == 0.5  # base_trust * coverage
    assert "1 of 2 chunks failed" in result.warning
    # Successful chunk's match is still surfaced.
    assert len(result.matches) == 1
    assert result.matches[0].aio_name == "aio.0"


def test_run_exhaustive_retry_once_recovers():
    """First attempt malformed, retry succeeds → counted as success, no warning."""
    aio_lines = [f"aio.{i}: [F.{i}]" for i in range(5)]
    bad = "garbage"
    good = _ok_chunk_response([
        {"aio_name": "aio.0", "similarity": 0.85},
    ])
    client = _StubClient([bad, good])
    result = run_exhaustive(
        client=client,
        matched_aio_lines=aio_lines,
        user_prompt="x",
        num_cues=1,
        chunk_model="claude-haiku-4-5",
    )
    assert result.successful_chunks == 1
    assert result.failed_chunks == 0
    assert result.coverage == 1.0
    assert result.warning == ""
    assert len(result.matches) == 1
    # Both attempts were called; tokens accumulated from both.
    assert len(client.messages.calls) == 2


def test_run_exhaustive_api_error_does_not_retry():
    """API errors (not parse errors) skip retry — they're transport-level
    and hammering the API just compounds latency."""
    aio_lines = [f"aio.{i}: [F.{i}]" for i in range(5)]
    err = RuntimeError("rate limit")
    client = _StubClient([err])
    result = run_exhaustive(
        client=client,
        matched_aio_lines=aio_lines,
        user_prompt="x",
        num_cues=1,
        chunk_model="claude-haiku-4-5",
    )
    assert result.failed_chunks == 1
    # Only ONE call made — no retry on API exceptions.
    assert len(client.messages.calls) == 1


def test_run_exhaustive_chunk_model_override_threaded_through():
    """Custom chunk_model lands in every messages.create call."""
    aio_lines = [f"aio.{i}: [F.{i}]" for i in range(3)]
    client = _StubClient([_ok_chunk_response([])])
    run_exhaustive(
        client=client,
        matched_aio_lines=aio_lines,
        user_prompt="x",
        num_cues=1,
        chunk_model="claude-opus-4-7",
    )
    assert client.messages.calls[0]["model"] == "claude-opus-4-7"


def test_run_exhaustive_filters_and_exclusions_in_user_message():
    """Server-applied filters / exclusions get echoed to the chunk LLM
    so its classification stays consistent with what was pushed down."""
    aio_lines = [f"aio.{i}: [F.{i}]" for i in range(3)]
    client = _StubClient([_ok_chunk_response([])])
    run_exhaustive(
        client=client,
        matched_aio_lines=aio_lines,
        user_prompt="x",
        num_cues=1,
        chunk_model="claude-haiku-4-5",
        applied_filters="> 10000000",
        exclusions=["draft", "rejected"],
    )
    user_msg = client.messages.calls[0]["messages"][0]["content"]
    assert "SERVER-APPLIED FILTERS: > 10000000" in user_msg
    assert "SERVER-APPLIED EXCLUSIONS: draft, rejected" in user_msg


def test_run_exhaustive_uses_ephemeral_cache_control():
    """The chunk system prompt should always be marked ephemeral so
    Anthropic prompt-caching kicks in across chunks of the same query."""
    client = _StubClient([_ok_chunk_response([])])
    run_exhaustive(
        client=client,
        matched_aio_lines=["aio.0: [F.0]"],
        user_prompt="x",
        num_cues=1,
        chunk_model="claude-haiku-4-5",
    )
    sys_block = client.messages.calls[0]["system"]
    assert isinstance(sys_block, list)
    assert sys_block[0]["cache_control"] == {"type": "ephemeral"}


# ---------------------------------------------------------------------------
# Render fallback
# ---------------------------------------------------------------------------


def test_render_table_fallback_no_matches():
    from api.exhaustive import ExhaustiveResult
    result = ExhaustiveResult(
        matches=[], total_aios_processed=0, total_chunks=0,
        successful_chunks=0, failed_chunks=0, coverage=1.0,
        trust_score=1.0, chunk_model="claude-haiku-4-5",
    )
    out = render_table_fallback(result)
    assert "No records matched" in out


def test_render_table_fallback_with_warning_includes_coverage():
    from api.exhaustive import ExhaustiveResult
    result = ExhaustiveResult(
        matches=[ChunkMatch(aio_name="a.1", similarity=0.9, why_match="hit")],
        total_aios_processed=10,
        total_chunks=4, successful_chunks=2, failed_chunks=2,
        coverage=0.5, trust_score=0.5,
        warning="⚠️ Exhaustive Live: 2 of 4 chunks failed (coverage 50.0%).",
        chunk_model="claude-haiku-4-5",
    )
    out = render_table_fallback(result)
    assert "⚠️" in out
    assert "50.0%" in out
    # Markdown table headers present.
    assert "| # | Record |" in out
    assert "| 1 | `a.1` | 0.90 |" in out
