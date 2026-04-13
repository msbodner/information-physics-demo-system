"use client"

import { useState, useCallback, useMemo, useEffect, useRef } from "react"
import { toast } from "sonner"
import { FileUpload } from "@/components/file-upload"
import { ConversionPreview } from "@/components/conversion-preview"
import { BackendStatusBadge } from "@/components/backend-status-badge"
import { SystemManagement } from "@/components/system-management"
import { ChatAioDialog } from "@/components/chat-aio-dialog"
import { useBackendStatus } from "@/hooks/use-backend-status"
import { createIO, listIOs, summarizeAIOs, resolveEntities, createAioData, listAioData, listHslData, createHslData, listInformationElements, rebuildInformationElements, extractPdfToCsv, loginUser, listFieldMaps, createFieldMap, updateFieldMap, deleteFieldMap, generateFieldMaps, type EntityItem, type IORecord, type AioDataRecord, type HslDataRecord, type LoginResult, type InformationElement, type PdfExtractResult, type FieldMapKey } from "@/lib/api-client"
import { AppSidebar, type ViewKey } from "@/components/app-sidebar"
import { Dashboard } from "@/components/dashboard"
import { SplashScreen } from "@/components/splash-screen"
import {
  Database, ArrowRight, Layers, Cpu, Globe, BookOpen, FileText, Zap,
  ArrowLeft, Search, X, Download, Atom, Network, Binary, Loader2, Settings, FileSpreadsheet, LogOut, Lock, Eye, EyeOff, MessageSquare, Upload, Brain, Sparkles, Plus, Pencil, Trash2,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// ── Types ──────────────────────────────────────────────────────────

export interface ConvertedFile {
  originalName: string
  csvData: string[][]
  headers: string[]
  aioLines: string[]
  fileDate: string
  fileTime: string
}

interface ParsedElement {
  key: string
  value: string
  raw: string
}

interface ParsedAio {
  fileName: string
  elements: ParsedElement[]
  raw: string
  csvRoot: string
  lineNumber: number
}

// ── Helpers ────────────────────────────────────────────────────────

function csvToAio(headers: string[], row: string[], originalFileName: string, fileDate: string, fileTime: string): string {
  const parts: string[] = []
  parts.push(`[OriginalCSV.${originalFileName}]`)
  parts.push(`[FileDate.${fileDate}]`)
  parts.push(`[FileTime.${fileTime}]`)
  for (let i = 0; i < headers.length; i++) {
    const key = headers[i]
    let val = row[i] ?? ""
    val = val.replace(/\r\n/g, " ").replace(/\n/g, " ").replace(/\r/g, " ").replace(/\t/g, " ")
    parts.push(`[${key}.${val}]`)
  }
  return parts.join("")
}

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "")
  if (lines.length === 0) return { headers: [], rows: [] }
  const parseLine = (line: string): string[] => {
    const result: string[] = []
    let current = ""
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++ } else { inQuotes = !inQuotes }
      } else if (char === "," && !inQuotes) { result.push(current); current = "" } else { current += char }
    }
    result.push(current)
    return result
  }
  const headers = parseLine(lines[0])
  const rows = lines.slice(1).map(parseLine)
  return { headers, rows }
}

function parseAioLine(line: string): ParsedElement[] {
  const elements: ParsedElement[] = []
  const regex = /\[([^\]]+)\]/g
  let match
  while ((match = regex.exec(line)) !== null) {
    const raw = match[1]
    const dotIndex = raw.indexOf(".")
    if (dotIndex > 0) {
      elements.push({ key: raw.substring(0, dotIndex), value: raw.substring(dotIndex + 1), raw: `[${raw}]` })
    }
  }
  return elements
}

/** Reconstruct tabular CSV data from a set of saved AIO IORecords */
function reconstructCsvFromAios(records: IORecord[]): { headers: string[]; rows: string[][] } {
  const META_KEYS = new Set(["OriginalCSV", "FileDate", "FileTime"])
  const parsed = records.map((r) => {
    const uri = r.raw.raw_uri ?? ""
    const line = uri.startsWith("data:text/aio,") ? decodeURIComponent(uri.slice("data:text/aio,".length)) : uri
    const row: Record<string, string> = {}
    parseAioLine(line).forEach((el) => { if (!META_KEYS.has(el.key)) row[el.key] = el.value })
    return row
  })
  const seen = new Set<string>()
  const headers: string[] = []
  parsed.forEach((row) => Object.keys(row).forEach((k) => { if (!seen.has(k)) { seen.add(k); headers.push(k) } }))
  const rows = parsed.map((row) => headers.map((h) => row[h] ?? ""))
  return { headers, rows }
}

// ── UserGuide Component ────────────────────────────────────────────

function UserGuide({ onBack, onSysAdmin }: { onBack: () => void; onSysAdmin: () => void }) {
  const [activeSection, setActiveSection] = useState<string>("overview")
  const sections = [
    { id: "overview", label: "Overview", icon: Globe },
    { id: "sidebar-nav", label: "Sidebar Navigation", icon: Network },
    { id: "dashboard", label: "Dashboard Home", icon: Database },
    { id: "csv-converter", label: "CSV Converter", icon: FileText },
    { id: "pdf-import", label: "PDF Import", icon: FileSpreadsheet },
    { id: "hsp", label: "Hyper-Semantic Processor", icon: Cpu },
    { id: "hsl", label: "HSL — Creating & Viewing", icon: Layers },
    { id: "chataio", label: "ChatAIO — AI Search", icon: MessageSquare },
    { id: "rd", label: "R & D — Three Tabs", icon: Atom },
    { id: "system-admin", label: "System Admin", icon: Settings },
    { id: "csv-format", label: "CSV Format", icon: FileSpreadsheet },
    { id: "aio-format", label: "AIO Format", icon: Database },
    { id: "tips", label: "Tips & Best Practices", icon: Zap },
  ]

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={onBack} className="gap-2"><ArrowLeft className="w-4 h-4" />Back</Button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center"><BookOpen className="w-5 h-5 text-primary-foreground" /></div>
                <h1 className="text-xl font-bold text-foreground">User Guide</h1>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={onSysAdmin} className="gap-2"><Settings className="w-4 h-4" />System Admin</Button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid lg:grid-cols-[240px_1fr] gap-8">
          <nav className="space-y-1 sticky top-8 self-start">
            {sections.map((section) => { const Icon = section.icon; return (
              <button key={section.id} onClick={() => setActiveSection(section.id)} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${activeSection === section.id ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
                <Icon className="w-4 h-4" />{section.label}
              </button>
            )})}
          </nav>
          <div className="space-y-6">

            {/* ── OVERVIEW ── */}
            {activeSection === "overview" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Globe className="w-5 h-5" />Overview — Information Physics Demo System V3.1</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p><strong>Information Physics Demo System V3.1</strong> is a complete full-stack platform for capturing, linking, searching, and reasoning over enterprise data in the Information Physics Standard Model. It converts CSV and PDF sources into <strong>Associated Information Objects (AIOs)</strong>, links them through the <strong>Hyper-Semantic Layer (HSL)</strong>, retrieves them via AI-powered search, and preserves successful retrieval episodes as <strong>Memory Result Objects (MROs)</strong>.</p>

                <h4 className="text-foreground font-medium mt-4">New in V3.1</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>Persistent navy sidebar</strong> — always-visible grouped navigation (Data / Discovery / Knowledge / Admin). No more Back buttons.</li>
                  <li><strong>Live Dashboard home page</strong> — real-time counts of AIOs / HSLs / MROs / Fields, quick-action cards, recent activity feed, system health panel.</li>
                  <li><strong>MRO persistence</strong> — save ChatAIO sessions as governed episodic memory objects with full search-term metadata and HSL/AIO lineage.</li>
                  <li><strong>Four-phase AIO Search algebra</strong> — parse prompt → match HSLs → gather AIOs → synthesize focused answer. Produces precise, provenance-traceable responses.</li>
                  <li><strong>AI Field Maps</strong> — Claude AI clusters semantically similar field names (e.g. Invoice / Invoice Number / Invoice # → &ldquo;Invoice&rdquo;) with manual CRUD override.</li>
                  <li><strong>Bulk CSV Processing</strong> — select a folder, filter by filename prefix, batch-convert hundreds of rows with automatic de-duplication.</li>
                  <li><strong>PDF Import</strong> — Claude extracts tabular data from PDFs (invoices, reports) into CSV form, ready for AIO conversion.</li>
                  <li><strong>Information Elements directory</strong> — unique field-name index with per-field row counts and inline value viewer.</li>
                  <li><strong>Compound HSL Builder</strong> — multi-field AND queries that find AIOs matching ALL selected field-value pairs.</li>
                </ul>

                <h4 className="text-foreground font-medium mt-4">The Five-Step Pipeline</h4>
                <ol className="list-decimal list-inside space-y-2">
                  <li><strong>Capture</strong> — Upload CSVs, drop PDFs, or bulk-import a folder. Each row becomes an AIO bracketstring.</li>
                  <li><strong>Preserve</strong> — AIOs are saved to PostgreSQL with full provenance: <code className="bg-muted px-1 rounded">aio_data</code> (parsed elements), <code className="bg-muted px-1 rounded">information_objects</code> (full URI), and the original CSV is saved to the IO registry.</li>
                  <li><strong>Link</strong> — HSLs record which AIOs share common elements, forming an auditable semantic topology. Compound HSLs link multiple fields with AND logic.</li>
                  <li><strong>Retrieve</strong> — ChatAIO runs two search modes: broad (Send) and focused (AIO Search four-phase algebra). Both use Claude Sonnet 4.6.</li>
                  <li><strong>Remember</strong> — Successful retrieval episodes become MROs with query cue, seed HSLs, traversed AIOs, and synthesis result — all explicitly linked to their source evidence.</li>
                </ol>

                <h4 className="text-foreground font-medium mt-4">Core Principles</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>Preserve-first</strong> — observations are kept in their full contextual state, not flattened to a fixed schema.</li>
                  <li><strong>Self-describing</strong> — every AIO carries its own semantic labels, provenance, and temporal context.</li>
                  <li><strong>Late-binding</strong> — the same AIO can be re-indexed, re-clustered, and re-projected as questions evolve.</li>
                  <li><strong>Auditable</strong> — every derived answer traces back to source observations via provenance lineage.</li>
                  <li><strong>Recursive memory</strong> — MROs allow the system to remember its own successful acts of recollection.</li>
                </ul>
              </CardContent></Card>
            )}

            {/* ── SIDEBAR NAVIGATION ── */}
            {activeSection === "sidebar-nav" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Network className="w-5 h-5" />Sidebar Navigation</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>The persistent navy sidebar on the left is the primary navigation for the entire app. It replaces the old header + Back-button pattern from V2. No matter where you are, you can jump to any page in one click.</p>

                <h4 className="text-foreground font-medium mt-2">Grouped sections</h4>
                <div className="space-y-3 pl-2 border-l-2 border-border">
                  <div>
                    <p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">Dashboard</p>
                    <p>Home page with live stats, quick actions, recent activity, and system health. See the <strong>Dashboard Home</strong> section for details.</p>
                  </div>
                  <div>
                    <p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">Data</p>
                    <p>Import CSV, Import PDFs, HSL Builder, ChatAIO — everything related to getting data into the system and querying it.</p>
                  </div>
                  <div>
                    <p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">Discovery</p>
                    <p>R &amp; D — experimental tools for exploring relationships across your AIO corpus (Compound HSL Builder, AI Field Maps, Bulk CSV Processing).</p>
                  </div>
                  <div>
                    <p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">Knowledge</p>
                    <p>User Guide, Workflow description, Information Physics Reference, AIO Reference Paper, MRO Reference Paper — all documentation in one place.</p>
                  </div>
                  <div>
                    <p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">Admin</p>
                    <p>System Admin — users, roles, data tables, API keys, architecture diagram.</p>
                  </div>
                </div>

                <h4 className="text-foreground font-medium mt-4">Footer</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>Backend status dot</strong> — green if the FastAPI backend is reachable; amber if offline.</li>
                  <li><strong>Username</strong> — shown after System Admin login.</li>
                  <li><strong>Version</strong> — V3.1.</li>
                </ul>

                <h4 className="text-foreground font-medium mt-4">Responsive behavior</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>Desktop (≥1024px):</strong> sidebar is always visible, 240px wide. Click the chevron to collapse to a 64px icon rail.</li>
                  <li><strong>Mobile / narrow:</strong> sidebar hides by default. Tap the hamburger icon in the top-left to open the drawer; tap outside to dismiss.</li>
                </ul>
              </CardContent></Card>
            )}

            {/* ── DASHBOARD ── */}
            {activeSection === "dashboard" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Database className="w-5 h-5" />Dashboard Home</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>The Dashboard is the default home page. It replaces the V2 marketing hero with live data about your system.</p>

                <h4 className="text-foreground font-medium mt-2">Stat cards (top row)</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>AIOs</strong> (blue) — total count of AIO records in the <code className="bg-muted px-1 rounded">aio_data</code> table.</li>
                  <li><strong>HSLs</strong> (emerald) — total count of HSL records in <code className="bg-muted px-1 rounded">hsl_data</code>.</li>
                  <li><strong>MROs</strong> (purple) — total preserved retrieval episodes in <code className="bg-muted px-1 rounded">mro_objects</code>.</li>
                  <li><strong>Fields</strong> (amber) — unique field names in <code className="bg-muted px-1 rounded">information_elements</code>, with a sub-count of fuzzy-key groups.</li>
                </ul>

                <h4 className="text-foreground font-medium mt-4">Quick Action cards</h4>
                <p>Four large cards for the most-used workflows: Import CSV, Import PDFs, ChatAIO, R &amp; D. Each card is a link to the corresponding page with a short description.</p>

                <h4 className="text-foreground font-medium mt-4">Recent Activity feed</h4>
                <p>Shows the 10 most recent events from across all data tables (AIO saves, HSL creations, MRO persists, field map updates) sorted by <code className="bg-muted px-1 rounded">updated_at</code>. Each entry shows the kind, label, and time-ago.</p>

                <h4 className="text-foreground font-medium mt-4">System Health panel</h4>
                <p>At-a-glance status for Backend, Database, API Key, and Anthropic. Green check = healthy; red = offline. Click <strong>Refresh</strong> in the top-right to re-fetch counts manually.</p>
              </CardContent></Card>
            )}

            {/* ── CSV CONVERTER ── */}
            {activeSection === "csv-converter" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" />CSV Converter — Upload, Preview & Save</CardTitle></CardHeader>
              <CardContent className="space-y-5 text-sm text-muted-foreground leading-relaxed">
                <p>The converter page has two states: the <strong>upload screen</strong> (no files loaded) and the <strong>preview screen</strong> (after conversion).</p>

                <h4 className="text-foreground font-medium">Upload screen</h4>
                <div className="space-y-3 pl-2 border-l-2 border-border">
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">File Drop Zone</p><p>Drag one or more <code className="bg-muted px-1 rounded">.csv</code> files onto the zone, or click it to open the file browser. Multiple files can be selected at once.</p></div>
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">Duplicate Detection</p><p>Before conversion begins, filenames are checked against the backend. If a file with the same name was already processed, a toast error appears and that file is skipped. If all selected files are duplicates, the upload is cancelled entirely.</p></div>
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">Load from Database button</p><p>Appears when the backend is online. Retrieves all previously saved AIOs and CSVs from the database and reconstructs them into the converter view — so you can review or re-download past work without re-uploading files.</p></div>
                </div>

                <h4 className="text-foreground font-medium mt-2">Preview screen — top toolbar</h4>
                <div className="space-y-3 pl-2 border-l-2 border-border">
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">View All AIOs button</p><p>Opens a read-only dialog listing all AIO records stored in the <code className="bg-muted px-1 rounded">aio_data</code> table in the backend database. Each row shows the AIO name, element count, and creation date. Click <strong>View</strong> on any row to see its full element breakdown.</p></div>
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">Process AIO Files via Hyper-Semantic Logic</p><p>Navigates to the Hyper-Semantic Processor with the currently converted AIOs loaded. Use this after uploading new CSVs to immediately begin semantic analysis.</p></div>
                </div>

                <h4 className="text-foreground font-medium mt-2">Preview screen — per-file controls</h4>
                <div className="space-y-3 pl-2 border-l-2 border-border">
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">CSV tab / AIO tab</p><p>Toggle between viewing the original CSV table and the generated AIO lines for a given file.</p></div>
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">Row selection</p><p>Click any row in the CSV view to highlight it and see the corresponding AIO string in the AIO view.</p></div>
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">Download AIO (single row)</p><p>Downloads one <code className="bg-muted px-1 rounded">.aio</code> file for the selected row.</p></div>
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">Download All AIOs</p><p>Downloads all AIO lines from the current file as individual <code className="bg-muted px-1 rounded">.aio</code> files, named <code className="bg-muted px-1 rounded">filename_0001.aio</code>, <code className="bg-muted px-1 rounded">filename_0002.aio</code>, etc.</p></div>
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">Preview CSV button</p><p>Opens a modal showing the raw CSV content of the file as originally uploaded.</p></div>
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">Save to Database / Saved badge</p><p>When the backend is online, AIOs are automatically saved after conversion. A green <strong>Saved</strong> badge confirms the file is persisted. If offline, the badge is absent and data is in-memory only.</p></div>
                </div>
              </CardContent></Card>
            )}

            {/* ── HYPER-SEMANTIC PROCESSOR ── */}
            {activeSection === "hsp" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Cpu className="w-5 h-5" />Hyper-Semantic Processor</CardTitle></CardHeader>
              <CardContent className="space-y-5 text-sm text-muted-foreground leading-relaxed">
                <p>The Hyper-Semantic Processor is the core analysis tool. It indexes every element across all loaded AIOs and lets you discover semantic relationships by clicking values.</p>

                <h4 className="text-foreground font-medium">Header bar buttons</h4>
                <div className="space-y-3 pl-2 border-l-2 border-border">
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">Back to Converter</p><p>Returns to the CSV Converter view. Your converted files remain in memory.</p></div>
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">View HSL Database</p><p>Opens a read-only dialog listing all HSL records stored in the <code className="bg-muted px-1 rounded">hsl_data</code> table. Shows HSL name, entry count, and creation date. Click <strong>View</strong> to see the full row-by-row breakdown of which AIOs participated in that HSL. Only visible when backend is connected.</p></div>
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">Summarize All</p><p>Sends all loaded AIO lines to the backend, which uses Claude AI to generate a natural-language summary of the data. Requires backend connection and a configured Anthropic API key. The summary appears in a panel below the AIO list.</p></div>
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">System Admin</p><p>Opens the Admin Login modal (or navigates directly if already authenticated).</p></div>
                </div>

                <h4 className="text-foreground font-medium mt-2">Search bar</h4>
                <div className="pl-2 border-l-2 border-border space-y-2">
                  <p>Type any text to filter the AIO list by file name, element key, or element value. The count in the header updates live. The backend AIOs are loaded automatically on first visit — a spinner appears while loading. Click the <strong>×</strong> button to clear the search.</p>
                </div>

                <h4 className="text-foreground font-medium mt-2">AIO list — left panel</h4>
                <div className="pl-2 border-l-2 border-border space-y-2">
                  <p>Each row is one AIO. Click a row to expand it and see all its elements as clickable badges. The AIO name (e.g. <code className="bg-muted px-1 rounded">employees_0001.aio</code>) and source CSV are shown above the badges.</p>
                  <p><strong>Clicking an element badge</strong> sets it as the selected element and triggers a match search across all loaded AIOs. The selected element is highlighted in amber.</p>
                </div>

                <h4 className="text-foreground font-medium mt-2">Match results — right panel</h4>
                <div className="pl-2 border-l-2 border-border space-y-2">
                  <p>Shows all AIOs that contain the selected element (exact key + value match). The matching element is highlighted in each result row.</p>
                  <p><strong>Download CSV</strong> — generates a summary CSV where each column is an element key and each row is a matching AIO's values. Download for further analysis in Excel or other tools.</p>
                  <p><strong>Create HSL / Append HSL</strong> — saves the current match set as an HSL record. See the HSL section for details.</p>
                  <p><strong>Download HSL</strong> — downloads the current HSL as a <code className="bg-muted px-1 rounded">.hsl</code> plain-text file.</p>
                </div>

                <h4 className="text-foreground font-medium mt-2">ChatAIO panel</h4>
                <div className="pl-2 border-l-2 border-border space-y-2">
                  <p>When the backend is online and an Anthropic API key is configured, a <strong>ChatAIO</strong> button appears. Clicking it opens a conversational interface powered by Claude (claude-sonnet-4-6). Ask natural-language questions about your data — e.g. <em>"What is the total invoice amount by vendor?"</em> or <em>"List all employees in Denver."</em> The AI uses up to 300 AIO lines as context.</p>
                </div>
              </CardContent></Card>
            )}

            {/* ── HSL ── */}
            {activeSection === "hsl" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Layers className="w-5 h-5" />HSL — Creating & Viewing</CardTitle></CardHeader>
              <CardContent className="space-y-5 text-sm text-muted-foreground leading-relaxed">
                <p>An <strong>HSL (Hyper-Semantic Layer)</strong> is a provenance record that captures which AIOs share a common element value, where those AIOs came from, and when the relationship was discovered.</p>

                <h4 className="text-foreground font-medium">Creating an HSL</h4>
                <ol className="list-decimal list-inside space-y-2 pl-2">
                  <li>In the Hyper-Semantic Processor, click an element badge on any AIO.</li>
                  <li>The right panel shows all matching AIOs.</li>
                  <li>Click <strong>Create HSL</strong> (or <strong>Append HSL</strong> if one already exists for this session).</li>
                  <li>The HSL is displayed in a table pane at the bottom of the page showing AIO Name, CSV Source, Line #, and Created timestamp.</li>
                  <li>If the backend is connected, the HSL is automatically saved to both the <code className="bg-muted px-1 rounded">hsl_data</code> table and the <code className="bg-muted px-1 rounded">information_objects</code> table. A success toast confirms the save.</li>
                </ol>

                <h4 className="text-foreground font-medium mt-2">HSL Display pane buttons</h4>
                <div className="space-y-3 pl-2 border-l-2 border-border">
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">Download HSL</p><p>Saves the HSL as a <code className="bg-muted px-1 rounded">[Key.Value].hsl</code> plain-text tab-delimited file. The filename uses the same bracket notation as the element (e.g. <code className="bg-muted px-1 rounded">[Department.Engineering].hsl</code>).</p></div>
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">Close</p><p>Dismisses the HSL pane. The HSL remains saved in the database.</p></div>
                </div>

                <h4 className="text-foreground font-medium mt-2">Viewing saved HSLs — HSL Database dialog</h4>
                <div className="space-y-2 pl-2 border-l-2 border-border">
                  <p>Click <strong>View HSL Database</strong> in the processor header to open the read-only HSL list. This loads records from the <code className="bg-muted px-1 rounded">hsl_data</code> table and shows:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li><strong>HSL Name</strong> — the bracket filename (e.g. <code className="bg-muted px-1 rounded">[City.Austin].hsl</code>)</li>
                    <li><strong>Entries</strong> — number of AIOs in this HSL</li>
                    <li><strong>Created</strong> — when the HSL was saved</li>
                    <li><strong>View button</strong> — opens the detail dialog showing the full row table (AIO Name, CSV Source, Line #, Created)</li>
                  </ul>
                  <p>Use the <strong>Back to list</strong> button in the detail dialog to return to the HSL list.</p>
                </div>

                <h4 className="text-foreground font-medium mt-2">HSL file format</h4>
                <div className="p-3 rounded-lg bg-muted font-mono text-xs whitespace-pre">{`HSL File: [Key.Value].hsl
Selected Value: Key: Value
Created: YYYY-MM-DD HH:MM:SS
Matches: N

AIO Name             CSV Source    Line #  Created
────────────────────────────────────────────────────────────────────────────────
employees_0001.aio   employees     1       2024-01-15 10:30:00
employees_0005.aio   employees     5       2024-01-15 10:30:00`}</div>
              </CardContent></Card>
            )}

            {/* ── PDF IMPORT ── */}
            {activeSection === "pdf-import" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileSpreadsheet className="w-5 h-5" />PDF Import — Extract Data with Claude AI</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>The PDF Import page uses Claude AI to read PDF files (invoices, reports, forms) and extract the tabular data into CSV format. Once extracted, you can convert the CSV into AIOs through the normal CSV converter flow.</p>

                <h4 className="text-foreground font-medium mt-2">How to use it</h4>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Click <strong>Import PDFs</strong> in the sidebar (requires backend + configured API key).</li>
                  <li>Drop a PDF file or click to browse.</li>
                  <li>Click <strong>Extract</strong>. Claude reads the PDF and returns structured rows.</li>
                  <li>Review the extracted CSV in the preview table.</li>
                  <li>Click <strong>Import as CSV</strong> to route the extracted data into the CSV Converter as if it had been uploaded directly.</li>
                </ol>

                <h4 className="text-foreground font-medium mt-2">Requirements</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li>Valid Anthropic API key configured in System Admin → API Key.</li>
                  <li>Backend must be online (uses <code className="bg-muted px-1 rounded">/v1/op/pdf-extract</code> endpoint).</li>
                  <li>PDFs should contain structured data (tables, forms). Plain prose PDFs may not yield useful rows.</li>
                </ul>

                <h4 className="text-foreground font-medium mt-2">What gets extracted</h4>
                <p>Claude attempts to identify column headers and rows, returning a normalized CSV. Each line item from an invoice becomes one CSV row; each row becomes one AIO during conversion.</p>
              </CardContent></Card>
            )}

            {/* ── CHATAIO ── */}
            {activeSection === "chataio" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5" />ChatAIO — AI-Powered Search</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>ChatAIO is the full-screen conversational interface for querying your AIO corpus using natural language. It uses Claude Sonnet 4.6 under the hood and offers two distinct search modes.</p>

                <h4 className="text-foreground font-medium mt-2">Opening ChatAIO</h4>
                <p>Click <strong>ChatAIO</strong> in the Data section of the sidebar. A full-screen modal overlay opens; click the X in the top-right to close it and return to the previous view.</p>

                <h4 className="text-foreground font-medium mt-2">Two search modes</h4>
                <div className="space-y-3 pl-2 border-l-2 border-border">
                  <div>
                    <p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">Send (Broad Search)</p>
                    <p>Sends your prompt to Claude with ALL AIO and HSL records loaded as context (up to 500). One LLM call. Best for broad, exploratory questions like &ldquo;What vendors appear in this data?&rdquo; or &ldquo;Summarize the project budgets.&rdquo;</p>
                  </div>
                  <div>
                    <p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">AIO Search (Four-Phase Algebra)</p>
                    <p>Runs the focused four-phase search algebra for precise, entity-targeted queries:</p>
                    <ol className="list-decimal list-inside ml-3 mt-1 space-y-0.5">
                      <li><strong>Parse</strong> — Claude extracts search terms from your prompt (names, projects, field values).</li>
                      <li><strong>Match HSLs</strong> — Searches the HSL library for records containing those terms.</li>
                      <li><strong>Gather AIOs</strong> — Collects only the AIOs referenced in matching HSLs.</li>
                      <li><strong>Synthesize</strong> — Claude generates a focused answer using ONLY the gathered subset.</li>
                    </ol>
                    <p className="mt-1">Falls back to direct element-level search if no HSLs match. The response footer shows how many HSLs matched, how many AIOs were used as context, and the parsed search terms.</p>
                  </div>
                </div>

                <h4 className="text-foreground font-medium mt-2">Saving MROs (Memory Result Objects)</h4>
                <p>After any successful query, click <strong>Save MRO</strong> to persist the entire retrieval episode — query cue, seed HSLs, gathered AIOs, and synthesized result — as a governed episodic object. MROs become part of the future searchable universe, preserving the system&apos;s own acts of remembering.</p>
                <p>View saved MROs via System Admin → MRO Data.</p>

                <h4 className="text-foreground font-medium mt-2">Saved Prompts</h4>
                <p>Click the <strong>bookmark icon</strong> to save a useful prompt. Choose &ldquo;Current Session&rdquo; (temporary) or &ldquo;Save to Database&rdquo; (persistent, shown in Saved Prompts tab). Click the <strong>history icon</strong> to browse and reuse prior prompts.</p>

                <h4 className="text-foreground font-medium mt-2">Export options</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>Chat</strong> — Download the full conversation as a Markdown file.</li>
                  <li><strong>PDF</strong> — Generate a printable PDF report of the session.</li>
                  <li><strong>Guide</strong> — Open an inline help panel.</li>
                </ul>
              </CardContent></Card>
            )}

            {/* ── R & D ── */}
            {activeSection === "rd" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Atom className="w-5 h-5" />R &amp; D — Three Tabs</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>The R &amp; D page contains experimental tools for exploring field relationships across your AIO corpus. It has three tabs.</p>

                <h4 className="text-foreground font-medium mt-2">Tab 1: Compound HSL Builder</h4>
                <p>Build multi-field AND queries. The page has a three-pane layout:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>Left pane</strong> — Browse field names from the Information Elements directory. Shows the AIO count per field.</li>
                  <li><strong>Middle pane</strong> — When you click a field name, all unique values for that field appear with occurrence counts. Click a value to add it to the query.</li>
                  <li><strong>Right pane</strong> — Your compound query accumulates here. Each selection adds an additional AND constraint. The live match count updates as you add fields.</li>
                </ul>
                <p>With 2+ fields selected, click <strong>Create Compound HSL</strong> to save an HSL record containing only the AIOs that match ALL selected criteria. Click <strong>View Compound HSL</strong> to inspect the resulting file and the detailed elements of each matching AIO.</p>

                <h4 className="text-foreground font-medium mt-2">Tab 2: AI Field Maps</h4>
                <p>Groups semantically similar field names into &ldquo;Fuzzy Keys&rdquo; — e.g., Invoice, Invoice Number, Invoice #, Invoice No all map to the single key &ldquo;Invoice&rdquo;.</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Click <strong>Regenerate with AI</strong> to have Claude analyze all field names in <code className="bg-muted px-1 rounded">information_elements</code> and produce fuzzy-key clusters.</li>
                  <li>Each row shows the fuzzy key name plus badges for all member field names.</li>
                  <li>Use the pencil icon to edit a key (rename, change description, add/remove member fields).</li>
                  <li>Use the trash icon to delete a key (cascade deletes all member associations).</li>
                  <li>Click <strong>Add Key</strong> to create a manual fuzzy key with hand-picked member fields.</li>
                </ul>

                <h4 className="text-foreground font-medium mt-2">Tab 3: Bulk CSV Processing</h4>
                <p>Batch-import an entire folder of CSV files in one pass, with automatic de-duplication.</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Click <strong>Select CSV Folder</strong> and pick a directory from your local filesystem. The browser&apos;s folder picker loads all <code className="bg-muted px-1 rounded">.csv</code> files.</li>
                  <li>The <strong>Prefix</strong> pulldown auto-populates with the unique first-3-character filename prefixes found in the folder (e.g., ACC, NS_, QB_, D36). Default selection is <strong>ACC</strong>.</li>
                  <li>The file list updates to show only files matching the selected prefix, along with row counts and file sizes.</li>
                  <li>Click <strong>Process Files</strong>. The progress bar shows the current file and overall progress.</li>
                </ol>
                <p>Each file is processed identically to the standard CSV Converter: saves to <code className="bg-muted px-1 rounded">aio_data</code>, the <code className="bg-muted px-1 rounded">information_objects</code> registry (type=AIO), and saves the full CSV text as type=CSV. Duplicates are skipped by comparing <code className="bg-muted px-1 rounded">aio_name</code> against existing records, so you can safely re-run without creating duplicates. After all files complete, <code className="bg-muted px-1 rounded">information_elements</code> is rebuilt automatically.</p>
                <p>The summary card shows five counts: Files, CSVs saved, New AIOs, Duplicates skipped, Failures.</p>
              </CardContent></Card>
            )}

            {/* ── SYSTEM ADMIN ── */}
            {activeSection === "system-admin" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Settings className="w-5 h-5" />System Admin Panel</CardTitle></CardHeader>
              <CardContent className="space-y-5 text-sm text-muted-foreground leading-relaxed">
                <p>The System Admin panel is accessible from every page via the <strong>System Admin</strong> button in the top-right corner. Login is required.</p>

                <h4 className="text-foreground font-medium">Login</h4>
                <div className="space-y-2 pl-2 border-l-2 border-border">
                  <p>Click <strong>System Admin</strong> on any page. The Admin Login modal opens with email and password fields. Click the <strong>eye icon</strong> to show or hide your password. Default credentials:</p>
                  <div className="p-2 rounded bg-muted font-mono text-xs">Email: bodner.michael@gmail.com<br/>Password: Infophysics2024</div>
                  <p>On success, your username appears in the header with a <strong>Logout</strong> button. Logging out returns you to the home page.</p>
                </div>

                <h4 className="text-foreground font-medium mt-2">Users tab</h4>
                <div className="space-y-2 pl-2 border-l-2 border-border">
                  <p>Full CRUD for user accounts in the <code className="bg-muted px-1 rounded">users</code> table.</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li><strong>Add User</strong> — create a new user with username, email, password, and role.</li>
                    <li><strong>Edit</strong> — update any field including password and active status.</li>
                    <li><strong>Delete</strong> — removes the user from the database (with confirmation).</li>
                  </ul>
                </div>

                <h4 className="text-foreground font-medium mt-2">Roles tab</h4>
                <div className="pl-2 border-l-2 border-border">
                  <p>View and manage roles (System Admin, General User) in the <code className="bg-muted px-1 rounded">roles</code> table. Add custom roles or delete unused ones.</p>
                </div>

                <h4 className="text-foreground font-medium mt-2">AIO Data tab</h4>
                <div className="space-y-2 pl-2 border-l-2 border-border">
                  <p>Browses the <code className="bg-muted px-1 rounded">aio_data</code> table — the structured AIO store with 50 element columns per record.</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li><strong>View</strong> — see all elements for any AIO record.</li>
                    <li><strong>Edit</strong> — update the AIO name or any element value.</li>
                    <li><strong>Delete</strong> — remove an AIO record permanently.</li>
                    <li><strong>Add AIO</strong> — manually create a new AIO record.</li>
                  </ul>
                </div>

                <h4 className="text-foreground font-medium mt-2">HSL Data tab</h4>
                <div className="space-y-2 pl-2 border-l-2 border-border">
                  <p>Browses the <code className="bg-muted px-1 rounded">hsl_data</code> table — the structured HSL store with 100 element columns per record.</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li><strong>View</strong> — see all HSL entries (AIO Name, CSV Source, Line #, Created).</li>
                    <li><strong>Edit / Delete</strong> — manage existing HSL records.</li>
                    <li><strong>Add HSL</strong> — manually create an HSL record.</li>
                  </ul>
                </div>

                <h4 className="text-foreground font-medium mt-2">MRO Data tab</h4>
                <div className="space-y-2 pl-2 border-l-2 border-border">
                  <p>Browses the <code className="bg-muted px-1 rounded">mro_objects</code> table — Memory Result Objects saved from ChatAIO sessions. Each row shows the query text, synthesized result, matched HSLs count, and search terms JSON.</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li><strong>View</strong> — inspect the full query, context bundle, and result.</li>
                    <li><strong>Delete</strong> — remove an MRO (does not affect the source AIOs).</li>
                  </ul>
                </div>

                <h4 className="text-foreground font-medium mt-2">Info Elements tab</h4>
                <div className="space-y-2 pl-2 border-l-2 border-border">
                  <p>Browses the <code className="bg-muted px-1 rounded">information_elements</code> table — the unique field-name index with per-field AIO counts.</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li><strong>View values</strong> — eye icon opens a dialog showing all data values for that field across every AIO.</li>
                    <li><strong>Edit / Delete</strong> — manual adjustments.</li>
                    <li><strong>Rebuild</strong> — scans all AIOs and rebuilds the index. Runs automatically after bulk imports.</li>
                  </ul>
                </div>

                <h4 className="text-foreground font-medium mt-2">Saved CSVs tab</h4>
                <div className="pl-2 border-l-2 border-border">
                  <p>Lists every original CSV file stored in <code className="bg-muted px-1 rounded">information_objects</code> with type=CSV. Click a row to preview the file contents. Both standard uploads and Bulk CSV Processing imports appear here.</p>
                </div>

                <h4 className="text-foreground font-medium mt-2">Saved AIOs tab</h4>
                <div className="pl-2 border-l-2 border-border">
                  <p>Lists every AIO URI record from <code className="bg-muted px-1 rounded">information_objects</code> with type=AIO. Complements the structured AIO Data view.</p>
                </div>

                <h4 className="text-foreground font-medium mt-2">Saved Prompts tab</h4>
                <div className="pl-2 border-l-2 border-border">
                  <p>Manages saved ChatAIO prompts stored in the <code className="bg-muted px-1 rounded">saved_prompts</code> table. View, edit, or delete prompts that were saved with the bookmark icon during chat sessions.</p>
                </div>

                <h4 className="text-foreground font-medium mt-2">API Key tab</h4>
                <div className="pl-2 border-l-2 border-border">
                  <p>Configure the <strong>Anthropic API Key</strong> used by ChatAIO, PDF Import, AI Field Maps, and the Summarize operator. Paste your key and click Save. The key is stored in <code className="bg-muted px-1 rounded">system_settings</code> and loaded at server startup.</p>
                </div>

                <h4 className="text-foreground font-medium mt-2">Architecture tab</h4>
                <div className="pl-2 border-l-2 border-border">
                  <p>Interactive SVG architecture diagram showing the full AIO / HSL / MRO model, data sources, ChatAIO retrieval, PostgreSQL tables, API endpoints, and the recursive memory loop. Useful for onboarding and presentations.</p>
                </div>
              </CardContent></Card>
            )}

            {/* ── CSV FORMAT ── */}
            {activeSection === "csv-format" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileSpreadsheet className="w-5 h-5" />CSV Format Requirements</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>The AIO Generator accepts standard CSV files with the following requirements:</p>
                <ul className="list-disc list-inside space-y-2">
                  <li>First row must contain column headers (used as AIO element keys).</li>
                  <li>Comma-separated values — standard CSV delimiter.</li>
                  <li>Quoted fields are supported for values that contain commas.</li>
                  <li>Doubled quotes <code className="bg-muted px-1 rounded">""</code> inside quoted fields produce a literal quote character.</li>
                  <li>UTF-8 encoding recommended.</li>
                  <li>File extension must be <code className="bg-muted px-1 rounded">.csv</code>.</li>
                  <li>Maximum 50 columns per file (elements 51+ are silently truncated).</li>
                </ul>
                <h4 className="text-foreground font-medium mt-4">Example CSV</h4>
                <div className="p-3 rounded-lg bg-muted font-mono text-xs space-y-0.5">
                  <p>Name,Age,City,Occupation</p>
                  <p>Alice Johnson,34,New York,Engineer</p>
                  <p>Bob Smith,28,San Francisco,Designer</p>
                  <p>Carol White,45,Chicago,Manager</p>
                </div>
                <h4 className="text-foreground font-medium mt-4">Tips for best results</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li>Use clear, descriptive column headers — they become the semantic keys in every AIO.</li>
                  <li>Remove completely empty rows before uploading.</li>
                  <li>Keep column headers consistent across related files to improve cross-file HSL matching.</li>
                  <li>Each unique filename is treated as a separate data source; renaming a file bypasses duplicate detection.</li>
                </ul>
              </CardContent></Card>
            )}

            {/* ── AIO FORMAT ── */}
            {activeSection === "aio-format" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Database className="w-5 h-5" />AIO Format Specification</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>Each AIO is a single-line string of concatenated <code className="bg-muted px-1 rounded">[Key.Value]</code> bracket elements — no spaces or separators between elements.</p>

                <h4 className="text-foreground font-medium mt-4">Mandatory metadata prefix (first 3 elements)</h4>
                <div className="p-3 rounded-lg bg-muted font-mono text-xs">
                  [OriginalCSV.&lt;filename&gt;][FileDate.YYYY-MM-DD][FileTime.HH:MM:SS]
                </div>

                <h4 className="text-foreground font-medium mt-4">Data elements (one per CSV column)</h4>
                <div className="p-3 rounded-lg bg-muted font-mono text-xs">
                  [&lt;ColumnHeader&gt;.&lt;CellValue&gt;]
                </div>

                <h4 className="text-foreground font-medium mt-4">Complete example</h4>
                <div className="p-3 rounded-lg bg-muted font-mono text-xs break-all">
                  [OriginalCSV.employees.csv][FileDate.2024-01-15][FileTime.10:30:00][Name.Alice Johnson][Age.34][City.New York][Occupation.Engineer]
                </div>

                <h4 className="text-foreground font-medium mt-4">Value sanitization rules</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li>Newlines (<code className="bg-muted px-1 rounded">\n</code>, <code className="bg-muted px-1 rounded">\r\n</code>, <code className="bg-muted px-1 rounded">\r</code>) → replaced with a space.</li>
                  <li>Tab characters (<code className="bg-muted px-1 rounded">\t</code>) → replaced with a space.</li>
                  <li>Empty cells → stored as an empty string between the dot and the closing bracket: <code className="bg-muted px-1 rounded">[Column.]</code></li>
                </ul>

                <h4 className="text-foreground font-medium mt-4">Database storage</h4>
                <p>Each AIO is stored in two places:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>aio_data table</strong> — parsed into up to 50 individual <code className="bg-muted px-1 rounded">element_N</code> columns plus <code className="bg-muted px-1 rounded">aio_name</code>.</li>
                  <li><strong>information_objects table</strong> — the full AIO line URL-encoded as a <code className="bg-muted px-1 rounded">data:text/aio,...</code> URI for complete fidelity retrieval.</li>
                </ul>
              </CardContent></Card>
            )}

            {/* ── TIPS ── */}
            {activeSection === "tips" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Zap className="w-5 h-5" />Tips & Best Practices</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <h4 className="text-foreground font-medium">Getting the most from semantic matching</h4>
                <ul className="list-disc list-inside space-y-2">
                  <li>Upload related CSVs together (e.g. vendors, invoices, projects) so the processor can find cross-file links like a vendor name appearing in both a vendor list and an invoice file.</li>
                  <li>Use identical column names across related files — <code className="bg-muted px-1 rounded">Vendor Name</code> in both files matches better than <code className="bg-muted px-1 rounded">Vendor Name</code> vs <code className="bg-muted px-1 rounded">Supplier</code>.</li>
                  <li>After uploading new CSVs, use <strong>Process AIO Files</strong> immediately to analyze that batch. Use <strong>Create New HSLs</strong> from the home page to analyze all historical data.</li>
                </ul>

                <h4 className="text-foreground font-medium mt-4">Working with the backend offline</h4>
                <ul className="list-disc list-inside space-y-2">
                  <li>Conversion, preview, and download all work without a backend connection.</li>
                  <li>Saves, duplicate detection, Summarize All, ChatAIO, View All AIOs, and View HSL Database all require backend connectivity.</li>
                  <li>If the backend goes offline mid-session, converted data remains in memory until you refresh the page.</li>
                </ul>

                <h4 className="text-foreground font-medium mt-4">Managing large data sets</h4>
                <ul className="list-disc list-inside space-y-2">
                  <li>The backend loads up to 500 AIO records at a time into the Hyper-Semantic Processor search.</li>
                  <li>Each CSV is capped at 50 columns for AIO element storage.</li>
                  <li>Each HSL stores up to 100 matching AIO rows; additional matches are truncated.</li>
                  <li>Use the <strong>Search AIOs</strong> box to filter large AIO collections before clicking elements.</li>
                </ul>

                <h4 className="text-foreground font-medium mt-4">Changing your admin password</h4>
                <p>Log in to System Admin → Users tab → click <strong>Edit</strong> on your account → enter a new password → Save. The new password takes effect immediately.</p>

                <h4 className="text-foreground font-medium mt-4">Configuring the AI (ChatAIO / Summarize)</h4>
                <p>Log in to System Admin → Settings tab → paste your Anthropic API key → Save. The key is stored in the database and loaded automatically on every backend restart.</p>
              </CardContent></Card>
            )}

          </div>
        </div>
      </main>
    </div>
  )
}

