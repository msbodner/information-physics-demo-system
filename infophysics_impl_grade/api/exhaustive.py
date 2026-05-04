"""V5.0 Exhaustive Live Mode — chunked map-reduce synthesis.

Solves the V4.6 partial-results failure mode:

  * Live's `diversify_by_csv(matched_aio_lines, cap)` step in chat.py drops
    lower-ranked rows whenever ``len(matched_aio_lines) > cap``. On
    enumeration queries ("list every Division-08 cost code"), the cap
    silently truncates the candidate set and the LLM never sees the rows
    it was supposed to enumerate.
  * The LLM filter step compounds the loss: even within the cap, drift
    in classification ("does this row belong to Division 08?") can omit
    real matches.

Approach B from the design discussion (Lab_Note_Exhaustive_Live_Mode_V46):
  1. Lift the cap on the substrate. All matched AIOs go through.
  2. Split into chunks of ``clamp(100 + 100·|cues|, 200, 800)`` records.
  3. Each chunk is independently classified by a per-chunk LLM call that
     returns a strict JSON schema (``ChunkOutput``).
  4. Per-chunk results are merged in-Python with dedup by ``aio_name``;
     conflicts resolved by ``max(similarity)``.
  5. Failed chunks (parse error after retry-once) are surfaced as a
     coverage warning and the response's ``trust_score`` is decremented
     proportionally.

Operator policies (from user decisions on the lab note):
  1. Per-chunk model: caller-supplied ``chunk_model`` (default Haiku).
  2. Chunk size: ``clamp(100 + 100·|cues|, 200, 800)``.
  3. Conflicts: ``winner = max(candidates, key=lambda m: m.similarity)``.
  4. MRO persistence: one MRO per query, intent ``aio-search-exhaustive``.
  5. Partial results: return with warning + decrement trust_score.

This module is intentionally pure orchestration — DB-bound retrieval
still lives in ``_aio_search_prepare`` (api/routes/chat.py). The route
handler calls this module with the prep output.
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel, Field, ValidationError

from api.llm import get_default_model

logger = logging.getLogger("infophysics.api.exhaustive")


# ---------------------------------------------------------------------------
# Schema models
# ---------------------------------------------------------------------------

class ChunkMatch(BaseModel):
    """A single record the chunk LLM judged to match the query.

    ``aio_name`` is the canonical identifier — it MUST appear in the
    chunk that was sent (the merge step rejects names the LLM made up).
    ``similarity`` is the LLM's self-reported confidence and is the
    sole tie-breaker on conflict resolution.
    """
    aio_name: str
    similarity: float = Field(ge=0.0, le=1.0)
    why_match: str = ""


class ChunkOutput(BaseModel):
    """Strict JSON schema for one chunk's LLM response.

    The LLM never sees ``chunk_index`` / ``chunk_size`` — those are
    injected server-side after the response validates.
    """
    matches: List[ChunkMatch] = Field(default_factory=list)
    failures: List[str] = Field(default_factory=list)


class ExhaustiveResult(BaseModel):
    """Aggregated result from all chunk runs.

    * ``matches`` is the deduped union of every chunk's matches.
    * ``coverage`` is ``successful_chunks / total_chunks`` in [0, 1].
    * ``trust_score`` is decremented by ``coverage`` so a partial
      response carries its uncertainty into MRO ranking.
    * ``warning`` is a non-empty string when any chunk failed.
    """
    matches: List[ChunkMatch] = Field(default_factory=list)
    total_aios_processed: int = 0
    total_chunks: int = 0
    successful_chunks: int = 0
    failed_chunks: int = 0
    failed_chunk_indices: List[int] = Field(default_factory=list)
    coverage: float = 1.0
    trust_score: float = 1.0
    warning: str = ""
    chunk_model: str = ""
    elapsed_ms: int = 0
    input_tokens: int = 0
    output_tokens: int = 0


# ---------------------------------------------------------------------------
# Pure helpers (no I/O — unit-testable)
# ---------------------------------------------------------------------------

# Per-chunk size formula. Settled by user policy decision #2: chunks
# scale linearly with cue cardinality (single-cue queries get tight
# 200-record chunks so each chunk's LLM call stays focused; multi-cue
# enumerations get up to 800 records per chunk so chunk count stays
# reasonable on large corpora).
_CHUNK_SIZE_BASE = 100
_CHUNK_SIZE_PER_CUE = 100
_CHUNK_SIZE_FLOOR = 200
_CHUNK_SIZE_CEILING = 800


def chunk_size_for(num_cues: int) -> int:
    """``clamp(100 + 100 * num_cues, 200, 800)``.

    Mirrors ``adaptive_aio_cap`` in api/search_helpers.py but with a
    different scale — the chunk LLM is doing per-record classification,
    not synthesis, so it tolerates more records per call.
    """
    raw = _CHUNK_SIZE_BASE + _CHUNK_SIZE_PER_CUE * max(0, num_cues)
    return max(_CHUNK_SIZE_FLOOR, min(_CHUNK_SIZE_CEILING, raw))


def chunk_aios(aio_lines: List[str], size: int) -> List[List[str]]:
    """Split a flat list into contiguous chunks of ``size`` records.

    The last chunk may be smaller. Empty input returns an empty list.
    """
    if not aio_lines:
        return []
    if size <= 0:
        return [list(aio_lines)]
    return [aio_lines[i:i + size] for i in range(0, len(aio_lines), size)]


def merge_results(
    per_chunk: List[ChunkOutput],
    sent_names: set[str],
) -> List[ChunkMatch]:
    """Merge per-chunk matches into a deduped, similarity-ordered list.

    Conflict resolution (policy decision #3): when the same ``aio_name``
    appears in multiple chunks (rare but possible if the upstream
    retrieval has duplicates), the match with the higher ``similarity``
    wins. ``why_match`` from the winning entry is kept verbatim.

    Hallucination guard: matches whose ``aio_name`` was not in ``sent_names``
    are dropped — the LLM occasionally invents records that look
    plausible. The merge step is the last opportunity to catch them.
    """
    by_name: Dict[str, ChunkMatch] = {}
    dropped_hallucinations = 0
    for chunk in per_chunk:
        for match in chunk.matches:
            if sent_names and match.aio_name not in sent_names:
                dropped_hallucinations += 1
                continue
            existing = by_name.get(match.aio_name)
            if existing is None or match.similarity > existing.similarity:
                by_name[match.aio_name] = match
    if dropped_hallucinations:
        logger.info(
            "Exhaustive merge: dropped %d hallucinated aio_names",
            dropped_hallucinations,
        )
    # Stable sort: highest similarity first, then alphabetical for ties
    # so the rendered table is reproducible.
    return sorted(
        by_name.values(),
        key=lambda m: (-m.similarity, m.aio_name),
    )


def coverage_for(successful: int, total: int) -> float:
    """``successful / total`` in [0, 1]; 1.0 when total == 0."""
    if total <= 0:
        return 1.0
    return max(0.0, min(1.0, successful / total))


def decrement_trust_for_coverage(base_trust: float, coverage: float) -> float:
    """Multiply trust by coverage so partial responses carry uncertainty.

    A 100%-coverage exhaustive run keeps ``base_trust`` unchanged. A 50%
    coverage run halves it. The MRO trust ranker uses this directly,
    so a partial Exhaustive response is downranked next time the same
    query reappears.
    """
    return max(0.0, min(1.0, base_trust * coverage))


# ---------------------------------------------------------------------------
# JSON parsing — tolerant of fenced blocks
# ---------------------------------------------------------------------------

_FENCED_JSON_RE = re.compile(r"```(?:json)?\s*(.+?)\s*```", re.DOTALL)


def _strip_json_fence(text: str) -> str:
    """Strip Markdown ``` fences if the LLM wrapped the JSON.

    Both ``\\`\\`\\`json\\n…\\n\\`\\`\\``` and bare ``\\`\\`\\`\\n…\\n\\`\\`\\``` are handled.
    The LLM is instructed not to fence, but Haiku occasionally does it
    anyway and the guard is one regex.
    """
    text = (text or "").strip()
    if not text.startswith("```"):
        return text
    m = _FENCED_JSON_RE.search(text)
    if m:
        return m.group(1).strip()
    return text


def parse_chunk_output(raw: str) -> ChunkOutput:
    """Parse + validate a chunk LLM response into ``ChunkOutput``.

    Raises ``ValidationError`` (pydantic) or ``json.JSONDecodeError`` on
    malformed input — the caller catches these to trigger the
    retry-once policy.
    """
    cleaned = _strip_json_fence(raw)
    obj = json.loads(cleaned)
    return ChunkOutput.model_validate(obj)


# ---------------------------------------------------------------------------
# Per-chunk LLM call (with retry-once)
# ---------------------------------------------------------------------------

# Per-chunk system prompt. Stable across chunks of the same query so the
# Anthropic prompt cache (5min TTL ephemeral) gives us the 90% read
# discount on every chunk after the first.
_CHUNK_SYSTEM_PROMPT = (
    "You are a record classifier for AIO bracket-notation data.\n"
    "Each AIO record is a single line beginning with 'NAME: ' followed by "
    "concatenated [Field.Value] tokens.\n\n"
    "TASK:\n"
    "From the chunk of records the user provides, return ONLY those records "
    "that genuinely match the user's query. For each match, return its "
    "exact NAME (the prefix before ': '), a similarity score in [0.0, 1.0] "
    "indicating how confident you are, and one short sentence explaining "
    "why it matches.\n\n"
    "RULES:\n"
    "  * Apply numeric / categorical / typo / exclusion filters from the "
    "    query — same rules as Live Search. Drop records that don't satisfy.\n"
    "  * Return ONLY records that appear in the chunk. Do NOT invent names.\n"
    "  * If the query is an enumeration ('list all X'), be inclusive — "
    "    return every record that plausibly matches, not just the top-K.\n"
    "  * Use ``why_match`` to point to the specific bracket token "
    "    (e.g. \"[CSI_Division.08]\") that triggered the match.\n"
    "  * If a record is malformed or you can't classify it, push a brief "
    "    reason into ``failures`` and skip it.\n\n"
    "OUTPUT FORMAT — return ONLY valid JSON, no prose, no Markdown fences:\n"
    "{\n"
    '  "matches": [\n'
    '    {"aio_name": "<exact NAME>", "similarity": 0.95, "why_match": "..."}\n'
    "  ],\n"
    '  "failures": ["<brief reason>", ...]\n'
    "}\n"
)


def _build_chunk_user_message(
    user_prompt: str,
    chunk_records: List[str],
    chunk_index: int,
    total_chunks: int,
    applied_filters: str = "",
    exclusions: Optional[List[str]] = None,
) -> str:
    """Compose the per-chunk user message.

    Includes the user's original query verbatim plus the chunk records.
    Server-side filters (numeric, exclusions) are echoed to the LLM so
    its classification aligns with what was already pushed down.
    """
    parts: List[str] = []
    parts.append(f"QUERY: {user_prompt}")
    if applied_filters:
        parts.append(f"SERVER-APPLIED FILTERS: {applied_filters}")
    if exclusions:
        parts.append("SERVER-APPLIED EXCLUSIONS: " + ", ".join(exclusions))
    parts.append(
        f"\nCHUNK {chunk_index + 1} of {total_chunks} ({len(chunk_records)} records):"
    )
    parts.extend(chunk_records)
    parts.append("\nReturn the JSON object now.")
    return "\n".join(parts)


def synthesize_chunk(
    client: Any,
    chunk_records: List[str],
    chunk_index: int,
    total_chunks: int,
    user_prompt: str,
    chunk_model: str,
    applied_filters: str = "",
    exclusions: Optional[List[str]] = None,
    max_tokens: int = 4096,
) -> Tuple[Optional[ChunkOutput], int, int, Optional[str]]:
    """Call the chunk LLM once, with retry-once on malformed JSON.

    Returns ``(output, input_tokens, output_tokens, error_reason)``:
      * On success: ``(ChunkOutput, in_tok, out_tok, None)``
      * On terminal failure (after retry): ``(None, in_tok, out_tok, reason)``

    The ``client`` parameter is an ``anthropic.Anthropic`` instance.
    Passing it in (rather than constructing here) lets the orchestrator
    reuse a single client across all chunks and lets tests inject a
    stub that mimics ``client.messages.create``.
    """
    user_msg = _build_chunk_user_message(
        user_prompt=user_prompt,
        chunk_records=chunk_records,
        chunk_index=chunk_index,
        total_chunks=total_chunks,
        applied_filters=applied_filters,
        exclusions=exclusions,
    )

    in_tok_total = 0
    out_tok_total = 0
    last_err: Optional[str] = None

    for attempt in range(2):  # initial + one retry
        try:
            resp = client.messages.create(
                model=chunk_model,
                max_tokens=max_tokens,
                system=[{
                    "type": "text",
                    "text": _CHUNK_SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }],
                messages=[{"role": "user", "content": user_msg}],
            )
        except Exception as exc:
            last_err = f"anthropic call failed: {exc}"
            logger.info(
                "Exhaustive chunk %d/%d attempt %d: API error: %s",
                chunk_index + 1, total_chunks, attempt + 1, exc,
            )
            # Don't retry on API errors — those are transport-level and
            # hammering them just compounds the latency. JSON-parse
            # errors are the only retry-worthy failure mode.
            return None, in_tok_total, out_tok_total, last_err

        in_tok_total += getattr(resp.usage, "input_tokens", 0) or 0
        out_tok_total += getattr(resp.usage, "output_tokens", 0) or 0
        raw = resp.content[0].text if resp.content else ""

        try:
            parsed = parse_chunk_output(raw)
            if attempt > 0:
                logger.info(
                    "Exhaustive chunk %d/%d: recovered on retry",
                    chunk_index + 1, total_chunks,
                )
            return parsed, in_tok_total, out_tok_total, None
        except (json.JSONDecodeError, ValidationError) as exc:
            last_err = f"JSON parse: {exc}"
            logger.info(
                "Exhaustive chunk %d/%d attempt %d: malformed JSON: %.120s",
                chunk_index + 1, total_chunks, attempt + 1, str(exc),
            )
            # Fall through to retry on the next loop iteration; second
            # iteration falls through to the terminal return below.

    return None, in_tok_total, out_tok_total, last_err


# ---------------------------------------------------------------------------
# Top-level orchestrator
# ---------------------------------------------------------------------------


def _extract_aio_name(line: str) -> str:
    """Extract the leading NAME from an AIO line.

    Each line is "NAME: [Key.Val][Key.Val]…" — the name is everything
    before the first ': '. Mirrors the shipping format from chat.py's
    ``_add_aio_row``.
    """
    if not line:
        return ""
    head, _sep, _rest = line.partition(":")
    return head.strip()


def run_exhaustive(
    *,
    client: Any,
    matched_aio_lines: List[str],
    user_prompt: str,
    num_cues: int,
    chunk_model: Optional[str] = None,
    applied_filters: str = "",
    exclusions: Optional[List[str]] = None,
    base_trust: float = 1.0,
    max_chunk_tokens: int = 4096,
) -> ExhaustiveResult:
    """Run the full chunked map-reduce over ``matched_aio_lines``.

    Args:
      client: ``anthropic.Anthropic`` instance (or a stub with the same
              ``messages.create`` shape, used by tests).
      matched_aio_lines: full output from ``_aio_search_prepare`` —
              all matched AIOs, NOT capped or diversified.
      user_prompt: the user's natural-language query, passed verbatim to
              every chunk.
      num_cues: extracted needle/cue count, used to pick the chunk size.
      chunk_model: model SKU for chunk classification (e.g.
              ``claude-haiku-4-5``). Falls back to ``get_default_model()``
              when None.
      applied_filters / exclusions: server-side pushdowns echoed to
              the chunk LLM so its filtering aligns with what's already
              been done.
      base_trust: starting trust score; gets multiplied by coverage.
      max_chunk_tokens: per-chunk LLM ``max_tokens`` budget.
    """
    t0 = time.perf_counter()
    model = chunk_model or get_default_model()

    if not matched_aio_lines:
        return ExhaustiveResult(
            matches=[],
            total_aios_processed=0,
            total_chunks=0,
            successful_chunks=0,
            failed_chunks=0,
            failed_chunk_indices=[],
            coverage=1.0,
            trust_score=base_trust,
            warning="",
            chunk_model=model,
            elapsed_ms=int((time.perf_counter() - t0) * 1000),
        )

    size = chunk_size_for(num_cues)
    chunks = chunk_aios(matched_aio_lines, size)
    total_chunks = len(chunks)

    sent_names: set[str] = set()
    for line in matched_aio_lines:
        name = _extract_aio_name(line)
        if name:
            sent_names.add(name)

    logger.info(
        "Exhaustive run: %d AIOs → %d chunks of size %d (model=%s, cues=%d)",
        len(matched_aio_lines), total_chunks, size, model, num_cues,
    )

    per_chunk_outputs: List[ChunkOutput] = []
    failed_indices: List[int] = []
    in_tok_total = 0
    out_tok_total = 0

    for i, chunk in enumerate(chunks):
        output, in_tok, out_tok, err = synthesize_chunk(
            client=client,
            chunk_records=chunk,
            chunk_index=i,
            total_chunks=total_chunks,
            user_prompt=user_prompt,
            chunk_model=model,
            applied_filters=applied_filters,
            exclusions=exclusions,
            max_tokens=max_chunk_tokens,
        )
        in_tok_total += in_tok
        out_tok_total += out_tok
        if output is None:
            failed_indices.append(i)
            logger.warning(
                "Exhaustive chunk %d/%d failed terminally: %s",
                i + 1, total_chunks, err,
            )
        else:
            per_chunk_outputs.append(output)

    successful_chunks = len(per_chunk_outputs)
    failed_chunks = len(failed_indices)
    cov = coverage_for(successful_chunks, total_chunks)
    trust = decrement_trust_for_coverage(base_trust, cov)

    merged = merge_results(per_chunk_outputs, sent_names)

    warning = ""
    if failed_chunks:
        warning = (
            f"⚠️ Exhaustive Live: {failed_chunks} of {total_chunks} chunks "
            f"failed (coverage {cov*100:.1f}%). Results below may be "
            f"incomplete; trust_score reduced from {base_trust:.2f} "
            f"to {trust:.2f}."
        )
        logger.warning(
            "Exhaustive partial: %d/%d chunks failed (indices=%s, coverage=%.3f)",
            failed_chunks, total_chunks, failed_indices, cov,
        )

    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    logger.info(
        "Exhaustive run complete: %d matches from %d AIOs in %d chunks "
        "(coverage=%.3f, trust=%.3f, %dms, in=%d out=%d)",
        len(merged), len(matched_aio_lines), total_chunks,
        cov, trust, elapsed_ms, in_tok_total, out_tok_total,
    )

    return ExhaustiveResult(
        matches=merged,
        total_aios_processed=len(matched_aio_lines),
        total_chunks=total_chunks,
        successful_chunks=successful_chunks,
        failed_chunks=failed_chunks,
        failed_chunk_indices=failed_indices,
        coverage=cov,
        trust_score=trust,
        warning=warning,
        chunk_model=model,
        elapsed_ms=elapsed_ms,
        input_tokens=in_tok_total,
        output_tokens=out_tok_total,
    )


# ---------------------------------------------------------------------------
# Optional render step — turn the merged matches into prose / a table
# ---------------------------------------------------------------------------

# Render system prompt. Used only when the caller asks for prose output.
# The chunk LLM gives us structured matches; this LLM turns them into a
# user-facing answer that respects the same Live Search style guide.
_RENDER_SYSTEM_PROMPT = (
    "You are ChatAIO. You receive a JSON list of matched AIO records "
    "selected by the Exhaustive Live pipeline.\n\n"
    "Render a concise, well-structured answer to the user's query, "
    "grounded in the matches. When the query is an enumeration "
    "('list all X'), present the matches as a numbered list or "
    "table. When the query is a count, state the total and show "
    "the breakdown. Cite the exact aio_name when referring to a "
    "specific record.\n\n"
    "If a coverage warning is included, surface it at the TOP of "
    "your answer so the user knows the result may be partial.\n"
)


def render_matches(
    *,
    client: Any,
    user_prompt: str,
    result: ExhaustiveResult,
    matched_aio_lines: List[str],
    render_model: Optional[str] = None,
    max_tokens: int = 2048,
) -> Tuple[str, int, int]:
    """Render merged matches as user-facing prose via one LLM call.

    Returns ``(reply_text, input_tokens, output_tokens)``.

    The render LLM gets the merged matches plus the original chunk
    records (so it can cite specific bracket tokens). On call failure
    we fall back to a plain Markdown table built locally.
    """
    model = render_model or get_default_model()

    # Build a name→full-line index so the render prompt can include the
    # full bracket tokens for each match (the chunk output only has
    # name + similarity + why_match).
    line_by_name: Dict[str, str] = {}
    for line in matched_aio_lines:
        name = _extract_aio_name(line)
        if name and name not in line_by_name:
            line_by_name[name] = line

    payload_matches = []
    for m in result.matches:
        payload_matches.append({
            "aio_name": m.aio_name,
            "similarity": round(m.similarity, 3),
            "why_match": m.why_match,
            "record": line_by_name.get(m.aio_name, ""),
        })

    payload = {
        "query": user_prompt,
        "total_matches": len(result.matches),
        "total_aios_processed": result.total_aios_processed,
        "coverage": round(result.coverage, 3),
        "warning": result.warning,
        "matches": payload_matches,
    }

    try:
        resp = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=[{
                "type": "text",
                "text": _RENDER_SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }],
            messages=[{
                "role": "user",
                "content": (
                    f"USER QUERY: {user_prompt}\n\n"
                    f"EXHAUSTIVE MATCHES (JSON):\n{json.dumps(payload, ensure_ascii=False)}"
                ),
            }],
        )
        in_tok = getattr(resp.usage, "input_tokens", 0) or 0
        out_tok = getattr(resp.usage, "output_tokens", 0) or 0
        return resp.content[0].text, in_tok, out_tok
    except Exception as exc:
        logger.warning(
            "Exhaustive render LLM failed (%s); falling back to local table.",
            exc,
        )
        return render_table_fallback(result, line_by_name), 0, 0


