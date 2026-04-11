// TypeScript port of mro_rtf_to_csv_recovered.py — parses an MRO context_bundle
// (bracket-notation plain text) into seven structured tables for display.
//
// Handles the same sections the Python script supports:
//   metadata, employee_profile, projects, issues_observations, rfis, submittals, invoices
//
// The input is a context_bundle string that looks like:
//   [MROKey.HSL-3-AIO-47][Query.Tell me about Sarah]
//   [Result.**Full Name:** Sarah Mitchell ... ## Projects Assigned ...]
//   [SearchTerms.{...}][SeedHSLs.3 HSLs][MatchedAIOs.47][Confidence.derived][Timestamp.2026-...]

export type TableRow = Record<string, string>

export interface DerivedSection {
  heading: string
  content: string
}

export interface ResearchResult {
  metadata: TableRow[]
  employee_profile: TableRow[]
  projects: TableRow[]
  issues_observations: TableRow[]
  rfis: TableRow[]
  submittals: TableRow[]
  invoices: TableRow[]
  // Derived-mode extras (populated when context_bundle is missing/empty)
  derived?: boolean
  key_facts?: TableRow[]
  sections?: DerivedSection[]
  raw_result?: string
}

export const TABLE_NAMES = [
  "metadata",
  "employee_profile",
  "projects",
  "issues_observations",
  "rfis",
  "submittals",
  "invoices",
] as const

export type TableName = typeof TABLE_NAMES[number]

// ── text normalization ──────────────────────────────────────────

function normalizeText(text: string): string {
  let t = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  t = t.replace(/\u00a0/g, " ")
  t = t.replace(/\| \|/g, "|")
  t = t.replace(/[ \t]+/g, " ")
  t = t.replace(/\n{3,}/g, "\n\n")
  return t.trim()
}

// ── section extraction ─────────────────────────────────────────
// Mirrors extract_sections() — finds `[MROKey.`, `[Query.`, etc. and
// captures everything up to the next section marker.

const SECTION_KEYS = [
  "MROKey",
  "Query",
  "Result",
  "SearchTerms",
  "SeedHSLs",
  "MatchedAIOs",
  "Confidence",
  "Timestamp",
]

function extractSections(text: string): Record<string, string> {
  const pattern = new RegExp(`\\[(${SECTION_KEYS.join("|")})\\.`, "g")
  const matches: { key: string; start: number; end: number }[] = []
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    matches.push({ key: m[1], start: m.index, end: m.index + m[0].length })
  }
  const sections: Record<string, string> = {}
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]
    const next = matches[i + 1]
    const start = cur.end
    const end = next ? next.start : text.length
    let value = text.substring(start, end).trim()
    if (value.endsWith("]")) value = value.substring(0, value.length - 1).trimEnd()
    sections[cur.key] = value
  }
  return sections
}

// ── employee profile ───────────────────────────────────────────
// Matches `**Key:** value | or \n or $`

function extractEmployeeProfile(result: string): TableRow {
  const profile: TableRow = {}
  const re = /\*\*([^:*]+):\*\*\s*(.*?)\s*(?:\||\n|$)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(result)) !== null) {
    const key = match[1].trim().toLowerCase().replace(/ /g, "_")
    profile[key] = match[2].trim()
  }
  const rm = /Reports To:\s*([^\n|]+)/i.exec(result)
  if (rm && !("reports_to" in profile)) {
    profile.reports_to = rm[1].replace(/[- ]+$/, "").trim()
  }
  return profile
}

// ── markdown table parsing ─────────────────────────────────────

function parseMarkdownTableSegment(segment: string): { headers: string[]; rows: string[][] } {
  const lines = segment.split("\n").map((l) => l.trim()).filter(Boolean)
  const tableLines = lines.filter((l) => l.startsWith("|"))
  if (tableLines.length < 2) return { headers: [], rows: [] }

  const headers = tableLines[0].replace(/^\||\|$/g, "").split("|").map((h) => h.trim())
  const rows: string[][] = []
  // skip separator rows like |---|---|
  const sepRe = /^\|?\s*:?-{3,}:?(\s*\|\s*:?-{3,}:?)+\s*\|?$/

  for (let i = 1; i < tableLines.length; i++) {
    const line = tableLines[i]
    if (sepRe.test(line)) continue
    const cells = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim())
    if (cells.length === headers.length) {
      rows.push(cells)
    }
  }
  return { headers, rows }
}

function findSection(result: string, startMarker: string, endMarkers: string[]): string {
  const start = result.indexOf(startMarker)
  if (start === -1) return ""
  const sliceStart = start + startMarker.length
  const ends: number[] = []
  for (const marker of endMarkers) {
    const pos = result.indexOf(marker, sliceStart)
    if (pos !== -1) ends.push(pos)
  }
  const end = ends.length > 0 ? Math.min(...ends) : result.length
  return result.substring(sliceStart, end).trim()
}

