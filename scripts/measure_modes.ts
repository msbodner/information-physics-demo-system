/**
 * scripts/measure_modes.ts
 *
 * Single-run measurement of Live Search vs Recall Search against the
 * deployed Railway frontend (which proxies to infophysics-api). Replaces
 * the [est] numbers in the technical report with measured values for one
 * specific query.
 *
 * Run from repo root:
 *   pnpm dlx tsx scripts/measure_modes.ts
 *   (or)  npx tsx scripts/measure_modes.ts
 *
 * Env overrides:
 *   IP_FRONTEND_BASE   default https://informationphysicsdemo.up.railway.app
 *   IP_TENANT_ID       default tenantA
 *   IP_QUERY           default Sarah Mitchell roles/projects/financials query
 */

const FRONTEND_BASE = process.env.IP_FRONTEND_BASE ?? "https://informationphysicsdemo.up.railway.app"
const TENANT_ID = process.env.IP_TENANT_ID ?? "tenantA"
// Append a unique token so the query_hash micro-cache (Live) and the
// MRO short-circuit (Recall) don't serve a prior run's answer back to us.
// We want measured LLM tokens, not "served_from_cache: true".
const SALT = Math.random().toString(36).slice(2, 8)
// Resolution order:
//   1. BENCHMARK=1               → load scripts/benchmark_prompt.txt (the
//                                  multi-CSV PRJ-003 join benchmark; designed
//                                  to exercise HSL pointer index + AIO needle
//                                  scan + MRO priors + filter semantics).
//   2. IP_QUERY="..."           → use that exact string.
//   3. fallback                 → Sarah Mitchell named-entity probe.
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

// ── Fetch shim: rewrite /api/* to the Railway frontend; inject tenant header ──
//
// Also intercepts /api/op/mro-search and short-circuits it to return an
// empty match set. This disables the Recall pipeline's MRO short-circuit
// so we measure a real LLM round-trip rather than a cached prior reply.
const _origFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init: any = {}) => {
  let url = typeof input === "string" ? input : (input as any).url ?? String(input)
  if (url.startsWith("/api/op/mro-search")) {
    return new Response(JSON.stringify({ matches: [] }), {
      status: 200, headers: { "Content-Type": "application/json" }
    })
  }
  if (url.startsWith("/")) url = FRONTEND_BASE + url
  const headers = new Headers(init.headers ?? {})
  if (!headers.has("X-Tenant-Id")) headers.set("X-Tenant-Id", TENANT_ID)
  return _origFetch(url, { ...init, headers })
}) as any

// Imports must come AFTER the fetch shim so the api-client picks it up.
import {
  aioSearchChat,
  chatWithAIO,
  pureLlmChat,
  listAioData,
  listHslKeyValuePairs,
  findHslsByNeedlesFull,
} from "../lib/api-client"
import { parseAioLine } from "../lib/aio-utils"
import { runChatPipeline } from "../lib/aio-chat-pipeline"

function ms() { return Date.now() }
function fmt(n: number) { return n.toLocaleString("en-US") }

