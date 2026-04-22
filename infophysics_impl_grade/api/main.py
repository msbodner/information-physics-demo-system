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

from api.db import db, set_tenant, lifespan as _lifespan  # noqa: F401  (re-exported for callers)
from api.llm import get_effective_api_key, get_anthropic_client  # noqa: F401
from api.routes.aio import router as aio_router, _AIO_COLS  # _AIO_COLS re-used by aio-search
from api.routes.hsl import router as hsl_router, _HSL_COLS
from api.routes.io import router as io_router
from api.routes.mro import router as mro_router
from api.routes.prompts import router as prompts_router
from api.routes.settings import router as settings_router
from api.routes.users import router as users_router

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

# Mount extracted route modules. Remaining routers (chat, stats) will be
# added in subsequent refactor steps.
app.include_router(settings_router)
app.include_router(users_router)
app.include_router(io_router)
app.include_router(aio_router)
app.include_router(hsl_router)
app.include_router(mro_router)
app.include_router(prompts_router)


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
# Pydantic models
# ---------------------------------------------------------------------------

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
    input_tokens: int = 0
    output_tokens: int = 0


class AioSearchResponse(BaseModel):
    reply: str
    model_ref: str
    context_records: int
    matched_hsls: int
    matched_aios: int
    matched_hsl_ids: List[str] = []   # HSL UUIDs traversed — for MRO→HSL linking
    search_terms: Dict[str, Any]
    input_tokens: int = 0
    output_tokens: int = 0


class SubstrateChatRequest(BaseModel):
    messages: List[ChatMessage]
    context_bundle: str          # serialized bundle from the client pipeline


class ChatStatRequest(BaseModel):
    search_mode: str             # 'Send' | 'AIOSearch' | 'Substrate'
    query_text: str
    result_preview: Optional[str] = None
    elapsed_ms: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    context_records: int = 0
    matched_hsls: int = 0
    matched_aios: int = 0
    cue_count: int = 0
    neighborhood_size: int = 0
    prior_count: int = 0
    mro_saved: bool = False


