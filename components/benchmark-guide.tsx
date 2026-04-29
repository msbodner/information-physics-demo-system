"use client"

/**
 * components/benchmark-guide.tsx
 *
 * Full-screen reference card explaining what each saved benchmark is
 * for, which retrieval characteristic it stresses, and which ChatAIO
 * mode is the most useful one to run it in. Mounted from the R&D
 * header next to the Benchmark dropdown.
 */

import { useEffect } from "react"
import { ArrowLeft, BookOpen, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BENCHMARKS } from "@/lib/benchmarks"

interface GuideRow {
  id: string
  bestMode: string
  whatYouLearn: string
}

// Mode + "what you learn" recommendations are intentionally hard-coded
// here rather than living on each Benchmark object, because they're
// human-curated guidance rather than data the runtime needs.
const GUIDE: Record<string, GuideRow> = {
  benchmark1:  { id: "benchmark1",  bestMode: "Recall, then Live",      whatYouLearn: "Multi-CSV diversity cap; Jaccard dedup behavior" },
  benchmark2:  { id: "benchmark2",  bestMode: "Recall (MRO short-circuits after first run)", whatYouLearn: "Person-cue HSL fan-out, name fuzzy match" },
  benchmark3:  { id: "benchmark3",  bestMode: "Recall, then Live",      whatYouLearn: "Cross-CSV financial rollup; Jaccard dedup of the same project across CSVs" },
  benchmark4:  { id: "benchmark4",  bestMode: "Recall",                 whatYouLearn: "Person cue across 6 fields × 4 CSVs; role-disambiguation aggregation" },
  benchmark5:  { id: "benchmark5",  bestMode: "Live or Broad",          whatYouLearn: "Comma-list HSL value handling; strict-filter compliance ('drop, don't annotate')" },
  benchmark6:  { id: "benchmark6",  bestMode: "Recall",                 whatYouLearn: "3-hop traversal (vendor → projects → submittals); indirect-link discovery" },
  benchmark7:  { id: "benchmark7",  bestMode: "Recall, post-mig-031",   whatYouLearn: "Trigram similarity threshold tuning; typo / declension / case-shift tolerance" },
  benchmark8:  { id: "benchmark8",  bestMode: "Broad (heavy aggregation)", whatYouLearn: "Token cost vs. answer completeness on full-portfolio queries" },
  benchmark9:  { id: "benchmark9",  bestMode: "Live",                   whatYouLearn: "Absence detection; gap-reporting honesty (no fabrication)" },
  benchmark10: { id: "benchmark10", bestMode: "Recall",                 whatYouLearn: "Multi-record narrative reasoning; cross-record Title overlap" },
}

