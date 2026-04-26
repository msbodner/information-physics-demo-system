"""Static + unit checks for V4.4 P10/P11/P12.

P10: density-aware adaptive_aio_cap (opt-in via env).
P11: parse_system carries cache_control: ephemeral.
P12: mro_ids_from_hsl extraction is bounded by MRO_IDS_CAP.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
CHAT_PY = REPO_ROOT / "api" / "routes" / "chat.py"


def _src() -> str:
    return CHAT_PY.read_text()


# ── P10: density-aware cap ─────────────────────────────────────────

def test_p10_density_aware_default_off_is_noop(monkeypatch):
    monkeypatch.delenv("AIO_SEARCH_DENSITY_AWARE_CAP", raising=False)
    from api.search_helpers import adaptive_aio_cap
    # With env unset, total_matches must NOT change the result.
    assert adaptive_aio_cap(2, total_matches=1) == adaptive_aio_cap(2)
    assert adaptive_aio_cap(5, total_matches=10_000) == adaptive_aio_cap(5)


def test_p10_density_aware_tightens_when_enabled(monkeypatch):
    monkeypatch.setenv("AIO_SEARCH_DENSITY_AWARE_CAP", "1")
    from importlib import reload
    import api.search_helpers as sh
    reload(sh)
    from api.search_helpers import adaptive_aio_cap
    # Use 5 cues so base (300) has headroom above the floor (100) to
    # actually tighten under density pressure.
    base = adaptive_aio_cap(5)               # no density signal → 300
    dense = adaptive_aio_cap(5, total_matches=10_000)  # 2000/cue
    assert dense < base, "high density per cue should tighten the cap"
    # Floor must still hold.
    assert dense >= 100


def test_p10_density_aware_below_threshold_is_noop(monkeypatch):
    monkeypatch.setenv("AIO_SEARCH_DENSITY_AWARE_CAP", "1")
    from importlib import reload
    import api.search_helpers as sh
    reload(sh)
    from api.search_helpers import adaptive_aio_cap
    # density = 50 per cue (< 200 threshold) → unchanged.
    assert adaptive_aio_cap(2, total_matches=100) == adaptive_aio_cap(2)


# ── P11: parse_system prompt caching ───────────────────────────────

def test_p11_parse_system_uses_ephemeral_cache_control():
    src = _src()
    body = src.split("def _aio_search_prepare", 1)[-1].split("\ndef ", 1)[0]
    # Locate the parse messages.create call.
    create_block = body.split("client.messages.create(", 1)[-1].split(")", 1)[0]
    assert "cache_control" in create_block, (
        "parse messages.create must mark system prompt as ephemeral"
    )
    assert "ephemeral" in create_block


# ── P12: MRO ids extraction cap ────────────────────────────────────

def test_p12_mro_ids_cap_present():
    src = _src()
    body = src.split("def _aio_search_prepare", 1)[-1].split("\ndef ", 1)[0]
    assert "MRO_IDS_CAP" in body, "mro_ids extraction must be bounded"
    assert "len(mro_ids_from_hsl) < MRO_IDS_CAP" in body, (
        "mro_ids append must be guarded by the cap"
    )