async function main() {
  console.log("══════════════════════════════════════════════════════════════")
  console.log("  Information Physics — Mode Comparison Measurement")
  console.log(`  Frontend : ${FRONTEND_BASE}`)
  console.log(`  Tenant   : ${TENANT_ID}`)
  console.log(`  Query    : ${QUERY}`)
  console.log("══════════════════════════════════════════════════════════════\n")

  // ── Live Search ──────────────────────────────────────────────────────
  console.log("▶ LIVE SEARCH (/v1/op/aio-search)")
  const liveT0 = ms()
  // Bypass the query_hash micro-cache so we measure a real LLM round-trip.
  const liveRes = await fetch("/api/op/aio-search?bypass_cache=true", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: QUERY }] }),
  })
  const live = liveRes.ok ? await liveRes.json() : { error: `HTTP ${liveRes.status}` }
  const liveT1 = ms()
  if (!live || "error" in (live as any)) {
    console.error("  Live Search failed:", live)
  } else {
    const r = live as any
    console.log(`  latency_ms      : ${fmt(liveT1 - liveT0)}`)
    console.log(`  model_ref       : ${r.model_ref}`)
    console.log(`  input_tokens    : ${fmt(r.input_tokens ?? 0)}`)
    console.log(`  output_tokens   : ${fmt(r.output_tokens ?? 0)}`)
    console.log(`  matched_hsls    : ${r.matched_hsls}`)
    console.log(`  matched_aios    : ${r.matched_aios}`)
    console.log(`  context_records : ${r.context_records}`)
    console.log(`  served_from_cache: ${r.served_from_cache}`)
    console.log(`  reply (first 240 chars): ${(r.reply ?? "").slice(0, 240).replace(/\n/g, " ")}`)
    ;(globalThis as any).__live = { ...r, latency_ms: liveT1 - liveT0 }
  }

  // ── Recall Search ────────────────────────────────────────────────────
  console.log("\n▶ RECALL SEARCH (substrate-chat via runChatPipeline)")
  const aiosT0 = ms()
  const aios = await listAioData()
  const catalog = await listHslKeyValuePairs()
  const aiosT1 = ms()
  console.log(`  prefetch        : ${fmt(aiosT1 - aiosT0)}ms (aios=${aios.length}, catalog=${catalog.length})`)

  // Convert AioDataRecord[] → ParsedAio[] (mirrors the dialog's parse path).
  const parsedAios = aios.map((r: any) => {
    const raw = r.elements.filter(Boolean).join("")
    const csvRoot = (r.aio_name || "").replace(/\s*-\s*Row\s*\d+$/i, "").replace(/\.csv$/i, "") || "backend"
    const lineMatch = (r.aio_name || "").match(/-\s*Row\s*(\d+)$/i)
    const lineNumber = lineMatch ? parseInt(lineMatch[1], 10) : 0
    return { fileName: r.aio_name, elements: parseAioLine(raw), raw, csvRoot, lineNumber }
  })

  const recallT0 = ms()
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
  const recallT1 = ms()
  if ("error" in result) {
    console.error("  Recall Search failed:", result.error)
  } else {
    console.log(`  latency_ms      : ${fmt(recallT1 - recallT0)}`)
    console.log(`  model_ref       : ${result.model_ref}`)
    console.log(`  input_tokens    : ${fmt(result.input_tokens)}`)
    console.log(`  output_tokens   : ${fmt(result.output_tokens)}`)
    console.log(`  cues            : ${result.cost.cues}  (values: ${result.cue_values.join(", ")})`)
    console.log(`  matched_hsls    : ${result.matched_hsl_ids.length}`)
    console.log(`  neighborhood    : ${result.cost.neighborhood}`)
    console.log(`  priors_used     : ${result.cost.priors}`)
    console.log(`  reply (first 240 chars): ${(result.reply ?? "").slice(0, 240).replace(/\n/g, " ")}`)
    ;(globalThis as any).__recall = { ...result, latency_ms: recallT1 - recallT0, prefetch_ms: aiosT1 - aiosT0 }
  }

  // ── Broad Search (/v1/op/chat) ───────────────────────────────────────
  console.log("\n▶ BROAD SEARCH (/v1/op/chat)")
  const broadT0 = ms()
  const broad = await chatWithAIO([{ role: "user", content: QUERY }])
  const broadT1 = ms()
  if (!broad || "error" in (broad as any)) {
    console.error("  Broad Search failed:", broad)
  } else {
    const r = broad as any
    console.log(`  latency_ms      : ${fmt(broadT1 - broadT0)}`)
    console.log(`  model_ref       : ${r.model_ref}`)
    console.log(`  input_tokens    : ${fmt(r.input_tokens ?? 0)}`)
    console.log(`  output_tokens   : ${fmt(r.output_tokens ?? 0)}`)
    console.log(`  context_records : ${r.context_records}`)
    console.log(`  reply (first 240 chars): ${(r.reply ?? "").slice(0, 240).replace(/\n/g, " ")}`)
    ;(globalThis as any).__broad = { ...r, latency_ms: broadT1 - broadT0 }
  }

  // ── Raw Search (/v1/op/pure-llm) ─────────────────────────────────────
  console.log("\n▶ RAW SEARCH (/v1/op/pure-llm)")
  const rawT0 = ms()
  const raw = await pureLlmChat([{ role: "user", content: QUERY }])
  const rawT1 = ms()
  if (!raw || "error" in (raw as any)) {
    console.error("  Raw Search failed:", raw)
  } else {
    const r = raw as any
    console.log(`  latency_ms      : ${fmt(rawT1 - rawT0)}`)
    console.log(`  model_ref       : ${r.model_ref}`)
    console.log(`  input_tokens    : ${fmt(r.input_tokens ?? 0)}`)
    console.log(`  output_tokens   : ${fmt(r.output_tokens ?? 0)}`)
    console.log(`  context_records : ${r.context_records}`)
    console.log(`  reply (first 240 chars): ${(r.reply ?? "").slice(0, 240).replace(/\n/g, " ")}`)
    ;(globalThis as any).__raw = { ...r, latency_ms: rawT1 - rawT0 }
  }

  // ── Summary table ────────────────────────────────────────────────────
  const L = (globalThis as any).__live
  const R = (globalThis as any).__recall
  const B = (globalThis as any).__broad
  const X = (globalThis as any).__raw
  if (L && R && B && X) {
    console.log("\n══════════════════════════════════════════════════════════════")
    console.log("  Four-Mode Side-by-Side")
    console.log("══════════════════════════════════════════════════════════════")
    const rows: Array<string[]> = [
      ["Metric", "Recall", "Live", "Broad", "Raw"],
      ["latency_ms", fmt(R.latency_ms), fmt(L.latency_ms), fmt(B.latency_ms), fmt(X.latency_ms)],
      ["input_tokens", fmt(R.input_tokens), fmt(L.input_tokens ?? 0), fmt(B.input_tokens ?? 0), fmt(X.input_tokens ?? 0)],
      ["output_tokens", fmt(R.output_tokens), fmt(L.output_tokens ?? 0), fmt(B.output_tokens ?? 0), fmt(X.output_tokens ?? 0)],
      ["context_records", String(R.cost.neighborhood), String(L.context_records ?? 0), String(B.context_records ?? 0), String(X.context_records ?? 0)],
    ]
    const w = [16, 12, 12, 12, 12]
    for (const r of rows) {
      console.log(r.map((c, i) => c.padEnd(w[i])).join(" │ "))
    }
    console.log("\n--- JSON ---")
    console.log(JSON.stringify({ recall: R, live: L, broad: B, raw: X, query: QUERY, ts: new Date().toISOString() }, null, 2))
  }
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1) })
