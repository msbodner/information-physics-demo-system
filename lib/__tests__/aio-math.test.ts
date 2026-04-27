// Client-side tests for V4.4 P0b/P1a/P2a additions to lib/aio-math.ts:
//
//   - extractCues: HSL key/value catalog promotes wildcard cues into
//     precise [Key.Value] cues.
//   - assembleBundle: hslGate option hard-filters non-covered AIOs (with
//     graceful fallback when gating would empty the neighborhood).
//   - serializeBundle: emits a compact JSON envelope (no tier banners,
//     no per-AIO header lines), with priors truncated to ~200 chars.
//
// Run via:  pnpm test

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  extractCues,
  assembleBundle,
  serializeBundle,
  computeHslBoost,
  diversifyByCSV,
  traverseHSL,
  type ContextBundle,
  type HslLite,
  type MRO,
} from "../aio-math"
import { aioFromRaw } from "../aio-math"
import { canonicalField } from "../hsl-aliases"

// ── extractCues: HSL catalog promotion ──────────────────────────────

test("extractCues: catalog promotes vocab match to a precise [Key.Value] cue", () => {
  // NOTE: extractCues requires value.length >= 3, so use "revenue" not "Q3".
  const cues = extractCues(
    "show me revenue for last quarter",
    /* fieldNames */ [],
    /* valueVocabulary */ new Set(["revenue"]),
    /* hslCatalog */ [{ key: "Metric", value: "revenue" }],
  )
  // Should emit [Metric.revenue], NOT the [*.revenue] vocab fallback.
  const raws = cues.map((c) => c.raw)
  assert.ok(raws.includes("[Metric.revenue]"), `expected [Metric.revenue] in ${raws.join(",")}`)
  assert.ok(!raws.includes("[*.revenue]"), `expected no [*.revenue] in ${raws.join(",")}`)
})

test("extractCues: without catalog, falls back to [*.Value] vocab cue", () => {
  const cues = extractCues(
    "show me revenue for last quarter",
    [],
    new Set(["revenue"]),
  )
  const raws = cues.map((c) => c.raw)
  assert.ok(raws.includes("[*.revenue]"), `expected [*.revenue] vocab fallback in ${raws.join(",")}`)
})

test("extractCues: catalog-only matches still emit cues when value not in vocab", () => {
  // Catalog provides the value; vocab doesn't. Promotion should still fire
  // because the catalog scan runs independently of the vocab scan.
  const cues = extractCues(
    "what about acme",
    [],
    new Set(),
    [{ key: "Vendor", value: "Acme" }],
  )
  const raws = cues.map((c) => c.raw)
  assert.ok(raws.includes("[Vendor.Acme]"), `got ${raws.join(",")}`)
})

// ── assembleBundle: hslGate ─────────────────────────────────────────

test("assembleBundle: hslGate drops AIOs with zero HSL coverage", () => {
  const a1 = aioFromRaw("[Vendor.Acme][Amount.100]", "a1.csv")
  const a2 = aioFromRaw("[Vendor.Acme][Amount.200]", "a2.csv")
  const a3 = aioFromRaw("[Vendor.Acme][Amount.300]", "a3.csv")
  const cues = [{ key: "Vendor", value: "Acme", raw: "[Vendor.Acme]" }]
  // HSL covers a1 + a2 by name only.
  const hsls: HslLite[] = [
    { hsl_id: "h1", hsl_name: "[Vendor.Acme].hsl", elements: ["a1.csv", "a2.csv"] },
  ]
  const boost = computeHslBoost(cues, hsls)
  const bundle = assembleBundle(cues, [a1, a2, a3], [], { hslBoost: boost, hslGate: true })
  const files = bundle.seed_aios.map((a) => a.fileName).sort()
  assert.deepEqual(files, ["a1.csv", "a2.csv"])
})

