"""FastAPI application entry point.

This module is intentionally thin: it wires together the DB lifespan,
CORS, global error handlers, and includes each feature router defined
under ``api.routes``. All endpoints live in the individual router
modules — nothing new should be added here.
"""

from __future__ import annotations

import json
import logging
import os

import psycopg
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.db import lifespan as _lifespan
from api.routes.aio import router as aio_router
from api.routes.chat import router as chat_router
from api.routes.hsl import router as hsl_router
from api.routes.io import router as io_router
from api.routes.mro import router as mro_router
from api.routes.prompts import router as prompts_router
from api.routes.settings import router as settings_router
from api.routes.stats import router as stats_router
from api.routes.users import router as users_router
from api.routes.demo_reset import router as demo_reset_router

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("infophysics.api")


app = FastAPI(title="InformationPhysics API", version="0.1.0", lifespan=_lifespan)

cors_origins = json.loads(
    os.environ.get("CORS_ORIGINS", '["http://localhost:3000","http://localhost:3003"]')
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Feature routers. Order does not matter (no overlapping paths) but
# grouped by domain for readability.
app.include_router(settings_router)   # /, /v1/health, /v1/diag, /v1/settings/apikey
app.include_router(users_router)      # /v1/users, /v1/roles, /v1/auth/login
app.include_router(io_router)         # /v1/io
app.include_router(aio_router)        # /v1/aio-data, /v1/information-elements
app.include_router(hsl_router)        # /v1/hsl-data (+ rebuild, link-mro, find-by-needles)
app.include_router(mro_router)        # /v1/mro-objects
app.include_router(prompts_router)    # /v1/saved-prompts
app.include_router(chat_router)       # /v1/op/* (summarize, chat, aio-search, substrate, pdf)
app.include_router(stats_router)      # /v1/chat-stats
app.include_router(demo_reset_router) # /v1/op/demo-backup, /v1/op/demo-backups, /v1/op/demo-reset, /v1/op/demo-restore


# ---------------------------------------------------------------------------
# Error handlers
# ---------------------------------------------------------------------------

@app.exception_handler(psycopg.Error)
async def db_error_handler(request: Request, exc: psycopg.Error):
    logger.exception("Database error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=503,
        content={"code": "db_unavailable", "message": "Database unavailable. Is the Docker stack running?"},
    )


@app.exception_handler(Exception)
async def general_error_handler(request: Request, exc: Exception):
    logger.exception("Unexpected error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "code": "internal_error",
            "detail": f"{type(exc).__name__}: {exc}",
            "message": "An unexpected error occurred.",
        },
    )