// ── projects ───────────────────────────────────────────────────
// Finds `## Projects Assigned` and parses `### PRJ-NNN — Name` blocks
// followed by a key/value markdown table.

function parseProjectBlocks(result: string): TableRow[] {
  const projects: TableRow[] = []
  const start = result.indexOf("## Projects Assigned")
  if (start === -1) return projects

  let tail = result.substring(start + "## Projects Assigned".length)
  const activeIdx = tail.indexOf("## Active Items Assigned")
  if (activeIdx !== -1) tail = tail.substring(0, activeIdx)

  // Match ### PRJ-NNN — Name (or - dash) ... until next ### PRJ-
  const blockRe = /###\s+(PRJ-\d+)\s+[—-]\s+([\s\S]+?)(?=###\s+PRJ-\d+\s+[—-]|$)/g
  let match: RegExpExecArray | null
  while ((match = blockRe.exec(tail)) !== null) {
    const record: TableRow = {
      project_id: match[1].trim(),
      project_name: match[2].split("\n")[0].trim(),
    }
    const body = match[2].split("\n").slice(1).join("\n").trim()
    const { headers, rows } = parseMarkdownTableSegment(body)
    if (headers.length && rows.length) {
      // Treat as key/value — row[0] is field name, row[1] is value
      for (const row of rows) {
        if (row.length >= 2) {
          const field = row[0].trim().toLowerCase()
            .replace(/%/g, "pct")
            .replace(/\//g, "_")
            .replace(/[^a-z0-9_]+/g, "_")
            .replace(/^_+|_+$/g, "")
          record[field] = row[1].trim()
        }
      }
    }
    projects.push(record)
  }
  return projects
}

// ── generic markdown tables ────────────────────────────────────

function parseGenericTable(result: string, startMarker: string, endMarkers: string[]): TableRow[] {
  const section = findSection(result, startMarker, endMarkers)
  if (!section) return []
  const { headers, rows } = parseMarkdownTableSegment(section)
  if (!headers.length || !rows.length) return []
  const normalizedHeaders = headers.map((h) =>
    h.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "")
  )
  return rows.map((row) => {
    const rec: TableRow = {}
    for (let i = 0; i < Math.min(normalizedHeaders.length, row.length); i++) {
      rec[normalizedHeaders[i]] = row[i]
    }
    return rec
  })
}

// ── search terms ───────────────────────────────────────────────

function parseSearchTerms(raw: string): string {
  const t = raw.trim()
  try {
    return JSON.stringify(JSON.parse(t))
  } catch {
    return t
  }
}

// ── main entry ─────────────────────────────────────────────────

export function parseMroContextBundle(text: string): ResearchResult {
  const normalized = normalizeText(text)
  const sections = extractSections(normalized)
  const result = sections.Result ?? ""

  return {
    metadata: [{
      mro_key: sections.MROKey ?? "",
      query: sections.Query ?? "",
      search_terms: parseSearchTerms(sections.SearchTerms ?? ""),
      seed_hsls: sections.SeedHSLs ?? "",
      matched_aios: sections.MatchedAIOs ?? "",
      confidence: sections.Confidence ?? "",
      timestamp: sections.Timestamp ?? "",
    }],
    employee_profile: result ? [extractEmployeeProfile(result)] : [],
    projects: parseProjectBlocks(result),
    issues_observations: parseGenericTable(result, "### Open Issues / Observations", [
      "### Open RFIs",
      "### Recent Submittals Reviewed",
      "## Financial Summary",
    ]),
    rfis: parseGenericTable(result, "### Open RFIs", [
      "### Recent Submittals Reviewed",
      "## Financial Summary",
    ]),
    submittals: parseGenericTable(result, "### Recent Submittals Reviewed", [
      "## Financial Summary",
    ]),
    invoices: parseGenericTable(result, "## Financial Summary", []),
  }
}

// Pretty labels for display
export const TABLE_LABELS: Record<TableName, string> = {
  metadata: "Metadata",
  employee_profile: "Employee Profile",
  projects: "Projects Assigned",
  issues_observations: "Open Issues / Observations",
  rfis: "Open RFIs",
  submittals: "Recent Submittals",
  invoices: "Financial Summary / Invoices",
}

// ── derived research object ────────────────────────────────────
// When an MRO has no context_bundle (or a useless one), best-effort
// extract whatever structure is present in result_text so the user
// still sees a formalized Derived Research Object.

interface MroLike {
  mro_key?: string | null
  query_text?: string | null
  intent?: string | null
  seed_hsls?: string | null
  matched_aios_count?: number | null
  search_terms?: Record<string, unknown> | null
  result_text?: string | null
  confidence?: string | null
  created_at?: string | null
}

