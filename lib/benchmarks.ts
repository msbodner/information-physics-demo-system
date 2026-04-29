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
    title: "Benchmark 1 — Multi-CSV Project Join (PRJ-003)",
    description:
      "Cross-CSV traversal: forces retrieval across acc_rfis, acc_issues, acc_submittals, acc_cost_codes, acc_vendors. Tests HSL pointer index, AIO needle scan, strict filter semantics, and citation grounding.",
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
    prompt: "What roles does James Okafor hold. List projects and financials for each.",
  },
  {
    id: "benchmark3",
    title: "Benchmark 3 — Cross-CSV Financial Rollup (PRJ-002)",
    description:
      "AIA305 + 5 ops CSVs joined on PRJ-002. Tests Jaccard dedup of cross-CSV duplicates, dollar parsing, and the 'gap = ProjectValue − PaidtoDate' computation.",
    prompt: [
      "For Project ID PRJ-002 (Highland Medical Center Expansion):",
      "",
      "1. Pull the AIA305 financial snapshot (one row): ProjectValue, EstimatedValue, Current_Contract_Value, PaidtoDate, Work_Completed, LSP_Total_Contracts, % Performed_by_LSP. Show as a single-line summary.",
      "",
      "2. Compute the gap: ProjectValue − PaidtoDate. State the dollar amount.",
      "",
      "3. List every Open RFI for PRJ-002. For each: ID, Title, Discipline, Submitted By, Assigned To, Cost Impact (Yes/No).",
      "",
      "4. List every Open Issue for PRJ-002. For each: ID, Title, Type, Priority, Reported By, Assigned To.",
      "",
      "5. List every Submittal for PRJ-002 with Status ≠ Approved. Group by Status.",
      "",
      "6. From acc_cost_codes.csv: list every Cost Code whose Applicable Projects field includes PRJ-002. Give Cost Code, Cost Code Name, Division Name, Budgeted Cost (if present).",
      "",
      "Cite every fact with the source AIO row name. Apply each filter strictly.",
    ].join("\n"),
  },
  {
    id: "benchmark4",
    title: "Benchmark 4 — Person Workload (Priya Nair)",
    description:
      "Person cue across 6 fields × 4 CSVs. Tests distinct-count aggregation, role disambiguation, dollar-exposure rollup. MRO short-circuits well after first run.",
    prompt: [
      "What is Priya Nair's complete workload across the system?",
      "",
      "1. Every AIA305 project where Priya Nair appears as Superintendent, ProjectManager, Estimator, ProjectAssistant, or ProjectAccountant. For each: Project ID, Project name, role she holds, ProjectValue, Status.",
      "",
      "2. Every RFI, Issue, and Submittal where Priya Nair is Submitted By, Reported By, Assigned To, or Reviewed By. Group by record type.",
      "",
      "3. Total dollar exposure: sum the ProjectValue of every AIA305 project where she appears in any role. Note which role contributes the most project-count and which contributes the most dollars.",
      "",
      "4. Status mix: of all the projects she touches, what fraction are in each Status? (Active, Completed, In Review, etc.)",
      "",
      "Cite each project by Project ID. If Priya Nair doesn't appear in a given record type, say so explicitly.",
    ].join("\n"),
  },
  {
    id: "benchmark5",
    title: "Benchmark 5 — Comma-list HSL + Strict Filters",
    description:
      "Stresses comma-separated HSL values (acc_cost_codes.Applicable Projects). Three-way AND filter forces 'drop non-matching, no annotation' compliance.",
    prompt: [
      "Find every Cost Code that:",
      "  (a) lists PRJ-005 in its Applicable Projects field, AND",
      "  (b) is in Division 26 (Electrical) OR Division 23 (HVAC), AND",
      "  (c) has a Cost Code Name that includes the word \"Distribution\" or \"Service\".",
      "",
      "For each surviving cost code, return: Cost Code, Cost Code Name, Division, Division Name, Unit of Measure, and the full Applicable Projects list.",
      "",
      "Apply all three filters strictly. Drop non-matching codes silently — do not list them and do not annotate them with a rejection mark. State the filter combination at the top of the response and the count that qualified.",
    ].join("\n"),
  },
  {
    id: "benchmark6",
    title: "Benchmark 6 — Vendor Relationship Graph",
    description:
      "3-hop traversal: vendor → projects → AIA305 financials → submittals back to vendor. Tests indirect-link discovery and vendor-exposure aggregation.",
    prompt: [
      "For Vendor IronWorks Fabrication (VND-007):",
      "",
      "1. From acc_vendors.csv: pull the vendor's full profile — Vendor Type, Trade/Specialty, Status, Primary Contact, City/State, License Number, Insurance Expiry, Bonding Limit, Preferred Vendor flag, and the full Projects Assigned list.",
      "",
      "2. For each Project ID in Projects Assigned, find the AIA305 record (if present) and report: Project name, Owner, Architect, ProjectValue, Status, ConstructionType, Market.",
      "",
      "3. For each of those projects, list any Submittals from acc_submittals.csv where Submitted By = \"IronWorks Fabrication\". For each submittal: Submittal ID, Title, Status, Reviewed By, Lead Time (Weeks).",
      "",
      "4. Total dollar exposure to this single vendor: sum the ProjectValue of every project in Projects Assigned. State the count and total.",
      "",
      "If any link in the chain is missing (e.g. a Projects-Assigned PRJ-id has no AIA305 record), say so by ID rather than guessing.",
    ].join("\n"),
  },
  {
    id: "benchmark7",
    title: "Benchmark 7 — Fuzzy Match Stress",
    description:
      "Deliberate typos / declensions / case shifts in the prompt. Pre-mig-031 returns near-zero HSL hits; post-mig-031 trigram similarity should resolve.",
    prompt: [
      "Find everything in the system about Sara Mitchel (note: this is a deliberate partial spelling — match the closest real person). Then also find:",
      "",
      "  - Every project where the Architech is \"Perkins Will\" or similar (note: the actual spelling may be \"Perkins & Will\" or \"Perkins+Will\" — match all variants).",
      "  - Every project in Texis or Tex (these are typos — match Texas).",
      "  - Every cost code whose Division Name contains \"Electric\" (match Electrical, Electrical Service, etc.).",
      "",
      "For each match, cite the exact stored value alongside the typo'd cue, so I can see where the fuzzy match resolved.",
      "",
      "Final summary: total distinct AIOs returned, and the average similarity score where you can estimate it (full match = 1.0, single-typo match ≈ 0.85, missing-letter match ≈ 0.70).",
    ].join("\n"),
  },
  {
    id: "benchmark8",
    title: "Benchmark 8 — Time-Bounded Portfolio Dashboard",
    description:
      "Heavy AIA305 query: date filter + numeric ranking + top/bottom-N + percentage computation. Good Broad-mode cost test.",
    prompt: [
      "From AIA305 Sample.csv, build a portfolio dashboard for projects with StartDate between 2024-01-01 and 2024-12-31 (inclusive):",
      "",
      "1. Total project count and total ProjectValue across the cohort.",
      "",
      "2. Top 5 projects by ProjectValue. For each: Project_ID, Project name, Owner, Architect, ProjectValue, % Performed_by_LSP.",
      "",
      "3. Bottom 5 projects by % Performed_by_LSP among the top-10-by-ProjectValue. For each: Project_ID, ProjectValue, LSP_Total_Contracts, % Performed_by_LSP.",
      "",
      "4. Status mix of the cohort (count per Status value).",
      "",
      "5. Geographic distribution: count by State, top 5 states by project count.",
      "",
      "6. Construction-type mix (count per ConstructionType value).",
      "",
      "Apply the date filter strictly. State the filter at the top of the response and the surviving count.",
    ].join("\n"),
  },
  {
    id: "benchmark9",
    title: "Benchmark 9 — Data-Quality Audit (Gap Detection)",
    description:
      "Anti-pattern: finds what's NOT there. Tests whether retrieval can return absence answers honestly instead of fabricating.",
    prompt: [
      "Audit data quality across the corpus:",
      "",
      "1. From acc_projects.csv, list every Project record where Project Manager is empty, blank, or unassigned. Give Project ID, Project Name, Status.",
      "",
      "2. From acc_vendors.csv, list every Vendor whose Insurance Expiry is in the past relative to today, or is missing entirely. Give Vendor ID, Vendor Name, Status, Insurance Expiry value.",
      "",
      "3. From AIA305 Sample.csv, count projects where Architect field is empty. Group those by Status (so I can see if it's primarily a backlog issue or a Pre-Construction issue).",
      "",
      "4. From acc_employees.csv, list every Employee whose Projects Assigned field is empty. Give Employee ID, Full Name, Title, Status.",
      "",
      "5. Cross-reference: are there Project IDs referenced in acc_cost_codes Applicable Projects that don't appear as a real Project ID in either acc_projects.csv or AIA305 Sample.csv? List any orphans.",
      "",
      "Cite each finding with a row number. If a category has no records, say \"No records in this category — clean.\"",
    ].join("\n"),
  },
  {
    id: "benchmark10",
    title: "Benchmark 10 — Workflow Trace (PRJ-004 lifecycle)",
    description:
      "Multi-record narrative: RFI → Submittal → Issue lifecycle. Tests Title-overlap detection across record types and chronological reasoning.",
    prompt: [
      "Trace the dependency chain for Project PRJ-004 (Lakeview Elementary School):",
      "",
      "1. List every RFI for PRJ-004. For each: ID, Title, Status, Submitted Date, Due Date, Closed Date (if any), Discipline.",
      "",
      "2. List every Submittal for PRJ-004. For each: ID, Title, Status, Required Date, Returned Date, Notes (full text).",
      "",
      "3. Cross-reference: which Submittals' Notes field references a specific RFI ID? List the (Submittal, Referenced RFI) pairs and indicate whether the referenced RFI is currently Open or Closed. This identifies submittals that are blocked on RFIs.",
      "",
      "4. List every Issue for PRJ-004 (if any).",
      "",
      "5. Construct a brief narrative timeline: \"On Jan 20 RFI-X opened; on Jan 25 it closed; on Jan 25 Submittal Y was submitted referencing it; …\" Sort by Submitted Date and use the actual dates from the records.",
      "",
      "If there's no acc_issues record for PRJ-004, say so explicitly rather than inventing one.",
    ].join("\n"),
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
    // bypassCache=true: benchmarks always want measured tokens, not a
    // cached prior reply. The salt suffix on the query already defeats
    // the cache key, but this is belt-and-braces.
    const r = await aioSearchChat([{ role: "user", content: query }], { bypassCache: true })
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
