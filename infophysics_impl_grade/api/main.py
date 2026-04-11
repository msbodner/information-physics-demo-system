import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import unquote

import bcrypt

import psycopg
from dotenv import load_dotenv
import base64
from fastapi import FastAPI, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("infophysics.api")

app = FastAPI(title="InformationPhysics API", version="0.1.0")

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


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def db():
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL not set")
    return psycopg.connect(url)


def set_tenant(conn, tenant_id: str):
    # SET LOCAL does not support parameterized queries; sanitize manually
    safe_id = tenant_id.replace("'", "''")
    with conn.cursor() as cur:
        cur.execute(f"SET LOCAL app.tenant_id = '{safe_id}'")


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class RawIn(BaseModel):
    raw_uri: Optional[str] = None
    raw_hash: Optional[str] = None
    mime_type: Optional[str] = None
    size_bytes: Optional[int] = None


class ContextIn(BaseModel):
    source_system: Optional[str] = None
    source_object_id: Optional[str] = None
    author: Optional[str] = None
    permissions_ref: Optional[str] = None
    policy_scope_id: Optional[str] = None


class CreateIORequest(BaseModel):
    type: str
    raw: RawIn
    context: ContextIn
    dedupe: Dict[str, Any] = Field(default_factory=lambda: {"mode": "hash_or_source"})


class IOOut(BaseModel):
    io_id: uuid.UUID
    tenant_id: str
    type: str
    created_at: datetime
    raw: Dict[str, Any] = Field(default_factory=dict)
    context: Dict[str, Any] = Field(default_factory=dict)


class ListIOResponse(BaseModel):
    items: List[IOOut]


class SummarizeRequest(BaseModel):
    io_id: Optional[str] = None
    aio_texts: Optional[List[str]] = None
    scope: str = "corpus"
    model_ref: str = "claude-sonnet-4-6"
    params: Dict[str, Any] = Field(default_factory=dict)


class SummarizeResponse(BaseModel):
    summary: str
    model_ref: str
    aio_count: int


class ResolveEntitiesRequest(BaseModel):
    io_id: Optional[str] = None
    aio_text: Optional[str] = None
    params: Dict[str, Any] = Field(default_factory=dict)


class EntityItem(BaseModel):
    name: str
    type: str
    value: str
    confidence: float


class ResolveEntitiesResponse(BaseModel):
    entities: List[EntityItem]
    model_ref: str


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage]


class ChatResponse(BaseModel):
    reply: str
    model_ref: str
    context_records: int


class AioSearchResponse(BaseModel):
    reply: str
    model_ref: str
    context_records: int
    matched_hsls: int
    matched_aios: int
    search_terms: Dict[str, Any]


# User management models
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


# API key settings
class ApiKeyRequest(BaseModel):
    api_key: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/")
async def root_health():
    """Root health endpoint for Railway healthcheck."""
    return {"status": "ok"}


@app.get("/v1/health")
def health():
    return {"status": "ok"}


@app.get("/v1/diag")
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


