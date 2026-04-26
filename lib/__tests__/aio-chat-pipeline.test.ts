// Client-side smoke tests for V4.4 MRO-assisted retrieval helpers.
//
// Run via:   pnpm test
//   (which expands to: node --test --import tsx/esm lib/__tests__/*.test.ts)
//
// These cover the pure pieces of the substrate pipeline's MRO-assist
// logic that don't need a network or a DOM:
//
//   - searchTermsToCues: tolerant adapter over the search_terms JSONB blob.
//   - shouldShortCircuitOnMro: gating decision for the cache short-circuit.
//   - seedCuesWithMroHits: union extracted cues with prior cues, dedup.
//   - buildPriorEpisodeBlock: prior-episode header for the substrate bundle.
//
// The threshold constants themselves are also smoke-checked so that a
// future tweak doesn't accidentally invert the gating order
// (cue-seed < bundle-augment < short-circuit).

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  searchTermsToCues,
  shouldShortCircuitOnMro,
  seedCuesWithMroHits,
  buildPriorEpisodeBlock,
  MRO_SHORT_CIRCUIT_THRESHOLD,
  MRO_BUNDLE_AUGMENT_THRESHOLD,
  MRO_CUE_SEED_THRESHOLD,
  MRO_CUE_SEED_TOPK,
  type MroGatingHit,
} from "../aio-chat-pipeline"

// ── Threshold ordering invariants ───────────────────────────────────

test("threshold ordering is cue-seed < augment < short-circuit", () => {
  assert.ok(
    MRO_CUE_SEED_THRESHOLD < MRO_BUNDLE_AUGMENT_THRESHOLD,
    "cue-seed must be the broadest signal",
  )
  assert.ok(
    MRO_BUNDLE_AUGMENT_THRESHOLD < MRO_SHORT_CIRCUIT_THRESHOLD,
    "augment must be looser than short-circuit",
  )
  assert.ok(MRO_SHORT_CIRCUIT_THRESHOLD <= 1.0)
  assert.ok(MRO_CUE_SEED_TOPK >= 1)
})

// ── searchTermsToCues ───────────────────────────────────────────────

test("searchTermsToCues: returns empty for null/undefined/garbage", () => {
  assert.deepEqual(searchTermsToCues(null), [])
  assert.deepEqual(searchTermsToCues(undefined), [])
  assert.deepEqual(searchTermsToCues(123), [])
  assert.deepEqual(searchTermsToCues({ not: "an array" }), [])
  assert.deepEqual(searchTermsToCues("not even json"), [])
})

test("searchTermsToCues: parses array-of-cue-objects", () => {
  const out = searchTermsToCues([
    { key: "Quarter", value: "Q3", raw: "[Quarter.Q3]" },
    { key: "Metric", value: "revenue", raw: "[Metric.revenue]" },
  ])
  assert.equal(out.length, 2)
  assert.equal(out[0].key, "Quarter")
  assert.equal(out[0].value, "Q3")
  assert.equal(out[0].raw, "[Quarter.Q3]")
})

test("searchTermsToCues: parses JSON string (legacy write path)", () => {
  const blob = JSON.stringify([{ key: "Color", value: "red", raw: "[Color.red]" }])
  const out = searchTermsToCues(blob)
  assert.equal(out.length, 1)
  assert.equal(out[0].raw, "[Color.red]")
})

test("searchTermsToCues: synthesizes raw when missing, including wildcard", () => {
  const out = searchTermsToCues([
    { key: "Quarter", value: "Q4" },          // raw missing → "[Quarter.Q4]"
    { key: "Metric" },                         // value missing → wildcard
  ])
  assert.equal(out.length, 2)
  assert.equal(out[0].raw, "[Quarter.Q4]")
  assert.equal(out[1].raw, "[Metric.*]")
  assert.equal(out[1].value, undefined)
})

test("searchTermsToCues: skips items missing a key", () => {
  const out = searchTermsToCues([
    { value: "orphan" },        // no key → skip
    { key: "Good", value: "v" }, // keep
    null,                        // skip
    "string-element",            // skip
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].key, "Good")
})

// ── shouldShortCircuitOnMro ─────────────────────────────────────────

test("shouldShortCircuitOnMro: false when no top hit", () => {
  assert.equal(shouldShortCircuitOnMro(undefined), false)
})

test("shouldShortCircuitOnMro: false when result not hydratable", () => {
  const hit: MroGatingHit = { score: 0.99, result_full_available: false }
  assert.equal(shouldShortCircuitOnMro(hit), false)
})

test("shouldShortCircuitOnMro: false when score below threshold", () => {
  const hit: MroGatingHit = {
    score: MRO_SHORT_CIRCUIT_THRESHOLD - 0.01,
    result_full_available: true,
  }
  assert.equal(shouldShortCircuitOnMro(hit), false)
})

test("shouldShortCircuitOnMro: true at exact threshold with hydratable result", () => {
  const hit: MroGatingHit = {
    score: MRO_SHORT_CIRCUIT_THRESHOLD,
    result_full_available: true,
  }
  assert.equal(shouldShortCircuitOnMro(hit), true)
})

test("shouldShortCircuitOnMro: respects custom threshold override", () => {
  const hit: MroGatingHit = { score: 0.55, result_full_available: true }
  assert.equal(shouldShortCircuitOnMro(hit, 0.5), true)
  assert.equal(shouldShortCircuitOnMro(hit, 0.6), false)
})

// ── seedCuesWithMroHits ─────────────────────────────────────────────

test("seedCuesWithMroHits: returns extracted cues unchanged when no hits", () => {
  const extracted = [{ key: "K", value: "v", raw: "[K.v]" }]
  const out = seedCuesWithMroHits(extracted, [])
  assert.deepEqual(out, extracted)
  assert.notEqual(out, extracted, "must return a copy, not the same reference")
})

