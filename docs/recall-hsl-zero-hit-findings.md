# Recall Search HSL Pointer Index Returns Zero Hits — Diagnosis

Date: 2026-04-27
Scope: Substrate Mode (Recall Search) / `runChatPipeline` HSL resolution path
Trace artifact: `/tmp/recall_trace.json` (run salt records 149 cues, 0 HSL hits, 355 AIO needle hits)
Verification queries used: "What roles does Sarah Mitchell hold..." and the James Okafor variant.

## TL;DR

`POST /v1/hsl-data/find-by-needles-full` is **dead** for HSL lookups. The
inverted index it probes (`information_element_refs`, populated by
`ier_refresh_hsl` from migration 017) only indexes element strings that are
themselves in `[Key.Value]` bracket form. HSL element columns never carry
bracket tokens — they store AIO row references like
`acc_rfis.csv - Row 164` — so the index never gains an HSL row to match.
Cue extraction is producing perfectly good exact tokens ("James Okafor",
"Orlando", "Director of Projects"); the matcher is the problem, not the
cues.

The pipeline is silently degraded but functional because the parallel
`findAiosByNeedles` path uses `aio_data.elements_text` (the trigram-indexed
`lower(...)` generated column from migration 016), not the broken inverted
index.

## Reproduction

```bash
# Production Railway tenantA
curl -X POST .../api/hsl-data/find-by-needles-full \
  -d '{"values":["James Okafor"]}'                   # → []

curl -X POST .../api/hsl-data/find-by-needles \
  -d '{"needles":["James Okafor"],"limit":5}'        # → 5 hsl_ids

curl .../api/hsl-data/key-value-pairs | grep "James Okafor"
# → {"key":"Assigned To","value":"James Okafor"}     ← value DOES exist in HSL topology
```

The HSL `[Assigned To.James Okafor].hsl` exists, the value "James Okafor"
appears in 1208 catalog pairs, the legacy `find-by-needles` (LIKE on the
`elements_text` GIN) finds it, but the migration-017 inverted-index
endpoint cannot.

## Root Cause

`infophysics_impl_grade/migrations/017_information_element_refs.sql`
defines `ier_refresh_hsl(p_hsl_id)`:

```sql
FOR i IN 1..100 LOOP
  col_val := row_json->>('hsl_element_' || i);
  IF col_val IS NULL ... CONTINUE; END IF;
  FOR parsed IN SELECT * FROM ier_parse_bracket(col_val) LOOP
    INSERT INTO information_element_refs ... ;
  END LOOP;
END LOOP;
```

`ier_parse_bracket` only emits a row when the input matches `[Key.Value]`.
Looking at actual HSL rows in production:

```
hsl_name : [Assigned To.Chen Wei].hsl
elements : ['acc_issues.csv - Row 149', 'acc_rfis.csv - Row 161', ...]
```

None of those AIO-name strings parse, so **zero refs rows are written for
this HSL**. The only HSL refs that ever land in the index are `[MRO.<id>]`
back-links from `link_mro_to_hsl` — useless for cue→HSL lookup.

Meanwhile the AIO half of the same trigger works correctly because AIO
element columns *do* contain bracket tokens (`[OriginalCSV.acc_rfis.csv]`,
`[FileDate.2026-03-08]`, …). So `findAiosByNeedles` against the same
inverted index returns 355 hits and rescues retrieval.

## Answers to the Investigation Questions

### 1. Bug or design choice?

