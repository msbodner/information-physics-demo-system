// V5.0+ — Smart Search query classifier.
//
// TypeScript port of the decision logic in the `aio-search-auto` skill
// (~/.claude/skills/aio-search-auto/SKILL.md), which itself encodes the
// rules from Tips_for_AIO_Search_Model.docx (May 2026). The skill is
// for Claude Code to use during development; this module is for the
// in-app Smart Search button in ChatAIO. Both must stay in sync —
// when the rules change, update the skill AND this file.
//
// Pure function: takes a natural-language query, returns the chosen
// search mode + the human-readable rule that triggered it. The chat
// dialog then routes the request to the corresponding handler
// (handleRecallSearch / handleAioSearch / handleAioSearch with
// exhaustive flag / handleSend / handlePureLlm).

export type SearchMode =
  | "recall"
  | "live"
  | "live-bypass"
  | "exhaustive"
  | "compare-modes"

export interface ClassificationResult {
  mode: SearchMode
  /** Short human-readable explanation of which rule fired. */
  reason: string
  /**
   * Display label for the chosen mode — what the UI shows in the
   * pane header / footer (e.g. "Exhaustive Live", "Recall").
   */
  modeLabel: string
  /**
   * V6.0+ — Recall-specific flag recommendations. Only meaningful
   * when ``mode === "recall"`` (the other modes don't honor these
   * toggles). The Smart Search dispatcher passes both through to
   * handleRecallSearch.
   *
   *   forceFresh = true  →  bypass the MRO short-circuit + answer
   *                         cache; do a full fresh retrieval even
   *                         if a high-confidence prior MRO exists.
   *                         Use when the operator implies the
   *                         prior may be wrong / stale, when data
   *                         has changed, or when they say "re-check".
   *
   *   thorough   = true  →  bypass the score-≥-0.85 MRO short-circuit
   *                         AND widen the retrieval: maxAios 200→600,
   *                         maxPriors 3→8, fuzzy-cue trigram threshold
   *                         0.30→0.20. Best for fuzzy queries,
   *                         person-name searches, typo-laden input,
   *                         and "comprehensive" / "in-depth" intent.
   */
  forceFresh?: boolean
  thorough?: boolean
  /**
   * V6.0+ — strict superset of forceFresh: skip the MRO machinery
   * entirely for this one query.
   *   - maxPriors → 0   (no cached MROs in the context bundle)
   *   - bypassMroCache  (no zero-token short-circuit)
   *   - saveMRO → false (don't write this query as a new MRO either)
   * Use when the operator wants an ephemeral / one-off / private
   * search that bypasses every MRO read AND write path.
   */
  skipMro?: boolean
}

// ── Trigger-word lexicons ────────────────────────────────────────

const ENUMERATION_PATTERNS: RegExp[] = [
  /\blist\s+(every|all)\b/i,
  /\bfind\s+(every|all)\b/i,
  /\bhow\s+many\b/i,
  /\bcomplete\s+list\b/i,
  /\btotal\s+(number|count)\b/i,
  /\bcount\s+of\b/i,
  /\b(every|all)\s+(record|row|item|aio|hsl|mro|document|file|entry)/i,
  /\bevery\s+\w+\s+(that|which|with|matching)\b/i,
  /\benumerate\b/i,
  // V5.0+ — additional enumeration markers observed in the Prompt
  // Library v3 corpus that the original 9 patterns missed:
  //   * "For each X, list ..." — common per-entity report shape
  //   * "list:" colon form — "list: A, B, C" or "list:\n- A\n- B"
  //   * "for each PM" / "for each project" — strong full-coverage signal
  //   * "across all/every" — totaling across a population
  //   * "per <entity>" with "list" or "report" nearby
  /\bfor\s+each\s+\w+/i,
  /\blist\s*:/i,
  /\bacross\s+(all|every)\b/i,
  /\b(list|report)\s+for\s+each\b/i,
]

