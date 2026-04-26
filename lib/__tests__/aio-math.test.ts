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
  type ContextBundle,
  type HslLite,
  type MRO,
} from "../aio-math"
import { aioFromRaw } from "../aio-math"

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
