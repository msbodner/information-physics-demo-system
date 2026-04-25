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

export async function summarizeAIOs(aioTexts: string[]): Promise<{ summary: string; aio_count: number } | null> {
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
}

export async function aioSearchChat(messages: ChatMessage[]): Promise<AioSearchResponse | { error: string } | null> {
  try {
    const res = await fetch("/api/op/aio-search", {
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
  created_at: string
}

export async function listChatStats(limit: number = 5000): Promise<ChatStatRecord[]> {
  return (await safeFetch<ChatStatRecord[]>(`/api/chat-stats?limit=${limit}`)) ?? []
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
export async function listHslData(limit: number = 5000): Promise<HslDataRecord[]> {
  const result = await safeFetch<HslDataRecord[]>(`/api/hsl-data?limit=${limit}`)
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
}

export async function rebuildHslsFromAios(): Promise<RebuildHslsResult | null> {
  return safeFetch<RebuildHslsResult>("/api/hsl-data/rebuild-from-aios", {
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
  created_at: string
  updated_at: string
}

export async function listMroObjects(limit: number = 5000): Promise<MroObject[]> {
  const result = await safeFetch<MroObject[]>(`/api/mro-objects?limit=${limit}`)
  return result ?? []
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

export async function deleteMroObject(id: string): Promise<boolean> {
  const result = await safeFetch<{ deleted: string }>(`/api/mro-objects/${id}`, { method: "DELETE" })
  return result !== null
}

// HSL ↔ MRO Linking

/**
 * Append [MRO.<mroId>] to the next free element slot in the given HSL record.
 * Returns true if the link was written, false if already linked or no free slot.
 */
export async function linkMroToHsl(hslId: string, mroId: string): Promise<boolean> {
  const result = await safeFetch<{ updated: boolean }>(`/api/hsl-data/${hslId}/link-mro`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mro_id: mroId }),
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

// PDF extraction
export interface PdfExtractResult {
  csv_text: string
  headers: string[]
  rows: string[][]
  document_count: number
  filename: string
}

export async function extractPdfToCsv(file: File): Promise<PdfExtractResult | null> {
  try {
    const formData = new FormData()
    formData.append("file", file)
    const res = await fetch("/api/op/pdf-extract", { method: "POST", body: formData })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}