const FRESHNESS_PATTERNS: RegExp[] = [
  /\bis\s+the\s+corpus\s+(reachable|connected|up)\b/i,
  /\bfresh\s+(answer|search|query|run)\b/i,
  /\bno\s+cache\b/i,
  /\bbypass\s+cache\b/i,
  /\bforce\s+(live|fresh)\b/i,
  /\brerun\s+without\s+(memory|cache|priors)\b/i,
]

const CACHE_STALE_PATTERNS: RegExp[] = [
  /\b(cached|prior|previous)\s+answer\s+(was\s+)?(wrong|stale|out\s+of\s+date|outdated)\b/i,
  /\bmissed\s+(recent|new)\s+context\b/i,
  /\bgot\s+a\s+stale\b/i,
  /\bout\s+of\s+date\b/i,
]

const COMPARISON_PATTERNS: RegExp[] = [
  /\bcompare\s+(modes|recall|live|search)\b/i,
  /\bside\s+by\s+side\b/i,
  /\bbenchmark\b/i,
  /\bwhich\s+mode\s+(is|works)\s+best\b/i,
  /\bevaluate\s+(modes|search)\b/i,
]

const SINGLE_FACT_PATTERNS: RegExp[] = [
  /^what\s+is\s+the\s+\w+\s+of\s+/i,
  /^who\s+is\s+the\s+(owner|architect|manager|lead)\s+of\s+/i,
  /^when\s+was\s+\w+\s+(updated|created|approved|signed)\b/i,
  /^show\s+me\s+the\s+(record|row|entry)\s+for\s+/i,
  /^what.s\s+the\s+(status|budget|amount)\s+(of|for)\s+/i,
]

// ── V6.0+ Recall-flag triggers ────────────────────────────────────
//
// These don't change the mode (Recall stays Recall) but they flip
// flags on the Recall handler so Smart Search picks the cheap
// MRO-shortcut path or the expensive thorough-merge path automatically.

// Force Fresh: bust the MRO short-circuit + answer cache. Use when the
// operator implies the prior may be wrong, data has changed, or they
// want to revalidate. Distinct from FRESHNESS_PATTERNS (which routes
// to Live-bypass entirely) — these phrases keep the Recall pipeline
// (cheaper retrieval, MRO capture) but skip the cached short-circuit.
const FORCE_FRESH_PATTERNS: RegExp[] = [
  /\bignore\s+(prior|previous|cached?)\b/i,
  /\bdon.?t\s+use\s+(the\s+)?cache\b/i,
  /\bre-?check\b/i,
  /\bre-?verify\b/i,
  /\bdouble[\s-]?check\b/i,
  /\bvalidate\s+(the\s+)?(prior|cached|previous)\b/i,
  /\bas\s+of\s+(now|today|right\s+now)\b/i,
  /\bcurrent\s+(state|status|value)\b/i,
  /\bright\s+now\b/i,
  /\bafter\s+(the\s+)?(update|import|upload|change|migration)\b/i,
  /\bsince\s+(the\s+)?(last|recent|new)\s+(import|upload|update)\b/i,
  /\b(today.?s|this\s+week.?s|latest)\s+(data|records|state)\b/i,
  /\bnewly\s+(added|imported|loaded)\b/i,
  /\bprevious\s+answer\s+(was|seems|looks)\s+(wrong|off|stale|incomplete)\b/i,
]

