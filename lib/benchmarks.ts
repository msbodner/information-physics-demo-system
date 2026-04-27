/**
 * lib/benchmarks.ts
 *
 * In-app benchmark runner. Runs a single prompt through all four
 * ChatAIO modes (Recall, Live, Broad, Raw) and returns measured
 * latency / token / context-size data plus the verbatim replies.
 *
 * This is the browser-side counterpart to scripts/measure_modes.ts.
 * Both must stay in sync — the script is the CI-friendly Node entry,
 * this module is what the R&D BenchmarkRunner button calls.
 */

import {
  aioSearchChat,
  chatWithAIO,
  pureLlmChat,
  listAioData,
  listHslKeyValuePairs,
  findHslsByNeedlesFull,
  type AioSearchResponse,
  type ChatResponse,
} from "./api-client"
import { parseAioLine, type ParsedAio } from "./aio-utils"
import { runChatPipeline } from "./aio-chat-pipeline"

// ── Saved benchmark prompts ──────────────────────────────────────────
//
// Two complementary benchmarks. The first stresses cross-CSV diversity
// (5-CSV join keyed on Project ID); the second stresses person-centric
// retrieval through the HSL pointer index.

export interface Benchmark {
  id: string
  title: string
  description: string
  prompt: string
}

export const BENCHMARKS: Benchmark[] = [
  {
    id: "benchmark1",
    title: "Benchmark 1 — Multi-CSV Project Join",
    description:
      "PRJ-003 cross-CSV traversal: forces retrieval across acc_rfis, acc_issues, acc_submittals, acc_cost_codes, acc_vendors. Tests HSL pointer index, AIO needle scan, strict filter semantics, and citation grounding.",
    prompt: [
      "For Project ID PRJ-003 (Greenway Office Park - Phase 2):",
      "",
      "1. List every Open RFI and every Open Issue tied to this project. For each, give: ID, Title, Assigned To, Priority, and Due Date.",
      "",
      "2. Group those open items by Assigned To and report a count per person.",
      "",
      "3. List every Cost Code whose Applicable Projects field names PRJ-003. Give Cost Code, Cost Code Name, and Division Name.",
      "",
      "4. List every Vendor whose Projects Assigned field names PRJ-003. Give Vendor ID, Vendor Name, Status, and Trade/Specialty.",
      "",
      "5. From the Submittal records for PRJ-003, give a count grouped by Status.",
      "",
      "6. Across all six person fields touched by PRJ-003 - RFI Submitted By, RFI Assigned To, Issue Reported By, Issue Assigned To, Submittal Submitted By, Submittal Reviewed By - report the total count of distinct people who appear in any record tied to PRJ-003, and list them.",
      "",
      "Apply each filter strictly: do not list non-matching items, do not annotate them with a rejection mark. Counts must reflect only surviving records. Cite each fact with the source AIO file name (for example: acc_rfis.csv - Row 162).",
    ].join("\n"),
  },
  {
    id: "benchmark2",
    title: "Benchmark 2 — Named-Entity Person Probe",
    description:
      "Person-centric traversal: 'What roles does James Okafor hold?' Tests HSL pointer-index hits for short-token cues, AIA305 dominance behavior, and MRO short-circuit threshold tuning.",
    prompt:
      "What roles does James Okafor hold. List projects and financials for each.",
  },
]

// ── Result shape ─────────────────────────────────────────────────────

export interface ModeResult {
  mode: "Recall" | "Live" | "Broad" | "Raw"
  ok: boolean
  reply: string
  model_ref: string
  input_tokens: number
  output_tokens: number
  context_records: number
  latency_ms: number
  error?: string
}

export interface BenchmarkResult {
  prompt: string
  ts: string
  modes: ModeResult[]
}

// ── Runner ───────────────────────────────────────────────────────────
//
// We salt the user-facing prompt with a random suffix to defeat the
// per-query micro-caches on both pipelines, so each run produces real
// measured tokens rather than a cached reply replay. The salt is
// invisible in the displayed prompt because we strip it before
// rendering the title/badge but pass the salted form to the LLMs.

function salt(): string {
  return Math.random().toString(36).slice(2, 8)
}

// Normalize any error shape (string, plain Error, or backend JSON
// envelope like the budget-exceeded {error, tenant_id, used_today,
// limit, percent_used, message}) into a single human-readable string.
// Never returns an object — we render this directly into JSX, and a
// raw object trips React error #31.
function asErrorString(e: unknown): string {
  if (e == null) return "unknown_error"
  if (typeof e === "string") return e
  if (e instanceof Error) return e.message || String(e)
  if (typeof e === "object") {
    const o = e as Record<string, unknown>
    // Prefer a human message field, then the error code, then the JSON.
    if (typeof o.message === "string" && o.message) return String(o.message)
    if (typeof o.error === "string" && o.error) return String(o.error)
    try { return JSON.stringify(o) } catch { return String(o) }
  }
  return String(e)
}

