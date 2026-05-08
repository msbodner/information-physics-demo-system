"use client"

// Image → CSV import. Sibling of PdfImportView, single-image flow.
//
// Drop / click to pick one image (PNG/JPEG/WEBP/GIF). The "label" input
// (replaces the standalone tool's API-key field) names the resulting
// CSV file — "<label>.csv" on download, and the CSV's OriginalCSV
// column when imported into the converter. The Anthropic API key is
// taken from system settings, not entered here.

import { useState, useCallback, useRef, useEffect } from "react"
import {
  ArrowLeft, ArrowRight, Settings, Upload, Download, Loader2,
  ImageIcon, X, RefreshCw, CheckCircle2, AlertCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { csvToAio, type ConvertedFile } from "@/lib/aio-utils"
import { extractImageToCsv, type ImageExtractResult } from "@/lib/api-client"

type Status = "idle" | "processing" | "success" | "error"

const ACCEPTED_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif"]
const ACCEPTED_MIME = "image/png,image/jpeg,image/webp,image/gif"

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

function sanitizeLabel(raw: string): string {
  // Strip path separators + characters that misbehave in filenames
  // across macOS / Windows / Linux. Collapses runs of whitespace.
  return raw
    .replace(/[\/\\:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function slugForFilename(raw: string): string {
  return sanitizeLabel(raw).replace(/\s+/g, "-").toLowerCase()
}

export function ImageImportView({
  onBack,
  onSysAdmin,
  onImportCsv,
}: {
  onBack: () => void
  onSysAdmin: () => void
  onImportCsv: (csv: ConvertedFile) => void
}) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [label, setLabel] = useState("")
  const [matchProducts, setMatchProducts] = useState(true)
  const [extraContext, setExtraContext] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const [result, setResult] = useState<ImageExtractResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [imported, setImported] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [finishedAt, setFinishedAt] = useState<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const controllerRef = useRef<AbortController | null>(null)

  // Tick the elapsed counter while a request is in flight.
  useEffect(() => {
    if (status !== "processing" || startedAt === null) {
      setElapsedMs(0)
      return
    }
    const t0 = startedAt
    setElapsedMs(Date.now() - t0)
    const id = setInterval(() => setElapsedMs(Date.now() - t0), 500)
    return () => clearInterval(id)
  }, [status, startedAt])

  // Revoke object URLs when the preview changes / view unmounts so we
  // don't leak browser memory on repeated re-imports.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const acceptFile = useCallback((f: File) => {
    const lower = f.name.toLowerCase()
    if (!ACCEPTED_EXTS.some((ext) => lower.endsWith(ext))) {
      setError("Unsupported image type — use PNG, JPEG, WEBP, or GIF.")
      return
    }
    setError(null)
    setResult(null)
    setImported(false)
    setStatus("idle")
    setStartedAt(null)
    setFinishedAt(null)
    setFile(f)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(f))
    if (!label.trim()) {
      // Seed the label from the filename so the user has a sane
      // default — they can still rewrite it before analyzing.
      const base = f.name.replace(/\.[^.]+$/, "")
      setLabel(base)
    }
  }, [previewUrl, label])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) acceptFile(f)
  }, [acceptFile])

  const onPickClick = useCallback(() => fileInputRef.current?.click(), [])

  const removeFile = useCallback(() => {
    setFile(null)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setResult(null)
    setError(null)
    setImported(false)
    setStatus("idle")
    setStartedAt(null)
    setFinishedAt(null)
  }, [previewUrl])

  const analyze = useCallback(async () => {
    if (!file) return
    if (!sanitizeLabel(label)) {
      setError("Enter a descriptive label — it names the produced CSV.")
      return
    }
    setError(null)
    setResult(null)
    setImported(false)
    setStatus("processing")
    setStartedAt(Date.now())
    setFinishedAt(null)

    // Web-search loops can take ~2-3 minutes; bump timeout when on.
    const timeoutMs = matchProducts ? 360_000 : 180_000

    const controller = new AbortController()
    controllerRef.current = controller

    const data = await extractImageToCsv(file, {
      signal: controller.signal,
      timeoutMs,
      matchProducts,
      extraContext: extraContext.trim() || undefined,
    })
    controllerRef.current = null
    const finished = Date.now()
    setFinishedAt(finished)

    if (!data) {
      setStatus("error")
      setError("Backend unreachable. Is the API running?")
      return
    }
    if ("error" in data) {
      setStatus("error")
      const detail = data.error
      const lower = detail.toLowerCase()
      if (lower.includes("api_key") || lower.includes("not configured")) {
        setError("Anthropic API key not configured. Open System Admin → API Key.")
      } else {
        setError(detail)
      }
      return
    }
    if (!data.headers.length) {
      setStatus("error")
      setError("Extraction returned no rows — image may not contain identifiable items.")
      return
    }
    setResult(data)
    setStatus("success")
  }, [file, label, matchProducts, extraContext])

  const cancel = useCallback(() => {
    controllerRef.current?.abort(new DOMException("Cancelled by operator", "AbortError"))
  }, [])

  const csvFilename = useCallback(() => {
    const slug = slugForFilename(label) || "image-extraction"
    return `${slug}.csv`
  }, [label])

  const downloadCsv = useCallback(() => {
    if (!result) return
    const blob = new Blob([result.csv_text], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = csvFilename()
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [result, csvFilename])

  const importToConverter = useCallback(() => {
    if (!result) return
    const filename = csvFilename()
    const now = new Date()
    const date = now.toISOString().substring(0, 10)
    const time = now.toISOString().substring(11, 19)
    const converted: ConvertedFile = {
      originalName: filename,
      csvData: [result.headers, ...result.rows],
      headers: result.headers,
      aioLines: result.rows.map((row) =>
        csvToAio(result.headers, row, filename, date, time),
      ),
      fileDate: date,
      fileTime: time,
    }
    onImportCsv(converted)
    setImported(true)
  }, [result, csvFilename, onImportCsv])

  const finalElapsedMs = finishedAt && startedAt ? finishedAt - startedAt : null

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-4 flex-wrap">
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
              <ArrowLeft className="w-4 h-4" />Back
            </Button>
            <h1 className="text-lg font-bold text-foreground">Import Images → CSVs</h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={onSysAdmin} className="gap-2">
              <Settings className="w-4 h-4" />System Admin
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* ── Drop zone ── */}
        <Card>
          <CardContent className="pt-6">
            {!file ? (
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                onClick={onPickClick}
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${isDragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"}`}
              >
                <ImageIcon className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                <p className="text-base font-medium text-foreground mb-1">
                  Drop an image here, or click to browse
                </p>
                <p className="text-sm text-muted-foreground">
                  PNG, JPEG, WEBP, or GIF — extracted via Claude Vision into a product CSV.
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  One row per identified item (description, sizing, colors, material, condition, USD range, brand, tags…).
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_MIME}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) acceptFile(f)
                    e.target.value = ""
                  }}
                />
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row gap-4">
                {previewUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt={file.name}
                    className="rounded-md border border-border max-w-[240px] max-h-[240px] object-contain bg-muted"
                  />
                )}
                <div className="flex-1 min-w-0 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{fmtSize(file.size)}</p>
                    </div>
                    {status !== "processing" && (
                      <Button size="sm" variant="ghost" onClick={removeFile} className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600">
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>

                  {/* Label field — replaces the API-key input from the
                      standalone tool. The slug names the CSV. */}
                  <label className="block text-sm">
                    <span className="text-foreground font-medium">Descriptive label</span>
                    <input
                      type="text"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="e.g. kitchen-tools-2026-05-07"
                      disabled={status === "processing"}
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                    />
                    <span className="block text-xs text-muted-foreground mt-1">
                      Names the produced file: <span className="font-mono">{slugForFilename(label) || "image-extraction"}.csv</span>
                    </span>
                  </label>

                  <label className="block text-sm">
                    <span className="text-foreground font-medium">Extra instructions (optional)</span>
                    <textarea
                      value={extraContext}
                      onChange={(e) => setExtraContext(e.target.value)}
                      placeholder="e.g. focus on kitchen equipment, ignore background shelves"
                      rows={2}
                      disabled={status === "processing"}
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                    />
                  </label>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={matchProducts}
                      onChange={(e) => setMatchProducts(e.target.checked)}
                      disabled={status === "processing"}
                      className="rounded"
                    />
                    <span>Match likely products with web search (slower, adds Match URL)</span>
                  </label>
                </div>
              </div>
            )}
            {error && <p className="text-sm text-red-600 mt-4">{error}</p>}
          </CardContent>
        </Card>

        {/* ── Action row ── */}
        {file && (
          <div className="flex justify-end gap-2 flex-wrap">
            {status === "processing" ? (
              <Button variant="outline" onClick={cancel} className="gap-2 border-amber-300 text-amber-700 hover:bg-amber-50">
                <X className="w-4 h-4" />Cancel
              </Button>
            ) : (
              <>
                {status === "error" && (
                  <Button variant="outline" onClick={analyze} className="gap-2">
                    <RefreshCw className="w-4 h-4" />Retry
                  </Button>
                )}
                {status === "idle" && (
                  <Button onClick={analyze} className="gap-2 bg-primary">
                    <Upload className="w-4 h-4" />Analyze image
                  </Button>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Processing block ── */}
        {status === "processing" && (
          <Card className="border-blue-200">
            <CardContent className="pt-5 pb-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-2xl font-mono font-semibold tabular-nums text-foreground">{fmtElapsed(elapsedMs)}</span>
                <Badge variant="outline" className="border-blue-300 text-blue-700">
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />Analyzing via Claude Vision…
                </Badge>
                {matchProducts && (
                  <span className="text-xs text-muted-foreground">web search enabled — can take 1-3 min</span>
                )}
              </div>
              <Progress
                value={Math.min(95, Math.round((elapsedMs / (matchProducts ? 180_000 : 90_000)) * 90))}
                className="h-2"
              />
            </CardContent>
          </Card>
        )}

        {/* ── Result ── */}
        {status === "success" && result && (
          <Card className="border-emerald-200">
            <CardContent className="pt-5 pb-4 space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                    <CheckCircle2 className="w-3 h-3 mr-1" />Ready
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {result.document_count} row{result.document_count !== 1 ? "s" : ""} · {result.headers.length} columns
                    {finalElapsedMs !== null && <> · {fmtElapsed(finalElapsedMs)}</>}
                    {result.model && <> · <span className="font-mono">{result.model.replace(/^claude-/, "")}</span></>}
                  </span>
                  {imported && (
                    <Badge variant="outline" className="border-primary/40 text-primary">Imported</Badge>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={downloadCsv} className="gap-1.5">
                    <Download className="w-3.5 h-3.5" />Download {csvFilename()}
                  </Button>
                  {!imported && (
                    <Button size="sm" onClick={importToConverter} className="gap-1.5 bg-primary">
                      <ArrowRight className="w-3.5 h-3.5" />Import to converter
                    </Button>
                  )}
                </div>
              </div>

              <div className="rounded border border-border overflow-auto max-h-[420px]">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium text-[11px] text-muted-foreground w-8">#</th>
                      {result.headers.map((h, i) => (
                        <th key={i} className="text-left px-2 py-1.5 font-medium text-[11px] whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {result.rows.slice(0, 100).map((row, ri) => (
                      <tr key={ri} className="hover:bg-muted/30">
                        <td className="px-2 py-1 text-[11px] text-muted-foreground">{ri + 1}</td>
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-2 py-1 text-[11px] whitespace-nowrap max-w-[220px] truncate" title={cell}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.rows.length > 100 && (
                  <p className="text-[11px] text-muted-foreground p-2 bg-muted/20 border-t border-border">
                    Showing first 100 of {result.rows.length} rows · download CSV to see all
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Error block ── */}
        {status === "error" && error && (
          <Card className="border-red-200">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-700">Extraction failed</p>
                  <p className="text-xs text-red-600 mt-1 leading-relaxed">{error}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