class ChatStatOut(BaseModel):
    stat_id: str
    tenant_id: str
    search_mode: str
    query_text: str
    result_preview: Optional[str]
    elapsed_ms: int
    input_tokens: int
    output_tokens: int
    total_tokens: int
    context_records: int
    matched_hsls: int
    matched_aios: int
    cue_count: int
    neighborhood_size: int
    prior_count: int
    mro_saved: bool
    created_at: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

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
        in_tok = getattr(response.usage, "input_tokens", 0) or 0
        out_tok = getattr(response.usage, "output_tokens", 0) or 0
    except Exception as exc:
        logger.exception("Anthropic API error during chat")
        raise HTTPException(status_code=502, detail=f"LLM error: {str(exc)}")

    return ChatResponse(
        reply=reply_text,
        model_ref="claude-sonnet-4-6",
        context_records=len(aio_lines) + len(hsl_blocks),
        input_tokens=in_tok,
        output_tokens=out_tok,
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
        parse_in_tok = getattr(parse_response.usage, "input_tokens", 0) or 0
        parse_out_tok = getattr(parse_response.usage, "output_tokens", 0) or 0
    except Exception:
        logger.warning("Failed to parse search terms, falling back to keyword split")
        search_terms = {"field_values": [], "keywords": user_prompt.split()}
        parse_in_tok = 0
        parse_out_tok = 0

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

    matched_hsl_ids = [str(row[0]) for row in matched_hsl_rows]
    logger.info("AIO Search: %d HSLs matched", len(matched_hsl_rows))

    # ── Phase 3: Gather AIOs from matched HSLs ──
    # Also detect [MRO.<uuid>] elements → fetch those MROs as prior context
    aio_refs: set = set()
    mro_ids_from_hsl: List[str] = []
    for row in matched_hsl_rows:
        for elem in row[2:]:
            if elem and isinstance(elem, str) and elem.strip():
                ref = elem.strip()
                if ref.startswith("[MRO.") and ref.endswith("]"):
                    mro_ids_from_hsl.append(ref[5:-1])
                else:
                    aio_refs.add(ref)

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

    # ── Fetch MRO priors referenced in HSL elements ──
    # When an HSL element is [MRO.<uuid>], it means a prior query result was
    # linked back into the HSL fabric. Fetch those MROs and surface their
    # findings as Tier-1 context ahead of the raw AIO evidence.
    mro_context_lines: List[str] = []
    if mro_ids_from_hsl:
        try:
            conn = db()
            with conn:
                with conn.cursor() as cur:
                    for mro_uuid in mro_ids_from_hsl[:5]:   # cap at 5 MRO priors
                        cur.execute(
                            "SELECT query_text, result_text FROM mro_objects WHERE mro_id = %s",
                            (mro_uuid,)
                        )
                        mro_row = cur.fetchone()
                        if mro_row:
                            mro_context_lines.append(
                                f"[Prior Query: {mro_row[0][:120]}]\n"
                                f"[Finding: {mro_row[1][:500]}]"
                            )
        except Exception:
            logger.warning("MRO prior fetch failed for HSL-linked MROs")
        logger.info("AIO Search: %d MRO priors from HSL links", len(mro_context_lines))

    # ── Phase 4: Answer using focused context ──
    context_section = ""
    if mro_context_lines:
        context_section += "\n\n## Prior Retrieval Episodes (MRO priors linked in HSL)\n"
        context_section += "\n\n".join(mro_context_lines)
    if matched_aio_lines:
        sample = matched_aio_lines[:300]
        context_section += f"\n\n## Matched AIO Records ({len(sample)} of {len(matched_aio_lines)} total)\n"
        context_section += "\n".join(sample)

    answer_system = (
        "You are ChatAIO, an intelligent analyst for Information Physics data. "
        "You have been given a FOCUSED subset of AIO records that match the user's query, "
        "and optionally prior retrieval episodes (MROs) previously linked into the HSL fabric. "
        "Each AIO record uses bracket notation: [Key.Value][Key2.Value2]... "
        "MRO priors summarise earlier answers — treat them as framing, not ground truth; "
        "re-ground any claims in the AIO evidence when answering. "
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
        ans_in_tok = getattr(answer_response.usage, "input_tokens", 0) or 0
        ans_out_tok = getattr(answer_response.usage, "output_tokens", 0) or 0
    except Exception as exc:
        logger.exception("Anthropic API error during AIO search answer")
        raise HTTPException(status_code=502, detail=f"LLM error: {str(exc)}")

    return AioSearchResponse(
        reply=reply_text,
        model_ref="claude-sonnet-4-6",
        context_records=len(matched_aio_lines),
        matched_hsls=len(matched_hsl_rows),
        matched_aios=len(matched_aio_lines),
        matched_hsl_ids=matched_hsl_ids,
        search_terms=search_terms,
        input_tokens=parse_in_tok + ans_in_tok,
        output_tokens=parse_out_tok + ans_out_tok,
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
# Substrate Chat — focused LLM call using client-assembled context bundle
# Does NOT fetch from the database; uses the precomputed semantic substrate
# provided by the Paper III pipeline as the sole system context.
# ---------------------------------------------------------------------------

@app.post("/v1/op/substrate-chat", response_model=ChatResponse)
def substrate_chat(
    payload: SubstrateChatRequest,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    """Call Claude with ONLY the precomputed substrate bundle as context.
    Avoids the raw DB-dump that /v1/op/chat injects, so the curated
    HSL neighborhood, MRO priors, and seed AIOs are the sole evidence."""
    api_key = get_effective_api_key()
    if not api_key:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages must not be empty")

    system = (
        "You are ChatAIO, an intelligent analyst for Information Physics data. "
        "You have been given a PRECOMPUTED SEMANTIC SUBSTRATE assembled by the "
        "Paper III pipeline: deterministic cue extraction, bounded HSL neighborhood "
        "traversal, and Jaccard-ranked MRO pre-fetch. "
        "The substrate contains three evidence tiers:\n"
        "  TIER 1 — Prior retrieval episodes (MRO priors): use as framing only\n"
        "  TIER 2 — HSL neighborhoods traversed\n"
        "  TIER 3 — Direct AIO evidence: use this to ground every claim\n\n"
        "Rules: Re-ground every claim in Tier 3 AIO evidence. "
        "Cite AIO filenames when referencing a record. "
        "If the evidence is insufficient, say so clearly.\n\n"
        + payload.context_bundle
    )

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
        in_tok = getattr(response.usage, "input_tokens", 0) or 0
        out_tok = getattr(response.usage, "output_tokens", 0) or 0
    except Exception as exc:
        logger.exception("Anthropic API error during substrate chat")
        raise HTTPException(status_code=502, detail=f"LLM error: {str(exc)}")

    return ChatResponse(
        reply=reply_text,
        model_ref="claude-sonnet-4-6",
        context_records=0,
        input_tokens=in_tok,
        output_tokens=out_tok,
    )


# ---------------------------------------------------------------------------
# Chat Search Statistics
# ---------------------------------------------------------------------------

@app.get("/v1/chat-stats", response_model=List[ChatStatOut])
def list_chat_stats(
    limit: int = Query(5000, ge=1, le=100000),
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    tenant = x_tenant_id or "tenantA"
    try:
        conn = db()
        with conn:
            set_tenant(conn, tenant)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT stat_id, tenant_id, search_mode, query_text, result_preview,
                           elapsed_ms, input_tokens, output_tokens, total_tokens,
                           context_records, matched_hsls, matched_aios,
                           cue_count, neighborhood_size, prior_count, mro_saved, created_at
                    FROM chat_search_stats
                    WHERE tenant_id = %s
                    ORDER BY created_at DESC
                    LIMIT %s
                    """,
                    (tenant, limit),
                )
                rows = cur.fetchall()
    except Exception:
        logger.warning("chat_search_stats table not ready yet — returning empty list")
        return []
    return [
        ChatStatOut(
            stat_id=str(r[0]), tenant_id=r[1], search_mode=r[2],
            query_text=r[3], result_preview=r[4],
            elapsed_ms=r[5] or 0, input_tokens=r[6] or 0,
            output_tokens=r[7] or 0, total_tokens=r[8] or 0,
            context_records=r[9] or 0, matched_hsls=r[10] or 0,
            matched_aios=r[11] or 0, cue_count=r[12] or 0,
            neighborhood_size=r[13] or 0, prior_count=r[14] or 0,
            mro_saved=bool(r[15]), created_at=str(r[16]),
        )
        for r in rows
    ]


@app.post("/v1/chat-stats", response_model=ChatStatOut, status_code=201)
def create_chat_stat(
    payload: ChatStatRequest,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    tenant = x_tenant_id or "tenantA"
    stat_id = str(uuid.uuid4())
    now = __import__("datetime").datetime.utcnow()
    try:
        conn = db()
        with conn:
            set_tenant(conn, tenant)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO chat_search_stats (
                        stat_id, tenant_id, search_mode, query_text, result_preview,
                        elapsed_ms, input_tokens, output_tokens, total_tokens,
                        context_records, matched_hsls, matched_aios,
                        cue_count, neighborhood_size, prior_count, mro_saved, created_at
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        stat_id, tenant, payload.search_mode, payload.query_text,
                        payload.result_preview, payload.elapsed_ms,
                        payload.input_tokens, payload.output_tokens, payload.total_tokens,
                        payload.context_records, payload.matched_hsls, payload.matched_aios,
                        payload.cue_count, payload.neighborhood_size, payload.prior_count,
                        payload.mro_saved, now,
                    ),
                )
    except Exception as exc:
        logger.exception("Failed to save chat stat")
        raise HTTPException(status_code=500, detail=str(exc))
    return ChatStatOut(
        stat_id=stat_id, tenant_id=tenant, search_mode=payload.search_mode,
        query_text=payload.query_text, result_preview=payload.result_preview,
        elapsed_ms=payload.elapsed_ms, input_tokens=payload.input_tokens,
        output_tokens=payload.output_tokens, total_tokens=payload.total_tokens,
        context_records=payload.context_records, matched_hsls=payload.matched_hsls,
        matched_aios=payload.matched_aios, cue_count=payload.cue_count,
        neighborhood_size=payload.neighborhood_size, prior_count=payload.prior_count,
        mro_saved=payload.mro_saved, created_at=str(now),
    )


@app.delete("/v1/chat-stats/{stat_id}")
def delete_chat_stat(stat_id: str):
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM chat_search_stats WHERE stat_id = %s RETURNING stat_id",
                (stat_id,),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Stat not found")
        conn.commit()
    return {"deleted": stat_id}
