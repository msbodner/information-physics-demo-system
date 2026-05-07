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
  Library, Atom, Eye, Trash2, Download as DownloadIcon,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { csvToAio, type ConvertedFile } from "@/lib/aio-utils"
import {
  extractPdfToCsv,
  type PdfExtractResult,
  listImportedPdfs,
  deleteImportedPdf,
  importedPdfContentUrl,
  getImportedPdfCsvResult,
  listAioData,
  createAioData,
  type ImportedPdfMeta,
} from "@/lib/api-client"

type Status = "pending" | "processing" | "success" | "error"

// V5.0.7+ — back to synchronous extraction. Multiple rounds of SSE
// + polling progress mechanisms kept hitting buffering/transition
// bugs that left the UI frozen. The simple sync POST flow always
// completes deterministically: the request is open while the backend
// works, returns the result, done. Trade-off: no per-chunk progress
// granularity, just an elapsed timer + indeterminate spinner.

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

  // V5.0.8+ — server-side imported PDFs viewer. The "View Imported
  // PDFs" header button toggles a dialog that lists everything in
  // the imported_pdfs table for this tenant, with View / Download /
  // Delete actions per row. This makes the persisted catalog
  // discoverable without leaving the import screen.
  const [importedPdfsOpen, setImportedPdfsOpen] = useState(false)
  const [importedPdfs, setImportedPdfs] = useState<ImportedPdfMeta[]>([])
  const [importedPdfsLoading, setImportedPdfsLoading] = useState(false)
  const [previewPdf, setPreviewPdf] = useState<ImportedPdfMeta | null>(null)
  const [deletingPdfId, setDeletingPdfId] = useState<string | null>(null)
  const refreshImportedPdfs = useCallback(async () => {
    setImportedPdfsLoading(true)
    try {
      setImportedPdfs(await listImportedPdfs())
    } finally {
      setImportedPdfsLoading(false)
    }
  }, [])

  // V5.0.8+ — bulk "Create AIOs from imported PDFs" workflow. Iterates
  // every imported_pdfs row that has a CSV, dedupes against existing
  // aio_data by OriginalCSV name, and inserts the AIO bracket strings.
  const [creatingAios, setCreatingAios] = useState(false)
  const [createAiosResult, setCreateAiosResult] = useState<{
    pdfsProcessed: number
    pdfsSkipped: number
    aiosCreated: number
    errors: string[]
  } | null>(null)

  // V5.0.7+ — backend config diagnostic. Auto-fetched the first time
  // an extraction runs slow (>30s) so we can surface the actual
  // configured model inline.
  const [backendConfig, setBackendConfig] = useState<{
    model: string
    chunk_timeout_seconds: number
    anthropic_api_key_configured: boolean
  } | null>(null)
  const configFetchedRef = useRef(false)
  const fetchBackendConfig = useCallback(async () => {
    if (configFetchedRef.current) return
    configFetchedRef.current = true
    try {
      const res = await fetch("/api/diag/pdf-config", { cache: "no-store" })
      if (res.ok) setBackendConfig(await res.json())
    } catch { /* ignore */ }
  }, [])

  // V5.0.8+ — Anthropic latency probe. Fired alongside the config
  // diagnostic so the UI can tell the operator whether the slowness
  // is in Anthropic itself (ping slow) or in our PDF pipeline (ping
  // fast but extraction still hung).
  const [anthropicPing, setAnthropicPing] = useState<{
    ok: boolean
    elapsed_seconds: number
    model?: string
    error?: string
  } | null>(null)
  const [pingInFlight, setPingInFlight] = useState(false)
  const pingFetchedRef = useRef(false)
  const fetchAnthropicPing = useCallback(async () => {
    if (pingFetchedRef.current) return
    pingFetchedRef.current = true
    setPingInFlight(true)
    try {
      const res = await fetch("/api/diag/anthropic-ping", { cache: "no-store" })
      if (res.ok) setAnthropicPing(await res.json())
    } catch { /* ignore */ }
    finally { setPingInFlight(false) }
  }, [])

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
        ? { ...q, status: "processing", startedAt: Date.now() }
        : q,
    ))

    // V5.0.7+ — synchronous extraction. The backend's existing
    // /v1/op/pdf-extract endpoint persists the PDF and returns the
    // result in a single round trip. No streaming, no polling, no
    // worker threads — none of the moving parts that have been
    // breaking. UI shows just the elapsed timer + indeterminate
    // spinner while the request is in flight.
    void extractPdfToCsv(next.file, {
      signal: controller.signal,
      timeoutMs: 480_000,
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

  // V5.0.8+ — open the imported-PDFs dialog and lazy-load the list.
  const openImportedPdfs = useCallback(async () => {
    setImportedPdfsOpen(true)
    if (importedPdfs.length === 0) {
      await refreshImportedPdfs()
    }
  }, [importedPdfs.length, refreshImportedPdfs])

  const handleDeleteImported = useCallback(async (item: ImportedPdfMeta) => {
    if (!window.confirm(`Delete "${item.filename}" and its stored bytes?\n\nThis is irreversible.`)) return
    setDeletingPdfId(item.pdf_id)
    const ok = await deleteImportedPdf(item.pdf_id)
    setDeletingPdfId(null)
    if (!ok) {
      toast.error(`Failed to delete ${item.filename}`)
      return
    }
    toast.success(`Deleted ${item.filename}`)
    setImportedPdfs((prev) => prev.filter((p) => p.pdf_id !== item.pdf_id))
  }, [])

  // V5.0.8+ — Create AIOs from every persisted imported PDF.
  // Workflow:
  //   1. Pull all imported_pdfs rows where extraction finished and
  //      csv_text is populated.
  //   2. Pull existing aio_data so we know which OriginalCSV names
  //      are already represented (skip those — duplicate dedup).
  //   3. For each fresh PDF, fetch its CSV result, build AIO bracket
  //      strings via csvToAio, and POST each one to /v1/aio-data.
  //   4. Toast a summary; expose the full breakdown via dialog.
  const createAiosFromImportedPdfs = useCallback(async () => {
    if (creatingAios) return
    setCreatingAios(true)
    setCreateAiosResult(null)
    try {
      const [pdfs, existingAios] = await Promise.all([
        listImportedPdfs(),
        listAioData(),
      ])
      const ready = pdfs.filter(
        (p) =>
          (p.status === "extracted" || p.status === "partial") &&
          (p.row_count ?? 0) > 0,
      )

      if (ready.length === 0) {
        toast.error("No extracted PDFs available to convert")
        return
      }

      // Build set of OriginalCSV names already represented in aio_data.
      // The aio_name bracket string contains [OriginalCSV.<name>] —
      // extract that token to detect duplicates.
      const existingOriginals = new Set<string>()
      const ORIGINAL_RE = /\[OriginalCSV\.([^\]]+)\]/
      for (const a of existingAios) {
        const m = a.aio_name.match(ORIGINAL_RE)
        if (m) existingOriginals.add(m[1])
      }

      let pdfsProcessed = 0
      let pdfsSkipped = 0
      let aiosCreated = 0
      const errors: string[] = []

      for (const pdf of ready) {
        const targetCsvName = pdf.filename.replace(/\.pdf$/i, ".csv")
        if (existingOriginals.has(targetCsvName)) {
          pdfsSkipped++
          continue
        }
        try {
          const result = await getImportedPdfCsvResult(pdf.pdf_id)
          if (!result || !result.headers?.length || !result.rows?.length) {
            pdfsSkipped++
            continue
          }
          // Build a stable date/time stamp from the original import.
          const created = pdf.created_at ?? new Date().toISOString()
          const fileDate = created.substring(0, 10)
          const fileTime = created.substring(11, 19) || "00:00:00"
          for (const row of result.rows) {
            const aioName = csvToAio(result.headers, row, targetCsvName, fileDate, fileTime)
            // elements parameter mirrors the converter flow: each
            // element is the verbatim cell value, padded/aligned to
            // the column count. Backend stores up to 50 elements; we
            // truncate any tail beyond that.
            const elements: (string | null)[] = []
            for (let i = 0; i < Math.min(50, result.headers.length); i++) {
              const v = row[i] ?? ""
              elements.push(v === "" ? null : v)
            }
            const saved = await createAioData(aioName, elements)
            if (saved) {
              aiosCreated++
            } else {
              errors.push(`${pdf.filename} row failed to save`)
            }
          }
          existingOriginals.add(targetCsvName)
          pdfsProcessed++
        } catch (e) {
          errors.push(`${pdf.filename}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      const summary = { pdfsProcessed, pdfsSkipped, aiosCreated, errors }
      setCreateAiosResult(summary)

      if (aiosCreated > 0) {
        toast.success(
          `Created ${aiosCreated} AIO${aiosCreated !== 1 ? "s" : ""} from ${pdfsProcessed} PDF${pdfsProcessed !== 1 ? "s" : ""}` +
            (pdfsSkipped > 0 ? ` · skipped ${pdfsSkipped} (already imported)` : "") +
            (errors.length > 0 ? ` · ${errors.length} error${errors.length !== 1 ? "s" : ""}` : ""),
        )
      } else if (pdfsSkipped > 0) {
        toast.info(`All ${pdfsSkipped} PDF${pdfsSkipped !== 1 ? "s" : ""} already imported as AIOs`)
      } else {
        toast.error("No AIOs were created — see error details")
      }
    } catch (e) {
      toast.error(`Failed to create AIOs: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setCreatingAios(false)
    }
  }, [creatingAios])

  const totalCount = queue.length
  const successCount = successItems.length
  const errorCount = queue.filter((q) => q.status === "error").length
  const pendingCount = queue.filter((q) => q.status === "pending").length
  const processingCount = queue.filter((q) => PROCESSING_STATES.has(q.status)).length

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-4 flex-wrap">
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-2"><ArrowLeft className="w-4 h-4" />Back</Button>
            <h1 className="text-lg font-bold text-foreground">Import PDFs → CSVs</h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* V5.0.8+ — server-side imported PDFs viewer. */}
            <Button variant="outline" size="sm" onClick={openImportedPdfs} className="gap-2">
              <Library className="w-4 h-4" />View Imported PDFs
            </Button>
            {/* V5.0.8+ — bulk Create AIOs from every imported PDF. */}
            <Button
              variant="outline"
              size="sm"
              onClick={createAiosFromImportedPdfs}
              disabled={creatingAios}
              className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            >
              {creatingAios ? <Loader2 className="w-4 h-4 animate-spin" /> : <Atom className="w-4 h-4" />}
              {creatingAios ? "Creating AIOs…" : "Create AIOs from PDFs"}
            </Button>
            <Button variant="outline" size="sm" onClick={onSysAdmin} className="gap-2"><Settings className="w-4 h-4" />System Admin</Button>
          </div>
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
            backendConfig={backendConfig}
            fetchBackendConfig={fetchBackendConfig}
            anthropicPing={anthropicPing}
            pingInFlight={pingInFlight}
            fetchAnthropicPing={fetchAnthropicPing}
          />
        ))}

        {/* V5.0.8+ — Create AIOs result summary card. */}
        {createAiosResult && (
          <Card className="border-emerald-200 bg-emerald-50/30">
            <CardContent className="pt-5 pb-4 space-y-2">
              <div className="flex items-center gap-2">
                <Atom className="w-5 h-5 text-emerald-700" />
                <p className="text-sm font-semibold text-emerald-900">
                  Create AIOs result
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-7 w-7 p-0 text-muted-foreground"
                  onClick={() => setCreateAiosResult(null)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                <strong className="text-emerald-700">{createAiosResult.aiosCreated}</strong> AIO
                {createAiosResult.aiosCreated !== 1 ? "s" : ""} created from{" "}
                <strong>{createAiosResult.pdfsProcessed}</strong> PDF
                {createAiosResult.pdfsProcessed !== 1 ? "s" : ""}
                {createAiosResult.pdfsSkipped > 0 && (
                  <>
                    {" "}· skipped <strong>{createAiosResult.pdfsSkipped}</strong> already-imported PDF
                    {createAiosResult.pdfsSkipped !== 1 ? "s" : ""}
                  </>
                )}
                {createAiosResult.errors.length > 0 && (
                  <>
                    {" "}· <strong className="text-red-600">{createAiosResult.errors.length}</strong> error
                    {createAiosResult.errors.length !== 1 ? "s" : ""}
                  </>
                )}
              </p>
              {createAiosResult.errors.length > 0 && (
                <details className="text-xs text-red-700">
                  <summary className="cursor-pointer hover:underline">Show errors</summary>
                  <ul className="mt-1 space-y-0.5 pl-4 list-disc">
                    {createAiosResult.errors.slice(0, 20).map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                    {createAiosResult.errors.length > 20 && (
                      <li className="text-muted-foreground">
                        … and {createAiosResult.errors.length - 20} more
                      </li>
                    )}
                  </ul>
                </details>
              )}
            </CardContent>
          </Card>
        )}
      </main>

      {/* V5.0.8+ — View Imported PDFs dialog. Mirrors the System Admin
          pane but accessible directly from the PDF Import screen. */}
      <Dialog open={importedPdfsOpen} onOpenChange={setImportedPdfsOpen}>
        <DialogContent className="max-w-5xl w-[90vw] max-h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 py-4 border-b border-border shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Library className="w-4 h-4 text-muted-foreground" />
              Imported PDFs
              <span className="text-xs font-normal text-muted-foreground ml-2">
                {importedPdfs.length} stored
              </span>
              <Button variant="ghost" size="sm" onClick={() => void refreshImportedPdfs()} className="ml-auto gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" />Refresh
              </Button>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto p-6">
            {importedPdfsLoading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />Loading imported PDFs…
              </div>
            ) : importedPdfs.length === 0 ? (
              <div className="rounded border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                No PDFs imported yet. Drop some files above to get started.
              </div>
            ) : (
              <div className="rounded border border-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Filename</th>
                      <th className="text-right px-3 py-2 font-medium">Size</th>
                      <th className="text-right px-3 py-2 font-medium">Pages</th>
                      <th className="text-right px-3 py-2 font-medium">Rows</th>
                      <th className="text-left px-3 py-2 font-medium">Status</th>
                      <th className="text-left px-3 py-2 font-medium">Imported</th>
                      <th className="text-right px-3 py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {importedPdfs.map((item) => (
                      <tr key={item.pdf_id} className="hover:bg-muted/30">
                        <td className="px-3 py-2 max-w-[260px] truncate" title={item.filename}>
                          <FileText className="inline w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                          {item.filename}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtSize(item.size_bytes)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{item.page_count ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{item.row_count ?? "—"}</td>
                        <td className="px-3 py-2">
                          {item.status === "extracted" && (
                            <Badge variant="outline" className="border-emerald-300 text-emerald-700">Extracted</Badge>
                          )}
                          {item.status === "partial" && (
                            <Badge variant="outline" className="border-amber-300 text-amber-700" title={item.error ?? undefined}>Partial</Badge>
                          )}
                          {(item.status === "pending" || item.status === "extracting" || item.status === "finalizing") && (
                            <Badge variant="outline" className="border-blue-300 text-blue-700">{item.status}</Badge>
                          )}
                          {item.status === "failed" && (
                            <Badge variant="outline" className="border-red-300 text-red-700" title={item.error ?? undefined}>Failed</Badge>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {(() => {
                            try { return new Date(item.created_at).toLocaleString() } catch { return item.created_at }
                          })()}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-1.5">
                            <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => setPreviewPdf(item)}>
                              <Eye className="w-3.5 h-3.5" />View
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 gap-1.5" asChild>
                              <a
                                href={importedPdfContentUrl(item.pdf_id, { download: true })}
                                target="_blank"
                                rel="noopener noreferrer"
                                download={item.filename}
                              >
                                <DownloadIcon className="w-3.5 h-3.5" />Download
                              </a>
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600"
                              disabled={deletingPdfId === item.pdf_id}
                              onClick={() => void handleDeleteImported(item)}
                            >
                              {deletingPdfId === item.pdf_id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <DialogFooter className="px-6 py-3 border-t border-border shrink-0">
            <Button variant="ghost" size="sm" onClick={() => setImportedPdfsOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PDF preview dialog (iframe) — shared between header View action and queue rows. */}
      <Dialog open={!!previewPdf} onOpenChange={(open) => !open && setPreviewPdf(null)}>
        <DialogContent className="max-w-5xl w-[90vw] h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 py-4 border-b border-border shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileText className="w-4 h-4 text-muted-foreground" />
              {previewPdf?.filename}
              {previewPdf && (
                <span className="text-xs font-normal text-muted-foreground ml-2">
                  {fmtSize(previewPdf.size_bytes)}
                  {previewPdf.page_count != null && (
                    <> · {previewPdf.page_count} page{previewPdf.page_count !== 1 ? "s" : ""}</>
                  )}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 bg-muted/20">
            {previewPdf && (
              <iframe
                key={previewPdf.pdf_id}
                src={importedPdfContentUrl(previewPdf.pdf_id)}
                className="w-full h-full border-0"
                title={previewPdf.filename}
              />
            )}
          </div>
          <DialogFooter className="px-6 py-3 border-t border-border shrink-0">
            {previewPdf && (
              <Button variant="outline" size="sm" asChild>
                <a
                  href={importedPdfContentUrl(previewPdf.pdf_id, { download: true })}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={previewPdf.filename}
                >
                  <DownloadIcon className="w-3.5 h-3.5 mr-1.5" />Download original
                </a>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setPreviewPdf(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  backendConfig,
  fetchBackendConfig,
  anthropicPing,
  pingInFlight,
  fetchAnthropicPing,
}: {
  item: QueueItem
  onRemove: () => void
  onRetry: () => void
  onImport: () => void
  onDownload: () => void
  onCancel: () => void
  backendConfig: { model: string; chunk_timeout_seconds: number; anthropic_api_key_configured: boolean } | null
  fetchBackendConfig: () => Promise<void>
  anthropicPing: { ok: boolean; elapsed_seconds: number; model?: string; error?: string } | null
  pingInFlight: boolean
  fetchAnthropicPing: () => Promise<void>
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

  // V5.0.7+ — auto-fetch backend config when extraction is slow so we
  // can surface "you're on Opus, restart for Haiku" inline.
  useEffect(() => {
    if (item.status === "processing" && elapsedMs > 30_000 && !backendConfig) {
      void fetchBackendConfig()
    }
  }, [item.status, elapsedMs, backendConfig, fetchBackendConfig])

  // V5.0.8+ — auto-fire an Anthropic ping in parallel so we can tell
  // the operator whether the slowness is upstream (Anthropic) or in
  // our pipeline.
  useEffect(() => {
    if (item.status === "processing" && elapsedMs > 30_000 && !anthropicPing && !pingInFlight) {
      void fetchAnthropicPing()
    }
  }, [item.status, elapsedMs, anthropicPing, pingInFlight, fetchAnthropicPing])

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
                  {item.status === "processing" && (
                    <> · extracting via Claude Vision…</>
                  )}
                  {item.status === "success" && finalElapsedMs !== null && (
                    <> · {fmtElapsed(finalElapsedMs)}</>
                  )}
                  {item.status === "success" && item.result?.model && (
                    <> · <span className="font-mono">{item.result.model.replace(/^claude-/, "")}</span></>
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

            {/* V5.0.7+ — Simple processing block. Big elapsed timer +
                indeterminate progress bar that fills proportionally to
                elapsed-vs-expected time. No streaming/polling state to
                go wrong; the backend's sync POST returns when done. */}
            {item.status === "processing" && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-2xl font-mono font-semibold tabular-nums text-foreground">{fmtElapsed(elapsedMs)}</span>
                    <Badge variant="outline" className="border-blue-300 text-blue-700">
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />Working…
                    </Badge>
                  </div>
                  {elapsedMs > 90_000 && (
                    <span className="text-xs text-amber-700">
                      {elapsedMs > 360_000
                        ? "approaching 8-min cap, will auto-fail soon"
                        : elapsedMs > 180_000
                        ? "slow — backend may be using Sonnet/Opus instead of Haiku. Restart backend after code update?"
                        : "still working…"}
                    </span>
                  )}
                </div>
                {/* Indeterminate-ish bar: 180s baseline so the user sees
                    smooth fill for typical Haiku extractions and the bar
                    stays meaningful even on slow runs. Capped at 95% so
                    it never looks "done" prematurely. */}
                <Progress
                  value={Math.min(95, Math.round((elapsedMs / 180_000) * 90))}
                  className="h-2"
                />
                {/* V5.0.7+ — Live backend diagnostic. Auto-fetched after
                    30s of processing. Shows actual configured model so
                    the operator can immediately see if the backend is
                    on Sonnet/Opus instead of Haiku. V5.0.8+ also runs
                    an Anthropic ping in parallel to isolate whether
                    slowness is upstream or in our pipeline. */}
                {elapsedMs > 30_000 && backendConfig && (
                  <div className={`mt-2 rounded border p-2 text-xs ${
                    backendConfig.model === "claude-haiku-4-5"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                      : "border-red-300 bg-red-50 text-red-900"
                  }`}>
                    <p className="font-medium">
                      Backend is using <span className="font-mono">{backendConfig.model}</span>
                    </p>
                    {backendConfig.model !== "claude-haiku-4-5" && (
                      <p className="mt-1 leading-relaxed">
                        This is why extraction is slow.{" "}
                        <span className="font-mono">claude-haiku-4-5</span> is the recommended default
                        (3-5× faster). Either restart the backend to pick up the latest code, or set the{" "}
                        <span className="font-mono">PDF_EXTRACT_MODEL</span> env var to{" "}
                        <span className="font-mono">claude-haiku-4-5</span>.
                      </p>
                    )}
                    {!backendConfig.anthropic_api_key_configured && (
                      <p className="mt-1 leading-relaxed text-red-900">
                        ANTHROPIC_API_KEY is not configured on the backend. Open System Admin → API Key.
                      </p>
                    )}
                  </div>
                )}

                {/* Anthropic latency probe. */}
                {elapsedMs > 30_000 && (
                  <div className={`mt-2 rounded border p-2 text-xs ${
                    !anthropicPing
                      ? "border-blue-200 bg-blue-50 text-blue-900"
                      : !anthropicPing.ok
                      ? "border-red-300 bg-red-50 text-red-900"
                      : anthropicPing.elapsed_seconds < 3
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                      : anthropicPing.elapsed_seconds < 10
                      ? "border-amber-200 bg-amber-50 text-amber-900"
                      : "border-red-300 bg-red-50 text-red-900"
                  }`}>
                    {!anthropicPing && pingInFlight && (
                      <p className="flex items-center gap-1.5">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Probing Anthropic latency…
                      </p>
                    )}
                    {anthropicPing && !anthropicPing.ok && (
                      <>
                        <p className="font-medium">Anthropic ping failed after {anthropicPing.elapsed_seconds}s</p>
                        <p className="mt-1 leading-relaxed">
                          {anthropicPing.error ?? "Unknown error"}. The PDF extraction is hitting the same
                          backend; that's why it's hung. Check API key, network, and Anthropic status.
                        </p>
                      </>
                    )}
                    {anthropicPing && anthropicPing.ok && (
                      <>
                        <p className="font-medium">
                          Anthropic ping: <span className="font-mono">{anthropicPing.elapsed_seconds}s</span> on{" "}
                          <span className="font-mono">{anthropicPing.model}</span>
                          {anthropicPing.elapsed_seconds < 3 && " — Anthropic is responding normally"}
                          {anthropicPing.elapsed_seconds >= 3 && anthropicPing.elapsed_seconds < 10 && " — Anthropic is moderately slow today"}
                          {anthropicPing.elapsed_seconds >= 10 && " — Anthropic is very slow / queueing"}
                        </p>
                        {anthropicPing.elapsed_seconds < 3 && (
                          <p className="mt-1 leading-relaxed">
                            Anthropic itself is fast. The slowness is in the PDF pipeline (large file,
                            many chunks, image-heavy pages, or DB writes). Consider breaking the PDF
                            into smaller files.
                          </p>
                        )}
                        {anthropicPing.elapsed_seconds >= 10 && (
                          <p className="mt-1 leading-relaxed">
                            Anthropic is slow today — this affects your PDF extraction. Try again in a
                            few minutes, or check status.anthropic.com.
                          </p>
                        )}
                      </>
                    )}
                  </div>
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
