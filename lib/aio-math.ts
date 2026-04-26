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
  /** Reinforcement signal: incremented each time this MRO is reused as
   *  a prior. Higher trust ⇒ historically useful prior ⇒ lifted in the
   *  ranking even when its Jaccard overlap is comparable to a stranger.
   *  Defaults to 0 for legacy / freshly persisted MROs. */
  trust_score?: number
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
  textSim: number     // 0..1 — tsvector-style overlap on query_text tokens
  freshness: number   // 0..1 — exponential decay over age
  trustBoost: number  // 1..N — log-scaled multiplier from trust_score
  score: number       // (max(relevance, textSim)) × freshness × confidence × trustBoost
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
  /** Optional UUID — when present, getMatchedHslIds() can return ids
   *  for back-linking newly-saved MROs into the same HSLs that fed
   *  the substrate retrieval. */
  hsl_id?: string
}

/**
 * Return the HSL ids whose names contain at least one cue value.
 *
 * Mirrors the substring-match logic of computeHslBoost so callers can
 * back-link a newly-saved MRO into exactly the HSLs that contributed to
 * the bundle — without round-tripping the server for a duplicate
 * needle scan (avoids the 100-column ILIKE re-hit that
 * /v1/hsl-data/find-by-needles otherwise performs).
 *
 * Only HSLs that supply an `hsl_id` are considered.
 */
export function getMatchedHslIds(
  cueSet: ElementCue[],
  hsls: HslLite[],
): string[] {
  if (cueSet.length === 0 || hsls.length === 0) return []
  const cueValues = cueSet
    .map((c) => c.value?.toLowerCase())
    .filter((v): v is string => !!v && v.length >= 2)
  if (cueValues.length === 0) return []
  const out: string[] = []
  for (const hsl of hsls) {
    if (!hsl.hsl_id) continue
    const name = (hsl.hsl_name || "").toLowerCase()
    if (!name) continue
    if (cueValues.some((v) => name.includes(v))) out.push(hsl.hsl_id)
  }
  return out
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
  /**
   * V4.4 P2a — optional catalog of known (Key, Value) pairs sourced from
   * the HSL topology. When provided, vocabulary matches that also appear
   * in the catalog are emitted with their concrete key (rather than the
   * `*` wildcard). This converts "value seen somewhere in some AIO" into
   * "value seen on this specific field in this HSL", which lets
   * traverseHSL prune to the intended field rather than scoring every
   * field whose value happens to contain the substring.
   */
  hslKeyValuePairs?: Array<{ key: string; value: string }>,
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

  // 1b'. HSL catalog match — when we have a list of known (Key, Value)
  // pairs from the HSL topology, emit precise cues for any catalog entry
  // whose value appears in the query (forward or reverse word match).
  // This is more selective than the vocab fallback below because it
  // carries the original key rather than collapsing to `*`.
  const catalogValues = new Set<string>()
  if (hslKeyValuePairs && hslKeyValuePairs.length > 0) {
    const qWordsLocal = q.split(/[\s,;:?!()\[\]]+/).filter((w) => w.length >= 3)
    for (const pair of hslKeyValuePairs) {
      const v = (pair.value ?? "").toLowerCase()
      if (v.length < 3) continue
      const forward = q.includes(v)
      const reverse = !forward && qWordsLocal.some((w) => v.includes(w))
      if (!forward && !reverse) continue
      push(pair.key, pair.value)
      catalogValues.add(v)
    }
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
    // Skip values already captured by the HSL catalog with a precise key —
    // we don't want to add a `[*.value]` wildcard that duplicates the
    // already-emitted `[Key.value]` cue.
    if (catalogValues.has(v)) continue
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

const _MRO_STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "of", "to", "in", "on", "at", "for", "by", "with", "from", "and", "or",
  "but", "as", "if", "then", "than", "this", "that", "these", "those",
  "it", "its", "what", "who", "when", "where", "why", "how", "show", "me",
])

/** Cheap query-text tokenizer mirroring chat.py's _tokenize_query: lowercase,
 *  alnum-only, drop stopwords and tokens shorter than 3 chars. Used as the
 *  text-similarity feature so paraphrases ("revenue" vs "income") that share
 *  no `[Key.Value]` cues can still surface relevant priors. */
function tokenizeQuery(text: string): Set<string> {
  if (!text) return new Set()
  const out = new Set<string>()
  for (const tok of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (tok.length < 3) continue
    if (_MRO_STOPWORDS.has(tok)) continue
    out.add(tok)
  }
  return out
}

