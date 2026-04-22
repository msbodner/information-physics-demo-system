"""Saved prompts CRUD."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from api.db import db

logger = logging.getLogger("infophysics.api.prompts")

router = APIRouter()


class SavedPromptOut(BaseModel):
    prompt_id: uuid.UUID
    prompt_text: str
    label: Optional[str] = None
    category: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class CreateSavedPromptRequest(BaseModel):
    prompt_text: str
    label: Optional[str] = None
    category: Optional[str] = None


class UpdateSavedPromptRequest(BaseModel):
    prompt_text: Optional[str] = None
    label: Optional[str] = None
    category: Optional[str] = None


@router.get("/v1/saved-prompts", response_model=List[SavedPromptOut])
def list_saved_prompts(limit: int = Query(5000, ge=1, le=100000)):
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT prompt_id, prompt_text, label, category, created_at, updated_at FROM saved_prompts ORDER BY updated_at DESC LIMIT %s",
                (limit,),
            )
            rows = cur.fetchall()
    return [
        SavedPromptOut(prompt_id=r[0], prompt_text=r[1], label=r[2], category=r[3], created_at=r[4], updated_at=r[5])
        for r in rows
    ]


@router.post("/v1/saved-prompts", response_model=SavedPromptOut, status_code=201)
def create_saved_prompt(payload: CreateSavedPromptRequest):
    if not payload.prompt_text.strip():
        raise HTTPException(status_code=400, detail="prompt_text is required")
    prompt_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO saved_prompts (prompt_id, prompt_text, label, category, created_at, updated_at) VALUES (%s, %s, %s, %s, %s, %s)",
                (str(prompt_id), payload.prompt_text.strip(), payload.label, payload.category, now, now),
            )
        conn.commit()
    return SavedPromptOut(
        prompt_id=prompt_id,
        prompt_text=payload.prompt_text.strip(),
        label=payload.label,
        category=payload.category,
        created_at=now,
        updated_at=now,
    )


@router.put("/v1/saved-prompts/{prompt_id}", response_model=SavedPromptOut)
def update_saved_prompt(prompt_id: str, payload: UpdateSavedPromptRequest):
    now = datetime.now(timezone.utc)
    sets = []
    vals = []
    if payload.prompt_text is not None:
        sets.append("prompt_text = %s")
        vals.append(payload.prompt_text.strip())
    if payload.label is not None:
        sets.append("label = %s")
        vals.append(payload.label)
    if payload.category is not None:
        sets.append("category = %s")
        vals.append(payload.category)
    sets.append("updated_at = %s")
    vals.append(now)
    vals.append(prompt_id)
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE saved_prompts SET {', '.join(sets)} WHERE prompt_id = %s",
                vals,
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Saved prompt not found")
        conn.commit()
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT prompt_id, prompt_text, label, category, created_at, updated_at FROM saved_prompts WHERE prompt_id = %s",
                (prompt_id,),
            )
            row = cur.fetchone()
    return SavedPromptOut(prompt_id=row[0], prompt_text=row[1], label=row[2], category=row[3], created_at=row[4], updated_at=row[5])


@router.delete("/v1/saved-prompts/{prompt_id}")
def delete_saved_prompt(prompt_id: str):
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM saved_prompts WHERE prompt_id = %s RETURNING prompt_id", (prompt_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Saved prompt not found")
        conn.commit()
    return {"deleted": prompt_id}
