"""Static checks for V4.4 P1–P5 AIO Search performance changes.

P1: indexed retrieval passes lead, unindexed ILIKE falls back.
P2: literal [Key.Value] cues in the user prompt are extracted via regex
    and folded into search_terms.field_values.
P3: AIO Pass 2 (elements_text) probe cap raised from 10 → 30 needles.
P4: MRO prior fetch uses a single batched ANY(%s::text[]) query.
P5: /v1/op/aio-search/stream consults the query micro-cache and persists
    streamed replies back into it.

Pure source-text assertions — no DB required.
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
CHAT_PY = REPO_ROOT / "api" / "routes" / "chat.py"


def _src() -> str:
    return CHAT_PY.read_text()


# ── P1: pass reordering ────────────────────────────────────────────

def test_p1_hsl_inverted_index_leads_aio_name_ilike_falls_back():
    src = _src()
    # Field-aware probe (information_element_refs) must appear before
    # the demoted hsl_name ILIKE fallback.
    field_probe = src.find("FIELD-AWARE probe")
    name_fallback = src.find("hsl_name ILIKE — unindexed but always works")
    assert field_probe != -1, "field-aware probe section missing"
    assert name_fallback != -1, "demoted hsl_name fallback section missing"
    assert field_probe < name_fallback, (
        "indexed field-aware probe must run before the hsl_name ILIKE fallback"
    )


def test_p1_aio_elements_text_leads_aio_name_ilike_falls_back():
    src = _src()
    # P8 split AIO Pass 1 into 1a (field-aware) + 1b (elements_text);
    # accept either marker for forward compatibility.
    et_pass = src.find("Pass 1b: elements_text")
    if et_pass == -1:
        et_pass = src.find("Pass 1: elements_text (fast indexed path, migration 016)")
    name_pass = src.find("Pass 2: aio_name ILIKE — unindexed but always works")
    assert et_pass != -1, "AIO elements_text leading pass missing"
    assert name_pass != -1, "AIO aio_name fallback pass missing"
    assert et_pass < name_pass, (
        "AIO elements_text (indexed) must precede aio_name ILIKE (unindexed)"
    )


# ── P2: [Key.Value] regex pre-pass ─────────────────────────────────

def test_p2_bracket_pair_regex_present():
    src = _src()
    assert 'bracket_pairs = re.findall(' in src
    assert "import re" in src
    # Must merge into search_terms.field_values for the field-aware probe to use.
    assert 'search_terms["field_values"] = existing_fv' in src


# ── P3: probe cap lifted ───────────────────────────────────────────

def test_p3_probe_needles_cap_is_30():
    src = _src()
    assert "probe_needles = needles[:30]" in src, (
        "AIO Pass 1 (elements_text) should probe up to 30 needles"
    )
    assert "probe_needles = needles[:10]" not in src, (
        "old 10-needle cap must be gone"
    )


# ── P4: batched MRO prior fetch ────────────────────────────────────

def test_p4_mro_prior_fetch_is_batched():
    src = _src()
    assert "WHERE mro_id::text = ANY(%s::text[])" in src, (
        "MRO prior fetch should use a single ANY()-batched query"
    )
    # The old per-row loop pattern must be gone.
    assert "for mro_uuid in mro_ids_from_hsl[:5]:" not in src, (
        "per-row MRO fetch loop should have been replaced by ANY() batch"
    )


# ── P5: stream cache ───────────────────────────────────────────────

def test_p5_stream_endpoint_has_cache_lookup():
    src = _src()
    body_after_def = src.split("def aio_search_stream(", 1)[-1]
    assert "_qcache.lookup(tenant" in body_after_def, (
        "/aio-search/stream must short-circuit on cache hit"
    )
    assert "served_from_cache" in body_after_def
    # Must also persist into the cache after a successful streamed answer.
    assert "_qcache.store(tenant" in body_after_def, (
        "/aio-search/stream must persist its reply into the cache"
    )


def test_p5_stream_accepts_bypass_cache_query_param():
    src = _src()
    sig = src.split("def aio_search_stream(", 1)[-1].split("):", 1)[0]
    assert "bypass_cache" in sig, (
        "stream endpoint should accept ?bypass_cache=true to force a re-run"
    )
