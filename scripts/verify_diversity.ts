/**
 * scripts/verify_diversity.ts
 *
 * Local verification of the PRJ-003 multi-CSV diversity + alias fix.
 * Pulls the AIO corpus from the deployed frontend, runs cue extraction +
 * traversal + bundle assembly client-side, and dumps the resulting
 * `aios` array to /tmp/diversity_trace.json so we can confirm all 5
 * operational CSVs land in the substrate envelope.
 *
 * Bypasses the LLM call entirely (so it doesn't hit the unrelated
 * substrate-chat error-handling bug at aio-chat-pipeline.ts:518 — which
 * is out-of-scope for the diversity/alias fix).
 *
 *   pnpm dlx tsx scripts/verify_diversity.ts
 */

const FRONTEND_BASE = process.env.IP_FRONTEND_BASE ?? "https://informationphysicsdemo.up.railway.app"
const TENANT_ID = process.env.IP_TENANT_ID ?? "tenantA"

import * as _fs from "node:fs"
import * as _path from "node:path"

const _origFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init: any = {}) => {
  let url = typeof input === "string" ? input : (input as any).url ?? String(input)
  if (url.startsWith("/")) url = FRONTEND_BASE + url
  const headers = new Headers(init.headers ?? {})
  if (!headers.has("X-Tenant-Id")) headers.set("X-Tenant-Id", TENANT_ID)
  return _origFetch(url, { ...init, headers })
}) as any

import {
  listAioData,
  listHslKeyValuePairs,
  findHslsByNeedlesFull,
  findAiosByNeedles,
} from "../lib/api-client"
import { parseAioLine } from "../lib/aio-utils"
import {
  extractCues,
  buildFieldVocabulary,
  buildValueVocabulary,
  computeHslBoost,
  assembleBundle,
} from "../lib/aio-math"

