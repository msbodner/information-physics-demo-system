"""LLM-backed chat, search, entity-extraction, and PDF-extract routes.

Endpoints:
  POST /v1/op/summarize          — summarize an AIO dataset
  POST /v1/op/resolve-entities   — extract entities from a single AIO
  POST /v1/op/chat               — broad ChatAIO (all AIOs as context)
  POST /v1/op/aio-search         — four-phase AIO search algebra
  POST /v1/op/pdf-extract        — PDF-to-CSV via Claude vision
  POST /v1/op/substrate-chat     — LLM call using client-assembled substrate
"""

from __future__ import annotations

import base64
import csv as csv_mod
import io
import json
import logging
from typing import Any, Dict, List, Optional
from urllib.parse import unquote

from fastapi import APIRouter, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from api.db import db, set_tenant
from api.llm import get_effective_api_key
from api.routes.aio import _AIO_COLS
from api.routes.hsl import _HSL_COLS

logger = logging.getLogger("infophysics.api.chat")

router = APIRouter()


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
    matched_hsl_ids: List[str] = []
    search_terms: Dict[str, Any]
    input_tokens: int = 0
    output_tokens: int = 0


class SubstrateChatRequest(BaseModel):
    messages: List[ChatMessage]
    context_bundle: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/v1/op/summarize", response_model=SummarizeResponse)
