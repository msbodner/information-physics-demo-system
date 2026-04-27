"""LLM-backed chat, search, entity-extraction, and PDF-extract routes.

Endpoints:
  POST /v1/op/summarize          — summarize an AIO dataset
  POST /v1/op/resolve-entities   — extract entities from a single AIO
  POST /v1/op/chat               — broad ChatAIO (all AIOs as context)
  POST /v1/op/aio-search         — four-phase AIO search algebra
  POST /v1/op/pdf-extract        — PDF-to-CSV via Claude vision
  POST /v1/op/substrate-chat     — LLM call using client-assembled substrate
  POST /v1/op/pure-llm           — standard Claude w/ raw saved CSVs (no AIO/HSL)
"""

from __future__ import annotations

import base64
import csv as csv_mod
import io
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional
from urllib.parse import unquote

from fastapi import APIRouter, File, Header, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from api.db import db, set_tenant
from api.llm import get_default_model, get_effective_api_key, get_parse_model
from api.routes.aio import _AIO_COLS
from api.routes.hsl import _HSL_COLS
from api.search_helpers import (
    adaptive_aio_cap,
    apply_exclusions,
    apply_filters,
    describe_filters,
    parse_exclusions,
    parse_filters,
    split_field_needles,
)
from api import embeddings
from api import query_cache as _qcache
from api import search_quality as _quality
from api import budget as _budget
from api.aliases import expand_with_tenant
from api.citations import cite_aios, summarize_citations

logger = logging.getLogger("infophysics.api.chat")

router = APIRouter()


# V4.4 P1b — Substrate-mode system prompt.
#
# Taught to consume the compact JSON envelope produced by serializeBundle
# (lib/aio-math.ts). The legacy tier-banner prose was ~25 lines; this is
# under half that. Every cut line is one fewer thing the cache has to
# revalidate on token edits and one less template the model has to
# pattern-match before answering.
#
# Wire format contract (do NOT rename fields without updating
# serializeBundle):
#
#   {
#     "cues": ["[Key.Value]", ...],
#     "traversal_cost": <int>,
#     "priors":  [{ id, score, relevance, freshness, query, finding }, ...],
#     "hsl_neighborhoods": ["[Key.Value]", ...],
#     "aios":    [{ file, raw }, ...]
#   }
_SUBSTRATE_SYSTEM_PROMPT = (
    "You are ChatAIO, an analyst for Information Physics data.\n"
    "You receive a JSON SUBSTRATE assembled by the Paper III pipeline:\n"
    "  cues: extracted [Key.Value] cues\n"
    "  priors: similar past episodes — framing only, never ground truth\n"
    "  hsl_neighborhoods: HSLs traversed\n"
    "  aios: direct evidence — each {file, raw}; ground every claim here\n"
    "Cite the `file` field when referencing a record.\n"
    "If `aios` is insufficient to answer, say so clearly.\n\n"
    "RECALL, NOT FILTER: `aios` is a candidate neighborhood; it is not "
    "pre-filtered against the question's semantics. Apply the user's filter "
    "criteria and DROP non-matching records — do not list them with a red X, "
    "❌, or other rejection annotation. Parse numeric thresholds (\"over "
    "$10M\", \"after 2020\") and exclude records that fail. Treat records "
    "missing the needed field as non-matching. Counts, totals, and "
    "percentages must reflect only surviving records. State the filter "
    "applied in one short sentence and the qualifying count.\n\n"
    "SUBSTRATE:\n"
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
    matched_hsl_ids: List[str] = []
    search_terms: Dict[str, Any]
    input_tokens: int = 0
    output_tokens: int = 0
    # ── Hit metadata (#8 query_hash micro-cache) ──
    served_from_cache: bool = False
    cache_id: Optional[str] = None
    cached_mro_id: Optional[str] = None
    # ── Provenance metadata (#9 citation post-pass) ──
    sources_used: Optional[Dict[str, Any]] = None
    # ── Server-applied retrieval-time policies (#2/#3) ──
    applied_filters: Optional[str] = None
    exclusions: List[str] = []


class SubstrateChatRequest(BaseModel):
    messages: List[ChatMessage]
    context_bundle: str


class CompareModesRequest(BaseModel):
    """Side-by-side mode comparison (#10).

    The same prompt is dispatched to ``modes`` in parallel; the response
    contains one entry per mode with reply text, latency, token counts,
    and (where applicable) retrieval/citation metadata. Useful for
    A/B-style demos and for measuring the value of each retrieval layer.
    """
    messages: List[ChatMessage]
    modes: List[str] = Field(default_factory=lambda: ["chat", "aio-search", "pure-llm"])
    bypass_cache: bool = False


class CompareModeResult(BaseModel):
    mode: str
    reply: str
    latency_ms: int
    input_tokens: int = 0
    output_tokens: int = 0
    matched_aios: int = 0
    sources_used: Optional[Dict[str, Any]] = None
    served_from_cache: bool = False
    error: Optional[str] = None


class CompareModesResponse(BaseModel):
    results: List[CompareModeResult]
    model_ref: str = "claude-sonnet-4-6"


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
            model=get_default_model(),
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
        model_ref=get_default_model(),
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
            model=get_default_model(),
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

    return ResolveEntitiesResponse(entities=entities, model_ref=get_default_model())


@router.post("/v1/op/chat", response_model=ChatResponse)
def chat(payload: ChatRequest, x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id")):
    logger.info("chat tenant=%s messages=%d", x_tenant_id, len(payload.messages))

    api_key = get_effective_api_key()
    if not api_key:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages must not be empty")

    tenant = x_tenant_id or "tenantA"
    _budget.check_budget(tenant)

    aio_lines: List[str] = []
    hsl_blocks: List[str] = []
    # Server-side context cap. Broad /v1/op/chat dumps every AIO/HSL into the
    # system prompt — that fan-out is the whole point of the endpoint, but it
    # has to stop somewhere. We pull up to AIO_CONTEXT_HARD_CAP rows and, if
    # the query saturates, append a system note nudging the caller toward
    # Recall Search for full-corpus questions.
    AIO_CONTEXT_HARD_CAP = 1000
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
                    LIMIT %s
                    """,
                    (AIO_CONTEXT_HARD_CAP + 1,),
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

    # Detect saturation against the hard cap and truncate before building
    # context. Total context rows = AIO + HSL; we apply the cap to AIO since
    # that's the dominant fan-out term.
    context_truncated = False
    original_aio_count = len(aio_lines)
    if original_aio_count > AIO_CONTEXT_HARD_CAP:
        logger.warning(
            "chat /v1/op/chat: context truncated — %d AIOs exceeded hard cap of %d for tenant=%s",
            original_aio_count, AIO_CONTEXT_HARD_CAP, tenant,
        )
        aio_lines = aio_lines[:AIO_CONTEXT_HARD_CAP]
        context_truncated = True

    context_section = ""
    if aio_lines:
        sample = aio_lines[:300]
        context_section += f"\n\n## AIO Records ({len(sample)} of {len(aio_lines)} total)\n"
        context_section += "\n".join(sample)
    if hsl_blocks:
        context_section += f"\n\n## HSL Files ({len(hsl_blocks)} total)\n"
        context_section += "\n\n---\n\n".join(hsl_blocks[:10])
    if context_truncated:
        context_section += (
            f"\n\n## NOTE\nContext truncated to first {AIO_CONTEXT_HARD_CAP} of "
            f"{original_aio_count} AIOs. Use Recall Search for full-corpus queries."
        )

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
            model=get_default_model(),
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

    _budget.record_usage(tenant, in_tok, out_tok)
    return ChatResponse(
        reply=reply_text,
        model_ref=get_default_model(),
        context_records=len(aio_lines) + len(hsl_blocks),
        input_tokens=in_tok,
        output_tokens=out_tok,
    )


@router.post("/v1/op/pure-llm", response_model=ChatResponse)
def pure_llm(payload: ChatRequest, x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id")):
    """Pure-LLM mode: standard Claude prompt with raw saved CSVs as context.

    Unlike /v1/op/chat (which dumps AIO bracket-notation records and HSL blocks),
    this endpoint sends only the original CSV files exactly as the user uploaded
    them, with no Information-Physics framing. This is the control case — what
    Claude would do with the same data and no AIO/HSL/MRO machinery.
    """
    logger.info("pure-llm tenant=%s messages=%d", x_tenant_id, len(payload.messages))

    api_key = get_effective_api_key()
    if not api_key:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages must not be empty")

    tenant = x_tenant_id or "tenantA"
    _budget.check_budget(tenant)

    csv_blocks: List[tuple[str, str]] = []  # (name, body)
    try:
        with db() as conn:
            set_tenant(conn, tenant)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT source_object_id, raw_uri
                    FROM information_objects
                    WHERE type = 'CSV'
                    ORDER BY created_at DESC
                    LIMIT 50
                    """
                )
                for row in cur.fetchall():
                    name = row[0] or "untitled.csv"
                    raw_uri = row[1] or ""
                    if raw_uri.startswith("data:text/csv,"):
                        csv_blocks.append((name, unquote(raw_uri[len("data:text/csv,"):])))
        logger.info("pure-llm: loaded %d CSV files for tenant=%s", len(csv_blocks), tenant)
    except Exception:
        logger.exception("Could not fetch saved CSVs for pure-llm — proceeding without context")

    # Build a no-frills system prompt: standard analyst persona, raw CSVs only.
    system = (
        "You are a helpful data analyst. Answer the user's question using the "
        "CSV data provided below. Show your reasoning and cite the file/row when "
        "relevant. If the data does not contain the answer, say so."
    )
    if csv_blocks:
        system += "\n\n# Source CSV Files\n"
        for name, body in csv_blocks:
            # Cap each CSV at ~30 KB to protect the context window
            trimmed = body if len(body) <= 30000 else body[:30000] + "\n…[truncated]"
            system += f"\n## {name}\n```csv\n{trimmed}\n```\n"

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model=get_default_model(),
            max_tokens=2048,
            system=system,
            messages=[{"role": m.role, "content": m.content} for m in payload.messages],
        )
        reply_text = response.content[0].text
        in_tok = getattr(response.usage, "input_tokens", 0) or 0
        out_tok = getattr(response.usage, "output_tokens", 0) or 0
    except Exception as exc:
        logger.exception("Anthropic API error during pure-llm")
        raise HTTPException(status_code=502, detail=f"LLM error: {str(exc)}")

    _budget.record_usage(tenant, in_tok, out_tok)
    return ChatResponse(
        reply=reply_text,
        model_ref=get_default_model(),
        context_records=len(csv_blocks),
        input_tokens=in_tok,
        output_tokens=out_tok,
    )