def render_table_fallback(
    result: ExhaustiveResult,
    line_by_name: Optional[Dict[str, str]] = None,
) -> str:
    """Build a plain-Markdown table of matches without an LLM call.

    Used when the render LLM call fails so the user still sees their
    matches. Format mirrors ChatAIO's table conventions.
    """
    lines: List[str] = []
    if result.warning:
        lines.append(result.warning)
        lines.append("")
    if not result.matches:
        lines.append("No records matched the query.")
        return "\n".join(lines)
    lines.append(
        f"**Exhaustive Live found {len(result.matches)} matches** "
        f"across {result.total_aios_processed} processed records "
        f"(coverage: {result.coverage*100:.1f}%, model: {result.chunk_model})."
    )
    lines.append("")
    lines.append("| # | Record | Similarity | Why match |")
    lines.append("|---|--------|-----------:|-----------|")
    for i, m in enumerate(result.matches, 1):
        why = m.why_match.replace("|", "\\|")
        lines.append(
            f"| {i} | `{m.aio_name}` | {m.similarity:.2f} | {why} |"
        )
    return "\n".join(lines)


__all__ = [
    "ChunkMatch",
    "ChunkOutput",
    "ExhaustiveResult",
    "chunk_size_for",
    "chunk_aios",
    "merge_results",
    "coverage_for",
    "decrement_trust_for_coverage",
    "parse_chunk_output",
    "synthesize_chunk",
    "run_exhaustive",
    "render_matches",
    "render_table_fallback",
]
