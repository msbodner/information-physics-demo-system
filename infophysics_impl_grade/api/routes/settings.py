"""Health, diagnostics, and system-settings (API key) routes."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from api.db import db
from api.llm import (
    AVAILABLE_MODELS,
    get_default_model,
    get_effective_api_key,
    get_parse_model,
)
from api import budget as _budget

logger = logging.getLogger("infophysics.api.settings")

router = APIRouter()


class ApiKeyRequest(BaseModel):
    api_key: str


class ModelSettingsRequest(BaseModel):
    default_model: Optional[str] = None
    parse_model: Optional[str] = None  # empty string clears the override
    smart_search_enabled: Optional[bool] = None  # toggles Smart Search auto-mode in ChatAIO


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

def _get_smart_search_enabled() -> bool:
    """Read the Smart Search toggle from system_settings.

    Default: False (operators see the legacy multi-button row in ChatAIO).
    Stored as the literal strings 'true'/'false' in system_settings.value
    so the column stays text-typed alongside default_model / parse_model.
    """
    try:
        with db() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT value FROM system_settings WHERE key = 'smart_search_enabled'"
                )
                row = cur.fetchone()
                if row and row[0]:
                    return str(row[0]).strip().lower() in ("true", "1", "yes", "on")
    except Exception:
        pass
    return False


@router.get("/v1/settings/models")
def get_model_settings():
    """Return the currently effective default + parse models and the dropdown list.

    Also returns the Smart Search toggle so the System Admin → Settings
    pane and the ChatAIO dialog both read from one endpoint on mount.
    """
    return {
        "default_model": get_default_model(),
        "parse_model": get_parse_model(),
        "available": AVAILABLE_MODELS,
        "smart_search_enabled": _get_smart_search_enabled(),
    }


@router.put("/v1/settings/models")
def update_model_settings(payload: ModelSettingsRequest):
    """Upsert default_model, parse_model, and/or smart_search_enabled.

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
            if payload.smart_search_enabled is not None:
                cur.execute(
                    """
                    INSERT INTO system_settings (key, value, updated_at)
                    VALUES ('smart_search_enabled', %s, %s)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
                    """,
                    ("true" if payload.smart_search_enabled else "false", now),
                )
        conn.commit()
    return {
        "ok": True,
        "default_model": get_default_model(),
        "parse_model": get_parse_model(),
        "smart_search_enabled": _get_smart_search_enabled(),
    }


# ---------------------------------------------------------------------------
# Daily token budget
# ---------------------------------------------------------------------------
#
# The budget guardrail in api/budget.py reads two keys from
# system_settings:
#   - daily_token_budget:<tenant_id>      (per-tenant override, preferred)
#   - daily_token_budget_per_tenant       (global default for all tenants)
#
# Either may be unset. When neither is present the guardrail is
# disabled. These endpoints expose live status (used vs limit for the
# current tenant) and let an admin update either key without dropping
# into psql.

class BudgetSettingsRequest(BaseModel):
    # Per-tenant override. None = leave alone, "" = clear, "<int>" = set.
    tenant_limit: Optional[str] = None
    # Global default. Same semantics.
    global_limit: Optional[str] = None


def _read_setting(key: str) -> Optional[str]:
    try:
        with db() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT value FROM system_settings WHERE key = %s", (key,))
                row = cur.fetchone()
                return row[0] if row and row[0] else None
    except Exception:
        return None


