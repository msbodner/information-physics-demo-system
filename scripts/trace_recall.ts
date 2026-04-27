/**
 * scripts/trace_recall.ts
 *
 * Runs the Sarah Mitchell query through Recall Search (substrate-chat
 * via runChatPipeline) against the deployed Railway frontend and dumps
 * EVERY HSL, AIO, and MRO it touched along the way to a JSON trace.
 *
 * Pairs with /tmp/build_recall_trace_report.js, which renders the
 * trace as a Word technical report.
 *
 *   pnpm dlx tsx scripts/trace_recall.ts
 *
 * Output: /tmp/recall_trace.json
 */

const FRONTEND_BASE = process.env.IP_FRONTEND_BASE ?? "https://informationphysicsdemo.up.railway.app"
const TENANT_ID = process.env.IP_TENANT_ID ?? "tenantA"
const SALT = Math.random().toString(36).slice(2, 8)
// Resolution order — same as measure_modes.ts:
//   1. BENCHMARK=1   → scripts/benchmark_prompt.txt
//   2. IP_QUERY=...  → exact string
//   3. fallback      → Sarah Mitchell named-entity probe
import * as _fs from "node:fs"
import * as _path from "node:path"
function loadBaseQuery(): string {
  if (process.env.BENCHMARK === "1") {
    const p = _path.resolve(__dirname, "benchmark_prompt.txt")
    return _fs.readFileSync(p, "utf8").trim()
  }
  return process.env.IP_QUERY
    ?? "What roles does Sarah Mitchell hold. List projects and financials for each."
}
const BASE_QUERY = loadBaseQuery()
const QUERY = `${BASE_QUERY} (run ${SALT})`

// Fetch shim: rewrite /api/* to Railway, inject tenant header.
//
// MRO_BYPASS=1 stubs /api/op/mro-search inside the pipeline call only,
// forcing the full HSL → AIO → LLM path so we can trace it end-to-end.
// We still hit /api/op/mro-search directly via mroSearch() before the
// pipeline starts, so the trace records what would have short-circuited
// in production.
const MRO_BYPASS = process.env.MRO_BYPASS === "1"
const _origFetch = globalThis.fetch
let stubMroSearch = false
globalThis.fetch = (async (input: any, init: any = {}) => {
  let url = typeof input === "string" ? input : (input as any).url ?? String(input)
  if (stubMroSearch && url.startsWith("/api/op/mro-search")) {
    return new Response(JSON.stringify({ matches: [] }), {
      status: 200, headers: { "Content-Type": "application/json" }
    })
  }
  if (url.startsWith("/")) url = FRONTEND_BASE + url
  const headers = new Headers(init.headers ?? {})
  if (!headers.has("X-Tenant-Id")) headers.set("X-Tenant-Id", TENANT_ID)
  return _origFetch(url, { ...init, headers })
}) as any

import {
  listAioData,
  listHslKeyValuePairs,
  findHslsByNeedlesFull,
  mroSearch,
} from "../lib/api-client"
import { parseAioLine } from "../lib/aio-utils"
import { runChatPipeline } from "../lib/aio-chat-pipeline"

const fs = _fs

