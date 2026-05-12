// Typed client for the InformationPhysics backend, accessed via Next.js proxy routes.
// All functions return null on backend unavailability — never throw.

export interface IORecord {
  io_id: string
  tenant_id: string
  type: string
  created_at: string
  raw: {
    raw_uri: string | null
    raw_hash: string | null
    mime_type: string | null
    size_bytes: number | null
  }
  context: {
    source_system: string | null
    source_object_id: string | null
    author: string | null
    policy_scope_id: string | null
  }
}

export interface CreateIOPayload {
  type: string
  raw: {
    raw_uri?: string | null
    raw_hash?: string | null
    mime_type?: string | null
    size_bytes?: number | null
  }
  context: {
    source_system?: string | null
    source_object_id?: string | null
    author?: string | null
    policy_scope_id?: string | null
  }
}

export interface ListIOParams {
  type?: string
  source_system?: string
  created_after?: string
  created_before?: string
  limit?: number
}

export interface EntityItem {
  name: string
  type: string
  value: string
  confidence: number
}

async function safeFetch<T>(url: string, options?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, options)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      if (body?.error === "backend_unavailable" || res.status === 503) return null
      console.error("[api-client] HTTP error", res.status, body)
      return null
    }
    return res.json() as Promise<T>
  } catch {
    return null
  }
}

export async function checkBackendHealth(): Promise<boolean> {
  const result = await safeFetch<{ status: string }>("/api/health")
  return result?.status === "ok"
}

export async function createIO(payload: CreateIOPayload): Promise<IORecord | null> {
  const result = await safeFetch<{ item: IORecord }>("/api/io", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  return result?.item ?? null
}

export async function listIOs(params?: ListIOParams): Promise<IORecord[]> {
  const qs = new URLSearchParams()
  if (params?.type) qs.set("type", params.type)
  if (params?.source_system) qs.set("source_system", params.source_system)
  if (params?.created_after) qs.set("created_after", params.created_after)
  if (params?.created_before) qs.set("created_before", params.created_before)
  if (params?.limit != null) qs.set("limit", String(params.limit))

  const result = await safeFetch<{ items: IORecord[] }>(`/api/io?${qs.toString()}`)
  return result?.items ?? []
}

// V5.0.10+ — Comprehensive corpus summary. Backend now returns
// structural facts (file/field inventory, date range) PLUS a
// structured LLM analysis (industry, categories, entities, patterns,
// recommendations). The narrative `summary` field is preserved for
// backward compatibility.
export interface SummarizeFileEntry {
  filename: string
  record_count: number
  sample_keys: string[]
}

export interface SummarizeFieldStat {
  key: string
  occurrences: number
  distinct_values: number
  sample_values: string[]
}

export interface SummarizeEntity {
  name: string
  type: string
  frequency: string
}

export interface SummarizeResult {
  summary: string
  aio_count: number
  model_ref?: string
  industry?: string | null
  categories?: string[]
  primary_entities?: SummarizeEntity[]
  notable_patterns?: string[]
  data_quality_notes?: string[]
  suggested_analyses?: string[]
  file_inventory?: SummarizeFileEntry[]
  field_inventory?: SummarizeFieldStat[]
  date_range?: { min: string; max: string } | null
  sampled_records?: number
}

export async function summarizeAIOs(aioTexts: string[]): Promise<SummarizeResult | null> {
  return safeFetch("/api/op/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ aio_texts: aioTexts, scope: "corpus" }),
  })
}

export async function resolveEntities(aioText: string): Promise<{ entities: EntityItem[] } | null> {
  return safeFetch("/api/op/resolve-entities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ aio_text: aioText }),
  })
}

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

export interface ChatResponse {
  reply: string
  model_ref: string
  context_records: number
  input_tokens: number
  output_tokens: number
}

export async function pureLlmChat(messages: ChatMessage[]): Promise<ChatResponse | { error: string } | null> {
  try {
    const res = await fetch("/api/op/pure-llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const detail: string = body?.detail ?? body?.error ?? `HTTP ${res.status}`
      return { error: detail }
    }
    return res.json() as Promise<ChatResponse>
  } catch {
    return null
  }
}

export async function chatWithAIO(messages: ChatMessage[]): Promise<ChatResponse | { error: string } | null> {
  try {
    const res = await fetch("/api/op/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      // Surface meaningful error details (e.g. API key not configured)
      const detail: string = body?.detail ?? body?.error ?? `HTTP ${res.status}`
      return { error: detail }
    }
    return res.json() as Promise<ChatResponse>
  } catch {
    return null
  }
}

// AIO Search Algebra
export interface AioSearchResponse {
  reply: string
  model_ref: string
  context_records: number
  matched_hsls: number
  matched_aios: number
  matched_hsl_ids: string[]   // HSL UUIDs traversed — used for MRO→HSL linking
  search_terms: Record<string, unknown>
  input_tokens: number
  output_tokens: number
  // Cache metadata (#8 query_hash micro-cache)
  served_from_cache?: boolean
  cache_id?: string
  cached_mro_id?: string
  // Provenance metadata (#9 citation post-pass)
  sources_used?: Record<string, unknown>
  // Server-applied retrieval-time policies (#2/#3)
  applied_filters?: string
  exclusions?: string[]
  // V5.0 Exhaustive Live mode metadata. ``mode`` is "live" by default
  // and "exhaustive" when chunked map-reduce was used; the four fields
  // below are populated only when mode === "exhaustive".
  mode?: "live" | "exhaustive"
  coverage?: number
  chunk_model?: string
  partial_warning?: string
  chunks_total?: number
  chunks_failed?: number
}

// V5.0 Exhaustive Live options.
//   mode:        "exhaustive" → chunked map-reduce path (no synthesis cap)
//   chunkModel:  per-chunk classifier model (default backend Haiku)
export interface AioSearchOpts {
  bypassCache?: boolean
  mode?: "live" | "exhaustive"
  chunkModel?: string
}

// Build the ?bypass_cache=…&mode=…&chunk_model=… query suffix from
// AioSearchOpts. Centralized so the streaming + non-streaming wrappers
// stay in sync; an empty opts object yields an empty string.
function buildAioSearchQuery(opts: AioSearchOpts): string {
  const params: string[] = []
  if (opts.bypassCache) params.push("bypass_cache=true")
  if (opts.mode === "exhaustive") params.push("mode=exhaustive")
  if (opts.chunkModel) params.push(`chunk_model=${encodeURIComponent(opts.chunkModel)}`)
  return params.length ? `?${params.join("&")}` : ""
}

export async function aioSearchChat(
  messages: ChatMessage[],
  opts: AioSearchOpts = {},
): Promise<AioSearchResponse | { error: string } | null> {
  // bypassCache=true appends ?bypass_cache=true so the server-side
  // query_cache short-circuit is skipped. Default false to preserve
  // existing caller behavior; chat-aio-dialog and benchmarks pass true
  // because users iterating through the UI expect fresh retrieval (and
  // because stale cache entries from before a backend retrieval fix
  // will otherwise mask the new behavior).
  //
  // mode === "exhaustive" routes the request through the V5.0 chunked
  // map-reduce path on the backend; chunkModel picks the per-chunk
  // classifier (default Haiku).
  const url = `/api/op/aio-search${buildAioSearchQuery(opts)}`
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const detail: string = body?.detail ?? body?.error ?? `HTTP ${res.status}`
      return { error: detail }
    }
    return res.json() as Promise<AioSearchResponse>
  } catch {
    return null
  }
}

// ── V4.5+ — Parse-only endpoint for Thorough Recall ───────────────────────
//
// Returns just the LLM-extracted search_terms for a query. Used by Recall
// Search in Thorough mode to import Live's semantic normalization
// (typo correction, synonym expansion) without paying for a full
// aio-search synthesis call.

export interface AioSearchParseResponse {
  search_terms: { field_values?: { field: string; value: string }[]; keywords?: string[] }
  parse_cache_hit: boolean
  input_tokens: number
  output_tokens: number
  model_ref: string
}

