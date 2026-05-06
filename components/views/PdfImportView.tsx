"use client"

// V5.0+ — Multi-PDF import.
//
// Predecessor (V4.x) accepted one PDF at a time. The replacement flow:
//
//   1. Drop zone accepts N PDFs (drag/drop or file picker)
//   2. Queue renders one card per file with status badges:
//        pending → processing → success | error
//   3. Files are processed SEQUENTIALLY — one Anthropic Vision call at
//      a time so we don't hammer Anthropic's per-key RPM limit and the
//      operator sees clean progress (a 5-PDF batch isn't 5 simultaneous
//      spinners). Each file also surfaces its own elapsed timer.
//   4. Per-file actions: Download CSV, Import to Converter, Retry, Remove.
//   5. Bulk actions when ≥2 files done: Import All, Download All as ZIP,
//      Clear queue. "Import All" calls onImportCsv N times in a tight
//      loop; React 18+ batches the setConvertedFiles + setCurrentView
//      calls so the converter receives the full batch in one render.
//
// onImportCsv is unchanged — single-CSV signature. The page.tsx handler
// already appends each call to convertedFiles, so multi-import "just
// works" without touching the converter contract.

import { useState, useCallback, useRef, useEffect } from "react"
import {
  ArrowLeft, ArrowRight, Settings, Upload, Download, Loader2,
  FileText, X, RefreshCw, CheckCircle2, AlertCircle, Files,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { csvToAio, type ConvertedFile } from "@/lib/aio-utils"
import { extractPdfToCsvStream, type PdfExtractResult, type PdfStreamProgressEvent } from "@/lib/api-client"

type Status = "pending" | "processing" | "success" | "error"

// V5.0.2+ — live progress signal flowing in from the SSE stream.
interface ChunkLogEntry {
  index: number
  status: "running" | "done" | "error"
  page_start?: number
  page_end?: number
  rows_added?: number
  elapsed_seconds?: number
  error?: string
}

interface ProgressState {
  totalPages?: number
  totalChunks?: number          // 0 until the meta event arrives
  currentChunk?: number         // 1-based; undefined before first chunk_start
  rowsTotal?: number
  log: ChunkLogEntry[]          // append-only chunk history
  model?: string                // V5.0.3+ — Anthropic model used (from meta event)
  finalizing?: boolean          // V5.0.3+ — true after all chunks done, before complete
}

interface QueueItem {
  id: string
  file: File
  status: Status
  result?: PdfExtractResult
  error?: string
  startedAt?: number       // wall-clock ms when processing began (for elapsed timer)
  finishedAt?: number      // wall-clock ms when processing finished
  imported?: boolean       // user clicked Import to Converter for this item
  cancelled?: boolean      // operator clicked Cancel — error state but with a softer label
  progress?: ProgressState // live SSE progress; populated while status==="processing"
}

const PROCESSING_STATES: Set<Status> = new Set(["processing"])

function fmtSize(bytes: number): string {
  const mb = bytes / 1_048_576
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`
}

function fmtElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000)
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

export function PdfImportView({
  onBack,
  onSysAdmin,
  onImportCsv,
}: {
  onBack: () => void
  onSysAdmin: () => void
  onImportCsv: (csv: ConvertedFile) => void
}) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // V5.0+ — Per-item AbortController registry. Lets the user click
  // Cancel on a stuck file without nuking the whole pump. Keyed by
  // QueueItem.id; the entry is wired up the moment we kick off the
  // fetch and torn down on completion (success or error).
  const activeControllersRef = useRef<Map<string, AbortController>>(new Map())

  // The processing pump. Runs sequentially through the queue, processing
  // one item at a time. Re-fires whenever the queue changes — the effect
  // looks at the first PENDING item and processes it; on completion it
  // updates state, which retriggers the effect to pick up the next.
  // Empty/error/done queue → effect short-circuits.
  const isProcessingAny = queue.some((q) => q.status === "processing")
  useEffect(() => {
    if (isProcessingAny) return
    const next = queue.find((q) => q.status === "pending")
    if (!next) return

    let cancelled = false
    const controller = new AbortController()
    activeControllersRef.current.set(next.id, controller)
    setQueue((prev) => prev.map((q) =>
      q.id === next.id
        ? { ...q, status: "processing", startedAt: Date.now(), progress: { log: [] } }
        : q,
    ))

    // ── Progress callback wires SSE events into queue state. Each
    //    event triggers a small targeted setQueue update so the
    //    progress bar + chunk badge animate in real time without
    //    re-rendering siblings.
    const handleProgress = (ev: PdfStreamProgressEvent) => {
      setQueue((prev) => prev.map((q) => {
        if (q.id !== next.id) return q
        const prog: ProgressState = q.progress ?? { log: [] }
        if (ev.type === "meta") {
          return {
            ...q,
            progress: {
              ...prog,
              totalPages: ev.data.total_pages,
              totalChunks: ev.data.total_chunks,
              model: ev.data.model,
            },
          }
        }
        if (ev.type === "finalizing") {
          return {
            ...q,
            progress: {
              ...prog,
              finalizing: true,
            },
          }
        }
        if (ev.type === "chunk_start") {
          return {
            ...q,
            progress: {
              ...prog,
              currentChunk: ev.data.chunk_index,
              totalChunks: ev.data.chunks_total,
              log: [
                ...prog.log,
                {
                  index: ev.data.chunk_index,
                  status: "running",
                  page_start: ev.data.page_start,
                  page_end: ev.data.page_end,
                },
              ],
            },
          }
        }
        if (ev.type === "chunk_done") {
          return {
            ...q,
            progress: {
              ...prog,
              currentChunk: ev.data.chunk_index,
              rowsTotal: ev.data.rows_total ?? prog.rowsTotal,
              log: prog.log.map((entry) =>
                entry.index === ev.data.chunk_index
                  ? { ...entry, status: "done", rows_added: ev.data.rows_added, elapsed_seconds: ev.data.elapsed_seconds }
                  : entry,
              ),
            },
          }
        }
        if (ev.type === "chunk_error") {
          return {
            ...q,
            progress: {
              ...prog,
              log: prog.log.map((entry) =>
                entry.index === ev.data.chunk_index
                  ? { ...entry, status: "error", error: ev.data.error, elapsed_seconds: ev.data.elapsed_seconds }
                  : entry,
              ),
            },
          }
        }
        return q
      }))
    }

    // Hard 8-minute frontend ceiling; the backend has its own per-chunk
    // timeout, but this is a final safety net so the pump can never
    // wedge indefinitely on a file that hangs server-side.
    void extractPdfToCsvStream(next.file, {
      signal: controller.signal,
      timeoutMs: 480_000,
      onProgress: handleProgress,
    }).then((data) => {
      if (cancelled) return
      activeControllersRef.current.delete(next.id)
      const finishedAt = Date.now()
      setQueue((prev) => prev.map((q) => {
        if (q.id !== next.id) return q
        if (!data) {
          return { ...q, status: "error", error: "Backend unreachable. Is the API running?", finishedAt }
        }
        if ("error" in data) {
          const detail = data.error
          const lower = detail.toLowerCase()
          let msg = `Extraction failed: ${detail}`
          if (lower.includes("api_key") || lower.includes("not configured")) {
            msg = "Anthropic API key not configured. Open System Admin → API Key and paste your key."
          } else if (lower.includes("cancelled")) {
            msg = "Cancelled by operator"
          } else if (lower.includes("exceeded") || lower.includes("timeout") || lower.includes("hung")) {
            msg = detail  // already actionable from extractPdfToCsv
          }
          const isCancel = lower.includes("cancelled")
          return { ...q, status: "error", error: msg, finishedAt, cancelled: isCancel }
        }
        if (!data.headers.length) {
          return {
            ...q,
            status: "error",
            error: "Extraction returned no rows — PDF may be image-only or empty.",
            finishedAt,
          }
        }
        return { ...q, status: "success", result: data, finishedAt }
      }))
    })

    return () => {
      cancelled = true
      activeControllersRef.current.delete(next.id)
    }
  }, [queue, isProcessingAny])

  // V5.0+ — Cancel a processing item. Aborts the fetch; the pump's
  // .then handler will land in the "error" branch with cancelled=true.
  const cancelItem = useCallback((id: string) => {
    const ac = activeControllersRef.current.get(id)
    if (ac) ac.abort(new DOMException("Cancelled by operator", "AbortError"))
  }, [])

  // ── File ingestion ────────────────────────────────────────────────

  const enqueueFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files)
    const pdfs = arr.filter((f) => f.name.toLowerCase().endsWith(".pdf"))
    const skipped = arr.length - pdfs.length
    if (skipped > 0) {
      setError(`${skipped} non-PDF file${skipped > 1 ? "s" : ""} skipped (only .pdf accepted)`)
    } else {
      setError(null)
    }
    if (!pdfs.length) return
    setQueue((prev) => [
      ...prev,
      ...pdfs.map((f) => ({
        id: `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${f.name}`,
        file: f,
        status: "pending" as Status,
      })),
    ])
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files?.length) enqueueFiles(e.dataTransfer.files)
  }, [enqueueFiles])

  // ── Per-item actions ──────────────────────────────────────────────

  const removeItem = useCallback((id: string) => {
    setQueue((prev) => prev.filter((q) => q.id !== id))
  }, [])

  const retryItem = useCallback((id: string) => {
    setQueue((prev) => prev.map((q) =>
      q.id === id ? { ...q, status: "pending", error: undefined, startedAt: undefined, finishedAt: undefined } : q,
    ))
  }, [])

  const importItem = useCallback((item: QueueItem) => {
    if (!item.result) return
    const baseName = (item.result.filename ?? item.file.name).replace(/\.pdf$/i, "")
    const now = new Date()
    const date = now.toISOString().substring(0, 10)
    const time = now.toISOString().substring(11, 19)
    const converted: ConvertedFile = {
      originalName: `${baseName}.csv`,
      csvData: [item.result.headers, ...item.result.rows],
      headers: item.result.headers,
      aioLines: item.result.rows.map((row) =>
        csvToAio(item.result!.headers, row, `${baseName}.csv`, date, time),
      ),
      fileDate: date,
      fileTime: time,
    }
    onImportCsv(converted)
    setQueue((prev) => prev.map((q) => q.id === item.id ? { ...q, imported: true } : q))
  }, [onImportCsv])

  const downloadCsv = useCallback((item: QueueItem) => {
    if (!item.result) return
    const blob = new Blob([item.result.csv_text], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    const baseName = (item.result.filename ?? item.file.name).replace(/\.pdf$/i, "")
    a.download = `${baseName}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [])

  // ── Bulk actions ──────────────────────────────────────────────────

  const successItems = queue.filter((q) => q.status === "success")
  const importableItems = successItems.filter((q) => !q.imported)

  // Import all successfully-extracted, not-yet-imported items in one
  // burst. React 18+ batches the resulting setConvertedFiles +
  // setCurrentView calls inside onImportCsv (page.tsx handler) into
  // one render commit, so the converter receives the full batch.
  const importAll = useCallback(() => {
    for (const item of importableItems) importItem(item)
  }, [importableItems, importItem])

  const clearAll = useCallback(() => {
    setQueue([])
    setError(null)
  }, [])

  const removeFinished = useCallback(() => {
    setQueue((prev) => prev.filter((q) => q.status === "pending" || q.status === "processing"))
  }, [])

  const totalCount = queue.length
  const successCount = successItems.length
  const errorCount = queue.filter((q) => q.status === "error").length
  const pendingCount = queue.filter((q) => q.status === "pending").length
  const processingCount = queue.filter((q) => PROCESSING_STATES.has(q.status)).length

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

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* ── Drop zone — always visible so the operator can keep adding ── */}
        <Card>
          <CardContent className="pt-6">
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${isDragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"}`}
            >
              <Files className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
              <p className="text-base font-medium text-foreground mb-1">
                Drop one or more PDF files here, or click to browse
              </p>
              <p className="text-sm text-muted-foreground">
                Multi-select supported — each PDF is extracted via Claude Vision into its own CSV.
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Files process sequentially (one at a time) to avoid rate-limit issues. Large PDFs are auto-chunked into 100-page slices.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files
                  if (files?.length) enqueueFiles(files)
                  e.target.value = ""
                }}
              />
            </div>
            {error && <p className="text-sm text-red-600 mt-4 text-center">{error}</p>}
          </CardContent>
        </Card>

        {/* ── Queue summary + bulk actions ── */}
        {totalCount > 0 && (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3 text-sm">
                  <span className="font-semibold text-foreground">{totalCount} file{totalCount !== 1 ? "s" : ""}</span>
                  {pendingCount > 0 && <Badge variant="outline">{pendingCount} pending</Badge>}
                  {processingCount > 0 && (
                    <Badge variant="outline" className="border-blue-300 text-blue-700">
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />{processingCount} processing
                    </Badge>
                  )}
                  {successCount > 0 && <Badge variant="outline" className="border-emerald-300 text-emerald-700">{successCount} ready</Badge>}
                  {errorCount > 0 && <Badge variant="outline" className="border-red-300 text-red-700">{errorCount} failed</Badge>}
                </div>
                <div className="flex gap-2">
                  {importableItems.length > 0 && (
                    <Button size="sm" onClick={importAll} className="gap-2 bg-primary">
                      <ArrowRight className="w-4 h-4" />
                      Import all {importableItems.length} to converter
                    </Button>
                  )}
                  {(successCount > 0 || errorCount > 0) && (
                    <Button size="sm" variant="outline" onClick={removeFinished} className="gap-2">
                      Clear finished
                    </Button>
                  )}
                  {totalCount > 0 && (
                    <Button size="sm" variant="ghost" onClick={clearAll} className="gap-2 text-muted-foreground">
                      Clear all
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Per-file queue items ── */}
        {queue.map((item) => (
          <QueueItemCard
            key={item.id}
            item={item}
            onRemove={() => removeItem(item.id)}
            onRetry={() => retryItem(item.id)}
            onImport={() => importItem(item)}
            onDownload={() => downloadCsv(item)}
            onCancel={() => cancelItem(item.id)}
          />
        ))}
      </main>
    </div>
  )
}


// ── Per-file card ────────────────────────────────────────────────────

function QueueItemCard({
  item,
  onRemove,
  onRetry,
  onImport,
  onDownload,
  onCancel,
}: {
  item: QueueItem
  onRemove: () => void
  onRetry: () => void
  onImport: () => void
  onDownload: () => void
  onCancel: () => void
}) {
  const [showDetails, setShowDetails] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)

  // Live elapsed timer for processing items.
  useEffect(() => {
    if (item.status !== "processing" || !item.startedAt) {
      setElapsedMs(0)
      return
    }
    const t0 = item.startedAt
    setElapsedMs(Date.now() - t0)
    const id = setInterval(() => setElapsedMs(Date.now() - t0), 500)
    return () => clearInterval(id)
  }, [item.status, item.startedAt])

  const finalElapsedMs = item.finishedAt && item.startedAt
    ? item.finishedAt - item.startedAt
    : null

  return (
    <Card className="border-border">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start gap-3">
          <FileText className="w-5 h-5 mt-0.5 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">{item.file.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {fmtSize(item.file.size)}
                  {item.status === "success" && item.result && (
                    <> · <span className="text-emerald-700">{item.result.document_count} record{item.result.document_count !== 1 ? "s" : ""}</span> · {item.result.headers.length} columns</>
                  )}
                  {item.status === "processing" && item.progress?.totalPages != null && (
                    <> · {item.progress.totalPages} page{item.progress.totalPages !== 1 ? "s" : ""}{item.progress.totalChunks && item.progress.totalChunks > 1 ? <> in {item.progress.totalChunks} chunks</> : null}</>
                  )}
                  {item.status === "success" && finalElapsedMs !== null && (
                    <> · {fmtElapsed(finalElapsedMs)}</>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* Status badge */}
                {item.status === "pending" && <Badge variant="outline" className="text-xs">Pending</Badge>}
                {item.status === "processing" && (
                  <Badge variant="outline" className="text-xs border-blue-300 text-blue-700">
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />Processing
                  </Badge>
                )}
                {item.status === "success" && (
                  <Badge variant="outline" className="text-xs border-emerald-300 text-emerald-700">
                    <CheckCircle2 className="w-3 h-3 mr-1" />Ready
                  </Badge>
                )}
                {item.status === "error" && (
                  <Badge variant="outline" className="text-xs border-red-300 text-red-700">
                    <AlertCircle className="w-3 h-3 mr-1" />Failed
                  </Badge>
                )}
                {item.imported && (
                  <Badge variant="outline" className="text-xs border-primary/40 text-primary">
                    Imported
                  </Badge>
                )}

                {/* Action buttons */}
                {item.status === "success" && (
                  <>
                    <Button size="sm" variant="outline" onClick={onDownload} className="h-8 gap-1.5">
                      <Download className="w-3.5 h-3.5" />CSV
                    </Button>
                    {!item.imported && (
                      <Button size="sm" onClick={onImport} className="h-8 gap-1.5 bg-primary">
                        <ArrowRight className="w-3.5 h-3.5" />Import
                      </Button>
                    )}
                  </>
                )}
                {item.status === "processing" && (
                  <Button size="sm" variant="outline" onClick={onCancel} className="h-8 gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50">
                    <X className="w-3.5 h-3.5" />Cancel
                  </Button>
                )}
                {item.status === "error" && (
                  <Button size="sm" variant="outline" onClick={onRetry} className="h-8 gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5" />Retry
                  </Button>
                )}
                {(item.status === "pending" || item.status === "error" || item.status === "success") && (
                  <Button size="sm" variant="ghost" onClick={onRemove} className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600">
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>

            {/* V5.0.2+ — Live progress block. Shown only while
                processing. Renders a determinate progress bar driven
                by SSE chunk events (or indeterminate-style if total
                chunks not yet known), a big elapsed timer, and the
                per-chunk log so the operator can see exactly which
                chunk is in flight. V5.0.3+ adds a finalizing state
                + model badge. */}
            {item.status === "processing" && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-2xl font-mono font-semibold tabular-nums text-foreground">{fmtElapsed(elapsedMs)}</span>
                    {item.progress?.finalizing ? (
                      <Badge variant="outline" className="border-purple-300 text-purple-700">
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />Finalizing CSV…
                      </Badge>
                    ) : item.progress?.totalChunks ? (
                      <Badge variant="outline" className="border-blue-300 text-blue-700">
                        Chunk {Math.min(item.progress.currentChunk ?? 1, item.progress.totalChunks)} / {item.progress.totalChunks}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        Uploading…
                      </Badge>
                    )}
                    {item.progress?.rowsTotal != null && item.progress.rowsTotal > 0 && (
                      <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                        {item.progress.rowsTotal} row{item.progress.rowsTotal !== 1 ? "s" : ""} so far
                      </Badge>
                    )}
                    {item.progress?.model && (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground font-mono">
                        {item.progress.model.replace(/^claude-/, "").replace(/-(\d+-\d+)$/, " $1")}
                      </Badge>
                    )}
                  </div>
                  {elapsedMs > 120_000 && (
                    <span className="text-xs text-amber-700">
                      {elapsedMs > 360_000 ? "approaching 8-min cap, will auto-fail soon" : "taking longer than usual — click Cancel to abort"}
                    </span>
                  )}
                </div>
                <Progress
                  value={
                    item.progress?.finalizing
                      ? 95
                      : item.progress?.totalChunks
                      ? Math.min(
                          100,
                          Math.round(
                            (item.progress.log.filter((l) => l.status === "done" || l.status === "error").length /
                              item.progress.totalChunks) *
                              100,
                          ) + (item.progress.log.some((l) => l.status === "running") ? 5 : 0),
                        )
                      : Math.min(95, Math.round((elapsedMs / 1000 / 30) * 5))
                  }
                  className="h-2"
                />
                {item.progress && item.progress.log.length > 0 && (
                  <ul className="text-[11px] text-muted-foreground space-y-0.5 mt-2 max-h-32 overflow-y-auto">
                    {item.progress.log.map((entry) => (
                      <li key={entry.index} className="flex items-center gap-2">
                        {entry.status === "running" && <Loader2 className="w-3 h-3 animate-spin text-blue-500" />}
                        {entry.status === "done" && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
                        {entry.status === "error" && <AlertCircle className="w-3 h-3 text-red-500" />}
                        <span className="tabular-nums">
                          Chunk {entry.index}
                          {entry.page_start != null && entry.page_end != null && (
                            <> · pages {entry.page_start}–{entry.page_end}</>
                          )}
                          {entry.status === "done" && entry.elapsed_seconds != null && (
                            <> · done in {entry.elapsed_seconds.toFixed(1)}s ({entry.rows_added ?? 0} rows)</>
                          )}
                          {entry.status === "running" && <> · running…</>}
                          {entry.status === "error" && entry.error && (
                            <span className="text-red-600 ml-1">· {entry.error.slice(0, 80)}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Error detail */}
            {item.status === "error" && item.error && (
              <p className="text-xs text-red-600 mt-2 leading-relaxed">{item.error}</p>
            )}

            {/* Success — collapsible preview */}
            {item.status === "success" && item.result && (
              <>
                <button
                  type="button"
                  onClick={() => setShowDetails(!showDetails)}
                  className="text-xs text-primary hover:underline mt-2"
                >
                  {showDetails ? "Hide" : "Show"} preview ({item.result.rows.length} rows × {item.result.headers.length} cols)
                </button>
                {showDetails && (
                  <div className="mt-3 rounded border border-border overflow-auto max-h-[300px]">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          <th className="text-left px-2 py-1.5 font-medium text-[11px] text-muted-foreground w-8">#</th>
                          {item.result.headers.map((h, i) => (
                            <th key={i} className="text-left px-2 py-1.5 font-medium text-[11px] whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {item.result.rows.slice(0, 50).map((row, ri) => (
                          <tr key={ri} className="hover:bg-muted/30">
                            <td className="px-2 py-1 text-[11px] text-muted-foreground">{ri + 1}</td>
                            {row.map((cell, ci) => (
                              <td key={ci} className="px-2 py-1 text-[11px] whitespace-nowrap max-w-[180px] truncate">{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {item.result.rows.length > 50 && (
                      <p className="text-[11px] text-muted-foreground p-2 bg-muted/20 border-t border-border">
                        Showing first 50 of {item.result.rows.length} rows · download CSV to see all
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