async function main() {
  const t0 = Date.now()
  console.log("Recall trace ▶", QUERY)
  console.log("frontend:", FRONTEND_BASE, "tenant:", TENANT_ID)

  // ── Prefetch ─────────────────────────────────────────────────────
  const prefetchStart = Date.now()
  const aios = await listAioData()
  const catalog = await listHslKeyValuePairs()
  const prefetchMs = Date.now() - prefetchStart
  console.log(`prefetch: ${aios.length} aio_data rows, ${catalog.length} HSL key-value pairs (${prefetchMs}ms)`)

  // Convert AioDataRecord → ParsedAio
  const parsedAios = aios.map((r: any) => {
    const raw = r.elements.filter(Boolean).join("")
    const csvRoot = (r.aio_name || "").replace(/\s*-\s*Row\s*\d+$/i, "").replace(/\.csv$/i, "") || "backend"
    const lineMatch = (r.aio_name || "").match(/-\s*Row\s*(\d+)$/i)
    const lineNumber = lineMatch ? parseInt(lineMatch[1], 10) : 0
    return { fileName: r.aio_name, elements: parseAioLine(raw), raw, csvRoot, lineNumber }
  })

  // ── Direct MRO-search probe ──────────────────────────────────────
  // Run it ourselves so we capture every prior the backend returned,
  // not just the ones the pipeline kept after thresholding.
  const mroProbe = await mroSearch(QUERY, { k: 10 })
  const mroProbeHits = mroProbe?.matches ?? []
  console.log(`mro-search: ${mroProbeHits.length} hit(s)`)

  // ── Resolve HSLs by needle directly (so we can show per-cue HSL hits) ──
  // The pipeline does this internally; we replicate it here so the
  // trace can show which cue produced which HSLs.
  // We cannot intercept inside runChatPipeline without forking it, so
  // we run it once for the report and extract cues from the result,
  // then probe each cue separately for the trace.

  // ── Run the actual pipeline ──────────────────────────────────────
  // Toggle the MRO stub on iff requested; we already captured the real
  // hits via the direct probe above.
  if (MRO_BYPASS) {
    stubMroSearch = true
    console.log("MRO_BYPASS=1 → stubbing /api/op/mro-search inside pipeline (will exercise full HSL/AIO traversal)")
  }
  const pipeStart = Date.now()
  const result = await runChatPipeline(QUERY, parsedAios as any, {
    maxPriors: 3,
    maxAios: 40,
    saveMRO: false,
    hslCatalog: catalog,
    resolveHsls: async (cueValues, signal) => {
      const rows = await findHslsByNeedlesFull(cueValues, { signal })
      return rows.map((r) => ({ hsl_name: r.hsl_name, elements: r.elements, hsl_id: r.hsl_id }))
    },
  })
  const pipeMs = Date.now() - pipeStart

  if ("error" in result) {
    console.error("pipeline failed:", result.error)
    process.exit(2)
  }

  // ── Per-cue HSL trace (after we know the cues) ───────────────────
  const perCueHsls: Array<{ cue: string; hsls: any[] }> = []
  for (const cue of result.cue_values) {
    const rows = await findHslsByNeedlesFull([cue])
    perCueHsls.push({
      cue,
      hsls: rows.map((r) => ({
        hsl_id: r.hsl_id,
        hsl_name: r.hsl_name,
        // First 8 non-null element labels — enough to identify the HSL
        // without dumping all 100 columns.
        sample_elements: (r.elements ?? []).filter(Boolean).slice(0, 8),
      })),
    })
    console.log(`  cue "${cue}" → ${rows.length} HSL(s)`)
  }

  // ── Build trace ──────────────────────────────────────────────────
  const trace = {
    query: QUERY,
    ts: new Date().toISOString(),
    frontend: FRONTEND_BASE,
    tenant: TENANT_ID,
    timing_ms: {
      prefetch: prefetchMs,
      pipeline: pipeMs,
      total: Date.now() - t0,
    },
    corpus: {
      aio_count: aios.length,
      hsl_keyvalue_pairs: catalog.length,
    },
    cues: {
      values: result.cue_values,
      count: result.cue_values.length,
    },
    mro_search: {
      probe_hits: mroProbeHits.map((h: any) => ({
        mro_id: h.mro_id,
        score: h.score,
        query_text: h.query_text,
        confidence: h.confidence,
        trust_score: h.trust_score,
        cue_set: h.cue_set,
        result_preview: (h.result_text ?? "").slice(0, 240),
      })),
      priors_used: result.priors_used.map((p: any) => ({
        mro_id: p.mro?.mro_id,
        score: p.score,
        relevance: p.relevance,
        freshness: p.freshness,
        confidence: p.mro?.confidence,
        query: p.mro?.query_text,
        result_preview: (p.mro?.result_text ?? "").slice(0, 240),
      })),
    },
    hsls: {
      matched_count: result.matched_hsl_ids.length,
      neighborhood_names: result.bundle.hsl_neighborhoods,
      per_cue: perCueHsls,
    },
    aios: {
      neighborhood_size: result.cost.neighborhood,
      sent_to_llm: result.bundle.seed_aios.map((a: any) => ({
        fileName: a.fileName,
        raw: a.raw,
      })),
    },
    llm: {
      model_ref: result.model_ref,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      total_tokens: result.input_tokens + result.output_tokens,
    },
    cost: result.cost,
    reply: result.reply,
  }

  const out = "/tmp/recall_trace.json"
  fs.writeFileSync(out, JSON.stringify(trace, null, 2))
  console.log(`\nWROTE ${out}`)
  console.log(`  cues=${trace.cues.count}  hsls=${trace.hsls.matched_count}  aios_sent=${trace.aios.sent_to_llm.length}  priors=${trace.mro_search.priors_used.length}  in/out=${trace.llm.input_tokens}/${trace.llm.output_tokens}`)
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1) })
