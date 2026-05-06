"""Prompt Library CRUD.

Curated prompt entries shipped with the system + maintained by admins
via System Admin → Prompt Library. Distinct from `saved_prompts`,
which holds operator-personal bookmarks; the library is shared and
seed-managed.

Schema (migration 032_prompt_library.sql):
  prompt_id, title, body, category, metadata, is_seeded,
  created_at, updated_at

Endpoints:
  GET    /v1/prompt-library                — list, optionally by category
  GET    /v1/prompt-library/{prompt_id}    — fetch one
  POST   /v1/prompt-library                — create
  PUT    /v1/prompt-library/{prompt_id}    — update (any field; is_seeded immutable)
  DELETE /v1/prompt-library/{prompt_id}    — delete (seeded entries get deleted too —
                                              a fresh re-run of the migration won't
                                              re-seed unless ALL seeded rows are gone)
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from api.db import db

logger = logging.getLogger("infophysics.api.prompt_library")

router = APIRouter()


# ── Pydantic models ─────────────────────────────────────────────


class PromptLibraryEntry(BaseModel):
    prompt_id: uuid.UUID
    title: str
    body: str
    category: str
    metadata: Optional[str] = None
    is_seeded: bool
    created_at: datetime
    updated_at: datetime


class CreatePromptLibraryRequest(BaseModel):
    title: str
    body: str
    category: Optional[str] = "general"
    metadata: Optional[str] = None


class UpdatePromptLibraryRequest(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    category: Optional[str] = None
    metadata: Optional[str] = None


# ── Helpers ─────────────────────────────────────────────────────


_SELECT_COLS = (
    "prompt_id, title, body, category, metadata, is_seeded, created_at, updated_at"
)


def _row_to_entry(row) -> PromptLibraryEntry:
    return PromptLibraryEntry(
        prompt_id=row[0], title=row[1], body=row[2], category=row[3],
        metadata=row[4], is_seeded=bool(row[5]),
        created_at=row[6], updated_at=row[7],
    )


# ── Routes ──────────────────────────────────────────────────────


@router.get("/v1/prompt-library", response_model=List[PromptLibraryEntry])
def list_prompt_library(
    category: Optional[str] = Query(None),
    limit: int = Query(500, ge=1, le=10_000),
):
    """List library entries. Filter by ``category`` if provided.

    Sort: seeded entries first, then by updated_at desc. This puts the
    five out-of-the-box exemplars at the top of the operator's
    picker by default.
    """
    where = ""
    params: list = []
    if category:
        where = "WHERE category = %s"
        params.append(category)
    params.append(limit)

    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT {_SELECT_COLS}
                  FROM prompt_library
                  {where}
                 ORDER BY is_seeded DESC, updated_at DESC
                 LIMIT %s
                """,
                params,
            )
            rows = cur.fetchall()
    return [_row_to_entry(r) for r in rows]


@router.get("/v1/prompt-library/{prompt_id}", response_model=PromptLibraryEntry)
def get_prompt_library_entry(prompt_id: str):
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT {_SELECT_COLS} FROM prompt_library WHERE prompt_id = %s",
                (prompt_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Prompt not found")
            return _row_to_entry(row)


@router.post(
    "/v1/prompt-library",
    response_model=PromptLibraryEntry,
    status_code=201,
)
def create_prompt_library_entry(payload: CreatePromptLibraryRequest):
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="title is required")
    if not payload.body.strip():
        raise HTTPException(status_code=400, detail="body is required")
    prompt_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO prompt_library
                    (prompt_id, title, body, category, metadata,
                     is_seeded, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, false, %s, %s)
                """,
                (
                    str(prompt_id),
                    payload.title.strip(),
                    payload.body.strip(),
                    (payload.category or "general").strip(),
                    payload.metadata.strip() if payload.metadata else None,
                    now, now,
                ),
            )
        conn.commit()
    return PromptLibraryEntry(
        prompt_id=prompt_id,
        title=payload.title.strip(),
        body=payload.body.strip(),
        category=(payload.category or "general").strip(),
        metadata=payload.metadata.strip() if payload.metadata else None,
        is_seeded=False,
        created_at=now,
        updated_at=now,
    )


@router.put(
    "/v1/prompt-library/{prompt_id}",
    response_model=PromptLibraryEntry,
)
def update_prompt_library_entry(prompt_id: str, payload: UpdatePromptLibraryRequest):
    sets: List[str] = []
    params: list = []
    if payload.title is not None:
        if not payload.title.strip():
            raise HTTPException(status_code=400, detail="title cannot be empty")
        sets.append("title = %s")
        params.append(payload.title.strip())
    if payload.body is not None:
        if not payload.body.strip():
            raise HTTPException(status_code=400, detail="body cannot be empty")
        sets.append("body = %s")
        params.append(payload.body.strip())
    if payload.category is not None:
        sets.append("category = %s")
        params.append(payload.category.strip() or "general")
    if payload.metadata is not None:
        sets.append("metadata = %s")
        params.append(payload.metadata.strip() if payload.metadata.strip() else None)
    if not sets:
        raise HTTPException(status_code=400, detail="No fields to update")
    sets.append("updated_at = %s")
    params.append(datetime.now(timezone.utc))
    params.append(prompt_id)
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE prompt_library SET {', '.join(sets)} "
                f"WHERE prompt_id = %s RETURNING {_SELECT_COLS}",
                params,
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Prompt not found")
        conn.commit()
    return _row_to_entry(row)


@router.delete("/v1/prompt-library/{prompt_id}")
def delete_prompt_library_entry(prompt_id: str):
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM prompt_library WHERE prompt_id = %s RETURNING prompt_id",
                (prompt_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Prompt not found")
        conn.commit()
    return {"deleted": prompt_id}