function extractKeyFacts(text: string): TableRow[] {
  const facts: TableRow[] = []
  const seen = new Set<string>()
  // Pattern 1: **Key:** value (bold markdown label)
  const boldRe = /\*\*([^:*\n]{1,60}):\*\*\s*([^\n|]{1,400})/g
  let m: RegExpExecArray | null
  while ((m = boldRe.exec(text)) !== null) {
    const key = m[1].trim()
    const value = m[2].trim().replace(/\s{2,}/g, " ")
    if (!key || !value) continue
    const dedup = key.toLowerCase()
    if (seen.has(dedup)) continue
    seen.add(dedup)
    facts.push({ field: key, value })
  }
  // Pattern 2: bare "Key: value" lines (no bold), only capture labels that look field-ish
  const lineRe = /^[-*•\s]*([A-Z][A-Za-z0-9 /_\-]{1,50}):\s*([^\n]{1,400})$/gm
  while ((m = lineRe.exec(text)) !== null) {
    const key = m[1].trim()
    const value = m[2].trim().replace(/^\*\*|\*\*$/g, "").trim()
    if (!key || !value || value === "**") continue
    if (/^https?:/i.test(value)) continue
    const dedup = key.toLowerCase()
    if (seen.has(dedup)) continue
    seen.add(dedup)
    facts.push({ field: key, value })
  }
  return facts
}

function extractMarkdownSections(text: string): DerivedSection[] {
  const sections: DerivedSection[] = []
  // Match ## or ### headings and capture content until the next heading of same-or-higher level
  const headingRe = /^(#{2,3})\s+(.+)$/gm
  const matches: { level: number; heading: string; start: number; end: number }[] = []
  let m: RegExpExecArray | null
  while ((m = headingRe.exec(text)) !== null) {
    matches.push({
      level: m[1].length,
      heading: m[2].trim(),
      start: m.index,
      end: m.index + m[0].length,
    })
  }
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]
    const next = matches[i + 1]
    const contentStart = cur.end
    const contentEnd = next ? next.start : text.length
    const content = text.substring(contentStart, contentEnd).trim()
    if (cur.heading) {
      sections.push({ heading: cur.heading, content })
    }
  }
  return sections
}

export function buildDerivedResearchObject(mro: MroLike): ResearchResult {
  const resultText = normalizeText(mro.result_text ?? "")
  const keyFacts = extractKeyFacts(resultText)
  const sections = extractMarkdownSections(resultText)

  // Try to opportunistically reuse structured parsers on the result text —
  // sometimes the result itself contains `## Projects Assigned` etc.
  const projects = parseProjectBlocks(resultText)
  const issues = parseGenericTable(resultText, "### Open Issues / Observations", [
    "### Open RFIs",
    "### Recent Submittals Reviewed",
    "## Financial Summary",
  ])
  const rfis = parseGenericTable(resultText, "### Open RFIs", [
    "### Recent Submittals Reviewed",
    "## Financial Summary",
  ])
  const submittals = parseGenericTable(resultText, "### Recent Submittals Reviewed", [
    "## Financial Summary",
  ])
  const invoices = parseGenericTable(resultText, "## Financial Summary", [])
  const employee = resultText ? [extractEmployeeProfile(resultText)] : []
  const employeeHasData = employee.length > 0 && Object.keys(employee[0]).length > 0

  let searchTermsStr = ""
  if (mro.search_terms) {
    try {
      searchTermsStr = JSON.stringify(mro.search_terms)
    } catch {
      searchTermsStr = String(mro.search_terms)
    }
  }

  return {
    metadata: [{
      mro_key: mro.mro_key ?? "",
      query: mro.query_text ?? "",
      intent: mro.intent ?? "",
      search_terms: searchTermsStr,
      seed_hsls: mro.seed_hsls ?? "",
      matched_aios: mro.matched_aios_count != null ? String(mro.matched_aios_count) : "",
      confidence: mro.confidence ?? "",
      timestamp: mro.created_at ?? "",
    }],
    employee_profile: employeeHasData ? employee : [],
    projects,
    issues_observations: issues,
    rfis,
    submittals,
    invoices,
    derived: true,
    key_facts: keyFacts,
    sections,
    raw_result: resultText,
  }
}

// Returns true if a parsed ResearchResult has no useful structured content
// beyond metadata. Used to decide whether to fall back to derived extraction.
export function isResearchResultEmpty(r: ResearchResult): boolean {
  const nonMeta =
    r.employee_profile.length +
    r.projects.length +
    r.issues_observations.length +
    r.rfis.length +
    r.submittals.length +
    r.invoices.length
  return nonMeta === 0
}

// Collects all unique keys in order of first appearance
export function collectAllFields(records: TableRow[]): string[] {
  const seen = new Set<string>()
  const fields: string[] = []
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key)
        fields.push(key)
      }
    }
  }
  return fields
}
