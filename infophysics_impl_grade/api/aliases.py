"""Synonym / alias expansion for cue extraction.

Two sources, merged at lookup time:
  1. ``acronyms.json`` — a static dictionary maintained in-repo. Edits
     ship with code; small enough to read once at module import.
  2. ``entity_aliases`` — the per-tenant table from migration 001 that
     was previously orphaned (no caller). Tenant-specific aliases live
     here; an admin / ingestion pipeline can populate them.

The helper expands a value to ``{value, alias_1, alias_2, …}`` so the
needle list given to retrieval covers paraphrases the user almost
certainly meant. e.g. typing "Inc" in a query also probes the index
for "Incorporated"; "10M" also probes for "10000000".

Field-aware disambiguation: "Dr." means "Drive" inside ``[Address.*]``
and "Doctor" inside ``[Employee.*]`` — when the parser knows the field
context, only the field-appropriate expansions are emitted. Without a
field, the global pool plus ALL field-specific aliases are emitted (the
broader recall side of the recall-vs-filter rubric).
"""

from __future__ import annotations

import json
import logging
import os
import re
from functools import lru_cache
from typing import Dict, List, Optional, Set, Tuple

from api.db import db, set_tenant

logger = logging.getLogger("infophysics.api.aliases")


_ACRONYMS_PATH = os.path.join(os.path.dirname(__file__), "acronyms.json")


@lru_cache(maxsize=1)
def _load_acronyms() -> dict:
    """Read ``acronyms.json`` once. Cached for the process lifetime."""
    try:
        with open(_ACRONYMS_PATH, "r", encoding="utf-8") as fp:
            return json.load(fp)
    except Exception as exc:
        logger.warning("acronyms.json unreadable (%s) — alias layer disabled", exc)
        return {"global": {}, "by_field": {}, "numeric_suffixes": {}}


def _normalize(s: str) -> str:
    """Lowercase, strip surrounding punctuation, collapse internal spaces."""
    if not s:
        return ""
    return re.sub(r"\s+", " ", s.strip().strip(".,;:!?'\"()[]{}").lower())


def _static_lookup(value: str, field: Optional[str]) -> Set[str]:
    """Return the static-dictionary aliases for ``value``.

    Tries (in order):
      * field-specific dict if a field is provided AND it exists
      * global dict
    Hit on either side returns BOTH the original value and the aliases
    so the caller can de-dupe against its existing needle list.
    """
    data = _load_acronyms()
    norm = _normalize(value)
    if not norm:
        return set()
    out: Set[str] = set()

    # Field-specific first — wins over global on conflict (Dr. vs Drive/Doctor).
    if field:
        bucket = data.get("by_field", {}).get(field, {})
        if norm in bucket:
            out.update(_normalize(a) for a in bucket[norm])
            return out
        # Reverse lookup: maybe the user typed the expanded form already.
        for k, aliases in bucket.items():
            if norm in (_normalize(a) for a in aliases):
                out.add(_normalize(k))
                out.update(_normalize(a) for a in aliases if _normalize(a) != norm)
                return out

    # Global dict.
    glb = data.get("global", {})
    if norm in glb:
        out.update(_normalize(a) for a in glb[norm])
    else:
        for k, aliases in glb.items():
            if norm in (_normalize(a) for a in aliases):
                out.add(_normalize(k))
                out.update(_normalize(a) for a in aliases if _normalize(a) != norm)
                break
    return out


def _numeric_expansions(value: str) -> Set[str]:
    """Expand "10M" → {"10000000"}, "1.5b" → {"1500000000"}, "5k" → {"5000"}.

    Symmetric to ``search_helpers._parse_amount`` but emits the *string*
    form so the index-probe machinery can use it as a needle.
    """
    if not value:
        return set()
    data = _load_acronyms().get("numeric_suffixes", {})
    norm = value.strip().lstrip("$€£").lower().replace(",", "")
    m = re.match(r"^(-?\d+(?:\.\d+)?)([kmb])$", norm)
    if not m:
        return set()
    n = float(m.group(1))
    mult = data.get(m.group(2))
    if not mult:
        return set()
    try:
        scaled = n * float(mult)
    except (TypeError, ValueError):
        return set()
    if scaled.is_integer():
        return {str(int(scaled))}
    return {f"{scaled:.2f}".rstrip("0").rstrip(".")}


