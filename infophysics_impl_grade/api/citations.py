"""Citation-back post-pass.

After Claude returns an answer, we walk the bundle of AIO records that
were *shipped* and check which ones the answer text actually references
— either by name match or by a sufficiently distinctive value match
(numbers, names with ≥4 chars, etc.). The result feeds a
``sources_used`` field on the response so the dialog can show
"sources used: 12 of 300" with click-through provenance.

Why fuzzy / regex rather than asking the model to cite?
  * Cheaper — zero extra LLM tokens.
  * More honest — we measure what the model actually quoted, not what
    it claims to have quoted.
  * Works for non-citing answers too (summaries, denials, "no record
    matched") — those legitimately use 0 of N AIOs.

False-positive defense:
  * Skip stopwords and tokens shorter than 4 chars.
  * Require the value (or aio_name) to appear as a whole word, not a
    substring of another word.
  * Currency / numbers must match including the unit context (e.g.
    "10000000" alone counts; the digit "1" buried in a sentence does
    not).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, List, Set


_VALUE_RE = re.compile(r"\[([^\[\]]+?)\.([^\[\]]+?)\]")
_TOKEN_RE = re.compile(r"\b[\w$.,'-]{4,}\b")
_STOPWORDS = {
    "the", "and", "for", "with", "from", "this", "that", "into", "over",
    "under", "what", "where", "when", "their", "there", "those", "these",
    "have", "been", "will", "would", "could", "should", "your", "yours",
    "ours", "they", "them", "such", "than", "then", "also", "more", "most",
    "less", "very", "just", "only", "some", "any", "each", "many", "much",
}


@dataclass
class CitationStat:
    aio_name: str
    score: int          # number of distinctive tokens that matched
    matched_tokens: List[str]


def _distinctive_tokens(record_line: str) -> Set[str]:
    """Pull tokens that are strong-enough citation signals.

    Sources:
      * The bracket VALUES: ``[Field.Value]`` → the Value side.
      * Standalone numeric/currency tokens (≥3 chars after stripping $, ,).
      * The ``aio_name`` prefix (the part before ":").
    """
    out: Set[str] = set()
    if not record_line:
        return out

    # aio_name (head before first colon).
    head = record_line.split(":", 1)[0].strip()
    if head and len(head) >= 4:
        out.add(head.lower())

    for m in _VALUE_RE.finditer(record_line):
        value = (m.group(2) or "").strip()
        if not value:
            continue
        v_low = value.lower()
        if v_low in _STOPWORDS:
            continue
        if len(v_low) >= 4:
            out.add(v_low)
        # Also tokenize multi-word values into their parts so
        # "Sarah Mitchell" → {"sarah mitchell", "sarah", "mitchell"}.
        for tok in _TOKEN_RE.findall(v_low):
            if len(tok) >= 4 and tok not in _STOPWORDS:
                out.add(tok)
        # Numeric — strip $ and commas.
        bare = re.sub(r"[\$,]", "", v_low)
        if bare.replace(".", "", 1).isdigit() and len(bare) >= 3:
            out.add(bare)

    return out


def _normalize_answer(answer_text: str) -> str:
    """Lowercase + strip currency markers so "10,000,000" matches "10000000"."""
    if not answer_text:
        return ""
    s = answer_text.lower()
    # Strip thousands separators inside numeric runs only — preserve
    # commas in prose for sentence structure.
    s = re.sub(r"(\d),(?=\d{3}\b)", r"\1", s)
    return s


def cite_aios(answer_text: str, record_lines: Iterable[str]) -> List[CitationStat]:
    """Return citation stats sorted by descending score.

    Only AIOs that contributed at least one distinctive matching token
    are included. Score is the count of distinct matched tokens — a rough
    proxy for "how much of this AIO is actually quoted in the answer".
    """
    if not answer_text:
        return []
    norm_answer = _normalize_answer(answer_text)
    out: List[CitationStat] = []
    for line in record_lines:
        head = (line.split(":", 1)[0].strip() if line else "")
        if not head:
            continue
        tokens = _distinctive_tokens(line)
        matched: List[str] = []
        for t in tokens:
            # Word-boundary probe.  The token may itself contain
            # punctuation (e.g. dotted names) so use a contains check
            # surrounded by non-word boundaries when possible.
            if len(t) >= 4 and re.search(rf"(?:^|\W){re.escape(t)}(?:\W|$)", norm_answer):
                matched.append(t)
        if matched:
            out.append(CitationStat(
                aio_name=head,
                score=len(matched),
                matched_tokens=matched[:5],  # cap so the payload stays small
            ))
    out.sort(key=lambda c: (-c.score, c.aio_name))
    return out


def summarize_citations(stats: List[CitationStat], total_shipped: int) -> dict:
    """Shape the citation result for the API response.

    The frontend renders this as "sources used: N of M" with the cited
    AIO names available for click-through. We cap the per-source token
    list at 5 so the bundle metadata doesn't bloat for chatty answers.
    """
    return {
        "shipped": int(total_shipped),
        "cited": len(stats),
        "sources": [
            {"aio_name": s.aio_name, "score": s.score, "tokens": s.matched_tokens}
            for s in stats
        ],
    }


__all__ = ["cite_aios", "summarize_citations", "CitationStat"]