test("seedCuesWithMroHits: skips hits below the seed threshold", () => {
  const extracted = [{ key: "K", value: "v", raw: "[K.v]" }]
  const hits: MroGatingHit[] = [
    {
      score: MRO_CUE_SEED_THRESHOLD - 0.01,
      result_full_available: true,
      search_terms: [{ key: "Skip", value: "me", raw: "[Skip.me]" }],
    },
  ]
  const out = seedCuesWithMroHits(extracted, hits)
  assert.equal(out.length, 1)
  assert.equal(out[0].raw, "[K.v]")
})

test("seedCuesWithMroHits: unions cues from eligible hits", () => {
  const extracted = [{ key: "Q", value: "Q3", raw: "[Q.Q3]" }]
  const hits: MroGatingHit[] = [
    {
      score: 0.7,
      result_full_available: true,
      search_terms: [
        { key: "Metric", value: "revenue", raw: "[Metric.revenue]" },
        { key: "Q", value: "Q3", raw: "[Q.Q3]" }, // duplicate of extracted
      ],
    },
  ]
  const out = seedCuesWithMroHits(extracted, hits)
  // Should have extracted + Metric.revenue, but not duplicate Q.Q3.
  assert.equal(out.length, 2)
  const raws = out.map((c) => c.raw).sort()
  assert.deepEqual(raws, ["[Metric.revenue]", "[Q.Q3]"])
})

test("seedCuesWithMroHits: caps contributions to topK hits", () => {
  const extracted: never[] = []
  const hits: MroGatingHit[] = [
    { score: 0.9, result_full_available: true, search_terms: [{ key: "A", value: "1", raw: "[A.1]" }] },
    { score: 0.8, result_full_available: true, search_terms: [{ key: "B", value: "2", raw: "[B.2]" }] },
    { score: 0.7, result_full_available: true, search_terms: [{ key: "C", value: "3", raw: "[C.3]" }] },
    { score: 0.6, result_full_available: true, search_terms: [{ key: "D", value: "4", raw: "[D.4]" }] },
    { score: 0.5, result_full_available: true, search_terms: [{ key: "E", value: "5", raw: "[E.5]" }] },
  ]
  const out = seedCuesWithMroHits(extracted, hits, MRO_CUE_SEED_THRESHOLD, 3)
  assert.equal(out.length, 3)
  const raws = out.map((c) => c.raw).sort()
  assert.deepEqual(raws, ["[A.1]", "[B.2]", "[C.3]"])
})

test("seedCuesWithMroHits: tolerates malformed search_terms blobs", () => {
  const extracted = [{ key: "K", value: "v", raw: "[K.v]" }]
  const hits: MroGatingHit[] = [
    { score: 0.9, result_full_available: true, search_terms: null },
    { score: 0.9, result_full_available: true, search_terms: "garbage" },
    { score: 0.9, result_full_available: true, search_terms: [{ no_key: true }] },
  ]
  const out = seedCuesWithMroHits(extracted, hits)
  assert.deepEqual(out.map((c) => c.raw), ["[K.v]"])
})

// ── buildPriorEpisodeBlock ──────────────────────────────────────────

test("buildPriorEpisodeBlock: null when no top hit", () => {
  assert.equal(buildPriorEpisodeBlock(undefined), null)
})

test("buildPriorEpisodeBlock: null below threshold", () => {
  const hit: MroGatingHit = {
    score: MRO_BUNDLE_AUGMENT_THRESHOLD - 0.01,
    result_full_available: true,
    result_summary: "x",
  }
  assert.equal(buildPriorEpisodeBlock(hit), null)
})

test("buildPriorEpisodeBlock: null when summary missing even above threshold", () => {
  const hit: MroGatingHit = {
    score: 0.99,
    result_full_available: true,
    result_summary: "",
  }
  assert.equal(buildPriorEpisodeBlock(hit), null)
})

test("buildPriorEpisodeBlock: produces a well-formed block at threshold", () => {
  const hit: MroGatingHit = {
    score: MRO_BUNDLE_AUGMENT_THRESHOLD,
    result_full_available: true,
    result_summary: "Q3 revenue grew 12%",
    query_text: "what was Q3 revenue",
  }
  const block = buildPriorEpisodeBlock(hit)
  assert.ok(block, "must produce a block")
  assert.match(block!, /=== PRIOR EPISODE/)
  assert.match(block!, /score=0\.50/)
  assert.match(block!, /Past question: what was Q3 revenue/)
  assert.match(block!, /Q3 revenue grew 12%/)
  assert.match(block!, /=== END PRIOR EPISODE ===\n\n$/)
})

test("buildPriorEpisodeBlock: handles missing query_text gracefully", () => {
  const hit: MroGatingHit = {
    score: 0.6,
    result_full_available: true,
    result_summary: "summary",
  }
  const block = buildPriorEpisodeBlock(hit)
  assert.ok(block)
  assert.match(block!, /Past question: \n/)
})

// ── Cross-helper invariant ──────────────────────────────────────────

test("a hit at short-circuit threshold also clears the augment threshold", () => {
  // Belt-and-suspenders: if some future tweak inverts the thresholds,
  // this test catches it. The pipeline relies on short-circuit > augment
  // so that a short-circuited hit doesn't ALSO inject a duplicate prior
  // episode block (the pipeline returns early on short-circuit, but we
  // want the threshold relationship to be obvious from the constants).
  const hit: MroGatingHit = {
    score: MRO_SHORT_CIRCUIT_THRESHOLD,
    result_full_available: true,
    result_summary: "x",
  }
  assert.ok(shouldShortCircuitOnMro(hit))
  assert.ok(buildPriorEpisodeBlock(hit) !== null)
})