def _aio_search_prepare(payload: ChatRequest, x_tenant_id: Optional[str]) -> Dict[str, Any]:
    """Phases 1–3 of AIO Search: parse → match HSLs → gather AIOs.

    Shared by the JSON and SSE endpoints so the streaming path doesn't
    duplicate ~350 lines of retrieval logic. Returns a dict containing
    the assembled `answer_system` prompt plus all metadata that the
    response (or final SSE meta event) needs.
    """
    import time
    _t_prep_start = time.perf_counter()

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

    # Stopwords stripped from short queries before they become needles.
    # Without this, a query like "Projects involving Vance" becomes the literal
    # needle "projects involving vance" (which matches nothing) instead of the
    # token list ["projects", "vance"] (which finds Project HSLs and Vance refs).
    STOPWORDS = {
        "a", "an", "the", "of", "for", "to", "in", "on", "at", "by", "with",
        "and", "or", "but", "is", "are", "was", "were", "be", "been", "being",
        "involving", "involved", "involve", "containing", "contain", "contains",
        "having", "have", "has", "had", "about", "regarding", "related",
        "concerning", "all", "any", "show", "list", "find", "get", "give",
        "tell", "me", "us", "what", "which", "who", "whom", "whose", "where",
        "when", "why", "how", "do", "does", "did", "can", "could", "would",
        "should", "shall", "will", "may", "might", "must", "that", "this",
        "these", "those", "from", "as", "if", "into", "out", "up", "down",
    }

    def _tokenize_query(q: str) -> List[str]:
        """Split a query into significant tokens — strips stopwords & short tokens.

        Keeps the original phrase too as a longer needle, so multi-word proper
        nouns ("Sarah Mitchell") still match HSL names that contain the full
        phrase, while individual significant tokens ("vance", "projects") match
        on their own.
        """
        words = [w.strip(".,;:!?'\"()[]{}").lower() for w in q.split()]
        toks = [w for w in words if len(w) >= 3 and w not in STOPWORDS]
        return list(dict.fromkeys(toks))  # de-dupe, preserve order

    # Fast path: for short, field-free queries (≤4 tokens, all alphanumeric/space
    # plus light punctuation), the LLM parse step is pure overhead — we tokenize
    # locally and let the multi-pass HSL/AIO search handle the OR-of-needles
    # logic. Saves ~200ms + ~450 tokens per short query.
    trimmed = user_prompt.strip()
    tok_count = len(trimmed.split())
    is_short_lookup = (
        tok_count > 0
        and tok_count <= 4
        and all(c.isalnum() or c.isspace() or c in "-_.'" for c in trimmed)
    )

    if is_short_lookup:
        toks = _tokenize_query(trimmed)
        keywords: List[str] = list(toks)
        # Also keep the cleaned full phrase if it's >1 word and not pure stopwords —
        # lets HSL names like "[Employee.Sarah Mitchell].hsl" match on the full
        # value while individual tokens still cover "Vance" / "Projects" cases.
        if len(toks) > 1:
            keywords.insert(0, trimmed.lower())
        if not keywords:
            keywords = [trimmed.lower()]  # nothing significant — fall back to literal
        search_terms = {"field_values": [], "keywords": keywords}
        parse_in_tok = 0
        parse_out_tok = 0
        logger.info("AIO Search: short-lookup tokens=%s (saved 1 LLM call)", keywords)
    else:
        # V4.4 P6: parse-result cache. The Phase 1 parse step is
        # (a) the slowest non-DB hop (~150–250ms) and
        # (b) deterministic in `(parse_system, user_prompt)`.
        # We reuse the existing query_cache table by hashing under a
        # distinct mode ("aio-search-parse") and storing the JSON-encoded
        # search_terms in answer_text. Saves one full LLM round trip on
        # every repeat / paraphrase that normalizes to the same string.
        search_terms = None
        parse_in_tok = 0
        parse_out_tok = 0
        cached_parse = _qcache.lookup(tenant, "aio-search-parse", user_prompt)
        if cached_parse:
            try:
                search_terms = json.loads(cached_parse.answer_text)
                logger.info(
                    "AIO Search: parse-cache HIT cache_id=%s hits=%d (skipping LLM parse)",
                    cached_parse.cache_id, cached_parse.hit_count,
                )
            except Exception:
                logger.info("parse-cache hit had unparsable JSON; falling through")
                search_terms = None

        if search_terms is None:
            # V4.4 P7: parse model is env-configurable. Default stays
            # claude-sonnet-4-6 (zero behavior change). Operators can opt
            # into Haiku via AIO_SEARCH_PARSE_MODEL=claude-haiku-4-5 for
            # faster/cheaper parses once they've verified parse quality.
            parse_model = get_parse_model()
            try:
                # V4.4 P11: mark parse_system as ephemeral so the
                # tenant-scoped known_fields list (which can be 50 tokens
                # of vocabulary) gets the 90% cache-read discount on any
                # parse within a ~5min window. The user_prompt varies per
                # query but the system prefix is stable per tenant.
                parse_response = client.messages.create(
                    model=parse_model,
                    max_tokens=500,
                    system=[{
                        "type": "text",
                        "text": parse_system,
                        "cache_control": {"type": "ephemeral"},
                    }],
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
                # Best-effort persist into the parse cache.
                try:
                    _qcache.store(
                        tenant,
                        "aio-search-parse",
                        user_prompt,
                        json.dumps(search_terms),
                        mro_id=None,
                    )
                except Exception:
                    logger.info("parse-cache store failed", exc_info=True)
            except Exception:
                logger.warning("Failed to parse search terms, falling back to keyword split")
                search_terms = {"field_values": [], "keywords": user_prompt.split()}
                parse_in_tok = 0
                parse_out_tok = 0

    # V4.4 P2: literal [Key.Value] cue extraction. Bracket-syntax cues
    # in the raw prompt bypass LLM parse drift entirely and feed the
    # field-aware compound index directly. Merged into search_terms so
    # downstream needle/alias logic picks them up uniformly.
    bracket_pairs = re.findall(r"\[([A-Za-z0-9_ ]{1,40})\.([^\]]{1,80})\]", user_prompt)
    if bracket_pairs:
        existing_fv = search_terms.get("field_values") or []
        seen_fv = {(fv.get("field", "").lower(), (fv.get("value") or "").lower())
                   for fv in existing_fv if isinstance(fv, dict)}
        for k, v in bracket_pairs:
            kk, vv = k.strip(), v.strip()
            if not kk or not vv:
                continue
            if (kk.lower(), vv.lower()) in seen_fv:
                continue
            existing_fv.append({"field": kk, "value": vv})
            seen_fv.add((kk.lower(), vv.lower()))
        search_terms["field_values"] = existing_fv
        logger.info("AIO Search: %d [Key.Value] cues from raw prompt", len(bracket_pairs))

    logger.info("AIO Search parsed terms: %s", search_terms)

    _t_parse_end = time.perf_counter()
    # cached_parse only exists on the LLM-parse branch; use locals() so
    # the short-lookup path (which never opens the cache) reports false.
    parse_cache_hit = bool(locals().get("cached_parse"))

    # ── Phase 2: Search HSL library ──
    needles: List[str] = []
    for fv in search_terms.get("field_values", []):
        v = fv.get("value", "").strip()
        if v:
            needles.append(v.lower())
    for kw in search_terms.get("keywords", []):
        if kw and len(kw) >= 2:
            needles.append(kw.lower())

    # Safety net: regardless of which parse path ran, always add the
    # significant non-stopword tokens from the raw user prompt as needles.
    # This rescues queries like "Projects involving Vance" where the LLM
    # might return only field_values like {field:"Project", value:"Vance"}
    # and miss the implied "Project*" HSL coverage.
    for tok in _tokenize_query(trimmed):
        needles.append(tok)

    needles = list(dict.fromkeys(needles))  # de-dupe, preserve order

    # Synonym / alias expansion (#7). Pull static-dict aliases plus any
    # tenant-scoped entity_aliases rows so paraphrases ("Inc" ↔
    # "Incorporated", "10M" ↔ "10000000", "Dr." ↔ "Drive"/"Doctor")
    # become first-class needles. Field-aware where possible: each
    # field_value pair contributes its (value, field) to the expansion
    # so address-context "Dr." resolves to "Drive" not "Doctor".
    alias_inputs: List[tuple] = []
    for fv in search_terms.get("field_values", []):
        v = (fv.get("value") or "").strip()
        f = (fv.get("field") or "").strip() or None
        if v:
            alias_inputs.append((v, f))
    for kw in search_terms.get("keywords", []):
        v = (kw or "").strip()
        if v:
            alias_inputs.append((v, None))
    try:
        aliases = expand_with_tenant(alias_inputs, tenant)
    except Exception:
        logger.info("alias expansion skipped", exc_info=True)
        aliases = []
    if aliases:
        # Append, then re-dedupe so existing needles win order.
        needles.extend(aliases)
        needles = list(dict.fromkeys(needles))
        logger.info("AIO Search: %d aliases added → %d total needles",
                    len(aliases), len(needles))

    # Efficiency caps: we only keep 300 AIOs in the final LLM context, so
    # gathering unbounded HSLs/AIOs beyond what feeds that cap is waste.
    # V4.4 P9: env-tunable so production can dial without redeploys. The
    # defaults reproduce the previous hardcoded behavior exactly.
    def _intenv(name: str, default: int) -> int:
        try:
            return max(1, int(os.environ.get(name, "")))
        except (TypeError, ValueError):
            return default
    HSL_CAP        = _intenv("AIO_SEARCH_HSL_CAP", 500)
    HSL_EARLY_EXIT = _intenv("AIO_SEARCH_HSL_EARLY_EXIT", 300)
    AIO_CAP        = _intenv("AIO_SEARCH_AIO_CAP", 400)
    AIO_EARLY_EXIT = _intenv("AIO_SEARCH_AIO_EARLY_EXIT", 350)

    matched_hsl_rows = []
    if needles:
        # V4.4 P1: indexed passes lead, unindexed ILIKE falls back.
        #
        # Order:
        #   1. Field-aware compound probe on information_element_refs
        #      (field_name, value_lower) — strongest signal, single-row index lookup.
        #   2. Free-value probe on information_element_refs (equality, then trgm
        #      substring) — the proven fast path (migration 017).
        #   3. elements_text trgm GIN (migration 016) — fallback when refs are
        #      under-populated.
        #   4. hsl_name ILIKE — unindexed, but always works on pre-migration DBs;
        #      only runs when the indexed passes are still under early-exit.
        #   5. per-element ILIKE — last-ditch unindexed scan.
        name_clause = " OR ".join(["hsl_name ILIKE %s"] * len(needles))
        name_params = [f"%{n}%" for n in needles]

        # Pass 1: FIELD-AWARE probe (#1) — when the parser identified
        # explicit (field, value) pairs, hit the (field_name, value_lower)
        # compound index. A match here is stronger evidence than a free
        # value match (we know "[Project.Vance]" not just "vance"
        # appearing somewhere) so these rows lead the matched_hsl_rows
        # list and rank above the free-text equality probe below.
        field_needles, _free_pruned = split_field_needles(
            search_terms.get("field_values", []),
            [],  # only field-restricted half here; free already in `needles`
        )
        if field_needles and len(matched_hsl_rows) < HSL_EARLY_EXIT:
            try:
                with db() as conn:
                    set_tenant(conn, tenant)
                    with conn.cursor() as cur:
                        # ROW(...)::record IN ((..,..),...) is the cleanest
                        # cross-version way to do compound-key probes.
                        # ANY/array-of-row isn't supported by older psycopg.
                        placeholders = ", ".join(["(%s, %s)"] * len(field_needles))
                        flat: List[str] = []
                        for f, v in field_needles:
                            flat.extend([f, v])
                        seen = {row[0] for row in matched_hsl_rows}
                        cur.execute(
                            f"""
                            SELECT h.hsl_id, h.hsl_name, {_HSL_COLS}
                              FROM hsl_data h
                              JOIN (
                                SELECT DISTINCT hsl_id
                                  FROM information_element_refs
                                 WHERE hsl_id IS NOT NULL
                                   AND (field_name, value_lower) IN ({placeholders})
                              ) ier ON ier.hsl_id = h.hsl_id
                             LIMIT %s
                            """,
                            flat + [HSL_CAP],
                        )
                        added = 0
                        for row in cur.fetchall():
                            if row[0] not in seen:
                                matched_hsl_rows.append(row)
                                seen.add(row[0])
                                added += 1
                        logger.info(
                            "AIO Search: %d HSLs after field-aware probe (+%d new)",
                            len(matched_hsl_rows), added,
                        )
            except Exception:
                logger.info(
                    "field-aware probe failed — falling through to value-only equality",
                    exc_info=True,
                )

        # Pass 2a: information_element_refs inverted index (migration 017).
        # The element refs table maps every parsed [Key.Value] token to its
        # owning hsl_id. An equality probe on value_lower is one indexed
        # query, regardless of how many element columns exist. This is the
        # preferred fast path; elements_text trgm GIN is the fallback.
        if len(matched_hsl_rows) < HSL_EARLY_EXIT:
            try:
                with db() as conn:
                    set_tenant(conn, tenant)
                    with conn.cursor() as cur:
                        seen = {row[0] for row in matched_hsl_rows}
                        # Equality probe first (cheapest). The ::text[]
                        # cast keeps psycopg adaptation explicit for any
                        # connector version (psycopg2 vs psycopg3).
                        cur.execute(
                            f"""
                            SELECT h.hsl_id, h.hsl_name, {_HSL_COLS}
                              FROM hsl_data h
                              JOIN (
                                SELECT DISTINCT hsl_id
                                  FROM information_element_refs
                                 WHERE hsl_id IS NOT NULL
                                   AND value_lower = ANY(%s::text[])
                              ) ier ON ier.hsl_id = h.hsl_id
                             LIMIT %s
                            """,
                            (needles, HSL_CAP),
                        )
                        for row in cur.fetchall():
                            if row[0] not in seen:
                                matched_hsl_rows.append(row)
                                seen.add(row[0])
                        logger.info(
                            "AIO Search: %d HSLs after element_refs equality probe",
                            len(matched_hsl_rows),
                        )

                        # Substring probe: only run if equality didn't fill
                        # the bucket. ILIKE ANY(ARRAY[...]) gives the trgm
                        # GIN planner a single predicate to match against
                        # the gin_trgm_ops index, instead of an N-way OR
                        # tree that the planner often won't push down.
                        if len(matched_hsl_rows) < HSL_EARLY_EXIT:
                            ilike_params = [f"%{n}%" for n in needles]
                            cur.execute(
                                f"""
                                SELECT h.hsl_id, h.hsl_name, {_HSL_COLS}
                                  FROM hsl_data h
                                  JOIN (
                                    SELECT DISTINCT hsl_id
                                      FROM information_element_refs
                                     WHERE hsl_id IS NOT NULL
                                       AND value_lower ILIKE ANY(%s::text[])
                                  ) ier ON ier.hsl_id = h.hsl_id
                                 LIMIT %s
                                """,
                                (ilike_params, HSL_CAP),
                            )
                            for row in cur.fetchall():
                                if row[0] not in seen:
                                    matched_hsl_rows.append(row)
                                    seen.add(row[0])
                            logger.info(
                                "AIO Search: %d HSLs after element_refs substring probe",
                                len(matched_hsl_rows),
                            )
            except Exception:
                logger.info(
                    "information_element_refs not available — skipping inverted index",
                    exc_info=True,
                )

        # Pass 3: elements_text (legacy fast path, migration 016).
        # Only used if the inverted index was unavailable or under-populated.
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

        # Pass 4: hsl_name ILIKE — unindexed but always works (handles
        # pre-migration-016/017 databases and named-HSL patterns like
        # "[Employee.Sarah Mitchell].hsl"). Demoted from leading position
        # so the indexed passes lead in the common case.
        if len(matched_hsl_rows) < HSL_EARLY_EXIT:
            try:
                with db() as conn:
                    set_tenant(conn, tenant)
                    with conn.cursor() as cur:
                        cur.execute(
                            f"SELECT hsl_id, hsl_name, {_HSL_COLS} FROM hsl_data "
                            f"WHERE {name_clause} LIMIT %s",
                            name_params + [HSL_CAP],
                        )
                        seen = {row[0] for row in matched_hsl_rows}
                        for row in cur.fetchall():
                            if row[0] not in seen:
                                matched_hsl_rows.append(row)
                                seen.add(row[0])
            except Exception:
                logger.warning("HSL name search failed", exc_info=True)
            logger.info("AIO Search: %d HSLs after hsl_name fallback", len(matched_hsl_rows))

        # Pass 5: per-element ILIKE fallback (only if still empty)
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
    # V4.4 P12: also cap mro_ids extraction so a pathologically dense HSL
    # corpus (lots of [MRO.…] tokens) can't blow the iteration budget.
    AIO_REFS_CAP = 1500
    MRO_IDS_CAP  = 50  # the downstream batch fetch only honors the first 5 anyway
    aio_refs: set = set()
    mro_ids_from_hsl: List[str] = []
    for row in matched_hsl_rows:
        if len(aio_refs) >= AIO_REFS_CAP and len(mro_ids_from_hsl) >= MRO_IDS_CAP:
            break
        for elem in row[2:]:
            if elem and isinstance(elem, str) and elem.strip():
                ref = elem.strip()
                if ref.startswith("[MRO.") and ref.endswith("]"):
                    if len(mro_ids_from_hsl) < MRO_IDS_CAP:
                        mro_ids_from_hsl.append(ref[5:-1])
                else:
                    if len(aio_refs) < AIO_REFS_CAP:
                        aio_refs.add(ref)
                if len(aio_refs) >= AIO_REFS_CAP and len(mro_ids_from_hsl) >= MRO_IDS_CAP:
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

    # V4.4 P1: elements_text (indexed) leads, aio_name ILIKE (unindexed) falls back.
    # V4.4 P3: probe cap lifted from 10 → 30 needles.
    # V4.4 P8: AIO field-aware compound probe via information_element_refs
    # (mirrors HSL Pass 1) leads when explicit (field, value) cues exist —
    # strongest precision signal on the AIO side.

    # Pass 1a: AIO field-aware probe — when the parser identified explicit
    # (field, value) pairs, hit the (field_name, value_lower) compound
    # index keyed by aio_id (migration 017 also indexed aio_id; we just
    # weren't using it on the AIO gather side until now).
    if (
        needles
        and len(matched_aio_lines) < AIO_EARLY_EXIT
    ):
        # Reuse the same field-aware needles HSL Pass 1 computed; if the
        # variable doesn't exist (e.g. no `needles` branch above ran),
        # recompute from search_terms.
        try:
            _aio_field_needles = field_needles  # type: ignore[name-defined]
        except NameError:
            _aio_field_needles, _ = split_field_needles(
                search_terms.get("field_values", []), [],
            )
        if _aio_field_needles:
            try:
                with db() as conn:
                    set_tenant(conn, tenant)
                    with conn.cursor() as cur:
                        placeholders = ", ".join(["(%s, %s)"] * len(_aio_field_needles))
                        flat: List[str] = []
                        for f, v in _aio_field_needles:
                            flat.extend([f, v])
                        cur.execute(
                            f"""
                            SELECT a.aio_name, {_AIO_COLS}
                              FROM aio_data a
                              JOIN (
                                SELECT DISTINCT aio_id
                                  FROM information_element_refs
                                 WHERE aio_id IS NOT NULL
                                   AND (field_name, value_lower) IN ({placeholders})
                              ) ier ON ier.aio_id = a.aio_id
                             LIMIT %s
                            """,
                            flat + [AIO_CAP],
                        )
                        for row in cur.fetchall():
                            _add_aio_row(row)
                logger.info(
                    "AIO Search: %d AIOs after field-aware probe",
                    len(matched_aio_lines),
                )
            except Exception:
                logger.info(
                    "AIO field-aware probe failed — falling through to elements_text",
                    exc_info=True,
                )

    # Pass 1b: elements_text (fast indexed path, migration 016).
    # Skipped if earlier passes already got us past the early-exit threshold.
    if needles and len(matched_aio_lines) < AIO_EARLY_EXIT:
        try:
            with db() as conn:
                set_tenant(conn, tenant)
                with conn.cursor() as cur:
                    probe_needles = needles[:30]
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
        logger.info("AIO Search: %d AIOs after elements_text pass", len(matched_aio_lines))

    # Pass 2: aio_name ILIKE — unindexed but always works. Demoted from
    # leading position so the indexed elements_text path runs first.
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
        logger.info("AIO Search: %d AIOs after aio_name fallback", len(matched_aio_lines))

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
    logger.info("AIO Search: %d AIOs in context (raw)", len(matched_aio_lines))

    # ── Negative-cue parsing (#3) ──
    # Drop AIOs whose serialized text contains an excluded phrase. Done
    # BEFORE numeric filtering so the filter only sees relevant records.
    exclusions = parse_exclusions(user_prompt)
    if exclusions:
        before = len(matched_aio_lines)
        matched_aio_lines = apply_exclusions(matched_aio_lines, exclusions)
        logger.info(
            "AIO Search: exclusions %s dropped %d records",
            exclusions, before - len(matched_aio_lines),
        )

    # ── Numeric / date predicate pushdown (#2) ──
    # Apply parsed comparators (e.g. "over $10M", "after 2020") in Python
    # before the LLM sees the bundle. The system prompt still tells the
    # model to verify the filter — but pushing it into retrieval shrinks
    # the candidate set and prevents the LLM from being misled by records
    # that lexically match a cue but numerically fail the question.
    numeric_filters = parse_filters(user_prompt)
    filter_summary = describe_filters(numeric_filters) if numeric_filters else ""
    if numeric_filters:
        before = len(matched_aio_lines)
        matched_aio_lines = apply_filters(matched_aio_lines, numeric_filters)
        logger.info(
            "AIO Search: filters %s dropped %d records",
            filter_summary, before - len(matched_aio_lines),
        )

    # ── Embedding-rerank sidecar (#6) ──
    # When an embedding provider is configured (VOYAGE_API_KEY) and
    # vectors are present in aio_embeddings, blend cosine similarity
    # against the lexical ordering. Pure tie-breaker / smoother — a
    # missing provider or empty embedding table is silently a no-op.
    if embeddings.is_enabled() and matched_aio_lines:
        try:
            qres = embeddings.embed_query(user_prompt)
            if qres and qres.vectors:
                qvec = qres.vectors[0]
                # Look up vectors for the AIOs we already gathered. We
                # match on aio_name (the prefix before ": ") because that
                # is what the SELECT used; each line is "name: …".
                names = []
                for line in matched_aio_lines:
                    head = line.split(":", 1)[0].strip()
                    if head:
                        names.append(head)
                if names:
                    with db() as conn:
                        set_tenant(conn, tenant)
                        with conn.cursor() as cur:
                            cur.execute(
                                """
                                SELECT a.aio_name, e.vector
                                  FROM aio_embeddings e
                                  JOIN aio_data a ON a.aio_id = e.aio_id
                                 WHERE a.aio_name = ANY(%s::text[])
                                   AND e.model_ref = %s
                                """,
                                (names, qres.model_ref),
                            )
                            vec_by_name = {r[0]: r[1] for r in cur.fetchall()}
                    if vec_by_name:
                        # Lexical position → score that decays linearly so
                        # the top of the list has the most weight.
                        n = len(matched_aio_lines)
                        scored = []
                        for i, line in enumerate(matched_aio_lines):
                            head = line.split(":", 1)[0].strip()
                            lex = (n - i) / n  # 1.0 at top, descending
                            v = vec_by_name.get(head)
                            cos = embeddings.cosine(qvec, v) if v else 0.0
                            blended = 0.65 * lex + 0.35 * cos
                            scored.append((blended, i, line))
                        # Stable: ties preserve original order via index.
                        scored.sort(key=lambda t: (-t[0], t[1]))
                        matched_aio_lines = [t[2] for t in scored]
                        logger.info(
                            "AIO Search: embedding rerank applied (%d/%d had vectors)",
                            len(vec_by_name), n,
                        )
        except Exception:
            logger.info("embedding rerank skipped", exc_info=True)

    logger.info("AIO Search: %d AIOs in context (post-filter)", len(matched_aio_lines))

    # ── Fetch MRO priors referenced in HSL elements ──
    # V4.4 P4: single batched query (was N round-trips in a Python loop).
    mro_context_lines: List[str] = []
    if mro_ids_from_hsl:
        # De-dupe while preserving order, then cap.
        wanted = list(dict.fromkeys(mro_ids_from_hsl))[:5]
        try:
            with db() as conn:
                set_tenant(conn, tenant)
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT mro_id, query_text, result_text "
                        "FROM mro_objects WHERE mro_id::text = ANY(%s::text[])",
                        (wanted,),
                    )
                    rows_by_id = {str(r[0]): (r[1], r[2]) for r in cur.fetchall()}
                    # Preserve the original (HSL-element) ordering.
                    for mro_uuid in wanted:
                        row = rows_by_id.get(mro_uuid)
                        if row:
                            mro_context_lines.append(
                                f"[Prior Query: {row[0][:120]}]\n"
                                f"[Finding: {row[1][:500]}]"
                            )
        except Exception:
            logger.warning("MRO prior fetch failed for HSL-linked MROs", exc_info=True)
        logger.info("AIO Search: %d MRO priors from HSL links", len(mro_context_lines))

    # ── Phase 4: Answer using focused context ──
    context_section = ""
    if mro_context_lines:
        context_section += "\n\n## Prior Retrieval Episodes (MRO priors linked in HSL)\n"
        context_section += "\n\n".join(mro_context_lines)
    if matched_aio_lines:
        # Adaptive bundle sizing (#5): cap = clamp(50 + 50*len(needles), 100, 300).
        # Single-cue queries get a tight window so the model doesn't drown
        # in noise; multi-cue queries get more breadth because each extra
        # cue narrows the candidate set.
        cap = adaptive_aio_cap(len(needles), total_matches=len(matched_aio_lines))
        sample = matched_aio_lines[:cap]
        context_section += f"\n\n## Matched AIO Records ({len(sample)} of {len(matched_aio_lines)} total)\n"
        context_section += "\n".join(sample)

    answer_system = (
        "You are ChatAIO, an intelligent analyst for Information Physics data. "
        "You have been given a FOCUSED subset of AIO records that lexically match the "
        "user's query terms, plus optionally prior retrieval episodes (MROs) linked into "
        "the HSL fabric. Each AIO record uses bracket notation: [Key.Value][Key2.Value2]... "
        "MRO priors summarise earlier answers — treat them as framing, not ground truth; "
        "re-ground any claims in the AIO evidence when answering.\n\n"
        "CRITICAL — RETRIEVAL IS RECALL, NOT FILTER:\n"
        "The provided records are a *candidate set* surfaced by keyword/HSL matching. "
        "They are NOT pre-filtered against the semantic intent of the question. "
        "Before answering, you MUST apply the user's filter criteria yourself and "
        "EXCLUDE records that do not satisfy them. In particular:\n"
        "  • Numeric comparators (\"over $10M\", \"after 2020\", \"between X and Y\", "
        "\"at least 5\"): parse the threshold from the user's question, parse the "
        "corresponding value from each candidate record, and DROP records that fail "
        "the comparison. Do not list them. Do not mark them with a red X, ❌, "
        "\"(does not match)\", or any other rejection annotation — just omit them.\n"
        "  • Categorical filters (\"completed projects\", \"vendors in Texas\"): "
        "drop records whose category field doesn't match.\n"
        "  • If a candidate record is missing the field needed to evaluate the "
        "filter, treat it as non-matching and omit it (do not assume it qualifies).\n"
        "Your final list, count, total, and percentage must reflect ONLY the records "
        "that survive the filter. State the filter you applied in one short sentence "
        "(e.g., \"Filter: budget > $10,000,000\") and the count of records that "
        "qualified. If zero records qualify, say so plainly.\n\n"
        "When computing totals or breakdowns, show your work step by step. "
        "Be concise and precise. If the data is insufficient, say so."
    )
    if filter_summary:
        # Echo the filter back to the model so its "Filter: …" reporting
        # line in the answer aligns with what we already pushed down.
        answer_system += (
            f"\n\nServer applied a numeric filter to retrieval: {filter_summary}. "
            "The records below already satisfy this filter — still echo "
            "\"Filter: …\" in your answer so the user sees what was applied."
        )
    if exclusions:
        answer_system += (
            "\n\nServer applied exclusion phrases to retrieval: "
            + ", ".join(exclusions)
            + ". Records mentioning these phrases were dropped."
        )
    if context_section:
        answer_system += "\n\n# Data Context" + context_section
    else:
        answer_system += "\n\nNo matching AIO records were found for this query."

    # ``shipped_records`` is what actually went into the LLM context
    # window — the citation post-pass scores its tokens against the
    # answer text. We deliberately ship the post-cap slice (``sample``)
    # rather than the full matched list, so "sources used: N of M"
    # reports against what Claude could plausibly cite.
    shipped_records = (
        matched_aio_lines[: adaptive_aio_cap(len(needles), total_matches=len(matched_aio_lines))]
        if matched_aio_lines else []
    )

    _t_prep_end = time.perf_counter()
    parse_ms     = int((_t_parse_end - _t_prep_start) * 1000)
    retrieval_ms = int((_t_prep_end - _t_parse_end) * 1000)

    return {
        "api_key": api_key,
        "answer_system": answer_system,
        "search_terms": search_terms,
        "matched_hsl_ids": matched_hsl_ids,
        "matched_hsl_count": len(matched_hsl_rows),
        "matched_aio_count": len(matched_aio_lines),
        "parse_in_tok": parse_in_tok,
        "parse_out_tok": parse_out_tok,
        "applied_filters": filter_summary,
        "exclusions": exclusions,
        "shipped_records": shipped_records,
        "user_prompt": user_prompt,
        "tenant": tenant,
        # V4.4 P13: timings + cache flags for the quality logger.
        "parse_ms": parse_ms,
        "retrieval_ms": retrieval_ms,
        "parse_cache_hit": parse_cache_hit,
        "num_cues": len(needles),
    }


