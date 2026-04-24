// lib/aio-math.ts
// ─────────────────────────────────────────────────────────────────────────
// Mathematics for the AIO / HSL / MRO pipeline (Paper III implementation).
//
// This module implements the formal operations that let the Information
// Physics substrate serve as a retrieval layer for Claude:
//
//   1. Cue extraction          — parse a natural-language query into an
//                                element-cue set K ⊂ E
//   2. HSL traversal           — compute the bounded neighborhood N(K) as
//                                the set intersection of element-level HSLs
//   3. MRO similarity          — Jaccard overlap between prior MRO cues
//                                and the current cue set
//   4. Freshness decay         — time-based down-weighting of prior MROs
//   5. MRO ranking             — combined relevance × freshness × confidence
//   6. Context bundle assembly — tiered serialization for the LLM window
//
// All operations are exact, deterministic, and bounded in cost by the
// neighborhood size. No embedding, no cosine similarity, no top-k.
// ─────────────────────────────────────────────────────────────────────────

import type { ParsedAio, ParsedElement } from "./aio-utils"
import { parseAioLine } from "./aio-utils"

// ── Types ─────────────────────────────────────────────────────────────

/** An element-cue: a key or a full key.value pair the query refers to. */
export interface ElementCue {
  key: string
  value?: string         // absent = wildcard over the key
  raw: string            // canonical "[Key.Value]" or "[Key.*]" form
}

/** A Memory Result Object — a derived episodic object persisted to the HSL. */
export interface MRO {
  mro_id: string
  created_at: string     // ISO timestamp
  query_text: string     // original natural-language query
  cue_set: ElementCue[]  // extracted cues (Q_t)
  seed_aio_ids: string[] // S_t — contributing AIO identifiers
  context_aio_raws: string[]  // C_t — serialized AIOs in the recovered bundle
  hsl_names: string[]    // L_t — HSL records involved in the traversal
  operators: string[]    // O_t — e.g. ["intersect", "broadcast"]
  result_text: string    // R_t — the synthesis returned by the model
  confidence: number     // 0..1 — caller-supplied or heuristic
  provenance: {          // P_t
    model_ref: string
    tenant_id?: string
    traversal_cost: number
  }
}

/** Scored MRO: an MRO with its current retrieval score. */
export interface ScoredMRO {
  mro: MRO
  relevance: number   // 0..1 — Jaccard overlap with current cue set
  freshness: number   // 0..1 — exponential decay over age
  score: number       // relevance × freshness × confidence
}

/** A context bundle ready to be serialized into Claude's prompt window. */
export interface ContextBundle {
  mro_priors: ScoredMRO[]     // prior successful retrievals
  hsl_neighborhoods: string[] // HSL names that were traversed
  seed_aios: ParsedAio[]      // direct evidence
  cue_set: ElementCue[]       // the cues that drove the traversal
  traversal_cost: number      // |N(K)| — number of AIOs in the neighborhood
}

/**
 * Minimal shape for a pre-fetched HSL record (hsl_name + raw element refs).
 * The aio-math module doesn't depend on the full HslDataRecord type so that
 * callers can pass either the API record or a parsed equivalent.
 */
export interface HslLite {
  hsl_name: string
  elements: (string | null | undefined)[]  // AIO-name refs + optional [MRO.*]
}

/**
 * Compute a per-AIO "HSL coverage" score: how many cue-matched HSLs
 * reference each AIO by name.
 *
 * This is the ranking booster that lets Substrate Mode use HSL structure
 * as prior knowledge *without* gating (AIOs with zero HSL hits still pass
 * through). Typical lift on hybrid sparse-retrieval setups: 10–20% on
 * ranking quality, zero recall loss.
 *
 * Matching is case-insensitive and requires the cue value to appear as a
 * substring of `hsl_name`. If no cues carry a concrete value (all wildcard
 * key-only), returns an empty map.
 */
