"""Anthropic client factory + API-key resolution.

Centralizes:
- Reading the Anthropic API key from the ``system_settings`` table with
  env-var fallback.
- Constructing an ``anthropic.Anthropic`` client from the effective key.

Before this module existed the pattern ``import anthropic; client =
anthropic.Anthropic(api_key=...)`` was duplicated across ~8 sites.
"""

from __future__ import annotations

import os
from typing import Optional

from fastapi import HTTPException

from api.db import db


def _get_api_key_from_db() -> Optional[str]:
    try:
        with db() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT value FROM system_settings WHERE key = 'anthropic_api_key'"
                )
                row = cur.fetchone()
                return row[0] if row else None
    except Exception:
        return None


def get_effective_api_key() -> Optional[str]:
    """Return the API key from the DB if set, else the env var."""
    db_key = _get_api_key_from_db()
    return db_key or os.environ.get("ANTHROPIC_API_KEY")


def get_anthropic_client():
    """Construct an anthropic.Anthropic client from the effective key.

    Raises HTTPException(503) when no key is configured so callers can
    surface a uniform error to clients.
    """
    api_key = get_effective_api_key()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Anthropic API key not configured.",
        )
    import anthropic  # imported lazily; keeps import cost off cold paths

    return anthropic.Anthropic(api_key=api_key)