@router.post("/v1/op/aio-search", response_model=AioSearchResponse)
def aio_search(
    payload: ChatRequest,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
    bypass_cache: bool = False,
):
    """Four-phase search algebra: parse → match HSLs → gather AIOs → answer.

    Adds two cross-cutting layers on top of the prepare/answer split:
      * **Query micro-cache** (#8) — exact (mode, normalized_query, tenant)
        hits short-circuit the entire pipeline. Skipped when
        ``?bypass_cache=true`` so demo flows can force a re-run.
      * **Citation post-pass** (#9) — after the LLM answers, scan the
        shipped AIO records for distinctive tokens that appear in the
        reply and report ``sources_used: N of M``.
    """
    import time
    _t0 = time.perf_counter()
    tenant = x_tenant_id or "tenantA"
    _budget.check_budget(tenant)
    user_prompt = payload.messages[-1].content if payload.messages else ""

    # ── Cache short-circuit (#8) ──
    if not bypass_cache and user_prompt:
        hit = _qcache.lookup(tenant, "aio-search", user_prompt)
        if hit:
            logger.info(
                "aio-search cache HIT cache_id=%s mro=%s hits=%d (skipping LLM)",
                hit.cache_id, hit.mro_id, hit.hit_count,
            )
            _quality.log(
                tenant=tenant, mode="aio-search",
                query_text=user_prompt,
                num_cues=0, hsls_matched=0, aios_matched=0, aios_shipped=0,
                parse_ms=0, retrieval_ms=0, llm_ms=0,
                total_ms=int((time.perf_counter() - _t0) * 1000),
                served_from_cache=True,
            )
            return AioSearchResponse(
                reply=hit.answer_text,
                model_ref=get_default_model(),
                context_records=0,
                matched_hsls=0,
                matched_aios=0,
                matched_hsl_ids=[],
                search_terms={"field_values": [], "keywords": []},
                input_tokens=0,
                output_tokens=0,
                served_from_cache=True,
                cache_id=hit.cache_id,
                cached_mro_id=hit.mro_id,
            )

    prep = _aio_search_prepare(payload, x_tenant_id)

    # Prompt caching: marking the assembled system prompt as ephemeral
    # gives a 90% input-token discount on cache hits within ~5 min.
    _t_llm_start = time.perf_counter()
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=prep["api_key"])
        answer_response = client.messages.create(
            model=get_default_model(),
            max_tokens=2048,
            system=[{
                "type": "text",
                "text": prep["answer_system"],
                "cache_control": {"type": "ephemeral"},
            }],
            messages=[{"role": m.role, "content": m.content} for m in payload.messages],
        )
        reply_text = answer_response.content[0].text
        ans_in_tok = getattr(answer_response.usage, "input_tokens", 0) or 0
        ans_out_tok = getattr(answer_response.usage, "output_tokens", 0) or 0
        cache_read = getattr(answer_response.usage, "cache_read_input_tokens", 0) or 0
        cache_create = getattr(answer_response.usage, "cache_creation_input_tokens", 0) or 0
        if cache_read or cache_create:
            logger.info("aio-search prompt-cache: read=%d create=%d", cache_read, cache_create)
    except Exception as exc:
        logger.exception("Anthropic API error during AIO search answer")
        raise HTTPException(status_code=502, detail=f"LLM error: {str(exc)}")

    # ── Citation post-pass (#9) ──
    shipped: List[str] = prep.get("shipped_records") or []
    citation_summary = None
    try:
        stats = cite_aios(reply_text, shipped)
        citation_summary = summarize_citations(stats, total_shipped=len(shipped))
        logger.info(
            "aio-search citations: %d of %d records cited",
            citation_summary["cited"], citation_summary["shipped"],
        )
    except Exception:
        logger.info("citation post-pass failed", exc_info=True)

    # ── Persist into the query micro-cache (#8) ──
    # Best-effort: a missing migration / RLS quirk doesn't fail the
    # response. The mro_id is unknown at this point (the frontend
    # handles MRO persistence in its substrate path) so we store the
    # answer text only.
    if not bypass_cache:
        _qcache.store(tenant, "aio-search", user_prompt, reply_text, mro_id=None)

    _budget.record_usage(
        tenant,
        prep["parse_in_tok"] + ans_in_tok,
        prep["parse_out_tok"] + ans_out_tok,
    )

    # ── V4.4 P13: per-query quality + timing log ──
    _quality.log(
        tenant=tenant, mode="aio-search",
        query_text=user_prompt,
        num_cues=prep.get("num_cues", 0),
        hsls_matched=prep["matched_hsl_count"],
        aios_matched=prep["matched_aio_count"],
        aios_shipped=len(shipped),
        sources_cited=(citation_summary or {}).get("cited") if citation_summary else None,
        parse_ms=prep.get("parse_ms", 0),
        retrieval_ms=prep.get("retrieval_ms", 0),
        llm_ms=int((time.perf_counter() - _t_llm_start) * 1000),
        total_ms=int((time.perf_counter() - _t0) * 1000),
        served_from_cache=False,
        parse_cache_hit=prep.get("parse_cache_hit", False),
        input_tokens=prep["parse_in_tok"] + ans_in_tok,
        output_tokens=prep["parse_out_tok"] + ans_out_tok,
    )

    return AioSearchResponse(
        reply=reply_text,
        model_ref=get_default_model(),
        context_records=prep["matched_aio_count"],
        matched_hsls=prep["matched_hsl_count"],
        matched_aios=prep["matched_aio_count"],
        matched_hsl_ids=prep["matched_hsl_ids"],
        search_terms=prep["search_terms"],
        input_tokens=prep["parse_in_tok"] + ans_in_tok,
        output_tokens=prep["parse_out_tok"] + ans_out_tok,
        served_from_cache=False,
        sources_used=citation_summary,
        applied_filters=prep.get("applied_filters") or None,
        exclusions=prep.get("exclusions") or [],
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
            model=get_default_model(),
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

    tenant = x_tenant_id or "tenantA"
    _budget.check_budget(tenant)

    system = _SUBSTRATE_SYSTEM_PROMPT + payload.context_bundle

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model=get_default_model(),
            max_tokens=2048,
            system=[{
                "type": "text",
                "text": system,
                "cache_control": {"type": "ephemeral"},
            }],
            messages=[{"role": m.role, "content": m.content} for m in payload.messages],
        )
        reply_text = response.content[0].text
        in_tok = getattr(response.usage, "input_tokens", 0) or 0
        out_tok = getattr(response.usage, "output_tokens", 0) or 0
        cache_read = getattr(response.usage, "cache_read_input_tokens", 0) or 0
        cache_create = getattr(response.usage, "cache_creation_input_tokens", 0) or 0
        if cache_read or cache_create:
            logger.info("substrate-chat cache: read=%d create=%d", cache_read, cache_create)
    except Exception as exc:
        logger.exception("Anthropic API error during substrate chat")
        raise HTTPException(status_code=502, detail=f"LLM error: {str(exc)}")

    _budget.record_usage(tenant, in_tok, out_tok)
    return ChatResponse(
        reply=reply_text,
        model_ref=get_default_model(),
        context_records=0,
        input_tokens=in_tok,
        output_tokens=out_tok,
    )