export function BenchmarkGuide({ onClose }: { onClose: () => void }) {
  // Lock body scroll while overlay is mounted — same pattern as the
  // EmbeddedDocViewer in System Management.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = prev }
  }, [])

  return (
    <div className="fixed inset-0 z-50 bg-background overflow-auto print:static print:overflow-visible">
      <header className="border-b border-border bg-card sticky top-0 z-10 print:hidden">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onClose} className="gap-2">
            <ArrowLeft className="w-4 h-4" />Back
          </Button>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2 flex-1">
            <BookOpen className="w-5 h-5" />Benchmark Guide
          </h1>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-2">
            <Printer className="w-4 h-4" />Print / Save as PDF
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        <section>
          <h2 className="text-xl font-bold text-foreground mb-2">Saved Benchmark Catalog</h2>
          <p className="text-sm text-muted-foreground">
            Each benchmark is a deterministic, hand-graded prompt against the current corpus. Pick one from the
            R&amp;D &rarr; <strong>Benchmark</strong> dropdown to run it through all four ChatAIO modes
            (Recall, Live, Broad, Raw) side-by-side and capture token / latency / answer comparisons.
          </p>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-foreground mb-3">How to use these</h3>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground border-b border-border">Benchmark</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground border-b border-border">Best mode to run</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground border-b border-border">What you&rsquo;ll learn</th>
                </tr>
              </thead>
              <tbody>
                {BENCHMARKS.map((bm, i) => {
                  const g = GUIDE[bm.id]
                  return (
                    <tr key={bm.id} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                      <td className="px-3 py-2 align-top border-b border-border">
                        <div className="font-medium text-foreground">{bm.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{bm.description}</div>
                      </td>
                      <td className="px-3 py-2 align-top border-b border-border text-foreground whitespace-nowrap">{g?.bestMode ?? "—"}</td>
                      <td className="px-3 py-2 align-top border-b border-border text-foreground">{g?.whatYouLearn ?? "—"}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-foreground mb-2">Reading the results</h3>
          <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
            <li>
              <strong className="text-foreground">Side-by-side metrics</strong> — every benchmark run records
              latency / input tokens / output tokens / context records for each of the four modes. Lower
              token counts at equal answer quality &rArr; the retrieval is doing more of the work.
            </li>
            <li>
              <strong className="text-foreground">Citation density</strong> — Recall and Live should cite
              exact AIO row names (e.g. <code className="bg-muted px-1 rounded text-xs">acc_rfis.csv - Row 162</code>).
              Broad cites often. Raw fabricates citations or skips them &mdash; treat that as a tell.
            </li>
            <li>
              <strong className="text-foreground">Filter compliance</strong> — Benchmarks 1, 3, 5, 8, 9 have
              strict &ldquo;drop non-matching, don&rsquo;t annotate&rdquo; instructions. A reply that lists
              non-matching items with rejection marks (red X, &ldquo;does not match&rdquo;) failed the rule.
            </li>
            <li>
              <strong className="text-foreground">Absence honesty</strong> — Benchmark 9 specifically tests
              whether the model will say &ldquo;no records&rdquo; when the data is genuinely missing, vs.
              fabricating an entry. A clean &ldquo;No records in this category &mdash; clean&rdquo; reply is
              the right answer for any empty bucket.
            </li>
            <li>
              <strong className="text-foreground">MRO short-circuit</strong> — after running a benchmark
              once, subsequent runs of the same prompt usually short-circuit to the cached MRO at score
              &ge; 0.85, returning the prior answer with zero LLM cost. Use the
              <code className="bg-muted px-1 rounded text-xs ml-1">MRO_BYPASS=1</code> flag in
              <code className="bg-muted px-1 rounded text-xs ml-1">scripts/trace_recall.ts</code> to force
              a fresh retrieval for diagnostic comparison.
            </li>
          </ul>
        </section>

        <section className="pt-4 border-t border-border">
          <h3 className="text-sm font-semibold text-foreground mb-2">CLI parity</h3>
          <p className="text-sm text-muted-foreground mb-2">
            Every benchmark in this catalog is also runnable from the command line:
          </p>
          <pre className="text-xs bg-muted rounded p-3 overflow-x-auto">{`# Run any benchmark across all four modes (uses Railway production)
BENCHMARK=4 pnpm dlx tsx scripts/measure_modes.ts        # Priya Nair workload
BENCHMARK=7 pnpm dlx tsx scripts/measure_modes.ts        # Fuzzy match stress

# Deep Recall trace with MRO short-circuit bypassed
BENCHMARK=3 MRO_BYPASS=1 pnpm dlx tsx scripts/trace_recall.ts

# Ad-hoc one-off prompt without using the catalog
IP_QUERY="…your prompt…" pnpm dlx tsx scripts/measure_modes.ts`}</pre>
          <p className="text-xs text-muted-foreground mt-2 italic">
            <code className="bg-muted px-1 rounded">BENCHMARK=N</code> selects benchmark N from the catalog
            above (1–{BENCHMARKS.length}). The CLI scripts and the R&amp;D dropdown both read from
            <code className="bg-muted px-1 rounded ml-1">lib/benchmarks.ts</code> — adding a new entry there
            makes it appear in both places automatically.
          </p>
        </section>
      </main>
    </div>
  )
}