async function runRecall(query: string): Promise<ModeResult> {
  const t0 = Date.now()
  try {
    const aios = await listAioData()
    const catalog = await listHslKeyValuePairs()
    const parsedAios: ParsedAio[] = aios.map((r) => {
      const raw = r.elements.filter(Boolean).join("")
      const csvRoot = (r.aio_name || "").replace(/\s*-\s*Row\s*\d+$/i, "").replace(/\.csv$/i, "") || "backend"
      const lineMatch = (r.aio_name || "").match(/-\s*Row\s*(\d+)$/i)
      const lineNumber = lineMatch ? parseInt(lineMatch[1], 10) : 0
      return { fileName: r.aio_name, elements: parseAioLine(raw), raw, csvRoot, lineNumber }
    })
    const result = await runChatPipeline(query, parsedAios, {
      maxPriors: 3,
      maxAios: 40,
      saveMRO: false,
      hslCatalog: catalog,
      resolveHsls: async (cueValues, signal) => {
        const rows = await findHslsByNeedlesFull(cueValues, { signal })
        return rows.map((r) => ({ hsl_name: r.hsl_name, elements: r.elements, hsl_id: r.hsl_id }))
      },
    })
    const latency_ms = Date.now() - t0
    if ("error" in result) {
      return { mode: "Recall", ok: false, reply: "", model_ref: "—", input_tokens: 0, output_tokens: 0, context_records: 0, latency_ms, error: asErrorString(result.error) }
    }
    return {
      mode: "Recall",
      ok: true,
      reply: result.reply,
      model_ref: result.model_ref,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      context_records: result.cost.neighborhood,
      latency_ms,
    }
  } catch (e: any) {
    return { mode: "Recall", ok: false, reply: "", model_ref: "—", input_tokens: 0, output_tokens: 0, context_records: 0, latency_ms: Date.now() - t0, error: asErrorString(e) }
  }
}

async function runLive(query: string): Promise<ModeResult> {
  const t0 = Date.now()
  try {
    const r = await aioSearchChat([{ role: "user", content: query }])
    const latency_ms = Date.now() - t0
    if (!r || "error" in (r as any)) {
      return { mode: "Live", ok: false, reply: "", model_ref: "—", input_tokens: 0, output_tokens: 0, context_records: 0, latency_ms, error: asErrorString(r ?? "no_response") }
    }
    const x = r as AioSearchResponse
    return {
      mode: "Live",
      ok: true,
      reply: x.reply ?? "",
      model_ref: x.model_ref ?? "—",
      input_tokens: x.input_tokens ?? 0,
      output_tokens: x.output_tokens ?? 0,
      context_records: x.context_records ?? 0,
      latency_ms,
    }
  } catch (e: any) {
    return { mode: "Live", ok: false, reply: "", model_ref: "—", input_tokens: 0, output_tokens: 0, context_records: 0, latency_ms: Date.now() - t0, error: asErrorString(e) }
  }
}

async function runBroad(query: string): Promise<ModeResult> {
  const t0 = Date.now()
  try {
    const r = await chatWithAIO([{ role: "user", content: query }])
    const latency_ms = Date.now() - t0
    if (!r || "error" in (r as any)) {
      return { mode: "Broad", ok: false, reply: "", model_ref: "—", input_tokens: 0, output_tokens: 0, context_records: 0, latency_ms, error: asErrorString(r ?? "no_response") }
    }
    const x = r as ChatResponse
    return {
      mode: "Broad",
      ok: true,
      reply: x.reply ?? "",
      model_ref: x.model_ref ?? "—",
      input_tokens: x.input_tokens ?? 0,
      output_tokens: x.output_tokens ?? 0,
      context_records: (x as any).context_records ?? 0,
      latency_ms,
    }
  } catch (e: any) {
    return { mode: "Broad", ok: false, reply: "", model_ref: "—", input_tokens: 0, output_tokens: 0, context_records: 0, latency_ms: Date.now() - t0, error: asErrorString(e) }
  }
}

async function runRaw(query: string): Promise<ModeResult> {
  const t0 = Date.now()
  try {
    const r = await pureLlmChat([{ role: "user", content: query }])
    const latency_ms = Date.now() - t0
    if (!r || "error" in (r as any)) {
      return { mode: "Raw", ok: false, reply: "", model_ref: "—", input_tokens: 0, output_tokens: 0, context_records: 0, latency_ms, error: asErrorString(r ?? "no_response") }
    }
    const x = r as ChatResponse
    return {
      mode: "Raw",
      ok: true,
      reply: x.reply ?? "",
      model_ref: x.model_ref ?? "—",
      input_tokens: x.input_tokens ?? 0,
      output_tokens: x.output_tokens ?? 0,
      context_records: (x as any).context_records ?? 0,
      latency_ms,
    }
  } catch (e: any) {
    return { mode: "Raw", ok: false, reply: "", model_ref: "—", input_tokens: 0, output_tokens: 0, context_records: 0, latency_ms: Date.now() - t0, error: asErrorString(e) }
  }
}

/**
 * Run one benchmark prompt through all four modes sequentially.
 *
 * Sequential (not parallel) because the four modes share the same
 * Anthropic key and we don't want concurrent calls to interfere with
 * each other's token accounting or trip rate limits. Each mode reports
 * its own wall-clock latency.
 */
export async function runFourModes(promptBase: string): Promise<BenchmarkResult> {
  const query = `${promptBase} (run ${salt()})`
  const modes: ModeResult[] = []
  modes.push(await runRecall(query))
  modes.push(await runLive(query))
  modes.push(await runBroad(query))
  modes.push(await runRaw(query))
  return {
    prompt: promptBase,
    ts: new Date().toISOString(),
    modes,
  }
}
