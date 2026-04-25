"""Per-tenant daily token-budget guardrail.

Two public calls, both intended to wrap every Anthropic invocation:

  * ``check_budget(tenant)`` — call BEFORE the LLM round-trip. Returns a
    ``BudgetStatus`` with current spend and a remaining-budget figure.
    Raises ``HTTPException(429)`` when spend ≥ 100% of the limit so the
    runaway-loop case is short-circuited before any cost is incurred.
    Logs a warning at the 80% threshold but allows the call.

  * ``record_usage(tenant, in_tok, out_tok)`` — call AFTER a successful
    LLM round-trip. Atomically upserts into ``tenant_token_usage``.

Configuration
-------------
The budget value is read from ``system_settings``:

  * ``daily_token_budget:<tenant_id>`` — per-tenant override (preferred).
  * ``daily_token_budget_per_tenant`` — global default.

If neither row is present (e.g. migration 021 hasn't run yet), the
guardrail is silently disabled — the goal is "cheap insurance", not
forcing operators to configure a budget before they can use the system.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException

from api.db import db, set_tenant

logger = logging.getLogger("infophysics.api.budget")


@dataclass
class BudgetStatus:
    tenant_id: str
    used_today: int          # input + output tokens consumed today
    limit: Optional[int]     # None when guardrail is disabled
    percent_used: float      # 0.0–1.0+
    warn: bool               # spend ≥ 80%
    blocked: bool            # spend ≥ 100% (will raise on check_budget)


def _read_budget(tenant: str) -> Optional[int]:
    """Resolve the effective daily budget for a tenant. None disables the guardrail."""
    try:
        with db() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT value FROM system_settings WHERE key = %s",
                    (f"daily_token_budget:{tenant}",),
                )
                row = cur.fetchone()
                if row and row[0]:
                    return int(row[0])
                cur.execute(
                    "SELECT value FROM system_settings WHERE key = 'daily_token_budget_per_tenant'"
                )
                row = cur.fetchone()
                if row and row[0]:
                    return int(row[0])
    except Exception:
        logger.info("budget read failed (table may be absent)", exc_info=True)
    return None


def _read_used(tenant: str) -> int:
    """Sum today's tokens for this tenant. Returns 0 on absence/error."""
    try:
        with db() as conn:
            set_tenant(conn, tenant)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT COALESCE(input_tokens + output_tokens, 0)
                      FROM tenant_token_usage
                     WHERE tenant_id = %s
                       AND usage_day = (now() AT TIME ZONE 'UTC')::date
                    """,
                    (tenant,),
                )
                row = cur.fetchone()
                if row:
                    return int(row[0] or 0)
    except Exception:
        logger.info("usage read failed (table may be absent)", exc_info=True)
    return 0


def status(tenant: str) -> BudgetStatus:
    """Compute the current status without raising."""
    limit = _read_budget(tenant)
    used = _read_used(tenant)
    if limit is None or limit <= 0:
        return BudgetStatus(
            tenant_id=tenant, used_today=used, limit=None,
            percent_used=0.0, warn=False, blocked=False,
        )
    pct = used / float(limit) if limit else 0.0
    return BudgetStatus(
        tenant_id=tenant, used_today=used, limit=limit,
        percent_used=pct,
        warn=pct >= 0.80 and pct < 1.0,
        blocked=pct >= 1.0,
    )


def check_budget(tenant: str) -> BudgetStatus:
    """Enforce the budget. Raises 429 when blocked, returns status otherwise.

    The exception body includes the percent used and the limit so the
    frontend can render a useful error ("daily token budget exhausted —
    used 502,431 of 500,000"). At the 80% threshold we log a warning but
    allow the call; the caller can surface that warning to the user via
    the returned status if they want.
    """
    s = status(tenant)
    if s.blocked:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "daily_token_budget_exhausted",
                "tenant_id": tenant,
                "used_today": s.used_today,
                "limit": s.limit,
                "percent_used": round(s.percent_used * 100, 2),
                "message": (
                    f"Daily token budget exhausted for tenant '{tenant}': "
                    f"{s.used_today:,} of {s.limit:,} tokens used. "
                    "Try again tomorrow or raise the budget in System Admin → Settings."
                ),
            },
        )
    if s.warn:
        logger.warning(
            "tenant=%s at %.0f%% of daily budget (%d / %d tokens)",
            tenant, s.percent_used * 100, s.used_today, s.limit or 0,
        )
    return s


def record_usage(tenant: str, input_tokens: int, output_tokens: int) -> None:
    """Atomically increment today's counter for a tenant. Best-effort."""
    if not tenant:
        return
    in_tok = max(0, int(input_tokens or 0))
    out_tok = max(0, int(output_tokens or 0))
    if in_tok == 0 and out_tok == 0:
        return
    try:
        with db() as conn:
            set_tenant(conn, tenant)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO tenant_token_usage
                      (tenant_id, usage_day, input_tokens, output_tokens, call_count)
                    VALUES (%s, (now() AT TIME ZONE 'UTC')::date, %s, %s, 1)
                    ON CONFLICT (tenant_id, usage_day) DO UPDATE SET
                      input_tokens  = tenant_token_usage.input_tokens  + EXCLUDED.input_tokens,
                      output_tokens = tenant_token_usage.output_tokens + EXCLUDED.output_tokens,
                      call_count    = tenant_token_usage.call_count    + 1,
                      updated_at    = now()
                    """,
                    (tenant, in_tok, out_tok),
                )
            conn.commit()
    except Exception:
        logger.info("usage record failed", exc_info=True)


__all__ = ["BudgetStatus", "status", "check_budget", "record_usage"]