export async function aioSearchParse(
  messages: ChatMessage[],
  opts: { signal?: AbortSignal } = {},
): Promise<AioSearchParseResponse | { error: string } | null> {
  try {
    const res = await fetch("/api/op/aio-search-parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const detail: string = body?.detail ?? body?.error ?? `HTTP ${res.status}`
      return { error: detail }
    }
    return res.json() as Promise<AioSearchParseResponse>
  } catch {
    return null
  }
}

// ── Streaming variants (SSE) ──────────────────────────────────────────────
// The /stream endpoints emit Server-Sent Events:
//   event: text\n data: <json string>\n\n   — token chunks
//   event: meta\n data: <json>\n\n           — final metadata
//   event: error\n data: <json>\n\n          — fatal error (terminates)
//
// `consumeSSE` reads them via the Fetch streams API and dispatches to the
// supplied callbacks. We don't depend on EventSource because EventSource
// only supports GET — our endpoints are POST.

interface SSECallbacks<MetaT> {
  onText: (chunk: string) => void
  onMeta?: (meta: MetaT) => void
  onError?: (err: string) => void
}

// V5.0+ — SSE stream timeouts.
// Two limits: how long to wait for the FIRST byte (most likely
// failure mode is the backend never starting to stream because the
// LLM call hung), and how long between successive bytes (network
// drop / backend died mid-stream). Both are user-cancelable via the
// AbortController so a stalled call fails fast with a clear error
// instead of leaving the user staring at a spinner for 60+s.
const SSE_FIRST_BYTE_TIMEOUT_MS = 60_000   // 60s for first chunk — covers slow LLM cold starts
const SSE_HEARTBEAT_TIMEOUT_MS  = 30_000   // 30s between chunks — kills a hung stream
const SSE_TOTAL_TIMEOUT_MS      = 180_000  // 3min hard ceiling — even legit Exhaustive runs finish here

async function consumeSSE<MetaT>(
  url: string,
  body: unknown,
  cb: SSECallbacks<MetaT>,
): Promise<void> {
  // Hook a single AbortController to the fetch + the read loop so
  // any of the three timeouts below can kill the connection cleanly.
  const ctrl = new AbortController()
  const overall = setTimeout(() => ctrl.abort(new Error("sse_total_timeout")), SSE_TOTAL_TIMEOUT_MS)
  let firstByte: ReturnType<typeof setTimeout> | null = setTimeout(
    () => ctrl.abort(new Error("sse_first_byte_timeout")),
    SSE_FIRST_BYTE_TIMEOUT_MS,
  )
  let heartbeat: ReturnType<typeof setTimeout> | null = null

  const cleanupTimers = () => {
    clearTimeout(overall)
    if (firstByte) { clearTimeout(firstByte); firstByte = null }
    if (heartbeat) { clearTimeout(heartbeat); heartbeat = null }
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!res.ok || !res.body) {
      cleanupTimers()
      cb.onError?.(`HTTP ${res.status}`)
      return
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    let sawFirstByte = false
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      // Reset heartbeat on each successful read.
      if (!sawFirstByte) {
        sawFirstByte = true
        if (firstByte) { clearTimeout(firstByte); firstByte = null }
      }
      if (heartbeat) clearTimeout(heartbeat)
      heartbeat = setTimeout(
        () => ctrl.abort(new Error("sse_heartbeat_timeout")),
        SSE_HEARTBEAT_TIMEOUT_MS,
      )
      buf += decoder.decode(value, { stream: true })
      let sep: number
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const raw = buf.slice(0, sep)
        buf = buf.slice(sep + 2)
        let event = "message"
        const dataLines: string[] = []
        for (const line of raw.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim()
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim())
        }
        if (dataLines.length === 0) continue
        const data = dataLines.join("\n")
        try {
          const parsed = JSON.parse(data)
          if (event === "text") cb.onText(typeof parsed === "string" ? parsed : String(parsed))
          else if (event === "meta") cb.onMeta?.(parsed as MetaT)
          else if (event === "error") cb.onError?.(parsed?.error ?? "unknown error")
        } catch {
          // Treat unparseable text events as raw strings.
          if (event === "text") cb.onText(data)
        }
      }
    }
    cleanupTimers()
  } catch (err) {
    cleanupTimers()
    // Map abort reasons → meaningful error messages so the chat-aio
    // dialog's formatBackendError can render contextual help instead
    // of a vague "Load failed".
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("sse_first_byte_timeout")) {
      cb.onError?.("Backend did not start streaming within 60s. Likely causes: ANTHROPIC_API_KEY invalid, Anthropic outage, or backend service restarting.")
    } else if (msg.includes("sse_heartbeat_timeout")) {
      cb.onError?.("Stream stalled after 30s of silence. The backend or network connection dropped mid-response.")
    } else if (msg.includes("sse_total_timeout")) {
      cb.onError?.("Request exceeded 3-minute hard ceiling. The query is unusually large — try Live or a tighter scope.")
    } else if (msg.includes("Load failed") || msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
      // Pass the raw browser-supplied message through; the chat-aio
      // dialog's formatBackendError() adds the "Network error:" prefix
      // and the remediation list. Wrapping here too produced doubled
      // "Network error: Network error: …" output.
      cb.onError?.(msg)
    } else {
      cb.onError?.(msg)
    }
  }
}

export interface AioSearchStreamMeta {
  model_ref: string
  context_records: number
  matched_hsls: number
  matched_aios: number
  matched_hsl_ids: string[]
  search_terms: Record<string, unknown>
  input_tokens: number
  output_tokens: number
  // V5.0 Exhaustive metadata (only populated when mode=exhaustive).
  mode?: "live" | "exhaustive"
  coverage?: number
  chunk_model?: string
  partial_warning?: string
  chunks_total?: number
  chunks_failed?: number
}

export async function aioSearchChatStream(
  messages: ChatMessage[],
  cb: SSECallbacks<AioSearchStreamMeta>,
  opts: AioSearchOpts = {},
): Promise<void> {
  // mode === "exhaustive" routes the streaming endpoint to the V5.0
  // chunked map-reduce path. The backend currently emits the rendered
  // exhaustive result as a single text frame followed by a meta event
  // (per-chunk progress streaming is a future enhancement).
  const url = `/api/op/aio-search/stream${buildAioSearchQuery(opts)}`
  await consumeSSE<AioSearchStreamMeta>(url, { messages }, cb)
}

interface SubstrateStreamMeta {
  model_ref: string
  context_records: number
  input_tokens: number
  output_tokens: number
}

export async function substrateChatWithAIOStream(
  messages: ChatMessage[],
  contextBundle: string,
  cb: SSECallbacks<SubstrateStreamMeta>,
): Promise<void> {
  await consumeSSE<SubstrateStreamMeta>(
    "/api/op/substrate-chat/stream",
    { messages, context_bundle: contextBundle },
    cb,
  )
}

// Substrate Chat — focused LLM call using client-assembled context bundle only
export async function substrateChatWithAIO(
  messages: ChatMessage[],
  contextBundle: string,
): Promise<ChatResponse | { error: string } | null> {
  try {
    const res = await fetch("/api/op/substrate-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, context_bundle: contextBundle }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const detail: string = body?.detail ?? body?.error ?? `HTTP ${res.status}`
      return { error: detail }
    }
    return res.json() as Promise<ChatResponse>
  } catch {
    return null
  }
}

// Chat Search Statistics
export interface ChatStatRecord {
  stat_id: string
  tenant_id: string
  search_mode: string
  query_text: string
  result_preview: string | null
  elapsed_ms: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  context_records: number
  matched_hsls: number
  matched_aios: number
  cue_count: number
  neighborhood_size: number
  prior_count: number
  mro_saved: boolean
  /** Which LLM model handled the call (e.g. "claude-haiku-4-5"). Nullable on rows written before the audit-columns migration. */
  model_used: string | null
  /** True if Smart Search auto-classified this query into a mode rather than the operator clicking a specific mode button. */
  smart_search_used: boolean
  created_at: string
}

