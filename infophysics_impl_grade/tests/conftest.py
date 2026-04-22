"""Shared pytest fixtures.

The FastAPI TestClient is constructed *without* entering its context
manager so the lifespan hook (which opens a psycopg pool) does not run.
That means tests can exercise any endpoint whose handler does not touch
the DB — `/`, `/v1/health`, pure validation paths — on a machine with
no Postgres installed.

Endpoints that do need a DB should be marked `@pytest.mark.integration`
and guarded by the `require_db` fixture below.
"""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="session")
def client() -> TestClient:
    """TestClient with lifespan *not* started — no DB required."""
    from api.main import app
    return TestClient(app)


@pytest.fixture
def require_db():
    """Skip a test unless DATABASE_URL is configured."""
    if not os.environ.get("DATABASE_URL"):
        pytest.skip("DATABASE_URL not set; skipping integration test")