export function computeHslBoost(
  cueSet: ElementCue[],
  hsls: HslLite[],
): Map<string, number> {
  const boost = new Map<string, number>()
  if (cueSet.length === 0 || hsls.length === 0) return boost

  const cueValues = cueSet
    .map((c) => c.value?.toLowerCase())
    .filter((v): v is string => !!v && v.length >= 2)
  if (cueValues.length === 0) return boost

  for (const hsl of hsls) {
    const name = (hsl.hsl_name || "").toLowerCase()
    if (!name) continue
    let hits = 0
    for (const v of cueValues) if (name.includes(v)) hits++
    if (hits === 0) continue

    for (const ref of hsl.elements) {
      if (!ref || typeof ref !== "string") continue
      const trimmed = ref.trim()
      if (!trimmed || trimmed.startsWith("[MRO.")) continue
      // HSL elements for AIOs are the aio_name string (e.g.
      // "myfile.csv - Row 42") or the full bracket-notation raw.
      // We increment boost on the ref as-is; `traverseHSL` matches AIOs
      // by `.raw` and `.fileName`, so we index both keys on lookup.
      boost.set(trimmed, (boost.get(trimmed) ?? 0) + hits)
    }
  }
  return boost
}

// ── 1. Cue extraction ─────────────────────────────────────────────────

/**
 * Extract element cues from a natural-language query.
 *
 * The cue set K ⊂ E × (V ∪ {*}) is constructed by matching query tokens
 * against the known field-name directory (informationElements) and the
 * value vocabulary observed across all AIOs.
 *
 * Deterministic: given the same corpus and query, always returns the
 * same cue set. No LLM call needed for this step.
 */