/**
 * Default chat-stats fetch cap. Mirrors DEFAULT_HSL_FETCH_CAP pattern: bounds
 * full-table loads in admin views; warn when results saturate the cap so
 * operators know the list is truncated.
 */
export const DEFAULT_CHAT_STATS_FETCH_CAP = 500

export async function listChatStats(limit: number = DEFAULT_CHAT_STATS_FETCH_CAP): Promise<ChatStatRecord[]> {
  const result = await safeFetch<ChatStatRecord[]>(`/api/chat-stats?limit=${limit}`)
  if (result && result.length >= limit) {
    console.warn(
      `listChatStats: returned ${result.length} rows at cap (limit=${limit}). ` +
      `Admin chat-stats view may be truncated. Consider raising the cap or ` +
      `adding server-side filtering / pagination.`,
    )
  }
  return result ?? []
}

export async function createChatStat(payload: Omit<ChatStatRecord, "stat_id" | "tenant_id" | "created_at">): Promise<ChatStatRecord | null> {
  return safeFetch<ChatStatRecord>("/api/chat-stats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export async function deleteChatStat(statId: string): Promise<boolean> {
  const result = await safeFetch<{ deleted: string }>(`/api/chat-stats/${statId}`, { method: "DELETE" })
  return result !== null
}

export interface MroForStat {
  mro_id: string
  mro_key: string | null
  query_text: string | null
  intent: string | null
  seed_hsls: unknown
  matched_aios_count: number | null
  search_terms: unknown
  result_text: string | null
  confidence: string | null
  trust_score: number | null
  parent_mro_ids: unknown
  context_bundle: unknown
  model_used: string | null
  derivation_method: string | null
  created_at: string
  updated_at: string | null
}

export async function getMroForStat(statId: string): Promise<MroForStat | null> {
  return safeFetch<MroForStat>(`/api/chat-stats/${statId}/mro`)
}

// User management
export interface User {
  user_id: string
  username: string
  email: string
  role: string
  created_at: string
  is_active: boolean
  last_login: string | null
}

// Roles
export interface Role {
  role_id: string
  role_name: string
  created_at: string
}

// AIO Data
export interface AioDataRecord {
  aio_id: string
  aio_name: string
  elements: (string | null)[]
  created_at: string
  updated_at: string
}

// HSL Data
export interface HslDataRecord {
  hsl_id: string
  hsl_name: string
  elements: (string | null)[]
  created_at: string
  updated_at: string
}

export async function listUsers(): Promise<User[]> {
  const result = await safeFetch<User[]>("/api/users")
  return result ?? []
}

export async function createUser(payload: {
  username: string
  email: string
  password: string
  role: string
}): Promise<User | null> {
  return safeFetch<User>("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export async function updateUser(
  userId: string,
  payload: { username?: string; email?: string; password?: string; role?: string; is_active?: boolean }
): Promise<User | null> {
  return safeFetch<User>(`/api/users/${userId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export async function deleteUser(userId: string): Promise<boolean> {
  const result = await safeFetch<{ deleted: string }>(`/api/users/${userId}`, { method: "DELETE" })
  return result !== null
}

// Auth
export interface LoginResult {
  user_id: string
  username: string
  email: string
  role: string
}

export async function loginUser(
  email: string,
  password: string
): Promise<{ user: LoginResult | null; error: string | null }> {
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
    if (res.status === 401) return { user: null, error: "Invalid email or password" }
    if (!res.ok) {
      let detail = ""
      try { const d = await res.json(); detail = d?.detail ?? d?.error ?? d?.message ?? "" } catch { /* ignore */ }
      return { user: null, error: detail ? `Login failed: ${detail}` : `Backend error (${res.status})` }
    }
    const data = await res.json()
    return { user: data, error: null }
  } catch {
    return { user: null, error: "Cannot connect to backend" }
  }
}

// Roles
export async function listRoles(): Promise<Role[]> {
  const result = await safeFetch<Role[]>("/api/roles")
  return result ?? []
}

export async function createRole(roleName: string): Promise<Role | null> {
  return safeFetch<Role>("/api/roles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role_name: roleName }),
  })
}

export async function deleteRole(roleId: string): Promise<boolean> {
  const result = await safeFetch<{ deleted: string }>(`/api/roles/${roleId}`, { method: "DELETE" })
  return result !== null
}

// AIO Data
export async function listAioData(limit: number = 5000): Promise<AioDataRecord[]> {
  const result = await safeFetch<AioDataRecord[]>(`/api/aio-data?limit=${limit}`)
  return result ?? []
}

export async function createAioData(aioName: string, elements: (string | null)[]): Promise<AioDataRecord | null> {
  return safeFetch<AioDataRecord>("/api/aio-data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ aio_name: aioName, elements }),
  })
}

export async function updateAioData(aioId: string, aioName: string, elements: (string | null)[]): Promise<AioDataRecord | null> {
  return safeFetch<AioDataRecord>(`/api/aio-data/${aioId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ aio_name: aioName, elements }),
  })
}

export async function deleteAioData(aioId: string): Promise<boolean> {
  const result = await safeFetch<{ deleted: string }>(`/api/aio-data/${aioId}`, { method: "DELETE" })
  return result !== null
}

// HSL Data

/**
 * Default HSL fetch cap for full-corpus loads (Recall Search multi-family
 * fan-out, Live Search Phase 2 catalog). High enough for the demo corpus;
 * the right long-term fix is server-side filtering (find-by-needles)
 * once a tenant's hsl_data row count routinely exceeds this cap.
 */
export const DEFAULT_HSL_FETCH_CAP = 500

/**
 * V4.4 P3 — list deduped (key, value) pairs parsed from HSL names.
 * Tiny payload (no element columns), used by Recall Search at dialog
 * open to seed cue extraction with the precise-key catalog without
 * shipping the full HSL corpus to the browser.
 */
export interface HslKeyValuePair {
  key: string
  value: string
}

export async function listHslKeyValuePairs(
  opts: { signal?: AbortSignal } = {},
): Promise<HslKeyValuePair[]> {
  const result = await safeFetch<HslKeyValuePair[]>(
    "/api/hsl-data/key-value-pairs",
    opts.signal ? { signal: opts.signal } : undefined,
  )
  return result ?? []
}

/**
 * V4.4 P3 — fetch full HSL rows whose names contain ≥1 of the supplied
 * values. Backed by the migration 017 ``information_element_refs``
 * inverted index. Used at query time (after cue extraction) so the
 * browser only pulls HSLs scoped to the current query rather than the
 * full corpus.
 */
export async function findHslsByNeedlesFull(
  values: string[],
  opts: {
    signal?: AbortSignal
    /** Switch from exact-match to trigram similarity. Backed by the
     *  GIN index in migration 031. Tolerates typos, declensions, and
     *  partial-token matches. ~10–30% slower per query than exact. */
    fuzzy?: boolean
    /** Trigram similarity threshold (0.05–0.95). Default 0.30 = good
     *  for "Mitchell" ↔ "Mitchel" / "Sara" ↔ "Sarah". 0.50+ for
     *  near-exact only. Ignored when fuzzy is false. */
    similarity?: number
  } = {},
): Promise<HslDataRecord[]> {
  if (!values || values.length === 0) return []
  // Fuzzy is ON by default — better recall on typos, declensions,
  // partial tokens, and field-name variants than exact match. Backed
  // by the GIN trigram index from migration 031. Pass `fuzzy: false`
  // explicitly for diagnostics that need byte-exact behavior.
  const useFuzzy = opts.fuzzy !== false
  const body: Record<string, unknown> = { values }
  if (useFuzzy) body.fuzzy = true
  if (opts.similarity !== undefined) body.similarity = opts.similarity
  const result = await safeFetch<HslDataRecord[]>(
    "/api/hsl-data/find-by-needles-full",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(opts.signal ? { signal: opts.signal } : {}),
    },
  )
  return result ?? []
}

