"""Search helpers: filter parsing, exclusion cues, adaptive cap.

Pulled out of chat.py to keep the AIO Search pipeline readable. Each
helper is a pure function over strings — no DB state, no I/O — so they
can be unit-tested independently and the chat pipeline can layer them
in without changing its control flow.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, List, Optional, Tuple


# ── Numeric / date predicate pushdown (#2) ─────────────────────────────


@dataclass
class _NumericFilter:
    """A single numeric or date filter parsed from the query.

    Examples:
      "over $10M"       → op=">", value=10_000_000.0, kind="number"
      "after 2020"      → op=">", value=2020,         kind="year"
      "at least 5"      → op=">=", value=5,           kind="number"
      "between 10 and 50" → emitted as TWO filters: >=10 AND <=50
    """
    op: str       # one of: '>', '>=', '<', '<=', '='
    value: float
    kind: str     # 'number' | 'year' | 'currency'
    raw: str      # the matched phrase, for "Filter: …" reporting


_GT_TOKENS = (
    "over", "above", "more than", "greater than", "exceeding", "exceeds", ">",
)
_GTE_TOKENS = ("at least", "no less than", "minimum of", ">=", "≥")
_LT_TOKENS = ("under", "below", "less than", "fewer than", "<")
_LTE_TOKENS = ("at most", "no more than", "maximum of", "<=", "≤")

# "after 2020" is gt for years; "before 1995" is lt.
_AFTER_TOKENS = ("after", "since", "from")
_BEFORE_TOKENS = ("before", "prior to", "until")


def _parse_amount(s: str) -> Optional[float]:
    """Parse "$10M", "1.5B", "10,000", "5k" → float. Returns None on miss."""
    if not s:
        return None
    s = s.strip().replace(",", "")
    s = s.lstrip("$€£")
    m = re.match(r"^(-?\d+(?:\.\d+)?)\s*([kKmMbB])?$", s)
    if not m:
        # Try plain integer / decimal as final fallback.
        try:
            return float(s)
        except ValueError:
            return None
    value = float(m.group(1))
    suffix = (m.group(2) or "").lower()
    mult = {"k": 1_000.0, "m": 1_000_000.0, "b": 1_000_000_000.0}.get(suffix, 1.0)
    return value * mult


def parse_filters(text: str) -> List[_NumericFilter]:
    """Extract numeric/date predicates from a natural-language query.

    Conservative by design: only emits a filter when both the operator
    AND a parseable amount are present, so a query like "over the limit"
    (no number) doesn't accidentally produce a useless filter.
    """
    if not text:
        return []
    out: List[_NumericFilter] = []
    lower = text.lower()

    # ── Comparator + amount, currency-aware ──
    # Pattern: <token> <amount-with-optional-$-and-unit>
    op_groups: List[Tuple[str, Tuple[str, ...]]] = [
        (">",  _GT_TOKENS),
        (">=", _GTE_TOKENS),
        ("<",  _LT_TOKENS),
        ("<=", _LTE_TOKENS),
    ]
    for op, tokens in op_groups:
        for tok in tokens:
            # \$? optionally — match the currency sign so "$10M" is captured.
            pattern = rf"{re.escape(tok)}\s+\$?(-?\d[\d,]*\.?\d*)\s*([kKmMbB])?"
            for m in re.finditer(pattern, lower):
                amount_str = m.group(1) + (m.group(2) or "")
                amt = _parse_amount(amount_str)
                if amt is None:
                    continue
                out.append(_NumericFilter(op=op, value=amt, kind="number", raw=m.group(0)))

    # ── "between A and B" → two filters ──
    for m in re.finditer(
        r"between\s+\$?(-?\d[\d,]*\.?\d*)\s*([kKmMbB])?\s+and\s+\$?(-?\d[\d,]*\.?\d*)\s*([kKmMbB])?",
        lower,
    ):
        lo = _parse_amount(m.group(1) + (m.group(2) or ""))
        hi = _parse_amount(m.group(3) + (m.group(4) or ""))
        if lo is not None and hi is not None and lo <= hi:
            out.append(_NumericFilter(op=">=", value=lo, kind="number", raw=m.group(0)))
            out.append(_NumericFilter(op="<=", value=hi, kind="number", raw=m.group(0)))

    # ── Year predicates ──
    for tok in _AFTER_TOKENS:
        for m in re.finditer(rf"{re.escape(tok)}\s+(\d{{4}})", lower):
            year = float(m.group(1))
            if 1900 <= year <= 2100:
                out.append(_NumericFilter(op=">", value=year, kind="year", raw=m.group(0)))
    for tok in _BEFORE_TOKENS:
        for m in re.finditer(rf"{re.escape(tok)}\s+(\d{{4}})", lower):
            year = float(m.group(1))
            if 1900 <= year <= 2100:
                out.append(_NumericFilter(op="<", value=year, kind="year", raw=m.group(0)))

    return out


_NUMBER_IN_RECORD = re.compile(r"-?\$?\d[\d,]*\.?\d*\s*[kKmMbB]?")
_YEAR_IN_RECORD = re.compile(r"\b(19|20)\d{2}\b")


def _record_satisfies(record_text: str, flt: _NumericFilter) -> bool:
    """Test whether a record's serialized text contains a number that
    satisfies this filter. We extract every numeric token and accept the
    record if ANY of them satisfies — this mirrors the LLM's own
    behavior of scanning the record for the relevant value rather than
    requiring a specific column.
    """
    if not record_text:
        return False
    if flt.kind == "year":
        candidates = [_parse_amount(m.group(0)) for m in _YEAR_IN_RECORD.finditer(record_text)]
    else:
        candidates = [_parse_amount(m.group(0)) for m in _NUMBER_IN_RECORD.finditer(record_text)]
    candidates = [c for c in candidates if c is not None]
    if not candidates:
        # No comparable value present — treat as non-matching to mirror
        # the chat.py "missing field ⇒ omit" rule.
        return False
    op = flt.op
    target = flt.value
    for c in candidates:
        if op == ">"  and c >  target: return True
        if op == ">=" and c >= target: return True
        if op == "<"  and c <  target: return True
        if op == "<=" and c <= target: return True
        if op == "="  and c == target: return True
    return False


def apply_filters(
    record_lines: List[str],
    filters: List[_NumericFilter],
) -> List[str]:
    """Apply parsed filters to a list of "name: [Key.Val][Key.Val]…" lines.

    Conjunctive: a record must satisfy ALL filters. Returns the survivors.
    """
    if not filters:
        return record_lines
    out: List[str] = []
    for line in record_lines:
        if all(_record_satisfies(line, f) for f in filters):
            out.append(line)
    return out


def describe_filters(filters: List[_NumericFilter]) -> str:
    """Render filters for the answer prompt's "Filter: …" reporting line."""
    if not filters:
        return ""
    parts = []
    for f in filters:
        if f.kind == "year":
            parts.append(f"{f.op} {int(f.value)}")
        elif f.value >= 1_000_000:
            parts.append(f"{f.op} {f.value / 1_000_000:g}M")
        elif f.value >= 1_000:
            parts.append(f"{f.op} {f.value / 1_000:g}K")
        else:
            parts.append(f"{f.op} {f.value:g}")
    return " AND ".join(parts)