# ---------------------------------------------------------------------------
# Streaming variants — Server-Sent Events
# ---------------------------------------------------------------------------
# Wire format (one event per line, each terminated by `\n\n`):
#   event: text\n  data: <json string of chunk>\n\n
#   event: meta\n  data: <json with usage/metadata>\n\n
#   event: error\n data: <json {"error": "..."}>\n\n
#
# The two consumers (aio-search/stream, substrate-chat/stream) emit text
# events while the model streams, then a single meta event when usage is
# finalized. AIO Search's meta event also carries matched_hsl_ids /
# search_terms / record counts so the dialog can populate the same UI it
# does for the non-streaming response.

def _sse(event: str, data: dict | str) -> bytes:
    # json.dumps handles both strings and dicts uniformly: a str input
    # becomes a quoted JSON string with embedded newlines escaped as \n,
    # which is exactly the SSE-safe form we need so a single chunk
    # never gets split across multiple `data:` lines.
    payload = json.dumps(data)
    return f"event: {event}\ndata: {payload}\n\n".encode("utf-8")


@router.post("/v1/op/substrate-chat/stream")
def substrate_chat_stream(
    payload: SubstrateChatRequest,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    """Streaming variant of substrate-chat. Same prompt, SSE wire format."""
    api_key = get_effective_api_key()
    if not api_key:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages must not be empty")

    system = _SUBSTRATE_SYSTEM_PROMPT + payload.context_bundle

    def gen():
        try:
            import anthropic
            client = anthropic.Anthropic(api_key=api_key)
            with client.messages.stream(
                model=get_default_model(),
                max_tokens=2048,
                system=[{
                    "type": "text",
                    "text": system,
                    "cache_control": {"type": "ephemeral"},
                }],
                messages=[{"role": m.role, "content": m.content} for m in payload.messages],
            ) as stream:
                for text in stream.text_stream:
                    if text:
                        yield _sse("text", text)
                final = stream.get_final_message()
                in_tok = getattr(final.usage, "input_tokens", 0) or 0
                out_tok = getattr(final.usage, "output_tokens", 0) or 0
                cache_read = getattr(final.usage, "cache_read_input_tokens", 0) or 0
                cache_create = getattr(final.usage, "cache_creation_input_tokens", 0) or 0
                if cache_read or cache_create:
                    logger.info("substrate-chat-stream cache: read=%d create=%d", cache_read, cache_create)
                yield _sse("meta", {
                    "model_ref": get_default_model(),
                    "context_records": 0,
                    "input_tokens": in_tok,
                    "output_tokens": out_tok,
                })
        except Exception as exc:
            logger.exception("Anthropic streaming error during substrate-chat")
            yield _sse("error", {"error": f"LLM error: {str(exc)}"})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


@router.post("/v1/op/aio-search/stream")
def aio_search_stream(
    payload: ChatRequest,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
    bypass_cache: bool = False,
):
    """Streaming variant of AIO Search. Phases 1–3 run synchronously
    (they're DB-bound, no user-visible delay benefit from streaming).
    Phase 4 (synthesis) is streamed token-by-token as SSE `text` events;
    the final `meta` event carries token counts and search metadata.
    """
    # V4.4 P5: cache short-circuit. Mirrors the JSON endpoint's cache
    # behavior so re-asking the same question over the streaming wire
    # serves the cached reply as a single text frame + meta event with
    # served_from_cache=true. Phases 1–3 are skipped entirely on hit.
    import time
    _t0 = time.perf_counter()
    tenant = x_tenant_id or "tenantA"
    user_prompt = payload.messages[-1].content if payload.messages else ""
    if not bypass_cache and user_prompt:
        hit = _qcache.lookup(tenant, "aio-search", user_prompt)
        if hit:
            logger.info(
                "aio-search-stream cache HIT cache_id=%s mro=%s hits=%d (skipping LLM)",
                hit.cache_id, hit.mro_id, hit.hit_count,
            )
            _quality.log(
                tenant=tenant, mode="aio-search-stream",
                query_text=user_prompt,
                num_cues=0, hsls_matched=0, aios_matched=0, aios_shipped=0,
                parse_ms=0, retrieval_ms=0, llm_ms=0,
                total_ms=int((time.perf_counter() - _t0) * 1000),
                served_from_cache=True,
            )
            cached_text = hit.answer_text
            cached_meta = {
                "model_ref": get_default_model(),
                "context_records": 0,
                "matched_hsls": 0,
                "matched_aios": 0,
                "matched_hsl_ids": [],
                "search_terms": {"field_values": [], "keywords": []},
                "input_tokens": 0,
                "output_tokens": 0,
                "served_from_cache": True,
                "cache_id": hit.cache_id,
                "cached_mro_id": hit.mro_id,
            }

            def gen_cached():
                yield _sse("text", cached_text)
                yield _sse("meta", cached_meta)

            return StreamingResponse(gen_cached(), media_type="text/event-stream", headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            })

    # Phases 1–3: prep is fully synchronous. Doing it before we open the
    # SSE stream lets us 502 cleanly on prep failure instead of having to
    # surface errors mid-stream.
    prep = _aio_search_prepare(payload, x_tenant_id)
    _t_llm_start = time.perf_counter()

    def gen():
        try:
            import anthropic
            client = anthropic.Anthropic(api_key=prep["api_key"])
            collected: List[str] = []
            with client.messages.stream(
                model=get_default_model(),
                max_tokens=2048,
                system=[{
                    "type": "text",
                    "text": prep["answer_system"],
                    "cache_control": {"type": "ephemeral"},
                }],
                messages=[{"role": m.role, "content": m.content} for m in payload.messages],
            ) as stream:
                for text in stream.text_stream:
                    if text:
                        collected.append(text)
                        yield _sse("text", text)
                final = stream.get_final_message()
                ans_in_tok = getattr(final.usage, "input_tokens", 0) or 0
                ans_out_tok = getattr(final.usage, "output_tokens", 0) or 0
                cache_read = getattr(final.usage, "cache_read_input_tokens", 0) or 0
                cache_create = getattr(final.usage, "cache_creation_input_tokens", 0) or 0
                if cache_read or cache_create:
                    logger.info("aio-search-stream cache: read=%d create=%d", cache_read, cache_create)
                yield _sse("meta", {
                    "model_ref": get_default_model(),
                    "context_records": prep["matched_aio_count"],
                    "matched_hsls": prep["matched_hsl_count"],
                    "matched_aios": prep["matched_aio_count"],
                    "matched_hsl_ids": prep["matched_hsl_ids"],
                    "search_terms": prep["search_terms"],
                    "input_tokens": prep["parse_in_tok"] + ans_in_tok,
                    "output_tokens": prep["parse_out_tok"] + ans_out_tok,
                    "served_from_cache": False,
                })
                # V4.4 P5: persist the streamed reply so subsequent
                # identical queries hit the micro-cache short-circuit.
                if not bypass_cache and user_prompt and collected:
                    try:
                        _qcache.store(tenant, "aio-search", user_prompt, "".join(collected), mro_id=None)
                    except Exception:
                        logger.info("aio-search-stream cache store failed", exc_info=True)
                # V4.4 P13: per-query quality + timing log. Citations
                # aren't computed on the streaming path so sources_cited
                # stays None.
                _quality.log(
                    tenant=tenant, mode="aio-search-stream",
                    query_text=user_prompt,
                    num_cues=prep.get("num_cues", 0),
                    hsls_matched=prep["matched_hsl_count"],
                    aios_matched=prep["matched_aio_count"],
                    aios_shipped=len(prep.get("shipped_records") or []),
                    sources_cited=None,
                    parse_ms=prep.get("parse_ms", 0),
                    retrieval_ms=prep.get("retrieval_ms", 0),
                    llm_ms=int((time.perf_counter() - _t_llm_start) * 1000),
                    total_ms=int((time.perf_counter() - _t0) * 1000),
                    served_from_cache=False,
                    parse_cache_hit=prep.get("parse_cache_hit", False),
                    input_tokens=prep["parse_in_tok"] + ans_in_tok,
                    output_tokens=prep["parse_out_tok"] + ans_out_tok,
                )
        except Exception as exc:
            logger.exception("Anthropic streaming error during aio-search")
            yield _sse("error", {"error": f"LLM error: {str(exc)}"})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