export async function listHslData(limit: number = DEFAULT_HSL_FETCH_CAP): Promise<HslDataRecord[]> {
  const result = await safeFetch<HslDataRecord[]>(`/api/hsl-data?limit=${limit}`)
  if (result && result.length >= limit) {
    console.warn(
      `listHslData: returned ${result.length} rows at cap (limit=${limit}). ` +
      `Recall Search multi-family fan-out and Live Search Phase 2 catalog ` +
      `may be truncated. Consider server-side filtering or paginated load.`,
    )
  }
  return result ?? []
}

export async function createHslData(hslName: string, elements: (string | null)[]): Promise<HslDataRecord | null> {
  return safeFetch<HslDataRecord>("/api/hsl-data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hsl_name: hslName, elements }),
  })
}

export async function updateHslData(hslId: string, hslName: string, elements: (string | null)[]): Promise<HslDataRecord | null> {
  return safeFetch<HslDataRecord>(`/api/hsl-data/${hslId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hsl_name: hslName, elements }),
  })
}

export async function deleteHslData(hslId: string): Promise<boolean> {
  const result = await safeFetch<{ deleted: string }>(`/api/hsl-data/${hslId}`, { method: "DELETE" })
  return result !== null
}

export interface RebuildHslsResult {
  created: number
  skipped_single_aio: number
  already_existed: number
  total_aios_scanned: number
  as_of?: string | null
}

/**
 * Bulk HSL rebuild.
 *
 * @param asOf  Optional ISO-8601 timestamp. When supplied, the rebuild
 *              considers only AIOs whose ``created_at <= as_of``, enabling
 *              forensic / point-in-time reconstruction of the HSL topology.
 *              Omit for the default "rebuild against current corpus" behavior.
 */
export async function rebuildHslsFromAios(asOf?: string): Promise<RebuildHslsResult | null> {
  const qs = asOf ? `?as_of=${encodeURIComponent(asOf)}` : ""
  return safeFetch<RebuildHslsResult>(`/api/hsl-data/rebuild-from-aios${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  })
}

export interface PruneHslsResult {
  pruned: number
  names: string[]
}

/**
 * Dual of rebuild: removes HSLs whose surviving live-AIO member count has
 * dropped below 2. Authoritative count is taken from the ``hsl_member``
 * side table joined against current ``aio_data``; MRO members do not
 * count toward the floor.
 */
export async function pruneHsls(): Promise<PruneHslsResult | null> {
  return safeFetch<PruneHslsResult>("/api/hsl-data/prune", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  })
}

// Saved Prompts
export interface SavedPrompt {
  prompt_id: string
  prompt_text: string
  label: string | null
  category: string | null
  created_at: string
  updated_at: string
}

export async function listSavedPrompts(limit: number = 5000): Promise<SavedPrompt[]> {
  const result = await safeFetch<SavedPrompt[]>(`/api/saved-prompts?limit=${limit}`)
  return result ?? []
}