// Thorough: widen retrieval AND bypass the score-≥-0.85 short-circuit.
// Pays a higher token cost but catches typos, person-name fan-out, and
// "comprehensive" intent that the bounded Recall path would truncate.
const THOROUGH_PATTERNS: RegExp[] = [
  /\b(comprehensive|exhaustive|in-?depth|deep|thorough|detailed)\s+(search|look|review|analysis|coverage)\b/i,
  /\bdeep\s+dive\b/i,
  /\bdig\s+(in|into|deeper)\b/i,
  /\b(approximately|approx\.|around|roughly|similar\s+to|sounds\s+like|something\s+like)\b/i,
  /\bfuzzy\s+(match|search)\b/i,
  /\bmight\s+be\s+spelled\b/i,
  /\b(could\s+be|might\s+be|maybe)\s+(named|called|spelled)\b/i,
  /\bmerge\s+(all|every|related)\b/i,
  /\bcombine\s+(all|every|related)\b/i,
  /\bcross-?reference\b/i,
  /\bcross-?ref\b/i,
  /\baggregate\s+(all|every|across)\b/i,
  /\b(any|all)\s+(variant|variation|alternative|related)\b/i,
  /\bsynonyms?\s+of\b/i,
  /\binclude\s+(typos|misspellings|variants|aliases)\b/i,
  /\bbe\s+thorough\b/i,
]

// Skip-MRO: ephemeral / one-off intent — bypass cached MRO priors,
// short-circuit, AND the save-as-MRO step. Strict superset of Force
// Fresh. Use when the operator explicitly wants no memory involvement
// on either the read or write path (e.g. exploratory probing, A/B
// testing a retrieval change, or privacy-sensitive ad-hoc queries).
const SKIP_MRO_PATTERNS: RegExp[] = [
  /\bskip\s+mro\b/i,
  /\bno\s+mro\b/i,
  /\bignore\s+mro\b/i,
  /\bbypass\s+mro\b/i,
  /\bwithout\s+mro\b/i,
  /\bskip\s+(memory|priors|cached?\s+(answer|result))\b/i,
  /\bno\s+(memory|priors)\b/i,
  /\bignore\s+(all\s+)?(memory|priors)\b/i,
  /\bwithout\s+(memory|priors|cached?\s+(answer|result))\b/i,
  /\bfrom\s+scratch\b/i,
  /\bclean\s+slate\b/i,
  /\bephemeral\b/i,
  /\bone-?off\b/i,
  /\bone-?shot\s+(search|query|lookup)\b/i,
  /\bprivate\s+mode\b/i,
  /\bdon.?t\s+(save|remember|cache)\s+(this|the)\b/i,
  /\bdo\s+not\s+save\b/i,
  /\bad-?hoc\s+(search|query|lookup)\b/i,
]

// Heuristic: a capitalized two-word name (e.g. "Sarah Mitchell",
// "Perkins Will") is a strong Thorough signal — these queries
// almost always need wider fan-out (multi-CSV, fuzzy aliasing) than
// the cheap MRO short-circuit provides.
function looksLikePersonName(query: string): boolean {
  // Match "FirstName LastName" — two adjacent capitalized words,
  // ignoring leading verbs ("who is", "tell me about", etc.).
  // Avoid matching project keys like "VEND-0055" or "AIA305".
  const m = query.match(/\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})\b/)
  if (!m) return false
  // Filter out obvious non-name capitalized pairs by guarding against
  // common business terms.
  const stop = new Set([
    "United States", "New York", "San Francisco", "Los Angeles",
    "Pull Request", "Product Manager", "Hyper Semantic",
    "Information Physics", "Standard Model",
  ])
  return !stop.has(`${m[1]} ${m[2]}`)
}

// ── Helpers ──────────────────────────────────────────────────────

function anyMatch(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text))
}

function modeLabelFor(mode: SearchMode): string {
  switch (mode) {
    case "recall":         return "Recall"
    case "live":           return "Live"
    case "live-bypass":    return "Live (bypass cache)"
    case "exhaustive":     return "Exhaustive Live"
    case "compare-modes":  return "Compare Modes"
  }
}