# ── Negative-cue parsing (#3) ─────────────────────────────────────────


_NEG_TOKENS = (
    r"\bnot\b",
    r"\bexcept\b",
    r"\bexcluding\b",
    r"\bexclude\b",
    r"\bwithout\b",
    r"\bother than\b",
    r"\bbut not\b",
)


def parse_exclusions(text: str) -> List[str]:
    """Extract values that should be EXCLUDED from results.

    Looks for "X not Y", "X except Y", "X excluding Y", "X without Y" —
    grabs Y as a free phrase up to the next clause boundary (period,
    comma, "and", "or", end of string).

    Returns lower-cased phrases; the caller drops AIOs whose serialized
    text contains any of them as a substring.
    """
    if not text:
        return []
    out: List[str] = []
    lower = text.lower()
    for tok_pat in _NEG_TOKENS:
        # Match tok then capture the next phrase up to a clause delimiter.
        pattern = tok_pat + r"\s+([a-z0-9\-_'\.\s]{2,60}?)(?=[,.?!;]| and | or |$)"
        for m in re.finditer(pattern, lower):
            phrase = m.group(1).strip()
            # Drop trailing junk words.
            phrase = re.sub(r"\b(the|a|an|any|all|some)\s+", "", phrase).strip()
            if len(phrase) >= 2:
                out.append(phrase)
    # De-dupe while preserving order.
    return list(dict.fromkeys(out))