# ---------------------------------------------------------------------------
# #10 Side-by-side mode comparison
# ---------------------------------------------------------------------------

_COMPARE_SUPPORTED = {"chat", "aio-search", "pure-llm"}


def _run_one_mode(mode: str, payload: ChatRequest, tenant: str, bypass_cache: bool) -> CompareModeResult:
    """Dispatch a single mode and shape the result for the compare response.

    We call the route handlers as plain Python functions — they are
    thread-safe (each acquires its own DB connection) and we get to
    reuse their full retrieval / cache / citation pipelines. Errors are
    captured per-mode so one failing mode doesn't poison the whole
    comparison.
    """
    import time
    t0 = time.perf_counter()
    try:
        if mode == "chat":
            r = chat(payload, x_tenant_id=tenant)
            return CompareModeResult(
                mode=mode, reply=r.reply,
                latency_ms=int((time.perf_counter() - t0) * 1000),
                input_tokens=r.input_tokens, output_tokens=r.output_tokens,
                matched_aios=r.context_records,
            )
        if mode == "aio-search":
            r = aio_search(payload, x_tenant_id=tenant, bypass_cache=bypass_cache)
            return CompareModeResult(
                mode=mode, reply=r.reply,
                latency_ms=int((time.perf_counter() - t0) * 1000),
                input_tokens=r.input_tokens, output_tokens=r.output_tokens,
                matched_aios=r.matched_aios,
                sources_used=r.sources_used,
                served_from_cache=r.served_from_cache,
            )
        if mode == "pure-llm":
            r = pure_llm(payload, x_tenant_id=tenant)
            return CompareModeResult(
                mode=mode, reply=r.reply,
                latency_ms=int((time.perf_counter() - t0) * 1000),
                input_tokens=r.input_tokens, output_tokens=r.output_tokens,
                matched_aios=r.context_records,
            )
        return CompareModeResult(
            mode=mode, reply="",
            latency_ms=int((time.perf_counter() - t0) * 1000),
            error=f"unsupported mode: {mode}",
        )
    except HTTPException as exc:
        return CompareModeResult(
            mode=mode, reply="",
            latency_ms=int((time.perf_counter() - t0) * 1000),
            error=f"HTTP {exc.status_code}: {exc.detail}",
        )
    except Exception as exc:
        logger.exception("compare-modes mode=%s failed", mode)
        return CompareModeResult(
            mode=mode, reply="",
            latency_ms=int((time.perf_counter() - t0) * 1000),
            error=str(exc),
        )