test("assembleBundle: hslGate falls back when gating would empty the neighborhood", () => {
  const a1 = aioFromRaw("[Vendor.Acme]", "a1.csv")
  const cues = [{ key: "Vendor", value: "Acme", raw: "[Vendor.Acme]" }]
  // HSL with mismatched name → boost map is empty → gate would zero out.
  const hsls: HslLite[] = [
    { hsl_id: "h1", hsl_name: "[Other.Thing].hsl", elements: ["something-else"] },
  ]
  const boost = computeHslBoost(cues, hsls)
  // boost is empty here, so gate shouldn't even engage; verify regardless
  // by passing a one-shot non-empty boost map for an unrelated AIO.
  const fakeBoost = new Map<string, number>([["unrelated", 1]])
  const bundle = assembleBundle(cues, [a1], [], { hslBoost: fakeBoost, hslGate: true })
  // a1 has zero coverage → gating would empty → fallback keeps a1.
  assert.equal(bundle.seed_aios.length, 1)
  assert.equal(bundle.seed_aios[0].fileName, "a1.csv")
  // Silence unused-var lint without changing semantics.
  void boost
})

// ── serializeBundle: compact JSON envelope ──────────────────────────

test("serializeBundle: emits valid JSON with the expected fields", () => {
  const a1 = aioFromRaw("[Vendor.Acme]", "a1.csv")
  const bundle: ContextBundle = {
    mro_priors: [],
    hsl_neighborhoods: ["[Vendor.Acme]"],
    seed_aios: [a1],
    cue_set: [{ key: "Vendor", value: "Acme", raw: "[Vendor.Acme]" }],
    traversal_cost: 1,
  }
  const text = serializeBundle(bundle)
  const parsed = JSON.parse(text)
  assert.deepEqual(parsed.cues, ["[Vendor.Acme]"])
  assert.equal(parsed.traversal_cost, 1)
  assert.deepEqual(parsed.hsl_neighborhoods, ["[Vendor.Acme]"])
  assert.equal(parsed.aios.length, 1)
  assert.equal(parsed.aios[0].file, "a1.csv")
  assert.equal(parsed.aios[0].raw, "[Vendor.Acme]")
  assert.deepEqual(parsed.priors, [])
  // Compactness: no banner strings.
  assert.ok(!text.includes("=== CONTEXT BUNDLE"))
  assert.ok(!text.includes("TIER 1"))
})

// ── diversifyByCSV: per-CSV cap ─────────────────────────────────────

test("diversifyByCSV: takes a fair share from each CSV before backfilling", () => {
  // 10 items: 7 from A, 2 from B, 1 from C. cap=6, numCsvs=3 → perBucket=2.
  // Expect 2 from A, 2 from B (only 2 anyway), 1 from C, then 1 backfill from A.
  const items = [
    { id: "a1", csv: "A" }, { id: "a2", csv: "A" }, { id: "a3", csv: "A" },
    { id: "a4", csv: "A" }, { id: "a5", csv: "A" }, { id: "a6", csv: "A" },
    { id: "a7", csv: "A" },
    { id: "b1", csv: "B" }, { id: "b2", csv: "B" },
    { id: "c1", csv: "C" },
  ]
  const out = diversifyByCSV(items, (x) => x.csv, 6)
  assert.equal(out.length, 6)
  const csvs = out.map((x) => x.csv).sort()
  // Every CSV must be represented at least once
  assert.ok(csvs.includes("A") && csvs.includes("B") && csvs.includes("C"))
  // B and C must contribute (Bug 1: AIA305 was crowding out single-row CSVs)
  assert.equal(out.filter((x) => x.csv === "B").length, 2)
  assert.equal(out.filter((x) => x.csv === "C").length, 1)
})

test("diversifyByCSV: returns input unchanged when items <= total", () => {
  const items = [{ csv: "A" }, { csv: "B" }]
  const out = diversifyByCSV(items, (x) => x.csv, 10)
  assert.deepEqual(out, items)
})

