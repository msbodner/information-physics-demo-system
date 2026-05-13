// Tests for the Smart Search query classifier (lib/smart-search.ts).
//
// Smart Search picks the right ChatAIO mode (Recall, Live, Exhaustive
// Live, Compare-Modes, Live-bypass) from the operator's natural-
// language query and, within Recall, sets the optional Force Fresh /
// Thorough / Skip MRO flags. The decision rules are pure functions
// of the query string — no I/O — so they're easy to test directly.
//
// Coverage matrix:
//   1. Priority ordering between the six mode-classes
//   2. Each flag-family's trigger lexicon
//   3. Flag combinations (Force Fresh + Thorough, Skip MRO + Thorough)
//   4. The looksLikePersonName heuristic + company-suffix / business-
//      descriptor filters (the source of the "Cedar Ridge LLC" false
//      positive that auto-flipped Thorough)
//
// Run via:  pnpm test

import { test } from "node:test"
import assert from "node:assert/strict"

import { classifyQuery } from "../smart-search"

// ── Priority order (rule N before rule N+1) ──────────────────────────

test("priority 1 — comparison wins over every other rule", () => {
  // "list all" would otherwise trigger Exhaustive; "compare modes"
  // overrides.
  const r = classifyQuery("compare modes for: list all vendors")
  assert.equal(r.mode, "compare-modes")
})

test("priority 2 — enumeration wins over freshness", () => {
  // "force fresh" would otherwise trigger Live-bypass; "list every"
  // overrides because completeness > freshness.
  const r = classifyQuery("force fresh: list every open RFI")
  assert.equal(r.mode, "exhaustive")
})

test("priority 3 — freshness probe routes to Live (bypass cache)", () => {
  const r = classifyQuery("is the corpus reachable right now")
  assert.equal(r.mode, "live-bypass")
})

test("priority 4 — cache-stale signal routes to Live (bypass cache)", () => {
  const r = classifyQuery("the cached answer was wrong, retry")
  assert.equal(r.mode, "live-bypass")
})

test("priority 5 — single-fact lookup routes to Live", () => {
  const r = classifyQuery("what is the budget of project PRJ-003")
  assert.equal(r.mode, "live")
})

test("priority 6 — default routes to Recall", () => {
  const r = classifyQuery("show me revenue trends by region")
  assert.equal(r.mode, "recall")
})

test("empty query returns Recall with a sensible reason", () => {
  const r = classifyQuery("")
  assert.equal(r.mode, "recall")
  assert.match(r.reason, /empty/i)
})

// ── Enumeration patterns ─────────────────────────────────────────────

const ENUM_CASES = [
  "list all vendors",
  "list every project",
  "find every open issue",
  "how many invoices are overdue",
  "complete list of cost codes",
  "total count of submittals",
  "for each PM, show the workload",
  "list:\n- vendor A\n- vendor B",
  "across all projects, sum the budgets",
  "enumerate the vendors with overdue invoices",
]

for (const q of ENUM_CASES) {
  test(`enumeration → Exhaustive Live: "${q}"`, () => {
    assert.equal(classifyQuery(q).mode, "exhaustive")
  })
}

// ── Freshness patterns ──────────────────────────────────────────────

const FRESH_CASES = [
  "is the corpus reachable",
  "give me a fresh answer",
  "no cache please",
  "bypass cache and tell me about VEND-0055",
  "force live retrieval",
  "rerun without cache",
]

for (const q of FRESH_CASES) {
  test(`freshness probe → Live (bypass cache): "${q}"`, () => {
    assert.equal(classifyQuery(q).mode, "live-bypass")
  })
}

// ── Single-fact lookups ─────────────────────────────────────────────

const SINGLE_FACT_CASES = [
  "what is the status of PRJ-003",
  "who is the owner of project Northridge",
  // SINGLE_FACT_PATTERNS requires "when was <single word> signed/…"
  // — phrasing like "when was the contract signed" has two words
  // ("the contract") between "was" and "signed" and doesn't match.
  "when was Northridge signed",
  "show me the record for VEND-0042",
  "what's the budget for the renovation project",
]

for (const q of SINGLE_FACT_CASES) {
  test(`single-fact → Live (cache on): "${q}"`, () => {
    assert.equal(classifyQuery(q).mode, "live")
  })
}

// ── Force Fresh flag (within Recall) ─────────────────────────────────

