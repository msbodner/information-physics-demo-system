"use client"

import { useState } from "react"
import { ArrowLeft, Globe, FileText, Layers, Database, Search, Cpu, Settings, Binary, Brain, GitMerge } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function WorkflowDescription({ onBack, onSysAdmin }: { onBack: () => void; onSysAdmin: () => void }) {
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
    { id: "sysadmin-workflow", label: "10. System Administration", icon: Settings },
    { id: "mro-pipeline", label: "11. MRO Reuse Pipeline", icon: Brain },
    { id: "structure-models", label: "AIO / HSL / MRO Structure Models", icon: Binary },
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
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Globe className="w-5 h-5" />End-to-End AIO Workflow</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>AIO/HSL/MRO Demo System V4.1 is the production release — a self-contained platform with its own FastAPI backend and PostgreSQL database. It converts CSV files into Associated Information Objects through a full-stack pipeline. Each stage is described in detail in the sections to the left. At a high level, the flow is:</p>
                <ol className="list-decimal list-inside space-y-2">
                  <li><strong>Upload:</strong> User selects one or more <code className="bg-muted px-1 rounded">.csv</code> files via drag-and-drop or file picker.</li>
                  <li><strong>Duplicate check:</strong> If the backend is online, filenames are compared against already-saved CSVs; duplicates are rejected with an error toast.</li>
                  <li><strong>CSV Parsing:</strong> Each file is read as text and split into a header row and data rows, handling quoted fields and multi-line escaping.</li>
                  <li><strong>AIO Conversion:</strong> Every data row is converted to a single-line AIO string of bracketed <code className="bg-muted px-1 rounded">[Key.Value]</code> elements.</li>
                  <li><strong>Preview:</strong> The browser displays the CSV table and the generated AIO lines side-by-side for review.</li>
                  <li><strong>Database Storage:</strong> When the backend is online, AIOs and the original CSV are persisted in two tables: <code className="bg-muted px-1 rounded">information_objects</code> (full encoded URI) and <code className="bg-muted px-1 rounded">aio_data</code> (parsed element columns).</li>
                  <li><strong>Download:</strong> Users download individual <code className="bg-muted px-1 rounded">.aio</code> files or a batch ZIP.</li>
                  <li><strong>Semantic Processing:</strong> The Hyper-Semantic Processor indexes all AIO elements and lets users click any value to find all AIOs that share it.</li>
                  <li><strong>HSL Formation:</strong> Create Hyper-Semantic Layer records that capture which AIOs share common element values, with provenance and timestamps.</li>
                  <li><strong>ChatAIO:</strong> Ask natural-language questions about your AIO data using Claude AI, with answers grounded in your stored records. Save and recall prompts across sessions.</li>
                  <li><strong>Saved Prompts:</strong> Bookmark frequently used ChatAIO queries for quick recall. Manage saved prompts via System Admin.</li>
                  <li><strong>R &amp; D — Compound HSL:</strong> Build multi-field AND queries by selecting field names from the Information Elements directory, picking values, and creating compound HSLs that match only AIOs containing ALL selected criteria.</li>
                  <li><strong>Information Elements:</strong> An auto-maintained directory of all unique field names across AIOs with occurrence counts. Powers the R &amp; D field picker and is manageable via System Admin.</li>
                  <li><strong>MRO Capture:</strong> Every ChatAIO response is automatically persisted as a Memory Result Object (MRO) — query, cue set, evidence bundle, and answer — and linked back to the matched HSLs as <code className="bg-muted px-1 rounded">[MRO.&lt;uuid&gt;]</code> element slots.</li>
                  <li><strong>MRO Reuse:</strong> On subsequent similar queries, Phase 3 of the search pipeline reads <code className="bg-muted px-1 rounded">[MRO.*]</code> refs from matched HSL slots, ranks prior MROs by Jaccard × freshness × confidence, and injects them as Tier-1 context — making the system progressively smarter with use.</li>
                  <li><strong>System Administration:</strong> Manage users, roles, AIO data, HSL data, MRO objects, information elements, saved prompts, and API keys through the admin panel.</li>
                </ol>
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
                <p>When the backend is online, the <strong>ChatAIO</strong> button opens a full-screen conversational interface with four search modes:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li><strong>Pure LLM (Control):</strong> Standard Claude prompt with the raw saved CSV files as context (up to 50 files, ~30 KB each). No AIO/HSL/MRO machinery. Use this to benchmark what a vanilla LLM does with the same data.</li>
                  <li><strong>Blind Dump AIO/HSL (Broad AIO/HSL Dump):</strong> Sends your question to Claude along with ALL stored AIO and HSL records as context (up to 500 records). Best for general exploratory questions.</li>
                  <li><strong>AIO Search (Search Algebra):</strong> A four-phase targeted search: (1) Claude parses your prompt to extract key terms, (2) searches the HSL library for matching records, (3) gathers only the AIOs referenced in those HSLs, (4) answers using only that focused subset. Falls back to direct AIO element search if no HSLs match.</li>
                  <li><strong>Substrate (Paper III Pipeline):</strong> Default. Deterministic cue extraction → HSL neighborhood traversal → Jaccard-ranked MRO pre-fetch → tiered bundle assembly → MRO capture. Self-improving over time.</li>
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

                <h4 className="text-foreground font-medium mt-4">Four Search Modes</h4>
                <div className="space-y-3 ml-2">
                  <div>
                    <p className="font-medium text-foreground">Pure LLM (Control Case) — <code className="bg-muted px-1 rounded">POST /api/op/pure-llm</code></p>
                    <ol className="list-decimal list-inside space-y-1 ml-2">
                      <li>User types a question and clicks <strong>Pure LLM</strong></li>
                      <li>Backend fetches up to 50 saved CSV files from <code className="bg-muted px-1 rounded">information_objects</code> where <code className="bg-muted px-1 rounded">type=&apos;CSV&apos;</code></li>
                      <li>Builds a vanilla system prompt — &quot;You are a helpful data analyst&quot; — with each CSV embedded as a fenced code block (capped at ~30 KB per file)</li>
                      <li>Sends to Claude with no AIO bracket notation, no HSL traversal, no MRO priors, no Information-Physics framing</li>
                    </ol>
                    <p className="mt-1">This is the <em>control case</em>. It demonstrates what Claude can do with the same source data and no AIO/HSL/MRO substrate. Use it to benchmark the lift the Information-Physics layers provide.</p>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Blind Dump AIO/HSL (Broad AIO/HSL Dump) — <code className="bg-muted px-1 rounded">POST /api/op/chat</code></p>
                    <ol className="list-decimal list-inside space-y-1 ml-2">
                      <li>User types a question and clicks <strong>Blind Dump AIO/HSL</strong></li>
                      <li>Backend fetches up to 500 AIO/HSL records from the database</li>
                      <li>Builds a system prompt with up to 300 AIO lines and 10 HSL blocks as context</li>
                      <li>Sends to Claude, which returns a contextual answer grounded in all available data</li>
                    </ol>
                    <p className="mt-1">Best for broad exploratory questions across all AIO/HSL data when no targeted filter is known yet. Slow and token-heavy.</p>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">AIO Search (Search Algebra) — <code className="bg-muted px-1 rounded">POST /api/op/aio-search</code></p>
                    <ol className="list-decimal list-inside space-y-1 ml-2">
                      <li><strong>Parse:</strong> Claude extracts structured search terms from the prompt guided by the Information Elements field vocabulary</li>
                      <li><strong>Match HSLs:</strong> Searches all HSL records for case-insensitive substring matches; returns matched HSL IDs</li>
                      <li><strong>Gather AIOs + MRO priors:</strong> Collects AIOs from matched HSLs; reads <code className="bg-muted px-1 rounded">[MRO.*]</code> slots from those HSLs and fetches ranked prior MROs</li>
                      <li><strong>Answer:</strong> Sends focused AIO subset + MRO priors to Claude; persists result as a new MRO; back-links MRO to matched HSLs</li>
                    </ol>
                    <p className="mt-1">Falls back to direct <code className="bg-muted px-1 rounded">ILIKE</code> search if no HSLs match. Response footer shows HSL/AIO/MRO match counts.</p>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Substrate Mode (Paper III Pipeline) — <code className="bg-muted px-1 rounded">POST /api/op/substrate-chat</code></p>
                    <ol className="list-decimal list-inside space-y-1 ml-2">
                      <li><strong>Cue extraction:</strong> Deterministic parse using field + value vocabulary from all stored AIOs</li>
                      <li><strong>HSL traversal N(K):</strong> Set-intersection of per-cue AIO sets via <code className="bg-muted px-1 rounded">find-by-needles</code>; bounded neighborhood of matching HSLs</li>
                      <li><strong>MRO pre-fetch:</strong> Jaccard(K_m, K) × freshness × confidence ranking of prior MROs from matched HSL slots</li>
                      <li><strong>Bundle assembly:</strong> Tiered context — MRO priors (Tier 1) → HSL context (Tier 2) → AIO evidence (Tier 3) → query</li>
                      <li><strong>MRO capture:</strong> Response persisted as MRO; UUID written as <code className="bg-muted px-1 rounded">[MRO.&lt;uuid&gt;]</code> into matched HSL element slots</li>
                    </ol>
                    <p className="mt-1">The substrate is self-improving — each query strengthens the retrieval graph for next time. See Section 11 for the full MRO reuse pipeline.</p>
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
            {activeSection === "sysadmin-workflow" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Settings className="w-5 h-5" />10. System Administration</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
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
                <h4 className="text-foreground font-medium mt-4">Settings</h4>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>API Key:</strong> Configure the Anthropic API key used by ChatAIO for LLM-powered queries.</li>
                  <li><strong>Role Management:</strong> Define roles and permissions via <code className="bg-muted px-1 rounded">/api/roles</code>.</li>
                </ul>
              </CardContent></Card>
            )}
            {activeSection === "mro-pipeline" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Brain className="w-5 h-5 text-violet-500" />11. MRO Reuse Pipeline — Self-Improving Retrieval</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>Every ChatAIO response is automatically persisted as a <strong>Memory Result Object (MRO)</strong>. MROs feed back into the retrieval pipeline so past successful answers become first-class context for future queries — replacing hand-curated Gold-tier curation with self-enriching episodic memory.</p>

                <h4 className="text-foreground font-medium mt-4">Step-by-step MRO lifecycle</h4>
                <ol className="list-decimal list-inside space-y-3">
                  <li>
                    <span className="font-semibold text-foreground">Capture</span> — after each ChatAIO response, a new MRO is written to the <code className="bg-muted px-1 rounded">mro_objects</code> table containing:
                    <ul className="list-disc list-inside ml-5 mt-1 space-y-1">
                      <li><code className="bg-muted px-1 rounded">query_text</code> — the original natural-language query</li>
                      <li><code className="bg-muted px-1 rounded">search_terms</code> — the extracted cue set K (JSONB)</li>
                      <li><code className="bg-muted px-1 rounded">context_bundle</code> — the serialised evidence sent to Claude</li>
                      <li><code className="bg-muted px-1 rounded">result_text</code> — Claude&apos;s answer</li>
                      <li><code className="bg-muted px-1 rounded">seed_hsls</code> — pipe-delimited HSL IDs that contributed</li>
                      <li><code className="bg-muted px-1 rounded">confidence</code> — initialised at 0.75</li>
                    </ul>
                  </li>
                  <li>
                    <span className="font-semibold text-foreground">HSL back-link</span> — the MRO&apos;s UUID is written as <code className="bg-muted px-1 rounded">[MRO.&lt;uuid&gt;]</code> into the next free element slot (<code className="bg-muted px-1 rounded">element_1…element_100</code>) of every matched HSL record via <code className="bg-muted px-1 rounded">POST /api/hsl-data/&lt;id&gt;/link-mro</code>
                  </li>
                  <li>
                    <span className="font-semibold text-foreground">Prior retrieval</span> — on the next query, when HSLs are traversed their element slots are scanned for <code className="bg-muted px-1 rounded">[MRO.*]</code> tokens; matching MROs are fetched and ranked:
                    <div className="p-3 rounded-lg bg-muted font-mono text-xs mt-2">
                      score = Jaccard(K_m, K) × exp(−λ · age_days) × confidence_m
                    </div>
                  </li>
                  <li>
                    <span className="font-semibold text-foreground">Tier-1 injection</span> — top-N MRO priors are placed at the head of the context bundle, above raw AIO evidence, so Claude sees prior findings first
                  </li>
                  <li>
                    <span className="font-semibold text-foreground">Compound growth</span> — each new query adds another MRO, enriching the HSL element slots further; the retrieval graph self-curates through use
                  </li>
                </ol>

                <h4 className="text-foreground font-medium mt-4">Two back-linking paths</h4>
                <div className="space-y-2 ml-2">
                  <div>
                    <p className="font-medium text-foreground">AIO Search mode</p>
                    <p>Matched HSL IDs are returned directly by the search endpoint (<code className="bg-muted px-1 rounded">matched_hsl_ids</code>). The MRO is created then <code className="bg-muted px-1 rounded">linkMroToHsl()</code> is called for each ID immediately.</p>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Substrate (Precomputed) mode</p>
                    <p>After MRO creation, <code className="bg-muted px-1 rounded">findHslsByNeedles(cueValues)</code> identifies matching HSLs by scanning HSL names for cue strings, then back-links the MRO to each result.</p>
                  </div>
                </div>

                <div className="flex items-start gap-2 p-3 bg-violet-500/10 rounded-lg border border-violet-500/20 mt-4">
                  <GitMerge className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
                  <p className="text-xs leading-relaxed">
                    <span className="font-semibold text-violet-400">Net result:</span> the system improves with every query. Topics asked frequently accumulate richer MRO priors, producing more consistent, evidence-grounded answers over time — with full provenance and zero manual curation.
                  </p>
                </div>
              </CardContent></Card>
            )}

            {activeSection === "structure-models" && (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Binary className="w-5 h-5" />AIO / HSL / MRO Structure Models</CardTitle></CardHeader><CardContent className="space-y-6 text-sm text-muted-foreground leading-relaxed">
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
                  <h5 className="text-foreground font-medium mt-3">MRO back-link slots</h5>
                  <p>Elements 51–100 of an HSL record are reserved for MRO back-links written by the pipeline. Each slot holds a token like <code className="bg-muted px-1 rounded">[MRO.abee76dc-db64-4b…]</code>. On retrieval, Phase 3 scans these slots and fetches the referenced MRO objects for Jaccard-ranked prior injection.</p>
                </div>

                <div className="border-t border-border pt-6">
                  <h4 className="text-foreground font-semibold text-base mb-3">MRO — Memory Result Object</h4>
                  <h5 className="text-foreground font-medium mt-3">Purpose</h5>
                  <p>An MRO is a persisted retrieval episode — the record of a complete query–evidence–answer cycle. It functions as the self-curating Gold tier of the AIO/HSL/MRO stack, improving future retrieval without any manual curation.</p>
                  <h5 className="text-foreground font-medium mt-3">Database Representation (mro_objects table)</h5>
                  <div className="overflow-x-auto mt-2">
                    <table className="w-full text-xs font-mono border-collapse">
                      <thead><tr className="bg-muted"><th className="border border-border px-2 py-1 text-left">Column</th><th className="border border-border px-2 py-1 text-left">Type</th><th className="border border-border px-2 py-1 text-left">Description</th></tr></thead>
                      <tbody>
                        <tr><td className="border border-border px-2 py-1">mro_id</td><td className="border border-border px-2 py-1">uuid</td><td className="border border-border px-2 py-1">Primary key (auto-generated)</td></tr>
                        <tr><td className="border border-border px-2 py-1">mro_key</td><td className="border border-border px-2 py-1">text</td><td className="border border-border px-2 py-1">Human key: mro-{"{timestamp}"}-{"{rand}"}</td></tr>
                        <tr><td className="border border-border px-2 py-1">query_text</td><td className="border border-border px-2 py-1">text</td><td className="border border-border px-2 py-1">Original natural-language query</td></tr>
                        <tr><td className="border border-border px-2 py-1">intent</td><td className="border border-border px-2 py-1">text</td><td className="border border-border px-2 py-1">Detected intent / mode label</td></tr>
                        <tr><td className="border border-border px-2 py-1">search_terms</td><td className="border border-border px-2 py-1">jsonb</td><td className="border border-border px-2 py-1">Extracted cue set K — array of [Key.Value] pairs</td></tr>
                        <tr><td className="border border-border px-2 py-1">seed_hsls</td><td className="border border-border px-2 py-1">text</td><td className="border border-border px-2 py-1">Pipe-delimited HSL IDs that contributed</td></tr>
                        <tr><td className="border border-border px-2 py-1">matched_aios_count</td><td className="border border-border px-2 py-1">int</td><td className="border border-border px-2 py-1">Number of AIOs in the context bundle</td></tr>
                        <tr><td className="border border-border px-2 py-1">context_bundle</td><td className="border border-border px-2 py-1">text</td><td className="border border-border px-2 py-1">Serialised evidence sent to Claude (newline-delimited)</td></tr>
                        <tr><td className="border border-border px-2 py-1">result_text</td><td className="border border-border px-2 py-1">text</td><td className="border border-border px-2 py-1">Claude&apos;s full response</td></tr>
                        <tr><td className="border border-border px-2 py-1">confidence</td><td className="border border-border px-2 py-1">text</td><td className="border border-border px-2 py-1">Retrieval confidence score (0.0–1.0); init 0.75</td></tr>
                        <tr><td className="border border-border px-2 py-1">policy_scope</td><td className="border border-border px-2 py-1">text</td><td className="border border-border px-2 py-1">Tenant / access scope label</td></tr>
                        <tr><td className="border border-border px-2 py-1">created_at</td><td className="border border-border px-2 py-1">timestamptz</td><td className="border border-border px-2 py-1">Capture time (used for freshness decay)</td></tr>
                      </tbody>
                    </table>
                  </div>
                  <h5 className="text-foreground font-medium mt-3">Ranking formula</h5>
                  <div className="p-3 rounded-lg bg-muted font-mono text-xs mt-2">
                    score(m) = Jaccard(K_m, K) × exp(−λ · age_days) × confidence_m
                  </div>
                  <p className="text-xs mt-1">Where K_m = cue set of prior MRO m, K = current query cues, λ = freshness decay constant (default 0.05), age_days = days since MRO was captured.</p>
                </div>
              </CardContent></Card>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
