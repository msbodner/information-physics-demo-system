"""Users, roles, and authentication routes."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, List, Optional

import bcrypt
import psycopg
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.db import db

logger = logging.getLogger("infophysics.api.users")

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class UserOut(BaseModel):
    user_id: uuid.UUID
    username: str
    email: str
    role: str
    created_at: datetime
    is_active: bool
    last_login: Optional[datetime] = None


class CreateUserRequest(BaseModel):
    username: str
    email: str
    password: str
    role: str = "general_user"


class UpdateUserRequest(BaseModel):
    username: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginOut(BaseModel):
    user_id: uuid.UUID
    username: str
    email: str
    role: str


class RoleOut(BaseModel):
    role_id: uuid.UUID
    role_name: str
    created_at: datetime


class CreateRoleRequest(BaseModel):
    role_name: str


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

@router.get("/v1/users", response_model=List[UserOut])
def list_users():
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT user_id, username, email, role, created_at, is_active, last_login FROM users ORDER BY created_at ASC"
            )
            rows = cur.fetchall()
    return [
        UserOut(
            user_id=r[0], username=r[1], email=r[2], role=r[3],
            created_at=r[4], is_active=r[5], last_login=r[6],
        )
        for r in rows
    ]


@router.post("/v1/users", response_model=UserOut, status_code=201)
def create_user(payload: CreateUserRequest):
    if payload.role not in ("System Admin", "General User"):
        raise HTTPException(status_code=400, detail="role must be 'System Admin' or 'General User'")
    pw_hash = bcrypt.hashpw(payload.password.encode(), bcrypt.gensalt()).decode()
    user_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    with db() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    """
                    INSERT INTO users (user_id, username, email, password_hash, role, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (str(user_id), payload.username, payload.email, pw_hash, payload.role, now, now),
                )
            except Exception as e:
                if "unique" in str(e).lower():
                    raise HTTPException(status_code=409, detail="Email already exists")
                raise
        conn.commit()
    return UserOut(
        user_id=user_id, username=payload.username, email=payload.email,
        role=payload.role, created_at=now, is_active=True,
    )


@router.put("/v1/users/{user_id}", response_model=UserOut)
def update_user(user_id: str, payload: UpdateUserRequest):
    sets = []
    params: List[Any] = []
    if payload.username is not None:
        sets.append("username = %s"); params.append(payload.username)
    if payload.email is not None:
        sets.append("email = %s"); params.append(payload.email)
    if payload.password is not None:
        pw_hash = bcrypt.hashpw(payload.password.encode(), bcrypt.gensalt()).decode()
        sets.append("password_hash = %s"); params.append(pw_hash)
    if payload.role is not None:
        if payload.role not in ("System Admin", "General User"):
            raise HTTPException(status_code=400, detail="role must be 'System Admin' or 'General User'")
        sets.append("role = %s"); params.append(payload.role)
    if payload.is_active is not None:
        sets.append("is_active = %s"); params.append(payload.is_active)
    if not sets:
        raise HTTPException(status_code=400, detail="No fields to update")
    sets.append("updated_at = %s"); params.append(datetime.now(timezone.utc))
    params.append(user_id)
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE users SET {', '.join(sets)} WHERE user_id = %s "
                "RETURNING user_id, username, email, role, created_at, is_active",
                params,
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")
        conn.commit()
    return UserOut(
        user_id=row[0], username=row[1], email=row[2], role=row[3],
        created_at=row[4], is_active=row[5],
    )


@router.delete("/v1/users/{user_id}")
def delete_user(user_id: str):
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM users WHERE user_id = %s RETURNING user_id", (user_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")
        conn.commit()
    return {"deleted": user_id}


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

@router.post("/v1/auth/login", response_model=LoginOut)
def login(payload: LoginRequest):
    try:
        with db() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT user_id, username, email, role, password_hash FROM users WHERE email = %s AND is_active = true",
                    (payload.email,),
                )
                row = cur.fetchone()
    except psycopg.Error:
        raise HTTPException(status_code=503, detail="Database unavailable")
    if not row:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    user_id, username, email, role, pw_hash = row
    try:
        # Strip whitespace from stored hash (defensive)
        pw_match = bcrypt.checkpw(payload.password.encode(), pw_hash.strip().encode())
    except Exception as exc:
        logger.exception("bcrypt error for user %s", payload.email)
        raise HTTPException(status_code=500, detail=f"Password check error: {exc}")
    if not pw_match:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    # Record last login time (non-fatal)
    try:
        with db() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE users SET last_login = %s WHERE user_id = %s",
                    (datetime.now(timezone.utc), str(user_id)),
                )
            conn.commit()
    except Exception:
        pass
    return LoginOut(user_id=str(user_id), username=username, email=email, role=role)


# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------

@router.get("/v1/roles", response_model=List[RoleOut])
def list_roles():
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT role_id, role_name, created_at FROM roles ORDER BY role_name ASC")
            rows = cur.fetchall()
    return [RoleOut(role_id=r[0], role_name=r[1], created_at=r[2]) for r in rows]


@router.post("/v1/roles", response_model=RoleOut, status_code=201)
def create_role(payload: CreateRoleRequest):
    if not payload.role_name.strip():
        raise HTTPException(status_code=400, detail="role_name is required")
    role_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    with db() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    "INSERT INTO roles (role_id, role_name, created_at) VALUES (%s, %s, %s)",
                    (str(role_id), payload.role_name.strip(), now),
                )
            except Exception as e:
                if "unique" in str(e).lower():
                    raise HTTPException(status_code=409, detail="Role already exists")
                raise
        conn.commit()
    return RoleOut(role_id=role_id, role_name=payload.role_name.strip(), created_at=now)


@router.delete("/v1/roles/{role_id}")
def delete_role(role_id: str):
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM roles WHERE role_id = %s RETURNING role_id", (role_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Role not found")
        conn.commit()
    return {"deleted": role_id}