function jaccardTokens(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

/**
 * Rank prior MROs against the current cue set using the combined score:
 *
 *     relevance = max(J(K_m, K), J_tok(Q_m, Q))         // structural ∪ textual
 *     trustBoost = 1 + ln(1 + trust_score)              // log-scaled, never zero
 *     score(m, K) = relevance · f(t_m) · c_m · trustBoost
 *
 * The textual term lets paraphrases ("show me revenue" vs "what was income")
 * score above zero when their cue sets share no exact tokens. The trust boost
 * is gradient reinforcement — priors that have been useful before drift up
 * the ranking; priors that never get reused stay flat.
 */
export function rankMROs(
  cueSet: ElementCue[],
  mros: MRO[],
  options: {
    minRelevance?: number
    halfLifeDays?: number
    /** Current natural-language query. When supplied, enables tsvector-style
     *  text similarity against each MRO's query_text. */
    queryText?: string
  } = {},
): ScoredMRO[] {
  const minRel = options.minRelevance ?? 0.1
  const hl = options.halfLifeDays ?? 30
  const now = new Date()
  const queryTokens = options.queryText ? tokenizeQuery(options.queryText) : new Set<string>()

  const scored: ScoredMRO[] = mros.map((mro) => {
    const relevance = jaccardSimilarity(cueSet, mro.cue_set)
    const textSim = queryTokens.size > 0
      ? jaccardTokens(queryTokens, tokenizeQuery(mro.query_text))
      : 0
    const fresh = freshness(mro.created_at, hl, now)
    const conf = Math.max(0, Math.min(1, mro.confidence ?? 0.5))
    const trust = Math.max(0, mro.trust_score ?? 0)
    const trustBoost = 1 + Math.log(1 + trust)
    const blended = Math.max(relevance, textSim)
    return {
      mro,
      relevance,
      textSim,
      freshness: fresh,
      trustBoost,
      score: blended * fresh * conf * trustBoost,
    }
  })

  return scored
    .filter((s) => Math.max(s.relevance, s.textSim) >= minRel)
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
     *  ranking booster on top of the traversal score. Non-gating
     *  by default; pass `hslGate: true` to also filter out AIOs with
     *  zero HSL coverage. */
    hslBoost?: Map<string, number>
    /**
     * V4.4 P0b — when true and `hslBoost` is supplied, AIOs whose HSL
     * coverage is zero are dropped from the bundle. Promotes HSL
     * membership from a soft ranking signal to a hard recall filter.
     * Falls back gracefully: if the gate would empty the neighborhood,
     * the original boosted-but-unfiltered set is returned so the model
     * still has *some* evidence to work with.
     */
    hslGate?: boolean
    /** Original natural-language query — threaded through to rankMROs so
     *  the text-similarity feature lights up on paraphrases. */
    queryText?: string
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
    // P0b — promote HSL coverage from boost to gate. Drop zero-coverage
    // AIOs; if that would empty the neighborhood, keep the boosted set
    // so the model still has evidence (graceful fallback over silent
    // false-zero recall on tenants with sparse HSL topology).
    if (options.hslGate) {
      const gated = ranked.filter((a) => boostOf(a) > 0)
      if (gated.length > 0) ranked = gated
    }
  }

  // Step 3 — MRO pre-fetch
  const rankedMros = rankMROs(cueSet, mros, {
    minRelevance: options.minPriorRelevance ?? 0.2,
    halfLifeDays: options.halfLifeDays ?? 30,
    queryText: options.queryText,
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
 * V4.4 P2b — short slice cap for prior-episode result text in the bundle.
 * The verbose tier banners and 400-char prior excerpts of the legacy
 * format burned tokens without lifting answer quality. 200 chars carries
 * enough framing for the model to recognize a similar past finding while
 * keeping the prior section under ~half the size it used to be.
 */
const PRIOR_RESULT_TRUNCATE_CHARS = 200

/**
 * Serialize a context bundle into a compact JSON envelope.
 *
 * V4.4 P1a — Replaces the old tier-banner format ("=== CONTEXT BUNDLE ===",
 * "--- TIER N ---", per-AIO "[file line N]" prefix lines) with a single
 * JSON object the substrate-chat system prompt is taught to consume. Wins:
 *
 *   - drops ~250 tokens of fixed overhead per bundle
 *   - removes redundant per-AIO header lines (filename is in the field)
 *   - lets the model parse the structure once instead of pattern-matching
 *     ASCII banners on every turn
 *
 * The shape is documented in the substrate-chat system prompt so it stays
 * a contract — don't rename fields without updating ``api/routes/chat.py``.
 */
export function serializeBundle(bundle: ContextBundle): string {
  const envelope = {
    cues: bundle.cue_set.map((c) => c.raw),
    traversal_cost: bundle.traversal_cost,
    priors: bundle.mro_priors.map((s) => ({
      id: s.mro.mro_id.slice(0, 8),
      score: Number(s.score.toFixed(3)),
      relevance: Number(s.relevance.toFixed(2)),
      freshness: Number(s.freshness.toFixed(2)),
      query: s.mro.query_text,
      finding: (s.mro.result_text ?? "").slice(0, PRIOR_RESULT_TRUNCATE_CHARS),
    })),
    hsl_neighborhoods: bundle.hsl_neighborhoods,
    aios: bundle.seed_aios.map((a) => ({
      file: a.fileName,
      raw: a.raw,
    })),
  }
  return JSON.stringify(envelope)
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
