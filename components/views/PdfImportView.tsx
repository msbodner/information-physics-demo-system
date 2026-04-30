"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { ArrowLeft, ArrowRight, Settings, Upload, Download, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { csvToAio, type ConvertedFile } from "@/lib/aio-utils"
import { extractPdfToCsv } from "@/lib/api-client"

export function PdfImportView({ onBack, onSysAdmin, onImportCsv }: { onBack: () => void; onSysAdmin: () => void; onImportCsv: (csv: ConvertedFile) => void }) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [result, setResult] = useState<PdfExtractResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [processingFile, setProcessingFile] = useState<{ name: string; sizeMB: number; estimatedChunks: number } | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Live elapsed-time counter during processing. Resets when isProcessing
  // flips false. The backend has no SSE channel, so this is a UX-only
  // signal showing the user the request is alive — not a real progress
  // bar. Page-count estimate ≈ filesize / 50KB per page (rough rule of
  // thumb for text-PDFs); chunk estimate = ceil(pages / 100).
  useEffect(() => {
    if (!isProcessing) {
      setElapsedSec(0)
      return
    }
    const t0 = Date.now()
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - t0) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [isProcessing])

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please select a PDF file")
      return
    }
    setIsProcessing(true)
    setError(null)
    setResult(null)
    const sizeMB = file.size / 1_048_576
    // Heuristic: avg ~50KB per page for text-heavy PDFs. Caps at 1
    // chunk for tiny files. This is intentionally rough — gives users
    // a "this is going to take ~N minutes" expectation, not a precise
    // forecast.
    const estimatedPages = Math.max(1, Math.round(file.size / 51200))
    const estimatedChunks = Math.max(1, Math.ceil(estimatedPages / 100))
    setProcessingFile({ name: file.name, sizeMB, estimatedChunks })
    const data = await extractPdfToCsv(file)
    setIsProcessing(false)
    setProcessingFile(null)
    if (!data) {
      setError("Backend unreachable. Check that the API service is running.")
      return
    }
    if ("error" in data) {
      const detail = data.error
      const lower = detail.toLowerCase()
      if (lower.includes("api_key") || lower.includes("not configured")) {
        setError("Anthropic API key not configured. Open System Admin → API Key and paste your key (starts with sk-ant-…).")
      } else {
        setError(`PDF extraction failed: ${detail}`)
      }
      return
    }
    if (data.headers.length > 0) {
      setResult(data)
    } else {
      setError("PDF extraction returned no rows. The PDF may be image-only or empty — try a text-based PDF.")
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleDownloadCsv = useCallback(() => {
    if (!result) return
    const blob = new Blob([result.csv_text], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    const baseName = result.filename?.replace(/\.pdf$/i, "") ?? "extracted"
    a.download = `${baseName}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [result])

  const handleImportToConverter = useCallback(() => {
    if (!result) return
    const baseName = result.filename?.replace(/\.pdf$/i, "") ?? "extracted"
    const now = new Date()
    const converted: ConvertedFile = {
      originalName: `${baseName}.csv`,
      csvData: [result.headers, ...result.rows],
      headers: result.headers,
      aioLines: result.rows.map((row) => csvToAio(result.headers, row, `${baseName}.csv`, now.toISOString().substring(0, 10), now.toISOString().substring(11, 19))),
      fileDate: now.toISOString().substring(0, 10),
      fileTime: now.toISOString().substring(11, 19),
    }
    onImportCsv(converted)
  }, [result, onImportCsv])

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

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Upload Area */}
        {!result && !isProcessing && (
          <Card>
            <CardContent className="pt-6">
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${isDragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"}`}
              >
                <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-lg font-medium text-foreground mb-2">Drop a PDF file here or click to browse</p>
                <p className="text-sm text-muted-foreground">Supports invoices, reports, statements, and other structured documents</p>
                <p className="text-xs text-muted-foreground mt-2">Claude AI will extract all structured data and create a CSV</p>
                <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = "" }} />
              </div>
              {error && <p className="text-sm text-red-500 mt-4 text-center">{error}</p>}
            </CardContent>
          </Card>
        )}

        {/* Processing */}
        {isProcessing && (
          <Card>
            <CardContent className="py-12 text-center">
              <Loader2 className="w-12 h-12 mx-auto mb-4 text-primary animate-spin" />
              <p className="text-lg font-medium text-foreground mb-1">Analyzing PDF with Claude AI…</p>
              {processingFile && (
                <p className="text-sm text-muted-foreground mb-4">
                  <span className="font-mono">{processingFile.name}</span>
                  {" · "}
                  {processingFile.sizeMB.toFixed(1)} MB
                  {processingFile.estimatedChunks > 1 && (
                    <>
                      {" · "}~{processingFile.estimatedChunks} chunks (100 pages each)
                    </>
                  )}
                </p>
              )}
              <div className="inline-flex items-center gap-3 px-4 py-2 rounded-md border border-border bg-muted/40">
                <div className="text-2xl font-mono font-semibold tabular-nums text-foreground">
                  {Math.floor(elapsedSec / 60)}:{String(elapsedSec % 60).padStart(2, "0")}
                </div>
                <div className="text-xs text-muted-foreground text-left">
                  elapsed
                  {processingFile && processingFile.estimatedChunks > 1 && (
                    <div>typical: ~{processingFile.estimatedChunks * 45}s for this size</div>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-5 max-w-md mx-auto">
                {processingFile && processingFile.estimatedChunks > 1
                  ? "Large PDFs are split into 100-page chunks and processed sequentially. Each chunk takes ~30–60s on Claude. The request is still alive — please don't close this tab."
                  : "Extracting structured data and building CSV. Typical time: 15–45s."}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {result && (
          <>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold">Extracted CSV from: {result.filename}</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">{result.document_count} record{result.document_count !== 1 ? "s" : ""} extracted · {result.headers.length} columns</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={handleDownloadCsv} className="gap-2"><Download className="w-4 h-4" />Save as CSV</Button>
                    <Button size="sm" onClick={handleImportToConverter} className="gap-2 bg-primary"><ArrowRight className="w-4 h-4" />Import to AIO Converter</Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded border border-border overflow-auto max-h-[500px]">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground w-8">#</th>
                        {result.headers.map((h, i) => (
                          <th key={i} className="text-left px-3 py-2 font-medium text-xs whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {result.rows.map((row, ri) => (
                        <tr key={ri} className="hover:bg-muted/30">
                          <td className="px-3 py-2 text-xs text-muted-foreground">{ri + 1}</td>
                          {row.map((cell, ci) => (
                            <td key={ci} className="px-3 py-2 text-xs whitespace-nowrap max-w-[200px] truncate">{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Raw CSV view */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Raw CSV Output</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs font-mono bg-muted/30 rounded-lg p-4 overflow-auto max-h-[300px] whitespace-pre-wrap">{result.csv_text}</pre>
              </CardContent>
            </Card>

            {/* Upload another */}
            <div className="text-center">
              <Button variant="outline" onClick={() => { setResult(null); setError(null) }} className="gap-2"><Upload className="w-4 h-4" />Import Another PDF</Button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