@router.post("/v1/op/compare-modes", response_model=CompareModesResponse)
def compare_modes(
    payload: CompareModesRequest,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    """Run the same prompt through several modes in parallel and return all replies.

    Budget enforcement happens INSIDE each mode handler (so a single 429
    only kills the over-budget attempt — the other modes still answer
    if there is any headroom). Token usage is recorded per mode by the
    underlying handlers, so the budget counter advances correctly even
    when modes run concurrently.
    """
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages must not be empty")
    requested = [m for m in payload.modes if m in _COMPARE_SUPPORTED]
    if not requested:
        raise HTTPException(
            status_code=400,
            detail=f"no supported modes in {payload.modes}; supported: {sorted(_COMPARE_SUPPORTED)}",
        )

    tenant = x_tenant_id or "tenantA"
    # Up-front budget check; per-mode handlers also check.
    _budget.check_budget(tenant)

    sub_payload = ChatRequest(messages=payload.messages)

    from concurrent.futures import ThreadPoolExecutor
    results: List[CompareModeResult] = []
    with ThreadPoolExecutor(max_workers=min(4, len(requested))) as ex:
        futures = {ex.submit(_run_one_mode, m, sub_payload, tenant, payload.bypass_cache): m for m in requested}
        for fut in futures:
            results.append(fut.result())

    order = {m: i for i, m in enumerate(requested)}
    results.sort(key=lambda r: order.get(r.mode, 999))
    return CompareModesResponse(results=results)
