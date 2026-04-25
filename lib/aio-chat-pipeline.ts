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
  type ChatMessage,
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
     *  as before. */
    hsls?: HslLite[]
    /** When provided, the LLM call streams via SSE and each text chunk is
     *  pushed through this callback. The final reply (full text) is still
     *  returned in the resolved PipelineResult. Useful for incremental UI. */
    onChunk?: (chunk: string) => void
  } = {},
): Promise<PipelineResult | { error: string }> {
  // Step 1 — cue extraction
  const fields = buildFieldVocabulary(aios)
  const vocab = buildValueVocabulary(aios)
  const cues = extractCues(query, fields, vocab)

  // Step 2-3 — use cached MROs if provided, otherwise fetch.
  // The cached payload is expected to be in summary mode (no result_text /
  // context_bundle) — we hydrate just the priors that win the ranking below.
  const priorMroObjects = options.cachedMros
    ?? await listMroObjects(200, { summary: true }).catch(() => [])
  const priorMROs: MRO[] = priorMroObjects
    .map(mroObjectToMRO)
    .filter((m): m is MRO => m !== null)

  // Step 2b — optional HSL boost map (non-gating ranking signal)
  const hslBoost = options.hsls && options.hsls.length > 0
    ? computeHslBoost(cues, options.hsls)
    : undefined

  // Step 2c — collect matched HSL ids so the caller can back-link the new
  // MRO without re-querying the server for a duplicate needle scan.
  const matchedHslIds = options.hsls && options.hsls.length > 0
    ? getMatchedHslIds(cues, options.hsls)
    : []

  const bundle = assembleBundle(cues, aios, priorMROs, {
    maxPriors: options.maxPriors ?? 3,
    maxAios: options.maxAios ?? 50,
    hslBoost,
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
  const bundleText = serializeBundle(bundle)

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
    const errLower = (chatResponse && "error" in chatResponse) ? chatResponse.error.toLowerCase() : ""
    if (errLower.includes("404") || errLower.includes("not found") || errLower.includes("backend_unavailable")) {
      const fallbackMessages: ChatMessage[] = [
        { role: "user", content: "Use the following precomputed substrate as your evidence:\n\n" + bundleText },
        ...messages,
      ]
      chatResponse = await chatWithAIO(fallbackMessages)
    }
    if (!chatResponse) return { error: "Backend unavailable" }
    if ("error" in chatResponse) return { error: chatResponse.error }
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