**Bug.** Migration 017's docstring describes the index as the fast path
for HSL Phase 2 retrieval ("Phase 2 then becomes: SELECT DISTINCT hsl_id
FROM information_element_refs WHERE value_lower = ANY(%s)"). The intent
was clearly to index the HSL's own (Key, Value) — derived from `hsl_name`
— so a probe like `value_lower = 'james okafor'` returns the HSL whose
name is `[Assigned To.James Okafor].hsl`. The implementation parses
element columns instead, which carry the wrong shape of data. The two
sides of the trigger (`ier_refresh_hsl` vs. `ier_refresh_aio`) were
copy-pasted without recognising that the column semantics differ:

* `aio_data.element_*` → bracket tokens. Parser works.
* `hsl_data.hsl_element_*` → AIO name refs. Parser silently no-ops.
* `hsl_data.hsl_name` → bracket token. **Never read by the function.**

### 2. Where's the mismatch?

The matcher is too strict, but more importantly it is matching against
the **wrong corpus**. Cue extraction is healthy — it produces values like
"James Okafor", "Orlando", "Director of Projects" which are exact HSL
values present in `key-value-pairs`. The cues are not the problem.

Yes, ~84 of 149 cues in the trace are sentence-shaped ("FPE added devices
on SK-FA-09…") and would never exact-match anyway, but those are the
*long tail* of `extractCues`'s reverse-substring fallback (aio-math.ts
lines 250–266). Even if they didn't match, the ~65 short cues that ARE
exact HSL values should have produced 50+ HSL hits. They produce zero
because the index is empty.

### 3. Right fix

| Option | What it changes | Verdict |
|---|---|---|
| (a) Tokenize cues at extraction | aio-math.ts `extractCues` | **Wrong layer.** Cues are already correct exact tokens for the values that matter. Tokenizing further would discard multi-word values like "James Okafor" or "Director of Projects". |
| (b) Add ILIKE/trigram endpoint | New backend route | Not needed — the trigram GIN on `value_lower` already exists. The data the index points at is just empty for HSLs. |
| **(c) Fix index population** | `ier_refresh_hsl` parses `hsl_name` (and `hsl_element_*` if any are bracket-form) | **Correct fix.** Restores the original migration-017 intent. Single-place change. Backfill via re-run of the migration's DO-block. |

**Recommended fix (option c):**

```sql
CREATE OR REPLACE FUNCTION ier_refresh_hsl(p_hsl_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  row_json jsonb;
  row_tenant text;
  hsl_name_local text;
  i int;
  col_val text;
  parsed record;
BEGIN
  DELETE FROM information_element_refs WHERE hsl_id = p_hsl_id;

  SELECT to_jsonb(h.*), h.tenant_id, h.hsl_name
    INTO row_json, row_tenant, hsl_name_local
    FROM hsl_data h WHERE h.hsl_id = p_hsl_id;
  IF row_json IS NULL THEN RETURN; END IF;

  -- NEW: index the HSL's own [Key.Value] derived from hsl_name.
  -- The .hsl suffix is stripped first so the bracket parser sees a
  -- clean token.  position=0 marks "this came from the name itself."
  IF hsl_name_local IS NOT NULL THEN
    FOR parsed IN SELECT * FROM ier_parse_bracket(
      regexp_replace(hsl_name_local, '\.hsl$', '')
    ) LOOP
      INSERT INTO information_element_refs
        (tenant_id, field_name, value, value_lower, hsl_id, aio_id, position)
      VALUES
        (row_tenant, parsed.field_name, parsed.value,
         lower(parsed.value), p_hsl_id, NULL, 0);
    END LOOP;
  END IF;

  -- Existing element-column scan stays for HSLs whose elements carry
  -- bracket-form refs ([MRO.<id>] back-links and any future shape).
  FOR i IN 1..100 LOOP
    col_val := row_json->>('hsl_element_' || i);
    IF col_val IS NULL OR length(trim(col_val)) = 0 THEN CONTINUE; END IF;
    FOR parsed IN SELECT * FROM ier_parse_bracket(col_val) LOOP
      INSERT INTO information_element_refs
        (tenant_id, field_name, value, value_lower, hsl_id, aio_id, position)
      VALUES
        (row_tenant, parsed.field_name, parsed.value,
         lower(parsed.value), p_hsl_id, NULL, i);
    END LOOP;
  END LOOP;
END;
$$;
```

Ship this as a new migration `029_fix_hsl_ier_index.sql` that:
1. Replaces `ier_refresh_hsl` with the version above.
2. Re-runs the backfill `FOR r IN SELECT hsl_id, tenant_id FROM hsl_data` block from migration 017 to repopulate.
3. Is idempotent (the `DELETE FROM information_element_refs WHERE hsl_id = …` inside the function makes re-running safe).

No frontend or pipeline change needed. No version bump. The trigger
hookup from migration 017 still applies, so future HSL inserts/updates
will repopulate correctly.

### 4. Cost of leaving it alone

The HSL → cue → AIO traversal currently collapses to "AIO needle scan
with extra steps" for every Substrate Mode query. Concretely, on the
trace at `/tmp/recall_trace.json`:

* `cues = 149`, `matched_hsl_ids = 0`, `hsl_neighborhoods = 0`
* `traversal_cost = 0` from HSL gating (the assembleBundle `hslGate` flag
  is supplied but its boost map is empty, so `if (gated.length > 0)`
  never triggers and `ranked` stays at the AIO-similarity ordering)
* The `findAiosByNeedles` fallback finds 355 AIOs, gets sliced to 40,
  and the LLM answers correctly.

So the production-visible cost today is:
* ~150 wasted HTTP round-trips per query (the `findHslsByNeedlesFull`
  per-cue probes via `resolveHsls` in `trace_recall.ts` and the analogous
  call site in production). Each round-trips an empty result.
* HSL ranking signal (`computeHslBoost`) is permanently zero — AIO
  ordering inside the bundle is purely traversal-rank, so the documented
  "10–20% lift on ranking quality" from `aio-math.ts:128` is not being
  realised.
* `getMatchedHslIds` returns `[]`, so newly-saved MROs are never
  back-linked to their source HSLs (`POST /v1/hsl-data/{id}/link-mro` is
  effectively never called from Recall). MRO↔HSL lineage is broken for
  every Substrate-Mode answer, only repaired (if at all) by the legacy
  AIO Search path.

It is not strictly a correctness bug for the user-visible answer, but it
is a complete negation of the HSL retrieval layer for this code path,
and it should be fixed.

## Decision

Fix is option (c). It's a backend SQL change with a backfill DO-block,
which the investigation brief classifies as "larger — STOP at the
recommendation." Not implementing in this pass. Frontend cue extraction
needs no change.

## Files Cited

* `lib/aio-chat-pipeline.ts:285–438` — `runChatPipeline`, `resolveHsls` call site
* `lib/aio-math.ts:179–269` — `extractCues` (correct as-is)
* `lib/aio-math.ts:134–165` — `computeHslBoost` (consumes the empty resolver output)
* `infophysics_impl_grade/api/routes/hsl.py:348–384` — `find-by-needles-full` endpoint (correct as a query; index is empty)
* `infophysics_impl_grade/migrations/017_information_element_refs.sql:93–120` — `ier_refresh_hsl` (the bug)
* `scripts/trace_recall.ts:117–132` — per-cue HSL probe loop (exposes the symptom)