def summarize(payload: SummarizeRequest, x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id")):
    logger.info("summarize tenant=%s aio_count=%d", x_tenant_id, len(payload.aio_texts or []))

    api_key = get_effective_api_key()
    if not api_key:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")

    texts = payload.aio_texts or []
    if not texts:
        raise HTTPException(status_code=400, detail="aio_texts must not be empty")

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


@router.post("/v1/op/resolve-entities", response_model=ResolveEntitiesResponse)
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


@router.post("/v1/op/chat", response_model=ChatResponse)
def chat(payload: ChatRequest, x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id")):
    logger.info("chat tenant=%s messages=%d", x_tenant_id, len(payload.messages))

    api_key = get_effective_api_key()
    if not api_key:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages must not be empty")

    tenant = x_tenant_id or "tenantA"

    aio_lines: List[str] = []
    hsl_blocks: List[str] = []
    try:
        with db() as conn:
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
                        pass
    except Exception:
        logger.warning("Could not fetch DB context for chat — proceeding without it")

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


@router.post("/v1/op/aio-search", response_model=AioSearchResponse)
def aio_search(payload: ChatRequest, x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id")):
    """Four-phase search algebra: parse → match HSLs → gather AIOs → answer."""
    api_key = get_effective_api_key()
    if not api_key:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages must not be empty")

    tenant = x_tenant_id or "tenantA"
    user_prompt = payload.messages[-1].content

    # ── Phase 1: Parse prompt into search terms using Claude ──
    known_fields: List[str] = []
    try:
        with db() as conn:
            set_tenant(conn, tenant)
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

    # Fast path: for short, field-free queries (≤3 tokens, all alphanumeric/space),
    # the LLM parse step is pure overhead — the whole query is a single needle.
    # Skip the ~300-token parse call (a full Claude round-trip) and treat the
    # cleaned query as a single keyword. Typical savings: ~200ms + ~450 tokens
    # per query like "Sarah Mitchell" or "Destiny Owens".
    trimmed = user_prompt.strip()
    tok_count = len(trimmed.split())
    is_short_lookup = (
        tok_count > 0
        and tok_count <= 3
        and all(c.isalnum() or c.isspace() or c in "-_.'" for c in trimmed)
    )

    if is_short_lookup:
        search_terms = {"field_values": [], "keywords": [trimmed]}
        parse_in_tok = 0
        parse_out_tok = 0
        logger.info("AIO Search: skipped parse for short lookup (saved ~1 LLM call)")
    else:
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

    # Efficiency caps: we only keep 300 AIOs in the final LLM context, so
    # gathering unbounded HSLs/AIOs beyond what feeds that cap is waste.
    HSL_CAP = 500        # more than enough to produce 300 AIO refs
    HSL_EARLY_EXIT = 300 # stop pass 2/3 once we already have this many
    AIO_CAP = 400        # ~33% headroom over the 300 context cap, for dedup
    AIO_EARLY_EXIT = 350

    matched_hsl_rows = []
    if needles:
        # We search HSLs in three progressively-broader passes:
        #   1. hsl_name ILIKE  — always works, catches named HSLs like
        #      "[Employee.Sarah Mitchell].hsl" even when the generated
        #      elements_text column is absent (pre-migration 016 DBs).
        #   2. elements_text LIKE — the fast indexed path when migration
        #      016 has applied. Skipped silently on "column does not exist"
        #      or if Pass 1 already has enough rows.
        #   3. per-element ILIKE fallback — unindexed but always works;
        #      only run if passes 1 and 2 produced nothing.
        name_clause = " OR ".join(["hsl_name ILIKE %s"] * len(needles))
        name_params = [f"%{n}%" for n in needles]
        try:
            with db() as conn:
                set_tenant(conn, tenant)
                with conn.cursor() as cur:
                    cur.execute(
                        f"SELECT hsl_id, hsl_name, {_HSL_COLS} FROM hsl_data "
                        f"WHERE {name_clause} LIMIT %s",
                        name_params + [HSL_CAP],
                    )
                    matched_hsl_rows = cur.fetchall()
        except Exception:
            logger.warning("HSL name search failed", exc_info=True)
        logger.info("AIO Search: %d HSLs via hsl_name pass", len(matched_hsl_rows))

        # Pass 2: elements_text (fast path, migration 016).
        # Skipped if Pass 1 already gave us plenty of HSLs — those refs will
        # more than cover our AIO context cap.
        if len(matched_hsl_rows) < HSL_EARLY_EXIT:
            try:
                with db() as conn:
                    set_tenant(conn, tenant)
                    with conn.cursor() as cur:
                        et_clause = " OR ".join(["elements_text LIKE %s"] * len(needles))
                        et_params = [f"%{n}%" for n in needles]
                        cur.execute(
                            f"SELECT hsl_id, hsl_name, {_HSL_COLS} FROM hsl_data "
                            f"WHERE {et_clause} LIMIT %s",
                            et_params + [HSL_CAP],
                        )
                        seen = {row[0] for row in matched_hsl_rows}
                        for row in cur.fetchall():
                            if row[0] not in seen:
                                matched_hsl_rows.append(row)
                                seen.add(row[0])
            except Exception:
                logger.info("elements_text not available on hsl_data — skipping fast path")

        # Pass 3: per-element ILIKE fallback (only if still empty)
        if not matched_hsl_rows:
            try:
                with db() as conn:
                    set_tenant(conn, tenant)
                    with conn.cursor() as cur:
                        probe = needles[:5]
                        preds = []
                        params: List[str] = []
                        for n in probe:
                            preds.append(
                                "(" + " OR ".join(
                                    [f"hsl_element_{i} ILIKE %s" for i in range(1, 101)]
                                ) + ")"
                            )
                            params.extend([f"%{n}%"] * 100)
                        where = " OR ".join(preds)
                        cur.execute(
                            f"SELECT hsl_id, hsl_name, {_HSL_COLS} FROM hsl_data "
                            f"WHERE {where} LIMIT 500",
                            params,
                        )
                        matched_hsl_rows = cur.fetchall()
                logger.info("AIO Search: %d HSLs via per-element fallback", len(matched_hsl_rows))
            except Exception:
                logger.warning("HSL per-element fallback failed", exc_info=True)

    matched_hsl_ids = [str(row[0]) for row in matched_hsl_rows]
    logger.info("AIO Search: %d HSLs matched", len(matched_hsl_rows))

    # ── Phase 3: Gather AIOs from matched HSLs ──
    # Cap aio_refs early: 500 matched HSLs × ~100 elements = up to 50k refs.
    # We only ever send 300 to the LLM, so surfacing >1000 is wasted DB work.
    AIO_REFS_CAP = 1500
    aio_refs: set = set()
    mro_ids_from_hsl: List[str] = []
    for row in matched_hsl_rows:
        if len(aio_refs) >= AIO_REFS_CAP:
            break
        for elem in row[2:]:
            if elem and isinstance(elem, str) and elem.strip():
                ref = elem.strip()
                if ref.startswith("[MRO.") and ref.endswith("]"):
                    mro_ids_from_hsl.append(ref[5:-1])
                else:
                    aio_refs.add(ref)
                    if len(aio_refs) >= AIO_REFS_CAP:
                        break

    matched_aio_lines: List[str] = []
    seen_aio_names: set = set()

    def _add_aio_row(row):
        name = row[0]
        if name in seen_aio_names:
            return
        seen_aio_names.add(name)
        elements = [e for e in row[1:] if e]
        matched_aio_lines.append(f"{name}: " + "".join(elements))

    # Pass 0: AIOs referenced directly by matched HSL elements
    if aio_refs:
        try:
            with db() as conn:
                set_tenant(conn, tenant)
                with conn.cursor() as cur:
                    placeholders = ", ".join(["%s"] * len(aio_refs))
                    cur.execute(
                        f"SELECT aio_name, {_AIO_COLS} FROM aio_data WHERE aio_name IN ({placeholders})",
                        list(aio_refs),
                    )
                    for row in cur.fetchall():
                        _add_aio_row(row)
        except Exception:
            logger.warning("AIO ref lookup failed", exc_info=True)
        logger.info("AIO Search: %d AIOs via HSL refs", len(matched_aio_lines))

    # Pass 1: aio_name ILIKE — always works, catches named AIOs directly.
    # Skipped entirely if Pass 0 already produced enough AIOs.
    if needles and len(matched_aio_lines) < AIO_EARLY_EXIT:
        try:
            with db() as conn:
                set_tenant(conn, tenant)
                with conn.cursor() as cur:
                    name_clause = " OR ".join(["aio_name ILIKE %s"] * len(needles))
                    name_params = [f"%{n}%" for n in needles]
                    cur.execute(
                        f"SELECT aio_name, {_AIO_COLS} FROM aio_data "
                        f"WHERE {name_clause} LIMIT %s",
                        name_params + [AIO_CAP],
                    )
                    for row in cur.fetchall():
                        _add_aio_row(row)
        except Exception:
            logger.warning("AIO name search failed", exc_info=True)
        logger.info("AIO Search: %d AIOs after aio_name pass", len(matched_aio_lines))

    # Pass 2: elements_text (fast indexed path, migration 016).
    # Skipped if earlier passes already got us past the early-exit threshold.
    if needles and len(matched_aio_lines) < AIO_EARLY_EXIT:
        try:
            with db() as conn:
                set_tenant(conn, tenant)
                with conn.cursor() as cur:
                    probe_needles = needles[:10]
                    or_clause = " OR ".join(["elements_text LIKE %s"] * len(probe_needles))
                    et_params = [f"%{n}%" for n in probe_needles]
                    cur.execute(
                        f"SELECT aio_name, {_AIO_COLS} FROM aio_data "
                        f"WHERE {or_clause} LIMIT %s",
                        et_params + [AIO_CAP],
                    )
                    for row in cur.fetchall():
                        _add_aio_row(row)
        except Exception:
            logger.info("elements_text not available on aio_data — skipping fast path")

    # Pass 3: per-element ILIKE fallback (only if still empty)
    if not matched_aio_lines and needles:
        try:
            with db() as conn:
                set_tenant(conn, tenant)
                with conn.cursor() as cur:
                    probe = needles[:5]
                    preds = []
                    params: List[str] = []
                    for n in probe:
                        preds.append(
                            "(" + " OR ".join(
                                [f"element_{i} ILIKE %s" for i in range(1, 51)]
                            ) + ")"
                        )
                        params.extend([f"%{n}%"] * 50)
                    where = " OR ".join(preds)
                    cur.execute(
                        f"SELECT aio_name, {_AIO_COLS} FROM aio_data "
                        f"WHERE {where} LIMIT 200",
                        params,
                    )
                    for row in cur.fetchall():
                        _add_aio_row(row)
            logger.info("AIO Search: %d AIOs via per-element fallback", len(matched_aio_lines))
        except Exception:
            logger.warning("AIO per-element fallback failed", exc_info=True)

    matched_aio_lines = list(dict.fromkeys(matched_aio_lines))
    logger.info("AIO Search: %d AIOs in context", len(matched_aio_lines))

    # ── Fetch MRO priors referenced in HSL elements ──
    mro_context_lines: List[str] = []
    if mro_ids_from_hsl:
        try:
            with db() as conn:
                set_tenant(conn, tenant)
                with conn.cursor() as cur:
                    for mro_uuid in mro_ids_from_hsl[:5]:
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


@router.post("/v1/op/pdf-extract")
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
    if len(pdf_bytes) > 20 * 1024 * 1024:
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
    if csv_text.startswith("```"):
        lines = csv_text.split("\n")
        lines = [l for l in lines if not l.startswith("```")]
        csv_text = "\n".join(lines).strip()

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


@router.post("/v1/op/substrate-chat", response_model=ChatResponse)
def substrate_chat(
    payload: SubstrateChatRequest,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    """Call Claude with ONLY the precomputed substrate bundle as context.

    Avoids the raw DB-dump that /v1/op/chat injects, so the curated
    HSL neighborhood, MRO priors, and seed AIOs are the sole evidence.
    """
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