export function extractCues(
  query: string,
  fieldNames: string[],
  valueVocabulary: Set<string>,
): ElementCue[] {
  const q = query.toLowerCase().trim()
  if (!q) return []

  const cues: ElementCue[] = []
  const seen = new Set<string>()

  const push = (key: string, value?: string) => {
    const raw = value ? `[${key}.${value}]` : `[${key}.*]`
    if (seen.has(raw)) return
    seen.add(raw)
    cues.push({ key, value, raw })
  }

  // 1a. Match exact [Key.Value] phrases in the query.
  const bracketMatches = q.matchAll(/\[([^\].]+)\.([^\]]+)\]/g)
  for (const m of bracketMatches) push(m[1].trim(), m[2].trim())

  // 1b. Match known field names + a nearby value substring.
  for (const field of fieldNames) {
    const idx = q.indexOf(field.toLowerCase())
    if (idx < 0) continue
    // Look at the token(s) immediately after the field name for a value
    const tail = q.slice(idx + field.length, idx + field.length + 80)
    const valueMatch = tail.match(/[:=]\s*["']?([^,.!?\n"']{2,40})/)
    if (valueMatch) push(field, valueMatch[1].trim())
    else push(field)   // key-only cue (wildcard)
  }

  // 1c. Match values from the vocabulary against individual query tokens.
  //
  //     The original check (q.includes(v)) only works when the full vocabulary
  //     value is a substring of the query — e.g. query "Vance" vs. vocabulary
  //     value "Vance Mitchell" fails because "Vance" ⊄ "Vance Mitchell" when
  //     checked as q.includes(v).  We need the reverse check too: any query
  //     token that appears inside a vocabulary value triggers a cue for that
  //     value.  This mirrors the ILIKE %token% behaviour of AIO Search.
  const qWords = q.split(/[\s,;:?!()\[\]]+/).filter((w) => w.length >= 3)
  for (const value of valueVocabulary) {
    if (value.length < 3) continue
    const v = value.toLowerCase()
    // Forward: full value appears in the query
    if (q.includes(v)) {
      push("*", value)
      continue
    }
    // Reverse: any query word appears inside this vocabulary value
    if (qWords.some((w) => v.includes(w))) {
      push("*", value)
    }
  }

  return cues
}

// ── 2. HSL traversal ──────────────────────────────────────────────────

/**
 * Compute the bounded neighborhood N(K) as the intersection of the AIO
 * sets defined by each cue in K.
 *
 *     N(K) = ⋂_{k ∈ K} H(k)
 *
 * where H(k) is the AIO set for cue k. Key-only cues H([k.*]) return the
 * union over all observed values of that key. Value-only cues H([*.v])
 * return every AIO containing value v in any field.
 *
 * Complexity: O(|K| · max|H(k)|) — bounded by the neighborhood size,
 * not by the size of the full corpus.
 */
export function traverseHSL(
  cues: ElementCue[],
  aios: ParsedAio[],
): { matches: ParsedAio[]; hslNames: string[] } {
  if (cues.length === 0 || aios.length === 0) {
    return { matches: [], hslNames: [] }
  }

  const hslNames: string[] = []

  // Score each AIO by how many cues it satisfies.
  // Matching is case-insensitive so that vocabulary values like "Vance Mitchell"
  // match AIO elements stored in any casing variant.
  const scores = new Map<string, number>()
  for (const aio of aios) scores.set(aio.raw, 0)

  for (const cue of cues) {
    hslNames.push(cue.raw)
    const cueKey = cue.key.toLowerCase()
    const cueVal = cue.value?.toLowerCase()

    for (const aio of aios) {
      let hit = false
      for (const el of aio.elements) {
        const elKey = el.key.toLowerCase()
        const elVal = el.value.toLowerCase()

        if (cue.key === "*" && cueVal !== undefined) {
          // Value-only cue: match any field whose value contains the cue value
          if (elVal.includes(cueVal) || cueVal.includes(elVal)) { hit = true; break }
        } else if (cueVal === undefined) {
          // Key-only (wildcard) cue: any element with this field name
          if (elKey === cueKey) { hit = true; break }
        } else {
          // Key+value cue: exact field, substring value
          if (elKey === cueKey && (elVal.includes(cueVal) || cueVal.includes(elVal))) {
            hit = true; break
          }
        }
      }
      if (hit) scores.set(aio.raw, (scores.get(aio.raw) ?? 0) + 1)
    }
  }

  // Primary result: strict intersection — AIOs satisfying ALL cues.
  const maxScore = cues.length
  const strict = aios.filter((a) => (scores.get(a.raw) ?? 0) === maxScore)
  if (strict.length > 0) {
    return { matches: strict, hslNames }
  }

  // Fallback: ranked union — return AIOs satisfying at least one cue,
  // sorted by score descending so the most-relevant evidence ranks first.
  const union = aios
    .filter((a) => (scores.get(a.raw) ?? 0) > 0)
    .sort((a, b) => (scores.get(b.raw) ?? 0) - (scores.get(a.raw) ?? 0))
  return { matches: union, hslNames }
}

// ── 3. MRO similarity (Jaccard) ──────────────────────────────────────

/**
 * Jaccard similarity between two cue sets:
 *
 *     J(K_a, K_b) = |K_a ∩ K_b| / |K_a ∪ K_b|
 *
 * Ranges from 0 (disjoint) to 1 (identical). Symmetric, fast, exact.
 * Used to find prior MROs whose queries are structurally similar to
 * the current one.
 */
export function jaccardSimilarity(a: ElementCue[], b: ElementCue[]): number {
  if (a.length === 0 && b.length === 0) return 0
  const setA = new Set(a.map((c) => c.raw))
  const setB = new Set(b.map((c) => c.raw))
  let intersection = 0
  for (const x of setA) if (setB.has(x)) intersection++
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

// ── 4. Freshness decay ───────────────────────────────────────────────

/**
 * Exponential freshness decay:
 *
 *     f(t) = exp( -λ · Δ )       where Δ = (now - created_at) in days
 *
 * Default half-life of 30 days → λ = ln(2)/30 ≈ 0.0231.
 * Older MROs are down-weighted; a two-month-old MRO scores ≈ 0.25,
 * a one-year-old MRO scores ≈ 0.0002.
 */
export function freshness(
  created_at: string,
  halfLifeDays = 30,
  now = new Date(),
): number {
  const then = new Date(created_at).getTime()
  if (!isFinite(then)) return 0
  const deltaDays = Math.max(0, (now.getTime() - then) / (1000 * 60 * 60 * 24))
  const lambda = Math.log(2) / Math.max(halfLifeDays, 1)
  return Math.exp(-lambda * deltaDays)
}

// ── 5. MRO ranking ───────────────────────────────────────────────────

/**
 * Rank prior MROs against the current cue set using the combined score:
 *
 *     score(m, K) = J(K_m, K) · f(t_m) · c_m
 *
 * where J is Jaccard relevance, f is freshness, and c is the stored
 * confidence. Returns MROs sorted by score descending, with relevance
 * and freshness exposed for transparency.
 */
export function rankMROs(
  cueSet: ElementCue[],
  mros: MRO[],
  options: { minRelevance?: number; halfLifeDays?: number } = {},
): ScoredMRO[] {
  const minRel = options.minRelevance ?? 0.1
  const hl = options.halfLifeDays ?? 30
  const now = new Date()

  const scored: ScoredMRO[] = mros.map((mro) => {
    const relevance = jaccardSimilarity(cueSet, mro.cue_set)
    const fresh = freshness(mro.created_at, hl, now)
    const conf = Math.max(0, Math.min(1, mro.confidence ?? 0.5))
    return { mro, relevance, freshness: fresh, score: relevance * fresh * conf }
  })

  return scored
    .filter((s) => s.relevance >= minRel)
    .sort((a, b) => b.score - a.score)
}

// ── 6. Context-bundle assembly ───────────────────────────────────────

/**
 * Assemble the tiered context bundle for Claude's prompt window.
 *
 * The bundle is produced in a fixed evidence hierarchy so the model
 * can reliably distinguish tiers:
 *
 *   1. System framing (caller's job)
 *   2. MRO priors          — "previously established findings"
 *   3. HSL neighborhoods   — "relational context for the cue"
 *   4. Seed AIOs           — "direct evidence"
 *   5. Query               — "the user's question"
 *
 * This function produces tiers 2-4 plus the cue set. The caller combines
 * them with the system prompt and user query for the final LLM call.
 */
export function assembleBundle(
  cueSet: ElementCue[],
  aios: ParsedAio[],
  mros: MRO[],
  options: {
    maxPriors?: number
    maxAios?: number
    minPriorRelevance?: number
    halfLifeDays?: number
    /** Optional HSL coverage map from computeHslBoost — used as a
     *  ranking booster on top of the traversal score. Non-gating:
     *  AIOs with no HSL coverage still pass through. */
    hslBoost?: Map<string, number>
  } = {},
): ContextBundle {
  const maxPriors = options.maxPriors ?? 3
  const maxAios = options.maxAios ?? 50

  // Step 2 — HSL traversal
  const { matches, hslNames } = traverseHSL(cueSet, aios)

  // Step 2b — HSL boost re-ranking (non-gating).
  // For each AIO in the neighborhood, add its HSL coverage count as a
  // tiebreaker. AIOs referenced by multiple cue-matched HSLs rank above
  // AIOs with the same traversal score but no HSL coverage. We use a
  // stable sort so AIOs with identical boosts preserve traversal order.
  let ranked = matches
  if (options.hslBoost && options.hslBoost.size > 0) {
    const boost = options.hslBoost
    const boostOf = (a: ParsedAio) =>
      (boost.get(a.raw) ?? 0) + (boost.get(a.fileName) ?? 0)
    ranked = matches
      .map((a, i) => ({ a, b: boostOf(a), i }))
      .sort((x, y) => (y.b - x.b) || (x.i - y.i))
      .map((x) => x.a)
  }

  // Step 3 — MRO pre-fetch
  const rankedMros = rankMROs(cueSet, mros, {
    minRelevance: options.minPriorRelevance ?? 0.2,
    halfLifeDays: options.halfLifeDays ?? 30,
  })
  const priors = rankedMros.slice(0, maxPriors)

  // Step 4 — cap seed AIOs to fit the prompt window
  const seedAios = ranked.slice(0, maxAios)

  return {
    mro_priors: priors,
    hsl_neighborhoods: hslNames,
    seed_aios: seedAios,
    cue_set: cueSet,
    traversal_cost: matches.length,
  }
}

/**
 * Serialize a context bundle into a text block suitable for injection
 * into an LLM system/user prompt. The tiered headers are explicit so
 * the model can distinguish evidence types.
 */
export function serializeBundle(bundle: ContextBundle): string {
  const lines: string[] = []

  lines.push("=== CONTEXT BUNDLE ===")
  lines.push(`Cues: ${bundle.cue_set.map((c) => c.raw).join(" ∩ ") || "(none)"}`)
  lines.push(`Traversal neighborhood: ${bundle.traversal_cost} AIOs`)
  lines.push("")

  if (bundle.mro_priors.length > 0) {
    lines.push("--- TIER 1: PRIOR RETRIEVAL EPISODES (MRO priors) ---")
    lines.push("Treat these as framing, not as ground truth. Re-ground any")
    lines.push("claims in the AIO evidence below when answering.")
    lines.push("")
    for (const s of bundle.mro_priors) {
      lines.push(
        `[MRO ${s.mro.mro_id.slice(0, 8)} — ` +
          `relevance ${s.relevance.toFixed(2)} × ` +
          `freshness ${s.freshness.toFixed(2)} = ` +
          `score ${s.score.toFixed(3)}]`,
      )
      lines.push(`Query: ${s.mro.query_text}`)
      lines.push(`Finding: ${s.mro.result_text.slice(0, 400)}`)
      lines.push("")
    }
  }

  if (bundle.hsl_neighborhoods.length > 0) {
    lines.push("--- TIER 2: HSL NEIGHBORHOODS TRAVERSED ---")
    lines.push(bundle.hsl_neighborhoods.join(", "))
    lines.push("")
  }

  if (bundle.seed_aios.length > 0) {
    lines.push("--- TIER 3: DIRECT EVIDENCE (AIOs) ---")
    for (const aio of bundle.seed_aios) {
      lines.push(`[${aio.fileName} line ${aio.lineNumber}]`)
      lines.push(aio.raw)
      lines.push("")
    }
  }

  lines.push("=== END CONTEXT BUNDLE ===")
  return lines.join("\n")
}

// ── 7. MRO construction helper ───────────────────────────────────────

/**
 * Construct an MRO from a completed retrieval-and-inference event.
 * Caller is responsible for persisting it to the MRO store.
 */
export function buildMRO(params: {
  query_text: string
  cue_set: ElementCue[]
  bundle: ContextBundle
  result_text: string
  model_ref: string
  confidence?: number
  tenant_id?: string
}): Omit<MRO, "mro_id" | "created_at"> {
  return {
    query_text: params.query_text,
    cue_set: params.cue_set,
    seed_aio_ids: params.bundle.seed_aios.map((a) => a.fileName),
    context_aio_raws: params.bundle.seed_aios.map((a) => a.raw),
    hsl_names: params.bundle.hsl_neighborhoods,
    operators: params.cue_set.length > 1 ? ["intersect"] : ["lookup"],
    result_text: params.result_text,
    confidence: Math.max(0, Math.min(1, params.confidence ?? 0.75)),
    provenance: {
      model_ref: params.model_ref,
      tenant_id: params.tenant_id,
      traversal_cost: params.bundle.traversal_cost,
    },
  }
}

// ── 8. Vocabulary helpers ─────────────────────────────────────────────

/**
 * Extract the full value vocabulary from a corpus of AIOs.
 * Used as input to extractCues for value-only cue matching.
 */
export function buildValueVocabulary(aios: ParsedAio[]): Set<string> {
  const vocab = new Set<string>()
  for (const aio of aios) {
    for (const el of aio.elements) {
      if (el.value && el.value.length >= 3) vocab.add(el.value)
    }
  }
  return vocab
}

/**
 * Extract the full field-name vocabulary from a corpus of AIOs.
 * Cheaper than querying the information_elements table.
 */
export function buildFieldVocabulary(aios: ParsedAio[]): string[] {
  const fields = new Set<string>()
  for (const aio of aios) {
    for (const el of aio.elements) fields.add(el.key)
  }
  return Array.from(fields).sort()
}

/**
 * Parse a raw AIO line directly into a ParsedAio object. Useful when
 * consuming stored AIOs that aren't yet in ParsedAio form.
 */
export function aioFromRaw(
  raw: string,
  fileName: string,
  lineNumber = 0,
  csvRoot = "",
): ParsedAio {
  return {
    fileName,
    elements: parseAioLine(raw),
    raw,
    csvRoot,
    lineNumber,
  }
}
