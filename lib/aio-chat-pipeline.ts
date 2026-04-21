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
  type ContextBundle,
  type MRO,
  type ScoredMRO,
} from "./aio-math"
import {
  substrateChatWithAIO,
  chatWithAIO,
  createMroObject,
  listMroObjects,
  type ChatMessage,
} from "./api-client"

// ── Types ─────────────────────────────────────────────────────────────

export interface PipelineResult {
  reply: string                 // the model's answer
  bundle: ContextBundle         // what we sent as context
  priors_used: ScoredMRO[]      // MROs surfaced as priors
  mro_saved: boolean            // did we persist a new MRO
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
  } = {},
): Promise<PipelineResult | { error: string }> {
  // Step 1 — cue extraction
  const fields = buildFieldVocabulary(aios)
  const vocab = buildValueVocabulary(aios)
  const cues = extractCues(query, fields, vocab)

  // Step 2-3 — use cached MROs if provided, otherwise fetch
  const priorMroObjects = options.cachedMros ?? await listMroObjects().catch(() => [])
  const priorMROs: MRO[] = priorMroObjects
    .map(mroObjectToMRO)
    .filter((m): m is MRO => m !== null)

  const bundle = assembleBundle(cues, aios, priorMROs, {
    maxPriors: options.maxPriors ?? 3,
    maxAios: options.maxAios ?? 50,
  })

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
  // Falls back to the standard chat endpoint if substrate-chat is not yet
  // deployed on this backend (e.g. during a rolling Railway deploy).
  let chatResponse = await substrateChatWithAIO(messages, bundleText)
  const errLower = (chatResponse && "error" in chatResponse) ? chatResponse.error.toLowerCase() : ""
  if (errLower.includes("404") || errLower.includes("not found") || errLower.includes("backend_unavailable")) {
    // Fallback: inject bundle as the first user message so Claude still sees it
    const fallbackMessages: ChatMessage[] = [
      { role: "user", content: "Use the following precomputed substrate as your evidence:\n\n" + bundleText },
      ...messages,
    ]
    chatResponse = await chatWithAIO(fallbackMessages)
  }
  if (!chatResponse) return { error: "Backend unavailable" }
  if ("error" in chatResponse) return { error: chatResponse.error }

  // Step 6 — persist as MRO
  let mroSaved = false
  if (options.saveMRO !== false) {
    const newMRO = buildMRO({
      query_text: query,
      cue_set: cues,
      bundle,
      result_text: chatResponse.reply,
      model_ref: chatResponse.model_ref,
      confidence: 0.75,
    })
    const payload = mroToCreatePayload(newMRO)
    const saved = await createMroObject(payload).catch(() => null)
    mroSaved = saved !== null
  }

  return {
    reply: chatResponse.reply,
    bundle,
    priors_used: bundle.mro_priors,
    mro_saved: mroSaved,
    model_ref: chatResponse.model_ref,
    input_tokens: chatResponse.input_tokens ?? 0,
    output_tokens: chatResponse.output_tokens ?? 0,
    cost: {
      cues: cues.length,
      neighborhood: bundle.traversal_cost,
      priors: bundle.mro_priors.length,
    },
  }
}
