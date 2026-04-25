"use client"

import { useState } from "react"
import { ArrowLeft, Globe, BookOpen, FileText, Zap, Cpu, Layers, Settings, Database, FileSpreadsheet, Brain, Network, GitMerge } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function UserGuide({ onBack, onSysAdmin }: { onBack: () => void; onSysAdmin: () => void }) {
  const [activeSection, setActiveSection] = useState<string>("overview")
  const sections = [
    { id: "overview", label: "Overview", icon: Globe },
    { id: "home-page", label: "Home Page", icon: BookOpen },
    { id: "csv-converter", label: "CSV Converter", icon: FileText },
    { id: "hsp", label: "Hyper-Semantic Processor", icon: Cpu },
    { id: "hsl", label: "HSL — Creating & Viewing", icon: Layers },
    { id: "substrate", label: "Substrate Mode (V4.1)", icon: Brain },
    { id: "aio-hsl-structure", label: "AIO Body & HSL String", icon: GitMerge },
    { id: "mro-topology", label: "MRO Topology Diagram", icon: Network },
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
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Globe className="w-5 h-5" />Overview — AIO/HSL/MRO Demo System V4.1</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>AIO/HSL/MRO Demo System V4.1 converts CSV files into <strong>Associated Information Objects (AIOs)</strong> — the fundamental unit of the Information Physics Standard Model. Each CSV row becomes a single self-describing AIO string, stored in a PostgreSQL database and searchable through the Hyper-Semantic Processor.</p>
                <p><strong>New in V4.1: Substrate Mode.</strong> ChatAIO now implements the full Paper III pipeline — deterministic cue extraction, bounded HSL neighborhood traversal, Jaccard-ranked MRO pre-fetch, and automatic MRO capture. The AIO/HSL/MRO substrate replaces traditional RAG + Medallion Gold curation as Claude&apos;s retrieval layer. See the <strong>Substrate Mode</strong> section in this guide.</p>
                <h4 className="text-foreground font-medium mt-4">What the app does</h4>
                <ol className="list-decimal list-inside space-y-2">
                  <li><strong>Convert</strong> — Upload CSVs; every row becomes an AIO bracketstring.</li>
                  <li><strong>Store</strong> — AIOs are saved to two backend tables: <code className="bg-muted px-1 rounded">aio_data</code> (parsed elements) and <code className="bg-muted px-1 rounded">information_objects</code> (full encoded URI).</li>
                  <li><strong>Search</strong> — The Hyper-Semantic Processor lets you click any element value to find every AIO that shares it — across all files and sessions.</li>
                  <li><strong>Link</strong> — Create HSL (Hyper-Semantic Layer) records that capture which AIOs share a common element, forming a provenance-chain of semantic relationships.</li>
                  <li><strong>Ground</strong> — Substrate Mode in ChatAIO uses the AIO/HSL/MRO topology directly as Claude&apos;s retrieval substrate, replacing embedding-based RAG with exact graph traversal.</li>
                  <li><strong>Administer</strong> — Manage users, roles, AIO data, HSL data, and MRO records via the System Admin panel.</li>
                </ol>
                <h4 className="text-foreground font-medium mt-4">Key Benefits</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>Application-agnostic</strong> — AIOs are not tied to any schema or application.</li>
                  <li><strong>Self-describing</strong> — Every AIO carries its own semantic metadata.</li>
                  <li><strong>Cross-file matching</strong> — Find relationships across any number of source CSVs.</li>
                  <li><strong>Persistent</strong> — All data survives browser refresh; reload from the backend at any time.</li>
                  <li><strong>Self-improving</strong> — Substrate Mode persists every query as an MRO, so repeated questions get richer priors over time.</li>
                </ul>
              </CardContent></Card>
            )}

            {/* ── HOME PAGE ── */}
            {activeSection === "home-page" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><BookOpen className="w-5 h-5" />Home Page — Buttons & Navigation</CardTitle></CardHeader>
              <CardContent className="space-y-5 text-sm text-muted-foreground leading-relaxed">
                <p>The home page is the main launch pad. All primary actions start here.</p>

                <h4 className="text-foreground font-medium">Header — top bar</h4>
                <div className="space-y-3 pl-2 border-l-2 border-border">
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">Backend Connected / Offline badge</p><p>Shows whether the PostgreSQL backend is reachable. Green = connected; red = offline. When offline, saves are skipped and duplicate detection is disabled, but conversion still works locally.</p></div>
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">Username + Logout</p><p>Appear after a successful System Admin login. Click <strong>Logout</strong> to end your session and return to the home page.</p></div>
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">System Admin button</p><p>Opens the Admin Login modal if you are not yet authenticated. Enter your email and password (default: <code className="bg-muted px-1 rounded">bodner.michael@gmail.com</code> / <code className="bg-muted px-1 rounded">Infophysics2024</code>). On success, navigates to the System Admin panel. Use the eye icon to show/hide your password.</p></div>
                </div>

                <h4 className="text-foreground font-medium mt-2">Primary action buttons</h4>
                <div className="space-y-3 pl-2 border-l-2 border-border">
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">Load New CSVs for Conversion</p><p>Opens the CSV Converter page where you can drag-and-drop or browse for CSV files to upload and convert to AIOs.</p></div>
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">Create New HSLs</p><p>Loads all previously saved AIOs from the backend database into memory, then navigates directly to the Hyper-Semantic Processor so you can create new HSL records without re-uploading any CSVs.</p></div>
                </div>

                <h4 className="text-foreground font-medium mt-2">Navigation buttons</h4>
                <div className="space-y-3 pl-2 border-l-2 border-border">
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">User Guide</p><p>Opens this guide.</p></div>
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">Workflow Description</p><p>Opens a technical deep-dive into each stage of the AIO pipeline — parsing, conversion, storage, deduplication, retrieval, semantic processing, and HSL formation.</p></div>
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">Information Physics Reference</p><p>A reference document covering the theoretical foundations of AIOs, the Hyper-Semantic Model, and Information Physics.</p></div>
                  <div><p className="text-foreground font-medium text-xs uppercase tracking-wide mb-1">AIO Reference Paper</p><p>The full academic-style paper introducing the AIO as the quantum particle of Information Physics.</p></div>
                </div>
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

            {/* ── SUBSTRATE MODE (V4.1) ── */}
            {activeSection === "substrate" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Brain className="w-5 h-5 text-purple-600" />Substrate Mode — Claude Answers Grounded in the AIO/HSL/MRO Substrate</CardTitle></CardHeader>
              <CardContent className="space-y-5 text-sm text-muted-foreground leading-relaxed">
                <p>V4.1 introduces <strong>Substrate Mode</strong> in the ChatAIO dialog — one of four retrieval modes alongside <strong>CSV→LLM Raw</strong> (raw CSVs, no IP machinery), <strong>Blind Dump AIO/HSL</strong> (broad AIO/HSL dump), and <strong>AIO Search</strong> (HSL-guided four-phase). It implements the full five-step pipeline from <em>Paper III: Precomputed Semantic Substrates for Large Language Models</em>, using your stored AIOs, HSL neighborhoods, and prior Memory Result Objects (MROs) as a direct replacement for traditional Retrieval-Augmented Generation.</p>

                <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800">
                  <p className="text-purple-800 dark:text-purple-200 text-xs leading-relaxed">
                    <strong>Where to find it:</strong> Click <strong>ChatAIO</strong> on the home page. In the input bar at the bottom you will see four buttons: <strong>Substrate</strong> (purple, default — Enter key), <strong>AIO Search</strong> (HSL-guided), <strong>CSV→LLM Raw</strong> (raw CSV control case), and <strong>Blind Dump AIO/HSL</strong> (broad AIO/HSL dump).
                  </p>
                </div>

                <h4 className="text-foreground font-medium mt-4">What happens when you click Substrate</h4>
                <p>Unlike Blind Dump AIO/HSL, which ships up to 500 raw records to Claude as context, Substrate runs a precomputed-topology traversal before calling the model:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li><strong>Cue extraction</strong> — your question is parsed against the Information Elements directory and the full AIO value vocabulary to extract a cue set <code className="bg-muted px-1 rounded">K</code> of <code className="bg-muted px-1 rounded">[Key.Value]</code> pairs. This is deterministic and happens in the browser.</li>
                  <li><strong>HSL traversal</strong> — the neighborhood <code className="bg-muted px-1 rounded">N(K) = ⋂ H(k)</code> is computed as the set intersection of per-cue AIO sets. Only the AIOs that match all cues are retrieved.</li>
                  <li><strong>MRO pre-fetch</strong> — prior Memory Result Objects are ranked by Jaccard overlap × exponential freshness decay × stored confidence. The top-3 are surfaced as episodic priors.</li>
                  <li><strong>Context bundle assembly</strong> — a tiered prompt is built: MRO priors (framing), HSL neighborhoods (relational context), raw AIOs (grounding), your question (query).</li>
                  <li><strong>MRO capture</strong> — after Claude responds, the query, cues, traversal path, and answer are persisted as a new MRO linked back to the contributing HSLs. The next similar question will benefit from this episode as a prior.</li>
                </ol>

                <h4 className="text-foreground font-medium mt-4">Reading the response metadata</h4>
                <p>Every Substrate response ends with an italic metadata line:</p>
                <div className="p-3 rounded-lg bg-muted font-mono text-xs italic">
                  Substrate pipeline: 3 cues → 17 AIOs in neighborhood · 2 MRO priors used · MRO saved
                </div>
                <ul className="list-disc list-inside space-y-1 mt-2">
                  <li><strong>cues</strong> — how many element-cues were extracted from your question</li>
                  <li><strong>AIOs in neighborhood</strong> — the exact size of <code className="bg-muted px-1 rounded">N(K)</code>; this is how many records Claude saw, not the corpus size</li>
                  <li><strong>MRO priors used</strong> — how many prior retrieval episodes were surfaced as framing</li>
                  <li><strong>MRO saved</strong> — whether this answer was persisted for future reuse</li>
                </ul>

                <h4 className="text-foreground font-medium mt-4">When to use each mode</h4>
                <div className="space-y-2">
                  <div className="pl-3 border-l-2 border-amber-500/50">
                    <p className="text-foreground font-medium text-xs">CSV→LLM Raw — Standard Claude w/ Raw CSVs</p>
                    <p>The control case. Sends only the original saved CSV files (up to 50, capped at ~30 KB each) to Claude with no Information-Physics framing — no AIO bracket notation, no HSL traversal, no MRO priors. Use this to demonstrate what a vanilla LLM can do with the same data and to benchmark the lift the AIO/HSL/MRO substrate provides.</p>
                  </div>
                  <div className="pl-3 border-l-2 border-blue-500/50">
                    <p className="text-foreground font-medium text-xs">Blind Dump AIO/HSL — Broad AIO/HSL Dump</p>
                    <p>Standard Claude prompt with up to 300 AIO records plus 10 HSL files dumped into the system prompt unfiltered. Exploratory questions across the full corpus. Best when you do not know yet which elements matter. Cost: full context window, no reuse, no provenance.</p>
                  </div>
                  <div className="pl-3 border-l-2 border-green-500/50">
                    <p className="text-foreground font-medium text-xs">AIO Search — HSL-Guided Four-Phase</p>
                    <p>Targeted questions where an HSL library already exists. Backend parses the query, matches HSLs by element overlap, gathers only the AIOs reached via those HSLs, and synthesizes an answer. Cost: one round-trip for HSL search, dramatically smaller token footprint than Blind Dump AIO/HSL.</p>
                  </div>
                  <div className="pl-3 border-l-2 border-purple-500/50">
                    <p className="text-foreground font-medium text-xs">Substrate — Paper III Pipeline</p>
                    <p>Repeated or recurring questions. Deterministic cue extraction, bounded neighborhood traversal, MRO reuse, and auditable provenance. Cost: grows with neighborhood size, not corpus size. Gets faster and richer over time as MROs accumulate. This is the default — press Enter to run it.</p>
                  </div>
                </div>

                <h4 className="text-foreground font-medium mt-4">Why Substrate gets better over time</h4>
                <p>Each Substrate query persists an MRO containing the cue set, the traversal path, and the answer. When you (or any user) ask a similar question later, the Jaccard-ranked MRO priors are injected into the new prompt as framing — the system literally remembers its prior successful retrievals. Traditional RAG has no equivalent mechanism; its Gold layer is static.</p>

                <h4 className="text-foreground font-medium mt-4">See also</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>Paper III</strong> — the full theoretical treatment. Home page → Paper III button.</li>
                  <li><strong>Mathematics Reference</strong> — all formulas with worked examples. Downloadable from System Admin → Documentation.</li>
                  <li><strong>R &amp; D — Compound HSL Builder</strong> — the interactive equivalent of Step 2. Use it to see the set-intersection operation without invoking Claude.</li>
                </ul>
              </CardContent></Card>
            )}

            {/* ── AIO BODY & HSL STRING ── */}
            {activeSection === "aio-hsl-structure" && (
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <GitMerge className="w-5 h-5 text-amber-600" />
                      AIO Body & HSL String — The Two Shapes of the Substrate
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                    <p>
                      This diagram shows the two fundamental structures that make the AIO/HSL substrate work —
                      and why retrieval is <span className="font-semibold text-foreground">bounded traversal over a precomputed topology</span> rather
                      than approximate similarity search.
                    </p>
                    <div className="w-full overflow-x-auto bg-white rounded-lg border border-border">
                      <img
                        src="/AIO_HSL_Diagram.svg"
                        alt="AIO body shown with roughly 35 bracketed elements, one element highlighted, and an HSL string below threading through 10 of 44 AIOs that share that element"
                        className="w-full min-w-[900px]"
                        style={{ display: "block" }}
                      />
                    </div>

                    <div className="grid lg:grid-cols-2 gap-3 pt-2">
                      <div className="flex items-start gap-2 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                        <Database className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-xs text-blue-500">Top — the AIO body</p>
                          <p className="text-xs leading-relaxed">
                            One AIO is a single self-describing record made of many bracketed elements. Each element is
                            a <span className="font-mono">[Key.Value]</span> pair binding a semantic label to an observed value at capture time.
                            The AIO shown above (<span className="font-mono">AIA305 Sample_0002.aio</span>) carries roughly 35 elements describing
                            one construction project, <span className="font-semibold text-foreground">PRJ-499 Highland Resort &amp; Spa</span>.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
                        <Layers className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-xs text-amber-600">Bottom — the HSL string</p>
                          <p className="text-xs leading-relaxed">
                            The HSL file <span className="font-mono">[ProjectManager.Destiny Owens].hsl</span> is a precomputed string that
                            threads through every AIO in the corpus containing that exact element. Each small box along
                            the string is one of the <span className="font-semibold text-foreground">44 AIOs</span> that share this element — 44 different
                            projects Destiny manages. 10 of the 44 are shown.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="p-3 bg-muted/40 rounded-lg border border-border">
                      <p className="font-semibold text-xs text-foreground mb-1">Legend</p>
                      <ul className="text-xs space-y-1 list-disc list-inside">
                        <li><span className="inline-block w-3 h-3 rounded align-middle mr-1" style={{ background: "#FFE8D6", border: "1px solid #D97706" }} /> Metadata prefix elements (origin CSV, file date, file time) — peach-colored</li>
                        <li><span className="inline-block w-3 h-3 rounded align-middle mr-1" style={{ background: "#E8F4F8", border: "1px solid #1F4E79" }} /> Observed semantic elements (<span className="font-mono">[Key.Value]</span> pairs from the source record) — blue</li>
                        <li><span className="inline-block w-3 h-3 rounded align-middle mr-1" style={{ background: "#FEF3C7", border: "2px solid #D97706" }} /> The one shared element the HSL string threads through — highlighted yellow</li>
                      </ul>
                    </div>

                    <div className="flex items-start gap-2 p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                      <Zap className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-sm text-emerald-500">Why this matters</p>
                        <p className="text-xs leading-relaxed">
                          When the system needs to answer <em>&quot;show me everything Destiny is managing,&quot;</em> it does not search the corpus.
                          It walks this one string. Retrieval becomes <span className="font-semibold text-foreground">bounded traversal over a precomputed
                          topology</span> — exact, auditable, and orders of magnitude cheaper than conventional RAG, with no embedding model, no
                          vector database, and no approximate nearest-neighbor search in the loop.
                        </p>
                      </div>
                    </div>

                    <div>
                      <p className="font-semibold text-foreground mb-2">How the two shapes compose</p>
                      <ul className="list-disc list-inside space-y-1 text-xs">
                        <li>An <span className="font-semibold">AIO</span> is a <em>wide row</em> — one record, many elements.</li>
                        <li>An <span className="font-semibold">HSL</span> is a <em>long string</em> — one element, many AIOs.</li>
                        <li>Every element in every AIO is a potential anchor for an HSL. The HSL builder materializes the anchors that actually have ≥2 AIOs sharing them, producing the index that the four-phase AIO Search walks at query time.</li>
                        <li>When a query mentions <span className="font-mono">&quot;Destiny Owens&quot;</span>, Phase 2 finds the matching HSL, Phase 3 expands its AIO pointers into the 44 actual records, and Phase 4 hands those records to Claude as exact, provenance-preserved context.</li>
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ── MRO TOPOLOGY DIAGRAM ── */}
            {activeSection === "mro-topology" && (
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Network className="w-5 h-5 text-violet-500" />
                      MRO Topology: Vance HSL → AIO → MRO String
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                    <p>
                      The diagram below traces a real production traversal — query <span className="font-mono text-xs bg-muted px-1 rounded">&quot;Laura Vance&quot;</span> — through
                      the complete AIO/HSL/MRO pipeline. It shows how cues are extracted, how HSL neighborhoods
                      are traversed, which AIO nodes are gathered, how the MRO is captured, and how
                      the <span className="font-semibold text-foreground">back-links</span> (the orange dashed lines — the &quot;string&quot;) are written as{" "}
                      <span className="font-mono text-xs bg-muted px-1 rounded">[MRO.abee76dc]</span> into each matched HSL element slot,
                      permanently wiring the retrieval episode into the semantic layer for future queries.
                    </p>
                    <div className="w-full overflow-x-auto bg-white rounded-lg border border-border">
                      <img
                        src="/vance-topology.svg"
                        alt="Vance HSL–AIO–MRO topology diagram showing query traversal, HSL neighborhood N(K), AIO nodes, MRO capture, and back-link strings"
                        className="w-full min-w-[900px]"
                        style={{ display: "block" }}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-2">
                      <div className="flex items-start gap-2 p-3 bg-indigo-500/10 rounded-lg border border-indigo-500/20">
                        <div className="w-3 h-3 rounded mt-0.5 shrink-0 bg-indigo-500/60 border border-indigo-400" />
                        <div>
                          <p className="font-semibold text-xs text-indigo-400">HSL Nodes (indigo)</p>
                          <p className="text-xs">Hyper-Semantic Layer records — each holds up to 100 AIO pointers sharing a <span className="font-mono">[Key.Value]</span> pair</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2 p-3 bg-teal-500/10 rounded-lg border border-teal-500/20">
                        <div className="w-3 h-3 rounded mt-0.5 shrink-0 bg-teal-500/60 border border-teal-400" />
                        <div>
                          <p className="font-semibold text-xs text-teal-400">Contact / Lead AIOs (teal)</p>
                          <p className="text-xs">CRM records — Laura Vance contact and associated sales lead</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
                        <div className="w-3 h-3 rounded mt-0.5 shrink-0 bg-amber-500/60 border border-amber-400" />
                        <div>
                          <p className="font-semibold text-xs text-amber-400">Project AIOs (amber)</p>
                          <p className="text-xs">PRJ-181, PRJ-206, PRJ-202 — construction projects where Vance is Estimator or Superintendent</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2 p-3 bg-violet-500/10 rounded-lg border border-violet-500/20">
                        <div className="w-3 h-3 rounded mt-0.5 shrink-0 bg-violet-500/60 border border-violet-400" />
                        <div>
                          <p className="font-semibold text-xs text-violet-400">MRO Node (violet)</p>
                          <p className="text-xs">Memory Result Object <span className="font-mono">abee76dc</span> — persisted retrieval episode, confidence 0.75</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 p-3 bg-orange-500/10 rounded-lg border border-orange-500/20">
                      <GitMerge className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-sm text-orange-400">Orange dashed lines = the MRO &quot;string&quot;</p>
                        <p className="text-xs leading-relaxed">
                          After the MRO is captured, its UUID is written as <span className="font-mono">[MRO.abee76dc]</span> into the next free element slot of every matched HSL.
                          The next time any of those HSLs is traversed by a cue-matching query, Phase 3 of the search pipeline reads those <span className="font-mono">[MRO.*]</span> slots,
                          fetches the MRO, ranks it by Jaccard × freshness × confidence, and injects it as Tier-1 context above the raw AIO evidence.
                          The system gets smarter with every query.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Brain className="w-5 h-5 text-violet-500" />
                      MRO Reuse Pipeline — How It Improves Over Time
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                    <ol className="list-decimal list-inside space-y-3">
                      <li>
                        <span className="font-semibold text-foreground">Cue extraction</span> — the query <span className="font-mono text-xs bg-muted px-1 rounded">&quot;Laura Vance&quot;</span> yields cues{" "}
                        <span className="font-mono text-xs bg-muted px-1 rounded">[Estimator.Laura Vance]</span>, <span className="font-mono text-xs bg-muted px-1 rounded">[Superintendent.Laura Vance]</span>, <span className="font-mono text-xs bg-muted px-1 rounded">[Full Name.Laura Vance]</span>
                      </li>
                      <li>
                        <span className="font-semibold text-foreground">HSL traversal N(K)</span> — <span className="font-mono text-xs bg-muted px-1 rounded">find-by-needles</span> matches 20 HSLs whose element content contains &quot;Vance&quot;
                      </li>
                      <li>
                        <span className="font-semibold text-foreground">MRO pre-fetch (Phase 3)</span> — each HSL&apos;s element slots are scanned for <span className="font-mono text-xs bg-muted px-1 rounded">[MRO.*]</span> refs; matching MROs are ranked by Jaccard(K_m, K) × freshness × confidence and surfaced as Tier-1 priors
                      </li>
                      <li>
                        <span className="font-semibold text-foreground">Bundle assembly</span> — MRO priors (framing) → HSL neighborhoods (relational context) → AIO evidence (grounding) → query
                      </li>
                      <li>
                        <span className="font-semibold text-foreground">MRO capture &amp; back-link</span> — the response is persisted as a new MRO; its UUID is written into the element slots of all matched HSLs, strengthening the retrieval graph for next time
                      </li>
                    </ol>
                  </CardContent>
                </Card>
              </div>
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

                <h4 className="text-foreground font-medium mt-2">Settings tab</h4>
                <div className="pl-2 border-l-2 border-border">
                  <p>Configure the <strong>Anthropic API Key</strong> used by the ChatAIO feature and the Summarize All function. Paste your key and click Save. The key is stored securely in the <code className="bg-muted px-1 rounded">system_settings</code> table and loaded at server startup.</p>
                </div>
              </CardContent></Card>
            )}

            {/* ── CSV FORMAT ── */}
            {activeSection === "csv-format" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileSpreadsheet className="w-5 h-5" />CSV Format Requirements</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>The AIO/HSL/MRO Demo System accepts standard CSV files with the following requirements:</p>
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
