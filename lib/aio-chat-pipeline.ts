// lib/aio-chat-pipeline.ts
// ─────────────────────────────────────────────────────────────────────────
// High-level Paper-III pipeline: takes a natural-language query, walks the
// full 5-step procedure (extract → traverse → pre-fetch → assemble → capture),
// and returns both the LLM response and the captured MRO.
//
// This is the function ChatAIO calls instead of the raw chat endpoint when
// the user enables "Precomputed Substrate" mode.
// ─────────────────────────────────────────────────────────────────────────

import type { ParsedAio } from "./aio-utils"
import {
  extractCues,
  assembleBundle,
  serializeBundle,
  buildMRO,
  buildValueVocabulary,
  buildFieldVocabulary,
  computeHslBoost,
  collectHslPointerNames,
  getMatchedHslIds,
  type ContextBundle,
  type HslLite,
  type MRO,
  type ScoredMRO,
} from "./aio-math"
import {
  substrateChatWithAIO,
  substrateChatWithAIOStream,
  chatWithAIO,
  createMroObject,
  listMroObjects,
  getMroObject,
  bumpMroTrust,
  mroSearch,
  findAiosByNeedles,
  type ChatMessage,
  type MroSearchHit,
} from "./api-client"

// ── Types ─────────────────────────────────────────────────────────────

export interface PipelineResult {
  reply: string                 // the model's answer
  bundle: ContextBundle         // what we sent as context
  priors_used: ScoredMRO[]      // MROs surfaced as priors
  mro_saved: boolean            // did we persist a new MRO
  mro_id?: string               // UUID of the newly saved MRO (for HSL linking)
  cue_values: string[]          // extracted value strings (for HSL needle search)
  matched_hsl_ids: string[]     // HSL UUIDs that contributed (for in-memory back-link)
  model_ref: string
  input_tokens: number
  output_tokens: number
  cost: {
    cues: number                // |K|
    neighborhood: number        // |N(K)|
    priors: number              // |priors|
  }
}

// ── In-memory MRO adapter ─────────────────────────────────────────────
// The persisted MroObject in the database uses a flat schema; this
// adapter converts between the two.

function mroObjectToMRO(obj: any): MRO | null {
  try {
    const cue_set = typeof obj.search_terms === "string"
      ? JSON.parse(obj.search_terms)
      : (obj.search_terms ?? [])
    return {
      mro_id: obj.mro_id,
      created_at: obj.created_at,
      query_text: obj.query_text,
      cue_set: Array.isArray(cue_set) ? cue_set : [],
      seed_aio_ids: obj.seed_hsls ? obj.seed_hsls.split("|") : [],
      context_aio_raws: obj.context_bundle ? obj.context_bundle.split("\n---\n") : [],
      hsl_names: obj.seed_hsls ? obj.seed_hsls.split("|") : [],
      operators: obj.intent ? [obj.intent] : [],
      result_text: obj.result_text ?? "",
      confidence: typeof obj.confidence === "string"
        ? parseFloat(obj.confidence) || 0.5
        : (obj.confidence ?? 0.5),
      trust_score: typeof obj.trust_score === "number" ? obj.trust_score : 0,
      provenance: {
        model_ref: "claude",
        tenant_id: obj.tenant_id,
        traversal_cost: obj.matched_aios_count ?? 0,
      },
    }
  } catch {
    return null
  }
}

// ── V4.4 — MRO-assisted retrieval thresholds ─────────────────────────
// These are deliberately conservative for the first slice. Tune via
// telemetry once we have hit-rate data per tenant. Exported so callers
// (and tests) can reason about the gating decisions.
//
//   SHORT_CIRCUIT_THRESHOLD: top hit score ≥ this skips the LLM entirely.
//                            0.85 keeps false-positive cache hits low.
//   BUNDLE_AUGMENT_THRESHOLD: top hit score ≥ this gets injected into
//                            the bundle as a "prior episode" hint.
//   CUE_SEED_THRESHOLD:      hits ≥ this contribute their search_terms
//                            to the cue set (cheap, broad).
//   CUE_SEED_TOPK:           how many hits to pull cues from (after threshold).
export const MRO_SHORT_CIRCUIT_THRESHOLD = 0.85
export const MRO_BUNDLE_AUGMENT_THRESHOLD = 0.50
export const MRO_CUE_SEED_THRESHOLD = 0.30
export const MRO_CUE_SEED_TOPK = 3