export async function createSavedPrompt(payload: {
  prompt_text: string
  label?: string | null
  category?: string | null
}): Promise<SavedPrompt | null> {
  return safeFetch<SavedPrompt>("/api/saved-prompts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export async function updateSavedPrompt(
  promptId: string,
  payload: { prompt_text?: string; label?: string | null; category?: string | null }
): Promise<SavedPrompt | null> {
  return safeFetch<SavedPrompt>(`/api/saved-prompts/${promptId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export async function deleteSavedPrompt(promptId: string): Promise<boolean> {
  const result = await safeFetch<{ deleted: string }>(`/api/saved-prompts/${promptId}`, { method: "DELETE" })
  return result !== null
}

// ── Prompt Library (V5.0+) ─────────────────────────────────────
//
// Curated, admin-managed exemplar prompts. Distinct from `saved_prompts`
// (operator-personal). Library entries ship seeded; admins maintain
// them via System Admin → Prompt Library; ChatAIO surfaces them
// via the History dropdown's new "Library" tab.

export interface PromptLibraryEntry {
  prompt_id: string
  title: string
  body: string
  category: string
  metadata: string | null
  is_seeded: boolean
  created_at: string
  updated_at: string
}

export async function listPromptLibrary(category?: string): Promise<PromptLibraryEntry[]> {
  const qs = category ? `?category=${encodeURIComponent(category)}` : ""
  const result = await safeFetch<PromptLibraryEntry[]>(`/api/prompt-library${qs}`)
  return result ?? []
}

export async function createPromptLibraryEntry(payload: {
  title: string
  body: string
  category?: string
  metadata?: string | null
}): Promise<PromptLibraryEntry | null> {
  return safeFetch<PromptLibraryEntry>("/api/prompt-library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export async function updatePromptLibraryEntry(
  promptId: string,
  payload: { title?: string; body?: string; category?: string; metadata?: string | null },
): Promise<PromptLibraryEntry | null> {
  return safeFetch<PromptLibraryEntry>(`/api/prompt-library/${promptId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export async function deletePromptLibraryEntry(promptId: string): Promise<boolean> {
  const result = await safeFetch<{ deleted: string }>(`/api/prompt-library/${promptId}`, { method: "DELETE" })
  return result !== null
}

// API key settings
export async function getApiKeySetting(): Promise<{ configured: boolean; masked: string | null } | null> {
  return safeFetch("/api/settings/apikey")
}

export async function updateApiKeySetting(apiKey: string): Promise<{ ok: boolean } | null> {
  return safeFetch("/api/settings/apikey", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey }),
  })
}

// Model + Smart Search settings (V5.0+).
// `smart_search_enabled` toggles the auto-mode classifier in ChatAIO.
// When true, the dialog hides the multi-button row and shows a single
// "Smart Search" button that runs lib/smart-search.ts → handler.
export interface ModelSettings {
  default_model: string
  parse_model: string
  available: string[]
  smart_search_enabled: boolean
}

export async function getModelSettings(): Promise<ModelSettings | null> {
  return safeFetch("/api/settings/models")
}

export async function updateModelSettings(payload: {
  default_model?: string
  parse_model?: string
  smart_search_enabled?: boolean
}): Promise<
  | { ok: boolean; default_model: string; parse_model: string; smart_search_enabled: boolean }
  | null
> {
  return safeFetch("/api/settings/models", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

// Daily token budget
export interface BudgetSettings {
  tenant_id: string
  used_today: number
  effective_limit: number | null
  percent_used: number
  warn?: boolean
  blocked?: boolean
  tenant_limit_raw: string | null  // null = no override; falls through to global
  global_limit_raw: string | null  // null = no global default; guardrail disabled
}

export async function getBudgetSettings(): Promise<BudgetSettings | null> {
  return safeFetch("/api/settings/budget")
}

export async function updateBudgetSettings(payload: {
  tenant_limit?: string  // "" = clear; "<int>" = set
  global_limit?: string
}): Promise<(BudgetSettings & { ok: boolean }) | null> {
  return safeFetch("/api/settings/budget", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

// V4.6+ — operator-tunable substrate caps
export interface CapSettings {
  recall_max_aios: number
  recall_thorough_max_aios: number
  live_aio_cap_max: number
  recall_max_aios_raw: string | null
  recall_thorough_max_aios_raw: string | null
  live_aio_cap_max_raw: string | null
}

export async function getCapSettings(): Promise<CapSettings | null> {
  return safeFetch("/api/settings/caps")
}

export async function updateCapSettings(payload: {
  recall_max_aios?: string           // "" = clear; "<int>" = set
  recall_thorough_max_aios?: string
  live_aio_cap_max?: string
}): Promise<(CapSettings & { ok: boolean }) | null> {
  return safeFetch("/api/settings/caps", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

// Information Elements
export interface InformationElement {
  element_id: string
  field_name: string
  aio_count: number
  created_at: string
  updated_at: string
}

export async function listInformationElements(): Promise<InformationElement[]> {
  return (await safeFetch<InformationElement[]>("/api/information-elements")) ?? []
}

export async function createInformationElement(field_name: string, aio_count: number = 0): Promise<InformationElement | null> {
  return safeFetch("/api/information-elements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ field_name, aio_count }),
  })
}

export async function updateInformationElement(elementId: string, field_name: string, aio_count: number): Promise<InformationElement | null> {
  return safeFetch(`/api/information-elements/${elementId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ field_name, aio_count }),
  })
}

export async function deleteInformationElement(elementId: string): Promise<boolean> {
  const result = await safeFetch<{ deleted: string }>(`/api/information-elements/${elementId}`, { method: "DELETE" })
  return result !== null
}

export async function rebuildInformationElements(): Promise<{ rebuilt: number; fields: string[] } | null> {
  return safeFetch("/api/information-elements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ _rebuild: true }),
  })
}

// MRO Objects
export interface MroObject {
  mro_id: string
  mro_key: string
  query_text: string
  intent: string | null
  seed_hsls: string | null
  matched_aios_count: number
  search_terms: Record<string, unknown> | null
  result_text: string
  context_bundle: string | null
  confidence: string
  policy_scope: string
  tenant_id: string | null
  trust_score?: number
  created_at: string
  updated_at: string
}

export async function listMroObjects(
  limit: number = 200,
  opts: { summary?: boolean } = {},
): Promise<MroObject[]> {
  // Default limit dropped from 5000 → 200 to keep dialog-open and
  // Substrate-cache refreshes snappy. ChatAIO callers pass summary:true
  // and rely on lazy hydration via getMroObject(id) when a prior is
  // actually selected. Bulk admin browsers should pass an explicit limit.
  const qs = new URLSearchParams({ limit: String(limit) })
  if (opts.summary) {
    // Send both for forward/back compat: backends since this change
    // accept either ?summary=true or ?fields=summary.
    qs.set("summary", "true")
    qs.set("fields", "summary")
  }
  const result = await safeFetch<MroObject[]>(`/api/mro-objects?${qs.toString()}`)
  return result ?? []
}

export async function getMroObject(mroId: string, opts?: { signal?: AbortSignal }): Promise<MroObject | null> {
  return safeFetch<MroObject>(`/api/mro-objects/${mroId}`, opts?.signal ? { signal: opts.signal } : undefined)
}

export async function createMroObject(data: {
  mro_key: string
  query_text: string
  intent?: string | null
  seed_hsls?: string | null
  matched_aios_count?: number
  search_terms?: Record<string, unknown> | null
  result_text: string
  context_bundle?: string | null
  confidence?: string
  policy_scope?: string
}): Promise<MroObject | null> {
  return safeFetch<MroObject>("/api/mro-objects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
}

export async function updateMroObject(
  id: string,
  patch: {
    mro_key?: string
    query_text?: string
    intent?: string | null
    seed_hsls?: string | null
    matched_aios_count?: number
    search_terms?: Record<string, unknown> | null
    result_text?: string
    context_bundle?: string | null
    confidence?: string
    policy_scope?: string
  },
): Promise<MroObject | null> {
  return safeFetch<MroObject>(`/api/mro-objects/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  })
}

export async function deleteMroObject(id: string): Promise<boolean> {
  const result = await safeFetch<{ deleted: string }>(`/api/mro-objects/${id}`, { method: "DELETE" })
  return result !== null
}

// MRO ↔ HSL linkage. After a Recall or Live Search, the new MRO is
// linked back into every contributing HSL by writing [MRO.<uuid>] into
// the hsl_member side table. This call inverts that lookup so the UI
// can audit whether the link writes actually landed for a given MRO.
export interface MroLinkedHsl {
  hsl_id: string
  hsl_name: string
  created_at: string | null
  updated_at: string | null
  member_count: number
}
export interface MroLinkageResponse {
  mro_id: string
  mro_ref: string
  seed_hsl_ids: string[]
  seed_count: number
  linked_count: number
  linked_hsls: MroLinkedHsl[]
  // Diagnostic: HSLs the MRO claims as seeds (seed_hsls field) that
  // are NOT carrying the [MRO.<uuid>] back-pointer (link write failed
  // or HSL was pruned).
  seed_minus_linked: string[]
  // Diagnostic: HSLs that carry the back-pointer but aren't in the
  // MRO's seed_hsls list (manual link, MRO save failed but link
  // succeeded, or seed_hsls was edited later).
  linked_minus_seed: string[]
}
export async function getMroLinkage(mroId: string): Promise<MroLinkageResponse | null> {
  return safeFetch<MroLinkageResponse>(`/api/mro-objects/${encodeURIComponent(mroId)}/hsls`)
}

// Admin one-shot repair: fixes MROs whose seed_hsls field was
// corrupted by the pre-V4.5 manual Save MRO bug (display string
// instead of UUIDs). For each broken MRO, recovers the UUID list
// from hsl_member back-pointers when present, else clears the field.
export interface MroSeedRepairResult {
  tenant_id: string
  scanned: number
  skipped_valid: number
  repaired: number  // legacy: count of seed_hsls field repairs
  // Pass A: corrupted seed_hsls field repairs (display strings, etc).
  details: Array<{
    mro_id: string
    mro_key: string
    before: string | null
    after_count: number
    recovered_from_backlinks: boolean
  }>
  // Pass B: missing back-pointer backfill (the Next.js 16 params bug).
  seed_repaired?: number
  backpointers_backfilled_for_mros?: number
  backpointers_inserted_total?: number
  skipped_already_linked?: number
  backfill_details?: Array<{
    mro_id: string
    mro_key: string
    seed_count: number
    already_linked: number
    missing_count: number
    pruned_count: number
    inserted: number
  }>
}
export async function repairMroSeedHsls(): Promise<MroSeedRepairResult | null> {
  return safeFetch<MroSeedRepairResult>("/api/mro-objects/repair-seed-hsls", { method: "POST" })
}

// V4.4 — MRO-assisted retrieval (first slice).
// Used by the substrate pipeline before extracting cues, to (a) potentially
// short-circuit on a near-duplicate prior, (b) seed cue extraction with
// search_terms from similar past queries, and (c) augment the bundle with
// the top prior's result_summary.

export interface MroSearchHit {
  mro_id: string
  mro_key: string
  query_text: string
  similarity: number              // pg_trgm trigram similarity (0..1)
  ts_rank: number                 // tsvector ts_rank (0..~1)
  score: number                   // GREATEST(similarity, ts_rank)
  trust_weighted_score: number    // score * (1 + ln(1 + trust_score))
  search_terms: unknown | null    // JSONB cue list from the prior episode
  seed_hsls: string | null        // pipe-separated lineage hint
  result_summary: string          // first ~500 chars of result_text
  result_full_available: boolean  // true when result_text was non-empty
  confidence: string
  trust_score: number
  created_at: string
}

export interface MroSearchResponse {
  query: string
  k: number
  matches: MroSearchHit[]
}

/**
 * Find prior MROs similar to the given query. Combines pg_trgm trigram
 * similarity with tsvector ts_rank, weighted by trust_score. Returns a
 * lightweight projection — full ``result_text`` is truncated to
 * ``summaryChars`` (default 500) on the server.
 *
 * Returns ``null`` on backend unavailability so the caller can fall
 * through to the normal pipeline.
 */
export async function mroSearch(
  query: string,
  opts: { k?: number; minScore?: number; summaryChars?: number; signal?: AbortSignal } = {},
): Promise<MroSearchResponse | null> {
  const q = (query ?? "").trim()
  if (!q) return null
  const qs = new URLSearchParams({ query: q })
  if (opts.k !== undefined) qs.set("k", String(opts.k))
  if (opts.minScore !== undefined) qs.set("min_score", String(opts.minScore))
  if (opts.summaryChars !== undefined) qs.set("summary_chars", String(opts.summaryChars))
  return safeFetch<MroSearchResponse>(
    `/api/op/mro-search?${qs.toString()}`,
    opts.signal ? { signal: opts.signal } : undefined,
  )
}

/**
 * Increment trust_score on a list of parent MROs.
 * Called by the Substrate pipeline whenever a new MRO is saved that used
 * the listed priors as context — reinforces priors that get reused.
 */
export async function bumpMroTrust(parentMroIds: string[], delta: number = 1.0): Promise<number> {
  if (parentMroIds.length === 0) return 0
  const result = await safeFetch<{ updated: number }>("/api/mro-objects/bump-trust", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parent_mro_ids: parentMroIds, delta }),
  })
  return result?.updated ?? 0
}

// HSL ↔ MRO Linking

/**
 * Append [MRO.<mroId>] to the next free element slot in the given HSL record.
 * Returns true if the link was written, false if already linked or no free slot.
 */
export async function linkMroToHsl(
  hslId: string,
  mroId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<boolean> {
  const result = await safeFetch<{ updated: boolean }>(`/api/hsl-data/${hslId}/link-mro`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mro_id: mroId }),
    signal: opts.signal,
  })
  return result?.updated === true
}