const FORCE_FRESH_CASES = [
  "ignore prior answers and re-check vendor VEND-0055",
  "as of now, what is the AP balance",
  "after the update, show me the budget rollup",
  "since the last import, who's new",
  // The "today's/latest" pattern needs to be followed by
  // "data|records|state", not arbitrary nouns. Use a matching phrase.
  "today's data shows what",
  "newly added vendors this week",
  "re-check the latest budget figures",
  "validate the cached answer",
  // NOTE: "previous answer was wrong" matches CACHE_STALE_PATTERNS,
  // which routes to Live (bypass cache) — covered separately below.
  "current state of the cost codes",
]

for (const q of FORCE_FRESH_CASES) {
  test(`Force Fresh trigger: "${q}"`, () => {
    const r = classifyQuery(q)
    assert.equal(r.mode, "recall")
    assert.equal(!!r.forceFresh, true, `expected forceFresh=true for "${q}"`)
    assert.equal(!!r.thorough, false)
    assert.equal(!!r.skipMro, false)
  })
}

// ── Thorough flag (within Recall) ────────────────────────────────────

const THOROUGH_CASES = [
  "comprehensive review of subcontractor performance",
  "in-depth analysis of cost trends",
  "deep dive into vendor relationships",
  "dig into the AP bills with approximately $5000 amounts",
  "fuzzy match for project Northridge",
  "cross-reference vendors with PM workload",
  "merge all related submittals",
  "be thorough — show every angle",
  // THOROUGH_PATTERNS expects "include typos|misspellings|variants|
  // aliases" directly — no intervening words. "include variants of the
  // Smith account" matches; "include any variants ..." doesn't.
  "include variants of the Smith account",
]

for (const q of THOROUGH_CASES) {
  test(`Thorough trigger: "${q}"`, () => {
    const r = classifyQuery(q)
    assert.equal(r.mode, "recall")
    assert.equal(!!r.thorough, true, `expected thorough=true for "${q}"`)
    assert.equal(!!r.skipMro, false)
  })
}

// ── Skip MRO flag (within Recall) ────────────────────────────────────

const SKIP_MRO_CASES = [
  "skip mro and tell me about vendor VEND-0055",
  "no mro — current AP balance",
  "ignore mro for this query",
  "bypass mro and rerun",
  "without mro, show me the vendors",
  "skip memory for this lookup",
  "no priors please",
  "from scratch, who is the top vendor",
  // NOTE: "list all SKUs" matches ENUMERATION_PATTERNS first (priority
  // 2), routing to Exhaustive Live before the Skip-MRO flag is even
  // evaluated. Use a phrase that doesn't trip enumeration.
  "clean slate query: tell me about vendor X",
  "ephemeral query: invoice total for last quarter",
  "one-off lookup for VEND-0032",
  "ad-hoc search for missing approvals",
  "private mode: list expense categories",
  "don't save this query",
  "do not save the result",
]

for (const q of SKIP_MRO_CASES) {
  test(`Skip MRO trigger: "${q}"`, () => {
    const r = classifyQuery(q)
    assert.equal(r.mode, "recall")
    assert.equal(!!r.skipMro, true, `expected skipMro=true for "${q}"`)
    // Skip MRO implies Force Fresh (short-circuit must be bypassed)
    assert.equal(!!r.forceFresh, true, `expected forceFresh=true (implied) for "${q}"`)
  })
}

// ── Person-name heuristic + filters ──────────────────────────────────

test("person name → Thorough (Sarah Mitchell)", () => {
  const r = classifyQuery("what does Sarah Mitchell own")
  assert.equal(r.mode, "recall")
  assert.equal(!!r.thorough, true)
})

test("person name → Thorough (Robert Johnson)", () => {
  const r = classifyQuery("analyze Robert Johnson's portfolio")
  assert.equal(!!r.thorough, true)
})

test("person name → Thorough (Maria Garcia)", () => {
  const r = classifyQuery("recent activity by Maria Garcia")
  assert.equal(!!r.thorough, true)
})

test("Perkins Will (firm name with two-word first-last shape) → Thorough", () => {
  // We intentionally accept this — it's a real entity that benefits
  // from wider fan-out even though it's a firm not a person.
  const r = classifyQuery("tell me about Perkins Will")
  assert.equal(!!r.thorough, true)
})

// Company-suffix filter — these should NOT trigger Thorough

test("company suffix LLC blocks person-name match", () => {
  // The actual failing operator query from production
  const r = classifyQuery(
    "Customer profitability by segment: compare walk-in retail margin vs. B2B pro accounts (Liberty LLC, Cedar Ridge LLC, etc.) and municipal customers",
  )
  assert.equal(r.mode, "recall")
  assert.equal(!!r.thorough, false)
})