def _entity_aliases_lookup(values: List[str], tenant: str) -> Dict[str, Set[str]]:
    """Look up tenant-specific aliases from the entity_aliases table.

    Returns ``{value_lower: {alias_lower, …}}``. Empty dict on any
    failure (table missing, RLS blocks, etc.) — the caller treats it as
    "no tenant aliases available", not an error.
    """
    if not values:
        return {}
    out: Dict[str, Set[str]] = {}
    try:
        with db() as conn:
            set_tenant(conn, tenant)
            with conn.cursor() as cur:
                # Two-step: find entity_ids whose canonical or alias
                # matches any of our values, then collect ALL aliases for
                # those entities. One query per direction.
                lowered = [v.lower() for v in values if v]
                if not lowered:
                    return {}
                cur.execute(
                    """
                    WITH hits AS (
                      SELECT entity_id FROM entities
                       WHERE lower(canonical_name) = ANY(%s::text[])
                      UNION
                      SELECT entity_id FROM entity_aliases
                       WHERE lower(alias) = ANY(%s::text[])
                    )
                    SELECT lower(canonical_name) AS canon, ea.alias
                      FROM hits h
                      JOIN entities e   ON e.entity_id = h.entity_id
                      LEFT JOIN entity_aliases ea ON ea.entity_id = h.entity_id
                    """,
                    (lowered, lowered),
                )
                rows = cur.fetchall()
        # Group: every value gets every sibling alias of the entities it hits.
        for v in lowered:
            siblings: Set[str] = set()
            for canon, alias in rows:
                if not canon:
                    continue
                # If the value matched this entity (canonical OR an alias
                # row), pull all aliases of that entity into the sibling
                # set.
                if v == canon or (alias and v == alias.lower()):
                    siblings.add(canon)
                    if alias:
                        siblings.add(alias.lower())
            siblings.discard(v)
            if siblings:
                out[v] = siblings
    except Exception:
        logger.info("entity_aliases lookup skipped", exc_info=True)
        return {}
    return out


def expand_needle(value: str, field: Optional[str] = None) -> List[str]:
    """Expand a single value to its alias siblings (excluding the value itself).

    Static-only path — call ``expand_with_tenant`` if you also want
    tenant-scoped entity_aliases pulled in.
    """
    out = _static_lookup(value, field)
    out.update(_numeric_expansions(value))
    out.discard(_normalize(value))
    return [a for a in out if a]


def expand_with_tenant(
    needles: List[Tuple[str, Optional[str]]],
    tenant: str,
) -> List[str]:
    """Expand a list of (value, optional_field) pairs into the full alias set.

    Returns ONLY the new aliases — does NOT include the original needles
    (the caller already has those). Lower-cased, de-duplicated, ordered
    by first appearance for stable retrieval logs.
    """
    aliases: List[str] = []
    seen: Set[str] = set()
    # Static layer.
    for value, field in needles:
        for a in expand_needle(value, field):
            if a and a not in seen:
                seen.add(a)
                aliases.append(a)
    # Tenant entity_aliases layer.
    bare_values = [v for v, _f in needles if v]
    tenant_map = _entity_aliases_lookup(bare_values, tenant)
    for v, sibs in tenant_map.items():
        for a in sibs:
            an = _normalize(a)
            if an and an not in seen:
                seen.add(an)
                aliases.append(an)
    return aliases


__all__ = ["expand_needle", "expand_with_tenant"]