/**
 * Find HSL IDs whose elements contain any of the given needle strings.
 * Used by the Substrate pipeline to discover which HSLs to link a new MRO into.
 */
export async function findHslsByNeedles(needles: string[]): Promise<string[]> {
  const result = await safeFetch<{ hsl_ids: string[] }>("/api/hsl-data/find-by-needles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ needles, limit: 20 }),
  })
  return result?.hsl_ids ?? []
}

/**
 * Find AIO names whose ``elements_text`` contains any of the given needles.
 * Backed by the pg_trgm GIN index on ``aio_data.elements_text``.
 *
 * Used by the Substrate pipeline to filter the in-memory AIO array down
 * to a candidate neighborhood before running the deterministic
 * ``traverseHSL`` scoring — pushes the O(|cues|×|aios|) scan into Postgres.
 *
 * Returns ``null`` on backend unavailability so the caller can fall
 * back to the original full-corpus client-side scan.
 */
export async function findAiosByNeedles(
  needles: string[],
  limit: number = 200,
): Promise<string[] | null> {
  if (!needles || needles.length === 0) return []
  const result = await safeFetch<{ aio_names: string[] }>("/api/aio-data/find-by-needles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ needles, limit }),
  })
  if (!result) return null
  return result.aio_names ?? []
}

// PDF extraction
export interface PdfExtractResult {
  csv_text: string
  headers: string[]
  rows: string[][]
  document_count: number
  filename: string
  // V5.0+ extra metadata
  page_count?: number
  chunk_count?: number
  chunks_failed?: number
  partial_warning?: string | null
  elapsed_seconds?: number
  pdf_id?: string | null  // present when backend persisted the original
  model?: string          // V5.0.7+ — Anthropic model used for extraction
}

// V5.0.5+ — Polling-based PDF extraction.
//
// SSE progress kept failing with payload-buffering issues that left
// the UI frozen on "Finalizing CSV…" forever. We replaced it with a
// request/poll pattern that's bulletproof through any proxy chain:
//
//   1. POST /api/op/pdf-extract-async → kicks off extraction,
//      returns {pdf_id, total_pages, total_chunks, model}
//   2. Poll GET /api/imported-pdfs/{pdf_id} every 1.5s for progress
//      (status, current_chunk, row_count, chunks_failed, error)
//   3. When status reaches a terminal value (extracted/partial/failed),
//      fetch GET /api/imported-pdfs/{pdf_id}/csv-result for the data
//
// The progress event shape stays the same as the SSE flow so the UI
// code didn't have to change.
//
// V5.0.2+ — Streaming PDF extraction (legacy, kept for reference).

export interface PdfStreamMetaEvent {
  pdf_id: string | null
  filename: string
  size_bytes: number
  total_pages: number
  total_chunks: number
  chunk_timeout_seconds: number
  model?: string
}

export interface PdfStreamChunkStartEvent {
  chunk_index: number
  chunks_total: number
  page_start: number
  page_end: number
}

export interface PdfStreamChunkDoneEvent {
  chunk_index: number
  chunks_total: number
  rows_added: number
  rows_total?: number
  elapsed_seconds: number
}

export interface PdfStreamChunkErrorEvent {
  chunk_index: number
  chunks_total: number
  error: string
  elapsed_seconds: number
}

export type PdfStreamProgressEvent =
  | { type: "meta"; data: PdfStreamMetaEvent }
  | { type: "chunk_start"; data: PdfStreamChunkStartEvent }
  | { type: "chunk_done"; data: PdfStreamChunkDoneEvent }
  | { type: "chunk_error"; data: PdfStreamChunkErrorEvent }
  | { type: "finalizing"; data: { chunks_done: number } }