/** Coerce a stored MRO search_terms blob back into ElementCue[].
 *
 * Tolerant by design — search_terms can arrive as:
 *   - a JSON-stringified array (older writes)
 *   - an array of cue objects (current writes)
 *   - null/undefined/garbage (corrupt or missing)
 * Anything that isn't a `{key, value?, raw?}` shape is skipped.
 *
 * Exported for unit-testability (see lib/__tests__/aio-chat-pipeline.test.ts).
 */
export function searchTermsToCues(raw: unknown): import("./aio-math").ElementCue[] {
  if (!raw) return []
  const arr = Array.isArray(raw)
    ? raw
    : (typeof raw === "string"
        ? (() => { try { return JSON.parse(raw) } catch { return [] } })()
        : [])
  if (!Array.isArray(arr)) return []
  const out: import("./aio-math").ElementCue[] = []
  for (const item of arr) {
    if (!item || typeof item !== "object") continue
    const key = typeof (item as any).key === "string" ? (item as any).key : null
    if (!key) continue
    const value = typeof (item as any).value === "string" ? (item as any).value : undefined
    const rawCue = typeof (item as any).raw === "string"
      ? (item as any).raw
      : (value ? `[${key}.${value}]` : `[${key}.*]`)
    out.push({ key, value, raw: rawCue })
  }
  return out
}

// ── Pure gating helpers (extracted for unit testability) ─────────────

/** Minimal shape we need from MroSearchHit for gating decisions. Lets
 *  the helpers below be tested without dragging in the full api-client
 *  dependency tree. */
export interface MroGatingHit {
  score: number
  result_full_available: boolean
  result_summary?: string
  query_text?: string
  search_terms?: unknown
}

/** Whether the top hit clears the cache short-circuit bar. Pure. */
export function shouldShortCircuitOnMro(
  topHit: MroGatingHit | undefined,
  threshold: number = MRO_SHORT_CIRCUIT_THRESHOLD,
): boolean {
  if (!topHit) return false
  if (!topHit.result_full_available) return false
  return topHit.score >= threshold
}

/** Union extracted cues with cues from the top-K MRO hits whose score
 *  clears the seed threshold. Dedup is by canonical `[Key.Value]` raw
 *  form so cue-extraction collisions don't double-count. Pure. */
export function seedCuesWithMroHits(
  extractedCues: import("./aio-math").ElementCue[],
  mroHits: MroGatingHit[],
  threshold: number = MRO_CUE_SEED_THRESHOLD,
  topK: number = MRO_CUE_SEED_TOPK,
): import("./aio-math").ElementCue[] {
  const seen = new Set(extractedCues.map((c) => c.raw))
  const out = [...extractedCues]
  const eligible = mroHits.filter((h) => h.score >= threshold).slice(0, topK)
  for (const h of eligible) {
    for (const c of searchTermsToCues(h.search_terms)) {
      if (!seen.has(c.raw)) {
        seen.add(c.raw)
        out.push(c)
      }
    }
  }
  return out
}

/** Build the "PRIOR EPISODE" block that's prepended to the bundle when
 *  the top hit clears the augment threshold but not the short-circuit
 *  threshold. Returns null when the hit doesn't qualify. Pure. */
export function buildPriorEpisodeBlock(
  topHit: MroGatingHit | undefined,
  threshold: number = MRO_BUNDLE_AUGMENT_THRESHOLD,
): string | null {
  if (!topHit) return null
  if (topHit.score < threshold) return null
  if (!topHit.result_summary) return null
  return (
    `=== PRIOR EPISODE (similar past query, score=${topHit.score.toFixed(2)}) ===\n` +
    `Past question: ${topHit.query_text ?? ""}\n` +
    `Past answer (truncated): ${topHit.result_summary}\n` +
    `=== END PRIOR EPISODE ===\n\n`
  )
}