// ── WorkflowDescription Component ──────────────────────────────────

function WorkflowDescription({ onBack, onSysAdmin }: { onBack: () => void; onSysAdmin: () => void }) {
  const [activeSection, setActiveSection] = useState<string>("overview")
  const sections = [
    { id: "overview", label: "Overview", icon: Globe },
    { id: "upload", label: "1. File Upload & Validation", icon: FileText },
    { id: "parsing", label: "2. CSV Parsing", icon: Layers },
    { id: "conversion", label: "3. AIO Conversion", icon: Database },
    { id: "storage", label: "4. Database Storage", icon: Database },
    { id: "dedup", label: "5. Duplicate Detection", icon: Search },
    { id: "retrieval", label: "6. AIO Retrieval & Reconstruction", icon: ArrowLeft },
    { id: "semantic", label: "7. Semantic Processing", icon: Cpu },
    { id: "hsl-formation", label: "8. HSL Formation Detail", icon: Layers },
    { id: "chataio", label: "9. ChatAIO", icon: Globe },
    { id: "mro-workflow", label: "10. Memory Result Objects", icon: Layers },
    { id: "pdf-import-workflow", label: "11. PDF Import", icon: FileText },
    { id: "bulk-csv-workflow", label: "12. Bulk CSV Processing", icon: FileSpreadsheet },
    { id: "field-maps-workflow", label: "13. AI Field Maps", icon: Network },
    { id: "sysadmin-workflow", label: "14. System Administration", icon: Settings },
    { id: "architecture-workflow", label: "15. Architecture Diagram", icon: Globe },
    { id: "structure-models", label: "AIO, HSL & MRO Structure Models", icon: Binary },
  ]
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={onBack} className="gap-2"><ArrowLeft className="w-4 h-4" />Back</Button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center"><Cpu className="w-5 h-5 text-primary-foreground" /></div>
                <h1 className="text-xl font-bold text-foreground">AIO Workflow Description</h1>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={onSysAdmin} className="gap-2"><Settings className="w-4 h-4" />System Admin</Button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid lg:grid-cols-[240px_1fr] gap-8">
          <nav className="space-y-1">
            {sections.map((section) => { const Icon = section.icon; return (
              <button key={section.id} onClick={() => setActiveSection(section.id)} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${activeSection === section.id ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
                <Icon className="w-4 h-4" />{section.label}
              </button>
            )})}
          </nav>
          <div className="space-y-6">
            {activeSection === "overview" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Globe className="w-5 h-5" />End-to-End Workflow — V3.1</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p><strong>Information Physics Demo System V3.1</strong> is a production-ready full-stack platform implementing the complete Information Physics model: preserve observations (AIOs), build relational topology (HSLs), enable AI-grounded retrieval (ChatAIO four-phase algebra), and persist successful retrieval episodes (MROs). Each stage is described in detail in the sections to the left.</p>

                <h4 className="text-foreground font-medium mt-4">The complete pipeline</h4>
                <ol className="list-decimal list-inside space-y-2">
                  <li><strong>Ingest (three paths):</strong>
                    <ul className="list-disc list-inside pl-4 mt-1 space-y-1">
                      <li><em>CSV Converter</em> — drag-and-drop single-file upload with duplicate detection.</li>
                      <li><em>PDF Import</em> — Claude extracts tabular data from invoices/reports into CSV form.</li>
                      <li><em>Bulk CSV Processing</em> — batch-import an entire folder with prefix filtering and automatic de-duplication.</li>
                    </ul>
                  </li>
                  <li><strong>Parse:</strong> Each file is read as text and split into a header row plus data rows with quote-aware handling.</li>
                  <li><strong>Convert:</strong> Every row becomes a single-line AIO bracket string: <code className="bg-muted px-1 rounded">[OriginalCSV.name][FileDate.YYYY-MM-DD][FileTime.HH:MM:SS][Col1.Val1][Col2.Val2]...</code></li>
                  <li><strong>Preserve:</strong> AIOs saved to <code className="bg-muted px-1 rounded">aio_data</code> (50 parsed columns) and <code className="bg-muted px-1 rounded">information_objects</code> (encoded URI). Original CSVs saved as type=CSV records.</li>
                  <li><strong>Index:</strong> <code className="bg-muted px-1 rounded">information_elements</code> is rebuilt — a directory of every unique field name with per-field AIO counts. Powers R &amp; D and AIO Search.</li>
                  <li><strong>Link (manual):</strong> Hyper-Semantic Processor lets users click any element to find all AIOs sharing it, and create single-element HSL records.</li>
                  <li><strong>Link (compound):</strong> R &amp; D Compound HSL Builder produces multi-field AND queries matching AIOs that contain ALL selected criteria.</li>
                  <li><strong>Cluster:</strong> AI Field Maps clusters semantically similar field names into fuzzy keys (e.g., Invoice / Invoice # / Invoice Number → &ldquo;Invoice&rdquo;).</li>
                  <li><strong>Retrieve (broad):</strong> ChatAIO <em>Send</em> mode loads all records as Claude context in one LLM call — best for exploratory questions.</li>
                  <li><strong>Retrieve (focused):</strong> ChatAIO <em>AIO Search</em> runs the four-phase algebra: parse prompt → match HSLs → gather AIOs → synthesize. Uses only the focused subset as context. Provenance-traceable.</li>
                  <li><strong>Remember:</strong> Save ChatAIO sessions as MROs — governed episodic objects preserving the full retrieval event (query, seeds, context bundle, operators, result, lineage).</li>
                  <li><strong>Administer:</strong> System Admin panel with 10 tabs covering users, roles, AIO/HSL/MRO data, info elements, saved CSVs/AIOs, prompts, API keys, architecture diagram.</li>
                  <li><strong>Navigate:</strong> V3.1 introduces a persistent navy sidebar with grouped sections (Data / Discovery / Knowledge / Admin). No Back buttons; the dashboard home page shows live stats from every table.</li>
                </ol>

                <h4 className="text-foreground font-medium mt-4">Three-layer data model</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>Layer 1 — AIOs</strong> (observation): primary measurement-bound objects. Immutable.</li>
                  <li><strong>HSLs</strong> (relation): typed links between AIOs sharing element values. Auditable.</li>
                  <li><strong>Layer 2 — MROs</strong> (recollection): retrieval episodes preserving query cue, seed HSLs, traversed AIOs, operator stack, synthesis result, and lineage back to source evidence.</li>
                </ul>
              </CardContent></Card>
            )}
            {activeSection === "upload" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" />1. File Upload &amp; Validation</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>The <code className="bg-muted px-1 rounded">FileUpload</code> component accepts files via the native file input or drag-and-drop. On selection, the <code className="bg-muted px-1 rounded">handleFilesSelected</code> callback fires in <code className="bg-muted px-1 rounded">app/page.tsx</code>.</p>
                <h4 className="text-foreground font-medium mt-4">Duplicate Detection (pre-parse)</h4>
                <p>Before any parsing begins, if the backend is online the app queries <code className="bg-muted px-1 rounded">GET /api/io?type=CSV&source_system=csv-converter&limit=500</code> to retrieve all previously saved CSV records. Each record's <code className="bg-muted px-1 rounded">context.source_object_id</code> field holds the original filename. The incoming filenames are matched against this set:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Matched files → toast error: <em>"filename.csv is already in the database"</em>, skipped.</li>
                  <li>If <strong>all</strong> files are duplicates → processing aborts entirely.</li>
                  <li>If the backend is offline → check is silently skipped, all files proceed.</li>
                </ul>
                <h4 className="text-foreground font-medium mt-4">Metadata Capture</h4>
                <p>For each file, the browser captures <code className="bg-muted px-1 rounded">file.lastModified</code> (a Unix timestamp). This is formatted into <code className="bg-muted px-1 rounded">YYYY-MM-DD</code> and <code className="bg-muted px-1 rounded">HH:MM:SS</code> strings that become the <code className="bg-muted px-1 rounded">FileDate</code> and <code className="bg-muted px-1 rounded">FileTime</code> metadata elements in every AIO from that file.</p>
              </CardContent></Card>
            )}
            {activeSection === "parsing" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Layers className="w-5 h-5" />2. CSV Parsing</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>The <code className="bg-muted px-1 rounded">parseCSV(text)</code> function splits the raw file text into headers and rows:</p>
                <ol className="list-decimal list-inside space-y-2">
                  <li><strong>Line splitting:</strong> The text is split on <code className="bg-muted px-1 rounded">\r?\n</code> and blank lines are filtered out.</li>
                  <li><strong>Header row:</strong> Line 0 is parsed to extract column names.</li>
                  <li><strong>Data rows:</strong> Lines 1–N are each parsed by the inner <code className="bg-muted px-1 rounded">parseLine()</code> function.</li>
                </ol>
                <h4 className="text-foreground font-medium mt-4">Quote-aware Field Parsing</h4>
                <p>The <code className="bg-muted px-1 rounded">parseLine()</code> function iterates character-by-character, tracking an <code className="bg-muted px-1 rounded">inQuotes</code> flag:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>A <code className="bg-muted px-1 rounded">"</code> toggles the quoted state; a doubled <code className="bg-muted px-1 rounded">""</code> inside quotes produces a literal quote character.</li>
                  <li>Commas inside quoted fields are treated as data, not delimiters.</li>
                  <li>This handles standard RFC 4180 CSV encoding.</li>
                </ul>
                <h4 className="text-foreground font-medium mt-4">Output</h4>
                <p>Returns <code className="bg-muted px-1 rounded">{"{ headers: string[], rows: string[][] }"}</code> — a flat array of header names and a 2D array of cell values.</p>
              </CardContent></Card>
            )}
            {activeSection === "conversion" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Database className="w-5 h-5" />3. AIO Conversion</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>Each CSV data row is passed to <code className="bg-muted px-1 rounded">csvToAio(headers, row, fileName, fileDate, fileTime)</code>, which builds a single-line AIO string:</p>
                <h4 className="text-foreground font-medium mt-4">Step 1 — Metadata Prefix</h4>
                <p>Three fixed elements are prepended to every AIO regardless of the CSV content:</p>
                <div className="p-3 rounded-lg bg-muted font-mono text-xs break-all">
                  [OriginalCSV.employees.csv][FileDate.2024-01-15][FileTime.10:30:00]
                </div>
                <h4 className="text-foreground font-medium mt-4">Step 2 — Data Elements</h4>
                <p>For each column index <code className="bg-muted px-1 rounded">i</code>, one element is appended:</p>
                <div className="p-3 rounded-lg bg-muted font-mono text-xs break-all">
                  [ColumnHeader.CellValue]
                </div>
                <ul className="list-disc list-inside space-y-1 mt-2">
                  <li>The column header becomes the key (left of the dot).</li>
                  <li>The cell value becomes the value (right of the dot).</li>
                  <li>Missing cells default to an empty string.</li>
                </ul>
                <h4 className="text-foreground font-medium mt-4">Step 3 — Value Sanitization</h4>
                <p>Before insertion, cell values are sanitized to preserve the single-line format. All of the following are replaced with a single space:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li><code className="bg-muted px-1 rounded">\r\n</code> (Windows line endings)</li>
                  <li><code className="bg-muted px-1 rounded">\n</code> (Unix newlines)</li>
                  <li><code className="bg-muted px-1 rounded">\r</code> (carriage returns)</li>
                  <li><code className="bg-muted px-1 rounded">\t</code> (tab characters)</li>
                </ul>
                <h4 className="text-foreground font-medium mt-4">Final AIO Example</h4>
                <div className="p-3 rounded-lg bg-muted font-mono text-xs break-all">
                  [OriginalCSV.employees.csv][FileDate.2024-01-15][FileTime.10:30:00][Name.Alice Johnson][Age.34][City.New York][Occupation.Engineer]
                </div>
                <p className="mt-2">All elements are joined with no separator — the result is a single continuous string stored as one line per AIO file.</p>
              </CardContent></Card>
            )}
            {activeSection === "storage" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Database className="w-5 h-5" />4. Database Storage</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>After conversion, the <code className="bg-muted px-1 rounded">saveAIOsToBackend()</code> function persists data in three passes (batched 5-at-a-time to stay within rate limits):</p>
                <h4 className="text-foreground font-medium mt-4">Pass 1 — information_objects (AIO)</h4>
                <p>Each AIO line is URL-encoded and stored as a data URI in the <code className="bg-muted px-1 rounded">information_objects</code> table via <code className="bg-muted px-1 rounded">POST /api/io</code>:</p>
                <div className="p-3 rounded-lg bg-muted font-mono text-xs break-all">
                  {"type: \"AIO\", raw_uri: \"data:text/aio,<encoded_line>\", mime_type: \"text/aio\", source_system: \"csv-converter\", source_object_id: \"filename.csv\""}
                </div>
                <h4 className="text-foreground font-medium mt-4">Pass 2 — aio_data (parsed elements)</h4>
                <p>Each AIO line is also parsed by <code className="bg-muted px-1 rounded">parseAioLine()</code> (see Format Reference) and stored in the <code className="bg-muted px-1 rounded">aio_data</code> table via <code className="bg-muted px-1 rounded">POST /api/aio-data</code>:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li><code className="bg-muted px-1 rounded">aio_name</code> = <em>"filename.csv - Row N"</em></li>
                  <li><code className="bg-muted px-1 rounded">element_1</code>…<code className="bg-muted px-1 rounded">element_50</code> = each raw bracket string <code className="bg-muted px-1 rounded">[Key.Value]</code> from the AIO (up to 50; extras are truncated, missing slots are NULL).</li>
                </ul>
                <h4 className="text-foreground font-medium mt-4">Pass 3 — information_objects (CSV)</h4>
                <p>The original CSV text is reconstructed from the parsed rows and stored as a CSV data URI:</p>
                <div className="p-3 rounded-lg bg-muted font-mono text-xs break-all">
                  {"type: \"CSV\", raw_uri: \"data:text/csv,<encoded_csv>\", mime_type: \"text/csv\", source_system: \"csv-converter\", source_object_id: \"filename.csv\""}
                </div>
                <p className="mt-2">This CSV record is what the duplicate-detection check searches for on subsequent uploads.</p>
              </CardContent></Card>
            )}
            {activeSection === "dedup" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Search className="w-5 h-5" />5. Duplicate Detection</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>Duplicate detection runs at the start of <code className="bg-muted px-1 rounded">handleFilesSelected</code>, before any parsing. It prevents the same CSV from being processed and stored twice.</p>
                <h4 className="text-foreground font-medium mt-4">Algorithm</h4>
                <ol className="list-decimal list-inside space-y-2">
                  <li>Query the backend: <code className="bg-muted px-1 rounded">GET /api/io?type=CSV&source_system=csv-converter&limit=500</code></li>
                  <li>Build a <code className="bg-muted px-1 rounded">Set</code> of all <code className="bg-muted px-1 rounded">context.source_object_id</code> values from the returned records. These are the original filenames of previously processed CSVs.</li>
                  <li>Filter the user's selected files: any file whose <code className="bg-muted px-1 rounded">file.name</code> is in the set is a duplicate.</li>
                  <li>For each duplicate, show a toast: <em>"filename.csv is already in the database. Please pick a different file."</em></li>
                  <li>Remove duplicates from the processing queue. If none remain, abort.</li>
                </ol>
                <h4 className="text-foreground font-medium mt-4">Offline Behaviour</h4>
                <p>If <code className="bg-muted px-1 rounded">backendIsOnline</code> is false, the check is skipped entirely — all files proceed through conversion normally.</p>
              </CardContent></Card>
            )}
            {activeSection === "retrieval" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><ArrowLeft className="w-5 h-5" />6. AIO Retrieval &amp; Reconstruction</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>Users can reload previously saved AIOs from the backend via the <strong>"Load from Database"</strong> button. The <code className="bg-muted px-1 rounded">handleLoadFromBackend</code> function executes two parallel queries:</p>
                <ol className="list-decimal list-inside space-y-2">
                  <li><code className="bg-muted px-1 rounded">GET /api/io?type=AIO&source_system=csv-converter&limit=500</code> — fetches saved AIO records.</li>
                  <li><code className="bg-muted px-1 rounded">GET /api/io?type=CSV&source_system=csv-converter&limit=500</code> — fetches saved CSV records.</li>
                </ol>
                <h4 className="text-foreground font-medium mt-4">CSV Reconstruction from AIOs</h4>
                <p>The <code className="bg-muted px-1 rounded">reconstructCsvFromAios(records)</code> function rebuilds tabular data from AIO records:</p>
                <ol className="list-decimal list-inside space-y-2">
                  <li>Decode each AIO's <code className="bg-muted px-1 rounded">raw_uri</code>: strip the <code className="bg-muted px-1 rounded">data:text/aio,</code> prefix and URL-decode the remainder.</li>
                  <li>Parse the AIO string with <code className="bg-muted px-1 rounded">parseAioLine()</code> to get key-value elements.</li>
                  <li>Filter out the three metadata keys (<code className="bg-muted px-1 rounded">OriginalCSV</code>, <code className="bg-muted px-1 rounded">FileDate</code>, <code className="bg-muted px-1 rounded">FileTime</code>).</li>
                  <li>Collect the union of all remaining keys as the header row.</li>
                  <li>Reconstruct each data row by mapping each header to its value in that AIO (empty string if missing).</li>
                </ol>
                <p>This means the tabular view is fully recoverable from the AIO records alone — the CSV data URI is a secondary backup.</p>
              </CardContent></Card>
            )}
            {activeSection === "semantic" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Cpu className="w-5 h-5" />7. Semantic Processing</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>The <strong>Hyper-Semantic Processor</strong> (<code className="bg-muted px-1 rounded">SemanticProcessor</code> component) operates entirely in-memory on the AIO lines generated from the current upload session. It does not require the backend to be online.</p>
                <h4 className="text-foreground font-medium mt-4">Step 1 — Parse All AIOs into Elements</h4>
                <p>On load, every AIO line across all uploaded files is passed through <code className="bg-muted px-1 rounded">parseAioLine()</code>. The result is a flat collection of <code className="bg-muted px-1 rounded">ParsedAio</code> objects, each containing:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li><code className="bg-muted px-1 rounded">fileName</code> — the generated <code className="bg-muted px-1 rounded">.aio</code> filename (e.g., <code className="bg-muted px-1 rounded">employees_0001.aio</code>)</li>
                  <li><code className="bg-muted px-1 rounded">elements[]</code> — array of <code className="bg-muted px-1 rounded">{"{ key, value, raw }"}</code> parsed from the line</li>
                  <li><code className="bg-muted px-1 rounded">csvRoot</code> — the source CSV filename without extension</li>
                  <li><code className="bg-muted px-1 rounded">lineNumber</code> — the 1-based row index within that CSV file</li>
                </ul>
                <h4 className="text-foreground font-medium mt-4">Step 2 — Element Selection</h4>
                <p>The UI renders every parsed element as a clickable badge. When the user clicks one, it sets <code className="bg-muted px-1 rounded">selectedElement</code> to that <code className="bg-muted px-1 rounded">{"{ key, value, raw }"}</code> object. This triggers the match search via a <code className="bg-muted px-1 rounded">useMemo</code> hook.</p>
                <h4 className="text-foreground font-medium mt-4">Step 3 — Match Search</h4>
                <p>The <code className="bg-muted px-1 rounded">matchingAios</code> memo filters the full <code className="bg-muted px-1 rounded">parsedAios</code> array:</p>
                <div className="p-3 rounded-lg bg-muted font-mono text-xs break-all">
                  {"parsedAios.filter(aio =>"}{"  aio.elements.some(el => el.key === selectedElement.key && el.value === selectedElement.value))"}
                </div>
                <p className="mt-2">This is an exact match on both key and value — case-sensitive, whitespace-sensitive. Every AIO whose element array contains a token with the identical key and value is included in the result.</p>
                <h4 className="text-foreground font-medium mt-4">Step 4 — Display</h4>
                <p>The matching AIOs are shown in a scrollable panel. The selected element is highlighted in amber within each AIO's element list. The match count is shown in the panel header.</p>
                <h4 className="text-foreground font-medium mt-4">ChatAIO</h4>
                <p>When the backend is online, the <strong>ChatAIO</strong> button opens a full-screen conversational interface with two search modes:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li><strong>Send (Broad Search):</strong> Sends your question to Claude along with ALL stored AIO and HSL records as context (up to 500 records). Best for general exploratory questions.</li>
                  <li><strong>AIO Search (Search Algebra):</strong> A four-phase targeted search: (1) Claude parses your prompt to extract key terms, (2) searches the HSL library for matching records, (3) gathers only the AIOs referenced in those HSLs, (4) answers using only that focused subset. Falls back to direct AIO element search if no HSLs match. Response metadata shows HSL/AIO match counts.</li>
                </ul>
                <p className="mt-2">The header toolbar provides Chat download, PDF export, a built-in User Guide, and Close. Saved Prompts (bookmark icon) allow persisting frequently used queries to PostgreSQL for recall across sessions.</p>
              </CardContent></Card>
            )}
            {activeSection === "hsl-formation" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Layers className="w-5 h-5" />8. HSL Formation — Step by Step</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>An HSL (Hyper-Semantic Layer) file is created by clicking <strong>"Create/Append HSL"</strong> after an element has been selected and its matching AIOs are displayed. The <code className="bg-muted px-1 rounded">handleCreateHsl</code> callback executes the following steps:</p>
                <h4 className="text-foreground font-medium mt-4">Step 1 — Guard Check</h4>
                <p>If no element is selected or <code className="bg-muted px-1 rounded">matchingAios</code> is empty, the function returns immediately. An HSL cannot be created with zero matches.</p>
                <h4 className="text-foreground font-medium mt-4">Step 2 — Derive Identifiers</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>Timestamp:</strong> <code className="bg-muted px-1 rounded">new Date().toISOString()</code> formatted as <code className="bg-muted px-1 rounded">YYYY-MM-DD HH:MM:SS</code></li>
                  <li><strong>Label:</strong> <code className="bg-muted px-1 rounded">Key: Value</code> — human-readable display string</li>
                  <li><strong>Filename:</strong> <code className="bg-muted px-1 rounded">[Key.Value].hsl</code> — uses the same bracket notation as the element itself</li>
                </ul>
                <h4 className="text-foreground font-medium mt-4">Step 3 — Build the Row Table</h4>
                <p>For every AIO in <code className="bg-muted px-1 rounded">matchingAios</code>, one provenance row is created:</p>
                <div className="p-3 rounded-lg bg-muted font-mono text-xs">
                  {"{"}{"\n"}
                  {"  aioName:    aio.fileName,    // e.g. employees_0003.aio"}{"\n"}
                  {"  csvRoot:    aio.csvRoot,     // e.g. employees"}{"\n"}
                  {"  lineNumber: aio.lineNumber,  // e.g. 3"}{"\n"}
                  {"  createdAt:  \"2024-01-15 10:30:00\""}{"\n"}
                  {"}"}
                </div>
                <h4 className="text-foreground font-medium mt-4">Step 4 — Serialise to Text</h4>
                <p>The rows are serialised into a tab-delimited plain-text format:</p>
                <div className="p-3 rounded-lg bg-muted font-mono text-xs whitespace-pre">
{`HSL File: [Department.Engineering].hsl
Selected Value: Department: Engineering
Created: 2024-01-15 10:30:00
Matches: 4

AIO Name            CSV Source    Line #  Created
────────────────────────────────────────────────────────────────────────────────
employees_0001.aio  employees     1       2024-01-15 10:30:00
employees_0005.aio  employees     5       2024-01-15 10:30:00
contractors_0002.aio contractors  2       2024-01-15 10:30:00
contractors_0007.aio contractors  7       2024-01-15 10:30:00`}
                </div>
                <h4 className="text-foreground font-medium mt-4">Step 5 — State Update</h4>
                <p>The serialised content and row data are stored in the <code className="bg-muted px-1 rounded">hslData</code> state, which causes the HSL display pane to render immediately in the UI.</p>
                <h4 className="text-foreground font-medium mt-4">Step 6 — Backend Persistence (if online)</h4>
                <p>If <code className="bg-muted px-1 rounded">backendIsOnline</code> is true, the HSL is saved to the <code className="bg-muted px-1 rounded">information_objects</code> table via <code className="bg-muted px-1 rounded">POST /api/io</code>:</p>
                <div className="p-3 rounded-lg bg-muted font-mono text-xs break-all">
                  {"type: \"HSL\","}{"\n"}
                  {"raw_uri: \"data:text/hsl,<url-encoded-content>\","}{"\n"}
                  {"mime_type: \"text/hsl\","}{"\n"}
                  {"source_system: \"csv-converter\","}{"\n"}
                  {"source_object_id: \"[Department.Engineering].hsl\""}
                </div>
                <p className="mt-2">The HSL can then be retrieved from the HSL Database dialog, decoded from the URI, and displayed.</p>
                <h4 className="text-foreground font-medium mt-4">Why HSL Files Matter</h4>
                <p>An HSL file is an auditable, portable record of a discovered semantic relationship. It captures <em>which</em> AIOs share a common element value, <em>where</em> they originated (CSV source + line), and <em>when</em> the relationship was observed. This provenance chain is what distinguishes Hyper-Semantic Layer records from simple query results.</p>
              </CardContent></Card>
            )}
            {activeSection === "chataio" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Globe className="w-5 h-5" />9. ChatAIO — AI-Powered Q&amp;A</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>ChatAIO is a full-screen AI-powered conversational interface for querying your AIO and HSL data using natural language, powered by Claude AI (claude-sonnet-4-6).</p>

                <h4 className="text-foreground font-medium mt-4">Two Search Modes</h4>
                <div className="space-y-3 ml-2">
                  <div>
                    <p className="font-medium text-foreground">Send (Broad Search) — <code className="bg-muted px-1 rounded">POST /api/op/chat</code></p>
                    <ol className="list-decimal list-inside space-y-1 ml-2">
                      <li>User types a question and clicks <strong>Send</strong> (or presses Enter)</li>
                      <li>Backend fetches up to 500 AIO/HSL records from the database</li>
                      <li>Builds a system prompt with up to 300 AIO lines and 10 HSL blocks as context</li>
                      <li>Sends to Claude, which returns a contextual answer grounded in all available data</li>
                    </ol>
                    <p className="mt-1">Best for broad exploratory questions across all data.</p>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">AIO Search (Search Algebra) — <code className="bg-muted px-1 rounded">POST /api/op/aio-search</code></p>
                    <ol className="list-decimal list-inside space-y-1 ml-2">
                      <li><strong>Parse:</strong> Claude extracts structured search terms (names, projects, dates) from the prompt, guided by known field names from the Information Elements table</li>
                      <li><strong>Match HSLs:</strong> Searches all HSL records for case-insensitive substring matches against extracted terms</li>
                      <li><strong>Gather AIOs:</strong> Collects the AIOs referenced in matching HSLs by looking up <code className="bg-muted px-1 rounded">aio_name</code> in the <code className="bg-muted px-1 rounded">aio_data</code> table</li>
                      <li><strong>Answer:</strong> Sends ONLY the focused AIO subset to Claude, producing a precise targeted answer</li>
                    </ol>
                    <p className="mt-1">Falls back to direct <code className="bg-muted px-1 rounded">ILIKE</code> search across AIO element columns if no HSLs match. Response footer shows HSL/AIO match counts for transparency.</p>
                  </div>
                </div>

                <h4 className="text-foreground font-medium mt-4">Saved Prompts</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>Bookmark icon:</strong> Save the current prompt — choose &quot;Current Session&quot; (ephemeral) or &quot;Save to Database&quot; (persistent via PostgreSQL <code className="bg-muted px-1 rounded">saved_prompts</code> table)</li>
                  <li><strong>History icon:</strong> Browse and reuse prompts from current session or database-saved prompts</li>
                  <li>Manage all saved prompts via <strong>System Admin → Saved Prompts</strong> tab (full CRUD)</li>
                </ul>

                <h4 className="text-foreground font-medium mt-4">Header Toolbar</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>Chat:</strong> Download the full conversation as a Markdown file</li>
                  <li><strong>PDF:</strong> Generate a formatted PDF report with print/save options</li>
                  <li><strong>Guide:</strong> Built-in ChatAIO user guide with full feature documentation</li>
                  <li><strong>Close:</strong> Close the dialog and return to the home page</li>
                </ul>

                <h4 className="text-foreground font-medium mt-4">Additional Features</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>Table Rendering:</strong> Markdown tables in responses render as formatted HTML tables</li>
                  <li><strong>Suggested Questions:</strong> Starter prompts shown when chat is empty</li>
                  <li><strong>Session History:</strong> Full conversation preserved within the session</li>
                </ul>

                <h4 className="text-foreground font-medium mt-4">Requirements</h4>
                <p>ChatAIO requires a valid Anthropic API key configured in System Admin → API Key. The backend must be online (green &quot;Backend Connected&quot; badge).</p>
              </CardContent></Card>
            )}
            {activeSection === "mro-workflow" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Layers className="w-5 h-5 text-purple-600" />10. Memory Result Objects (MROs)</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>MROs are the episodic memory layer (Layer 2: Recollection) of the Information Physics model. They capture the results of AI-driven queries along with full provenance.</p>
                <h4 className="text-foreground font-medium mt-4">MRO Structure</h4>
                <div className="p-3 rounded-lg bg-muted font-mono text-xs whitespace-pre">{`MRO = ⟨ Q, S, C, O, R, P, L ⟩
  Q = Query (original user prompt)
  S = Search Terms (parsed field_values + keywords)
  C = Context (matched AIO records)
  O = Output (AI-generated answer)
  R = References (matched HSL names)
  P = Provenance (timestamp, model, tenant)
  L = Links (MROKey linking to source HSLs/AIOs)`}</div>
                <h4 className="text-foreground font-medium mt-4">MRO Key Format</h4>
                <div className="p-3 rounded-lg bg-muted font-mono text-xs">[MROKey.HSL-n-AIO-m] — where n = matched HSL count, m = matched AIO count</div>
                <h4 className="text-foreground font-medium mt-4">Saving &amp; Viewing MROs</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li>After an AIO Search response in ChatAIO, click <strong>Save MRO</strong> to persist the result</li>
                  <li>The MRO is stored in the <code className="bg-muted px-1 rounded">mro_objects</code> PostgreSQL table</li>
                  <li>Click <strong>View MROs</strong> in ChatAIO to browse all saved Memory Result Objects</li>
                  <li>Each MRO displays its query, search terms, matched counts, and full response</li>
                </ul>
                <h4 className="text-foreground font-medium mt-4">Three-Layer Hierarchy</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>Layer 1 — Observation (AIOs):</strong> Raw data captured as bracket-notation objects</li>
                  <li><strong>Relational Topology (HSLs):</strong> Links between AIOs sharing common elements</li>
                  <li><strong>Layer 2 — Recollection (MROs):</strong> Episodic memory of intelligent query results</li>
                  <li><strong>Layer 3 — Knowledge (SKOs):</strong> Future governed abstractions from MRO convergence</li>
                </ul>
                <h4 className="text-foreground font-medium mt-4">Recursive Memory Loop</h4>
                <p>MROs feed back into the system — past query results can inform future searches, creating a recursive episodic memory that grows more valuable with each interaction.</p>
              </CardContent></Card>
            )}
            {activeSection === "pdf-import-workflow" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" />11. PDF Import → CSV</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>The PDF Import feature uses Claude AI to extract structured data from PDF documents (invoices, reports, etc.) and convert it to CSV format for AIO generation.</p>
                <h4 className="text-foreground font-medium mt-4">Process</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li>Click <strong>Import PDFs → CSVs</strong> on the main page</li>
                  <li>Upload one or more PDF files</li>
                  <li>Each PDF is sent to Claude AI via <code className="bg-muted px-1 rounded">/v1/op/pdf-extract</code></li>
                  <li>Claude analyzes pages and extracts structured fields (vendor, amount, date, line items, etc.)</li>
                  <li>Results are returned as CSV data with auto-detected headers</li>
                  <li>View, save, or load the extracted CSVs into the AIO converter</li>
                </ul>
                <h4 className="text-foreground font-medium mt-4">Technical Details</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li>PDF is encoded as base64 and sent to the FastAPI backend</li>
                  <li>Backend uses the Anthropic API with Claude to process each document</li>
                  <li>Requires <code className="bg-muted px-1 rounded">python-multipart</code> package for file upload handling</li>
                  <li>Extracted CSV maintains consistent column structure across multiple pages</li>
                </ul>
              </CardContent></Card>
            )}
            {activeSection === "bulk-csv-workflow" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileSpreadsheet className="w-5 h-5" />12. Bulk CSV Processing</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>The Bulk CSV Processing tab in R &amp; D lets users batch-import an entire folder of CSV files in one operation, replicating the exact save pipeline of the standard CSV Converter while adding automatic de-duplication.</p>

                <h4 className="text-foreground font-medium mt-4">Folder selection (client-side only)</h4>
                <p>The UI uses the browser&apos;s native directory picker (<code className="bg-muted px-1 rounded">&lt;input webkitdirectory&gt;</code>) to load all <code className="bg-muted px-1 rounded">.csv</code> files from a local folder into memory. No filesystem path is ever sent to the server — each File object is read via <code className="bg-muted px-1 rounded">file.text()</code> in the browser.</p>

                <h4 className="text-foreground font-medium mt-4">Prefix filtering</h4>
                <p>After folder selection, the UI computes the set of unique first-3-character filename prefixes (uppercased) and populates a pulldown with those values, sorted alphabetically. The default selection is <strong>ACC</strong> if present, otherwise the first alphabetical prefix. Changing the prefix filters the visible file list instantly. Only files whose name starts with the selected prefix (case-insensitive) will be processed.</p>

                <h4 className="text-foreground font-medium mt-4">Row counting</h4>
                <p>For each file, the processor parses the CSV using the same <code className="bg-muted px-1 rounded">parseCSV()</code> helper as the standard converter, then displays the row count and file size in the file list. This runs asynchronously on folder selection.</p>

                <h4 className="text-foreground font-medium mt-4">Two-stage de-duplication</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>Stage 1 (CSVs):</strong> Before processing, <code className="bg-muted px-1 rounded">GET /v1/io?type=CSV&source_system=csv-converter</code> returns every previously-saved CSV filename. Files whose <code className="bg-muted px-1 rounded">file.name</code> is already in that set have their CSV-save step skipped.</li>
                  <li><strong>Stage 2 (AIOs):</strong> <code className="bg-muted px-1 rounded">GET /v1/aio-data</code> returns every existing AIO record. For each row being processed, the computed <code className="bg-muted px-1 rounded">aio_name = filename + &quot; - Row N&quot;</code> is checked against that set. Matching rows are skipped; new ones are saved.</li>
                </ul>

                <h4 className="text-foreground font-medium mt-4">Save pipeline (identical to standard converter)</h4>
                <ol className="list-decimal list-inside space-y-1">
                  <li><strong>CSV save (once per file):</strong> <code className="bg-muted px-1 rounded">POST /v1/io</code> with <code className="bg-muted px-1 rounded">type=CSV</code>, the full CSV text as a <code className="bg-muted px-1 rounded">data:text/csv</code> URI, and <code className="bg-muted px-1 rounded">source_system=csv-converter</code>. This makes bulk-imported files appear in System Admin → Saved CSVs alongside standard uploads.</li>
                  <li><strong>Per-row AIO save</strong> (parallel batches of 5):
                    <ul className="list-disc list-inside pl-4 mt-1 space-y-1">
                      <li><code className="bg-muted px-1 rounded">POST /v1/aio-data</code> — parsed elements in a 50-slot array.</li>
                      <li><code className="bg-muted px-1 rounded">POST /v1/io</code> — the full AIO line as a <code className="bg-muted px-1 rounded">data:text/aio</code> URI with <code className="bg-muted px-1 rounded">type=AIO</code>.</li>
                    </ul>
                  </li>
                  <li><strong>Information Elements rebuild</strong>: After all files complete, <code className="bg-muted px-1 rounded">POST /v1/information-elements/rebuild</code> scans every AIO, extracts all unique <code className="bg-muted px-1 rounded">[Field.X]</code> names, and refreshes the field index with updated AIO counts.</li>
                </ol>

                <h4 className="text-foreground font-medium mt-4">Progress reporting</h4>
                <p>As processing proceeds, the UI shows a live progress bar (current file / total files) and per-file status badges (✓ saved / skipped / failed counts). On completion, a summary card displays: Files processed, CSVs saved, New AIOs, Duplicates skipped, Failures. A toast notification summarizes the totals.</p>
              </CardContent></Card>
            )}

            {activeSection === "field-maps-workflow" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Network className="w-5 h-5" />13. AI Field Maps</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>AI Field Maps clusters semantically similar field names into &ldquo;Fuzzy Keys.&rdquo; For example, all variations of an invoice identifier — Invoice, Invoice Number, Invoice No, Invoice # — can be grouped under a single canonical key &ldquo;Invoice.&rdquo;</p>

                <h4 className="text-foreground font-medium mt-4">Data model</h4>
                <p>Two PostgreSQL tables (migration <code className="bg-muted px-1 rounded">012_ai_field_maps.sql</code>):</p>
                <ul className="list-disc list-inside space-y-1">
                  <li><code className="bg-muted px-1 rounded">field_map_keys</code> — one row per fuzzy key (<code>key_id</code>, <code>fuzzy_key</code>, <code>description</code>, timestamps).</li>
                  <li><code className="bg-muted px-1 rounded">field_map_members</code> — many rows per key (<code>member_id</code>, <code>key_id</code> FK with CASCADE DELETE, <code>field_name</code>, UNIQUE on <code>(key_id, field_name)</code>).</li>
                </ul>

                <h4 className="text-foreground font-medium mt-4">AI generation (Regenerate with AI)</h4>
                <p>Clicking <strong>Regenerate with AI</strong> calls <code className="bg-muted px-1 rounded">POST /v1/op/generate-field-maps</code>. The backend:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Fetches every <code className="bg-muted px-1 rounded">field_name</code> from <code className="bg-muted px-1 rounded">information_elements</code>.</li>
                  <li>Sends the list to Claude Sonnet 4.6 with a system prompt instructing it to cluster semantically equivalent field names under a single canonical fuzzy key. Examples are provided inline (Invoice, Name, Company Name, Address).</li>
                  <li>Parses the JSON response (handling code-fence wrapping and JSON errors with a fallback).</li>
                  <li>In a single transaction: wipes existing <code className="bg-muted px-1 rounded">field_map_keys</code> and <code className="bg-muted px-1 rounded">field_map_members</code>, then inserts the new clusters.</li>
                </ol>
                <p>Max tokens: 8000. The operation is idempotent and safe to re-run.</p>

                <h4 className="text-foreground font-medium mt-4">Manual CRUD</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>Add Key</strong> — opens a dialog with fuzzy key name, optional description, and a searchable multi-select of field names from the Information Elements directory.</li>
                  <li><strong>Edit</strong> (pencil icon) — modify any existing key&apos;s name, description, or member list. Replaces all members when saved.</li>
                  <li><strong>Delete</strong> (trash icon) — cascade deletes all member associations via the FK constraint.</li>
                </ul>

                <h4 className="text-foreground font-medium mt-4">UI presentation</h4>
                <p>Table with navy header showing Fuzzy Key / Matching Field Names / Actions. Each row displays the key name in bold, followed by a wrap-flex of Badge chips for every member field. Counts appear under the key name (e.g., &ldquo;4 fields&rdquo;).</p>
              </CardContent></Card>
            )}

            {activeSection === "sysadmin-workflow" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Settings className="w-5 h-5" />14. System Administration</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>The System Admin panel provides full CRUD management for all backend data and user access control.</p>
                <h4 className="text-foreground font-medium mt-4">User Management</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li>Create, update, and delete user accounts via <code className="bg-muted px-1 rounded">/api/users</code>.</li>
                  <li>Assign roles to users for access control.</li>
                  <li>Default admin account is seeded during database migration.</li>
                </ul>
                <h4 className="text-foreground font-medium mt-4">Data Management</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>AIO Data:</strong> Browse, search, and inspect all parsed AIO element records in <code className="bg-muted px-1 rounded">aio_data</code>.</li>
                  <li><strong>HSL Data:</strong> View and manage Hyper-Semantic Layer relationship records in <code className="bg-muted px-1 rounded">hsl_data</code>.</li>
                  <li><strong>CSV Viewer:</strong> Inspect original CSV data stored in <code className="bg-muted px-1 rounded">information_objects</code>.</li>
                </ul>
                <h4 className="text-foreground font-medium mt-4">Settings &amp; Tools</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>API Key:</strong> Configure the Anthropic API key used by ChatAIO for LLM-powered queries.</li>
                  <li><strong>Role Management:</strong> Define roles and permissions via <code className="bg-muted px-1 rounded">/api/roles</code>.</li>
                  <li><strong>Saved Prompts:</strong> Manage persistent ChatAIO prompts stored in PostgreSQL.</li>
                  <li><strong>Info Elements:</strong> Browse all unique field names, view data values (eye icon), rebuild from AIOs.</li>
                  <li><strong>Architecture:</strong> Interactive SVG diagram of the complete AIO/HSL/MRO system architecture.</li>
                </ul>
              </CardContent></Card>
            )}
            {activeSection === "architecture-workflow" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Globe className="w-5 h-5" />15. Architecture Diagram</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>The Architecture tab in System Admin provides a comprehensive interactive SVG diagram of the entire InformationPhysics.ai platform.</p>
                <h4 className="text-foreground font-medium mt-4">What the Diagram Shows</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>Data Sources:</strong> CSV files, PDF documents, and future data sources</li>
                  <li><strong>Layer 1 — AIO Engine:</strong> Measurement act, bracket notation, element indexing, deduplication</li>
                  <li><strong>Relational Topology — HSL Fabric:</strong> Single-element HSLs, compound HSLs, semantic strings, AIO references</li>
                  <li><strong>Intelligent Retrieval — ChatAIO:</strong> Send (broad) and AIO Search (4-phase algebra), Claude AI integration</li>
                  <li><strong>Layer 2 — MROs:</strong> Memory Result Objects with formal tuple structure and HSL/AIO linking</li>
                  <li><strong>Layer 3 — SKOs (Future):</strong> Governed promotion from MRO convergence</li>
                  <li><strong>Database Layer:</strong> All 8 PostgreSQL tables with their purposes</li>
                  <li><strong>API Layer:</strong> All FastAPI REST endpoints</li>
                  <li><strong>Frontend Layer:</strong> Next.js 16 pages and features</li>
                  <li><strong>Recursive Memory Loop:</strong> Red dashed line showing how MROs feed back as new data sources</li>
                </ul>
                <p>Access via <strong>System Admin → Architecture</strong> tab.</p>
              </CardContent></Card>
            )}
            {activeSection === "structure-models" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Binary className="w-5 h-5" />AIO, HSL &amp; MRO Structure Models</CardTitle></CardHeader><CardContent className="space-y-6 text-sm text-muted-foreground leading-relaxed">
                <div>
                  <h4 className="text-foreground font-semibold text-base mb-3">AIO — Atomic Information Object</h4>
                  <h5 className="text-foreground font-medium mt-3">Grammar</h5>
                  <div className="p-3 rounded-lg bg-muted font-mono text-xs whitespace-pre">
{`AIO     ::= Element+
Element ::= "[" Key "." Value "]"
Key     ::= <non-empty text, no "." or "]">
Value   ::= <text, may contain ".", no "]">`}
                  </div>
                  <h5 className="text-foreground font-medium mt-3">Mandatory Metadata Prefix (first 3 elements, always)</h5>
                  <div className="p-3 rounded-lg bg-muted font-mono text-xs">
                    [OriginalCSV.&lt;filename&gt;][FileDate.YYYY-MM-DD][FileTime.HH:MM:SS]
                  </div>
                  <h5 className="text-foreground font-medium mt-3">Data Elements (one per CSV column)</h5>
                  <div className="p-3 rounded-lg bg-muted font-mono text-xs">
                    [&lt;ColumnHeader&gt;.&lt;CellValue&gt;]
                  </div>
                  <h5 className="text-foreground font-medium mt-3">Complete Example</h5>
                  <div className="p-3 rounded-lg bg-muted font-mono text-xs break-all">
                    [OriginalCSV.employees.csv][FileDate.2024-01-15][FileTime.10:30:00][Name.Alice Johnson][Department.Engineering][City.New York][Role.Senior Engineer]
                  </div>
                  <h5 className="text-foreground font-medium mt-3">Database Representation (aio_data table)</h5>
                  <div className="overflow-x-auto mt-2">
                    <table className="w-full text-xs font-mono border-collapse">
                      <thead><tr className="bg-muted"><th className="border border-border px-2 py-1 text-left">Column</th><th className="border border-border px-2 py-1 text-left">Value</th></tr></thead>
                      <tbody>
                        <tr><td className="border border-border px-2 py-1">aio_id</td><td className="border border-border px-2 py-1">uuid (auto)</td></tr>
                        <tr><td className="border border-border px-2 py-1">aio_name</td><td className="border border-border px-2 py-1">employees.csv - Row 1</td></tr>
                        <tr><td className="border border-border px-2 py-1">element_1</td><td className="border border-border px-2 py-1">[OriginalCSV.employees.csv]</td></tr>
                        <tr><td className="border border-border px-2 py-1">element_2</td><td className="border border-border px-2 py-1">[FileDate.2024-01-15]</td></tr>
                        <tr><td className="border border-border px-2 py-1">element_3</td><td className="border border-border px-2 py-1">[FileTime.10:30:00]</td></tr>
                        <tr><td className="border border-border px-2 py-1">element_4</td><td className="border border-border px-2 py-1">[Name.Alice Johnson]</td></tr>
                        <tr><td className="border border-border px-2 py-1">element_5</td><td className="border border-border px-2 py-1">[Department.Engineering]</td></tr>
                        <tr><td className="border border-border px-2 py-1">element_6…50</td><td className="border border-border px-2 py-1">additional columns or NULL</td></tr>
                        <tr><td className="border border-border px-2 py-1">created_at</td><td className="border border-border px-2 py-1">timestamptz</td></tr>
                        <tr><td className="border border-border px-2 py-1">updated_at</td><td className="border border-border px-2 py-1">timestamptz</td></tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-xs">The full AIO line is also stored in <code className="bg-muted px-1 rounded">information_objects.raw_uri</code> as <code className="bg-muted px-1 rounded">data:text/aio,&lt;url-encoded-line&gt;</code>.</p>
                </div>
                <div className="border-t border-border pt-6">
                  <h4 className="text-foreground font-semibold text-base mb-3">HSL — Hyper-Semantic Layer</h4>
                  <h5 className="text-foreground font-medium mt-3">Purpose</h5>
                  <p>An HSL file records the semantic links between AIOs that share a common element value. It is the output of a match search and captures full provenance: which AIOs matched, from which CSV, on which row, and when the search was performed.</p>
                  <h5 className="text-foreground font-medium mt-3">Filename Convention</h5>
                  <div className="p-3 rounded-lg bg-muted font-mono text-xs">
                    [Key.Value].hsl{"\n"}
                    {"// e.g. [Department.Engineering].hsl"}
                  </div>
                  <h5 className="text-foreground font-medium mt-3">File Structure (plain-text, tab-delimited)</h5>
                  <div className="p-3 rounded-lg bg-muted font-mono text-xs whitespace-pre">
{`HSL File: [Key.Value].hsl          ← filename / link identifier
Selected Value: Key: Value          ← human-readable label
Created: YYYY-MM-DD HH:MM:SS        ← timestamp of match search
Matches: N                          ← total count of matching AIOs
                                    ← blank separator line
AIO Name    CSV Source  Line #  Created   ← column headers
────────────────────────────────────────  ← visual separator (80 dashes)
<aioName>   <csvRoot>   <N>     <ts>      ← one row per matching AIO
<aioName>   <csvRoot>   <N>     <ts>
...`}
                  </div>
                  <h5 className="text-foreground font-medium mt-3">Row Fields</h5>
                  <div className="overflow-x-auto mt-2">
                    <table className="w-full text-xs font-mono border-collapse">
                      <thead><tr className="bg-muted"><th className="border border-border px-2 py-1 text-left">Field</th><th className="border border-border px-2 py-1 text-left">Source</th><th className="border border-border px-2 py-1 text-left">Example</th></tr></thead>
                      <tbody>
                        <tr><td className="border border-border px-2 py-1">AIO Name</td><td className="border border-border px-2 py-1">ParsedAio.fileName</td><td className="border border-border px-2 py-1">employees_0003.aio</td></tr>
                        <tr><td className="border border-border px-2 py-1">CSV Source</td><td className="border border-border px-2 py-1">ParsedAio.csvRoot</td><td className="border border-border px-2 py-1">employees</td></tr>
                        <tr><td className="border border-border px-2 py-1">Line #</td><td className="border border-border px-2 py-1">ParsedAio.lineNumber</td><td className="border border-border px-2 py-1">3</td></tr>
                        <tr><td className="border border-border px-2 py-1">Created</td><td className="border border-border px-2 py-1">new Date() at click time</td><td className="border border-border px-2 py-1">2024-01-15 10:30:00</td></tr>
                      </tbody>
                    </table>
                  </div>
                  <h5 className="text-foreground font-medium mt-3">Database Representation</h5>
                  <p>Stored in <code className="bg-muted px-1 rounded">information_objects</code> with <code className="bg-muted px-1 rounded">type = "HSL"</code>. The full text content is URL-encoded into the <code className="bg-muted px-1 rounded">raw_uri</code> field:</p>
                  <div className="p-3 rounded-lg bg-muted font-mono text-xs break-all">
                    data:text/hsl,HSL%20File%3A%20%5BDepartment.Engineering%5D.hsl%0A...
                  </div>
                  <p className="mt-2">The <code className="bg-muted px-1 rounded">source_object_id</code> field stores the filename (<code className="bg-muted px-1 rounded">[Department.Engineering].hsl</code>), enabling lookup by element.</p>
                  <h5 className="text-foreground font-medium mt-3">Relationship to AIOs</h5>
                  <p>An HSL is not a container of AIO data — it is a <em>pointer table</em>. It records which AIOs share a trait, but the AIOs themselves remain independent. This means an AIO can appear in multiple HSL files (once per shared element value it participates in).</p>
                </div>
              </CardContent></Card>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

// ── ReferencePage Component ────────────────────────────────────────

function ReferencePage({ onBack, onSysAdmin }: { onBack: () => void; onSysAdmin: () => void }) {
  const [activeSection, setActiveSection] = useState<string>("introduction")
  const sections = [
    { id: "introduction", label: "Introduction", icon: Globe },
    { id: "foundations", label: "Foundations", icon: Atom },
    { id: "aio-definition", label: "AIO Definition", icon: Database },
    { id: "semantic-layer", label: "Semantic Layer", icon: Layers },
    { id: "hyper-semantic", label: "Hyper-Semantic Model", icon: Network },
    { id: "information-physics", label: "Information Physics", icon: Cpu },
    { id: "llm-implications", label: "LLM Implications", icon: Zap },
    { id: "future", label: "Future Directions", icon: Binary },
  ]

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={onBack} className="gap-2"><ArrowLeft className="w-4 h-4" />Back</Button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center"><BookOpen className="w-5 h-5 text-primary-foreground" /></div>
                <h1 className="text-xl font-bold text-foreground">Information Physics Reference</h1>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={onSysAdmin} className="gap-2"><Settings className="w-4 h-4" />System Admin</Button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid lg:grid-cols-[240px_1fr] gap-8">
          <nav className="space-y-1">
            {sections.map((section) => { const Icon = section.icon; return (
              <button key={section.id} onClick={() => setActiveSection(section.id)} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${activeSection === section.id ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
                <Icon className="w-4 h-4" />{section.label}
              </button>
            )})}
          </nav>
          <div className="space-y-6">
            {activeSection === "introduction" && (<Card><CardHeader><CardTitle className="flex items-center gap-2"><Globe className="w-5 h-5" />Introduction to Information Physics</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed"><p>Information Physics is a new theoretical framework that treats information as a fundamental physical quantity, on par with matter and energy. This standard model proposes that all meaningful data can be decomposed into Associated Information Objects (AIOs) - discrete, self-describing units that capture both content and context.</p><p>The framework challenges the traditional view of data as passive records stored in application-specific formats. Instead, it posits that information has intrinsic properties and behaviors that can be studied, modeled, and leveraged independently of any particular software system.</p><p>This reference provides an overview of the key concepts, definitions, and implications of the Information Physics Standard Model.</p></CardContent></Card>)}
            {activeSection === "foundations" && (<Card><CardHeader><CardTitle className="flex items-center gap-2"><Atom className="w-5 h-5" />Theoretical Foundations</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed"><h4 className="text-foreground font-medium">The Information Axiom</h4><p>At the core of Information Physics is the axiom that information is not merely a description of reality but a constituent of it. Just as physics studies the fundamental forces and particles of the universe, Information Physics studies the fundamental units and interactions of meaningful data.</p><h4 className="text-foreground font-medium mt-4">Application Independence</h4><p>Traditional data formats (SQL tables, JSON documents, XML trees) are designed to serve specific applications. Information Physics argues that this application-dependence is an artificial constraint that limits our ability to understand and leverage information.</p><h4 className="text-foreground font-medium mt-4">Semantic Completeness</h4><p>An AIO is semantically complete - it contains all the context needed to interpret its meaning without reference to external schemas, documentation, or application logic. This is achieved through the key-value pair structure where the key provides the semantic label and the value provides the data.</p></CardContent></Card>)}
            {activeSection === "aio-definition" && (<Card><CardHeader><CardTitle className="flex items-center gap-2"><Database className="w-5 h-5" />Associated Information Object (AIO)</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed"><h4 className="text-foreground font-medium">Formal Definition</h4><p>An Associated Information Object (AIO) is a single-line string composed of one or more bracketed elements, where each element takes the form <code className="bg-muted px-1 rounded">[Key.Value]</code>. The concatenation of all elements forms a complete, self-describing information object.</p><h4 className="text-foreground font-medium mt-4">Properties</h4><ul className="list-disc list-inside space-y-2"><li><strong>Atomicity:</strong> Each AIO represents one indivisible unit of associated information</li><li><strong>Self-Description:</strong> Keys provide semantic meaning; no external schema required</li><li><strong>Linearity:</strong> Single-line format ensures simple parsing and streaming</li><li><strong>Composability:</strong> AIOs can be combined to form larger information structures</li><li><strong>Provenance:</strong> Metadata elements track the origin and timestamp of data</li></ul><h4 className="text-foreground font-medium mt-4">Element Types</h4><ul className="list-disc list-inside space-y-2"><li><strong>Metadata Elements:</strong> OriginalCSV, FileDate, FileTime - describe the source</li><li><strong>Data Elements:</strong> Column-value pairs from the original data</li></ul></CardContent></Card>)}
            {activeSection === "semantic-layer" && (<Card><CardHeader><CardTitle className="flex items-center gap-2"><Layers className="w-5 h-5" />The Semantic Layer</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed"><p>The Semantic Layer is the conceptual framework that emerges when collections of AIOs are analyzed for shared elements and patterns. It represents the web of meaning that connects individual information objects.</p><h4 className="text-foreground font-medium mt-4">Element Matching</h4><p>When two or more AIOs share an identical element (same key and value), they are semantically linked. This linkage is inherent in the data and requires no external join tables, foreign keys, or relationship definitions.</p><h4 className="text-foreground font-medium mt-4">Emergent Relationships</h4><p>As more AIOs are added to a collection, the semantic layer grows organically. Relationships emerge naturally from shared elements rather than being predefined by a database administrator.</p><h4 className="text-foreground font-medium mt-4">Cross-Domain Discovery</h4><p>Because AIOs are application-agnostic, the semantic layer can reveal connections between data from entirely different domains - connections that traditional siloed databases would never surface.</p></CardContent></Card>)}
            {activeSection === "hyper-semantic" && (<Card><CardHeader><CardTitle className="flex items-center gap-2"><Network className="w-5 h-5" />The Hyper-Semantic Model</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed"><p>The Hyper-Semantic Model extends the basic semantic layer into a multi-dimensional space of meaning. While traditional semantics deals with the meaning of individual terms, hyper-semantics captures the emergent meaning that arises from the interaction of multiple AIOs.</p><h4 className="text-foreground font-medium mt-4">Dimensions of Meaning</h4><ul className="list-disc list-inside space-y-2"><li><strong>Element Frequency:</strong> How often a particular element appears across AIOs</li><li><strong>Co-occurrence:</strong> Which elements tend to appear together</li><li><strong>Exclusivity:</strong> Elements that uniquely identify specific AIOs or clusters</li><li><strong>Temporal Patterns:</strong> How element distributions change over time</li></ul><h4 className="text-foreground font-medium mt-4">Information Density</h4><p>The hyper-semantic model introduces the concept of information density - a measure of how much semantic content is packed into a given AIO or collection. Higher density indicates richer, more interconnected information.</p></CardContent></Card>)}
            {activeSection === "information-physics" && (<Card><CardHeader><CardTitle className="flex items-center gap-2"><Cpu className="w-5 h-5" />Information Physics Principles</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed"><h4 className="text-foreground font-medium">Conservation of Information</h4><p>When data is converted from CSV to AIO format, no information is lost. The transformation is lossless and reversible. This reflects the principle that information, like energy, is conserved through transformations.</p><h4 className="text-foreground font-medium mt-4">Information Gravity</h4><p>AIOs with shared elements naturally cluster together in the semantic layer, much like massive objects attract each other through gravity. The more shared elements between AIOs, the stronger their semantic attraction.</p><h4 className="text-foreground font-medium mt-4">Semantic Entropy</h4><p>As information flows through systems, it tends toward increasing entropy - data becomes fragmented, duplicated, and disconnected. The AIO format counteracts this by maintaining semantic coherence at the object level.</p><h4 className="text-foreground font-medium mt-4">Observation Effect</h4><p>The act of querying or analyzing AIOs through the semantic processor can reveal relationships that were always present but not previously observed, paralleling the observation effect in quantum physics.</p></CardContent></Card>)}
            {activeSection === "llm-implications" && (<Card><CardHeader><CardTitle className="flex items-center gap-2"><Zap className="w-5 h-5" />Implications for Large Language Models</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed"><p>The hyper-semantic model built on AIOs has profound implications for the next generation of Large Language Models (LLMs).</p><h4 className="text-foreground font-medium mt-4">Enhanced Understanding</h4><p>LLMs trained on AIO-structured data would have access to explicit semantic relationships rather than having to infer them from unstructured text. This could dramatically improve comprehension and reduce hallucination.</p><h4 className="text-foreground font-medium mt-4">Grounded Reasoning</h4><p>By operating on self-describing information objects, LLMs could perform more grounded reasoning with clear provenance chains. Every conclusion could be traced back to specific AIO elements.</p><h4 className="text-foreground font-medium mt-4">Cross-Domain Transfer</h4><p>The application-agnostic nature of AIOs means that knowledge gained in one domain automatically transfers to others. An LLM that understands [City.New York] in a personnel context equally understands it in a logistics context.</p><h4 className="text-foreground font-medium mt-4">Semantic Search</h4><p>Instead of keyword matching or vector similarity, AIO-based search operates on exact semantic elements, enabling precise retrieval without the ambiguity of natural language queries.</p></CardContent></Card>)}
            {activeSection === "future" && (<Card><CardHeader><CardTitle className="flex items-center gap-2"><Binary className="w-5 h-5" />Future Directions</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed"><h4 className="text-foreground font-medium">Expanded Format Support</h4><p>While the current implementation converts CSV to AIO, future versions will support conversion from JSON, XML, SQL databases, APIs, and other structured data sources.</p><h4 className="text-foreground font-medium mt-4">Distributed AIO Networks</h4><p>AIOs could be shared across distributed networks, creating a global semantic layer that transcends organizational boundaries while maintaining data sovereignty.</p><h4 className="text-foreground font-medium mt-4">Real-Time Processing</h4><p>Stream processing of AIOs would enable real-time semantic analysis, allowing systems to detect patterns and relationships as data flows rather than in batch processing.</p><h4 className="text-foreground font-medium mt-4">Semantic Compression</h4><p>Frequently occurring elements across AIOs could be compressed using semantic dictionaries, reducing storage requirements while preserving full meaning.</p><h4 className="text-foreground font-medium mt-4">AIO Algebra</h4><p>A formal algebra for AIO operations (union, intersection, difference, projection) would provide a mathematical foundation for information manipulation comparable to relational algebra for databases.</p></CardContent></Card>)}
          </div>
        </div>
      </main>
      <footer className="border-t border-border mt-16"><div className="max-w-6xl mx-auto px-6 py-6 text-center"><p className="text-sm text-muted-foreground">InformationPhysics (informationphysics.ai) - InformationPhysics.ai</p></div></footer>
    </div>
  )
}

// ── SemanticProcessor Component ────────────────────────────────────

function SemanticProcessor({ files, downloadedFiles, onBack, backendIsOnline, onSysAdmin }: { files: ConvertedFile[]; downloadedFiles: string[]; onBack: () => void; backendIsOnline: boolean; onSysAdmin: () => void }) {
  const [selectedAioIndex, setSelectedAioIndex] = useState<number | null>(null)
  const [selectedElement, setSelectedElement] = useState<ParsedElement | null>(null)
  const [summaryCsv, setSummaryCsv] = useState<{ headers: string[]; rows: string[][]; csvString: string } | null>(null)
  const [hslData, setHslData] = useState<{ label: string; fileName: string; rows: { aioName: string; csvRoot: string; lineNumber: number; createdAt: string }[]; content: string } | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [summaryText, setSummaryText] = useState<string | null>(null)
  const [isSummarizing, setIsSummarizing] = useState(false)
  const [entityData, setEntityData] = useState<EntityItem[] | null>(null)
  const [isExtractingEntities, setIsExtractingEntities] = useState(false)
  const [showHslDb, setShowHslDb] = useState(false)
  const [hslDbRecords, setHslDbRecords] = useState<HslDataRecord[]>([])
  const [isLoadingHslDb, setIsLoadingHslDb] = useState(false)
  const [hslDbSelectedRecord, setHslDbSelectedRecord] = useState<HslDataRecord | null>(null)
  const [backendAios, setBackendAios] = useState<ParsedAio[]>([])
  const [isLoadingBackendAios, setIsLoadingBackendAios] = useState(false)
  const [showChat, setShowChat] = useState(false)

  useEffect(() => {
    if (!backendIsOnline) return
    setIsLoadingBackendAios(true)
    listAioData().then((records: AioDataRecord[]) => {
      const parsed: ParsedAio[] = records.map((r) => {
        const raw = r.elements.filter(Boolean).join("")
        const csvRoot = r.aio_name.replace(/\s*-\s*Row\s*\d+$/i, "").replace(/\.csv$/i, "") || "backend"
        const lineNumberMatch = r.aio_name.match(/-\s*Row\s*(\d+)$/i)
        const lineNumber = lineNumberMatch ? parseInt(lineNumberMatch[1], 10) : 0
        return { fileName: r.aio_name, elements: parseAioLine(raw), raw, csvRoot, lineNumber }
      })
      setBackendAios(parsed)
      setIsLoadingBackendAios(false)
    }).catch(() => setIsLoadingBackendAios(false))
  }, [backendIsOnline])

  const parsedAios = useMemo<ParsedAio[]>(() => {
    const results: ParsedAio[] = []
    files.forEach((file, fileIndex) => {
      const csvRoot = file.originalName.replace(/\.csv$/i, "")
      file.aioLines.forEach((line, lineIndex) => {
        const elements = parseAioLine(line)
        const fileName = downloadedFiles.length > 0
          ? downloadedFiles[fileIndex * file.aioLines.length + lineIndex] ?? `${csvRoot}_${String(fileIndex * 1000 + lineIndex + 1).padStart(4, "0")}.aio`
          : `${csvRoot}_${String(fileIndex * 1000 + lineIndex + 1).padStart(4, "0")}.aio`
        results.push({ fileName, elements, raw: line, csvRoot, lineNumber: lineIndex + 1 })
      })
    })
    // Merge backend AIOs, deduplicating by raw line
    const rawSet = new Set(results.map((a) => a.raw))
    backendAios.forEach((a) => { if (!rawSet.has(a.raw)) results.push(a) })
    return results
  }, [files, downloadedFiles, backendAios])

  const filteredAios = useMemo<ParsedAio[]>(() => {
    if (!searchQuery.trim()) return parsedAios
    const q = searchQuery.toLowerCase()
    return parsedAios.filter((aio) =>
      aio.fileName.toLowerCase().includes(q) ||
      aio.elements.some((el) => el.key.toLowerCase().includes(q) || el.value.toLowerCase().includes(q))
    )
  }, [parsedAios, searchQuery])

  const matchingAios = useMemo<ParsedAio[]>(() => {
    if (!selectedElement) return []
    return parsedAios.filter((aio) => aio.elements.some((el) => el.key === selectedElement.key && el.value === selectedElement.value))
  }, [parsedAios, selectedElement])

  const handleAioClick = useCallback((index: number) => {
    setSelectedAioIndex(index === selectedAioIndex ? null : index)
    setSelectedElement(null)
    setSummaryCsv(null)
    setHslData(null)
    setEntityData(null)
  }, [selectedAioIndex])

  const handleSummarize = useCallback(async () => {
    if (!backendIsOnline) { toast.error("Backend offline — connect the backend to use AI summarization"); return }
    setIsSummarizing(true)
    const result = await summarizeAIOs(parsedAios.map((a) => a.raw))
    setSummaryText(result?.summary ?? "Summary unavailable. Check backend connection.")
    setIsSummarizing(false)
  }, [parsedAios, backendIsOnline])

  const handleExtractEntities = useCallback(async (aioText: string) => {
    if (!backendIsOnline) { toast.error("Backend offline — connect the backend to extract entities"); return }
    setIsExtractingEntities(true)
    const result = await resolveEntities(aioText)
    setEntityData(result?.entities ?? [])
    setIsExtractingEntities(false)
  }, [backendIsOnline])

  const handleElementClick = useCallback((element: ParsedElement) => {
    setSelectedElement(element)
    setSummaryCsv(null)
    setHslData(null)
  }, [])

  const handleCreateSummaryCsv = useCallback(() => {
    if (matchingAios.length === 0) return
    const headerSet = new Set<string>()
    matchingAios.forEach((aio) => { aio.elements.forEach((el) => headerSet.add(el.key)) })
    const headers = Array.from(headerSet)
    const rows = matchingAios.map((aio) => {
      const valMap = new Map<string, string>()
      aio.elements.forEach((el) => { valMap.set(el.key, el.value) })
      return headers.map((h) => valMap.get(h) ?? "")
    })
    const escapeCsvField = (field: string) => {
      if (field.includes(",") || field.includes('"') || field.includes("\n")) { return `"${field.replace(/"/g, '""')}"` }
      return field
    }
    const csvLines = [headers.map(escapeCsvField).join(","), ...rows.map((row) => row.map(escapeCsvField).join(","))]
    setSummaryCsv({ headers, rows, csvString: csvLines.join("\n") })
  }, [matchingAios])

  const handleDownloadCsv = useCallback(() => {
    if (!summaryCsv) return
    const blob = new Blob([summaryCsv.csvString], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `matching_aios_${selectedElement ? `${selectedElement.key}_${selectedElement.value}` : "summary"}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [summaryCsv, selectedElement])

  const handleViewHslDb = useCallback(async () => {
    setShowHslDb(true)
    setHslDbSelectedRecord(null)
    setIsLoadingHslDb(true)
    const records = await listHslData()
    setHslDbRecords(records)
    setIsLoadingHslDb(false)
  }, [])

  const handleCreateHsl = useCallback(() => {
    if (!selectedElement || matchingAios.length === 0) return
    const now = new Date()
    const createdAt = now.toISOString().replace("T", " ").substring(0, 19)
    const label = `${selectedElement.key}: ${selectedElement.value}`
    const hslFileName = `[${selectedElement.key}.${selectedElement.value}].hsl`

    const rows = matchingAios.map((aio) => ({
      aioName: aio.fileName,
      csvRoot: aio.csvRoot,
      lineNumber: aio.lineNumber,
      createdAt,
    }))

    const lines: string[] = []
    lines.push(`HSL File: ${hslFileName}`)
    lines.push(`Selected Value: ${label}`)
    lines.push(`Created: ${createdAt}`)
    lines.push(`Matches: ${rows.length}`)
    lines.push("")
    lines.push("AIO Name\tCSV Source\tLine #\tCreated")
    lines.push("─".repeat(80))
    rows.forEach((r) => {
      lines.push(`${r.aioName}\t${r.csvRoot}\t${r.lineNumber}\t${r.createdAt}`)
    })

    const content = lines.join("\n")
    setHslData({ label, fileName: hslFileName, rows, content })
    if (backendIsOnline) {
      const rowElements: (string | null)[] = rows.slice(0, 100).map((r) => `${r.aioName}\t${r.csvRoot}\t${r.lineNumber}\t${r.createdAt}`)
      while (rowElements.length < 100) rowElements.push(null)
      Promise.all([
        createIO({
          type: "HSL",
          raw: { raw_uri: `data:text/hsl,${encodeURIComponent(content)}`, mime_type: "text/hsl", size_bytes: content.length },
          context: { source_system: "csv-converter", source_object_id: hslFileName },
        }),
        createHslData(hslFileName, rowElements),
      ]).then(([ioResult, hslResult]) => { if (ioResult && hslResult) toast.success("HSL saved to database") })
    }
  }, [selectedElement, matchingAios, backendIsOnline])

  const handleDownloadHsl = useCallback(() => {
    if (!hslData) return
    const blob = new Blob([hslData.content], { type: "text/plain;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = hslData.fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [hslData])

  const selectedAio = selectedAioIndex !== null ? parsedAios[selectedAioIndex] : null

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={onBack} className="gap-2"><ArrowLeft className="w-4 h-4" />Back to Converter</Button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-600 flex items-center justify-center"><Search className="w-5 h-5 text-white" /></div>
                <div><h1 className="text-xl font-bold text-foreground">Hyper-Semantic Processor</h1><p className="text-xs text-muted-foreground">{searchQuery ? `${filteredAios.length} of ${parsedAios.length}` : parsedAios.length} AIO files loaded</p></div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {backendIsOnline && (
                <Button variant="outline" size="sm" onClick={handleViewHslDb} className="gap-2 shrink-0">
                  <Database className="w-4 h-4" />
                  View HSL Database
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handleSummarize} disabled={isSummarizing || !backendIsOnline} className="gap-2 shrink-0">
                {isSummarizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cpu className="w-4 h-4" />}
                Summarize All
              </Button>
              {backendIsOnline && (
                <Button variant="outline" size="sm" onClick={() => setShowChat(true)} className="gap-2 shrink-0">
                  <MessageSquare className="w-4 h-4" />
                  ChatAIO
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={onSysAdmin} className="gap-2 shrink-0"><Settings className="w-4 h-4" />System Admin</Button>
            </div>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Search bar */}
        <div className="relative">
          {isLoadingBackendAios
            ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />
            : <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />}
          <input
            type="text"
            placeholder={isLoadingBackendAios ? "Loading AIOs from database…" : "Search AIOs by file name, key, or value…"}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-10 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Summary card */}
        {summaryText && (
          <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
            <CardHeader className="py-3 shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2"><Cpu className="w-4 h-4 text-amber-600" />AI Summary</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setSummaryText(null)}><X className="w-3 h-3" /></Button>
              </div>
            </CardHeader>
            <CardContent className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{summaryText}</CardContent>
          </Card>
        )}

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Left: AIO Files */}
          <Card className="max-h-[calc(100vh-200px)] flex flex-col">
            <CardHeader className="py-3 shrink-0"><CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4" />AIO Files<span className="text-xs font-normal text-muted-foreground">({filteredAios.length} files)</span></CardTitle></CardHeader>
            <CardContent className="p-0 overflow-hidden flex-1 min-h-0">
              <div className="h-full overflow-y-auto overflow-x-auto">
                {filteredAios.map((aio) => {
                  const idx = parsedAios.indexOf(aio)
                  return <button key={idx} onClick={() => handleAioClick(idx)} className={`w-full text-left px-4 py-3 border-b border-border transition-colors ${idx === selectedAioIndex ? "bg-primary/10" : "hover:bg-accent/50"}`}>
                    <div className="flex items-center gap-2 mb-1"><FileText className="w-3 h-3 text-muted-foreground" /><span className="text-xs font-medium text-foreground truncate">{aio.fileName}</span></div>
                    <p className="text-xs text-muted-foreground font-mono truncate">{aio.raw}</p>
                  </button>
                })}
              </div>
            </CardContent>
          </Card>

          {/* Right: Elements or Matches */}
          {selectedElement ? (
            <Card className="max-h-[calc(100vh-200px)] flex flex-col">
              <CardHeader className="py-3 shrink-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2"><Search className="w-4 h-4" />Matching AIOs<span className="text-xs font-normal text-muted-foreground">({matchingAios.length} matches)</span></CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => { setSelectedElement(null); setSummaryCsv(null); setHslData(null) }} className="gap-1 shrink-0"><X className="w-3 h-3" />Clear</Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Searching for: <span className="font-mono bg-primary/15 text-primary px-1 rounded">{selectedElement.raw}</span></p>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <Button variant="outline" size="sm" onClick={handleCreateSummaryCsv} className="gap-1"><FileText className="w-3 h-3" />Create Summary CSV</Button>
                  <Button variant="outline" size="sm" onClick={handleCreateHsl} className="gap-1 bg-amber-600 hover:bg-amber-700 text-white border-amber-600 hover:border-amber-700"><Layers className="w-3 h-3" />Create/Append HSL</Button>
                </div>
              </CardHeader>
              <CardContent className="p-0 overflow-hidden flex-1 min-h-0">
                <div className="h-full overflow-y-auto overflow-x-auto">
                  {matchingAios.map((aio, index) => (
                    <div key={index} className="px-4 py-3 border-b border-border">
                      <div className="flex items-center gap-2 mb-2"><FileText className="w-3 h-3 text-muted-foreground" /><span className="text-xs font-medium text-foreground">{aio.fileName}</span></div>
                      <div className="flex flex-wrap gap-1">
                        {aio.elements.map((el, elIdx) => (
                          <span key={elIdx} className={`inline-flex px-2 py-0.5 rounded text-xs font-mono ${el.key === selectedElement.key && el.value === selectedElement.value ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 ring-1 ring-amber-400" : "bg-secondary text-foreground"}`}>{el.raw}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : selectedAio ? (
            <Card className="max-h-[calc(100vh-200px)] flex flex-col">
              <CardHeader className="py-3 shrink-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4" />AIO Elements<span className="text-xs font-normal text-muted-foreground">({selectedAio.elements.length} elements)</span></CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => handleExtractEntities(selectedAio.raw)} disabled={isExtractingEntities || !backendIsOnline} className="gap-1 text-xs shrink-0">
                    {isExtractingEntities ? <Loader2 className="w-3 h-3 animate-spin" /> : <Network className="w-3 h-3" />}
                    Extract Entities
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Click an element to find all AIOs that share it</p>
              </CardHeader>
              <CardContent className="overflow-y-auto overflow-x-auto flex-1 min-h-0 space-y-4">
                <div className="flex flex-wrap gap-2">
                  {selectedAio.elements.map((element, index) => (
                    <button key={index} onClick={() => handleElementClick(element)} className="inline-flex px-3 py-1.5 rounded-lg bg-secondary text-foreground text-xs font-mono hover:bg-primary/15 hover:text-primary transition-colors cursor-pointer">{element.raw}</button>
                  ))}
                </div>
                {entityData && entityData.length > 0 && (
                  <div className="border-t border-border pt-3">
                    <p className="text-xs font-medium text-foreground mb-2 flex items-center gap-1"><Network className="w-3 h-3" />Extracted Entities</p>
                    <div className="flex flex-wrap gap-1.5">
                      {entityData.map((entity, i) => {
                        const colorMap: Record<string, string> = {
                          Person: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
                          Organization: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
                          Location: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
                          Date: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
                          Product: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400",
                          Project: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400",
                        }
                        const cls = colorMap[entity.type] ?? "bg-secondary text-foreground"
                        return <Badge key={i} className={`text-xs font-normal ${cls}`}>{entity.type}: {entity.value}</Badge>
                      })}
                    </div>
                  </div>
                )}
                {entityData && entityData.length === 0 && (
                  <p className="text-xs text-muted-foreground border-t border-border pt-3">No entities found in this AIO.</p>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card><CardContent className="flex items-center justify-center h-full min-h-[200px]"><div className="text-center"><Search className="w-8 h-8 text-muted-foreground mx-auto mb-3" /><p className="text-sm text-muted-foreground">Select an AIO file to view its elements</p><p className="text-xs text-muted-foreground mt-1">Then click an element to find semantic matches</p></div></CardContent></Card>
          )}
        </div>

        {/* Summary CSV Pane */}
        {summaryCsv && (
          <Card className="max-h-[calc(100vh-200px)] flex flex-col">
            <CardHeader className="py-3 shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4" />Summary CSV<span className="text-xs font-normal text-muted-foreground">({summaryCsv.rows.length} rows x {summaryCsv.headers.length} columns)</span></CardTitle>
                <div className="flex items-center gap-2">
                  <Button variant="default" size="sm" onClick={handleDownloadCsv} className="gap-1"><Download className="w-3 h-3" />Download CSV</Button>
                  <Button variant="ghost" size="sm" onClick={() => setSummaryCsv(null)} className="gap-1"><X className="w-3 h-3" />Close</Button>
                </div>
              </div>
              {selectedElement && (<p className="text-xs text-muted-foreground">Matching element: <span className="font-mono bg-primary/15 text-primary px-1 rounded">{selectedElement.raw}</span></p>)}
            </CardHeader>
            <CardContent className="p-0 overflow-hidden flex-1 min-h-0">
              <div className="h-full overflow-x-auto overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground w-12">#</th>
                      {summaryCsv.headers.map((header, i) => (<th key={i} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">{header}</th>))}
                    </tr>
                  </thead>
                  <tbody>
                    {summaryCsv.rows.map((row, rowIdx) => (
                      <tr key={rowIdx} className="border-t border-border hover:bg-accent/50 transition-colors">
                        <td className="px-3 py-2 text-muted-foreground">{rowIdx + 1}</td>
                        {row.map((cell, cellIdx) => (<td key={cellIdx} className="px-3 py-2 font-mono whitespace-nowrap">{cell}</td>))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* HSL Display Pane */}
        {hslData && (
          <Card className="max-h-[calc(100vh-200px)] flex flex-col">
            <CardHeader className="py-3 shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4 text-amber-600" />
                  {hslData.fileName}
                  <span className="text-xs font-normal text-muted-foreground">
                    ({hslData.rows.length} entries)
                  </span>
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button variant="default" size="sm" onClick={handleDownloadHsl} className="gap-1 bg-amber-600 hover:bg-amber-700">
                    <Download className="w-3 h-3" />
                    Download HSL
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setHslData(null)} className="gap-1">
                    <X className="w-3 h-3" />
                    Close
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Selected value: <span className="font-mono bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 px-1 rounded">{hslData.label}</span>
              </p>
            </CardHeader>
            <CardContent className="p-0 overflow-hidden flex-1 min-h-0">
              <div className="h-full overflow-x-auto overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground w-12">#</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">AIO Name</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">CSV Source</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Line #</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hslData.rows.map((row, idx) => (
                      <tr key={idx} className="border-t border-border hover:bg-accent/50 transition-colors">
                        <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap">{row.aioName}</td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap">{row.csvRoot}</td>
                        <td className="px-3 py-2 font-mono">{row.lineNumber}</td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap">{row.createdAt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      {/* HSL Database Dialog — list */}
      <Dialog open={showHslDb && !hslDbSelectedRecord} onOpenChange={(open) => { if (!open) setShowHslDb(false) }}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Layers className="w-4 h-4 text-amber-600" />HSL Database <span className="text-xs font-normal text-muted-foreground">(read-only)</span></DialogTitle>
          </DialogHeader>
          {isLoadingHslDb ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : hslDbRecords.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No HSL records saved yet.</p>
          ) : (
            <div className="overflow-auto border border-border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">HSL Name</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Entries</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Created</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {hslDbRecords.map((r) => (
                    <tr key={r.hsl_id} className="border-t border-border hover:bg-accent/50 transition-colors">
                      <td className="px-3 py-2 font-mono text-xs">{r.hsl_name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.elements.filter(Boolean).length}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                      <td className="px-3 py-2"><Button variant="ghost" size="sm" onClick={() => setHslDbSelectedRecord(r)} className="text-xs gap-1"><Search className="w-3 h-3" />View</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* HSL Database Dialog — detail */}
      <Dialog open={!!hslDbSelectedRecord} onOpenChange={(open) => { if (!open) setHslDbSelectedRecord(null) }}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Layers className="w-4 h-4 text-amber-600" />{hslDbSelectedRecord?.hsl_name}</DialogTitle>
          </DialogHeader>
          {hslDbSelectedRecord && (
            <div className="flex flex-col gap-3 overflow-auto">
              <p className="text-xs text-muted-foreground">Created: {new Date(hslDbSelectedRecord.created_at).toLocaleString()} · {hslDbSelectedRecord.elements.filter(Boolean).length} entries</p>
              <div className="overflow-auto border border-border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground w-8">#</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">AIO Name</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">CSV Source</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Line #</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hslDbSelectedRecord.elements.filter(Boolean).map((el, idx) => {
                      const [aioName, csvRoot, lineNumber, createdAt] = (el ?? "").split("\t")
                      return (
                        <tr key={idx} className="border-t border-border hover:bg-accent/50">
                          <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                          <td className="px-3 py-2 font-mono whitespace-nowrap">{aioName}</td>
                          <td className="px-3 py-2 font-mono whitespace-nowrap">{csvRoot}</td>
                          <td className="px-3 py-2 font-mono">{lineNumber}</td>
                          <td className="px-3 py-2 font-mono whitespace-nowrap">{createdAt}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <Button variant="outline" size="sm" className="self-start gap-2" onClick={() => setHslDbSelectedRecord(null)}><ArrowLeft className="w-3 h-3" />Back to list</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ChatAioDialog open={showChat} onOpenChange={setShowChat} />
    </div>
  )
}

// ── PDF Import → CSV ──────────────────────────────────────────────

function PdfImportView({ onBack, onSysAdmin, onImportCsv }: { onBack: () => void; onSysAdmin: () => void; onImportCsv: (csv: ConvertedFile) => void }) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [result, setResult] = useState<PdfExtractResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please select a PDF file")
      return
    }
    setIsProcessing(true)
    setError(null)
    setResult(null)
    const data = await extractPdfToCsv(file)
    setIsProcessing(false)
    if (data && data.headers.length > 0) {
      setResult(data)
    } else {
      setError("Failed to extract data from PDF. Make sure the Anthropic API key is configured in System Admin.")
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleDownloadCsv = useCallback(() => {
    if (!result) return
    const blob = new Blob([result.csv_text], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    const baseName = result.filename?.replace(/\.pdf$/i, "") ?? "extracted"
    a.download = `${baseName}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [result])

  const handleImportToConverter = useCallback(() => {
    if (!result) return
    const baseName = result.filename?.replace(/\.pdf$/i, "") ?? "extracted"
    const now = new Date()
    const converted: ConvertedFile = {
      originalName: `${baseName}.csv`,
      csvData: [result.headers, ...result.rows],
      headers: result.headers,
      aioLines: result.rows.map((row) => csvToAio(result.headers, row, `${baseName}.csv`, now.toISOString().substring(0, 10), now.toISOString().substring(11, 19))),
      fileDate: now.toISOString().substring(0, 10),
      fileTime: now.toISOString().substring(11, 19),
    }
    onImportCsv(converted)
  }, [result, onImportCsv])

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-2"><ArrowLeft className="w-4 h-4" />Back</Button>
            <h1 className="text-lg font-bold text-foreground">Import PDFs → CSVs</h1>
          </div>
          <Button variant="outline" size="sm" onClick={onSysAdmin} className="gap-2"><Settings className="w-4 h-4" />System Admin</Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Upload Area */}
        {!result && !isProcessing && (
          <Card>
            <CardContent className="pt-6">
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${isDragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"}`}
              >
                <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-lg font-medium text-foreground mb-2">Drop a PDF file here or click to browse</p>
                <p className="text-sm text-muted-foreground">Supports invoices, reports, statements, and other structured documents</p>
                <p className="text-xs text-muted-foreground mt-2">Claude AI will extract all structured data and create a CSV</p>
                <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = "" }} />
              </div>
              {error && <p className="text-sm text-red-500 mt-4 text-center">{error}</p>}
            </CardContent>
          </Card>
        )}

        {/* Processing */}
        {isProcessing && (
          <Card>
            <CardContent className="py-16 text-center">
              <Loader2 className="w-12 h-12 mx-auto mb-4 text-primary animate-spin" />
              <p className="text-lg font-medium text-foreground mb-2">Analyzing PDF with Claude AI...</p>
              <p className="text-sm text-muted-foreground">Extracting structured data and building CSV. This may take a moment.</p>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {result && (
          <>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold">Extracted CSV from: {result.filename}</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">{result.document_count} record{result.document_count !== 1 ? "s" : ""} extracted · {result.headers.length} columns</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={handleDownloadCsv} className="gap-2"><Download className="w-4 h-4" />Save as CSV</Button>
                    <Button size="sm" onClick={handleImportToConverter} className="gap-2 bg-primary"><ArrowRight className="w-4 h-4" />Import to AIO Converter</Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded border border-border overflow-auto max-h-[500px]">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground w-8">#</th>
                        {result.headers.map((h, i) => (
                          <th key={i} className="text-left px-3 py-2 font-medium text-xs whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {result.rows.map((row, ri) => (
                        <tr key={ri} className="hover:bg-muted/30">
                          <td className="px-3 py-2 text-xs text-muted-foreground">{ri + 1}</td>
                          {row.map((cell, ci) => (
                            <td key={ci} className="px-3 py-2 text-xs whitespace-nowrap max-w-[200px] truncate">{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Raw CSV view */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Raw CSV Output</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs font-mono bg-muted/30 rounded-lg p-4 overflow-auto max-h-[300px] whitespace-pre-wrap">{result.csv_text}</pre>
              </CardContent>
            </Card>

            {/* Upload another */}
            <div className="text-center">
              <Button variant="outline" onClick={() => { setResult(null); setError(null) }} className="gap-2"><Upload className="w-4 h-4" />Import Another PDF</Button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

// ── AI Field Maps Pane ────────────────────────────────────────────

function AiFieldMapsPane({ backendIsOnline }: { backendIsOnline: boolean }) {
  const [mapKeys, setMapKeys] = useState<FieldMapKey[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [showConfirmGenerate, setShowConfirmGenerate] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [editKey, setEditKey] = useState<FieldMapKey | null>(null)
  const [formKey, setFormKey] = useState("")
  const [formDesc, setFormDesc] = useState("")
  const [formFields, setFormFields] = useState<Set<string>>(new Set())
  const [availableFieldNames, setAvailableFieldNames] = useState<string[]>([])
  const [fieldFilter, setFieldFilter] = useState("")

  const load = useCallback(async () => {
    if (!backendIsOnline) { setLoading(false); return }
    setLoading(true)
    const [keys, elements] = await Promise.all([listFieldMaps(), listInformationElements()])
    setMapKeys(keys)
    setAvailableFieldNames(elements.map((e) => e.field_name).sort())
    setLoading(false)
  }, [backendIsOnline])

  useEffect(() => { load() }, [load])

  const handleGenerate = useCallback(async () => {
    setShowConfirmGenerate(false)
    setGenerating(true)
    try {
      const result = await generateFieldMaps()
      if (result && result.maps) {
        setMapKeys(result.maps)
        toast.success(`Generated ${result.count} fuzzy keys`)
      } else {
        toast.error("Failed to generate field maps")
      }
    } catch { toast.error("Generation failed") }
    setGenerating(false)
  }, [])

  const openAdd = useCallback(() => {
    setFormKey(""); setFormDesc(""); setFormFields(new Set()); setFieldFilter("")
    setShowAdd(true)
  }, [])

  const openEdit = useCallback((k: FieldMapKey) => {
    setEditKey(k)
    setFormKey(k.fuzzy_key)
    setFormDesc(k.description ?? "")
    setFormFields(new Set(k.members.map((m) => m.field_name)))
    setFieldFilter("")
  }, [])

  const handleSaveAdd = useCallback(async () => {
    if (!formKey.trim()) { toast.error("Fuzzy key is required"); return }
    const result = await createFieldMap({
      fuzzy_key: formKey.trim(),
      description: formDesc.trim() || undefined,
      field_names: Array.from(formFields),
    })
    if (result) { toast.success("Key created"); setShowAdd(false); load() }
    else toast.error("Failed to create key")
  }, [formKey, formDesc, formFields, load])

  const handleSaveEdit = useCallback(async () => {
    if (!editKey || !formKey.trim()) return
    const result = await updateFieldMap(editKey.key_id, {
      fuzzy_key: formKey.trim(),
      description: formDesc.trim() || undefined,
      field_names: Array.from(formFields),
    })
    if (result) { toast.success("Key updated"); setEditKey(null); load() }
    else toast.error("Failed to update key")
  }, [editKey, formKey, formDesc, formFields, load])

  const handleDelete = useCallback(async (k: FieldMapKey) => {
    if (!confirm(`Delete fuzzy key "${k.fuzzy_key}" and all ${k.members.length} members?`)) return
    const ok = await deleteFieldMap(k.key_id)
    if (ok) { toast.success("Key deleted"); load() }
    else toast.error("Failed to delete key")
  }, [load])

  const toggleField = useCallback((field: string) => {
    setFormFields((prev) => {
      const next = new Set(prev)
      if (next.has(field)) next.delete(field)
      else next.add(field)
      return next
    })
  }, [])

  const filteredFields = useMemo(() => {
    const q = fieldFilter.toLowerCase()
    return availableFieldNames.filter((f) => !q || f.toLowerCase().includes(q))
  }, [availableFieldNames, fieldFilter])

  const totalMapped = useMemo(() => mapKeys.reduce((sum, k) => sum + k.members.length, 0), [mapKeys])

  if (!backendIsOnline) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Backend offline. Connect to manage field maps.</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm text-muted-foreground">AI-generated fuzzy key groupings for semantically similar field names.</p>
          <p className="text-xs text-muted-foreground mt-1">
            {mapKeys.length} fuzzy key{mapKeys.length !== 1 ? "s" : ""} mapping {totalMapped} field name{totalMapped !== 1 ? "s" : ""}
            {availableFieldNames.length > 0 && ` (${availableFieldNames.length} total in Information Elements)`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowConfirmGenerate(true)} disabled={generating || availableFieldNames.length === 0} className="gap-2">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {generating ? "Generating..." : "Regenerate with AI"}
          </Button>
          <Button variant="outline" onClick={openAdd} className="gap-2"><Plus className="w-4 h-4" />Add Key</Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading...</p>
      ) : mapKeys.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center space-y-3">
            <Network className="w-12 h-12 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No fuzzy keys yet.</p>
            <p className="text-xs text-muted-foreground">Click <strong>Regenerate with AI</strong> to automatically group the {availableFieldNames.length} field names from Information Elements, or <strong>Add Key</strong> to create one manually.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#0f3460]">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-white w-48">Fuzzy Key</th>
                <th className="text-left px-4 py-2.5 font-medium text-white">Matching Field Names</th>
                <th className="text-left px-4 py-2.5 font-medium text-white w-28">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {mapKeys.map((k) => (
                <tr key={k.key_id} className="hover:bg-muted/30 align-top">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-foreground">{k.fuzzy_key}</div>
                    {k.description && <div className="text-xs text-muted-foreground mt-0.5">{k.description}</div>}
                    <div className="text-xs text-muted-foreground mt-1">{k.members.length} field{k.members.length !== 1 ? "s" : ""}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {k.members.length === 0 ? (
                        <span className="text-xs text-muted-foreground italic">No members</span>
                      ) : (
                        k.members.map((m) => (
                          <Badge key={m.member_id} variant="outline" className="text-xs">{m.field_name}</Badge>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(k)} title="Edit"><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500" onClick={() => handleDelete(k)} title="Delete"><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirm Regenerate Dialog */}
      <Dialog open={showConfirmGenerate} onOpenChange={setShowConfirmGenerate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" />Regenerate with AI</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">This will replace all existing fuzzy keys with new ones generated by Claude AI from the {availableFieldNames.length} field names in Information Elements.</p>
            <p className="text-sm text-muted-foreground">Any manual edits will be lost. Continue?</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmGenerate(false)}>Cancel</Button>
            <Button onClick={handleGenerate} className="gap-2"><Sparkles className="w-4 h-4" />Regenerate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Dialog */}
      <Dialog open={showAdd || !!editKey} onOpenChange={(open) => { if (!open) { setShowAdd(false); setEditKey(null) } }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{editKey ? "Edit Fuzzy Key" : "Add Fuzzy Key"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 overflow-auto flex-1">
            <div>
              <Label>Fuzzy Key</Label>
              <Input value={formKey} onChange={(e) => setFormKey(e.target.value)} placeholder="e.g. Invoice" />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Input value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="e.g. All invoice identifier fields" />
            </div>
            <div>
              <Label>Member Field Names ({formFields.size} selected)</Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input type="text" placeholder="Filter field names..." value={fieldFilter} onChange={(e) => setFieldFilter(e.target.value)} className="w-full pl-10 pr-3 py-2 border border-border rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div className="mt-2 max-h-[280px] overflow-auto border border-border rounded-md p-2 space-y-1">
                {filteredFields.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No field names match</p>
                ) : (
                  filteredFields.map((f) => (
                    <label key={f} className="flex items-center gap-2 px-2 py-1 hover:bg-muted/40 rounded cursor-pointer text-sm">
                      <input type="checkbox" checked={formFields.has(f)} onChange={() => toggleField(f)} className="rounded" />
                      <span>{f}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAdd(false); setEditKey(null) }}>Cancel</Button>
            <Button onClick={editKey ? handleSaveEdit : handleSaveAdd} disabled={!formKey.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Bulk CSV Processing Pane ──────────────────────────────────────

interface FileStatus {
  saved: number
  skipped: number
  failed: number
  rows: number
}

function BulkCsvProcessingPane({ backendIsOnline }: { backendIsOnline: boolean }) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [folderName, setFolderName] = useState<string>("")
  const [prefix, setPrefix] = useState<string>("ACC")
  const [availablePrefixes, setAvailablePrefixes] = useState<string[]>([])
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState<{ current: number; total: number; file: string }>({ current: 0, total: 0, file: "" })
  const [fileStatuses, setFileStatuses] = useState<Map<string, FileStatus>>(new Map())
  const [rowCounts, setRowCounts] = useState<Map<string, number>>(new Map())
  const [summary, setSummary] = useState<{ files: number; saved: number; skipped: number; failed: number; csvsSaved: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFolderSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const all = Array.from(e.target.files ?? [])
    const csvs = all.filter((f) => f.name.toLowerCase().endsWith(".csv"))
    if (csvs.length === 0) {
      toast.error("No CSV files found in the selected folder")
      return
    }
    // Derive unique 3-char prefixes (uppercase) from filenames
    const prefixes = new Set<string>()
    for (const f of csvs) {
      const p = f.name.substring(0, 3).toUpperCase()
      prefixes.add(p)
    }
    const sortedPrefixes = Array.from(prefixes).sort()
    setSelectedFiles(csvs)
    setAvailablePrefixes(sortedPrefixes)
    // Default to ACC if present, else first available
    if (sortedPrefixes.includes("ACC")) {
      setPrefix("ACC")
    } else {
      setPrefix(sortedPrefixes[0] ?? "ACC")
    }
    // Extract folder name from first file's webkitRelativePath
    const first = csvs[0] as File & { webkitRelativePath?: string }
    const rel = first.webkitRelativePath ?? ""
    const folder = rel.includes("/") ? rel.split("/")[0] : "(folder)"
    setFolderName(folder)
    setFileStatuses(new Map())
    setSummary(null)

    // Count rows for each CSV (parse header + rows) asynchronously
    const counts = new Map<string, number>()
    for (const f of csvs) {
      try {
        const text = await f.text()
        const parsed = parseCSV(text)
        counts.set(f.name, parsed.rows.length)
      } catch {
        counts.set(f.name, 0)
      }
    }
    setRowCounts(counts)
    toast.success(`Loaded ${csvs.length} CSV files from ${folder}`)
  }, [])

  const filteredFiles = useMemo(
    () => selectedFiles.filter((f) => f.name.substring(0, 3).toUpperCase() === prefix),
    [selectedFiles, prefix]
  )

  const totalFilteredRows = useMemo(
    () => filteredFiles.reduce((sum, f) => sum + (rowCounts.get(f.name) ?? 0), 0),
    [filteredFiles, rowCounts]
  )

  const formatBytes = (b: number) => {
    if (b < 1024) return `${b} B`
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
    return `${(b / (1024 * 1024)).toFixed(1)} MB`
  }

  const processFiles = useCallback(async () => {
    if (filteredFiles.length === 0) return
    setProcessing(true)
    setSummary(null)
    setFileStatuses(new Map())
    setProgress({ current: 0, total: filteredFiles.length, file: "" })

    // Fetch existing aio_names + existing saved CSV names for dedup
    const [existing, existingCsvs] = await Promise.all([
      listAioData(),
      listIOs({ type: "CSV", source_system: "csv-converter", limit: 500 }).catch(() => [] as IORecord[]),
    ])
    const existingSet = new Set(existing.map((a) => a.aio_name))
    const existingCsvNames = new Set(
      existingCsvs.map((r) => r.context?.source_object_id).filter(Boolean) as string[]
    )

    let totalSaved = 0
    let totalSkipped = 0
    let totalFailed = 0
    let csvsSaved = 0

    for (let fi = 0; fi < filteredFiles.length; fi++) {
      const file = filteredFiles[fi]
      setProgress({ current: fi, total: filteredFiles.length, file: file.name })

      let saved = 0
      let skipped = 0
      let failed = 0
      let rowCount = 0

      try {
        const text = await file.text()
        const { headers, rows } = parseCSV(text)
        rowCount = rows.length
        const mtime = new Date(file.lastModified)
        const fileDate = mtime.toISOString().slice(0, 10)
        const fileTime = mtime.toISOString().slice(11, 19)

        // ── Step 1: Save the original CSV file to the IO registry (once per file) ──
        if (!existingCsvNames.has(file.name)) {
          try {
            const csvResult = await createIO({
              type: "CSV",
              raw: { raw_uri: `data:text/csv,${encodeURIComponent(text)}`, mime_type: "text/csv", size_bytes: text.length },
              context: { source_system: "csv-converter", source_object_id: file.name },
            })
            if (csvResult) {
              csvsSaved++
              existingCsvNames.add(file.name)
            }
          } catch (err) {
            console.warn(`Could not save CSV "${file.name}":`, err)
          }
        }

        // ── Step 2: Process rows into AIOs (batched) ──
        const BATCH = 5
        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH)
          const batchResults = await Promise.all(batch.map(async (row, idx) => {
            const rowNum = i + idx + 1
            const aioName = `${file.name} - Row ${rowNum}`
            if (existingSet.has(aioName)) return { status: "skipped" as const }
            const aioLine = csvToAio(headers, row, file.name, fileDate, fileTime)
            const parsed = parseAioLine(aioLine)
            const elements: (string | null)[] = Array(50).fill(null)
            parsed.slice(0, 50).forEach((el, idx2) => { elements[idx2] = el.raw })
            try {
              const [aioDataResult, ioResult] = await Promise.all([
                createAioData(aioName, elements),
                createIO({
                  type: "AIO",
                  raw: { raw_uri: `data:text/aio,${encodeURIComponent(aioLine)}`, mime_type: "text/aio", size_bytes: aioLine.length },
                  context: { source_system: "csv-converter", source_object_id: file.name },
                }),
              ])
              if (aioDataResult && ioResult) {
                existingSet.add(aioName)
                return { status: "saved" as const }
              }
              return { status: "failed" as const }
            } catch {
              return { status: "failed" as const }
            }
          }))
          batchResults.forEach((r) => {
            if (r.status === "saved") saved++
            else if (r.status === "skipped") skipped++
            else failed++
          })
        }
      } catch (err) {
        console.error(`Failed to process ${file.name}:`, err)
        failed = rowCount
      }

      totalSaved += saved
      totalSkipped += skipped
      totalFailed += failed
      setFileStatuses((prev) => new Map(prev).set(file.name, { saved, skipped, failed, rows: rowCount }))
      setProgress({ current: fi + 1, total: filteredFiles.length, file: file.name })
    }

    // Rebuild information elements to refresh the field index
    try {
      await rebuildInformationElements()
    } catch (err) {
      console.warn("Failed to rebuild information elements:", err)
    }

    setSummary({ files: filteredFiles.length, saved: totalSaved, skipped: totalSkipped, failed: totalFailed, csvsSaved })
    setProcessing(false)
    if (totalSaved > 0 || csvsSaved > 0) {
      const parts: string[] = []
      if (csvsSaved > 0) parts.push(`${csvsSaved} CSV file${csvsSaved !== 1 ? "s" : ""}`)
      if (totalSaved > 0) parts.push(`${totalSaved} AIO${totalSaved !== 1 ? "s" : ""}`)
      toast.success(`Imported ${parts.join(" and ")}`)
    } else if (totalSkipped > 0 && totalFailed === 0) {
      toast.info(`All ${totalSkipped} rows were duplicates — nothing new to import`)
    } else if (totalFailed > 0) {
      toast.error(`${totalFailed} row(s) failed to import`)
    }
  }, [filteredFiles])

  if (!backendIsOnline) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Backend offline. Connect to process CSV files.</p>
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">
          Select a folder of CSV files and batch-convert them to AIOs. Duplicate rows (same aio_name) are automatically skipped.
        </p>
      </div>

      {/* Folder selector + prefix picker */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center gap-4 flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".csv"
              onChange={handleFolderSelect}
              className="hidden"
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            />
            <Button onClick={() => fileInputRef.current?.click()} disabled={processing} className="gap-2">
              <Upload className="w-4 h-4" />Select CSV Folder
            </Button>
            {folderName && (
              <span className="text-sm text-muted-foreground">
                Folder: <strong className="text-foreground">{folderName}</strong> — {selectedFiles.length} CSV file{selectedFiles.length !== 1 ? "s" : ""}
              </span>
            )}
            {availablePrefixes.length > 0 && (
              <div className="flex items-center gap-2 ml-auto">
                <Label className="text-sm">Prefix:</Label>
                <Select value={prefix} onValueChange={setPrefix} disabled={processing}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availablePrefixes.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Filtered files list */}
          {selectedFiles.length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="bg-muted/50 px-4 py-2 text-xs font-medium text-foreground">
                Files matching &quot;{prefix}&quot; ({filteredFiles.length} found, {totalFilteredRows} total rows)
              </div>
              <div className="divide-y divide-border max-h-[320px] overflow-auto">
                {filteredFiles.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-muted-foreground text-center">No files match this prefix</p>
                ) : (
                  filteredFiles.map((f) => {
                    const status = fileStatuses.get(f.name)
                    const rows = rowCounts.get(f.name) ?? 0
                    return (
                      <div key={f.name} className="px-4 py-2 flex items-center justify-between text-sm">
                        <div className="flex items-center gap-3 min-w-0">
                          <FileSpreadsheet className="w-4 h-4 text-primary shrink-0" />
                          <span className="font-medium text-foreground truncate">{f.name}</span>
                          <span className="text-xs text-muted-foreground shrink-0">{rows} rows</span>
                          <span className="text-xs text-muted-foreground shrink-0">{formatBytes(f.size)}</span>
                        </div>
                        {status && (
                          <div className="flex items-center gap-2 text-xs shrink-0">
                            {status.saved > 0 && <Badge variant="outline" className="text-emerald-600 border-emerald-300">+{status.saved} saved</Badge>}
                            {status.skipped > 0 && <Badge variant="outline" className="text-amber-600 border-amber-300">{status.skipped} skipped</Badge>}
                            {status.failed > 0 && <Badge variant="outline" className="text-red-600 border-red-300">{status.failed} failed</Badge>}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}

          {/* Process button */}
          {filteredFiles.length > 0 && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {processing
                  ? `Processing ${progress.current + 1} / ${progress.total}: ${progress.file}`
                  : "Click Process to import all matching files"}
              </p>
              <Button onClick={processFiles} disabled={processing} className="gap-2">
                {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {processing ? "Processing..." : "Process Files"}
              </Button>
            </div>
          )}

          {/* Progress bar */}
          {processing && progress.total > 0 && (
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          )}

          {/* Summary */}
          {summary && (
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                <p className="text-sm font-semibold text-foreground">Import Complete</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                <div><span className="text-muted-foreground">Files:</span> <strong>{summary.files}</strong></div>
                <div><span className="text-muted-foreground">CSVs saved:</span> <strong className="text-blue-600">{summary.csvsSaved}</strong></div>
                <div><span className="text-muted-foreground">New AIOs:</span> <strong className="text-emerald-600">{summary.saved}</strong></div>
                <div><span className="text-muted-foreground">Duplicates:</span> <strong className="text-amber-600">{summary.skipped}</strong></div>
                <div><span className="text-muted-foreground">Failures:</span> <strong className={summary.failed > 0 ? "text-red-600" : ""}>{summary.failed}</strong></div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── Research & Development — Compound HSL Builder ─────────────────

function ResearchAndDevelopment({ onBack, backendIsOnline, onSysAdmin }: { onBack: () => void; backendIsOnline: boolean; onSysAdmin: () => void }) {
  const [aioRecords, setAioRecords] = useState<AioDataRecord[]>([])
  const [isLoadingAios, setIsLoadingAios] = useState(false)
  const [infoElements, setInfoElements] = useState<InformationElement[]>([])
  const [isLoadingElements, setIsLoadingElements] = useState(false)
  const [selectedFieldName, setSelectedFieldName] = useState<string | null>(null)
  const [fieldSearchQuery, setFieldSearchQuery] = useState("")
  const [valueSearchQuery, setValueSearchQuery] = useState("")
  const [selectedElements, setSelectedElements] = useState<{ element: ParsedElement; sourceAio: string }[]>([])
  const [compoundHslData, setCompoundHslData] = useState<{ labels: string[]; fileName: string; rows: { aioName: string; csvRoot: string; lineNumber: number; createdAt: string }[]; content: string; matchingAioDetails: ParsedAio[] } | null>(null)
  const [showFileViewer, setShowFileViewer] = useState(false)
  const [showDetailsAio, setShowDetailsAio] = useState<ParsedAio | null>(null)

  // Load AIOs and Information Elements
  useEffect(() => {
    if (!backendIsOnline) return
    setIsLoadingAios(true)
    listAioData().then((records) => { setAioRecords(records); setIsLoadingAios(false) }).catch(() => setIsLoadingAios(false))
    setIsLoadingElements(true)
    listInformationElements().then((els) => { setInfoElements(els); setIsLoadingElements(false) }).catch(() => setIsLoadingElements(false))
  }, [backendIsOnline])

  const allParsedAios = useMemo<ParsedAio[]>(() => {
    return aioRecords.map((r) => {
      const raw = r.elements.filter(Boolean).join("")
      const csvRoot = r.aio_name.replace(/\s*-\s*Row\s*\d+$/i, "").replace(/\.csv$/i, "") || "backend"
      const lineNumberMatch = r.aio_name.match(/-\s*Row\s*(\d+)$/i)
      const lineNumber = lineNumberMatch ? parseInt(lineNumberMatch[1], 10) : 0
      return { fileName: r.aio_name, elements: parseAioLine(raw), raw, csvRoot, lineNumber }
    })
  }, [aioRecords])

  // Filter field names by search
  const filteredInfoElements = useMemo(() => {
    if (!fieldSearchQuery.trim()) return infoElements
    const q = fieldSearchQuery.toLowerCase()
    return infoElements.filter((el) => el.field_name.toLowerCase().includes(q))
  }, [infoElements, fieldSearchQuery])

  // Get unique values for the selected field name across all AIOs
  const fieldValues = useMemo<{ value: string; count: number }[]>(() => {
    if (!selectedFieldName) return []
    const valueCounts = new Map<string, number>()
    for (const aio of allParsedAios) {
      for (const el of aio.elements) {
        if (el.key === selectedFieldName) {
          valueCounts.set(el.value, (valueCounts.get(el.value) ?? 0) + 1)
        }
      }
    }
    return Array.from(valueCounts.entries()).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count)
  }, [allParsedAios, selectedFieldName])

  // Filter values by search
  const filteredFieldValues = useMemo(() => {
    if (!valueSearchQuery.trim()) return fieldValues
    const q = valueSearchQuery.toLowerCase()
    return fieldValues.filter((v) => v.value.toLowerCase().includes(q))
  }, [fieldValues, valueSearchQuery])

  // Count occurrences of each element's value across ALL AIOs
  const valueCounts = useMemo<Map<string, number>>(() => {
    const counts = new Map<string, number>()
    for (const aio of allParsedAios) {
      for (const el of aio.elements) {
        counts.set(el.value, (counts.get(el.value) ?? 0) + 1)
      }
    }
    return counts
  }, [allParsedAios])

  const queryElements = useMemo(() => selectedElements.map((s) => s.element), [selectedElements])

  // Match on value (data portion) only, across all AIOs regardless of field name
  const compoundMatchingAios = useMemo<ParsedAio[]>(() => {
    if (queryElements.length === 0) return []
    const matchSets = queryElements.map((sel) => new Set(allParsedAios.filter((aio) => aio.elements.some((el) => el.value === sel.value)).map((aio) => aio.raw)))
    return allParsedAios.filter((aio) => matchSets.every((set) => set.has(aio.raw)))
  }, [allParsedAios, queryElements])

  const handleValueSelect = useCallback((value: string) => {
    if (!selectedFieldName) return
    const element: ParsedElement = { key: selectedFieldName, value, raw: `[${selectedFieldName}.${value}]` }
    setSelectedElements((prev) => {
      const exists = prev.some((e) => e.element.key === element.key && e.element.value === element.value)
      return exists ? prev.filter((e) => !(e.element.key === element.key && e.element.value === element.value)) : [...prev, { element, sourceAio: selectedFieldName }]
    })
    setCompoundHslData(null)
  }, [selectedFieldName])

  const isValueSelected = useCallback((value: string) => {
    return selectedElements.some((s) => s.element.value === value)
  }, [selectedElements])

  const handleRemoveElement = useCallback((element: ParsedElement) => {
    setSelectedElements((prev) => prev.filter((e) => !(e.element.key === element.key && e.element.value === element.value)))
    setCompoundHslData(null)
  }, [])

  const handleClearQuery = useCallback(() => {
    setSelectedElements([])
    setCompoundHslData(null)
  }, [])

  const handleCreateCompoundHsl = useCallback(() => {
    if (queryElements.length < 2 || compoundMatchingAios.length === 0) return
    const now = new Date()
    const createdAt = now.toISOString().replace("T", " ").substring(0, 19)
    const labels = queryElements.map((el) => `${el.key}: ${el.value}`)
    const elementParts = queryElements.map((el) => `[${el.key}.${el.value}]`)
    const hslFileName = elementParts.length <= 3 ? `${elementParts.join("")}.hsl` : `${elementParts.slice(0, 3).join("")}+${elementParts.length - 3}_more.hsl`

    const rows = compoundMatchingAios.map((aio) => ({ aioName: aio.fileName, csvRoot: aio.csvRoot, lineNumber: aio.lineNumber, createdAt }))

    const lines: string[] = []
    lines.push(`HSL File: ${hslFileName}`)
    lines.push(`Type: Compound HSL`)
    lines.push(`Selected Elements: ${queryElements.length}`)
    queryElements.forEach((el, i) => { lines.push(`  Element ${i + 1}: ${el.key}: ${el.value}`) })
    lines.push(`Query: ${queryElements.map((el) => `[${el.key}.${el.value}]`).join(" AND ")}`)
    lines.push(`Created: ${createdAt}`)
    lines.push(`Matches: ${rows.length}`)
    lines.push("")
    lines.push("AIO Name\tCSV Source\tLine #\tCreated")
    lines.push("\u2500".repeat(80))
    rows.forEach((r) => { lines.push(`${r.aioName}\t${r.csvRoot}\t${r.lineNumber}\t${r.createdAt}`) })

    const content = lines.join("\n")
    setCompoundHslData({ labels, fileName: hslFileName, rows, content, matchingAioDetails: compoundMatchingAios })

    if (backendIsOnline) {
      const rowElements: (string | null)[] = rows.slice(0, 100).map((r) => `${r.aioName}\t${r.csvRoot}\t${r.lineNumber}\t${r.createdAt}`)
      while (rowElements.length < 100) rowElements.push(null)
      Promise.all([
        createIO({ type: "HSL", raw: { raw_uri: `data:text/hsl,${encodeURIComponent(content)}`, mime_type: "text/hsl", size_bytes: content.length }, context: { source_system: "csv-converter", source_object_id: hslFileName } }),
        createHslData(hslFileName, rowElements),
      ]).then(([ioResult, hslResult]) => { if (ioResult && hslResult) toast.success("Compound HSL saved to database") })
    }
  }, [queryElements, compoundMatchingAios, backendIsOnline])

  const handleDownloadCompoundHsl = useCallback(() => {
    if (!compoundHslData) return
    const blob = new Blob([compoundHslData.content], { type: "text/plain;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = compoundHslData.fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [compoundHslData])

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-2"><ArrowLeft className="w-4 h-4" />Back</Button>
            <h1 className="text-lg font-bold text-foreground">R &amp; D</h1>
          </div>
          <Button variant="outline" size="sm" onClick={onSysAdmin} className="gap-2"><Settings className="w-4 h-4" />System Admin</Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <Tabs defaultValue="compound-hsl">
          <TabsList className="mb-6">
            <TabsTrigger value="compound-hsl" className="gap-2"><Layers className="w-4 h-4" />Compound HSL Builder</TabsTrigger>
            <TabsTrigger value="ai-field-maps" className="gap-2"><Network className="w-4 h-4" />AI Field Maps</TabsTrigger>
            <TabsTrigger value="bulk-csv" className="gap-2"><FileSpreadsheet className="w-4 h-4" />Bulk CSV Processing</TabsTrigger>
          </TabsList>

          <TabsContent value="compound-hsl" className="space-y-6">
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Left Column: Information Elements (Field Names) */}
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input type="text" placeholder="Search field names..." value={fieldSearchQuery} onChange={(e) => setFieldSearchQuery(e.target.value)} className="w-full pl-10 pr-10 py-2 border border-border rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              {fieldSearchQuery && <button onClick={() => setFieldSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-4 h-4 text-muted-foreground" /></button>}
            </div>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{isLoadingElements ? "Loading..." : `Field Names (${filteredInfoElements.length})`}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[500px] overflow-y-auto divide-y divide-border">
                  {filteredInfoElements.map((el) => (
                    <button key={el.element_id} onClick={() => { setSelectedFieldName(el.field_name); setValueSearchQuery("") }} className={`w-full text-left px-4 py-2.5 hover:bg-muted/50 transition-colors ${selectedFieldName === el.field_name ? "bg-amber-600/10 border-l-2 border-amber-600" : ""}`}>
                      <p className="text-sm font-medium text-foreground">{el.field_name}</p>
                      <p className="text-xs text-muted-foreground">{el.aio_count} AIOs</p>
                    </button>
                  ))}
                  {filteredInfoElements.length === 0 && !isLoadingElements && <p className="text-sm text-muted-foreground text-center py-8">No field names found</p>}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Middle Column: Values for Selected Field */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                {selectedFieldName ? `Values for: ${selectedFieldName}` : "Select a field name"}
              </CardTitle>
              <p className="text-xs text-muted-foreground">Click a value to add it to your compound query</p>
              {selectedFieldName && fieldValues.length > 10 && (
                <div className="relative mt-2">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                  <input type="text" placeholder="Filter values..." value={valueSearchQuery} onChange={(e) => setValueSearchQuery(e.target.value)} className="w-full pl-7 pr-7 py-1 border border-border rounded text-xs bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
                  {valueSearchQuery && <button onClick={() => setValueSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2"><X className="w-3 h-3 text-muted-foreground" /></button>}
                </div>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {selectedFieldName ? (
                <div className="max-h-[460px] overflow-y-auto divide-y divide-border">
                  {filteredFieldValues.map((fv, i) => {
                    const selected = isValueSelected(fv.value)
                    return (
                      <button key={i} onClick={() => handleValueSelect(fv.value)} className={`w-full text-left px-4 py-2 hover:bg-muted/50 transition-colors ${selected ? "bg-amber-600/10 border-l-2 border-amber-600" : ""}`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className={`text-sm truncate ${selected ? "font-semibold text-amber-700" : "text-foreground"}`}>{fv.value}</p>
                          <span className={`inline-flex items-center justify-center min-w-[22px] h-[20px] px-1.5 rounded-full text-[10px] font-bold shrink-0 ${selected ? "bg-amber-600 text-white" : "bg-blue-600 text-white"}`}>{fv.count}</span>
                        </div>
                      </button>
                    )
                  })}
                  {filteredFieldValues.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No values found</p>}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-12">Pick a field name from the left</p>
              )}
            </CardContent>
          </Card>

          {/* Right Column: Query Builder Box */}
          <Card className="border-amber-600/30">
            <CardHeader className="pb-2 bg-amber-600/5 rounded-t-lg">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-amber-700">Compound Query ({selectedElements.length} fields)</CardTitle>
                {selectedElements.length > 0 && <Button size="sm" variant="ghost" onClick={handleClearQuery} className="text-xs h-6 px-2 text-muted-foreground">Clear All</Button>}
              </div>
              <p className="text-xs text-muted-foreground">Pick field names and values to build your AND query</p>
            </CardHeader>
            <CardContent className="pt-3">
              {selectedElements.length > 0 ? (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {selectedElements.map((sel, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded-md bg-amber-600/5 border border-amber-600/20">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-medium text-foreground">{sel.element.key}: {sel.element.value}</p>
                          <span className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-full text-[10px] font-bold bg-blue-600 text-white">{valueCounts.get(sel.element.value) ?? 0}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground truncate">field: {sel.sourceAio}</p>
                      </div>
                      <button onClick={() => handleRemoveElement(sel.element)} className="shrink-0 mt-0.5"><X className="w-3 h-3 text-muted-foreground hover:text-foreground" /></button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No fields selected yet. Pick a field name, then click a value to add it here.</p>
              )}

              {/* Live match count */}
              {selectedElements.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-xs text-muted-foreground mb-3">
                    {queryElements.length < 2 ? "Select at least 2 fields" : `${compoundMatchingAios.length} AIO${compoundMatchingAios.length !== 1 ? "s" : ""} match ALL fields (AND)`}
                  </p>
                  <Button size="sm" className="w-full bg-amber-600 hover:bg-amber-700 text-white gap-2" onClick={handleCreateCompoundHsl} disabled={queryElements.length < 2 || compoundMatchingAios.length === 0}>
                    <Layers className="w-4 h-4" />Create Compound HSL
                  </Button>
                </div>
              )}

              {/* View Compound HSL button when created */}
              {compoundHslData && (
                <div className="mt-3 pt-3 border-t border-border">
                  <Button size="sm" variant="outline" className="w-full gap-2" onClick={() => setShowFileViewer(true)}>
                    <FileText className="w-4 h-4" />View Compound HSL
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Compound HSL Result Summary */}
        {compoundHslData && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold">Compound HSL Created</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">{compoundHslData.labels.join(" + ")} — {compoundHslData.rows.length} matching AIOs</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setShowFileViewer(true)} className="gap-2"><FileText className="w-4 h-4" />View HSL</Button>
                  <Button size="sm" variant="outline" onClick={handleDownloadCompoundHsl} className="gap-2"><Download className="w-4 h-4" />Download</Button>
                  <Button size="sm" variant="ghost" onClick={() => setCompoundHslData(null)}><X className="w-4 h-4" /></Button>
                </div>
              </div>
            </CardHeader>
          </Card>
        )}
          </TabsContent>

          <TabsContent value="ai-field-maps">
            <AiFieldMapsPane backendIsOnline={backendIsOnline} />
          </TabsContent>

          <TabsContent value="bulk-csv">
            <BulkCsvProcessingPane backendIsOnline={backendIsOnline} />
          </TabsContent>
        </Tabs>
      </main>

      {/* ── File Viewer Dialog ── */}
      <Dialog open={showFileViewer} onOpenChange={setShowFileViewer}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="w-5 h-5" />Compound HSL File</DialogTitle>
          </DialogHeader>
          {compoundHslData && (
            <div className="flex-1 overflow-auto space-y-4">
              {/* File content */}
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <pre className="text-xs font-mono whitespace-pre-wrap text-foreground">{compoundHslData.content}</pre>
              </div>
              {/* Result table */}
              <div className="rounded border border-border overflow-auto max-h-[300px]">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">AIO Name</th>
                      <th className="text-left px-4 py-2 font-medium">CSV Source</th>
                      <th className="text-left px-4 py-2 font-medium">Line #</th>
                      <th className="text-left px-4 py-2 font-medium">Created</th>
                      <th className="text-left px-4 py-2 font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {compoundHslData.rows.map((row, i) => (
                      <tr key={i} className="hover:bg-muted/30">
                        <td className="px-4 py-2 font-mono text-xs">{row.aioName}</td>
                        <td className="px-4 py-2 text-xs">{row.csvRoot}</td>
                        <td className="px-4 py-2 text-xs">{row.lineNumber}</td>
                        <td className="px-4 py-2 text-xs">{row.createdAt}</td>
                        <td className="px-4 py-2"><Button size="sm" variant="ghost" className="h-6 px-2 text-xs gap-1" onClick={() => { const aio = compoundHslData.matchingAioDetails.find((a) => a.fileName === row.aioName); if (aio) setShowDetailsAio(aio) }}><Eye className="w-3 h-3" />View Details</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="outline" onClick={handleDownloadCompoundHsl} className="gap-2"><Download className="w-4 h-4" />Download HSL</Button>
                <Button size="sm" variant="ghost" onClick={() => setShowFileViewer(false)}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── AIO Details Dialog ── */}
      <Dialog open={!!showDetailsAio} onOpenChange={(open) => { if (!open) setShowDetailsAio(null) }}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Database className="w-5 h-5" />AIO Elements: {showDetailsAio?.fileName}</DialogTitle>
          </DialogHeader>
          {showDetailsAio && (
            <div className="flex-1 overflow-auto space-y-4">
              <div className="rounded-lg border border-border overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium w-8">#</th>
                      <th className="text-left px-4 py-2 font-medium">Key</th>
                      <th className="text-left px-4 py-2 font-medium">Value</th>
                      <th className="text-left px-4 py-2 font-medium w-20">In Query</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {showDetailsAio.elements.map((el, i) => {
                      const inQuery = queryElements.some((q) => q.value === el.value)
                      return (
                        <tr key={i} className={inQuery ? "bg-amber-600/10" : "hover:bg-muted/30"}>
                          <td className="px-4 py-2 text-xs text-muted-foreground">{i + 1}</td>
                          <td className="px-4 py-2 text-xs font-medium">{el.key}</td>
                          <td className="px-4 py-2 text-xs">{el.value}</td>
                          <td className="px-4 py-2 text-xs">{inQuery && <Badge className="bg-amber-600 text-white text-[10px] h-5">Match</Badge>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-between items-center">
                <p className="text-xs text-muted-foreground">{showDetailsAio.elements.length} elements — Source: {showDetailsAio.csvRoot}</p>
                <Button size="sm" variant="ghost" onClick={() => setShowDetailsAio(null)}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── AIO Reference Paper Component ──────────────────────────────────

function AIOReferencePaper({ onBack, onSysAdmin }: { onBack: () => void; onSysAdmin: () => void }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-2"><ArrowLeft className="w-4 h-4" />Back</Button>
            <h1 className="text-lg font-bold text-foreground">AIO Reference Paper</h1>
          </div>
          <Button variant="outline" size="sm" onClick={onSysAdmin} className="gap-2"><Settings className="w-4 h-4" />System Admin</Button>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-6 py-10">
        <article className="prose prose-sm dark:prose-invert max-w-none">

          <div className="text-center mb-10">
            <h1 className="text-2xl font-bold text-foreground mb-2 text-balance">Inherent Contextual Basis for the Definition of Associated Information Objects as the Basic Quantum Particle of Information Physics</h1>
            <p className="text-base text-muted-foreground mb-1">Expanded: Hyper-Semantic Layer Strings, Precomputation, and a New Substrate for LLM/ML</p>
            <p className="text-sm font-medium text-foreground mt-4">Michael Simon Bodner, Ph.D.</p>
            <p className="text-sm text-muted-foreground">February 2026</p>
            <p className="text-xs text-muted-foreground mt-2">{"© 2026 Michael Simon Bodner. All rights reserved."}</p>
          </div>

          <Card className="mb-10">
            <CardHeader><CardTitle className="text-base">Abstract</CardTitle></CardHeader>
            <CardContent className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>This paper introduces a cognitive-theory-grounded basis for defining the Associated Information Object (AIO) as the basic "quantum particle" of Information Physics. The central claim is that information systems should store and operate on observations as bounded, inherently contextual objects -- more like human episodic memory -- rather than as decontextualized tables optimized for predefined queries.</p>
              <p>{"We argue that the AIO is application-agnostic not by omission of structure, but because its structure is derived directly from the act of measurement: the binding of observed values to their semantic descriptors at the moment of capture. We then connect AIO behavior to established ideas in cognitive science: encoding specificity, context-dependent memory, temporal context models, and situation model theory."}</p>
              <p>{"We further propose that this cognitive, inherently contextual architecture leads naturally to a hyper-semantic layer (HSL): an information-universe model in which AIOs are \"particles\" linked by HSL \"strings\" (threads) that encode shared semantic elements, relations, and contextual proximity. In this architecture, most compute is shifted to ingestion -- where strings are formed -- so that downstream question answering and reporting can recover relevant context by traversing strings rather than repeatedly recomputing joins, searches, or large-scale embedding scans."}</p>
              <p>{"The result is a new substrate for LLM/ML systems: one that reduces repeated inference-time work, increases auditability, and enables cognition-like associative retrieval. Performance gains depend on workload and implementation, but the core premise is structural: precomputed linkage converts expensive repeated discovery into inexpensive retrieval over prepared semantic structure."}</p>
            </CardContent>
          </Card>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">1. Introduction: From Tables to Observations</h2>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>Most enterprise data architectures begin with a simplifying assumption: information should be stored in normalized tables and optimized for known query workloads. That assumption performs a form of compression: it projects rich observations into rigid schemas, discarding context that is not immediately needed.</p>
              <p>Human cognition does not work this way. A lived observation is stored as an integrated episode: a structured whole whose components remain bound together by the context in which they were perceived. Later, a partial cue can evoke the larger episode without requiring an explicit query plan or predefined join path.</p>
              <p>Information Physics adopts this cognitive stance: preserve observations as objects first, and treat queries as measurements applied later.</p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">2. The Cognitive Analogy: Observation as a Stored Object</h2>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>Consider the following example: you see a woman ride by on a bicycle wearing a retro University of Michigan blue shirt. You do not store this as a row in a table. You store it as an event: a unified memory that includes the shirt, the bicycle, the person, the motion, the weather, the location, and your own internal state.</p>
              <p>Later, you encounter a retro University of Michigan shirt again. Without running a search algorithm, your mind may "remember" the earlier episode -- often bringing back multiple linked elements (bicycle, location, weather, person) as a coherent bundle.</p>
              <p>This phenomenon is consistent with cognitive theories in which retrieval is cue-driven and context-dependent: cues are effective when they overlap with the conditions present during encoding, and remembered events carry contextual traces that support later reconstruction.</p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">3. Defining the AIO as a Measurement-Bound Object</h2>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>{"An Associated Information Object (AIO) is a minimal, self-describing record-object produced by a measurement act. Its defining feature is explicit binding: each value is stored together with the semantic label that described it at capture time."}</p>
              <p>This yields a preserve-first representation in which the observation remains interpretable even when downstream applications, schemas, and query needs change.</p>
              <p>{"AIOs are not \"schema-free.\" Rather, they carry the schema that was present at the time of measurement, embedded locally in the object itself. This is the basis for application agnosticism: the object is not committed to any single future schema, but it retains the semantic bindings necessary to support many future interpretations."}</p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">4. Deriving AIO Properties from the Construct of Creation</h2>
            <p className="text-sm leading-relaxed text-muted-foreground mb-4">This section derives core AIO properties from the fact that AIOs are created as measurement objects.</p>
            <div className="space-y-4">
              <div className="pl-4 border-l-2 border-primary/30">
                <p className="text-sm font-semibold text-foreground mb-1">4.1 Preserve-first and self-description</p>
                <p className="text-sm text-muted-foreground">Because the measurement is stored with its descriptors, the object remains meaningful without external schema lookup.</p>
              </div>
              <div className="pl-4 border-l-2 border-primary/30">
                <p className="text-sm font-semibold text-foreground mb-1">4.2 Late-binding interpretability</p>
                <p className="text-sm text-muted-foreground">Because bindings are local, the same AIO can be re-indexed, re-clustered, and re-projected as questions evolve.</p>
              </div>
              <div className="pl-4 border-l-2 border-primary/30">
                <p className="text-sm font-semibold text-foreground mb-1">4.3 Traceable provenance</p>
                <p className="text-sm text-muted-foreground">If every transformation produces new derived objects rather than overwriting originals, the system can maintain lineage consistent with audit and governance needs.</p>
              </div>
              <div className="pl-4 border-l-2 border-primary/30">
                <p className="text-sm font-semibold text-foreground mb-1">4.4 Multi-instrument measurability</p>
                <p className="text-sm text-muted-foreground">AIOs can be measured with different instruments over time (lexical retrieval, vector similarity, structured projections, estimation), without reconstructing the original ingestion pipeline.</p>
              </div>
              <div className="pl-4 border-l-2 border-primary/30">
                <p className="text-sm font-semibold text-foreground mb-1">4.5 Context preservation</p>
                <p className="text-sm text-muted-foreground">By storing multiple attributes of an observation together, the AIO preserves co-occurrence relationships that are often lost when information is split across tables or extracted into narrow features.</p>
              </div>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">5. Cognitive Theory Grounding</h2>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>Information Physics does not reject ML or LLMs; it rejects the idea that the storage substrate must be optimized primarily for pattern recognition or keyword search. Instead, it adopts a cognitive model: store observations as contextual objects and let retrieval emerge from the overlap between cues and stored context.</p>
            </div>
            <div className="space-y-4 mt-4">
              <div className="pl-4 border-l-2 border-primary/30">
                <p className="text-sm font-semibold text-foreground mb-1">5.1 Encoding specificity and cue overlap</p>
                <p className="text-sm text-muted-foreground">The encoding specificity principle emphasizes that what is stored during encoding determines which cues will be effective at retrieval; matching retrieval cues to encoded context improves access to episodic traces.</p>
              </div>
              <div className="pl-4 border-l-2 border-primary/30">
                <p className="text-sm font-semibold text-foreground mb-1">5.2 Context-dependent memory</p>
                <p className="text-sm text-muted-foreground">Work in context-dependent memory demonstrates that recall can depend on the match between learning and retrieval environments, supporting the notion that contextual traces are part of what is stored.</p>
              </div>
              <div className="pl-4 border-l-2 border-primary/30">
                <p className="text-sm font-semibold text-foreground mb-1">5.3 Temporal context models</p>
                <p className="text-sm text-muted-foreground">Models such as the Temporal Context Model treat context as a drifting representation that becomes associated with items and then serves as a powerful cue for sequential and associative retrieval.</p>
              </div>
              <div className="pl-4 border-l-2 border-primary/30">
                <p className="text-sm font-semibold text-foreground mb-1">5.4 Situation model theory</p>
                <p className="text-sm text-muted-foreground">Situation model research argues that people form integrated representations of events or states of affairs; these representations support comprehension and later memory retrieval in ways that differ from retrieval over decontextualized propositions.</p>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground mt-4">These strands converge on a practical implication: a system that preserves contextual bindings at the object level can support retrieval that resembles human recollection -- cueing a whole episode from a partial match.</p>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">{"6. AIOs as the \"Quantum Particle\" of Information Physics"}</h2>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>{"In physics, a particle is a minimal unit that participates in larger structures and interactions. In Information Physics, the AIO plays an analogous role: it is the minimal unit of preserved observation that can be linked, clustered, transformed, and measured while retaining identity and context."}</p>
              <p>{"Calling the AIO a \"quantum particle\" is not a claim of literal quantum mechanics. It is a claim about granularity and composability: the AIO is the smallest practical unit that still contains meaningful contextual structure, and larger informational phenomena (threads, neighborhoods, boundaries) are built from interactions among these units."}</p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">7. From Inherent Context to a Hyper-Semantic Layer (HSL)</h2>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>If AIOs are preserved as contextual particles, the next architectural step is almost forced: build an explicit relational substrate that mirrors associative recall. This substrate is the Hyper-Semantic Layer (HSL).</p>
              <p>The HSL is not merely an index. It is a topology: an overlay structure that captures how AIOs relate through shared information elements, semantic equivalence, entity identity, temporal proximity, and domain constraints.</p>
              <p>In cognitive terms, HSL is the engineered analogue of the associative structure that forms between episodic memories. When a cue appears, retrieval occurs by traveling the associative structure -- not by re-running a full search over all experiences.</p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">{"8. HSL \"Strings\": Threads as the Basis of Information Recovery"}</h2>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>{"We define an HSL \"string\" as a durable connective structure that ties AIOs together via common information elements or semantically equivalent elements (e.g., the same vendor, invoice number, project, location, clause, part number, or concept)."}</p>
              <p>A string can be understood as a governed, versioned, auditable link set. It may be explicit (declared) or inferred (computed under controlled operators).</p>
              <p>Strings can be layered: element-level strings (exact header/value matches), entity-level strings (resolved identity), semantic strings (embedding similarity neighborhoods), temporal strings (adjacency and sequence), and policy/domain strings (allowed connection surfaces).</p>
              <p>In the information-universe metaphor: AIOs are particles; strings are the relational fabric that allows information energy (query intent) to propagate through the universe to recover relevant context.</p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">{"9. Shifting Compute to Ingestion: \"Pay Once, Use Many Times\""}</h2>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>Traditional analytics pays repeatedly: each question triggers new joins, filters, scans, and retrieval operations that rediscover structure already implicit in the data.</p>
              <p>In an HSL-first architecture, most of the expensive work is performed at ingestion and enrichment time: canonicalization (e.g., header unification), entity resolution, embedding generation, clustering, link inference, and string construction.</p>
              <p>Once strings exist, information recovery is less about discovery and more about traversal: starting from a cue (a header/value, entity, semantic neighborhood, or seed object) and expanding along strings within a bounded radius and policy scope.</p>
              <p>This does not eliminate compute; it changes its timing and reuse. The benefit is that repeated questions reuse precomputed structure, reducing repeated inference-time work.</p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">10. Implications for LLM/ML: A New Substrate Rather than a New Model</h2>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>{"Most current LLM/ML enterprise deployments treat the world as a flat corpus that must be searched repeatedly at inference time. This drives compute into every question: embedding search, reranking, prompt assembly, repeated extraction, and repeated summarization."}</p>
              <p>{"In the HSL model, LLMs and ML models become measurement instruments operating on an already-structured information universe. The retrieval step is no longer \"find needles in a haystack\" but \"follow the relevant strings.\""}</p>
              <p>This changes the optimization target: instead of maximizing inference-time retrieval over unstructured stores, we maximize ingestion-time formation of high-quality strings and auditable link structure.</p>
              <p>LLMs become more reliable because they are grounded in explicitly recovered context bundles (the connected subgraph), and governance improves because every traversal and derived answer can point back to the exact contributing AIOs and strings.</p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">11. Performance and Cost Claims: Why Compute Can Drop Dramatically</h2>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>The claim is not that physics magic happens. The claim is that precomputing relational structure turns repeated discovery into retrieval. Under typical enterprise workloads (where many questions are variations on recurring business entities and processes), this can reduce repeated work substantially.</p>
              <p>{"Qualitatively: instead of scanning or embedding-searching across the entire repository for each query, the system begins from a small set of cues and expands along precomputed strings -- often operating on orders of magnitude fewer candidate objects."}</p>
              <p>In practice, the reduction depends on how well the strings capture the domain's true connectivity (invoice-to-PO-to-vendor, project-to-cost-code-to-contract, etc.), and on how effectively locality constraints bound traversal (time windows, domain scopes, graph radius).</p>
              <p>The architecture therefore offers a principled path toward large decreases in per-query compute and latency for many operational analytics tasks -- particularly reporting, reconciliation, and context-rich Q&A.</p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">12. Conclusion</h2>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>The Associated Information Object is best understood as a measurement-bound, context-preserving unit of observation. Its application agnosticism is a direct consequence of how it is created: it retains semantic bindings locally and does not commit the record to any one downstream schema.</p>
              <p>By aligning storage and retrieval with principles from human memory -- encoding specificity, context dependence, temporal context, and situation models -- Information Physics offers an alternative to schema-first and search-first paradigms.</p>
              <p>This cognitive framing leads naturally to the Hyper-Semantic Layer: a structured information universe where AIOs are linked by strings that enable rapid contextual recovery. In such a system, most compute is performed once -- on the way in -- so that retrieval and reporting can reuse prepared semantic structure.</p>
              <p>The result is a new substrate for LLM/ML: models measure and explain within recovered context bundles rather than repeatedly reconstructing context from scratch.</p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">References</h2>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>Tulving, E., & Thomson, D. M. (1973). Encoding specificity and retrieval processes in episodic memory. <em>Psychological Review</em>, 80(5), 352-373.</p>
              <p>Godden, D. R., & Baddeley, A. D. (1975). Context-dependent memory in two natural environments: On land and underwater. <em>British Journal of Psychology</em>.</p>
              <p>Zwaan, R. A., & Radvansky, G. A. (1998). Situation models in language comprehension and memory. <em>Psychological Bulletin</em>, 123(2), 162-185.</p>
              <p>Howard, M. W., & Kahana, M. J. (2002). A distributed representation of temporal context. <em>Journal of Mathematical Psychology</em>, 46(3), 269-299.</p>
              <p>Renoult, L., & Rugg, M. D. (2020). An historical perspective on Endel Tulving's episodic-semantic distinction. <em>Neuropsychologia</em>, 139, 107366.</p>
              <p>Copeland, D. E., Magliano, J. P., & Radvansky, G. A. (2005). Situation Models in Comprehension, Memory, and Augmented Cognition. In <em>Cognitive Systems: Human Cognitive Models in Systems Design</em>.</p>
            </div>
          </section>

        </article>
      </main>
      <footer className="border-t border-border mt-8"><div className="max-w-4xl mx-auto px-6 py-6 text-center"><p className="text-xs text-muted-foreground">{"© 2026 Michael Simon Bodner. All rights reserved."}</p></div></footer>
    </div>
  )
}

// ── MRO Reference Paper Component ──────────────────────────────────

function MROReferencePaper({ onBack, onSysAdmin }: { onBack: () => void; onSysAdmin: () => void }) {
  const Section = ({ num, title, children }: { num: number; title: string; children: React.ReactNode }) => (
    <div className="mb-8"><h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">{num}. {title}</h2><div className="space-y-3 text-sm text-muted-foreground leading-relaxed">{children}</div></div>
  )
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-2"><ArrowLeft className="w-4 h-4" />Back</Button>
            <h1 className="text-lg font-bold text-foreground">MRO Reference Paper</h1>
          </div>
          <Button variant="outline" size="sm" onClick={onSysAdmin} className="gap-2"><Settings className="w-4 h-4" />System Admin</Button>
        </div>
      </header>
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="text-center mb-12 border-b border-border pb-8">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Information Physics Research Paper</p>
          <h1 className="text-2xl font-bold text-foreground mb-2">Memory Result Objects (MROs) as Derived Episodic Particles of Information Physics</h1>
          <p className="text-sm text-muted-foreground mb-4">Extending the AIO/HSL Model to Store Query Results as Recursive Memory Objects for Future Retrieval</p>
          <p className="text-sm font-medium text-foreground">Michael Simon Bodner, Ph.D.</p>
          <p className="text-xs text-muted-foreground">March 2026</p>
          <p className="text-xs text-muted-foreground mt-2">&copy; 2026 Michael Simon Bodner. All rights reserved.</p>
        </div>

        <div className="mb-8 p-4 rounded-lg bg-muted/50 border border-border">
          <h2 className="text-lg font-bold text-foreground mb-3">Abstract</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">This paper proposes a second-order extension to the Information Physics framework: the Memory Result Object (MRO). In the original AIO/HSL formulation, Associated Information Objects (AIOs) are preserved observations, while the Hyper-Semantic Layer (HSL) provides the relational topology for contextual retrieval. A query is a measurement over a prepared information universe. This paper argues that the result of such a measurement should itself be treated as a new informational object rather than as transient output.</p>
          <p className="text-sm text-muted-foreground leading-relaxed mt-2">An MRO is defined as a derived, governed, episodic object produced by a retrieval-and-inference event. It records the query cue, seed objects, traversal path, recovered context bundle, applied operators, resulting synthesis, and provenance envelope. Persisted onto the HSL that helped generate it, the MRO becomes part of the future searchable universe while remaining explicitly subordinate to the originating AIOs.</p>
          <p className="text-sm text-muted-foreground leading-relaxed mt-2">This extension introduces recursive memory into the AIO/HSL architecture. The system stores not only observations and their precomputed relational strings, but also its own successful acts of recollection and interpretation &mdash; approaching a cognition-like regime in which retrieval episodes become future memory traces.</p>
        </div>

        <Section num={1} title="Introduction: From Observation Objects to Recollection Objects">
          <p>The first paper established that enterprise information should be preserved as measurement-bound, context-rich objects. That argument produced the AIO as the minimal preserved particle of observation and the HSL as the relational fabric for later retrieval.</p>
          <p>If a query in the AIO/HSL architecture is itself a measurement act, and that act yields a bounded contextual result grounded in a traversed region of the information universe, then the resulting answer is not merely output &mdash; it is a new episode carrying informational content, provenance, temporal position, and relationships to prior objects.</p>
          <p>Query results should be stored as <strong>derived episodic objects</strong> with explicit lineage to the source observations. AIOs remain the primitive particles of preserved observation. MROs become the primitive particles of preserved recollection.</p>
        </Section>

        <Section num={2} title="The Conceptual Necessity of the Memory Result Object">
          <p>In ordinary cognition, remembering is not a null operation. The act of recall often leaves a new memory trace. The same principle applies to an engineered information universe intended to mirror cognition.</p>
          <p>A query begins with cues, identifies seed AIOs, initiates HSL traversal, recovers a bounded context bundle, and presents it to an analytic instrument for synthesis. The resulting answer has nontrivial internal structure reflecting a specific cue, traversal, context, operators, and formulation.</p>
          <p>To allow such an event to disappear is to discard a valuable informational artifact. Preserving the retrieval episode as an MRO allows the system to remember prior successful recollections while still re-grounding them when necessary.</p>
        </Section>

        <Section num={3} title="Defining the Memory Result Object (MRO)">
          <p>An MRO is a derived Associated Information Object generated by a retrieval-and-inference event over the Hyper-Semantic Layer. It is not a primary observation but a governed derivative recording an internal cognitive episode.</p>
          <p>An MRO is represented abstractly as:</p>
          <div className="bg-muted rounded-lg p-3 font-mono text-xs my-3">MRO_t = &langle; Q_t, S_t, C_t, O_t, R_t, P_t, L_t &rangle;</div>
          <p>where <strong>Q_t</strong> is the query/cue state, <strong>S_t</strong> is the seed AIO set, <strong>C_t</strong> is the recovered context bundle, <strong>O_t</strong> is the operator configuration, <strong>R_t</strong> is the resulting synthesis, <strong>P_t</strong> is the provenance envelope, and <strong>L_t</strong> is the lineage linking the MRO to source AIOs and strings.</p>
        </Section>

        <Section num={4} title="Ontological Position within Information Physics">
          <p>The MRO is a <strong>derived episodic particle</strong>, not a replacement for the AIO. AIOs preserve what was observed at measurement time. MROs preserve what was concluded at retrieval time.</p>
          <p>This distinction protects against a common failure mode: the silent conversion of summaries into facts. The Information Physics framework preserves this cleanly because derived objects must point back to parent objects.</p>
          <p>The hierarchy: (1) primary observations stored as AIOs, (2) retrieval episodes generate MROs, (3) repeated convergence among validated MROs may produce higher-order semantic objects representing stabilized knowledge.</p>
        </Section>

        <Section num={5} title="Cognitive Grounding: Retrieval Episodes as Memory Traces">
          <p>Encoding specificity suggests that cues present during retrieval determine which contextual trace becomes active. Context-dependent memory implies that circumstances of recollection are themselves meaningful. Temporal context models treat context as dynamic and sequentially linked.</p>
          <p>Situation model theory reinforces that comprehension and recall operate over integrated models of events. A successful query result is best treated as a bounded situation-level representation &mdash; exactly what an MRO stores.</p>
        </Section>

        <Section num={6} title="Saving the MRO onto the HSL">
          <p>The critical architectural step is persistence. An MRO is committed back into the information universe and linked to the HSL neighborhood that enabled its creation. Future searches discover not only underlying evidence, but also prior episodes in which that evidence was assembled.</p>
          <p>The MRO must carry type information declaring it derived, a confidence profile, policy scope, and admissibility metadata. The HSL becomes a substrate of observations plus remembered retrieval episodes: a recursive associative fabric.</p>
        </Section>

        <Section num={7} title="MRO Schema and Required Fields">
          <p>The canonical MRO payload:</p>
          <div className="bg-muted rounded-lg p-3 font-mono text-xs my-3 leading-relaxed">
            {"MRO = {mro_id, query, intent, seed_set, traversal_subgraph, context_bundle, operator_stack, result, confidence, policy_scope, temporal_scope, lineage}"}
          </div>
          <p>Each field plays a distinct role: <strong>intent</strong> allows clustering of similar episodes, <strong>traversal_subgraph</strong> preserves the associative path, <strong>operator_stack</strong> distinguishes synthesis types, <strong>result</strong> contains the answer, and <strong>lineage</strong> ensures no MRO is severed from its evidence.</p>
        </Section>

        <Section num={8} title="Retrieval Rules: How MROs Participate in Future Search">
          <p>MROs must not be treated identically to source AIOs. The default rule: <strong>source-first retrieval</strong>. MROs may participate as:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong>Retrieval accelerators</strong> &mdash; indicating similar cue patterns have produced useful subgraphs</li>
            <li><strong>Interpretive priors</strong> &mdash; suggesting previously successful framings</li>
            <li><strong>Disambiguation aids</strong> &mdash; when similar terms have historically mapped to particular entities</li>
            <li><strong>Consolidation inputs</strong> &mdash; when multiple MROs converge on the same stable conclusion</li>
          </ul>
          <p className="mt-2">MROs are <strong>admissible retrieval objects, but not self-sufficient truth objects</strong>. Their authority is derivative, contingent, and always linked to the underlying evidence graph.</p>
        </Section>

        <Section num={9} title="Recursive Memory, Learning, and Semantic Knowledge">
          <p>Once MROs are admitted into the HSL, the architecture gains a recursive learning channel. A three-layer memory framework emerges:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong>Layer 1 &mdash; Preserved Observation:</strong> implemented by AIOs</li>
            <li><strong>Layer 2 &mdash; Preserved Recollection:</strong> implemented by MROs</li>
            <li><strong>Layer 3 &mdash; Stabilized Semantic Abstraction:</strong> higher-order knowledge objects from validated MRO convergence</li>
          </ul>
          <p className="mt-2">The system accumulates intelligence in the form of governed, provenance-preserving remembered episodes.</p>
        </Section>

        <Section num={10} title="Enterprise AI Implications">
          <p>Organizations repeatedly ask variants of the same questions. In an MRO-enhanced architecture, prior episodes become reusable organizational memory.</p>
          <p><strong>Cost</strong> decreases (prior episodes narrow future traversal). <strong>Latency</strong> decreases (start from remembered subgraphs). <strong>Governance</strong> improves (explicit provenance and policy scope). <strong>Explainability</strong> improves (cite both current evidence and prior retrieval history).</p>
        </Section>

        <Section num={11} title="Constraints, Failure Modes, and Governance">
          <p>Hazards include feedback amplification, policy leakage, and temporal staleness. Every MRO should carry four governance controls:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong>Source lineage</strong> &mdash; ensures reconstructability</li>
            <li><strong>Validity scope</strong> &mdash; preserves role/domain boundaries</li>
            <li><strong>Freshness metadata</strong> &mdash; allows decay or forced revalidation</li>
            <li><strong>Admissibility rules</strong> &mdash; specifies usage (seed, hint, summary, or audit artifact)</li>
          </ul>
          <p className="mt-2">When MROs conflict, the system should preserve competing recollection episodes rather than collapsing them.</p>
        </Section>

        <Section num={12} title="Conclusion">
          <p>The MRO enables the system to remember retrieval episodes, preserve their cues and context bundles, and make them available for future governed search. The resulting framework remains faithful to preserve-first semantics, provenance, late-binding interpretability, and contextual retrieval.</p>
          <p><strong>Information Physics no longer preserves only what was measured; it preserves the system&apos;s own acts of remembering.</strong></p>
        </Section>

        <div className="mb-8">
          <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">Appendix A. Comparative Object Hierarchy</h2>
          <div className="space-y-3 text-sm">
            <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800"><strong className="text-foreground">AIO (Associated Information Object):</strong> <span className="text-muted-foreground">A primary, measurement-bound, self-describing observation object captured from a source or observation event.</span></div>
            <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800"><strong className="text-foreground">MRO (Memory Result Object):</strong> <span className="text-muted-foreground">A derived episodic object capturing a retrieval-and-inference event over one or more AIOs and HSL strings.</span></div>
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800"><strong className="text-foreground">SKO (Semantic Knowledge Object):</strong> <span className="text-muted-foreground">An optional higher-order abstraction formed from repeated validated convergence across multiple MROs.</span></div>
          </div>
        </div>

        <div className="mb-8">
          <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">Appendix B. Proposed Admissibility Rules</h2>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>No MRO may exist without explicit lineage links to contributing AIOs or parent MROs.</li>
            <li>Source AIOs remain the default grounding layer for new answers.</li>
            <li>MROs may guide retrieval, but direct answer reuse requires freshness and policy validation.</li>
            <li>Conflicting MROs must be preserved as distinct recollection episodes unless a resolution operator explicitly consolidates them.</li>
            <li>Promotion from MRO to semantic knowledge object requires repeated validated convergence across independent episodes.</li>
          </ol>
        </div>

        <div className="mb-8">
          <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">References</h2>
          <ul className="space-y-2 text-xs text-muted-foreground">
            <li>Tulving, E., &amp; Thomson, D. M. (1973). Encoding specificity and retrieval processes in episodic memory. <em>Psychological Review</em>, 80(5), 352-373.</li>
            <li>Godden, D. R., &amp; Baddeley, A. D. (1975). Context-dependent memory in two natural environments. <em>British Journal of Psychology</em>.</li>
            <li>Zwaan, R. A., &amp; Radvansky, G. A. (1998). Situation models in language comprehension and memory. <em>Psychological Bulletin</em>, 123(2), 162-185.</li>
            <li>Howard, M. W., &amp; Kahana, M. J. (2002). A distributed representation of temporal context. <em>Journal of Mathematical Psychology</em>, 46(3), 269-299.</li>
            <li>Renoult, L., &amp; Rugg, M. D. (2020). An historical perspective on Endel Tulving&apos;s episodic-semantic distinction. <em>Neuropsychologia</em>, 139, 107366.</li>
            <li>Bodner, M. S. (2026). Inherent Contextual Basis for the Definition of Associated Information Objects as the Basic Quantum Particle of Information Physics.</li>
            <li>Bodner, M. S. (2026). Memory Result Objects (MROs) as Derived Episodic Particles of Information Physics.</li>
          </ul>
        </div>

        <p className="text-center text-xs text-muted-foreground border-t border-border pt-4">&copy; 2026 Michael Simon Bodner. All rights reserved. &mdash; InformationPhysics.ai</p>
      </div>
    </div>
  )
}

// ── Main Page Component ────────────────────────────────────────────

export default function HomePage() {
  const [currentUser, setCurrentUser] = useState<LoginResult | null>(null)
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [loginEmail, setLoginEmail] = useState("")
  const [loginPassword, setLoginPassword] = useState("")
  const [loginError, setLoginError] = useState<string | null>(null)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [currentView, setCurrentView] = useState<"home" | "converter" | "guide" | "workflow" | "reference" | "processor" | "paper" | "mro-paper" | "sysadmin" | "rnd" | "pdf-import" | "chataio">("home")
  const [showHomeChatAIO, setShowHomeChatAIO] = useState(false)
  const [downloadedFileNames, setDownloadedFileNames] = useState<string[]>([])
  const [convertedFiles, setConvertedFiles] = useState<ConvertedFile[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [isLoadingFromBackend, setIsLoadingFromBackend] = useState(false)
  const [showAioDb, setShowAioDb] = useState(false)
  const [aioDbRecords, setAioDbRecords] = useState<IORecord[]>([])
  const [isLoadingAioDb, setIsLoadingAioDb] = useState(false)
  const [csvPreviewFile, setCsvPreviewFile] = useState<string | null>(null)
  const [csvPreviewHeaders, setCsvPreviewHeaders] = useState<string[]>([])
  const [csvPreviewRows, setCsvPreviewRows] = useState<string[][]>([])
  const [showSplash, setShowSplash] = useState(true)
  const { isOnline: backendIsOnline } = useBackendStatus()

  const saveAIOsToBackend = useCallback(async (files: ConvertedFile[]) => {
    const allPairs: { line: string; source: string }[] = []
    files.forEach((f) => f.aioLines.forEach((line) => allPairs.push({ line, source: f.originalName })))

    // Batch 5 at a time
    let aioSaved = 0; let aioFailed = 0
    for (let i = 0; i < allPairs.length; i += 5) {
      const batch = allPairs.slice(i, i + 5)
      const results = await Promise.all(batch.map(({ line, source }) =>
        createIO({
          type: "AIO",
          raw: { raw_uri: `data:text/aio,${encodeURIComponent(line)}`, mime_type: "text/aio", size_bytes: line.length },
          context: { source_system: "csv-converter", source_object_id: source },
        })
      ))
      results.forEach((r) => r ? aioSaved++ : aioFailed++)
    }
    if (aioFailed > 0) toast.error(`${aioFailed} AIO record(s) failed to save — check backend`)
    else if (aioSaved > 0) toast.success(`${aioSaved} AIO records saved to database`)

    // Save parsed elements to aio_data table — one row per AIO
    let aioDataSaved = 0; let aioDataFailed = 0
    for (let i = 0; i < allPairs.length; i += 5) {
      const batch = allPairs.slice(i, i + 5)
      const results = await Promise.all(batch.map(({ line, source }, batchIdx) => {
        const rowNum = i + batchIdx + 1
        const aioName = `${source} - Row ${rowNum}`
        // Parse all [key.value] bracket elements from the AIO string
        const parsed = parseAioLine(line)
        // Map each element to its bracket string, padded/truncated to 50 slots
        const elements: (string | null)[] = Array(50).fill(null)
        parsed.slice(0, 50).forEach((el, idx) => { elements[idx] = el.raw })
        return createAioData(aioName, elements)
      }))
      results.forEach((r) => r ? aioDataSaved++ : aioDataFailed++)
    }
    if (aioDataFailed > 0) toast.warning(`${aioDataFailed} AIO element row(s) failed to save`)

    // Save original CSV files
    for (const file of files) {
      const csvText = [file.headers.join(","), ...file.csvData.map((r) => r.join(","))].join("\n")
      const csvResult = await createIO({
        type: "CSV",
        raw: { raw_uri: `data:text/csv,${encodeURIComponent(csvText)}`, mime_type: "text/csv", size_bytes: csvText.length },
        context: { source_system: "csv-converter", source_object_id: file.originalName },
      }).catch(() => null)
      if (!csvResult) toast.warning(`CSV "${file.originalName}" could not be saved (may already exist)`)
    }
  }, [])

  const handleFilesSelected = useCallback(async (files: File[]) => {
    setIsProcessing(true)

    // Check for duplicates already saved in the backend
    let filesToProcess = files
    if (backendIsOnline) {
      const existing = await listIOs({ type: "CSV", source_system: "csv-converter", limit: 500 })
      const existingNames = new Set(existing.map((r) => r.context.source_object_id).filter(Boolean))
      const duplicates = files.filter((f) => existingNames.has(f.name))
      if (duplicates.length > 0) {
        duplicates.forEach((f) =>
          toast.error(`"${f.name}" is already in the database. Please pick a different file.`, { duration: 6000 })
        )
        filesToProcess = files.filter((f) => !existingNames.has(f.name))
        if (filesToProcess.length === 0) {
          setIsProcessing(false)
          return
        }
      }
    }

    const results: ConvertedFile[] = []
    for (const file of filesToProcess) {
      try {
        const text = await file.text()
        const { headers, rows } = parseCSV(text)
        if (headers.length === 0) continue
        const fileTimestamp = new Date(file.lastModified)
        const fileDate = fileTimestamp.toISOString().split("T")[0]
        const fileTime = fileTimestamp.toTimeString().split(" ")[0]
        const aioLines = rows.map((row) => csvToAio(headers, row, file.name, fileDate, fileTime))
        results.push({ originalName: file.name, csvData: rows, headers, aioLines, fileDate, fileTime })
      } catch (error) {
        console.error(`Error processing ${file.name}:`, error)
      }
    }
    setConvertedFiles(results)
    setIsProcessing(false)
    if (backendIsOnline && results.length > 0) {
      saveAIOsToBackend(results).catch(console.error)
    }
  }, [backendIsOnline, saveAIOsToBackend])

  const handleLoadFromBackend = useCallback(async () => {
    setIsLoadingFromBackend(true)
    const [aioRecords, csvRecords] = await Promise.all([
      listIOs({ type: "AIO", source_system: "csv-converter", limit: 500 }),
      listIOs({ type: "CSV", source_system: "csv-converter", limit: 200 }),
    ])

    if (aioRecords.length > 0) {
      // Group IORecords by source file
      const groupedRecs = new Map<string, IORecord[]>()
      aioRecords.forEach((r) => {
        const src = r.context.source_object_id ?? "unknown.csv"
        if (!groupedRecs.has(src)) groupedRecs.set(src, [])
        groupedRecs.get(src)!.push(r)
      })
      const reconstructed: ConvertedFile[] = Array.from(groupedRecs.entries()).map(([name, recs]) => {
        // Decode AIO lines
        const aioLines = recs.map((r) => {
          const uri = r.raw.raw_uri ?? ""
          return uri.startsWith("data:text/aio,") ? decodeURIComponent(uri.slice("data:text/aio,".length)) : uri
        })
        // Reconstruct tabular CSV data from AIO key-value pairs
        const { headers, rows } = reconstructCsvFromAios(recs)
        // Extract original file date/time from first AIO line metadata
        const firstLine = aioLines[0] ?? ""
        const fileDate = firstLine.match(/\[FileDate\.([^\]]+)\]/)?.[1] ?? ""
        const fileTime = firstLine.match(/\[FileTime\.([^\]]+)\]/)?.[1] ?? ""
        return { originalName: name, csvData: rows, headers, aioLines, fileDate, fileTime }
      })
      setConvertedFiles(reconstructed)
      toast.success(`Loaded ${aioRecords.length} AIOs from ${reconstructed.length} file(s)`)
    } else if (csvRecords.length > 0) {
      // No AIO records — reconstruct from saved CSV data URIs
      const reconstructed: ConvertedFile[] = []
      for (const csvRec of csvRecords) {
        const uri = csvRec.raw.raw_uri ?? ""
        if (!uri.startsWith("data:text/csv,")) continue
        const csvText = decodeURIComponent(uri.slice("data:text/csv,".length))
        const { headers, rows } = parseCSV(csvText)
        if (headers.length === 0) continue
        const fileName = csvRec.context.source_object_id ?? "unknown.csv"
        const now = new Date()
        const fileDate = now.toISOString().split("T")[0]
        const fileTime = now.toTimeString().split(" ")[0]
        const aioLines = rows.map((row) => csvToAio(headers, row, fileName, fileDate, fileTime))
        reconstructed.push({ originalName: fileName, csvData: rows, headers, aioLines, fileDate, fileTime })
      }
      if (reconstructed.length > 0) {
        setConvertedFiles(reconstructed)
        toast.success(`Reconstructed ${reconstructed.length} file(s) from saved CSVs`)
      } else {
        toast.info("No saved AIOs or CSVs found in the backend.")
      }
    } else {
      toast.info("No saved AIOs found in the backend.")
    }
    setIsLoadingFromBackend(false)
  }, [])

  const handleViewAioDb = useCallback(async () => {
    setShowAioDb(true)
    setIsLoadingAioDb(true)
    const [aios, csvs] = await Promise.all([
      listIOs({ type: "AIO", source_system: "csv-converter", limit: 500 }),
      listIOs({ type: "CSV", source_system: "csv-converter", limit: 200 }),
    ])
    setAioDbRecords([...aios, ...csvs])
    setIsLoadingAioDb(false)
  }, [])

  const handleClear = useCallback(() => { setConvertedFiles([]) }, [])

  const handleSystemClick = useCallback(() => {
    setCurrentView("sysadmin")
  }, [])

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoggingIn(true)
    setLoginError(null)
    const { user, error } = await loginUser(loginEmail, loginPassword)
    setIsLoggingIn(false)
    if (error || !user) { setLoginError(error ?? "Login failed"); return }
    setCurrentUser(user)
    setShowLoginModal(false)
    setLoginEmail("")
    setLoginPassword("")
    setCurrentView("sysadmin")
  }, [loginEmail, loginPassword])

  const handleLogout = useCallback(() => {
    setCurrentUser(null)
    if (currentView === "sysadmin") setCurrentView("home")
  }, [currentView])

  // Show splash screen on initial load
  if (showSplash) {
    return <SplashScreen onEnter={() => setShowSplash(false)} />
  }

  // Wrap any view in the persistent sidebar shell
  const withShell = (content: React.ReactNode) => (
    <div className="min-h-screen bg-slate-50">
      <AppSidebar
        currentView={currentView as ViewKey}
        onNavigate={(v) => {
          if (v === "chataio") { setShowHomeChatAIO(true); return }
          setCurrentView(v as typeof currentView)
        }}
        backendIsOnline={backendIsOnline}
        username={currentUser?.username ?? null}
      />
      <div className="lg:ml-60 min-h-screen">
        {content}
      </div>
      <ChatAioDialog open={showHomeChatAIO} onOpenChange={setShowHomeChatAIO} />
    </div>
  )

  if (currentView === "guide") return withShell(<UserGuide onBack={() => setCurrentView("home")} onSysAdmin={handleSystemClick} />)
  if (currentView === "workflow") return withShell(<WorkflowDescription onBack={() => setCurrentView("home")} onSysAdmin={handleSystemClick} />)
  if (currentView === "reference") return withShell(<ReferencePage onBack={() => setCurrentView("home")} onSysAdmin={handleSystemClick} />)
  if (currentView === "paper") return withShell(<AIOReferencePaper onBack={() => setCurrentView("home")} onSysAdmin={handleSystemClick} />)
  if (currentView === "mro-paper") return withShell(<MROReferencePaper onBack={() => setCurrentView("home")} onSysAdmin={handleSystemClick} />)
  if (currentView === "processor") return withShell(<SemanticProcessor files={convertedFiles} downloadedFiles={downloadedFileNames} onBack={() => setCurrentView("converter")} backendIsOnline={backendIsOnline} onSysAdmin={handleSystemClick} />)
  if (currentView === "sysadmin") return withShell(<SystemManagement onBack={() => setCurrentView("home")} />)
  if (currentView === "rnd") return withShell(<ResearchAndDevelopment onBack={() => setCurrentView("home")} backendIsOnline={backendIsOnline} onSysAdmin={handleSystemClick} />)
  if (currentView === "pdf-import") return withShell(<PdfImportView onBack={() => setCurrentView("home")} onSysAdmin={handleSystemClick} onImportCsv={(csvData) => { setConvertedFiles((prev) => [...prev, csvData]); setCurrentView("converter") }} />)

  if (currentView === "home") {
    return withShell(
      <>
        <Dashboard
          backendIsOnline={backendIsOnline}
          onNavigate={(v) => {
            if (v === "chataio") { setShowHomeChatAIO(true); return }
            if (v === "processor") { handleLoadFromBackend().then(() => setCurrentView("processor")); return }
            setCurrentView(v as typeof currentView)
          }}
        />
        {/* Login Modal (kept for admin access) */}
        <Dialog open={showLoginModal} onOpenChange={(open) => { if (!open) { setShowLoginModal(false); setLoginError(null) } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Lock className="w-4 h-4" />Admin Login</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleLogin} className="flex flex-col gap-4 mt-2">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-foreground">Email</label>
                <input type="email" autoComplete="email" required value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="admin@example.com" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-foreground">Password</label>
                <div className="relative">
                  <input type={showPassword ? "text" : "password"} autoComplete="current-password" required value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} className="w-full px-3 py-2 pr-10 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="••••••••" />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {loginError && <p className="text-xs text-red-500">{loginError}</p>}
              <Button type="submit" disabled={isLoggingIn} className="gap-2">
                {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                {isLoggingIn ? "Signing in…" : "Sign In"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </>
    )
  }

  // === OLD HOME PAGE (preserved but unreachable; kept for any deep references) ===
  if (false && currentView === "home") {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border bg-card"><div className="max-w-6xl mx-auto px-6 py-4"><div className="flex items-center justify-between"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center"><Database className="w-5 h-5 text-primary-foreground" /></div><h1 className="text-xl font-bold text-foreground">AIO Generator V3.1</h1></div><div className="flex items-center gap-3"><BackendStatusBadge />{currentUser && (<span className="text-xs text-muted-foreground hidden sm:inline">{currentUser.username}</span>)}{currentUser && (<Button variant="ghost" size="sm" onClick={handleLogout} className="gap-1 text-xs text-muted-foreground"><LogOut className="w-3 h-3" />Logout</Button>)}<Button variant="outline" size="sm" onClick={handleSystemClick} className="gap-2"><Settings className="w-4 h-4" />System Admin</Button></div></div></div></header>
        <section className="max-w-6xl mx-auto px-6 py-16 text-center">
          <div className="max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-900 text-white text-sm font-medium mb-6"><Globe className="w-4 h-4" />Information Physics Standard Model</div>
            <h2 className="text-4xl font-bold text-foreground mb-2">AIO Generator V3.1</h2>
            <p className="text-lg text-muted-foreground mb-2">by InformationPhysics.ai</p>
            <p className="text-lg text-muted-foreground mb-10">Transform your CSV data into Associated Information Objects (AIOs) - the fundamental unit of information in the new Information Physics Standard Model.</p>
          </div>
          <div className="flex justify-center gap-4 mb-10 flex-wrap">
            <Button size="lg" onClick={() => setCurrentView("converter")} className="gap-2 px-8">Load New CSVs for Conversion<ArrowRight className="w-4 h-4" /></Button>
            {backendIsOnline && <Button size="lg" variant="outline" onClick={() => setCurrentView("pdf-import")} className="gap-2 px-8"><Upload className="w-4 h-4" />Import PDFs→CSVs</Button>}
            <Button size="lg" variant="outline" onClick={async () => { await handleLoadFromBackend(); setCurrentView("processor") }} className="gap-2 px-8"><Layers className="w-4 h-4" />Create New HSLs</Button>
            {backendIsOnline && <Button size="lg" variant="outline" onClick={() => setShowHomeChatAIO(true)} className="gap-2 px-8"><MessageSquare className="w-4 h-4" />ChatAIO</Button>}
            {backendIsOnline && <Button size="lg" variant="outline" onClick={() => setCurrentView("rnd")} className="gap-2 px-8"><Atom className="w-4 h-4" />R &amp; D</Button>}
          </div>
          <ChatAioDialog open={showHomeChatAIO} onOpenChange={setShowHomeChatAIO} />
          <div className="grid md:grid-cols-3 gap-6 mb-16">
            <div className="p-6 rounded-xl bg-card border border-border text-left"><div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4"><Layers className="w-5 h-5 text-primary" /></div><h3 className="font-semibold text-foreground mb-2">Application Agnostic</h3><p className="text-sm text-muted-foreground">AIOs are information objects not tied to any application or relational database schema, enabling universal data interoperability.</p></div>
            <div className="p-6 rounded-xl bg-card border border-border text-left"><div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4"><Cpu className="w-5 h-5 text-primary" /></div><h3 className="font-semibold text-foreground mb-2">Hyper-Semantic Model</h3><p className="text-sm text-muted-foreground">AIOs form the basis of a new hyper-semantic model that captures meaning and relationships in a way traditional data formats cannot.</p></div>
            <div className="p-6 rounded-xl bg-card border border-border text-left"><div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4"><Zap className="w-5 h-5 text-primary" /></div><h3 className="font-semibold text-foreground mb-2">Next-Gen LLM Foundation</h3><p className="text-sm text-muted-foreground">This hyper-semantic model will serve as the foundation upon which a new class of Large Language Models will operate with enhanced understanding.</p></div>
          </div>
          <div className="mb-16">
            <h3 className="text-2xl font-bold text-foreground mb-8">The Conversion Process</h3>
            <div className="flex items-center justify-center gap-4 flex-wrap">
              <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-card border border-border min-w-[120px]"><span className="text-2xl font-mono font-bold text-primary">CSV</span><span className="text-xs text-muted-foreground">Tabular Data</span></div>
              <ArrowRight className="w-6 h-6 text-muted-foreground" />
              <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-card border border-border min-w-[120px]"><span className="text-2xl font-mono font-bold text-primary">[Col.Val]</span><span className="text-xs text-muted-foreground">AIO Format</span></div>
              <ArrowRight className="w-6 h-6 text-muted-foreground" />
              <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-card border border-border min-w-[120px]"><span className="text-2xl font-mono font-bold text-primary">.aio</span><span className="text-xs text-muted-foreground">Semantic Object</span></div>
              <ArrowRight className="w-6 h-6 text-muted-foreground" />
              <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-card border border-border min-w-[120px]"><span className="text-2xl font-mono font-bold text-primary">.hsl</span><span className="text-xs text-muted-foreground text-center">Hyper-Semantic-Layer Object</span></div>
              <ArrowRight className="w-6 h-6 text-muted-foreground" />
              <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-card border border-purple-400 min-w-[120px]"><span className="text-2xl font-mono font-bold text-purple-600">.mro</span><span className="text-xs text-muted-foreground text-center">Memory Result Object</span></div>
            </div>
            <p className="text-sm text-muted-foreground mt-6 max-w-2xl mx-auto">{"Each row of your CSV is transformed into a single-line AIO prefixed with source metadata: [OriginalCSV.filename][FileDate.YYYY-MM-DD][FileTime.HH:MM:SS][Column1.Value1][Column2.Value2]..."}</p>
          </div>
          <div className="flex flex-col items-center gap-4">
            <div className="flex gap-4">
              <Button variant="ghost" onClick={() => setCurrentView("guide")} className="gap-2"><BookOpen className="w-4 h-4" />User Guide</Button>
              <Button variant="ghost" onClick={() => setCurrentView("workflow")} className="gap-2"><Cpu className="w-4 h-4" />Workflow Description</Button>
              <Button variant="ghost" onClick={() => setCurrentView("reference")} className="gap-2"><FileText className="w-4 h-4" />Information Physics Reference</Button>
            </div>
            <Button variant="outline" onClick={() => setCurrentView("paper")} className="gap-2 mt-2"><BookOpen className="w-4 h-4" />AIO Reference Paper</Button>
            <Button variant="outline" onClick={() => setCurrentView("mro-paper")} className="gap-2 mt-2"><Brain className="w-4 h-4" />MRO Reference Paper</Button>
          </div>
        </section>
        <footer className="border-t border-border mt-16"><div className="max-w-6xl mx-auto px-6 py-6 text-center"><p className="text-sm text-muted-foreground">InformationPhysics.ai - Pioneering the Information Physics Standard Model</p></div></footer>

        {/* Login Modal */}
        <Dialog open={showLoginModal} onOpenChange={(open) => { if (!open) { setShowLoginModal(false); setLoginError(null) } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Lock className="w-4 h-4" />Admin Login</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleLogin} className="flex flex-col gap-4 mt-2">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-foreground">Email</label>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="admin@example.com"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-foreground">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    className="w-full px-3 py-2 pr-10 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {loginError && <p className="text-xs text-red-500">{loginError}</p>}
              <Button type="submit" disabled={isLoggingIn} className="gap-2">
                {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                {isLoggingIn ? "Signing in…" : "Sign In"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  // Converter view
  return withShell(
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card"><div className="max-w-6xl mx-auto px-6 py-4"><div className="flex items-center justify-between"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center"><Database className="w-5 h-5 text-primary-foreground" /></div><div className="text-left"><h1 className="text-xl font-bold text-foreground">CSV Converter</h1><p className="text-xs text-muted-foreground">Convert CSV rows into AIO bracket notation</p></div></div><div className="flex items-center gap-3"><BackendStatusBadge /></div></div></div></header>
      <main className="max-w-6xl mx-auto px-6 py-8">
        {convertedFiles.length === 0 ? (
          <div>
            <FileUpload onFilesSelected={handleFilesSelected} isProcessing={isProcessing} />
            {backendIsOnline && (
              <div className="mt-6 flex items-center justify-center gap-3">
                <Button variant="outline" onClick={handleLoadFromBackend} disabled={isLoadingFromBackend} className="gap-2">
                  {isLoadingFromBackend ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                  Load Saved AIOs from Backend
                </Button>
                <Button variant="outline" onClick={handleViewAioDb} className="gap-2">
                  <Database className="w-4 h-4" />
                  View Saved AIOs
                </Button>
              </div>
            )}
          </div>
        ) : (
          <ConversionPreview files={convertedFiles} onClear={handleClear} onProcess={(downloaded) => { setDownloadedFileNames(downloaded); setCurrentView("processor") }} backendIsOnline={backendIsOnline} />
        )}
      </main>
      <footer className="border-t border-border mt-8"><div className="max-w-6xl mx-auto px-6 py-4 text-center"><p className="text-xs text-muted-foreground">{"Each row becomes: [OriginalCSV.filename][FileDate.YYYY-MM-DD][FileTime.HH:MM:SS][Column1.Value1][Column2.Value2]..."}</p></div></footer>

      {/* Saved AIO / CSV Database Dialog */}
      <Dialog open={showAioDb} onOpenChange={setShowAioDb}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Saved Records Database</DialogTitle>
          </DialogHeader>
          {isLoadingAioDb ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : (
            (() => {
              const aioRecs = aioDbRecords.filter((r) => r.type === "AIO")
              const csvRecs = aioDbRecords.filter((r) => r.type === "CSV")

              const renderGrouped = (recs: IORecord[], contentPrefix: string, label: string) => {
                if (recs.length === 0) return <p className="text-sm text-muted-foreground py-6 text-center">No {label} saved yet.</p>
                const grouped = new Map<string, IORecord[]>()
                recs.forEach((r) => {
                  const src = r.context.source_object_id ?? "unknown"
                  if (!grouped.has(src)) grouped.set(src, [])
                  grouped.get(src)!.push(r)
                })
                return (
                  <div className="overflow-auto space-y-4">
                    {Array.from(grouped.entries()).map(([src, group]) => (
                      <div key={src}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold text-foreground font-mono">{src}</span>
                          <Badge variant="secondary">{group.length} {label}</Badge>
                        </div>
                        <div className="border border-border rounded-lg overflow-auto">
                          <table className="w-full text-xs">
                            <thead className="bg-muted/50">
                              <tr>
                                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Saved</th>
                                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Content</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.map((r) => {
                                const uri = r.raw.raw_uri ?? ""
                                const content = uri.startsWith(contentPrefix) ? decodeURIComponent(uri.slice(contentPrefix.length)) : uri
                                return (
                                  <tr key={r.io_id} className="border-t border-border hover:bg-accent/50 transition-colors">
                                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                                    <td className="px-3 py-2 font-mono truncate max-w-xs" title={content}>{content.length > 80 ? content.slice(0, 80) + "…" : content}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              }

              // Build file list from AIO records for CSV tab
              const aioGroups = new Map<string, IORecord[]>()
              aioRecs.forEach((r) => {
                const src = r.context.source_object_id ?? "unknown.csv"
                if (!aioGroups.has(src)) aioGroups.set(src, [])
                aioGroups.get(src)!.push(r)
              })
              const fileEntries = Array.from(aioGroups.entries())

              const openCsvPreview = (src: string, recs: IORecord[]) => {
                // Prefer an actual saved CSV record if available
                const savedCsv = csvRecs.find((c) => c.context.source_object_id === src)
                if (savedCsv) {
                  const uri = savedCsv.raw.raw_uri ?? ""
                  if (uri.startsWith("data:text/csv,")) {
                    const { headers, rows } = parseCSV(decodeURIComponent(uri.slice("data:text/csv,".length)))
                    setCsvPreviewFile(src); setCsvPreviewHeaders(headers); setCsvPreviewRows(rows); return
                  }
                }
                // Otherwise reconstruct from AIO records
                const { headers, rows } = reconstructCsvFromAios(recs)
                setCsvPreviewFile(src); setCsvPreviewHeaders(headers); setCsvPreviewRows(rows)
              }

              return (
                <Tabs defaultValue="csvs" className="flex flex-col overflow-hidden">
                  <TabsList className="shrink-0 mb-3">
                    <TabsTrigger value="csvs">CSV Files <Badge variant="secondary" className="ml-2">{fileEntries.length}</Badge></TabsTrigger>
                    <TabsTrigger value="aios">AIO Records <Badge variant="secondary" className="ml-2">{aioRecs.length}</Badge></TabsTrigger>
                  </TabsList>
                  <TabsContent value="csvs" className="overflow-auto mt-0">
                    {fileEntries.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-6 text-center">No saved CSV data found.</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-3 p-1">
                        {fileEntries.map(([src, recs]) => (
                          <button
                            key={src}
                            className="text-left p-4 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors"
                            onClick={() => openCsvPreview(src, recs)}
                          >
                            <div className="flex items-center gap-2 mb-2">
                              <FileSpreadsheet className="w-4 h-4 text-primary shrink-0" />
                              <span className="text-sm font-medium font-mono truncate">{src}</span>
                            </div>
                            <div className="flex gap-3 text-xs text-muted-foreground">
                              <span>{recs.length} AIO rows</span>
                              <span>·</span>
                              <span>Click to view data</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </TabsContent>
                  <TabsContent value="aios" className="overflow-auto mt-0">{renderGrouped(aioRecs, "data:text/aio,", "AIOs")}</TabsContent>
                </Tabs>
              )
            })()
          )}
        </DialogContent>
      </Dialog>

      {/* CSV Data Preview Modal */}
      <Dialog open={!!csvPreviewFile} onOpenChange={(o) => { if (!o) { setCsvPreviewFile(null); setCsvPreviewHeaders([]); setCsvPreviewRows([]) } }}>
        <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-primary" />
              <span className="font-mono text-sm">{csvPreviewFile}</span>
            </DialogTitle>
          </DialogHeader>
          {csvPreviewHeaders.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No data to display.</p>
          ) : (
            <div className="overflow-auto flex-1 border border-border rounded-lg">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-muted/70 sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-r border-border w-10">#</th>
                    {csvPreviewHeaders.map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-semibold text-foreground border-b border-r border-border whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {csvPreviewRows.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-background hover:bg-accent/30" : "bg-muted/20 hover:bg-accent/30"}>
                      <td className="px-3 py-1.5 text-muted-foreground border-r border-border text-right">{i + 1}</td>
                      {row.map((cell, j) => (
                        <td key={j} className="px-3 py-1.5 border-r border-border max-w-[200px] truncate" title={cell}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground pt-1 shrink-0">
            {csvPreviewRows.length} rows · {csvPreviewHeaders.length} columns
          </p>
        </DialogContent>
      </Dialog>
    </div>
  )
  // end of HomePage
}
