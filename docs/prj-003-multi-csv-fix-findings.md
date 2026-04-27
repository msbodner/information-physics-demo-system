# PRJ-003 multi-CSV retrieval fix — findings

## Context

The PRJ-003 benchmark in [scripts/benchmark_prompt.txt](../scripts/benchmark_prompt.txt) asks
a question that requires joining 5 CSVs by Project ID: `acc_rfis`, `acc_issues`,
`acc_submittals`, `acc_cost_codes`, `acc_vendors` (plus `AIA305 Sample` for context).

Pre-fix benchmark run, four ChatAIO modes:

| Mode | Quality | Notes |
|---|---|---|
| Broad | ✅ Correct | Used full 589-AIO corpus |
| Raw | ⚠️ Hallucinated 1 person | No DB access |
| Live | ❌ "No matching records found" | matched 588 AIOs but returned empty |
| Recall | ❌ Refused | aios array contained no records from acc_rfis/acc_issues/acc_submittals/acc_vendors |

## Two root causes

### Bug 1 — AIA305 dominance in the AIO cap

The corpus is 474/589 ≈ 80% AIA305 records. After cue extraction, every AIO
that mentions PRJ-003 ranks equally on cue overlap, so the flat top-40 cap
(`maxAios`) fills with AIA305 records and pushes out the operational CSVs.

### Bug 2 — Field-name fragmentation

| File | Field |
|---|---|
| AIA305 Sample.csv | `Project_ID` |
| acc_rfis.csv / acc_issues.csv / acc_submittals.csv | `Project ID` |
| acc_vendors.csv | `Projects Assigned` |
| acc_cost_codes.csv | `Applicable Projects` |

Same value (`PRJ-003`), four different field names. The cue extractor and HSL
traversal treated them as unrelated, so a `[Project_ID.PRJ-003]` cue from the
catalog never matched a `[Project ID.PRJ-003]` element on an RFI row.

## Fix summary

### Part A — diversity-aware cap (`lib/aio-math.ts`)

New `diversifyByCSV(items, getCSV, total)` helper. `assembleBundle` calls it
on the ranked neighborhood instead of `slice(0, maxAios)`. Behavior:

- bucket items by `[OriginalCSV.…]` (with a `fileName` fallback)
- take up to `floor(total / numCsvs)` from each bucket in input order
- backfill any remaining slots from the highest-ranked leftovers
- never exceeds `total`; single-row buckets always make it in

Result: AIA305 still gets a fair share, but cannot crowd out a 1-row CSV
that's needed to answer the join.

### Part C — HSL pointer expansion (`lib/aio-math.ts`, `lib/aio-chat-pipeline.ts`)

The original Recall pipeline scoped the AIO neighborhood by sending cue
needles to a pg_trgm scan over the AIO blob (`findAiosByNeedles`), capped
at 500 rows. With ~426 cues fanning out to ~850 needles, the cap saturated
with high-fanout terms (person names that hit hundreds of AIA305 rows) and
acc_rfis / acc_issues / acc_submittals were never returned at all. The
HSL was being fetched but used only as a re-rank booster — the recall path
that AIA305 starved.

This part inverts that: the HSL pointer column *is* a tight short list of
AIO names per relationship. We resolve HSLs first, take the union of every
cue-matched HSL's `elements` (skipping `[MRO.*]` sentinels), and use that
as the primary scope. The needle scan is kept as a complementary safety
net for AIOs that no HSL covers.

New helper `collectHslPointerNames(cueSet, hsls)` in `aio-math.ts` (pure,
testable). The pipeline is reordered: resolve HSLs → expand pointers →
union with needle scan → filter the in-memory AIO array against that set.

### Part B — frontend HSL field aliasing (`lib/hsl-aliases.ts`)

New `canonicalField(name)` folds equivalent field names onto a canonical form:

| Canonical | Aliases |
|---|---|
| `Project` | `Project_ID`, `Project ID`, `ProjectID`, `Projects Assigned`, `Applicable Projects`, `Active Projects` |

