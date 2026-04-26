"""Smoke tests for V4.4 P0a /v1/aio-data/find-by-needles.

Static checks only (no DB integration test): the SQL pattern is identical
to the older /v1/hsl-data/find-by-needles, which already has its own
smoke coverage via test_app.py. We only assert the new route is wired
and that the empty-needles short-circuit doesn't touch the DB.
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
AIO_PY = REPO_ROOT / "api" / "routes" / "aio.py"


def test_aio_find_by_needles_route_is_registered(client):
    paths = {r.path for r in client.app.routes}
    assert "/v1/aio-data/find-by-needles" in paths


def test_aio_find_by_needles_uses_indexed_like():
    """Must hit the pg_trgm GIN index by LIKE-ing elements_text."""
    src = AIO_PY.read_text()
    assert "elements_text LIKE" in src, "must scan via the indexed elements_text column"
    assert "AioFindByNeedlesRequest" in src, "request model must exist"


def test_aio_find_by_needles_empty_short_circuits(client):
    """Empty needles → empty result, no DB hit."""
    res = client.post("/v1/aio-data/find-by-needles", json={"needles": []})
    assert res.status_code == 200
    body = res.json()
    assert body == {"aio_names": []}


def test_aio_find_by_needles_whitespace_only_short_circuits(client):
    """Whitespace-only needles are stripped and treated as empty."""
    res = client.post("/v1/aio-data/find-by-needles", json={"needles": ["  ", "\t"]})
    assert res.status_code == 200
    assert res.json() == {"aio_names": []}
