"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, BookOpen, FileText, Upload, Download, Cpu, Layers, Database, Zap, ChevronRight } from "lucide-react"

interface UserGuideProps {
  onBack: () => void
}

export function UserGuide({ onBack }: UserGuideProps) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-primary" />
              <h1 className="text-xl font-bold">User Guide</h1>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl space-y-8">
        <section className="space-y-4">
          <h2 className="text-2xl font-bold">Getting Started</h2>
          <p className="text-muted-foreground leading-relaxed">
            AIO Generator V3.1 adds the R &amp; D Compound HSL Builder and Information Elements tracking to the production platform. It converts CSV data into Associated Information Objects (AIOs),
            stores them in a dedicated PostgreSQL database, and provides semantic search, ChatAIO (AI-powered Q&amp;A via Claude), HSL relationship tracking,
            compound multi-field HSL queries, an Information Elements directory, saved prompts for recurring queries, and full system administration — all deployed as a self-contained production service.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Upload className="w-5 h-5 text-primary" />
            Step 1: Upload CSV Files
          </h2>
          <Card>
            <CardContent className="pt-6 space-y-3">
              <p className="leading-relaxed">Upload one or more CSV files using the drag-and-drop area or file browser. The converter accepts standard CSV format with headers in the first row.</p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li>Supported format: .csv files with comma-separated values</li>
                <li>First row must contain column headers</li>
                <li>Multiple files can be uploaded simultaneously</li>
                <li>Each row in the CSV will become a separate AIO file</li>
              </ul>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary" />
            Step 2: Review Conversion Preview
          </h2>
          <Card>
            <CardContent className="pt-6 space-y-3">
              <p className="leading-relaxed">After upload, you will see a preview of how your CSV data will be converted into AIO format. Each row becomes an AIO with semantic triple elements.</p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li>Preview shows the AIO structure for each CSV row</li>
                <li>Each column becomes a semantic element with key-value pairs</li>
                <li>Elements follow the Subject-Predicate-Object triple pattern</li>
                <li>You can download individual AIO files or all at once</li>
              </ul>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Download className="w-5 h-5 text-primary" />
            Step 3: Download AIO Files
          </h2>
          <Card>
            <CardContent className="pt-6 space-y-3">
              <p className="leading-relaxed">Download your converted AIO files individually or as a batch. Each AIO file contains the semantic representation of one CSV row.</p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li>Click individual download buttons for specific AIO files</li>
                <li>Use &quot;Download All&quot; for batch download</li>
                <li>Files are saved in .aio text format</li>
                <li>AIO files can be processed further via the semantic processor</li>
              </ul>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" />
            Step 4: Process via Hyper-Semantic Logic
          </h2>
          <Card>
            <CardContent className="pt-6 space-y-3">
              <p className="leading-relaxed">After downloading AIO files, use the Hyper-Semantic Logic processor to analyze relationships between your data objects.</p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li>Click &quot;Process AIO Files via Hyper-Semantic Logic&quot; to begin</li>
                <li>The processor parses all AIO elements and indexes them</li>
                <li>Click any element to find all AIOs containing matching values</li>
                <li>Discover hidden connections across your dataset</li>
              </ul>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="w-5 h-5 text-amber-600" />
            Step 5: Create Hyper-Semantic Layer (HSL) Files
          </h2>
          <Card>
            <CardContent className="pt-6 space-y-3">
              <p className="leading-relaxed">After selecting an element in the Semantic Processor and viewing matching AIOs, you can create an HSL file to capture and persist those relationships as a structured record.</p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li>In the Matching AIOs pane, click the <span className="font-semibold text-foreground">&quot;Create/Append HSL&quot;</span> button</li>
                <li>An HSL file is generated containing a table of all matching AIOs for the selected element value</li>
                <li>Each row records the AIO name, the root name of the source CSV, the line number from that CSV, and the date/time the HSL was created</li>
                <li>The HSL file is named after the element key (e.g., <span className="font-mono text-xs bg-muted px-1 rounded">Department.hsl</span>)</li>
                <li>A new pane opens displaying the HSL content in a readable table format</li>
                <li>Click <span className="font-semibold text-foreground">&quot;Download HSL&quot;</span> to save the file to your default download folder</li>
              </ul>
              <div className="flex items-start gap-2 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
                <Layers className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">What is an HSL File?</p>
                  <p className="text-sm text-muted-foreground">
                    An HSL (Hyper-Semantic Layer) file records the connective &quot;strings&quot; between AIOs that share a common
                    element value. It serves as an auditable, portable record of discovered relationships -- capturing
                    which AIOs are linked, where they originated, and when the link was established.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Database className="w-5 h-5 text-primary" />
            Understanding AIO Format
          </h2>
          <Card>
            <CardContent className="pt-6 space-y-4">
              <p className="leading-relaxed">
                An Atomic Information Object (AIO) is a self-contained unit of structured data based on semantic triples.
                Each AIO contains elements that follow the Subject-Predicate-Object pattern from RDF and linked data principles.
              </p>
              <div className="bg-muted rounded-lg p-4 font-mono text-sm space-y-1">
                <p className="text-muted-foreground">{"// Example AIO structure"}</p>
                <p>{"AIO_0001"}</p>
                <p>{"  Element: Name = \"John Smith\""}</p>
                <p>{"  Element: Age = \"42\""}</p>
                <p>{"  Element: Department = \"Engineering\""}</p>
                <p>{"  Element: Role = \"Senior Developer\""}</p>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                This format enables precise semantic querying, cross-referencing between data objects,
                and integration with knowledge graph systems.
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Cpu className="w-5 h-5 text-primary" />
            Semantic Processing
          </h2>
          <Card>
            <CardContent className="pt-6 space-y-3">
              <p className="leading-relaxed">
                The semantic processor allows you to explore relationships across all your AIO files.
                By clicking on any element value, you can instantly find all other AIOs that share that same value.
              </p>
              <div className="flex items-start gap-2 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
                <Zap className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">Pro Tip</p>
                  <p className="text-sm text-muted-foreground">
                    Use the semantic processor to discover non-obvious relationships in your data.
                    For example, finding all people in the same department or all records sharing a common attribute.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Cpu className="w-5 h-5 text-primary" />
            Step 6: ChatAIO — AI-Powered Q&amp;A
          </h2>
          <Card>
            <CardContent className="pt-6 space-y-3">
              <p className="leading-relaxed">ChatAIO is a full-screen AI-powered conversational interface for querying your AIO and HSL data using natural language. It uses Claude AI to analyze your data and answer questions with contextual, data-grounded responses.</p>

              <h3 className="font-semibold text-lg mt-4">Getting Started</h3>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li>Click <span className="font-semibold text-foreground">&quot;ChatAIO&quot;</span> from the home screen (requires backend connection and Anthropic API key)</li>
                <li>The full-screen dialog opens with suggested starter questions</li>
                <li>Type your question in the input field at the bottom</li>
              </ul>

              <h3 className="font-semibold text-lg mt-4">Two Search Modes</h3>
              <p className="leading-relaxed text-muted-foreground"><span className="font-semibold text-foreground">Send (broad search):</span> Sends your question to Claude along with ALL stored AIO and HSL records as context (up to 500 records). Best for general questions like &quot;What vendors are in this data?&quot; or &quot;Total invoice amount by vendor.&quot;</p>
              <p className="leading-relaxed text-muted-foreground"><span className="font-semibold text-foreground">AIO Search (targeted algebra):</span> Uses a four-phase search algebra for focused answers:</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground ml-4">
                <li><span className="font-semibold text-foreground">Parse:</span> Claude extracts key search terms from your prompt (names, projects, dates, etc.)</li>
                <li><span className="font-semibold text-foreground">Match HSLs:</span> Searches the HSL library for records containing those terms</li>
                <li><span className="font-semibold text-foreground">Gather AIOs:</span> Collects only the AIOs referenced in matching HSLs</li>
                <li><span className="font-semibold text-foreground">Answer:</span> Responds using ONLY the focused AIO subset</li>
              </ol>
              <p className="leading-relaxed text-muted-foreground">If no HSLs match, AIO Search falls back to direct element-level search across all AIOs. The response footer shows how many HSLs and AIOs were matched.</p>

              <h3 className="font-semibold text-lg mt-4">Saved Prompts (Remember Prompts)</h3>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li>Click the <span className="font-semibold text-foreground">bookmark icon</span> next to the history icon to save the current prompt</li>
                <li>Choose <span className="font-semibold text-foreground">&quot;Current Session&quot;</span> to keep the prompt for this session only, or <span className="font-semibold text-foreground">&quot;Save to Database&quot;</span> to persist it across sessions</li>
                <li>Database-saved prompts are stored in PostgreSQL and available in future sessions</li>
                <li>Click the <span className="font-semibold text-foreground">history icon</span> to browse and reuse previous prompts from both current session and saved database prompts</li>
                <li>Manage saved prompts via <span className="font-semibold text-foreground">System Admin → Saved Prompts</span> tab</li>
              </ul>

              <h3 className="font-semibold text-lg mt-4">Header Toolbar</h3>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li><span className="font-semibold text-foreground">Chat:</span> Download the full chat session as a Markdown file</li>
                <li><span className="font-semibold text-foreground">PDF:</span> Generate and preview a PDF report of the conversation with print/save options</li>
                <li><span className="font-semibold text-foreground">Guide:</span> Open this ChatAIO user guide section</li>
                <li><span className="font-semibold text-foreground">Close:</span> Close the ChatAIO dialog and return to the home page</li>
              </ul>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Database className="w-5 h-5 text-primary" />
            Step 7: System Administration
          </h2>
          <Card>
            <CardContent className="pt-6 space-y-3">
              <p className="leading-relaxed">The System Admin panel provides full CRUD management of all data and configuration stored in the backend database.</p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li><span className="font-semibold text-foreground">Users &amp; Roles:</span> Manage user accounts and role assignments</li>
                <li><span className="font-semibold text-foreground">AIO Data:</span> Browse, search, and view all stored AIO records</li>
                <li><span className="font-semibold text-foreground">HSL Data:</span> View and manage HSL relationship data</li>
                <li><span className="font-semibold text-foreground">API Key:</span> Configure Anthropic API keys for ChatAIO</li>
                <li><span className="font-semibold text-foreground">Saved CSVs &amp; AIOs:</span> View raw CSV and AIO data stored in the database</li>
                <li><span className="font-semibold text-foreground">Saved Prompts:</span> Manage persistent ChatAIO prompts</li>
                <li><span className="font-semibold text-foreground">Info Elements:</span> Browse field names, view all data values (eye icon), rebuild from AIOs</li>
                <li><span className="font-semibold text-foreground">Architecture:</span> Interactive SVG diagram of the full AIO/HSL/MRO system architecture</li>
              </ul>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" />
            Step 8: R &amp; D — Compound HSL Builder
          </h2>
          <Card>
            <CardContent className="pt-6 space-y-3">
              <p className="leading-relaxed">The R &amp; D tab lets you build compound HSL queries by selecting multiple field values across different categories, using AND logic to find AIOs that match ALL selected criteria.</p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li><span className="font-semibold text-foreground">Pane 1 — Field Names:</span> Browse all unique field names from the Information Elements table (e.g., Employee, Job, Status). Each shows how many AIOs contain it.</li>
                <li><span className="font-semibold text-foreground">Pane 2 — Values:</span> When you select a field name, all unique data values for that field appear with occurrence counts. Click a value to add it to your query.</li>
                <li><span className="font-semibold text-foreground">Pane 3 — Compound Query:</span> Your AND query builds here. Pick another field name, select another value — keep building. Each entry shows the field, value, and count.</li>
                <li>With 2+ fields selected, click <span className="font-semibold text-foreground">&quot;Create Compound HSL&quot;</span> to generate an HSL containing only AIOs matching ALL selected values</li>
                <li>The HSL file format shows: <span className="font-mono text-xs bg-muted px-1 rounded">Query: [Field1.Val1] AND [Field2.Val2]</span></li>
                <li>Use <span className="font-semibold text-foreground">&quot;View Compound HSL&quot;</span> to see the full file, and <span className="font-semibold text-foreground">&quot;View Details&quot;</span> on any matching AIO to inspect its elements</li>
              </ul>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Database className="w-5 h-5 text-primary" />
            Step 9: Information Elements
          </h2>
          <Card>
            <CardContent className="pt-6 space-y-3">
              <p className="leading-relaxed">The Information Elements table automatically tracks all unique field names (e.g., Employee, Department, Job) found across your AIOs, along with how many AIOs contain each field.</p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li>Managed in <span className="font-semibold text-foreground">System Admin &gt; Info Elements</span> tab</li>
                <li>Click <span className="font-semibold text-foreground">&quot;Rebuild from AIOs&quot;</span> to scan all stored AIOs and populate/refresh the table</li>
                <li>New AIOs automatically update the table when created</li>
                <li>Full CRUD: add, edit, or delete element entries manually</li>
                <li>The R &amp; D Compound HSL Builder uses this table as its field name pick list</li>
              </ul>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="w-5 h-5 text-purple-600" />
            Step 10: Memory Result Objects (MROs)
          </h2>
          <Card>
            <CardContent className="pt-6 space-y-3">
              <p className="leading-relaxed">MROs are the episodic memory layer of the Information Physics model. When you perform an AIO Search in ChatAIO, the query, matched HSLs, matched AIOs, and AI-generated answer can be saved as a persistent Memory Result Object.</p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li>Click <span className="font-semibold text-foreground">&quot;Save MRO&quot;</span> in ChatAIO after an AIO Search response</li>
                <li>The MRO is constructed with <span className="font-mono text-xs bg-muted px-1 rounded">[MROKey.HSL-n-AIO-m]</span> linking it to the HSLs and AIOs that produced the result</li>
                <li>MRO structure: <span className="font-mono text-xs bg-muted px-1 rounded">MRO = &#x27E8; Q, S, C, O, R, P, L &#x27E9;</span> (Query, SearchTerms, Context, Output, References, Provenance, Links)</li>
                <li>View saved MROs via <span className="font-semibold text-foreground">&quot;View MROs&quot;</span> button in ChatAIO</li>
                <li>MROs create a recursive memory loop: past query results inform future searches</li>
              </ul>
              <div className="flex items-start gap-2 p-3 bg-purple-500/10 rounded-lg border border-purple-500/20">
                <Layers className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">Three-Layer Hierarchy</p>
                  <p className="text-sm text-muted-foreground">
                    AIOs (Layer 1: Observation) capture raw data. HSLs provide relational topology between AIOs.
                    MROs (Layer 2: Recollection) capture the results of intelligent queries — forming episodic memory
                    that grows with each interaction.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Step 11: PDF Import
          </h2>
          <Card>
            <CardContent className="pt-6 space-y-3">
              <p className="leading-relaxed">Import PDF documents (invoices, reports) and extract structured data using Claude AI. The extracted data is converted to CSV format for AIO generation.</p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li>Click <span className="font-semibold text-foreground">&quot;Import PDFs → CSVs&quot;</span> on the main page</li>
                <li>Upload one or more PDF files</li>
                <li>Claude AI analyzes each page, extracting structured fields (vendor, amount, date, line items, etc.)</li>
                <li>Results are presented as CSV data you can view and save</li>
                <li>Saved CSVs can then be loaded into the AIO converter</li>
              </ul>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Database className="w-5 h-5 text-primary" />
            Step 12: Architecture Diagram
          </h2>
          <Card>
            <CardContent className="pt-6 space-y-3">
              <p className="leading-relaxed">A complete interactive architecture diagram is available in <span className="font-semibold text-foreground">System Admin → Architecture</span> tab, showing the full AIO/HSL/MRO pipeline from data sources through episodic memory, including all database tables, API endpoints, and the recursive memory loop.</p>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold">Glossary</h2>
          <div className="grid gap-3">
            {[
              { term: "AIO", definition: "Associated Information Object - a self-contained semantic data unit (Layer 1: Observation)" },
              { term: "HSL", definition: "Hyper-Semantic Layer - relational topology linking AIOs that share common element values" },
              { term: "MRO", definition: "Memory Result Object - episodic memory capturing query results with provenance (Layer 2: Recollection)" },
              { term: "SKO", definition: "Structured Knowledge Object - governed abstraction from MRO convergence (Layer 3: Future)" },
              { term: "ChatAIO", definition: "AI-powered conversational interface for querying AIO data using natural language via Send or AIO Search" },
              { term: "AIO Search", definition: "Four-phase search algebra: Parse → Match HSLs → Gather AIOs → Answer with focused context" },
              { term: "Compound HSL", definition: "An HSL built from multiple field values using AND logic - only AIOs matching ALL selected values are included" },
              { term: "Information Elements", definition: "A directory of all unique field names found across AIOs, with counts and data value browsing" },
              { term: "Saved Prompts", definition: "Persistent prompt memory stored in PostgreSQL for reuse across sessions" },
              { term: "CSV", definition: "Comma-Separated Values - the input format for data conversion" },
              { term: "PDF Import", definition: "Claude AI-powered extraction of structured data from PDF documents into CSV format" },
            ].map((item) => (
              <Card key={item.term}>
                <CardContent className="py-3 px-4 flex items-start gap-3">
                  <ChevronRight className="w-4 h-4 text-primary shrink-0 mt-1" />
                  <div>
                    <span className="font-semibold">{item.term}</span>
                    <span className="text-muted-foreground"> - {item.definition}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
