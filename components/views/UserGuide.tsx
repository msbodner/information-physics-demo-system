"use client"

import { useState } from "react"
import { ArrowLeft, Globe, BookOpen, FileText, Zap, Cpu, Layers, Settings, Database, FileSpreadsheet, Brain } from "lucide-react"
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
    { id: "substrate", label: "Substrate Mode (V3.2)", icon: Brain },
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
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Globe className="w-5 h-5" />Overview — AIO Generator V3.2</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>AIO Generator V3.2 converts CSV files into <strong>Associated Information Objects (AIOs)</strong> — the fundamental unit of the Information Physics Standard Model. Each CSV row becomes a single self-describing AIO string, stored in a PostgreSQL database and searchable through the Hyper-Semantic Processor.</p>
                <p><strong>New in V3.2: Substrate Mode.</strong> ChatAIO now implements the full Paper III pipeline — deterministic cue extraction, bounded HSL neighborhood traversal, Jaccard-ranked MRO pre-fetch, and automatic MRO capture. The AIO/HSL/MRO substrate replaces traditional RAG + Medallion Gold curation as Claude&apos;s retrieval layer. See the <strong>Substrate Mode</strong> section in this guide.</p>
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

            {/* ── SUBSTRATE MODE (V3.2) ── */}
            {activeSection === "substrate" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Brain className="w-5 h-5 text-purple-600" />Substrate Mode — Claude Answers Grounded in the AIO/HSL/MRO Substrate</CardTitle></CardHeader>
              <CardContent className="space-y-5 text-sm text-muted-foreground leading-relaxed">
                <p>V3.2 introduces <strong>Substrate Mode</strong> in the ChatAIO dialog — a third retrieval mode alongside Send (Broad) and AIO Search. It implements the full five-step pipeline from <em>Paper III: Precomputed Semantic Substrates for Large Language Models</em>, using your stored AIOs, HSL neighborhoods, and prior Memory Result Objects (MROs) as a direct replacement for traditional Retrieval-Augmented Generation.</p>

                <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800">
                  <p className="text-purple-800 dark:text-purple-200 text-xs leading-relaxed">
                    <strong>Where to find it:</strong> Click <strong>ChatAIO</strong> on the home page. In the input bar at the bottom you will see three buttons: <strong>Send</strong> (broad search), <strong>AIO Search</strong> (HSL-guided), and now <strong>Substrate</strong> (purple button, rightmost). Type your question and click Substrate.
                  </p>
                </div>

                <h4 className="text-foreground font-medium mt-4">What happens when you click Substrate</h4>
                <p>Unlike Send, which ships up to 500 raw records to Claude as context, Substrate runs a precomputed-topology traversal before calling the model:</p>
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
                  <div className="pl-3 border-l-2 border-blue-500/50">
                    <p className="text-foreground font-medium text-xs">Send — Broad Search</p>
                    <p>Exploratory questions across the full corpus. Best when you do not know yet which elements matter. Cost: full context window, no reuse.</p>
                  </div>
                  <div className="pl-3 border-l-2 border-amber-500/50">
                    <p className="text-foreground font-medium text-xs">AIO Search — HSL-Guided</p>
                    <p>Targeted questions where an HSL library already exists. Backend parses the query and searches HSL records for matches. Cost: one backend round-trip for the HSL search.</p>
                  </div>
                  <div className="pl-3 border-l-2 border-purple-500/50">
                    <p className="text-foreground font-medium text-xs">Substrate — Paper III Pipeline</p>
                    <p>Repeated or recurring questions. Deterministic cue extraction, bounded neighborhood traversal, MRO reuse, and auditable provenance. Cost: grows with neighborhood size, not corpus size. Gets faster and richer over time as MROs accumulate.</p>
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