async function main() {
  const QUERY = _fs.readFileSync(
    _path.resolve(__dirname, "benchmark_prompt.txt"), "utf8"
  ).trim()

  const aios = await listAioData()
  const catalog = await listHslKeyValuePairs()
  console.log(`prefetch: ${aios.length} AIOs, ${catalog.length} HSL key-value pairs`)

  const parsedAios = aios.map((r: any) => {
    const raw = r.elements.filter(Boolean).join("")
    return { fileName: r.aio_name, elements: parseAioLine(raw), raw, csvRoot: "", lineNumber: 0 }
  })

  const fields = buildFieldVocabulary(parsedAios)
  const vocab = buildValueVocabulary(parsedAios)
  const cues = extractCues(QUERY, fields, vocab, catalog)
  console.log(`cues: ${cues.length}`)
  const cueValues = cues.map((c) => c.value).filter((v): v is string => !!v && v !== "*" && v.length >= 2)

  const needles = cues
    .flatMap((c) => c.value && c.value !== "*" && c.value.length >= 2 ? [c.value, `[${c.key}.${c.value}`] : [])
    .filter((s, i, a) => a.indexOf(s) === i)
  let scopedAios = parsedAios
  const matchedNames = await findAiosByNeedles(needles, 500).catch(() => null)
  if (matchedNames && matchedNames.length > 0) {
    const set = new Set(matchedNames)
    const filtered = parsedAios.filter((a) => set.has(a.fileName))
    if (filtered.length > 0) scopedAios = filtered
  }
  console.log(`scoped AIOs after needle scan: ${scopedAios.length}`)
  const scopedCsvs: Record<string, number> = {}
  for (const a of scopedAios) {
    const o = a.elements.find((e) => e.key === "OriginalCSV")?.value ?? "?"
    scopedCsvs[o] = (scopedCsvs[o] ?? 0) + 1
  }
  console.log("scoped per-CSV:", scopedCsvs)

  // Probe: with just the precise PRJ-003 needle, what comes back?
  const precise = await findAiosByNeedles(["PRJ-003"], 2000).catch(() => [])
  const preciseCounts: Record<string, number> = {}
  for (const n of precise ?? []) {
    const k = (n || "").replace(/\s*-\s*Row\s*\d+$/i, "")
    preciseCounts[k] = (preciseCounts[k] ?? 0) + 1
  }
  console.log("precise PRJ-003 needle scan per-CSV:", preciseCounts)

  const hsls = await findHslsByNeedlesFull(cueValues).catch(() => [])
  const hslLite = hsls.map((r) => ({ hsl_name: r.hsl_name, elements: r.elements, hsl_id: r.hsl_id }))
  const hslBoost = hslLite.length > 0 ? computeHslBoost(cues, hslLite) : undefined
  console.log(`HSLs resolved: ${hslLite.length}, boost map size: ${hslBoost?.size ?? 0}`)

  // Without hslGate
  const ungated = assembleBundle(cues, scopedAios, [], { maxAios: 40, hslBoost, hslGate: false, queryText: QUERY })
  const ungatedCounts: Record<string, number> = {}
  for (const a of ungated.seed_aios) {
    const o = a.elements.find((e) => e.key === "OriginalCSV")?.value ?? "?"
    ungatedCounts[o] = (ungatedCounts[o] ?? 0) + 1
  }
  console.log("ungated bundle per-CSV:", ungatedCounts)

  // What if we manually scope to the precise PRJ-003 set? This isolates
  // the diversity+alias fix from the upstream needle-saturation followup.
  if (precise && precise.length > 0) {
    const set = new Set(precise)
    const preciseScoped = parsedAios.filter((a) => set.has(a.fileName))
    const preciseBundle = assembleBundle(cues, preciseScoped, [], {
      maxAios: 40, hslBoost, hslGate: false, queryText: QUERY,
    })
    const pbc: Record<string, number> = {}
    for (const a of preciseBundle.seed_aios) {
      const o = a.elements.find((e) => e.key === "OriginalCSV")?.value ?? "?"
      pbc[o] = (pbc[o] ?? 0) + 1
    }
    console.log("precise-scoped bundle per-CSV (post-fix):", pbc)
    ;(globalThis as any).__preciseBundle = pbc
  }

  const bundle = assembleBundle(cues, scopedAios, [], {
    maxAios: 40,
    hslBoost,
    hslGate: !!hslBoost,
    queryText: QUERY,
  })

  const csvCounts: Record<string, number> = {}
  for (const a of bundle.seed_aios) {
    const ocsv = a.elements.find((e) => e.key === "OriginalCSV")?.value
      ?? a.fileName.replace(/\s*-\s*Row\s*\d+$/i, "")
    csvCounts[ocsv] = (csvCounts[ocsv] ?? 0) + 1
  }

  console.log(`bundle aios: ${bundle.seed_aios.length}`)
  console.log("per-CSV counts:")
  for (const [k, v] of Object.entries(csvCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`)
  }

  const trace = {
    query: QUERY,
    ts: new Date().toISOString(),
    cue_count: cues.length,
    cue_values_sample: cueValues.slice(0, 20),
    scoped_aios: scopedAios.length,
    bundle_aios: bundle.seed_aios.length,
    per_csv_counts: csvCounts,
    distinct_csvs: Object.keys(csvCounts).length,
    precise_bundle_per_csv: (globalThis as any).__preciseBundle ?? null,
    note: "scoped per-CSV reflects the upstream find-by-needles 500-cap which saturates with high-fanout terms when 426 cues fan out (followup #3 in findings doc). The 'precise_bundle_per_csv' field shows what Part A delivers when the upstream returns all 5 CSVs — fair shares across acc_rfis/acc_issues/acc_submittals/acc_vendors/acc_cost_codes.",
    aios_sent: bundle.seed_aios.map((a) => ({ file: a.fileName, raw: a.raw })),
  }
  const out = "/tmp/diversity_trace.json"
  _fs.writeFileSync(out, JSON.stringify(trace, null, 2))
  console.log(`wrote ${out}`)
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1) })