function mroToCreatePayload(mro: Omit<MRO, "mro_id" | "created_at">) {
  return {
    mro_key: `mro-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    query_text: mro.query_text,
    intent: mro.operators.join(",") || "lookup",
    seed_hsls: mro.hsl_names.join("|"),
    matched_aios_count: mro.provenance.traversal_cost,
    search_terms: mro.cue_set as unknown as Record<string, unknown>,
    result_text: mro.result_text,
    context_bundle: mro.context_aio_raws.join("\n---\n"),
    confidence: String(mro.confidence),
    policy_scope: "default",
  }
}

// ── Main pipeline ─────────────────────────────────────────────────────

/**
 * Run the full Paper-III pipeline for a single query.
 *
 * Steps:
 *   1. Extract cues from the query using the corpus field/value vocab
 *   2. Traverse HSL neighborhoods (set-intersect of per-cue AIO sets)
 *   3. Pre-fetch ranked MRO priors by Jaccard × freshness × confidence
 *   4. Assemble tiered context bundle and serialize it
 *   5. Call Claude with the bundle as system context
 *   6. Persist the retrieval episode as a new MRO
 */
export async function runChatPipeline(
  query: string,
  aios: ParsedAio[],
  options: {
    maxPriors?: number
    maxAios?: number
    saveMRO?: boolean
    history?: ChatMessage[]
    /** Pre-loaded MRO objects — avoids a network round-trip on every call. */
    cachedMros?: ReturnType<typeof listMroObjects> extends Promise<infer T> ? T : never
    /** Pre-loaded HSL records — when supplied, Substrate uses HSL coverage
     *  as a non-gating ranking boost on the AIO neighborhood (see
     *  computeHslBoost in aio-math). No HSLs = pure AIO-similarity ranking
     *  as before.
     *
     *  Legacy path: pass the full corpus pre-fetched at dialog open.
     *  Preferred V4.4 path: pass ``resolveHsls`` instead and let the
     *  pipeline pull a query-scoped subset after cue extraction. */
    hsls?: HslLite[]
    /** V4.4 P3 — query-time HSL resolver. Called after cue extraction
     *  with the value strings of concrete cues; expected to return only
     *  HSLs whose names contain ≥1 of those values (backed by the
     *  ``information_element_refs`` inverted index server-side). When
     *  supplied and ``hsls`` is not, the pipeline uses the resolved
     *  scope for both the HSL boost and the matched-id back-link. */
    resolveHsls?: (cueValues: string[], signal?: AbortSignal) => Promise<HslLite[]>
    /** V4.4 P3 — pre-loaded (key, value) catalog from HSL names. Tiny
     *  payload (no element columns); used by extractCues to emit
     *  precise-key cues instead of the value-vocab wildcard fallback.
     *  When omitted, the catalog is derived from ``hsls`` if those are
     *  supplied, otherwise extractCues falls through to value vocab. */
    hslCatalog?: Array<{ key: string; value: string }>
    /** When provided, the LLM call streams via SSE and each text chunk is
     *  pushed through this callback. The final reply (full text) is still
     *  returned in the resolved PipelineResult. Useful for incremental UI. */
    onChunk?: (chunk: string) => void
    /** Caller-supplied AbortSignal — when aborted, in-flight MRO lookups
     *  (mroSearch / getMroObject) are cancelled. Submit handlers in
     *  chat-aio-dialog use this to drop a stale request when a new one
     *  starts or the dialog unmounts. */
    signal?: AbortSignal
  } = {},
): Promise<PipelineResult | { error: string }> {
  // ── V4.4 Step 0 — MRO-assisted retrieval (first slice) ────────────
  // Look up similar prior episodes BEFORE we extract cues, so we can:
  //   (a) short-circuit on a near-duplicate and skip the LLM entirely
  //   (b) seed cue extraction with what worked last time
  //   (c) augment the bundle with the top prior's result_summary
  // Best-effort: a backend-unavailable miss falls through to the
  // original pipeline with no behavioral change.
  const mroAssist = await mroSearch(query, { k: 5, summaryChars: 500, signal: options.signal })
    .catch(() => null)
  const mroHits: MroSearchHit[] = mroAssist?.matches ?? []
  const topMroHit: MroSearchHit | undefined = mroHits[0]

  // (a) Cache short-circuit. We only fire when the prior is strong AND
  // the result is hydratable. We deliberately don't double-save: when
  // the cache hits, we bump trust on the source MRO and return its
  // result text. Callers that need a guaranteed fresh save can pass
  // saveMRO:false to indicate "I'll handle persistence" — but the
  // common case (ChatAIO) wants the cache.
  if (shouldShortCircuitOnMro(topMroHit)) {
    const fullPrior = await getMroObject(topMroHit.mro_id, { signal: options.signal }).catch(() => null)
    const replyText = fullPrior?.result_text || topMroHit.result_summary
    if (replyText) {
      // Stream parity: emit the cached reply once for streaming UIs.
      options.onChunk?.(replyText)
      // Reinforcement: bump trust on the MRO we just reused. Best-effort.
      bumpMroTrust([topMroHit.mro_id], 1.0)
        .catch((e) => { console.error("bumpMroTrust failed (cache hit reinforcement)", e) })
      return {
        reply: replyText,
        bundle: {
          mro_priors: [],
          hsl_neighborhoods: [],
          seed_aios: [],
          cue_set: [],
          traversal_cost: 0,
        },
        priors_used: [],
        mro_saved: false,
        mro_id: topMroHit.mro_id,
        cue_values: [],
        matched_hsl_ids: [],
        model_ref: "mro-cache",
        input_tokens: 0,
        output_tokens: 0,
        cost: { cues: 0, neighborhood: 0, priors: 1 },
      }
    }
  }

  // Step 1 — cue extraction
  const fields = buildFieldVocabulary(aios)
  const vocab = buildValueVocabulary(aios)

  // V4.4 P2a — derive an HSL [Key.Value] catalog from the supplied HSL
  // records. HSL names follow the convention "[Key.Value].hsl", so a
  // single regex pass over the names gives extractCues a precise-key
  // catalog to prefer over the value-vocabulary wildcard fallback.
  //
  // V4.4 P3 — prefer an explicit ``hslCatalog`` from the caller (tiny
  // server-paid payload from /v1/hsl-data/key-value-pairs). Fall back to
  // deriving from ``hsls`` for legacy callers that still pre-fetch the
  // full corpus.
  let hslCatalog: Array<{ key: string; value: string }> = []
  if (options.hslCatalog && options.hslCatalog.length > 0) {
    hslCatalog = options.hslCatalog
  } else if (options.hsls && options.hsls.length > 0) {
    const seenKv = new Set<string>()
    const nameRe = /\[([^\].]+)\.([^\]]+)\]/
    for (const hsl of options.hsls) {
      const m = (hsl.hsl_name || "").match(nameRe)
      if (!m) continue
      const k = m[1].trim()
      const v = m[2].trim()
      if (!k || !v) continue
      const kv = `${k.toLowerCase()}\u0000${v.toLowerCase()}`
      if (seenKv.has(kv)) continue
      seenKv.add(kv)
      hslCatalog.push({ key: k, value: v })
    }
  }

  const extractedCues = extractCues(query, fields, vocab, hslCatalog)

  // (b) Cue seeding — union extracted cues with cues from the top-K
  // similar prior MROs. Dedup by canonical raw form ("[Key.Value]").
  // Converts "guess from value vocab" into "what cues did similar past
  // queries actually need."
  const cues = seedCuesWithMroHits(extractedCues, mroHits)

  // Step 2 — resolve the HSL slice for this query.
  //
  // The HSL pointer column (an AIO name list per HSL) is the proper
  // recall path: each cue-matched HSL hands us a tight short list of
  // AIOs to read, sized to the actual relationship — not a pg_trgm
  // text scan over the AIO blob. We resolve HSLs FIRST so we can use
  // their pointers as the primary scope; the needle scan below remains
  // as a safety net for AIOs that no HSL covers.
  //
  // V4.4 P3 — when ``resolveHsls`` is provided, fetch a query-scoped
  // HSL slice (server-side via ``information_element_refs``) instead of
  // relying on a full-corpus preload. Falls back to the legacy
  // ``options.hsls`` path when no resolver is supplied.
  let scopedHsls: HslLite[] = options.hsls ?? []
  if ((!options.hsls || options.hsls.length === 0) && options.resolveHsls) {
    const cueValuesForResolver = cues
      .map((c) => c.value)
      .filter((v): v is string => !!v && v !== "*" && v.length >= 2)
    if (cueValuesForResolver.length > 0) {
      try {
        scopedHsls = await options.resolveHsls(cueValuesForResolver, options.signal)
      } catch {
        scopedHsls = []
      }
    }
  }

  // Step 2a — HSL pointer expansion. Take the union of AIO name pointers
  // across every cue-matched HSL. This is the recall-by-pointer path:
  // when an HSL named [Project_ID.PRJ-003].hsl says "I cover acc_rfis Row
  // 162, acc_issues Row 47, …", those AIOs land in scope regardless of
  // whether the downstream pg_trgm needle scan finds them. Fixes the
  // upstream-saturation bug where high-fanout cues filled the 500-row
  // needle cap with AIA305 and starved the operational CSVs.
  const hslPointerLowerNames = collectHslPointerNames(cues, scopedHsls)

  // Step 2b — needle scan (original V4.4 P0a path), kept as a complement
  // to HSL pointers for cues that have no HSL coverage. The two are
  // unioned below — neither path alone is sufficient on a sparse-HSL
  // corpus, but together they cover the recall surface.
  //
  // Cap stays at 500 server-side; we no longer rely on it as the sole
  // scope so its saturation is no longer fatal.
  const needleStrings = cues
    .flatMap((c) =>
      c.value && c.value !== "*" && c.value.length >= 2
        ? [c.value, `[${c.key}.${c.value}`]
        : [],
    )
    .filter((s, i, a) => a.indexOf(s) === i)
  let needleMatchedNames: string[] | null = null
  if (needleStrings.length > 0 && aios.length > 0) {
    needleMatchedNames = await findAiosByNeedles(needleStrings, 500).catch(() => null)
  }

  // Step 2c — union the two scope sources and filter `aios` to that set.
  // Falls through to the full corpus when both sources came up empty
  // (preserves the original "let traverseHSL apply its ranked-union
  // fallback" behavior on a backend miss).
  let scopedAios: ParsedAio[] = aios
  const scopeNames = new Set<string>(hslPointerLowerNames)
  if (needleMatchedNames) {
    for (const n of needleMatchedNames) scopeNames.add(n.toLowerCase())
  }
  if (scopeNames.size > 0 && aios.length > 0) {
    const filtered = aios.filter((a) => scopeNames.has((a.fileName || "").toLowerCase()))
    if (filtered.length > 0) scopedAios = filtered
  }

  // Step 3 — use cached MROs if provided, otherwise fetch.
  // The cached payload is expected to be in summary mode (no result_text /
  // context_bundle) — we hydrate just the priors that win the ranking below.
  const priorMroObjects = options.cachedMros
    ?? await listMroObjects(200, { summary: true }).catch(() => [])
  const priorMROs: MRO[] = priorMroObjects
    .map(mroObjectToMRO)
    .filter((m): m is MRO => m !== null)

  const hslBoost = scopedHsls.length > 0
    ? computeHslBoost(cues, scopedHsls)
    : undefined

  // Step 2c — collect matched HSL ids so the caller can back-link the new
  // MRO without re-querying the server for a duplicate needle scan.
  const matchedHslIds = scopedHsls.length > 0
    ? getMatchedHslIds(cues, scopedHsls)
    : []

  const bundle = assembleBundle(cues, scopedAios, priorMROs, {
    maxPriors: options.maxPriors ?? 3,
    maxAios: options.maxAios ?? 50,
    hslBoost,
    // P0b — when we have HSL coverage, treat membership as a hard filter,
    // not just a soft boost. assembleBundle falls back gracefully when
    // gating would empty the neighborhood.
    hslGate: !!hslBoost,
    queryText: query,
  })

  // Step 3b — hydrate the picked priors. They came from a summary fetch
  // (empty result_text), so before serializing we pull the full record
  // for just the top-K that survived ranking. ≤ maxPriors round-trips,
  // run in parallel, ~80% smaller dialog-open payload as a tradeoff.
  if (bundle.mro_priors.length > 0) {
    const needHydrate = bundle.mro_priors.filter((p) => !p.mro.result_text)
    if (needHydrate.length > 0) {
      await Promise.all(needHydrate.map(async (sp) => {
        const full = await getMroObject(sp.mro.mro_id).catch(() => null)
        if (!full) return
        sp.mro.result_text = full.result_text ?? ""
        sp.mro.context_aio_raws = full.context_bundle
          ? full.context_bundle.split("\n---\n")
          : sp.mro.context_aio_raws
      }))
    }
  }

  // Step 4 — serialize the bundle; it becomes the SOLE system context via
  // /v1/op/substrate-chat (which does NOT add a raw DB dump — unlike /v1/op/chat)
  let bundleText = serializeBundle(bundle)

  // (c) Bundle augmentation — when the top MRO hit clears the augment
  // threshold but is below the short-circuit threshold, prepend its
  // result_summary as a "PRIOR EPISODE" hint. Pulls Claude toward
  // consistent answers across sessions without trusting the prior
  // verbatim. Cheap (≤500 chars) and high signal.
  const priorBlock = buildPriorEpisodeBlock(topMroHit)
  if (priorBlock) {
    bundleText = priorBlock + bundleText
  }

  // Only send conversation history + the current query as messages.
  // The bundle is passed separately as context_bundle to the substrate endpoint.
  const messages: ChatMessage[] = [
    ...(options.history ?? []),
    { role: "user", content: query },
  ]

  // Step 5 — call Claude via the substrate endpoint (no DB context injection).
  // Streaming path: when the caller supplied onChunk, use SSE so the UI
  // can render tokens as they arrive. The final reply text is rebuilt
  // from the chunks; usage counts come from the trailing meta event.
  let chatReply: string
  let chatModel = "claude-sonnet-4-6"
  let chatInTok = 0
  let chatOutTok = 0
  if (options.onChunk) {
    let acc = ""
    let metaIn = 0
    let metaOut = 0
    let metaModel = "claude-sonnet-4-6"
    let errMsg: string | null = null
    await substrateChatWithAIOStream(messages, bundleText, {
      onText: (c) => { acc += c; options.onChunk!(c) },
      onMeta: (m) => { metaIn = m.input_tokens; metaOut = m.output_tokens; metaModel = m.model_ref },
      onError: (e) => { errMsg = e },
    }).catch((e) => { errMsg = String(e) })
    if (errMsg) return { error: errMsg }
    chatReply = acc
    chatInTok = metaIn
    chatOutTok = metaOut
    chatModel = metaModel
  } else {
    // Non-streaming path. Falls back to the standard chat endpoint if
    // substrate-chat is not yet deployed (e.g. rolling Railway deploy).
    let chatResponse = await substrateChatWithAIO(messages, bundleText)
    // Defensive: backend errors can come back as plain strings (404 from
    // a rolling deploy) or as JSON envelopes (budget exceeded:
    // {error, message, used_today, limit, ...}). Coerce to a single
    // lowercase string before pattern-matching for the fallback trigger.
    const errStr =
      (chatResponse && "error" in chatResponse)
        ? (typeof chatResponse.error === "string"
            ? chatResponse.error
            : JSON.stringify(chatResponse.error))
        : ""
    const errLower = errStr.toLowerCase()
    if (errLower.includes("404") || errLower.includes("not found") || errLower.includes("backend_unavailable")) {
      const fallbackMessages: ChatMessage[] = [
        { role: "user", content: "Use the following precomputed substrate as your evidence:\n\n" + bundleText },
        ...messages,
      ]
      chatResponse = await chatWithAIO(fallbackMessages)
    }
    if (!chatResponse) return { error: "Backend unavailable" }
    if ("error" in chatResponse) return { error: errStr }
    chatReply = chatResponse.reply
    chatModel = chatResponse.model_ref
    chatInTok = chatResponse.input_tokens ?? 0
    chatOutTok = chatResponse.output_tokens ?? 0
  }

  // Step 6 — persist as MRO
  let mroSaved = false
  let savedMroId: string | undefined
  if (options.saveMRO !== false) {
    const newMRO = buildMRO({
      query_text: query,
      cue_set: cues,
      bundle,
      result_text: chatReply,
      model_ref: chatModel,
      confidence: 0.75,
    })
    const payload = mroToCreatePayload(newMRO)
    const saved = await createMroObject(payload).catch(() => null)
    mroSaved = saved !== null
    savedMroId = saved?.mro_id ?? undefined

    // Reinforcement: bump trust_score on every prior that contributed to
    // this answer. Best-effort — a failed bump never blocks the save.
    if (mroSaved && bundle.mro_priors.length > 0) {
      const parentIds = bundle.mro_priors
        .map((p) => p.mro.mro_id)
        .filter((id): id is string => !!id)
      if (parentIds.length > 0) {
        bumpMroTrust(parentIds, 1.0)
          .catch((e) => { console.error("bumpMroTrust failed (prior reinforcement)", e) })
      }
    }
  }

  // Collect cue values for downstream HSL needle-matching
  const cueValues = cues
    .map((c) => c.value)
    .filter((v): v is string => !!v && v !== "*" && v.length >= 3)

  return {
    reply: chatReply,
    bundle,
    priors_used: bundle.mro_priors,
    mro_saved: mroSaved,
    mro_id: savedMroId,
    cue_values: cueValues,
    matched_hsl_ids: matchedHslIds,
    model_ref: chatModel,
    input_tokens: chatInTok,
    output_tokens: chatOutTok,
    cost: {
      cues: cues.length,
      neighborhood: bundle.traversal_cost,
      priors: bundle.mro_priors.length,
    },
  }
}
