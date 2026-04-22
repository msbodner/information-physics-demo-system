"""Database connection-pool and helpers.

Centralizes the psycopg connection pool and the `db()` / `set_tenant()`
helpers that every route module depends on. The pool is created lazily
and opened/closed by the FastAPI lifespan hook in `main.py`.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Optional

from psycopg_pool import ConnectionPool
from fastapi import FastAPI

logger = logging.getLogger("infophysics.api.db")

# Module-level singleton. Accessed via _get_pool(); `main.py` opens/closes
# it from the app lifespan.
_pool: Optional[ConnectionPool] = None


def _get_pool() -> ConnectionPool:
    """Lazy-init the pool; safe for reload and tests."""
    global _pool
    if _pool is None:
        url = os.environ.get("DATABASE_URL")
        if not url:
            raise RuntimeError("DATABASE_URL not set")
        # Conservative sizing; Railway default max_connections=100 across
        # all services. min_size=1 keeps a warm connection ready,
        # max_size=10 per worker (tunable via DB_POOL_MAX).
        _pool = ConnectionPool(
            url,
            min_size=1,
            max_size=int(os.environ.get("DB_POOL_MAX", "10")),
            timeout=30,
            kwargs={"autocommit": False},
        )
    return _pool


def db():
    """Return a pooled connection context manager.

    Usage:
        with db() as conn:
            with conn.cursor() as cur:
                ...

    The pool handles open/close/recycle; the caller still controls
    transaction commit/rollback. ``conn.commit()`` works as before.
    """
    return _get_pool().connection()


def set_tenant(conn, tenant_id: str) -> None:
    """Apply ``SET LOCAL app.tenant_id`` to the current transaction.

    ``SET LOCAL`` does not accept parameterized queries, so the value is
    sanitized manually (single-quote escape). Upstream route handlers
    should validate ``tenant_id`` against a strict regex (see Item #4 in
    the audit plan) before passing it here.
    """
    safe_id = tenant_id.replace("'", "''")
    with conn.cursor() as cur:
        cur.execute(f"SET LOCAL app.tenant_id = '{safe_id}'")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan hook: open the pool on startup, close on shutdown."""
    global _pool
    pool = _get_pool()
    try:
        pool.wait(timeout=10)
        logger.info("DB connection pool ready (max_size=%d)", pool.max_size)
    except Exception as e:
        logger.warning("DB pool warmup failed (will retry on demand): %s", e)
    try:
        yield
    finally:
        if _pool is not None:
            try:
                _pool.close()
            except Exception:
                pass
            _pool = None