@router.get("/v1/settings/budget")
def get_budget_settings(x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id")):
    tenant = x_tenant_id or "tenantA"
    s = _budget.status(tenant)
    return {
        "tenant_id": tenant,
        "used_today": s.used_today,
        "effective_limit": s.limit,  # what's actually enforced; None = disabled
        "percent_used": round(s.percent_used * 100, 2) if s.limit else 0.0,
        "warn": s.warn,
        "blocked": s.blocked,
        # Raw setting values so the UI can distinguish "no override set"
        # (tenant_limit_raw == None, falls through to global) from "set
        # to 0" (intentionally disabled).
        "tenant_limit_raw": _read_setting(f"daily_token_budget:{tenant}"),
        "global_limit_raw": _read_setting("daily_token_budget_per_tenant"),
    }


@router.put("/v1/settings/budget")
def update_budget_settings(
    payload: BudgetSettingsRequest,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    """Upsert the daily token budget settings.

    Each field accepts:
      - None  → leave the row alone (no DB write)
      - ""    → clear the row (delete from system_settings)
      - "<n>" → set to integer n (must parse cleanly)
    """
    def _validate(v: str, label: str) -> Optional[int]:
        if v == "":
            return None  # signals "clear"
        try:
            n = int(v.strip())
        except (ValueError, AttributeError):
            raise HTTPException(status_code=400, detail=f"{label} must be an integer or empty string")
        if n < 0:
            raise HTTPException(status_code=400, detail=f"{label} cannot be negative")
        return n

    tenant = x_tenant_id or "tenantA"
    now = datetime.now(timezone.utc)
    with db() as conn:
        with conn.cursor() as cur:
            if payload.tenant_limit is not None:
                key = f"daily_token_budget:{tenant}"
                if payload.tenant_limit == "":
                    cur.execute("DELETE FROM system_settings WHERE key = %s", (key,))
                else:
                    n = _validate(payload.tenant_limit, "tenant_limit")
                    cur.execute(
                        """
                        INSERT INTO system_settings (key, value, updated_at)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (key) DO UPDATE
                          SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
                        """,
                        (key, str(n), now),
                    )
            if payload.global_limit is not None:
                key = "daily_token_budget_per_tenant"
                if payload.global_limit == "":
                    cur.execute("DELETE FROM system_settings WHERE key = %s", (key,))
                else:
                    n = _validate(payload.global_limit, "global_limit")
                    cur.execute(
                        """
                        INSERT INTO system_settings (key, value, updated_at)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (key) DO UPDATE
                          SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
                        """,
                        (key, str(n), now),
                    )
        conn.commit()
    # Return the post-update status so the UI can refresh inline
    s = _budget.status(tenant)
    return {
        "ok": True,
        "tenant_id": tenant,
        "used_today": s.used_today,
        "effective_limit": s.limit,
        "percent_used": round(s.percent_used * 100, 2) if s.limit else 0.0,
        "tenant_limit_raw": _read_setting(f"daily_token_budget:{tenant}"),
        "global_limit_raw": _read_setting("daily_token_budget_per_tenant"),
    }


# ---------------------------------------------------------------------------
# Substrate caps (V4.6+) — operator-tunable maxAios for Recall and Live
# ---------------------------------------------------------------------------
#
# Three keys in system_settings expose the per-mode substrate cap so an
# operator can tune them per-deployment without a rebuild. Resolution
# chain for each: system_settings → env var → fallback constant.
#
#   recall_max_aios          → Recall (default mode), default 500
#                              env: RECALL_MAX_AIOS
#   recall_thorough_max_aios → Recall-T (Thorough mode), default 1500
#                              env: RECALL_THOROUGH_MAX_AIOS
#   live_aio_cap_max         → Live's adaptive_aio_cap ceiling, default 1000
#                              env: LIVE_AIO_CAP_MAX
#
# The Live ceiling is consumed by api/routes/chat.py when it calls
# adaptive_aio_cap(num_cues, ceiling=…). Recall caps are returned to
# the frontend on dialog open and passed into runChatPipeline as the
# maxAios option.

_CAP_DEFAULTS = {
    "recall_max_aios":          (800,  "RECALL_MAX_AIOS"),
    "recall_thorough_max_aios": (2500, "RECALL_THOROUGH_MAX_AIOS"),
    "live_aio_cap_max":         (2000, "LIVE_AIO_CAP_MAX"),
}


def _resolve_cap(key: str) -> int:
    default, env = _CAP_DEFAULTS[key]
    raw = _read_setting(key)
    if not raw:
        raw = os.environ.get(env, "").strip() or None
    if not raw:
        return default
    try:
        v = int(raw)
        return max(50, min(5000, v))   # hard clamp [50, 5000]
    except (ValueError, TypeError):
        return default


def get_recall_max_aios() -> int:
    return _resolve_cap("recall_max_aios")


def get_recall_thorough_max_aios() -> int:
    return _resolve_cap("recall_thorough_max_aios")


def get_live_aio_cap_max() -> int:
    return _resolve_cap("live_aio_cap_max")


class CapSettingsRequest(BaseModel):
    # Each: None = leave alone, "" = clear (revert to env/default),
    # "<int>" = set explicitly. Clamped to [50, 5000] by the resolver.
    recall_max_aios: Optional[str] = None
    recall_thorough_max_aios: Optional[str] = None
    live_aio_cap_max: Optional[str] = None


@router.get("/v1/settings/caps")
def get_cap_settings():
    """Return the currently effective Recall / Recall-T / Live caps + raw stored values."""
    return {
        "recall_max_aios":          get_recall_max_aios(),
        "recall_thorough_max_aios": get_recall_thorough_max_aios(),
        "live_aio_cap_max":         get_live_aio_cap_max(),
        "recall_max_aios_raw":           _read_setting("recall_max_aios"),
        "recall_thorough_max_aios_raw":  _read_setting("recall_thorough_max_aios"),
        "live_aio_cap_max_raw":          _read_setting("live_aio_cap_max"),
    }


@router.put("/v1/settings/caps")
def update_cap_settings(payload: CapSettingsRequest):
    """Upsert any subset of the three cap keys.

    Empty string clears the row (effective value reverts to env/fallback).
    Non-numeric strings are rejected. Clamped server-side to [50, 5000]
    by the resolver on read; an out-of-range write is allowed but ignored
    when read.
    """
    now = datetime.now(timezone.utc)
    fields = {
        "recall_max_aios":          payload.recall_max_aios,
        "recall_thorough_max_aios": payload.recall_thorough_max_aios,
        "live_aio_cap_max":         payload.live_aio_cap_max,
    }
    with db() as conn:
        with conn.cursor() as cur:
            for key, val in fields.items():
                if val is None:
                    continue
                v = val.strip()
                if v == "":
                    cur.execute("DELETE FROM system_settings WHERE key = %s", (key,))
                    continue
                try:
                    int(v)  # validate but store as text (consistent with other settings)
                except ValueError:
                    raise HTTPException(status_code=400,
                                        detail=f"{key} must be an integer or empty string")
                cur.execute(
                    """
                    INSERT INTO system_settings (key, value, updated_at)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
                    """,
                    (key, v, now),
                )
        conn.commit()
    return {
        "ok": True,
        "recall_max_aios":          get_recall_max_aios(),
        "recall_thorough_max_aios": get_recall_thorough_max_aios(),
        "live_aio_cap_max":         get_live_aio_cap_max(),
    }
