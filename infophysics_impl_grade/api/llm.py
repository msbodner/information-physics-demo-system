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


# ---------------------------------------------------------------------------
# Model selection
# ---------------------------------------------------------------------------
#
# Resolution order (highest precedence first):
#   1. system_settings.{key}  (DB, set via System Management UI)
#   2. environment variable
#   3. hardcoded fallback
#
# Two settings are honored:
#   - default_model: used by every Anthropic call site unless overridden
#   - parse_model:   used only by the AIO-search parse phase; falls back
#                    to default_model when unset
#
# The available_models list is what the UI offers in its dropdown. It is
# advisory only — operators can save any string they want via the API.

AVAILABLE_MODELS = [
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
]
FALLBACK_MODEL = "claude-sonnet-4-6"


def _get_setting(key: str) -> Optional[str]:
    try:
        with db() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT value FROM system_settings WHERE key = %s", (key,))
                row = cur.fetchone()
                return row[0] if row and row[0] else None
    except Exception:
        return None


def get_default_model() -> str:
    """Return the model used by every Anthropic call site (unless overridden).

    Resolution: system_settings.default_model → ANTHROPIC_DEFAULT_MODEL → fallback.
    """
    return (
        _get_setting("default_model")
        or os.environ.get("ANTHROPIC_DEFAULT_MODEL")
        or FALLBACK_MODEL
    )


def get_parse_model() -> str:
    """Model for the AIO-search parse phase. Falls back to the default model."""
    return (
        _get_setting("parse_model")
        or os.environ.get("AIO_SEARCH_PARSE_MODEL")
        or get_default_model()
    )


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
