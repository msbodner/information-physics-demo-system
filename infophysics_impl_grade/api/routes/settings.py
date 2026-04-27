"""Health, diagnostics, and system-settings (API key) routes."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.db import db
from api.llm import (
    AVAILABLE_MODELS,
    get_default_model,
    get_effective_api_key,
    get_parse_model,
)

logger = logging.getLogger("infophysics.api.settings")

router = APIRouter()


class ApiKeyRequest(BaseModel):
    api_key: str


class ModelSettingsRequest(BaseModel):
    default_model: Optional[str] = None
    parse_model: Optional[str] = None  # empty string clears the override


# ---------------------------------------------------------------------------
# Health / diagnostics
# ---------------------------------------------------------------------------

@router.get("/")
async def root_health():
    """Root health endpoint for Railway healthcheck."""
    return {"status": "ok"}


@router.get("/v1/health")
def health():
    return {"status": "ok"}


@router.get("/v1/diag")
def diag():
    """Diagnostic endpoint — reports DB table existence and active constraints."""
    result: Dict[str, Any] = {"tables": {}, "constraints": [], "indexes": []}
    try:
        with db() as conn:
            with conn.cursor() as cur:
                # Check which key tables exist
                for tbl in ("information_objects", "users", "system_settings", "tenants"):
                    cur.execute(
                        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = %s)",
                        (tbl,),
                    )
                    result["tables"][tbl] = cur.fetchone()[0]

                # Active constraints on information_objects
                cur.execute(
                    """
                    SELECT conname, contype
                    FROM pg_constraint
                    WHERE conrelid = 'information_objects'::regclass
                    """,
                )
                result["constraints"] = [{"name": r[0], "type": r[1]} for r in cur.fetchall()]

                # Active unique indexes on information_objects
                cur.execute(
                    """
                    SELECT indexname, indexdef
                    FROM pg_indexes
                    WHERE tablename = 'information_objects' AND indexdef LIKE '%UNIQUE%'
                    """,
                )
                result["indexes"] = [{"name": r[0], "def": r[1]} for r in cur.fetchall()]

                # Row counts
                cur.execute("SELECT COUNT(*) FROM information_objects")
                result["io_count"] = cur.fetchone()[0]
                if result["tables"].get("users"):
                    cur.execute("SELECT COUNT(*) FROM users")
                    result["user_count"] = cur.fetchone()[0]
    except Exception as exc:
        result["error"] = str(exc)
    return result


# ---------------------------------------------------------------------------
# API key
# ---------------------------------------------------------------------------

@router.get("/v1/settings/apikey")
def get_api_key_setting():
    key = get_effective_api_key()
    if not key:
        return {"configured": False, "masked": None}
    masked = key[:7] + "..." + key[-4:] if len(key) > 11 else "***"
    return {"configured": True, "masked": masked}


@router.put("/v1/settings/apikey")
def update_api_key_setting(payload: ApiKeyRequest):
    if not payload.api_key or not payload.api_key.startswith("sk-"):
        raise HTTPException(status_code=400, detail="Invalid API key format")
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO system_settings (key, value, updated_at)
                VALUES ('anthropic_api_key', %s, %s)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
                """,
                (payload.api_key, datetime.now(timezone.utc)),
            )
        conn.commit()
    # Update current process env so it takes effect immediately
    os.environ["ANTHROPIC_API_KEY"] = payload.api_key
    return {"ok": True}


# ---------------------------------------------------------------------------
# Model selection
# ---------------------------------------------------------------------------

@router.get("/v1/settings/models")
def get_model_settings():
    """Return the currently effective default + parse models and the dropdown list."""
    return {
        "default_model": get_default_model(),
        "parse_model": get_parse_model(),
        "available": AVAILABLE_MODELS,
    }


@router.put("/v1/settings/models")
def update_model_settings(payload: ModelSettingsRequest):
    """Upsert default_model and/or parse_model in system_settings.

    An empty string for parse_model clears the override (parse_model then
    falls back to default_model). Pass None (omit) to leave a setting alone.
    """
    now = datetime.now(timezone.utc)
    with db() as conn:
        with conn.cursor() as cur:
            if payload.default_model is not None:
                if not payload.default_model.strip():
                    raise HTTPException(status_code=400, detail="default_model cannot be empty")
                cur.execute(
                    """
                    INSERT INTO system_settings (key, value, updated_at)
                    VALUES ('default_model', %s, %s)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
                    """,
                    (payload.default_model.strip(), now),
                )
            if payload.parse_model is not None:
                # Empty string => clear override
                cur.execute(
                    """
                    INSERT INTO system_settings (key, value, updated_at)
                    VALUES ('parse_model', %s, %s)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
                    """,
                    (payload.parse_model.strip(), now),
                )
        conn.commit()
    return {
        "ok": True,
        "default_model": get_default_model(),
        "parse_model": get_parse_model(),
    }
