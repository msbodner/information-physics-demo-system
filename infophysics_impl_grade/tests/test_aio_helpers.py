"""Unit tests for pure helpers in api.routes.aio / .hsl / .mro."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4


def test_extract_field_names_basic():
    """_extract_field_names uses `re.match`, so it captures the LEADING
    [Field.Value] of each element string (one field per element)."""
    from api.routes.aio import _extract_field_names
    els = [
        "[Vendor.Acme]",
        "[Amount.1200]",
        "[Date.2025-01-01]",
        "[Vendor.Beta]",   # duplicate key — de-dup expected
        None,
        "plain text with no brackets",
    ]
    names = set(_extract_field_names(els))
    assert names == {"Vendor", "Amount", "Date"}


def test_extract_field_names_ignores_malformed():
    from api.routes.aio import _extract_field_names
    # No dot → not a field pattern; closing-bracket only; empty string.
    names = _extract_field_names(["[NoDot]", "]stray[", "", None])
    assert names == []


def test_aio_row_to_out_shape():
    from api.routes.aio import _aio_row_to_out
    now = datetime.now(timezone.utc)
    aio_id = uuid4()
    # aio_id, aio_name, element_1..50, created_at, updated_at (54 cols)
    row = (aio_id, "aio.one") + tuple(f"e{i}" for i in range(1, 51)) + (now, now)
    out = _aio_row_to_out(row)
    assert out.aio_id == aio_id
    assert out.aio_name == "aio.one"
    assert len(out.elements) == 50
    assert out.elements[0] == "e1"
    assert out.elements[49] == "e50"


def test_hsl_row_to_out_shape():
    from api.routes.hsl import _hsl_row_to_out
    now = datetime.now(timezone.utc)
    hsl_id = uuid4()
    # hsl_id, hsl_name, hsl_element_1..100, created_at, updated_at (104 cols)
    row = (hsl_id, "hsl.one") + tuple(f"h{i}" for i in range(1, 101)) + (now, now)
    out = _hsl_row_to_out(row)
    assert out.hsl_id == hsl_id
    assert out.hsl_name == "hsl.one"
    assert len(out.elements) == 100
    assert out.elements[0] == "h1"
    assert out.elements[99] == "h100"


def test_mro_from_row_shape():
    from api.routes.mro import _mro_from_row
    now = datetime.now(timezone.utc)
    mro_id = uuid4()
    row = (
        mro_id, "mro.key", "what is X?", "intent.lookup", "seed.hsl",
        3, '["term"]', "result body", "bundle text",
        "derived", "tenantA", "tenantA", now, now,
    )
    out = _mro_from_row(row)
    assert out.mro_id == mro_id
    assert out.matched_aios_count == 3
    assert out.query_text == "what is X?"
    assert out.confidence == "derived"
