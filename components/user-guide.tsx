"use client"

import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, BookOpen, FileText, Upload, Download, Cpu, Layers, Database, Zap, ChevronRight, Brain, GitMerge, Network } from "lucide-react"

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
            AIO/HSL/MRO Demo System V4.2 adds the R &amp; D Compound HSL Builder and Information Elements tracking to the production platform. It converts CSV data into Associated Information Objects (AIOs),
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
            <Brain className="w-5 h-5 text-violet-500" />
            Step 7: MRO Reuse Model — Self-Improving Retrieval
          </h2>
          <Card>
            <CardContent className="pt-6 space-y-4">
              <p className="leading-relaxed">
                Every ChatAIO response is automatically persisted as a <span className="font-semibold">Memory Result Object (MRO)</span> — a structured record of the query, the evidence used, and the answer produced. MROs feed back into the retrieval pipeline so that past successful answers become first-class context for future queries.
              </p>

              <h3 className="font-semibold text-lg">How It Works</h3>
              <ol className="list-decimal list-inside space-y-3 text-muted-foreground ml-1">
                <li>
                  <span className="font-semibold text-foreground">MRO Capture:</span> After each ChatAIO response, the system saves a new MRO containing the query text, the cue set (extracted search terms), the context bundle used, and the reply. Confidence is initialized at 0.75.
                </li>
                <li>
                  <span className="font-semibold text-foreground">HSL Back-Linking:</span> The new MRO&apos;s UUID is written into the element slots of every matched HSL as <span className="font-mono text-xs bg-muted px-1 rounded">[MRO.&lt;uuid&gt;]</span>. This permanently wires the retrieval episode into the semantic layer.
                </li>
                <li>
                  <span className="font-semibold text-foreground">Prior Retrieval:</span> On the next query, when an HSL is traversed its element slots are scanned for <span className="font-mono text-xs bg-muted px-1 rounded">[MRO.*]</span> references. Matching MROs are fetched from the database and ranked by <span className="font-semibold text-foreground">Jaccard similarity × freshness × confidence</span>.
                </li>
                <li>
                  <span className="font-semibold text-foreground">Tier-1 Context Injection:</span> The top-ranked MRO priors are placed at the front of the context bundle — above raw AIO evidence — so Claude sees prior findings before raw data, producing more consistent and accurate answers.
                </li>
              </ol>

              <div className="flex items-start gap-3 p-3 bg-violet-500/10 rounded-lg border border-violet-500/20">
                <GitMerge className="w-5 h-5 text-violet-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">Substrate Mode (Precomputed Substrate)</p>
                  <p className="text-sm text-muted-foreground">
                    Enable <span className="font-semibold text-foreground">Precomputed Substrate</span> in ChatAIO to run the full Paper-III pipeline: cue extraction → HSL neighborhood traversal N(K) → MRO prior ranking → bundle assembly → response capture. This mode uses only the assembled substrate bundle as context — no raw DB dump — and produces the most focused, evidence-grounded answers.
                  </p>
                </div>
              </div>

              <h3 className="font-semibold text-lg">Two MRO Sources</h3>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li><span className="font-semibold text-foreground">AIO Search mode:</span> MRO is created from the matched HSL IDs and linked back to those exact HSLs immediately after the response.</li>
                <li><span className="font-semibold text-foreground">Substrate (Precomputed) mode:</span> After MRO creation, <span className="font-mono text-xs bg-muted px-1 rounded">find-by-needles</span> locates all HSLs whose names match the extracted cue values, then links the MRO to each one.</li>
              </ul>

              <div className="flex items-start gap-2 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
                <Zap className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">Result: the system gets smarter with use</p>
                  <p className="text-sm text-muted-foreground">
                    Each query that runs strengthens the retrieval graph. Repeated queries on similar topics surface progressively richer prior context, reducing hallucination and improving answer consistency over time without any manual curation.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Network className="w-5 h-5 text-violet-500" />
            Topology Reference: Vance HSL → AIO → MRO String
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            The diagram below shows a real traversal from the production corpus — query <span className="font-mono text-xs bg-muted px-1 rounded">"Laura Vance"</span> → cue extraction → 20 matched HSLs → gathered AIO records → MRO capture → back-links written into HSL element slots. The orange dashed lines are the <span className="font-semibold text-foreground">"string"</span> — the MRO&apos;s UUID written as <span className="font-mono text-xs bg-muted px-1 rounded">[MRO.abee76dc]</span> into each matched HSL, creating a permanent retrieval thread for future queries.
          </p>
          <Card className="overflow-hidden p-0">
            <CardContent className="p-0">
              <div className="w-full overflow-x-auto bg-[#0f172a] rounded-lg">
                <img
                  src="/vance-topology.svg"
                  alt="Vance HSL–AIO–MRO topology diagram showing query traversal, HSL neighborhood, AIO nodes, and MRO back-links"
                  className="w-full min-w-[900px]"
                  style={{ display: "block" }}
                />
              </div>
            </CardContent>
          </Card>
          <div className="flex items-start gap-2 p-3 bg-violet-500/10 rounded-lg border border-violet-500/20">
            <Network className="w-5 h-5 text-violet-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">Reading the diagram</p>
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-indigo-400">Blue/indigo nodes</span> = HSL records. <span className="font-semibold text-teal-400">Teal nodes</span> = Contact/Lead AIOs. <span className="font-semibold text-amber-400">Amber nodes</span> = Project AIOs. <span className="font-semibold text-violet-400">Violet node</span> = the captured MRO. <span className="font-semibold text-orange-400">Orange dashed lines</span> = MRO back-links written into HSL slots — these are the "strings" that make the next query over the same HSLs surface this MRO as Tier-1 context.
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Database className="w-5 h-5 text-primary" />
            Step 8: System Administration
          </h2>
          <Card>
            <CardContent className="pt-6 space-y-3">
              <p className="leading-relaxed">The System Admin panel provides full CRUD management of users, roles, AIO data, and HSL data stored in the backend database.</p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li>Manage user accounts and role assignments</li>
                <li>Browse, search, and view all stored AIO records</li>
                <li>View and manage HSL relationship data</li>
                <li>Configure API keys for ChatAIO integration</li>
                <li>View raw CSV data stored in the database</li>
              </ul>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" />
            Step 9: R &amp; D — Compound HSL Builder
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
            Step 10: Information Elements
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
          <h2 className="text-2xl font-bold">Glossary</h2>
          <div className="grid gap-3">
            {[
              { term: "AIO", definition: "Associated Information Object - a self-contained semantic data unit" },
              { term: "ChatAIO", definition: "AI-powered conversational interface for querying AIO data using natural language" },
              { term: "Semantic Triple", definition: "A Subject-Predicate-Object statement that forms the basis of linked data" },
              { term: "Element", definition: "A key-value pair within an AIO representing a single data attribute" },
              { term: "Hyper-Semantic Logic", definition: "The processing engine that analyzes cross-references between AIOs" },
              { term: "HSL File", definition: "Hyper-Semantic Layer file - a structured record of AIO relationships sharing a common element value, including provenance and timestamps" },
              { term: "Compound HSL", definition: "An HSL built from multiple field values using AND logic - only AIOs matching ALL selected values are included" },
              { term: "Information Elements", definition: "A directory of all unique field names found across AIOs, with counts of how many AIOs contain each field" },
              { term: "CSV", definition: "Comma-Separated Values - the input format for data conversion" },
              { term: "MRO", definition: "Memory Result Object — a persisted record of a ChatAIO retrieval episode, containing the query, cue set, context bundle, and answer. MROs are linked back into HSLs and reused as Tier-1 prior context in future queries." },
              { term: "Substrate Mode", definition: "Precomputed Substrate — ChatAIO mode that runs the full Paper-III pipeline: cue extraction → HSL traversal → MRO prior ranking → bundle assembly. Produces the most focused, evidence-grounded answers." },
              { term: "MRO Priors", definition: "Previously saved MROs that are surfaced during retrieval by Jaccard similarity × freshness × confidence scoring, then injected as highest-priority context above raw AIO evidence." },
              { term: "Cue Set", definition: "The set of [Key.Value] pairs extracted from a natural-language query and used to traverse the HSL neighborhood N(K) for relevant AIOs." },
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
