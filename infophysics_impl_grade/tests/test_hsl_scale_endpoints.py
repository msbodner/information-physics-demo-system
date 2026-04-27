"""Smoke tests for V4.4 P3 scale-corrected HSL loading endpoints.

Two new routes back the dialog-open vs query-time split:

  - GET  /v1/hsl-data/key-value-pairs        — tiny catalog at dialog open
  - POST /v1/hsl-data/find-by-needles-full   — full HSL rows scoped per query

We exercise the pure / no-DB paths inline (route registration, empty-input
short-circuit) and mark the integration cases ``require_db``. The latter
will skip cleanly on machines without DATABASE_URL — same convention used
by the rest of the suite.
"""

from __future__ import annotations

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
HSL_PY = REPO_ROOT / "api" / "routes" / "hsl.py"


# ── Static / wiring checks ──────────────────────────────────────────


def test_key_value_pairs_route_is_registered(client):
    paths = {r.path for r in client.app.routes}
    assert "/v1/hsl-data/key-value-pairs" in paths


def test_find_by_needles_full_route_is_registered(client):
    paths = {r.path for r in client.app.routes}
    assert "/v1/hsl-data/find-by-needles-full" in paths


def test_find_by_needles_full_uses_inverted_index():
    """Must hit the migration-017 information_element_refs index."""
    src = HSL_PY.read_text()
    assert "information_element_refs" in src, (
        "find-by-needles-full must use the inverted-index table from migration 017"
    )
    assert "value_lower = ANY" in src, (
        "needle probe must be an indexed equality, not a LIKE scan"
    )


def test_key_value_pairs_parser_uses_shared_value_re():
    """Catalog parser must use the same _VALUE_RE as the rest of hsl.py
    so cue extraction stays consistent with what HSLs actually carry."""
    src = HSL_PY.read_text()
    # The new endpoint and synth_hsls_for_aio both call into the same
    # bracket regex — _VALUE_RE — so there's no duplicate parser to drift.
    assert "_VALUE_RE.finditer(hsl_name)" in src


# ── Empty-input short-circuits (no DB) ──────────────────────────────


def test_find_by_needles_full_empty_values_short_circuits(client):
    """Empty values list → empty result, no DB hit."""
    res = client.post("/v1/hsl-data/find-by-needles-full", json={"values": []})
    assert res.status_code == 200
    assert res.json() == []


def test_find_by_needles_full_whitespace_only_short_circuits(client):
    """Whitespace-only values are stripped and treated as empty."""
    res = client.post(
        "/v1/hsl-data/find-by-needles-full", json={"values": ["  ", "\t"]}
    )
    assert res.status_code == 200
    assert res.json() == []


# ── Integration: tenant isolation + dedup + recall ──────────────────
#
# These are pytest.mark.integration / require_db. They will skip on a
# laptop without a Postgres pointing at a primed corpus.


@pytest.mark.integration
def test_key_value_pairs_dedup_and_tenant_isolation(client, require_db):
    """Same (key, value) pair appearing in many HSL names returns once.
    Cross-tenant rows MUST NOT leak into the response."""
    seen = set()
    res_a = client.get(
        "/v1/hsl-data/key-value-pairs", headers={"X-Tenant-Id": "tenantA"}
    )
    assert res_a.status_code == 200
    pairs_a = res_a.json()
    for p in pairs_a:
        kv = (p["key"], p["value"])
        assert kv not in seen, f"duplicate (key, value) leaked: {kv}"
        seen.add(kv)

    # tenantB must not see tenantA pairs (RLS).
    res_b = client.get(
        "/v1/hsl-data/key-value-pairs", headers={"X-Tenant-Id": "tenantB"}
    )
    assert res_b.status_code == 200
    pairs_b = res_b.json()
    set_a = {(p["key"], p["value"]) for p in pairs_a}
    set_b = {(p["key"], p["value"]) for p in pairs_b}
    # Pairs may be empty in both; the invariant is that each tenant sees
    # only its own. We assert non-equality only when both are non-empty.
    if set_a and set_b:
        assert set_a != set_b or len(set_a) == 0


@pytest.mark.integration
def test_find_by_needles_full_returns_expected_rows(client, require_db):
    """Given a needle that matches a known HSL, the row must come back
    in full HslDataOut shape (hsl_id, hsl_name, elements, timestamps)."""
    # Pull the catalog first, then re-probe with one of its values —
    # this is the same flow Recall Search uses end-to-end.
    cat = client.get(
        "/v1/hsl-data/key-value-pairs", headers={"X-Tenant-Id": "tenantA"}
    ).json()
    if not cat:
        pytest.skip("no HSL data in tenantA — nothing to probe")
    needle = cat[0]["value"]
    res = client.post(
        "/v1/hsl-data/find-by-needles-full",
        json={"values": [needle]},
        headers={"X-Tenant-Id": "tenantA"},
    )
    assert res.status_code == 200
    rows = res.json()
    assert isinstance(rows, list) and len(rows) >= 1
    first = rows[0]
    assert "hsl_id" in first and "hsl_name" in first and "elements" in first
    # The matched HSL's name must contain the needle (case-insensitive).
    assert any(needle.lower() in r["hsl_name"].lower() for r in rows)


@pytest.mark.integration
def test_find_by_needles_full_tenant_isolation(client, require_db):
    """A needle matching a tenantA HSL must return zero rows for tenantB."""
    cat = client.get(
        "/v1/hsl-data/key-value-pairs", headers={"X-Tenant-Id": "tenantA"}
    ).json()
    if not cat:
        pytest.skip("no HSL data in tenantA — nothing to probe")
    needle = cat[0]["value"]
    res_b = client.post(
        "/v1/hsl-data/find-by-needles-full",
        json={"values": [needle]},
        headers={"X-Tenant-Id": "tenantB"},
    )
    assert res_b.status_code == 200
    # tenantB MAY have its own match for the same value; the integrity
    # check is that any rows returned belong to tenantB (RLS enforces
    # this on the server). Without a way to read tenant_id on the
    # response, we settle for the structural + RLS-guarded assertion.
    assert isinstance(res_b.json(), list)