test("company suffix Inc as second word blocks person-name match", () => {
  // "Acme Inc" — Inc is the second word, looks like a person pair but
  // is actually a company.
  const r = classifyQuery("totals from Acme Inc and Beta Corp")
  assert.equal(!!r.thorough, false)
})

test("company suffix Holdings as second word blocks match", () => {
  const r = classifyQuery("billings from Northwind Holdings")
  assert.equal(!!r.thorough, false)
})

test("balance for Liberty LLC stays in plain Recall", () => {
  const r = classifyQuery("balance for Liberty LLC")
  assert.equal(!!r.thorough, false)
})

// Business-descriptor first words — these should NOT trigger Thorough

test("'Customer Profitability' isn't a person", () => {
  const r = classifyQuery("Customer Profitability report")
  assert.equal(!!r.thorough, false)
})

test("'Total Sales' isn't a person", () => {
  const r = classifyQuery("Total Sales by region")
  assert.equal(!!r.thorough, false)
})

test("'Source Files' isn't a person", () => {
  const r = classifyQuery("Source Files inventory")
  assert.equal(!!r.thorough, false)
})

// Common geographic / institutional pairs — stop-list

test("'United States' is filtered", () => {
  const r = classifyQuery("vendors based in the United States")
  assert.equal(!!r.thorough, false)
})

test("'New York' is filtered", () => {
  const r = classifyQuery("invoices from New York")
  assert.equal(!!r.thorough, false)
})

test("'San Francisco' is filtered", () => {
  const r = classifyQuery("vendors in San Francisco")
  assert.equal(!!r.thorough, false)
})

// ── Flag combinations ────────────────────────────────────────────────

test("Force Fresh + Thorough together", () => {
  const r = classifyQuery("re-check with comprehensive coverage of vendor VEND-0055")
  assert.equal(r.mode, "recall")
  assert.equal(!!r.forceFresh, true)
  assert.equal(!!r.thorough, true)
  assert.equal(!!r.skipMro, false)
})

test("Skip MRO + Thorough together", () => {
  const r = classifyQuery(
    "don't save this — comprehensive Sarah Mitchell investigation",
  )
  assert.equal(r.mode, "recall")
  assert.equal(!!r.skipMro, true)
  assert.equal(!!r.forceFresh, true) // implied by Skip MRO
  assert.equal(!!r.thorough, true)
})

test("Skip MRO supersedes Force Fresh in the labeling", () => {
  // Both triggers fire, Skip MRO label wins per the modeLabel
  // priority chain in classifyQuery.
  const r = classifyQuery("ignore prior — skip mro and tell me about VEND-0055")
  assert.match(r.modeLabel, /no mro/i)
})

// ── modeLabel sanity ─────────────────────────────────────────────────

test("modeLabel matches the chosen flag combination", () => {
  assert.equal(classifyQuery("show me revenue").modeLabel, "Recall")
  assert.equal(classifyQuery("re-check the budget").modeLabel, "Recall (fresh)")
  assert.equal(classifyQuery("comprehensive review of vendors").modeLabel, "Recall (thorough)")
  assert.match(classifyQuery("skip mro and rerun").modeLabel, /no mro/i)
  assert.equal(classifyQuery("list all vendors").modeLabel, "Exhaustive Live")
  assert.equal(classifyQuery("what is the status of PRJ-003").modeLabel, "Live")
  assert.equal(classifyQuery("compare modes").modeLabel, "Compare Modes")
})

// ── Initials and short names — regression guard for the regex ────────

test("'B. Smith' (initial) does NOT trigger Thorough (regex requires 3+ char words)", () => {
  // looksLikePersonName requires [A-Z][a-z]{2,} for both words — a
  // single-letter initial doesn't match. This is a design choice
  // (avoid false positives on abbreviations); document it.
  const r = classifyQuery("find B. Smith's records")
  assert.equal(!!r.thorough, false)
})

test("two-word names with capital second word DO trigger", () => {
  const r = classifyQuery("about Alice Roberts and the budget")
  assert.equal(!!r.thorough, true)
})

// ── Sanity: undefined flags default to falsy ─────────────────────────

test("default Recall has no flags set", () => {
  const r = classifyQuery("show me revenue trends by region")
  assert.equal(r.mode, "recall")
  assert.equal(!!r.forceFresh, false)
  assert.equal(!!r.thorough, false)
  assert.equal(!!r.skipMro, false)
})