// ── Classifier ───────────────────────────────────────────────────
//
// Priority order — first matching rule wins:
//   1. Comparison / benchmarking
//   2. Enumeration / completeness signals
//   3. Freshness probes
//   4. Cache-stale signals
//   5. Single-fact lookups
//   6. Default → Recall
//
// Tie-breakers baked into the order:
//   * "list every fresh vendor"   → Exhaustive (rule 2 before rule 3)
//   * "compare modes for: how many vendors" → Compare-Modes (rule 1 wins)
//   * "force fresh: how many open RFIs"     → Exhaustive (rule 2 before rule 3)

export function classifyQuery(rawQuery: string): ClassificationResult {
  const query = (rawQuery || "").trim()
  if (!query) {
    return { mode: "recall", reason: "empty query — defaulting to Recall", modeLabel: "Recall" }
  }

  // 1. Comparison / benchmarking — R&D wins over delivery.
  if (anyMatch(query, COMPARISON_PATTERNS)) {
    return {
      mode: "compare-modes",
      reason: "comparison/benchmark intent — running Recall + Live side by side",
      modeLabel: modeLabelFor("compare-modes"),
    }
  }

  // 2. Enumeration / completeness — guaranteed full coverage.
  if (anyMatch(query, ENUMERATION_PATTERNS)) {
    return {
      mode: "exhaustive",
      reason: "enumeration/completeness signal — Exhaustive Live guarantees every match reaches the model",
      modeLabel: modeLabelFor("exhaustive"),
    }
  }

  // 3. Freshness probe — one clean round-trip, no MRO interference.
  if (anyMatch(query, FRESHNESS_PATTERNS)) {
    return {
      mode: "live-bypass",
      reason: "freshness intent — running Live with cache bypassed",
      modeLabel: modeLabelFor("live-bypass"),
    }
  }

  // 4. Cache-stale signal — same call as freshness but flagged separately
  //    so the UI can hint at Recall on the next run.
  if (anyMatch(query, CACHE_STALE_PATTERNS)) {
    return {
      mode: "live-bypass",
      reason: "cache-stale signal — bypassing cache; next time, drop the trigger word to use Recall",
      modeLabel: modeLabelFor("live-bypass"),
    }
  }

  // 5. Single-fact lookup — bounded Live, default cache.
  if (anyMatch(query, SINGLE_FACT_PATTERNS)) {
    return {
      mode: "live",
      reason: "single-fact lookup — bounded Live with cache enabled",
      modeLabel: modeLabelFor("live"),
    }
  }

  // 6. Default → Recall (cheapest amortized cost, builds memory).
  //
  //    Within Recall, also classify Force Fresh / Thorough triggers
  //    so Smart Search picks the right Recall variant automatically.
  //    These flags only apply to Recall (the only mode with an MRO
  //    short-circuit + maxAios/maxPriors caps to bypass).
  const wantsSkipMro = anyMatch(query, SKIP_MRO_PATTERNS)
  const wantsForceFresh = anyMatch(query, FORCE_FRESH_PATTERNS)
  const wantsThorough =
    anyMatch(query, THOROUGH_PATTERNS) || looksLikePersonName(query)

  let reason = "no completeness/freshness/comparison signal — Recall is the cheapest amortized choice"
  let modeLabel = modeLabelFor("recall")
  // Skip-MRO takes priority over Force Fresh: it's the strict superset
  // (no priors as input, no short-circuit, no MRO write either).
  if (wantsSkipMro && wantsThorough) {
    reason = "ephemeral + comprehensive intent — Recall with Skip MRO and Thorough (no MRO read/write, wide retrieval)"
    modeLabel = "Recall (no MRO + thorough)"
  } else if (wantsSkipMro) {
    reason = "skip-MRO intent — Recall with no priors as input, no short-circuit, and no save"
    modeLabel = "Recall (no MRO)"
  } else if (wantsForceFresh && wantsThorough) {
    reason = "data-change + comprehensive intent — Recall with Force Fresh and Thorough enabled"
    modeLabel = "Recall (fresh + thorough)"
  } else if (wantsForceFresh) {
    reason = "data-change / re-check intent — Recall with Force Fresh (MRO short-circuit bypassed)"
    modeLabel = "Recall (fresh)"
  } else if (wantsThorough) {
    reason = looksLikePersonName(query) && !anyMatch(query, THOROUGH_PATTERNS)
      ? "person-name detected — Recall with Thorough (widens fan-out for fuzzy matches across CSVs)"
      : "comprehensive/fuzzy intent — Recall with Thorough (wider retrieval + bypass MRO short-circuit)"
    modeLabel = "Recall (thorough)"
  }

  return {
    mode: "recall",
    reason,
    modeLabel,
    // Skip-MRO implies Force Fresh's short-circuit bypass; surface both
    // flags so downstream code can branch independently if needed.
    forceFresh: (wantsForceFresh || wantsSkipMro) || undefined,
    thorough: wantsThorough || undefined,
    skipMro: wantsSkipMro || undefined,
  }
}