@app.post("/v1/io", response_model=Dict[str, IOOut], status_code=201)
def create_io(payload: CreateIORequest, x_tenant_id: str = Header(..., alias="X-Tenant-Id")):
    logger.info("create_io tenant=%s type=%s source=%s", x_tenant_id, payload.type, payload.context.source_object_id)
    io_id = uuid.uuid4()
    created_at = datetime.now(timezone.utc)

    with db() as conn:
        set_tenant(conn, x_tenant_id)
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO tenants(tenant_id, name) VALUES(%s, %s) ON CONFLICT (tenant_id) DO NOTHING",
                (x_tenant_id, x_tenant_id),
            )
            cur.execute(
                """
                INSERT INTO information_objects(
                    io_id, tenant_id, type, created_at,
                    raw_uri, raw_hash, mime_type, size_bytes,
                    source_system, source_object_id, author, policy_scope_id
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    str(io_id), x_tenant_id, payload.type, created_at,
                    payload.raw.raw_uri, payload.raw.raw_hash,
                    payload.raw.mime_type, payload.raw.size_bytes,
                    payload.context.source_system, payload.context.source_object_id,
                    payload.context.author, payload.context.policy_scope_id,
                ),
            )
        conn.commit()

    return {
        "item": IOOut(
            io_id=io_id,
            tenant_id=x_tenant_id,
            type=payload.type,
            created_at=created_at,
            raw=payload.raw.model_dump(),
            context=payload.context.model_dump(),
        )
    }


@app.get("/v1/io", response_model=ListIOResponse)
def list_ios(
    x_tenant_id: str = Header(..., alias="X-Tenant-Id"),
    type: Optional[str] = Query(None),
    source_system: Optional[str] = Query(None),
    created_after: Optional[datetime] = Query(None),
    created_before: Optional[datetime] = Query(None),
    limit: int = Query(50, ge=1, le=500),
):
    logger.info("list_ios tenant=%s type=%s source=%s limit=%d", x_tenant_id, type, source_system, limit)

    conditions = ["tenant_id = %s", "is_deleted = false"]
    params: List[Any] = [x_tenant_id]

    if type:
        conditions.append("type = %s")
        params.append(type)
    if source_system:
        conditions.append("source_system = %s")
        params.append(source_system)
    if created_after:
        conditions.append("created_at >= %s")
        params.append(created_after)
    if created_before:
        conditions.append("created_at <= %s")
        params.append(created_before)

    params.append(limit)
    sql = f"""
        SELECT io_id, tenant_id, type, created_at, raw_uri, raw_hash, mime_type, size_bytes,
               source_system, source_object_id, author, policy_scope_id
        FROM information_objects
        WHERE {" AND ".join(conditions)}
        ORDER BY created_at DESC
        LIMIT %s
    """

    with db() as conn:
        set_tenant(conn, x_tenant_id)
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

    items = [
        IOOut(
            io_id=row[0],
            tenant_id=row[1],
            type=row[2],
            created_at=row[3],
            raw={"raw_uri": row[4], "raw_hash": row[5], "mime_type": row[6], "size_bytes": row[7]},
            context={"source_system": row[8], "source_object_id": row[9], "author": row[10], "policy_scope_id": row[11]},
        )
        for row in rows
    ]
    return ListIOResponse(items=items)


@app.get("/v1/io/{io_id}", response_model=IOOut)
def get_io(io_id: str, x_tenant_id: str = Header(..., alias="X-Tenant-Id")):
    logger.info("get_io tenant=%s io_id=%s", x_tenant_id, io_id)
    with db() as conn:
        set_tenant(conn, x_tenant_id)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT io_id, tenant_id, type, created_at, raw_uri, raw_hash, mime_type, size_bytes,
                       source_system, source_object_id, author, policy_scope_id
                FROM information_objects
                WHERE io_id = %s AND is_deleted = false
                """,
                (io_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Not found")
    return IOOut(
        io_id=row[0],
        tenant_id=row[1],
        type=row[2],
        created_at=row[3],
        raw={"raw_uri": row[4], "raw_hash": row[5], "mime_type": row[6], "size_bytes": row[7]},
        context={"source_system": row[8], "source_object_id": row[9], "author": row[10], "policy_scope_id": row[11]},
    )


@app.post("/v1/op/summarize", response_model=SummarizeResponse)
def summarize(payload: SummarizeRequest, x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id")):
    logger.info("summarize tenant=%s aio_count=%d", x_tenant_id, len(payload.aio_texts or []))

    api_key = get_effective_api_key()
    if not api_key:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")

    texts = payload.aio_texts or []
    if not texts:
        raise HTTPException(status_code=400, detail="aio_texts must not be empty")

    # Limit to first 200 AIOs to stay within token budget
    sample = texts[:200]
    joined = "\n".join(sample)

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=(
                "You are an Information Physics analyst specializing in Associated Information Objects (AIOs). "
                "Each AIO is a bracketed key-value record: [Key.Value]. Summarize the provided AIO dataset concisely. "
                "Identify dominant themes, key entities, value distributions, and semantic patterns. "
                "Structure your summary with: Overview (2-3 sentences), Key Entities, Main Themes, Notable Patterns."
            ),
            messages=[{"role": "user", "content": f"Summarize this AIO dataset ({len(sample)} records):\n\n{joined}"}],
        )
        summary_text = response.content[0].text
    except Exception as exc:
        logger.exception("Anthropic API error during summarize")
        raise HTTPException(status_code=502, detail=f"LLM error: {str(exc)}")

    return SummarizeResponse(
        summary=summary_text,
        model_ref="claude-sonnet-4-6",
        aio_count=len(texts),
    )


@app.post("/v1/op/resolve-entities", response_model=ResolveEntitiesResponse)
def resolve_entities(payload: ResolveEntitiesRequest, x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id")):
    logger.info("resolve_entities tenant=%s", x_tenant_id)

    api_key = get_effective_api_key()
    if not api_key:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")

    aio_text = payload.aio_text or ""
    if not aio_text:
        raise HTTPException(status_code=400, detail="aio_text must not be empty")

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=800,
            system=(
                "You are an entity extractor for AIO (Associated Information Object) data. "
                "Extract named entities from the provided AIO string. "
                "Return ONLY a valid JSON array with no other text. "
                'Each object must have: "name" (string), "type" (one of: Person, Organization, Location, Date, Product, Project, Other), '
                '"value" (the extracted value from the AIO), "confidence" (float 0.0-1.0).'
            ),
            messages=[{"role": "user", "content": f"Extract entities from this AIO:\n\n{aio_text}"}],
        )
        raw = response.content[0].text.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        entities_data = json.loads(raw)
        entities = [EntityItem(**e) for e in entities_data]
    except json.JSONDecodeError:
        logger.warning("Failed to parse entity JSON response, returning empty")
        entities = []
    except Exception as exc:
        logger.exception("Anthropic API error during resolve_entities")
        raise HTTPException(status_code=502, detail=f"LLM error: {str(exc)}")

    return ResolveEntitiesResponse(entities=entities, model_ref="claude-sonnet-4-6")


@app.post("/v1/op/chat", response_model=ChatResponse)
def chat(payload: ChatRequest, x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id")):
    logger.info("chat tenant=%s messages=%d", x_tenant_id, len(payload.messages))

    api_key = get_effective_api_key()
    if not api_key:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages must not be empty")

    tenant = x_tenant_id or "default"

    # Fetch AIOs, HSLs, and CSVs from DB for context
    aio_lines: List[str] = []
    hsl_blocks: List[str] = []
    try:
        conn = db()
        with conn:
            set_tenant(conn, tenant)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT raw_uri, type
                    FROM information_objects
                    WHERE type IN ('AIO', 'HSL', 'CSV')
                    ORDER BY created_at DESC
                    LIMIT 500
                    """
                )
                for row in cur.fetchall():
                    raw_uri = row[0] or ""
                    rec_type = row[1] or ""
                    if raw_uri.startswith("data:text/aio,"):
                        aio_lines.append(unquote(raw_uri[len("data:text/aio,"):]))
                    elif raw_uri.startswith("data:text/hsl,"):
                        hsl_blocks.append(unquote(raw_uri[len("data:text/hsl,"):]))
                    elif raw_uri.startswith("data:text/csv,"):
                        # Treat CSV rows as additional AIO-like context
                        pass
    except Exception:
        logger.warning("Could not fetch DB context for chat — proceeding without it")

    # Build system prompt with embedded data context
    context_section = ""
    if aio_lines:
        sample = aio_lines[:300]
        context_section += f"\n\n## AIO Records ({len(sample)} of {len(aio_lines)} total)\n"
        context_section += "\n".join(sample)
    if hsl_blocks:
        context_section += f"\n\n## HSL Files ({len(hsl_blocks)} total)\n"
        context_section += "\n\n---\n\n".join(hsl_blocks[:10])

    system = (
        "You are ChatAIO, an intelligent analyst for Information Physics data. "
        "Each AIO record is a self-describing key-value string using bracket notation: [Key.Value][Key2.Value2]... "
        "You can extract numeric values, group records by field, sum amounts, count occurrences, and answer questions about the data. "
        "When computing totals or breakdowns, show your work step by step. "
        "Be concise and precise. If no relevant data is available, say so clearly."
    )
    if context_section:
        system += "\n\n# Data Context" + context_section

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            system=system,
            messages=[{"role": m.role, "content": m.content} for m in payload.messages],
        )
        reply_text = response.content[0].text
    except Exception as exc:
        logger.exception("Anthropic API error during chat")
        raise HTTPException(status_code=502, detail=f"LLM error: {str(exc)}")

    return ChatResponse(
        reply=reply_text,
        model_ref="claude-sonnet-4-6",
        context_records=len(aio_lines) + len(hsl_blocks),
    )


# ---------------------------------------------------------------------------
# AIO Search Algebra
# ---------------------------------------------------------------------------

@app.post("/v1/op/aio-search", response_model=AioSearchResponse)
def aio_search(payload: ChatRequest, x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id")):
    """Four-phase search algebra: parse → match HSLs → gather AIOs → answer."""
    api_key = get_effective_api_key()
    if not api_key:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages must not be empty")

    tenant = x_tenant_id or "default"
    user_prompt = payload.messages[-1].content

    # ── Phase 1: Parse prompt into search terms using Claude ──
    known_fields: List[str] = []
    try:
        conn = db()
        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT field_name FROM information_elements ORDER BY aio_count DESC LIMIT 50")
                known_fields = [r[0] for r in cur.fetchall()]
    except Exception:
        pass

    import anthropic
    client = anthropic.Anthropic(api_key=api_key)

    parse_system = (
        "You are a search term extractor for AIO bracket-notation data. "
        "AIO records use [FieldName.Value] format. "
        f"Known field names in this dataset: {', '.join(known_fields)}. "
        "Given a user's question, extract structured search terms. "
        "Return ONLY valid JSON with no other text: "
        '{"field_values": [{"field": "FieldName", "value": "SearchValue"}], '
        '"keywords": ["free text search term", ...]}'
    )

    try:
        parse_response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=500,
            system=parse_system,
            messages=[{"role": "user", "content": user_prompt}],
        )
        raw_json = parse_response.content[0].text.strip()
        if raw_json.startswith("```"):
            raw_json = raw_json.split("```")[1]
            if raw_json.startswith("json"):
                raw_json = raw_json[4:]
        search_terms = json.loads(raw_json)
    except Exception:
        logger.warning("Failed to parse search terms, falling back to keyword split")
        search_terms = {"field_values": [], "keywords": user_prompt.split()}

    logger.info("AIO Search parsed terms: %s", search_terms)

    # ── Phase 2: Search HSL library ──
    needles: List[str] = []
    for fv in search_terms.get("field_values", []):
        v = fv.get("value", "").strip()
        if v:
            needles.append(v.lower())
    for kw in search_terms.get("keywords", []):
        if kw and len(kw) >= 2:
            needles.append(kw.lower())
    needles = list(set(needles))

    matched_hsl_rows = []
    try:
        conn = db()
        with conn:
            with conn.cursor() as cur:
                cur.execute(f"SELECT hsl_id, hsl_name, {_HSL_COLS} FROM hsl_data LIMIT 1000")
                for row in cur.fetchall():
                    hsl_elements = [str(e).lower() for e in row[2:] if e]
                    combined = " ".join(hsl_elements) + " " + (row[1] or "").lower()
                    if any(needle in combined for needle in needles):
                        matched_hsl_rows.append(row)
    except Exception:
        logger.warning("HSL search failed")

    logger.info("AIO Search: %d HSLs matched", len(matched_hsl_rows))

    # ── Phase 3: Gather AIOs from matched HSLs ──
    aio_refs: set = set()
    for row in matched_hsl_rows:
        for elem in row[2:]:
            if elem and isinstance(elem, str) and elem.strip():
                aio_refs.add(elem.strip())

    matched_aio_lines: List[str] = []
    try:
        conn = db()
        with conn:
            with conn.cursor() as cur:
                if aio_refs:
                    placeholders = ", ".join(["%s"] * len(aio_refs))
                    cur.execute(
                        f"SELECT aio_name, {_AIO_COLS} FROM aio_data WHERE aio_name IN ({placeholders})",
                        list(aio_refs),
                    )
                    for row in cur.fetchall():
                        elements = [e for e in row[1:] if e]
                        matched_aio_lines.append(f"{row[0]}: " + "".join(elements))

                # Fallback: direct AIO search if no HSL matches or few results
                if not matched_aio_lines and needles:
                    conditions = []
                    params = []
                    for needle in needles[:10]:
                        for i in range(1, 51):
                            conditions.append(f"element_{i} ILIKE %s")
                            params.append(f"%{needle}%")
                    where_clause = " OR ".join(conditions)
                    cur.execute(
                        f"SELECT aio_name, {_AIO_COLS} FROM aio_data WHERE {where_clause} LIMIT 200",
                        params,
                    )
                    for row in cur.fetchall():
                        elements = [e for e in row[1:] if e]
                        matched_aio_lines.append(f"{row[0]}: " + "".join(elements))
    except Exception:
        logger.warning("AIO gathering failed")

    # Deduplicate
    matched_aio_lines = list(dict.fromkeys(matched_aio_lines))
    logger.info("AIO Search: %d AIOs in context", len(matched_aio_lines))

    # ── Phase 4: Answer using focused context ──
    context_section = ""
    if matched_aio_lines:
        sample = matched_aio_lines[:300]
        context_section = f"\n\n## Matched AIO Records ({len(sample)} of {len(matched_aio_lines)} total)\n"
        context_section += "\n".join(sample)

    answer_system = (
        "You are ChatAIO, an intelligent analyst for Information Physics data. "
        "You have been given a FOCUSED subset of AIO records that match the user's query. "
        "Each AIO record uses bracket notation: [Key.Value][Key2.Value2]... "
        "Answer the user's question using ONLY the provided records. "
        "When computing totals or breakdowns, show your work step by step. "
        "Be concise and precise. If the data is insufficient, say so."
    )
    if context_section:
        answer_system += "\n\n# Data Context" + context_section
    else:
        answer_system += "\n\nNo matching AIO records were found for this query."

    try:
        answer_response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            system=answer_system,
            messages=[{"role": m.role, "content": m.content} for m in payload.messages],
        )
        reply_text = answer_response.content[0].text
    except Exception as exc:
        logger.exception("Anthropic API error during AIO search answer")
        raise HTTPException(status_code=502, detail=f"LLM error: {str(exc)}")

    return AioSearchResponse(
        reply=reply_text,
        model_ref="claude-sonnet-4-6",
        context_records=len(matched_aio_lines),
        matched_hsls=len(matched_hsl_rows),
        matched_aios=len(matched_aio_lines),
        search_terms=search_terms,
    )


# ---------------------------------------------------------------------------
# PDF → CSV extraction
# ---------------------------------------------------------------------------

@app.post("/v1/op/pdf-extract")
async def pdf_extract(file: UploadFile = File(...)):
    """Extract structured data from a PDF using Claude AI and return as CSV."""
    api_key = get_effective_api_key()
    if not api_key:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")

    pdf_bytes = await file.read()
    if len(pdf_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(pdf_bytes) > 20 * 1024 * 1024:  # 20MB limit
        raise HTTPException(status_code=400, detail="PDF too large (max 20MB)")

    pdf_b64 = base64.standard_b64encode(pdf_bytes).decode("utf-8")

    system_prompt = (
        "You are a document data extractor. Analyze the provided PDF document(s) and extract ALL structured data into CSV format.\n\n"
        "Rules:\n"
        "- Create a single CSV with consistent column headers\n"
        "- If the PDF contains multiple documents (e.g., multiple invoices), create one row per document\n"
        "- Extract every data field you can identify (dates, amounts, names, addresses, line items, totals, etc.)\n"
        "- Use clear, descriptive column headers\n"
        "- Return ONLY the CSV content, no explanation or markdown code fences\n"
        "- First row must be headers\n"
        "- Use comma as delimiter, quote fields containing commas\n"
    )

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=8192,
            system=system_prompt,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": pdf_b64,
                        },
                    },
                    {
                        "type": "text",
                        "text": "Extract all structured data from this PDF into CSV format. Return only the CSV with headers.",
                    },
                ],
            }],
        )
    except Exception as e:
        logger.error("PDF extraction failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Claude API error: {str(e)}")

    csv_text = response.content[0].text.strip()
    # Strip markdown code fences if present
    if csv_text.startswith("```"):
        lines = csv_text.split("\n")
        lines = [l for l in lines if not l.startswith("```")]
        csv_text = "\n".join(lines).strip()

    # Parse into headers and rows
    import csv as csv_mod
    import io
    reader = csv_mod.reader(io.StringIO(csv_text))
    all_rows = list(reader)
    headers = all_rows[0] if all_rows else []
    rows = all_rows[1:] if len(all_rows) > 1 else []

    return {
        "csv_text": csv_text,
        "headers": headers,
        "rows": rows,
        "document_count": len(rows),
        "filename": file.filename,
    }


# ---------------------------------------------------------------------------
# User management
# ---------------------------------------------------------------------------

@app.get("/v1/users", response_model=List[UserOut])
def list_users():
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT user_id, username, email, role, created_at, is_active, last_login FROM users ORDER BY created_at ASC"
            )
            rows = cur.fetchall()
    return [
        UserOut(user_id=r[0], username=r[1], email=r[2], role=r[3], created_at=r[4], is_active=r[5], last_login=r[6])
        for r in rows
    ]


@app.post("/v1/users", response_model=UserOut, status_code=201)
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
    return UserOut(user_id=user_id, username=payload.username, email=payload.email, role=payload.role, created_at=now, is_active=True)


@app.put("/v1/users/{user_id}", response_model=UserOut)
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
                f"UPDATE users SET {', '.join(sets)} WHERE user_id = %s RETURNING user_id, username, email, role, created_at, is_active",
                params,
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")
        conn.commit()
    return UserOut(user_id=row[0], username=row[1], email=row[2], role=row[3], created_at=row[4], is_active=row[5])


@app.delete("/v1/users/{user_id}")
def delete_user(user_id: str):
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM users WHERE user_id = %s RETURNING user_id", (user_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")
        conn.commit()
    return {"deleted": user_id}


@app.post("/v1/auth/login", response_model=LoginOut)
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
    # Record last login time
    try:
        with db() as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE users SET last_login = %s WHERE user_id = %s", (datetime.now(timezone.utc), str(user_id)))
            conn.commit()
    except Exception:
        pass  # Non-fatal
    return LoginOut(user_id=str(user_id), username=username, email=email, role=role)


# ---------------------------------------------------------------------------
# Settings: API key
# ---------------------------------------------------------------------------

def _get_api_key_from_db() -> Optional[str]:
    try:
        with db() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT value FROM system_settings WHERE key = 'anthropic_api_key'")
                row = cur.fetchone()
                return row[0] if row else None
    except Exception:
        return None


def get_effective_api_key() -> Optional[str]:
    """Check DB first, fall back to env var."""
    db_key = _get_api_key_from_db()
    return db_key or os.environ.get("ANTHROPIC_API_KEY")


@app.get("/v1/settings/apikey")
def get_api_key_setting():
    key = get_effective_api_key()
    if not key:
        return {"configured": False, "masked": None}
    masked = key[:7] + "..." + key[-4:] if len(key) > 11 else "***"
    return {"configured": True, "masked": masked}


@app.put("/v1/settings/apikey")
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
# Storage Settings (directory paths for AIO/HSL/MRO/PDF downloads)
# ---------------------------------------------------------------------------

class StorageSettings(BaseModel):
    aio_dir: str = ""
    hsl_dir: str = ""
    mro_dir: str = ""
    pdf_dir: str = ""


class StorageSettingsRequest(BaseModel):
    aio_dir: Optional[str] = None
    hsl_dir: Optional[str] = None
    mro_dir: Optional[str] = None
    pdf_dir: Optional[str] = None


_STORAGE_KEY_MAP = {
    "aio_dir": "storage_aio_dir",
    "hsl_dir": "storage_hsl_dir",
    "mro_dir": "storage_mro_dir",
    "pdf_dir": "storage_pdf_dir",
}


@app.get("/v1/settings/storage", response_model=StorageSettings)
def get_storage_settings():
    result = StorageSettings()
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT key, value FROM system_settings WHERE key = ANY(%s)",
                (list(_STORAGE_KEY_MAP.values()),),
            )
            rows = {row[0]: row[1] for row in cur.fetchall()}
    for attr, setting_key in _STORAGE_KEY_MAP.items():
        setattr(result, attr, rows.get(setting_key, "") or "")
    return result


@app.put("/v1/settings/storage")
def update_storage_settings(payload: StorageSettingsRequest):
    now = datetime.now(timezone.utc)
    updates = []
    data = payload.model_dump()
    for attr, setting_key in _STORAGE_KEY_MAP.items():
        value = data.get(attr)
        if value is not None:
            updates.append((setting_key, value, now))
    if not updates:
        return {"ok": True, "updated": 0}
    with db() as conn:
        with conn.cursor() as cur:
            for setting_key, value, ts in updates:
                cur.execute(
                    """
                    INSERT INTO system_settings (key, value, updated_at)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
                    """,
                    (setting_key, value, ts),
                )
        conn.commit()
    return {"ok": True, "updated": len(updates)}


# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------

class RoleOut(BaseModel):
    role_id: uuid.UUID
    role_name: str
    created_at: datetime


class CreateRoleRequest(BaseModel):
    role_name: str


@app.get("/v1/roles", response_model=List[RoleOut])
def list_roles():
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT role_id, role_name, created_at FROM roles ORDER BY role_name ASC")
            rows = cur.fetchall()
    return [RoleOut(role_id=r[0], role_name=r[1], created_at=r[2]) for r in rows]


@app.post("/v1/roles", response_model=RoleOut, status_code=201)
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


@app.delete("/v1/roles/{role_id}")
def delete_role(role_id: str):
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM roles WHERE role_id = %s RETURNING role_id", (role_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Role not found")
        conn.commit()
    return {"deleted": role_id}


# ---------------------------------------------------------------------------
# AIO Data
# ---------------------------------------------------------------------------

_AIO_ELEMENTS = [f"element_{i}" for i in range(1, 51)]
_AIO_COLS = ", ".join(_AIO_ELEMENTS)
_AIO_PLACEHOLDERS = ", ".join(["%s"] * 50)


class AioDataOut(BaseModel):
    aio_id: uuid.UUID
    aio_name: str
    elements: List[Optional[str]]
    created_at: datetime
    updated_at: datetime


class AioDataRequest(BaseModel):
    aio_name: str
    elements: List[Optional[str]] = Field(default_factory=lambda: [None] * 50)


def _aio_row_to_out(row) -> AioDataOut:
    # row: aio_id, aio_name, element_1..50, created_at, updated_at
    return AioDataOut(
        aio_id=row[0],
        aio_name=row[1],
        elements=list(row[2:52]),
        created_at=row[52],
        updated_at=row[53],
    )


@app.get("/v1/aio-data", response_model=List[AioDataOut])
def list_aio_data(limit: int = Query(200, ge=1, le=1000)):
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT aio_id, aio_name, {_AIO_COLS}, created_at, updated_at FROM aio_data ORDER BY created_at DESC LIMIT %s",
                (limit,),
            )
            rows = cur.fetchall()
    return [_aio_row_to_out(r) for r in rows]


@app.post("/v1/aio-data", response_model=AioDataOut, status_code=201)
def create_aio_data(payload: AioDataRequest):
    if not payload.aio_name.strip():
        raise HTTPException(status_code=400, detail="aio_name is required")
    aio_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    elems = (payload.elements + [None] * 50)[:50]
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO aio_data (aio_id, aio_name, {_AIO_COLS}, created_at, updated_at) VALUES (%s, %s, {_AIO_PLACEHOLDERS}, %s, %s)",
                [str(aio_id), payload.aio_name.strip()] + elems + [now, now],
            )
        conn.commit()
    # Auto-update information_elements for new field names
    try:
        field_names = _extract_field_names(elems)
        if field_names:
            with db() as conn:
                _sync_information_elements(conn, field_names)
    except Exception as e:
        logger.warning(f"Failed to sync information_elements: {e}")
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(f"SELECT aio_id, aio_name, {_AIO_COLS}, created_at, updated_at FROM aio_data WHERE aio_id = %s", (str(aio_id),))
            row = cur.fetchone()
    return _aio_row_to_out(row)


@app.put("/v1/aio-data/{aio_id}", response_model=AioDataOut)
def update_aio_data(aio_id: str, payload: AioDataRequest):
    if not payload.aio_name.strip():
        raise HTTPException(status_code=400, detail="aio_name is required")
    now = datetime.now(timezone.utc)
    elems = (payload.elements + [None] * 50)[:50]
    sets = "aio_name = %s, " + ", ".join([f"element_{i} = %s" for i in range(1, 51)]) + ", updated_at = %s"
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE aio_data SET {sets} WHERE aio_id = %s",
                [payload.aio_name.strip()] + elems + [now, aio_id],
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="AIO record not found")
        conn.commit()
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(f"SELECT aio_id, aio_name, {_AIO_COLS}, created_at, updated_at FROM aio_data WHERE aio_id = %s", (aio_id,))
            row = cur.fetchone()
    return _aio_row_to_out(row)


@app.delete("/v1/aio-data/{aio_id}")
def delete_aio_data(aio_id: str):
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM aio_data WHERE aio_id = %s RETURNING aio_id", (aio_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="AIO record not found")
        conn.commit()
    return {"deleted": aio_id}


# ---------------------------------------------------------------------------
# HSL Data
# ---------------------------------------------------------------------------

_HSL_ELEMENTS = [f"hsl_element_{i}" for i in range(1, 101)]
_HSL_COLS = ", ".join(_HSL_ELEMENTS)
_HSL_PLACEHOLDERS = ", ".join(["%s"] * 100)


class HslDataOut(BaseModel):
    hsl_id: uuid.UUID
    hsl_name: str
    elements: List[Optional[str]]
    created_at: datetime
    updated_at: datetime


class HslDataRequest(BaseModel):
    hsl_name: str
    elements: List[Optional[str]] = Field(default_factory=lambda: [None] * 100)


def _hsl_row_to_out(row) -> HslDataOut:
    # row: hsl_id, hsl_name, hsl_element_1..100, created_at, updated_at
    return HslDataOut(
        hsl_id=row[0],
        hsl_name=row[1],
        elements=list(row[2:102]),
        created_at=row[102],
        updated_at=row[103],
    )


@app.get("/v1/hsl-data", response_model=List[HslDataOut])
def list_hsl_data(limit: int = Query(200, ge=1, le=1000)):
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT hsl_id, hsl_name, {_HSL_COLS}, created_at, updated_at FROM hsl_data ORDER BY created_at DESC LIMIT %s",
                (limit,),
            )
            rows = cur.fetchall()
    return [_hsl_row_to_out(r) for r in rows]


@app.post("/v1/hsl-data", response_model=HslDataOut, status_code=201)
def create_hsl_data(payload: HslDataRequest):
    if not payload.hsl_name.strip():
        raise HTTPException(status_code=400, detail="hsl_name is required")
    hsl_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    elems = (payload.elements + [None] * 100)[:100]
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO hsl_data (hsl_id, hsl_name, {_HSL_COLS}, created_at, updated_at) VALUES (%s, %s, {_HSL_PLACEHOLDERS}, %s, %s)",
                [str(hsl_id), payload.hsl_name.strip()] + elems + [now, now],
            )
        conn.commit()
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(f"SELECT hsl_id, hsl_name, {_HSL_COLS}, created_at, updated_at FROM hsl_data WHERE hsl_id = %s", (str(hsl_id),))
            row = cur.fetchone()
    return _hsl_row_to_out(row)


@app.put("/v1/hsl-data/{hsl_id}", response_model=HslDataOut)
def update_hsl_data(hsl_id: str, payload: HslDataRequest):
    if not payload.hsl_name.strip():
        raise HTTPException(status_code=400, detail="hsl_name is required")
    now = datetime.now(timezone.utc)
    elems = (payload.elements + [None] * 100)[:100]
    sets = "hsl_name = %s, " + ", ".join([f"hsl_element_{i} = %s" for i in range(1, 101)]) + ", updated_at = %s"
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE hsl_data SET {sets} WHERE hsl_id = %s",
                [payload.hsl_name.strip()] + elems + [now, hsl_id],
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="HSL record not found")
        conn.commit()
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(f"SELECT hsl_id, hsl_name, {_HSL_COLS}, created_at, updated_at FROM hsl_data WHERE hsl_id = %s", (hsl_id,))
            row = cur.fetchone()
    return _hsl_row_to_out(row)


@app.delete("/v1/hsl-data/{hsl_id}")
def delete_hsl_data(hsl_id: str):
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM hsl_data WHERE hsl_id = %s RETURNING hsl_id", (hsl_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="HSL record not found")
        conn.commit()
    return {"deleted": hsl_id}


# ---------------------------------------------------------------------------
# Saved Prompts
# ---------------------------------------------------------------------------


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


@app.get("/v1/saved-prompts", response_model=List[SavedPromptOut])
def list_saved_prompts(limit: int = Query(100, ge=1, le=1000)):
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


@app.post("/v1/saved-prompts", response_model=SavedPromptOut, status_code=201)
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


@app.put("/v1/saved-prompts/{prompt_id}", response_model=SavedPromptOut)
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


@app.delete("/v1/saved-prompts/{prompt_id}")
def delete_saved_prompt(prompt_id: str):
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM saved_prompts WHERE prompt_id = %s RETURNING prompt_id", (prompt_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Saved prompt not found")
        conn.commit()
    return {"deleted": prompt_id}


# ── Information Elements ───────────────────────────────────────────

import re as _re

def _extract_field_names(elements: list) -> list[str]:
    """Extract unique [FieldName.Data] field names from AIO element strings."""
    names = set()
    for el in elements:
        if el and isinstance(el, str):
            m = _re.match(r"\[([^.\]]+)\.", el)
            if m:
                names.add(m.group(1))
    return list(names)


def _sync_information_elements(conn, field_names: list[str]):
    """Upsert field names into information_elements and recount AIOs for each."""
    if not field_names:
        return
    with conn.cursor() as cur:
        for fn in field_names:
            # Count AIOs that have this field name in any element column
            like_pattern = f"[{fn}.%"
            cur.execute(
                f"SELECT COUNT(DISTINCT aio_id) FROM aio_data WHERE "
                + " OR ".join([f"element_{i} LIKE %s" for i in range(1, 51)]),
                [like_pattern] * 50,
            )
            count = cur.fetchone()[0]
            cur.execute(
                """INSERT INTO information_elements (field_name, aio_count, updated_at)
                   VALUES (%s, %s, now())
                   ON CONFLICT (field_name) DO UPDATE SET aio_count = %s, updated_at = now()""",
                (fn, count, count),
            )
    conn.commit()


class InformationElementOut(BaseModel):
    element_id: str
    field_name: str
    aio_count: int
    created_at: str
    updated_at: str


class InformationElementRequest(BaseModel):
    field_name: str
    aio_count: int = 0


@app.get("/v1/information-elements")
def list_information_elements():
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT element_id, field_name, aio_count, created_at, updated_at FROM information_elements ORDER BY field_name")
            rows = cur.fetchall()
    return [InformationElementOut(element_id=str(r[0]), field_name=r[1], aio_count=r[2], created_at=str(r[3]), updated_at=str(r[4])) for r in rows]


@app.post("/v1/information-elements", status_code=201)
def create_information_element(payload: InformationElementRequest):
    eid = uuid.uuid4()
    now = datetime.now(timezone.utc)
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO information_elements (element_id, field_name, aio_count, created_at, updated_at) VALUES (%s, %s, %s, %s, %s)",
                (str(eid), payload.field_name.strip(), payload.aio_count, now, now),
            )
        conn.commit()
    return InformationElementOut(element_id=str(eid), field_name=payload.field_name.strip(), aio_count=payload.aio_count, created_at=str(now), updated_at=str(now))


@app.put("/v1/information-elements/{element_id}")
def update_information_element(element_id: str, payload: InformationElementRequest):
    now = datetime.now(timezone.utc)
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE information_elements SET field_name = %s, aio_count = %s, updated_at = %s WHERE element_id = %s",
                (payload.field_name.strip(), payload.aio_count, now, element_id),
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Element not found")
        conn.commit()
    return InformationElementOut(element_id=element_id, field_name=payload.field_name.strip(), aio_count=payload.aio_count, created_at=str(now), updated_at=str(now))


@app.delete("/v1/information-elements/{element_id}")
def delete_information_element(element_id: str):
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM information_elements WHERE element_id = %s RETURNING element_id", (element_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Element not found")
        conn.commit()
    return {"deleted": element_id}


@app.post("/v1/information-elements/rebuild")
def rebuild_information_elements():
    """Scan all AIOs and rebuild the information_elements table from scratch."""
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(f"SELECT {_AIO_COLS} FROM aio_data")
            rows = cur.fetchall()
        all_fields: dict[str, int] = {}
        for row in rows:
            for el in row:
                if el and isinstance(el, str):
                    m = _re.match(r"\[([^.\]]+)\.", el)
                    if m:
                        fn = m.group(1)
                        all_fields[fn] = all_fields.get(fn, 0) + 1
        with conn.cursor() as cur:
            for fn, count in all_fields.items():
                cur.execute(
                    """INSERT INTO information_elements (field_name, aio_count, updated_at)
                       VALUES (%s, %s, now())
                       ON CONFLICT (field_name) DO UPDATE SET aio_count = %s, updated_at = now()""",
                    (fn, count, count),
                )
        conn.commit()
    return {"rebuilt": len(all_fields), "fields": list(all_fields.keys())}


# ── MRO Objects ────────────────────────────────────────────────────


class MroObjectOut(BaseModel):
    mro_id: uuid.UUID
    mro_key: str
    query_text: str
    intent: Optional[str] = None
    seed_hsls: Optional[str] = None
    matched_aios_count: int = 0
    search_terms: Optional[Any] = None
    result_text: str
    context_bundle: Optional[str] = None
    confidence: str = "derived"
    policy_scope: str = "tenantA"
    tenant_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class CreateMroObjectRequest(BaseModel):
    mro_key: str
    query_text: str
    intent: Optional[str] = None
    seed_hsls: Optional[str] = None
    matched_aios_count: int = 0
    search_terms: Optional[Any] = None
    result_text: str
    context_bundle: Optional[str] = None
    confidence: str = "derived"
    policy_scope: str = "tenantA"


_MRO_SELECT = "mro_id, mro_key, query_text, intent, seed_hsls, matched_aios_count, search_terms, result_text, context_bundle, confidence, policy_scope, tenant_id, created_at, updated_at"


def _mro_from_row(r):
    return MroObjectOut(
        mro_id=r[0], mro_key=r[1], query_text=r[2], intent=r[3], seed_hsls=r[4],
        matched_aios_count=r[5], search_terms=r[6], result_text=r[7], context_bundle=r[8],
        confidence=r[9], policy_scope=r[10], tenant_id=r[11], created_at=r[12], updated_at=r[13],
    )


@app.get("/v1/mro-objects", response_model=List[MroObjectOut])
def list_mro_objects(limit: int = Query(100, ge=1, le=1000)):
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT {_MRO_SELECT} FROM mro_objects ORDER BY updated_at DESC LIMIT %s",
                (limit,),
            )
            rows = cur.fetchall()
    return [_mro_from_row(r) for r in rows]


@app.post("/v1/mro-objects", response_model=MroObjectOut, status_code=201)
def create_mro_object(payload: CreateMroObjectRequest):
    if not payload.mro_key.strip():
        raise HTTPException(status_code=400, detail="mro_key is required")
    if not payload.query_text.strip():
        raise HTTPException(status_code=400, detail="query_text is required")
    if not payload.result_text.strip():
        raise HTTPException(status_code=400, detail="result_text is required")
    mro_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    search_terms_json = json.dumps(payload.search_terms) if payload.search_terms is not None else None
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO mro_objects (mro_id, mro_key, query_text, intent, seed_hsls, matched_aios_count, search_terms, result_text, context_bundle, confidence, policy_scope, tenant_id, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (str(mro_id), payload.mro_key.strip(), payload.query_text.strip(), payload.intent, payload.seed_hsls,
                 payload.matched_aios_count, search_terms_json, payload.result_text.strip(), payload.context_bundle,
                 payload.confidence, payload.policy_scope, "tenantA", now, now),
            )
        conn.commit()
    return MroObjectOut(
        mro_id=mro_id, mro_key=payload.mro_key.strip(), query_text=payload.query_text.strip(),
        intent=payload.intent, seed_hsls=payload.seed_hsls, matched_aios_count=payload.matched_aios_count,
        search_terms=payload.search_terms, result_text=payload.result_text.strip(),
        context_bundle=payload.context_bundle, confidence=payload.confidence, policy_scope=payload.policy_scope,
        tenant_id=None, created_at=now, updated_at=now,
    )


@app.delete("/v1/mro-objects/{mro_id}")
def delete_mro_object(mro_id: str):
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM mro_objects WHERE mro_id = %s RETURNING mro_id", (mro_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="MRO object not found")
        conn.commit()
    return {"deleted": mro_id}


# ── AI Field Maps ──────────────────────────────────────────────────
class FieldMapMember(BaseModel):
    member_id: uuid.UUID
    field_name: str


class FieldMapKeyOut(BaseModel):
    key_id: uuid.UUID
    fuzzy_key: str
    description: Optional[str] = None
    members: List[FieldMapMember] = []
    created_at: datetime
    updated_at: datetime


class CreateFieldMapKeyRequest(BaseModel):
    fuzzy_key: str
    description: Optional[str] = None
    field_names: List[str] = []


class UpdateFieldMapKeyRequest(BaseModel):
    fuzzy_key: Optional[str] = None
    description: Optional[str] = None
    field_names: Optional[List[str]] = None


def _load_field_map_keys(cur) -> List[FieldMapKeyOut]:
    cur.execute(
        """SELECT k.key_id, k.fuzzy_key, k.description, k.created_at, k.updated_at
           FROM field_map_keys k ORDER BY k.fuzzy_key"""
    )
    keys = {}
    order = []
    for row in cur.fetchall():
        kid = row[0]
        order.append(kid)
        keys[kid] = FieldMapKeyOut(
            key_id=kid, fuzzy_key=row[1], description=row[2],
            members=[], created_at=row[3], updated_at=row[4],
        )
    if keys:
        cur.execute(
            """SELECT member_id, key_id, field_name FROM field_map_members
               WHERE key_id = ANY(%s) ORDER BY field_name""",
            (list(keys.keys()),),
        )
        for row in cur.fetchall():
            if row[1] in keys:
                keys[row[1]].members.append(FieldMapMember(member_id=row[0], field_name=row[2]))
    return [keys[k] for k in order]


@app.get("/v1/field-maps", response_model=List[FieldMapKeyOut])
def list_field_maps():
    with db() as conn:
        with conn.cursor() as cur:
            return _load_field_map_keys(cur)


@app.post("/v1/field-maps", response_model=FieldMapKeyOut, status_code=201)
def create_field_map(payload: CreateFieldMapKeyRequest):
    if not payload.fuzzy_key.strip():
        raise HTTPException(status_code=400, detail="fuzzy_key is required")
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO field_map_keys (fuzzy_key, description)
                   VALUES (%s, %s) RETURNING key_id, created_at, updated_at""",
                (payload.fuzzy_key.strip(), payload.description),
            )
            kid, created, updated = cur.fetchone()
            members = []
            for fn in payload.field_names or []:
                fn_s = (fn or "").strip()
                if not fn_s:
                    continue
                cur.execute(
                    """INSERT INTO field_map_members (key_id, field_name) VALUES (%s, %s)
                       ON CONFLICT (key_id, field_name) DO NOTHING
                       RETURNING member_id""",
                    (kid, fn_s),
                )
                r = cur.fetchone()
                if r:
                    members.append(FieldMapMember(member_id=r[0], field_name=fn_s))
        conn.commit()
    return FieldMapKeyOut(
        key_id=kid, fuzzy_key=payload.fuzzy_key.strip(), description=payload.description,
        members=members, created_at=created, updated_at=updated,
    )


@app.put("/v1/field-maps/{key_id}", response_model=FieldMapKeyOut)
def update_field_map(key_id: str, payload: UpdateFieldMapKeyRequest):
    with db() as conn:
        with conn.cursor() as cur:
            sets = []
            vals = []
            if payload.fuzzy_key is not None:
                sets.append("fuzzy_key = %s")
                vals.append(payload.fuzzy_key.strip())
            if payload.description is not None:
                sets.append("description = %s")
                vals.append(payload.description)
            if sets:
                sets.append("updated_at = now()")
                vals.append(key_id)
                cur.execute(f"UPDATE field_map_keys SET {', '.join(sets)} WHERE key_id = %s", vals)
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="field map key not found")
            if payload.field_names is not None:
                cur.execute("DELETE FROM field_map_members WHERE key_id = %s", (key_id,))
                for fn in payload.field_names:
                    fn_s = (fn or "").strip()
                    if not fn_s:
                        continue
                    cur.execute(
                        """INSERT INTO field_map_members (key_id, field_name) VALUES (%s, %s)
                           ON CONFLICT (key_id, field_name) DO NOTHING""",
                        (key_id, fn_s),
                    )
            keys = _load_field_map_keys(cur)
        conn.commit()
    for k in keys:
        if str(k.key_id) == key_id:
            return k
    raise HTTPException(status_code=404, detail="field map key not found")


@app.delete("/v1/field-maps/{key_id}")
def delete_field_map(key_id: str):
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM field_map_keys WHERE key_id = %s RETURNING key_id", (key_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="field map key not found")
        conn.commit()
    return {"deleted": key_id}


class GenerateFieldMapsResponse(BaseModel):
    maps: List[FieldMapKeyOut]
    count: int
    model_ref: str


@app.post("/v1/op/generate-field-maps", response_model=GenerateFieldMapsResponse)
def generate_field_maps():
    api_key = get_effective_api_key()
    if not api_key:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")

    # Fetch all field names
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT field_name FROM information_elements ORDER BY field_name")
            field_names = [r[0] for r in cur.fetchall()]
    if not field_names:
        raise HTTPException(status_code=400, detail="No field names found in information_elements. Rebuild elements first.")

    import anthropic
    client = anthropic.Anthropic(api_key=api_key)

    system_prompt = (
        "You are a data normalization expert. Given a list of database field names, "
        "group them into semantically equivalent clusters. For each cluster, provide "
        "a single canonical 'fuzzy_key' that represents the group.\n\n"
        "Examples:\n"
        "- 'Invoice', 'Invoice Number', 'Invoice No', 'Invoice #' -> fuzzy_key: 'Invoice'\n"
        "- 'Employee', 'Employee Name', 'Product Manager Name' -> fuzzy_key: 'Name'\n"
        "- 'Company', 'Vendor', 'Supplier' -> fuzzy_key: 'Company Name'\n"
        "- 'Address', 'Street Address', 'Billing Address' -> fuzzy_key: 'Address'\n\n"
        "Rules:\n"
        "1. Every field name in the input MUST belong to exactly one cluster.\n"
        "2. Prefer short, natural English fuzzy keys (1-3 words).\n"
        "3. Fields that don't fit any cluster get their own single-member cluster.\n"
        "4. Do not invent field names not in the input.\n\n"
        'Return ONLY valid JSON with no other text: {"maps": [{"fuzzy_key": "...", "field_names": ["...", "..."]}]}'
    )

    try:
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=8000,
            system=system_prompt,
            messages=[{"role": "user", "content": "Field names to group:\n" + "\n".join(field_names)}],
        )
        raw = resp.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        data = json.loads(raw)
    except Exception as exc:
        logger.exception("Field map generation failed")
        raise HTTPException(status_code=502, detail=f"LLM error: {str(exc)}")

    maps = data.get("maps", [])
    if not isinstance(maps, list):
        raise HTTPException(status_code=502, detail="LLM returned invalid structure")

    # Wipe and insert new
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM field_map_members")
            cur.execute("DELETE FROM field_map_keys")
            seen_keys = set()
            for m in maps:
                fk = (m.get("fuzzy_key") or "").strip()
                if not fk or fk in seen_keys:
                    continue
                seen_keys.add(fk)
                cur.execute(
                    "INSERT INTO field_map_keys (fuzzy_key) VALUES (%s) RETURNING key_id",
                    (fk,),
                )
                kid = cur.fetchone()[0]
                for fn in m.get("field_names") or []:
                    fn_s = (fn or "").strip()
                    if not fn_s:
                        continue
                    cur.execute(
                        """INSERT INTO field_map_members (key_id, field_name) VALUES (%s, %s)
                           ON CONFLICT (key_id, field_name) DO NOTHING""",
                        (kid, fn_s),
                    )
            result = _load_field_map_keys(cur)
        conn.commit()

    return GenerateFieldMapsResponse(maps=result, count=len(result), model_ref="claude-sonnet-4-6")
