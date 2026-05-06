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
  return {
    mode: "recall",
    reason: "no completeness/freshness/comparison signal — Recall is the cheapest amortized choice",
    modeLabel: modeLabelFor("recall"),
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
    notes: "Hits MRO cache when prior episodes apply; falls through to fresh retrieval otherwise. Each useful answer becomes a new MRO. Cheapest amortized cost over time.",
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