test("diversifyByCSV: dominant CSV cannot crowd out a single-row CSV", () => {
  // Mirrors the PRJ-003 benchmark profile: 30 AIA305 rows + 1 row from
  // each of 4 operational CSVs. cap=10 → AIA305 must yield 4 slots.
  const items: Array<{ csv: string }> = []
  for (let i = 0; i < 30; i++) items.push({ csv: "AIA305" })
  for (const c of ["acc_rfis", "acc_issues", "acc_submittals", "acc_vendors"]) {
    items.push({ csv: c })
  }
  const out = diversifyByCSV(items, (x) => x.csv, 10)
  const seen = new Set(out.map((x) => x.csv))
  assert.ok(seen.has("acc_rfis"))
  assert.ok(seen.has("acc_issues"))
  assert.ok(seen.has("acc_submittals"))
  assert.ok(seen.has("acc_vendors"))
  assert.ok(out.length <= 10)
})

// ── HSL field aliasing ──────────────────────────────────────────────

test("canonicalField: folds Project ID variants onto Project", () => {
  assert.equal(canonicalField("Project_ID"), "Project")
  assert.equal(canonicalField("Project ID"), "Project")
  assert.equal(canonicalField("Projects Assigned"), "Project")
  assert.equal(canonicalField("Applicable Projects"), "Project")
  assert.equal(canonicalField("ProjectID"), "Project")
})

test("canonicalField: leaves unrelated fields unchanged", () => {
  assert.equal(canonicalField("Vendor Name"), "Vendor Name")
  assert.equal(canonicalField("Status"), "Status")
})

test("traverseHSL: cue [Project.PRJ-003] matches AIOs across alias shapes", () => {
  const aia = aioFromRaw("[OriginalCSV.AIA305.csv][Project_ID.PRJ-003]", "AIA305.csv")
  const rfi = aioFromRaw("[OriginalCSV.acc_rfis.csv][Project ID.PRJ-003]", "acc_rfis.csv")
  const ven = aioFromRaw("[OriginalCSV.acc_vendors.csv][Projects Assigned.PRJ-003]", "acc_vendors.csv")
  const cost = aioFromRaw("[OriginalCSV.acc_cost_codes.csv][Applicable Projects.PRJ-003]", "acc_cost_codes.csv")
  const noise = aioFromRaw("[OriginalCSV.other.csv][Project_ID.PRJ-099]", "other.csv")
  const cues = [{ key: "Project", value: "PRJ-003", raw: "[Project.PRJ-003]" }]
  const { matches } = traverseHSL(cues, [aia, rfi, ven, cost, noise])
  const files = matches.map((m) => m.fileName).sort()
  assert.deepEqual(files, ["AIA305.csv", "acc_cost_codes.csv", "acc_rfis.csv", "acc_vendors.csv"])
})

test("extractCues: catalog key Project_ID is normalized to Project in emitted cue", () => {
  const cues = extractCues(
    "report on PRJ-003",
    [],
    new Set(["PRJ-003"]),
    [{ key: "Project_ID", value: "PRJ-003" }],
  )
  const raws = cues.map((c) => c.raw)
  assert.ok(raws.includes("[Project.PRJ-003]"), `expected [Project.PRJ-003] in ${raws.join(",")}`)
})

test("serializeBundle: priors are truncated to ~200 chars", () => {
  const longText = "x".repeat(2000)
  const fakeMRO: MRO = {
    mro_id: "abcdef1234567890",
    created_at: new Date().toISOString(),
    query_text: "past q",
    cue_set: [],
    seed_aio_ids: [],
    context_aio_raws: [],
    hsl_names: [],
    operators: [],
    result_text: longText,
    confidence: 0.5,
    provenance: { model_ref: "test", traversal_cost: 0 },
  }
  const bundle: ContextBundle = {
    mro_priors: [
      { mro: fakeMRO, relevance: 0.9, textSim: 0, freshness: 1, trustBoost: 1, score: 0.45 },
    ],
    hsl_neighborhoods: [],
    seed_aios: [],
    cue_set: [],
    traversal_cost: 0,
  }
  const parsed = JSON.parse(serializeBundle(bundle))
  assert.equal(parsed.priors.length, 1)
  // Truncated, not full
  assert.ok(parsed.priors[0].finding.length <= 200)
  assert.ok(parsed.priors[0].finding.length < longText.length)
  assert.equal(parsed.priors[0].id, "abcdef12")
})