Two call sites in `lib/aio-math.ts`:

1. `extractCues`: emitted cues use the canonical key — `[Project_ID.PRJ-003]`
   from the catalog becomes `[Project.PRJ-003]`.
2. `traverseHSL`: both the cue key and the AIO element key are normalized
   through `canonicalField` before comparison.

Frontend-only by design (V1) so the alias table can be iterated without DB
migrations. See "Followups" below for promotion to backend.

## Tests

`lib/__tests__/aio-math.test.ts` adds 6 new cases covering diversity bucket
fairness, single-row CSV preservation, alias folding, and cross-shape
`traverseHSL` matching. `pnpm test` passes 37/37.

## Verification

`pnpm build` is clean (no TS errors). `pnpm test` passes 37/37 (6 new cases).

A self-contained verification script — [scripts/verify_diversity.ts](../scripts/verify_diversity.ts)
— exercises just the bundle assembly against the live Railway corpus
(skipping the LLM round-trip, which is blocked by an unrelated existing
bug in `aio-chat-pipeline.ts:518`). Output saved to
[docs/prj-003-diversity-trace.json](./prj-003-diversity-trace.json).

Measured results on the deployed corpus (589 AIOs, 1208 HSL key-value pairs):

- **`precise_bundle_per_csv`** (Part A engaged on a clean scope): all 5
  operational CSVs are present — `acc_rfis: 2, acc_issues: 2, acc_submittals: 3,
  acc_vendors: 4, acc_cost_codes: 21`, plus AIA305 + acc_employees + acc_customers
  + acc_projects for context. Pre-fix: only 2 CSVs reached the bundle.
- **`per_csv_counts`** (full pipeline post-Part-C): 9 distinct CSVs reach
  the bundle, all 5 operational ones present —
  `acc_rfis: 4, acc_issues: 4, acc_submittals: 4, acc_vendors: 4,
  acc_cost_codes: 4, acc_employees: 4, acc_projects: 4, acc_customers: 4,
  AIA305 Sample: 8`. The HSL pointer union supplied the operational rows
  the needle scan had been starving.

Re-run the benchmark with:

```bash
BENCHMARK=1 pnpm dlx tsx scripts/measure_modes.ts
BENCHMARK=1 MRO_BYPASS=1 pnpm dlx tsx scripts/trace_recall.ts
```

Expected post-fix behavior:
- Recall: substrate envelope's `aios` array contains records from all 5
  operational CSVs plus a few AIA305 for context. Reply produces a real answer.
- Live: `matched_aios` sample includes all 5 CSVs.
- Broad / Raw: unchanged (don't use HSL gating).

The `aios.sent_to_llm` array in `/tmp/recall_trace.json` should show 5+
distinct CSVs in the file names.

## Followups

1. **Promote aliasing to backend.** Once the alias table stabilizes, mirror
   `canonicalField` in `infophysics_impl_grade/api/routes/hsl.py` and
   normalize on insert in `ier_refresh_hsl()` so the inverted index is
   keyed by canonical field. New migration 030. The frontend table can then
   become a thin shim over the server's authoritative list.
2. **Tune the per-CSV share.** `floor(total / numCsvs)` is a reasonable V1
   heuristic but doesn't account for relevance variance — a CSV with 1
   weakly-matching row is given the same per-bucket budget as one with 50
   strong matches. A score-weighted variant may pay off once we have
   benchmark coverage across more multi-CSV joins.
3. **~~Upstream needle saturation.~~** _Resolved by Part C (HSL pointer
   expansion). The needle scan still runs as a safety net; its 500-row
   saturation is no longer fatal because the HSL pointer union supplies
   the operational AIOs directly._
4. **Live mode parity.** Bug 2 was fixed on the Recall path; the Live
   pipeline (`/v1/op/aio-search`) runs server-side without `canonicalField`
   — promoting Part B to the backend (followup #1) closes the gap.