def apply_exclusions(record_lines: List[str], exclusions: List[str]) -> List[str]:
    """Drop record lines whose lowercase text contains any exclusion phrase."""
    if not exclusions:
        return record_lines
    out: List[str] = []
    for line in record_lines:
        low = line.lower()
        if any(ex in low for ex in exclusions):
            continue
        out.append(line)
    return out


# ── Adaptive bundle sizing (#5) ───────────────────────────────────────


def adaptive_aio_cap(num_cues: int, *, base: int = 50, per_cue: int = 50,
                     floor: int = 100, ceiling: int = 300) -> int:
    """Compute the AIO context cap as a function of cue count.

    Single-cue queries ("show me Vance") get a tight bundle so Claude
    doesn't drown in noise. Multi-cue queries ("Vance AND Houston AND
    2024") get a wider bundle because each additional cue narrows the
    candidate set and we want more breadth per cue.
    """
    raw = base + per_cue * max(0, num_cues)
    return max(floor, min(ceiling, raw))


# ── Field-aware needle split (#1) ─────────────────────────────────────


def split_field_needles(
    field_values: List[dict],
    free_keywords: List[str],
) -> Tuple[List[Tuple[str, str]], List[str]]:
    """Split parsed search_terms into (field-restricted, free) needle lists.

    Field-restricted needles probe the ``(field_name, value_lower)``
    compound index in information_element_refs and rank above free hits
    on the same value, since "[Project.Vance]" is stronger evidence than
    a stray "vance" in a comment field.

    Returns:
        field_needles: List of (field_name, value_lower) tuples.
        free_needles:  List of value_lower strings.
    """
    fnl: List[Tuple[str, str]] = []
    seen = set()
    for fv in field_values or []:
        field = (fv.get("field") or "").strip()
        value = (fv.get("value") or "").strip().lower()
        if field and value:
            key = (field, value)
            if key not in seen:
                seen.add(key)
                fnl.append(key)
    free: List[str] = []
    for kw in free_keywords or []:
        v = (kw or "").strip().lower()
        if v and len(v) >= 2:
            free.append(v)
    return fnl, list(dict.fromkeys(free))


__all__ = [
    "parse_filters",
    "apply_filters",
    "describe_filters",
    "parse_exclusions",
    "apply_exclusions",
    "adaptive_aio_cap",
    "split_field_needles",
]


# Predicate helper exported for re-rank scoring (used for boost weighting).
def predicate_score(record_text: str, filters: List[_NumericFilter]) -> float:
    """Smooth 0..1 indicator of how well a record satisfies the filters.

    Used as a soft re-rank input: a record that fails any filter scores 0,
    a record that satisfies all of them scores 1. Hard ``apply_filters``
    drops the failures outright; ``predicate_score`` lets borderline
    cases be ranked by other signals first when no filter exists.
    """
    if not filters:
        return 1.0
    return 1.0 if all(_record_satisfies(record_text, f) for f in filters) else 0.0