export async function extractPdfToCsvStream(
  file: File,
  opts: {
    signal?: AbortSignal
    timeoutMs?: number
    onProgress?: (event: PdfStreamProgressEvent) => void
  } = {},
): Promise<PdfExtractResult | { error: string } | null> {
  const timeoutMs = opts.timeoutMs ?? 480_000
  const ac = new AbortController()
  const timeoutId = setTimeout(() => {
    ac.abort(new DOMException("PdfExtractTimeout", "TimeoutError"))
  }, timeoutMs)
  if (opts.signal) {
    if (opts.signal.aborted) ac.abort(opts.signal.reason)
    else opts.signal.addEventListener("abort", () => ac.abort(opts.signal!.reason), { once: true })
  }

  const formData = new FormData()
  formData.append("file", file)

  try {
    const res = await fetch("/api/op/pdf-extract/stream", {
      method: "POST",
      body: formData,
      signal: ac.signal,
    })

    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({}))
      const detail: string = body?.detail ?? body?.error ?? `HTTP ${res.status}`
      return { error: detail }
    }

    // SSE parser: framing is `event: NAME\ndata: JSON\n\n`. We split on
    // the blank-line separator and dispatch each frame.
    //
    // V5.0.3+ — return as soon as we see `complete` or `error`. The
    // backend may still be doing best-effort persistence after yielding
    // `complete`; if we kept reading until the stream closes naturally
    // we'd hang until that finishes. reader.cancel() releases the
    // connection cleanly, the server's gen() gets GeneratorExit, and
    // the persistence cleanup completes in the request thread without
    // blocking the user.
    const reader = res.body.getReader()
    const decoder = new TextDecoder("utf-8")
    let buffer = ""
    let finalResult: PdfExtractResult | null = null
    let hardError: string | null = null

    streamLoop: while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let sepIdx: number
      while ((sepIdx = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, sepIdx)
        buffer = buffer.slice(sepIdx + 2)
        const lines = frame.split("\n")
        let evName = "message"
        const dataLines: string[] = []
        for (const line of lines) {
          if (line.startsWith("event:")) evName = line.slice(6).trim()
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart())
        }
        if (!dataLines.length) continue
        let payload: unknown
        try {
          payload = JSON.parse(dataLines.join("\n"))
        } catch {
          continue
        }
        switch (evName) {
          case "meta":
          case "chunk_start":
          case "chunk_done":
          case "chunk_error":
          case "finalizing":
            opts.onProgress?.({ type: evName as PdfStreamProgressEvent["type"], data: payload as never })
            break
          case "complete":
            finalResult = payload as PdfExtractResult
            break streamLoop
          case "error":
            hardError = (payload as { detail?: string })?.detail ?? "Unknown stream error"
            break streamLoop
        }
      }
    }
    // Release the connection so the backend's post-completion work
    // (e.g. persistence UPDATE) doesn't hold our request thread open.
    await reader.cancel().catch(() => { /* ignore */ })

    if (hardError) return { error: hardError }
    if (finalResult) {
      // V5.0.4+ — When persistence succeeded the backend ships a tiny
      // complete event (just pdf_id + metadata). Fetch the actual
      // CSV/rows/headers via REST. Falls back to inline data if the
      // backend included it (persistence failure path).
      const hasInlineData =
        Array.isArray((finalResult as { rows?: unknown }).rows) &&
        Array.isArray((finalResult as { headers?: unknown }).headers) &&
        typeof (finalResult as { csv_text?: unknown }).csv_text === "string"
      if (hasInlineData) return finalResult
      const pdfId = (finalResult as { pdf_id?: string | null }).pdf_id
      if (!pdfId) return { error: "Extraction completed but no result data was returned" }
      try {
        const resultRes = await fetch(`/api/imported-pdfs/${pdfId}/csv-result`, { cache: "no-store" })
        if (!resultRes.ok) {
          const detail = await resultRes.json().catch(() => ({}))
          return { error: `Result fetch failed: ${detail?.detail ?? `HTTP ${resultRes.status}`}` }
        }
        const data = await resultRes.json()
        // Stitch the SSE-summary fields into the REST payload so the
        // PdfExtractResult shape downstream consumers expect is intact.
        return {
          ...data,
          partial_warning: (finalResult as { partial_warning?: string | null }).partial_warning ?? data.partial_warning ?? null,
          model: (finalResult as { model?: string }).model ?? data.model,
          chunk_count: (finalResult as { chunk_count?: number }).chunk_count ?? data.chunk_count,
          chunks_failed: (finalResult as { chunks_failed?: number }).chunks_failed ?? data.chunks_failed,
        } as PdfExtractResult
      } catch (e) {
        return { error: `Result fetch failed: ${e instanceof Error ? e.message : String(e)}` }
      }
    }
    return { error: "Stream ended before completion" }
  } catch (err) {
    if (err instanceof DOMException) {
      if (err.name === "TimeoutError") {
        return { error: `Extraction exceeded ${Math.round(timeoutMs / 1000)}s — backend may be hung. Retry or break the PDF into smaller files.` }
      }
      if (err.name === "AbortError") {
        return { error: "Cancelled by operator" }
      }
    }
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

// V5.0+ — System Admin → PDFs pane.
export interface ImportedPdfMeta {
  pdf_id: string
  filename: string
  size_bytes: number
  page_count: number | null
  sha256: string | null
  status: string                 // pending | extracting | finalizing | extracted | partial | failed
  row_count: number | null
  chunk_count: number | null
  chunks_failed: number | null
  current_chunk: number | null   // V5.0.5+ — live progress index
  duration_ms: number | null
  error: string | null
  created_at: string
}

// V5.0.5+ — Polling-based PDF extraction. Replaces SSE streaming.
export async function extractPdfToCsvPolling(
  file: File,
  opts: {
    signal?: AbortSignal
    timeoutMs?: number
    pollIntervalMs?: number
    onProgress?: (event: PdfStreamProgressEvent) => void
  } = {},
): Promise<PdfExtractResult | { error: string } | null> {
  const timeoutMs = opts.timeoutMs ?? 480_000
  const pollIntervalMs = opts.pollIntervalMs ?? 1500
  const ac = new AbortController()
  const timeoutId = setTimeout(() => {
    ac.abort(new DOMException("PdfExtractTimeout", "TimeoutError"))
  }, timeoutMs)
  if (opts.signal) {
    if (opts.signal.aborted) ac.abort(opts.signal.reason)
    else opts.signal.addEventListener("abort", () => ac.abort(opts.signal!.reason), { once: true })
  }

  try {
    // 1. Kick off extraction
    const formData = new FormData()
    formData.append("file", file)
    const startRes = await fetch("/api/op/pdf-extract-async", {
      method: "POST",
      body: formData,
      signal: ac.signal,
    })
    if (!startRes.ok) {
      const body = await startRes.json().catch(() => ({}))
      return { error: body?.detail ?? body?.error ?? `HTTP ${startRes.status}` }
    }
    const startData = await startRes.json() as {
      pdf_id: string
      filename: string
      total_pages: number
      total_chunks: number
      model: string
    }
    const { pdf_id: pdfId, total_pages: totalPages, total_chunks: totalChunks, model } = startData

    // Synthesize the meta event so the UI gets the same flow as SSE.
    opts.onProgress?.({
      type: "meta",
      data: {
        pdf_id: pdfId,
        filename: startData.filename,
        size_bytes: file.size,
        total_pages: totalPages,
        total_chunks: totalChunks,
        chunk_timeout_seconds: 180,
        model,
      },
    })

    // 2. Poll for progress until terminal status
    let lastChunk = 0
    let lastStartedChunk = 0
    let finalizingFirstSeenAt: number | null = null
    while (true) {
      if (ac.signal.aborted) {
        const reason = ac.signal.reason
        if (reason instanceof DOMException && reason.name === "TimeoutError") {
          return { error: `Extraction exceeded ${Math.round(timeoutMs / 1000)}s — try breaking the PDF into smaller files.` }
        }
        return { error: "Cancelled by operator" }
      }

      // Wait, but break early if signal aborts.
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, pollIntervalMs)
        ac.signal.addEventListener("abort", () => { clearTimeout(t); resolve() }, { once: true })
      })
      if (ac.signal.aborted) continue  // loop top will handle it

      const statusRes = await fetch(`/api/imported-pdfs/${pdfId}`, { cache: "no-store" })
      if (!statusRes.ok) continue  // transient; keep polling
      const status = await statusRes.json() as ImportedPdfMeta

      const cur = status.current_chunk ?? 0
      const total = status.chunk_count ?? totalChunks

      // Synthesize chunk_start when current_chunk advances past lastStartedChunk
      if (cur > lastStartedChunk && cur > 0) {
        // Approximate page range for the synthesized event
        const pagesPerChunk = Math.ceil(totalPages / total)
        const pageStart = (cur - 1) * pagesPerChunk + 1
        const pageEnd = Math.min(cur * pagesPerChunk, totalPages)
        opts.onProgress?.({
          type: "chunk_start",
          data: { chunk_index: cur, chunks_total: total, page_start: pageStart, page_end: pageEnd },
        })
        lastStartedChunk = cur
      }

      // Synthesize chunk_done when row_count growth crosses a chunk boundary
      // Heuristic: when current_chunk increments past lastChunk, assume the
      // previous chunk just finished. For terminal status, also flush.
      if (cur > lastChunk + 1 || (status.status === "finalizing" && cur > lastChunk) ||
          (status.status === "extracted" && cur > lastChunk) ||
          (status.status === "partial" && cur > lastChunk)) {
        // Mark all chunks between lastChunk+1 and cur (or cur-1 if cur is still running)
        const upTo = (status.status === "extracting") ? Math.max(0, cur - 1) : cur
        for (let i = lastChunk + 1; i <= upTo; i++) {
          opts.onProgress?.({
            type: "chunk_done",
            data: {
              chunk_index: i,
              chunks_total: total,
              rows_added: 0,
              rows_total: status.row_count ?? 0,
              elapsed_seconds: 0,
            },
          })
        }
        lastChunk = upTo
      }

      // Terminal states
      if (status.status === "finalizing") {
        opts.onProgress?.({ type: "finalizing", data: { chunks_done: total - (status.chunks_failed ?? 0) } })
        if (finalizingFirstSeenAt == null) finalizingFirstSeenAt = Date.now()
        // V5.0.6+ — Stuck-on-finalizing escape hatch. After ~10s in
        // finalizing, attempt to fetch /csv-result directly. If the
        // worker wrote csv_text but failed to flip status (the
        // recurring bug class), the result is already there — return
        // it instead of polling forever.
        if (Date.now() - finalizingFirstSeenAt > 10_000) {
          try {
            const resultRes = await fetch(`/api/imported-pdfs/${pdfId}/csv-result`, { cache: "no-store" })
            if (resultRes.ok) {
              const data = await resultRes.json() as PdfExtractResult
              return {
                ...data,
                partial_warning: status.error ?? data.partial_warning ?? null,
                chunk_count: total,
                chunks_failed: status.chunks_failed ?? 0,
                model,
              }
            }
            // 409 means csv_text isn't populated yet; keep polling.
          } catch { /* keep polling */ }
        }
      }
      if (status.status === "extracted" || status.status === "partial") {
        // 3. Fetch the actual CSV result
        const resultRes = await fetch(`/api/imported-pdfs/${pdfId}/csv-result`, { cache: "no-store" })
        if (!resultRes.ok) {
          const body = await resultRes.json().catch(() => ({}))
          return { error: `Result fetch failed: ${body?.detail ?? `HTTP ${resultRes.status}`}` }
        }
        const data = await resultRes.json() as PdfExtractResult
        return {
          ...data,
          partial_warning: status.error ?? data.partial_warning ?? null,
          chunk_count: total,
          chunks_failed: status.chunks_failed ?? 0,
          model,
        }
      }
      if (status.status === "failed") {
        return { error: status.error ?? "Extraction failed (no error detail)" }
      }
    }
  } catch (err) {
    if (err instanceof DOMException) {
      if (err.name === "TimeoutError") {
        return { error: `Extraction exceeded ${Math.round(timeoutMs / 1000)}s — try breaking the PDF into smaller files.` }
      }
      if (err.name === "AbortError") {
        return { error: "Cancelled by operator" }
      }
    }
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function listImportedPdfs(): Promise<ImportedPdfMeta[]> {
  try {
    const res = await fetch("/api/imported-pdfs", { cache: "no-store" })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export async function deleteImportedPdf(pdfId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/imported-pdfs/${pdfId}`, { method: "DELETE" })
    return res.status === 204 || res.ok
  } catch {
    return false
  }
}

export function importedPdfContentUrl(pdfId: string, opts: { download?: boolean } = {}): string {
  return `/api/imported-pdfs/${pdfId}/content${opts.download ? "?download=true" : ""}`
}

// V5.0.8+ — fetch the parsed CSV result for a persisted PDF.
// Used by "Create AIOs from imported PDFs" to bulk-build AIOs from
// the server-side cached extraction without re-uploading.
export async function getImportedPdfCsvResult(
  pdfId: string,
): Promise<{
  csv_text: string
  headers: string[]
  rows: string[][]
  filename: string
  document_count: number
  page_count: number | null
  chunk_count: number | null
  chunks_failed: number | null
  elapsed_seconds: number
  pdf_id: string
  status: string
  error: string | null
} | null> {
  try {
    const res = await fetch(`/api/imported-pdfs/${pdfId}/csv-result`, { cache: "no-store" })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// V5.0+ — extractPdfToCsv with hard timeout + cancel.
//
// Pre-V5.0 the call had no timeout: a slow Anthropic backend (or a
// hung chunk inside the FastAPI handler) would leave the queue pump
// waiting forever, surfacing as "PDF Import freezing > 6 minutes".
//
// We now layer two protections:
//   1. A caller-provided AbortSignal — wired to a Cancel button in
//      the queue UI so the operator can bail on a stuck file.
//   2. A hard timeoutMs ceiling (default 480s = 8 min) implemented
//      via an internal AbortController combined with the caller's.
//      When the timeout fires we return a structured error rather
//      than a generic null so the UI can render an actionable msg.
export async function extractPdfToCsv(
  file: File,
  opts: { signal?: AbortSignal; timeoutMs?: number; pdfId?: string } = {},
): Promise<PdfExtractResult | { error: string } | null> {
  const timeoutMs = opts.timeoutMs ?? 480_000
  const ac = new AbortController()
  const timeoutId = setTimeout(() => {
    ac.abort(new DOMException("PdfExtractTimeout", "TimeoutError"))
  }, timeoutMs)
  if (opts.signal) {
    if (opts.signal.aborted) ac.abort(opts.signal.reason)
    else opts.signal.addEventListener("abort", () => ac.abort(opts.signal!.reason), { once: true })
  }
  try {
    const formData = new FormData()
    formData.append("file", file)
    if (opts.pdfId) formData.append("pdf_id", opts.pdfId)
    const res = await fetch("/api/op/pdf-extract", {
      method: "POST",
      body: formData,
      signal: ac.signal,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const detail: string = body?.detail ?? body?.error ?? `HTTP ${res.status}`
      return { error: detail }
    }
    return res.json()
  } catch (err) {
    // Distinguish timeout / explicit cancel from generic transport failures
    // so the UI can render the right error block.
    if (err instanceof DOMException) {
      if (err.name === "TimeoutError") {
        return { error: `Extraction exceeded ${Math.round(timeoutMs / 1000)}s — backend may be hung. Retry or break the PDF into smaller files.` }
      }
      if (err.name === "AbortError") {
        return { error: "Cancelled by operator" }
      }
    }
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

// ---------------------------------------------------------------------------
// Image extraction (sibling of extractPdfToCsv)
// ---------------------------------------------------------------------------

export interface ImageExtractResult {
  csv_text: string
  headers: string[]
  rows: string[][]
  document_count: number
  filename: string
  elapsed_seconds?: number
  model?: string
}

// Same hard-timeout + AbortSignal contract as extractPdfToCsv. Default
// 240s ceiling is generous for vision + adaptive thinking; can override
// when web-search is enabled (it iterates and takes longer).
export async function extractImageToCsv(
  file: File,
  opts: {
    signal?: AbortSignal
    timeoutMs?: number
    matchProducts?: boolean
    location?: string
    extraContext?: string
  } = {},
): Promise<ImageExtractResult | { error: string } | null> {
  const timeoutMs = opts.timeoutMs ?? 240_000
  const ac = new AbortController()
  const timeoutId = setTimeout(() => {
    ac.abort(new DOMException("ImageExtractTimeout", "TimeoutError"))
  }, timeoutMs)
  if (opts.signal) {
    if (opts.signal.aborted) ac.abort(opts.signal.reason)
    else opts.signal.addEventListener("abort", () => ac.abort(opts.signal!.reason), { once: true })
  }
  try {
    const formData = new FormData()
    formData.append("file", file)
    if (opts.matchProducts) formData.append("match_products", "true")
    if (opts.location) formData.append("location", opts.location)
    if (opts.extraContext) formData.append("extra_context", opts.extraContext)
    const res = await fetch("/api/op/image-extract", {
      method: "POST",
      body: formData,
      signal: ac.signal,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const detail: string = body?.detail ?? body?.error ?? `HTTP ${res.status}`
      return { error: detail }
    }
    return res.json()
  } catch (err) {
    if (err instanceof DOMException) {
      if (err.name === "TimeoutError") {
        return { error: `Extraction exceeded ${Math.round(timeoutMs / 1000)}s — try a smaller image or disable product matching.` }
      }
      if (err.name === "AbortError") {
        return { error: "Cancelled by operator" }
      }
    }
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

// ---------------------------------------------------------------------------
// Demo Reset / Backup / Restore
// ---------------------------------------------------------------------------

export interface DemoBackupSummary {
  backup_id: string
  tenant_id: string
  name: string
  note: string | null
  counts: Record<string, number>
  created_at: string
  created_by: string | null
}

export interface DemoResetResponse {
  wiped: Record<string, number>
  backup_id: string | null
}

export interface DemoRestoreResponse {
  restored: Record<string, number>
  from_backup_id: string
}

export async function listDemoBackups(): Promise<DemoBackupSummary[]> {
  try {
    const res = await fetch("/api/op/demo-backups", { cache: "no-store" })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export async function createDemoBackup(name: string, note?: string): Promise<DemoBackupSummary | null> {
  try {
    const res = await fetch("/api/op/demo-backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, note: note || null }),
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export async function deleteDemoBackup(backupId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/op/demo-backups/${backupId}`, { method: "DELETE" })
    return res.ok
  } catch {
    return false
  }
}

export async function resetDemoData(opts: {
  create_backup_first: boolean
  backup_name?: string
  backup_note?: string
}): Promise<DemoResetResponse | null> {
  try {
    const res = await fetch("/api/op/demo-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...opts, confirm: "ERASE" }),
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export async function restoreDemoBackup(backupId: string): Promise<DemoRestoreResponse | null> {
  try {
    const res = await fetch(`/api/op/demo-restore/${backupId}`, { method: "POST" })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}
