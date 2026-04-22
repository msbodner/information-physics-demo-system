"""App-level smoke tests: import, route inventory, no-DB health checks."""

from __future__ import annotations


def test_app_imports():
    """The FastAPI app assembles without errors."""
    from api.main import app
    assert app.title == "InformationPhysics API"


def test_expected_routers_mounted():
    """All feature routers from main.py are actually reachable."""
    from api.main import app
    paths = {r.path for r in app.routes}
    # Spot-check one path from each feature router.
    for required in [
        "/",
        "/v1/health",
        "/v1/users",
        "/v1/aio-data",
        "/v1/hsl-data",
        "/v1/mro-objects",
        "/v1/saved-prompts",
        "/v1/op/chat",
        "/v1/op/aio-search",
        "/v1/chat-stats",
    ]:
        assert required in paths, f"router missing: {required}"


def test_root_health(client):
    r = client.get("/")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_v1_health(client):
    r = client.get("/v1/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