// ── Mode catalog (used by the Settings pane description table) ────

export interface ModeInfo {
  id: SearchMode
  label: string
  triggers: string
  endpoint: string
  notes: string
}

export const MODE_CATALOG: ModeInfo[] = [
  {
    id: "recall",
    label: "Recall",
    triggers: "Default — anything without a completeness/freshness/comparison signal",
    endpoint: "POST /v1/op/substrate-chat (memory-augmented Substrate Mode)",
    notes: "Hits MRO cache when prior episodes apply; falls through to fresh retrieval otherwise. Each useful answer becomes a new MRO. Cheapest amortized cost over time. Three operator (or Smart-Search auto) flags refine it: Force Fresh (bypass cache + MRO short-circuit when data has changed or the prior is stale), Thorough (widen retrieval — maxAios 200→600, maxPriors 3→8, trigram threshold 0.30→0.20 — for fuzzy/person-name/comprehensive queries), and Skip MRO (strict superset of Force Fresh — also strips priors from the bundle and disables the save-as-MRO step, for ephemeral / one-off / A-B-testing / privacy-sensitive queries).",
  },
  {
    id: "live",
    label: "Live",
    triggers: 'Single-fact lookups: "what is the status of X", "who is the owner of Y", "when was Z updated"',
    endpoint: "POST /v1/op/aio-search (cache enabled)",
    notes: "One fresh synthesis pass through the indexed AIO substrate. Bounded by adaptive_aio_cap (200–2000) and diversify_by_csv. Repeated identical queries hit the answer cache.",
  },
  {
    id: "live-bypass",
    label: "Live (bypass cache)",
    triggers: 'Freshness probes: "is the corpus reachable", "fresh answer", "no cache", "force live", "bypass cache"',
    endpoint: "POST /v1/op/aio-search?bypass_cache=true",
    notes: "Same Live pipeline but skips both the answer cache and the parse cache. Use when you suspect a stale cached MRO is masking a deployed retrieval fix.",
  },
  {
    id: "exhaustive",
    label: "Exhaustive Live",
    triggers: 'Enumeration words: "list all", "every X", "how many Y", "find every Z", "complete list", "count of"',
    endpoint: "POST /v1/op/aio-search?mode=exhaustive",
    notes: "Chunked map-reduce — every matched AIO is independently classified by a per-chunk LLM call (Haiku default; Sonnet/Opus available), then merged by max similarity. Guarantees full coverage at ~N × Live token cost.",
  },
  {
    id: "compare-modes",
    label: "Compare Modes",
    triggers: 'Comparison words: "compare", "side by side", "benchmark", "which mode is best for", "evaluate modes"',
    endpoint: "Sequential calls (Recall + Live + optionally Exhaustive)",
    notes: "Runs the same query through multiple modes and presents replies + footers side by side. R&D / benchmarking only — not recommended for everyday questions because it pays the full token cost for each mode.",
  },
]
