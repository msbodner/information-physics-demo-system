"use client"

import { useState, useCallback, useRef } from "react"
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
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please select a PDF file")
      return
    }
    setIsProcessing(true)
    setError(null)
    setResult(null)
    const data = await extractPdfToCsv(file)
    setIsProcessing(false)
    if (data && data.headers.length > 0) {
      setResult(data)
    } else {
      setError("Failed to extract data from PDF. Make sure the Anthropic API key is configured in System Admin.")
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
            <CardContent className="py-16 text-center">
              <Loader2 className="w-12 h-12 mx-auto mb-4 text-primary animate-spin" />
              <p className="text-lg font-medium text-foreground mb-2">Analyzing PDF with Claude AI...</p>
              <p className="text-sm text-muted-foreground">Extracting structured data and building CSV. This may take a moment.</p>
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
