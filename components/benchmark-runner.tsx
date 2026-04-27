"use client"

/**
 * components/benchmark-runner.tsx
 *
 * In-app benchmark UI mounted from the R&D view. Runs a saved
 * benchmark prompt through all four ChatAIO modes, displays the
 * results in a full-screen overlay with side-by-side metrics and
 * the verbatim replies, and offers Print / Save-as-PDF (browser
 * native print dialog) so operators can capture the output.
 */

import { useEffect, useState } from "react"
import { Loader2, Printer, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { runFourModes, type Benchmark, type BenchmarkResult } from "@/lib/benchmarks"

function fmt(n: number): string {
  return n.toLocaleString("en-US")
}

export function BenchmarkRunner({
  benchmark,
  onClose,
}: {
  benchmark: Benchmark
  onClose: () => void
}) {
  const [running, setRunning] = useState(true)
  const [result, setResult] = useState<BenchmarkResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Lock body scroll for the duration of the overlay.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = prev }
  }, [])

  // Kick off the run on mount. Each instance fires exactly once; if the
  // user wants to re-run they reopen the overlay (cheaper than wiring a
  // re-run button, which would also need to handle in-flight aborts).
  useEffect(() => {
    let cancelled = false
    setRunning(true)
    setResult(null)
    setError(null)
    runFourModes(benchmark.prompt)
      .then((r) => { if (!cancelled) setResult(r) })
      .catch((e) => { if (!cancelled) setError(e?.message ?? String(e)) })
      .finally(() => { if (!cancelled) setRunning(false) })
    return () => { cancelled = true }
  }, [benchmark.prompt])

  // Browser native print → user picks "Save as PDF" or a real printer.
  const handlePrint = () => window.print()

  return (
    <div className="fixed inset-0 z-50 bg-background overflow-auto print:static print:overflow-visible">
      {/* Sticky control bar — hidden on print so the printed page is
          just the report content. */}
      <header className="border-b border-border bg-card sticky top-0 z-10 print:hidden">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <h1 className="text-lg font-bold text-foreground flex-1 truncate">{benchmark.title}</h1>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            disabled={running || !!error}
            className="gap-2"
          >
            <Printer className="w-4 h-4" />Print / Save as PDF
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} className="gap-2">
            <X className="w-4 h-4" />Close
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="benchmark-printable space-y-6">
          {/* Title (visible in both screen and print) */}
          <div>
            <h2 className="text-2xl font-bold text-foreground mb-1">{benchmark.title}</h2>
            <p className="text-sm text-muted-foreground">{benchmark.description}</p>
            {result?.ts && (
              <p className="text-xs text-muted-foreground mt-2">Run timestamp: {result.ts}</p>
            )}
          </div>

          {/* Prompt */}
          <section>
            <h3 className="text-sm font-semibold text-foreground mb-2">Prompt</h3>
            <pre className="whitespace-pre-wrap text-xs leading-relaxed p-4 rounded-md bg-muted border border-border font-mono">
              {benchmark.prompt}
            </pre>
          </section>

          {running && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Running four-mode benchmark — this typically takes 30-90 seconds total (Recall, Live, Broad, Raw run sequentially).
            </div>
          )}

          {error && (
            <div className="p-4 rounded-md bg-destructive/10 border border-destructive text-destructive text-sm">
              Benchmark failed: {error}
            </div>
          )}

          {result && (
            <>
              {/* Side-by-side summary table */}
              <section>
                <h3 className="text-sm font-semibold text-foreground mb-2">Side-by-Side Summary</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border border-border">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-3 py-2 border-b border-border">Metric</th>
                        {result.modes.map((m) => (
                          <th key={m.mode} className="text-right px-3 py-2 border-b border-border">{m.mode}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="font-mono text-xs">
                      <tr>
                        <td className="px-3 py-1.5 border-b border-border text-foreground">latency_ms</td>
                        {result.modes.map((m) => (
                          <td key={m.mode} className="px-3 py-1.5 border-b border-border text-right">{fmt(m.latency_ms)}</td>
                        ))}
                      </tr>
                      <tr>
                        <td className="px-3 py-1.5 border-b border-border text-foreground">input_tokens</td>
                        {result.modes.map((m) => (
                          <td key={m.mode} className="px-3 py-1.5 border-b border-border text-right">{fmt(m.input_tokens)}</td>
                        ))}
                      </tr>
                      <tr>
                        <td className="px-3 py-1.5 border-b border-border text-foreground">output_tokens</td>
                        {result.modes.map((m) => (
                          <td key={m.mode} className="px-3 py-1.5 border-b border-border text-right">{fmt(m.output_tokens)}</td>
                        ))}
                      </tr>
                      <tr>
                        <td className="px-3 py-1.5 border-b border-border text-foreground">total_tokens</td>
                        {result.modes.map((m) => (
                          <td key={m.mode} className="px-3 py-1.5 border-b border-border text-right">{fmt(m.input_tokens + m.output_tokens)}</td>
                        ))}
                      </tr>
                      <tr>
                        <td className="px-3 py-1.5 border-b border-border text-foreground">context_records</td>
                        {result.modes.map((m) => (
                          <td key={m.mode} className="px-3 py-1.5 border-b border-border text-right">{fmt(m.context_records)}</td>
                        ))}
                      </tr>
                      <tr>
                        <td className="px-3 py-1.5 text-foreground">model_ref</td>
                        {result.modes.map((m) => (
                          <td key={m.mode} className="px-3 py-1.5 text-right">{m.model_ref}</td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Per-mode replies */}
              <section className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">Replies</h3>
                {result.modes.map((m) => (
                  <div key={m.mode} className="border border-border rounded-md break-inside-avoid">
                    <div className="px-4 py-2 bg-muted/40 border-b border-border flex items-center justify-between">
                      <p className="text-sm font-semibold text-foreground">{m.mode}</p>
                      <p className="text-xs font-mono text-muted-foreground">
                        {fmt(m.input_tokens)}/{fmt(m.output_tokens)} tok · {fmt(m.latency_ms)}ms · {m.model_ref}
                      </p>
                    </div>
                    <div className="px-4 py-3 text-xs leading-relaxed">
                      {m.error ? (
                        <p className="text-destructive">Error: {m.error}</p>
                      ) : (
                        <pre className="whitespace-pre-wrap font-sans">{m.reply}</pre>
                      )}
                    </div>
                  </div>
                ))}
              </section>
            </>
          )}
        </div>
      </main>

      {/* Print-only stylesheet: hide the rest of the app, expand the
          benchmark column to full page width, and force long replies to
          break across pages cleanly. Using a plain <style> tag (rather
          than styled-jsx) so this component works without the SWC
          styled-jsx plugin being applied here. */}
      <style
        dangerouslySetInnerHTML={{ __html: `
          @media print {
            body * { visibility: hidden !important; }
            .benchmark-printable, .benchmark-printable * { visibility: visible !important; }
            .benchmark-printable {
              position: absolute;
              left: 0;
              top: 0;
              width: 100%;
              padding: 0 0.5in;
            }
            .benchmark-printable pre {
              white-space: pre-wrap !important;
              word-wrap: break-word !important;
            }
          }
        ` }}
      />
    </div>
  )
}
