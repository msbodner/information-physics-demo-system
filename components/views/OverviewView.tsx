"use client"

/**
 * components/views/OverviewView.tsx
 *
 * V6.0 — front-screen "Overview" entry point. The old Summarize All
 * button lived inside the Hyper-Semantic Processor screen; this view
 * moves the same capability to the home page so operators can get an
 * AI-generated corpus overview without having to load AIOs through
 * the converter first.
 *
 * Renders the same comprehensive SummarizeResult shape that
 * SemanticProcessor displays (industry / categories / file inventory
 * / primary entities / notable patterns / data quality / suggested
 * analyses / field inventory) — plus a header bar with Print, Save
 * as PDF, and Download (Markdown) actions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeft, BookOpen, Cpu, Download, FileText, Loader2,
  Printer, Settings, X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  listAioData, summarizeAIOs,
  type AioDataRecord, type SummarizeResult,
} from "@/lib/api-client"
import { toast } from "sonner"

// Join an AioDataRecord's bracket elements back into the wire-format
// string the backend's summarize endpoint expects. Elements are
// already in "[Key.Value]" form per the V5+ schema; we strip nulls
// (sparse 50-column shape) and concatenate.
function aioRecordToString(r: AioDataRecord): string {
  return (r.elements ?? []).filter((e): e is string => !!e).join("")
}

interface OverviewViewProps {
  onBack: () => void
  onSysAdmin: () => void
  backendIsOnline: boolean
}

export function OverviewView({ onBack, onSysAdmin, backendIsOnline }: OverviewViewProps) {
  const [aios, setAios] = useState<AioDataRecord[] | null>(null)
  const [summary, setSummary] = useState<SummarizeResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const printableRef = useRef<HTMLDivElement>(null)

  const generatedAt = useMemo(() => new Date(), [summary])

  // Auto-load on mount: fetch all AIOs from the backend, then call
  // summarizeAIOs. Operators can re-run from the header.
  const runOverview = useCallback(async () => {
    if (!backendIsOnline) {
      setError("Backend offline — connect the backend to generate an overview.")
      return
    }
    setLoading(true)
    setError(null)
    setSummary(null)
    try {
      const allAios = await listAioData(100000)
      setAios(allAios)
      if (!allAios || allAios.length === 0) {
        setError("No AIOs in the corpus yet. Import a CSV first.")
        return
      }
      const aioTexts = allAios.map((r) => aioRecordToString(r))
      const result = await summarizeAIOs(aioTexts)
      if (!result) {
        setError("Summary call failed. Check the backend, API key, and daily token budget.")
        return
      }
      setSummary(result)
    } catch (e) {
      setError(`Failed to generate overview: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }, [backendIsOnline])

  useEffect(() => { runOverview() }, [runOverview])

  // ── Export actions ────────────────────────────────────────────────

  const handlePrint = useCallback(() => {
    // window.print() respects the print:hidden classes on the header.
    window.print()
  }, [])

  // Build a plain-text Markdown serialization of the current summary
  // so operators can paste into reports or feed it to other tools.
  const buildMarkdown = useCallback((): string => {
    if (!summary) return ""
    const lines: string[] = []
    lines.push(`# AIO/HSL/MRO — Corpus Overview`)
    lines.push("")
    lines.push(`_Generated ${generatedAt.toLocaleString()} · ${summary.aio_count?.toLocaleString() ?? "?"} records · LLM saw ${summary.sampled_records ?? "?"} stratified sample · model: ${summary.model_ref ?? "default"}_`)
    if (summary.industry) lines.push(`_Industry: **${summary.industry}**_`)
    lines.push("")
    lines.push(`## Executive Summary`)
    lines.push("")
    lines.push(summary.summary || "_(narrative unavailable)_")
    lines.push("")
    if (summary.categories?.length) {
      lines.push(`## Categories of Data`)
      lines.push("")
      for (const c of summary.categories) lines.push(`- ${c}`)
      lines.push("")
    }
    if (summary.file_inventory?.length) {
      lines.push(`## Source Files (${summary.file_inventory.length})`)
      if (summary.date_range) lines.push(`_Date range: ${summary.date_range.min} → ${summary.date_range.max}_`)
      lines.push("")
      for (const f of summary.file_inventory) lines.push(`- \`${f.filename}\` — ${f.record_count} record${f.record_count !== 1 ? "s" : ""}`)
      lines.push("")
    }
    if (summary.primary_entities?.length) {
      lines.push(`## Primary Entities`)
      lines.push("")
      for (const e of summary.primary_entities) {
        lines.push(`- **${e.name}** _(${e.type})_${e.frequency ? ` — ${e.frequency}` : ""}`)
      }
      lines.push("")
    }
    if (summary.notable_patterns?.length) {
      lines.push(`## Notable Patterns`)
      lines.push("")
      for (const p of summary.notable_patterns) lines.push(`- ${p}`)
      lines.push("")
    }
    if (summary.data_quality_notes?.length) {
      lines.push(`## Data Quality Notes`)
      lines.push("")
      for (const n of summary.data_quality_notes) lines.push(`- ${n}`)
      lines.push("")
    }
    if (summary.suggested_analyses?.length) {
      lines.push(`## Suggested Analyses`)
      lines.push("")
      for (const a of summary.suggested_analyses) lines.push(`- ${a}`)
      lines.push("")
    }
    if (summary.field_inventory?.length) {
      lines.push(`## Top ${Math.min(25, summary.field_inventory.length)} Fields by Occurrence (deterministic)`)
      lines.push("")
      lines.push(`| Key | Records | Distinct | Sample |`)
      lines.push(`|---|---:|---:|---|`)
      for (const f of summary.field_inventory.slice(0, 25)) {
        const sample = f.sample_values.slice(0, 3).join(", ").replace(/\|/g, "\\|")
        lines.push(`| \`${f.key}\` | ${f.occurrences} | ${f.distinct_values} | ${sample} |`)
      }
      lines.push("")
    }
    return lines.join("\n")
  }, [summary, generatedAt])

  const handleDownloadMarkdown = useCallback(() => {
    if (!summary) {
      toast.error("Nothing to download yet — wait for the overview to load.")
      return
    }
    const md = buildMarkdown()
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `aio-corpus-overview-${new Date().toISOString().slice(0, 10)}.md`
    document.body.appendChild(a)
    a.click()
    setTimeout(() => {
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }, 0)
  }, [summary, buildMarkdown])

  // Save as PDF reuses the browser's print dialog (Destination: Save
  // as PDF). Adds a hint toast so first-time users know where to look.
  const handleSaveAsPdf = useCallback(() => {
    toast.info("In the print dialog, choose 'Save as PDF' as the destination.")
    window.print()
  }, [])

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background print:bg-white">
      <header className="border-b border-border bg-card sticky top-0 z-10 print:hidden">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4 flex-wrap">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
            <ArrowLeft className="w-4 h-4" />Back
          </Button>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-amber-600 flex items-center justify-center shrink-0">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-foreground">Corpus Overview</h1>
              <p className="text-xs text-muted-foreground truncate">
                {loading
                  ? "Generating overview…"
                  : summary
                    ? `${summary.aio_count?.toLocaleString() ?? "?"} records · model: ${summary.model_ref ?? "default"}`
                    : "AI-generated comprehensive summary of the AIO corpus"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={runOverview} disabled={loading || !backendIsOnline} className="gap-2"
              title="Re-run the overview against the current corpus. Costs one LLM call.">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cpu className="w-4 h-4" />}
              {loading ? "Generating…" : "Regenerate"}
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint} disabled={!summary} className="gap-2"
              title="Open the browser print dialog. Choose your printer as the destination.">
              <Printer className="w-4 h-4" />Print
            </Button>
            <Button variant="outline" size="sm" onClick={handleSaveAsPdf} disabled={!summary} className="gap-2"
              title="Open the print dialog with a hint to choose 'Save as PDF' as the destination.">
              <FileText className="w-4 h-4" />Save as PDF
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadMarkdown} disabled={!summary} className="gap-2"
              title="Download a Markdown file with the full overview (industry, files, entities, patterns, data-quality, suggested analyses, top fields).">
              <Download className="w-4 h-4" />Download .md
            </Button>
            <Button variant="outline" size="sm" onClick={onSysAdmin} className="gap-2">
              <Settings className="w-4 h-4" />System Admin
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 print:max-w-none print:px-4 print:py-2">
        <div ref={printableRef}>
          {/* Print-only title block — visible only when printing/saving
              as PDF, since the on-screen header has its own bar. */}
          <div className="hidden print:block mb-4">
            <h1 className="text-2xl font-bold mb-1">AIO/HSL/MRO — Corpus Overview</h1>
            <p className="text-xs text-muted-foreground">
              Generated {generatedAt.toLocaleString()}
              {summary?.aio_count != null && (
                <> · {summary.aio_count.toLocaleString()} records</>
              )}
              {summary?.sampled_records != null && (
                <> · LLM sample: {summary.sampled_records}</>
              )}
              {summary?.model_ref && (
                <> · model: {summary.model_ref}</>
              )}
            </p>
          </div>

          {/* Loading state */}
          {loading && (
            <Card className="border-amber-200">
              <CardContent className="pt-6 flex items-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
                Loading AIOs and generating overview…
              </CardContent>
            </Card>
          )}

          {/* Error state */}
          {error && !loading && (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <X className="w-4 h-4 text-destructive" />
                  Overview unavailable
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-foreground">
                {error}
              </CardContent>
            </Card>
          )}

          {/* Summary content */}
          {summary && !loading && (
            <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 print:bg-white print:border-amber-300">
              <CardHeader className="py-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                    <Cpu className="w-4 h-4 text-amber-600" />
                    Comprehensive AI Summary
                    {summary.industry && (
                      <Badge variant="outline" className="border-amber-300 text-amber-900 bg-amber-100/50">
                        {summary.industry}
                      </Badge>
                    )}
                    {summary.aio_count != null && summary.sampled_records != null && (
                      <span className="text-[11px] font-normal text-muted-foreground">
                        {summary.aio_count.toLocaleString()} records · LLM saw {summary.sampled_records} stratified sample
                      </span>
                    )}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-foreground leading-relaxed">
                {/* Executive narrative */}
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 mb-1">Executive Summary</p>
                  <p className="whitespace-pre-wrap">{summary.summary}</p>
                </div>

                {summary.categories && summary.categories.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 mb-1">Categories of Data</p>
                    <div className="flex flex-wrap gap-1.5">
                      {summary.categories.map((c, i) => (
                        <Badge key={i} variant="outline" className="border-amber-300 text-amber-900 bg-amber-100/50">{c}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {summary.file_inventory && summary.file_inventory.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 mb-1">
                      Source Files ({summary.file_inventory.length})
                      {summary.date_range && (
                        <span className="ml-2 font-normal normal-case tracking-normal">
                          · range {summary.date_range.min} → {summary.date_range.max}
                        </span>
                      )}
                    </p>
                    <ul className="space-y-0.5 text-xs">
                      {summary.file_inventory.map((f, i) => (
                        <li key={i} className="flex justify-between gap-3">
                          <span className="font-mono truncate">{f.filename}</span>
                          <span className="text-muted-foreground tabular-nums shrink-0">
                            {f.record_count} record{f.record_count !== 1 ? "s" : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {summary.primary_entities && summary.primary_entities.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 mb-1">Primary Entities</p>
                    <ul className="space-y-1 text-xs">
                      {summary.primary_entities.map((e, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="font-medium">{e.name}</span>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground italic">{e.type}</span>
                          {e.frequency && (
                            <>
                              <span className="text-muted-foreground">·</span>
                              <span className="text-muted-foreground">{e.frequency}</span>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {summary.notable_patterns && summary.notable_patterns.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 mb-1">Notable Patterns</p>
                    <ul className="list-disc list-inside space-y-0.5 text-xs">
                      {summary.notable_patterns.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  </div>
                )}

                {summary.data_quality_notes && summary.data_quality_notes.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 mb-1">Data Quality Notes</p>
                    <ul className="list-disc list-inside space-y-0.5 text-xs">
                      {summary.data_quality_notes.map((n, i) => <li key={i}>{n}</li>)}
                    </ul>
                  </div>
                )}

                {summary.suggested_analyses && summary.suggested_analyses.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 mb-1">Suggested Analyses</p>
                    <ul className="list-disc list-inside space-y-0.5 text-xs">
                      {summary.suggested_analyses.map((a, i) => <li key={i}>{a}</li>)}
                    </ul>
                  </div>
                )}

                {summary.field_inventory && summary.field_inventory.length > 0 && (
                  <details className="text-xs print:open" open>
                    <summary className="cursor-pointer font-semibold uppercase tracking-wide text-amber-800 text-[11px]">
                      Top {Math.min(25, summary.field_inventory.length)} fields by occurrence (deterministic)
                    </summary>
                    <div className="mt-2 max-h-[800px] overflow-y-auto rounded border border-amber-200 bg-white/50 print:max-h-none print:overflow-visible">
                      <table className="w-full text-[11px]">
                        <thead className="bg-amber-100/50 text-amber-900">
                          <tr>
                            <th className="text-left px-2 py-1 font-medium">Key</th>
                            <th className="text-right px-2 py-1 font-medium">Records</th>
                            <th className="text-right px-2 py-1 font-medium">Distinct</th>
                            <th className="text-left px-2 py-1 font-medium">Sample</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-amber-100">
                          {summary.field_inventory.slice(0, 25).map((f, i) => (
                            <tr key={i}>
                              <td className="px-2 py-0.5 font-mono">{f.key}</td>
                              <td className="px-2 py-0.5 text-right tabular-nums">{f.occurrences}</td>
                              <td className="px-2 py-0.5 text-right tabular-nums">{f.distinct_values}</td>
                              <td className="px-2 py-0.5 text-muted-foreground truncate max-w-[280px]" title={f.sample_values.join(", ")}>
                                {f.sample_values.slice(0, 3).join(", ")}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}
