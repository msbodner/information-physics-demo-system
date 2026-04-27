"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Download, Copy, Check, ArrowLeft, FileText, Package, Zap, MessageSquare, Loader2, Eye, Database, Layers } from "lucide-react"
import type { ConvertedFile } from "@/app/page"
import { listAioData, type AioDataRecord } from "@/lib/api-client"
import { ChatAioDialog } from "@/components/chat-aio-dialog"
import { cn } from "@/lib/utils"

interface ConversionPreviewProps {
  files: ConvertedFile[]
  onClear: () => void
  onProcess: (downloadedFiles: string[]) => void
  backendIsOnline: boolean
}

export function ConversionPreview({ files, onClear, onProcess, backendIsOnline }: ConversionPreviewProps) {
  const [activeFileIndex, setActiveFileIndex] = useState(0)
  const [selectedRowIndex, setSelectedRowIndex] = useState(0)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloadStatus, setDownloadStatus] = useState<"idle" | "success" | "error">("idle")
  const [downloadAllStatus, setDownloadAllStatus] = useState<"idle" | "success" | "error">("idle")
  const [downloadedFiles, setDownloadedFiles] = useState<string[]>([])
  const [showDownloaded, setShowDownloaded] = useState(false)
  const [showRowModal, setShowRowModal] = useState(false)

  // View All AIOs state
  const [showViewAios, setShowViewAios] = useState(false)
  const [aioRecords, setAioRecords] = useState<AioDataRecord[]>([])
  const [isLoadingAios, setIsLoadingAios] = useState(false)
  const [viewingAio, setViewingAio] = useState<AioDataRecord | null>(null)

  const handleOpenViewAios = useCallback(async () => {
    setShowViewAios(true)
    setIsLoadingAios(true)
    const records = await listAioData()
    setAioRecords(records)
    setIsLoadingAios(false)
  }, [])

  // ChatAIO state
  const [showChat, setShowChat] = useState(false)

  const activeFile = files[activeFileIndex]

  // Track per-handler reset timeouts so a fast re-click clears the prior timer
  // and we never queue overlapping resets that flicker the status pill.
  const resetTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({})
  const scheduleReset = useCallback((key: string, ms: number, fn: () => void) => {
    const prior = resetTimeoutsRef.current[key]
    if (prior) clearTimeout(prior)
    resetTimeoutsRef.current[key] = setTimeout(() => {
      resetTimeoutsRef.current[key] = null
      fn()
    }, ms)
  }, [])
  useEffect(() => () => {
    for (const k of Object.keys(resetTimeoutsRef.current)) {
      const t = resetTimeoutsRef.current[k]
      if (t) clearTimeout(t)
    }
  }, [])

  const handleCopyAio = useCallback(async () => {
    setError(null)
    try {
      const content = activeFile.aioLines[selectedRowIndex]
      await navigator.clipboard.writeText(content)
      setCopied(true)
      scheduleReset("copied", 2000, () => setCopied(false))
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to copy"
      setError(`Copy failed: ${message}`)
    }
  }, [activeFile, selectedRowIndex])

  const triggerDownload = useCallback((fileName: string, content: string) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, [])

  const handleDownloadSelectedAio = useCallback(() => {
    setError(null)
    setDownloadStatus("idle")
    try {
      if (!activeFile || !activeFile.aioLines || !activeFile.aioLines[selectedRowIndex]) {
        throw new Error("No AIO content available for selected row")
      }
      const content = activeFile.aioLines[selectedRowIndex] + "\n"
      const fileName = activeFile.originalName.replace(/\.csv$/i, `-row${selectedRowIndex + 1}.aio`)
      triggerDownload(fileName, content)
      setDownloadStatus("success")
      setDownloadedFiles(prev => [...prev, fileName])
      scheduleReset("downloadStatus", 3000, () => setDownloadStatus("idle"))
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      setError(`Download failed: ${message}`)
      setDownloadStatus("error")
      scheduleReset("downloadStatus", 5000, () => setDownloadStatus("idle"))
    }
  }, [activeFile, selectedRowIndex, triggerDownload, scheduleReset])

  const handleDownloadAllAios = useCallback(() => {
    setError(null)
    setDownloadAllStatus("idle")
    try {
      if (!files || files.length === 0) {
        throw new Error("No files to download")
      }
      let counter = 0
      files.forEach((file) => {
        const baseName = file.originalName.replace(/\.csv$/i, "")
        file.aioLines.forEach((line, rowIndex) => {
          counter++
          setTimeout(() => {
            const content = line + "\n"
            const aioFileName = `${baseName}_${String(counter).padStart(4, "0")}.aio`
            triggerDownload(aioFileName, content)
            setDownloadedFiles(prev => [...prev, aioFileName])
          }, rowIndex * 150)
        })
      })
      setDownloadAllStatus("success")
      scheduleReset("downloadAllStatus", 3000, () => setDownloadAllStatus("idle"))
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      setError(`Download all failed: ${message}`)
      setDownloadAllStatus("error")
      scheduleReset("downloadAllStatus", 5000, () => setDownloadAllStatus("idle"))
    }
  }, [files, triggerDownload, scheduleReset])

  const [bulkStatus, setBulkStatus] = useState<"idle" | "running" | "success" | "error">("idle")

  const handleBulkProcessAll = useCallback(() => {
    setError(null)
    setBulkStatus("running")
    try {
      if (!files || files.length === 0) {
        throw new Error("No files loaded")
      }

      // Build the in-memory AIO file list across every loaded CSV — no machine downloads.
      let counter = 0
      const aioFileNames: string[] = []
      files.forEach((file) => {
        const baseName = file.originalName.replace(/\.csv$/i, "")
        file.aioLines.forEach(() => {
          counter++
          aioFileNames.push(`${baseName}_${String(counter).padStart(4, "0")}.aio`)
        })
      })

      setBulkStatus("success")
      onProcess(aioFileNames)
      scheduleReset("bulkStatus", 2500, () => setBulkStatus("idle"))
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      setError(`Bulk process failed: ${message}`)
      setBulkStatus("error")
      scheduleReset("bulkStatus", 4000, () => setBulkStatus("idle"))
    }
  }, [files, onProcess, scheduleReset])

  const STARTER_PROMPTS = [
    "What vendors are in this data?",
    "Total invoice amount by vendor",
    "Summarize the data",
    "List all unique values for each field",
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          onClick={() => {
            const fileNames = downloadedFiles.length > 0
              ? downloadedFiles
              : files.flatMap((f, fi) =>
                f.aioLines.map((_, ri) =>
                  `${f.originalName.replace(/\.csv$/i, "")}_${String(fi * 1000 + ri + 1).padStart(4, "0")}.aio`
                )
              )
            onProcess(fileNames)
          }}
          className="flex-1 gap-2 bg-blue-900 hover:bg-blue-950 text-white"
        >
          <Zap className="w-4 h-4" />
          Process AIO Files via Hyper-Semantic Logic
        </Button>
        {files.length > 1 && (
          <Button
            onClick={handleBulkProcessAll}
            disabled={bulkStatus === "running"}
            className={cn(
              "gap-2 shrink-0 bg-emerald-700 hover:bg-emerald-800 text-white",
              bulkStatus === "success" && "bg-green-600 hover:bg-green-700",
              bulkStatus === "error" && "bg-destructive hover:bg-destructive/90",
            )}
            title={`Auto-save ${files.length} CSVs + all AIO files, then run Hyper-Semantic Logic on the bulk set`}
          >
            {bulkStatus === "running" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Layers className="w-4 h-4" />
            )}
            {bulkStatus === "success"
              ? "Bulk Saved!"
              : bulkStatus === "error"
                ? "Bulk Failed"
                : "Bulk: All Newly Loaded Files"}
          </Button>
        )}
        {backendIsOnline && (
          <Button
            variant="outline"
            onClick={() => setShowChat(true)}
            className="gap-2 shrink-0"
          >
            <MessageSquare className="w-4 h-4" />
            ChatAIO
          </Button>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          Error: {error}
          <button onClick={() => setError(null)} className="ml-4 underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={onClear} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Upload more files
        </Button>
        {downloadedFiles.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => setShowDownloaded(!showDownloaded)} className="gap-2">
            <Package className="w-4 h-4" />
            View Downloaded ({downloadedFiles.length})
          </Button>
        )}
      </div>

      {showDownloaded && downloadedFiles.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Downloaded Files (saved to your Downloads folder)</CardTitle>
              <button onClick={() => setDownloadedFiles([])} className="text-xs text-green-600 hover:text-green-800">
                Clear list
              </button>
            </div>
          </CardHeader>
          <CardContent className="py-2">
            <div className="max-h-32 overflow-y-auto space-y-1">
              {downloadedFiles.map((fileName, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FileText className="w-3 h-3 text-green-600" />
                  {fileName}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {files.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {files.map((file, index) => (
            <Button key={index} variant={index === activeFileIndex ? "default" : "outline"} size="sm" onClick={() => { setActiveFileIndex(index); setSelectedRowIndex(0); }} className="gap-2">
              <FileText className="w-3 h-3" />
              {file.originalName}
            </Button>
          ))}
        </div>
      )}

      <div className="grid gap-4">
        {/* CSV Grid View */}
        <Card className="max-w-[100vw] overflow-hidden max-h-[calc(100vh-200px)] flex flex-col">
          <CardHeader className="py-3 shrink-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="w-4 h-4" />
                CSV Data
                <span className="text-xs font-normal text-muted-foreground">
                  ({activeFile.csvData.length} rows)
                </span>
              </CardTitle>
              <Button variant="outline" size="sm" onClick={handleOpenViewAios} className="gap-2 text-xs">
                <Eye className="w-3 h-3" />
                View All AIOs
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-hidden flex-1 min-h-0">
            <div className="h-full overflow-x-auto overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground w-12">#</th>
                    {activeFile.headers.map((header) => (
                      <th key={header} className="px-3 py-2 text-left font-medium text-muted-foreground">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeFile.csvData.map((row, rowIndex) => (
                    <tr
                      key={rowIndex}
                      className={cn("border-t border-border cursor-pointer transition-colors", rowIndex === selectedRowIndex ? "bg-primary/10" : "hover:bg-accent/50")}
                      onClick={() => { setSelectedRowIndex(rowIndex); setShowRowModal(true) }}
                    >
                      <td className="px-3 py-2 text-muted-foreground">{rowIndex + 1}</td>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className="px-3 py-2 max-w-[200px] truncate" title={cell}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* AIO Output View */}
        <Card className="max-w-[100vw] overflow-hidden max-h-[calc(100vh-200px)] flex flex-col">
          <CardHeader className="py-3 shrink-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                AIO Output
                <span className="text-xs font-normal text-muted-foreground">
                  (Row {selectedRowIndex + 1})
                </span>
              </CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleCopyAio} className="gap-2 text-xs">
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button variant="outline" size="sm" onClick={handleDownloadSelectedAio} className={cn("gap-2 text-xs", downloadStatus === "success" && "text-green-600 border-green-600", downloadStatus === "error" && "text-destructive border-destructive")}>
                  <Download className="w-3 h-3" />
                  {downloadStatus === "success" ? "Downloaded!" : downloadStatus === "error" ? "Failed!" : "Download .aio"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto overflow-y-auto flex-1 min-h-0">
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-muted font-mono text-xs break-all leading-relaxed overflow-x-auto">
                {activeFile.aioLines[selectedRowIndex]}
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">AIO Format Breakdown:</p>
                <div className="flex flex-wrap gap-1">
                  <span className="inline-flex px-2 py-0.5 rounded bg-primary/15 text-primary text-xs font-mono">
                    [OriginalCSV.{activeFile.originalName}]
                  </span>
                  <span className="inline-flex px-2 py-0.5 rounded bg-primary/15 text-primary text-xs font-mono">
                    [FileDate.{activeFile.fileDate}]
                  </span>
                  <span className="inline-flex px-2 py-0.5 rounded bg-primary/15 text-primary text-xs font-mono">
                    [FileTime.{activeFile.fileTime}]
                  </span>
                  {activeFile.headers.map((header, idx) => (
                    <span key={idx} className="inline-flex px-2 py-0.5 rounded bg-secondary text-foreground text-xs font-mono">
                      [{header}.{activeFile.csvData[selectedRowIndex]?.[idx] ?? ""}]
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row Detail Modal */}
      <Dialog open={showRowModal} onOpenChange={setShowRowModal}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <FileText className="w-4 h-4 text-primary" />
              Row {selectedRowIndex + 1}
              <span className="font-normal text-muted-foreground">— {activeFile.originalName}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="overflow-auto flex-1 space-y-5 pr-1">
            {/* Field / Value table */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">CSV Data</p>
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-1/3">Field</th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeFile.headers.map((header, idx) => (
                      <tr key={idx} className={idx % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground border-r border-border align-top pt-2.5">{header}</td>
                        <td className="px-4 py-2 text-sm break-words">{activeFile.csvData[selectedRowIndex]?.[idx] ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* AIO breakdown chips */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">AIO Elements</p>
              <div className="flex flex-wrap gap-1.5">
                <span className="inline-flex px-2 py-1 rounded bg-primary/15 text-primary text-xs font-mono">[OriginalCSV.{activeFile.originalName}]</span>
                <span className="inline-flex px-2 py-1 rounded bg-primary/15 text-primary text-xs font-mono">[FileDate.{activeFile.fileDate}]</span>
                <span className="inline-flex px-2 py-1 rounded bg-primary/15 text-primary text-xs font-mono">[FileTime.{activeFile.fileTime}]</span>
                {activeFile.headers.map((header, idx) => (
                  <span key={idx} className="inline-flex px-2 py-1 rounded bg-secondary text-foreground text-xs font-mono">
                    [{header}.{activeFile.csvData[selectedRowIndex]?.[idx] ?? ""}]
                  </span>
                ))}
              </div>
            </div>

            {/* Full AIO line */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Full AIO String</p>
              <div className="p-3 rounded-lg bg-muted font-mono text-xs break-all leading-relaxed select-all">
                {activeFile.aioLines[selectedRowIndex]}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* View All AIOs Modal */}
      <Dialog open={showViewAios} onOpenChange={setShowViewAios}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Database className="w-5 h-5 text-primary" />
              Stored AIOs
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto min-h-0">
            {isLoadingAios ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : aioRecords.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">No AIOs saved yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">AIO Name</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-24">Elements</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-44">Created</th>
                    <th className="px-4 py-2.5 w-16" />
                  </tr>
                </thead>
                <tbody>
                  {aioRecords.map((rec) => {
                    const elemCount = rec.elements.filter(Boolean).length
                    return (
                      <tr key={rec.aio_id} className="border-t border-border hover:bg-accent/40 transition-colors">
                        <td className="px-4 py-2 font-mono text-xs">{rec.aio_name}</td>
                        <td className="px-4 py-2 text-muted-foreground text-xs">{elemCount}</td>
                        <td className="px-4 py-2 text-muted-foreground text-xs">{new Date(rec.created_at).toLocaleString()}</td>
                        <td className="px-4 py-2">
                          <Button variant="ghost" size="sm" className="gap-1 text-xs h-7 px-2" onClick={() => setViewingAio(rec)}>
                            <Eye className="w-3 h-3" />
                            View
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* AIO Detail (read-only) Modal */}
      <Dialog open={!!viewingAio} onOpenChange={(open) => { if (!open) setViewingAio(null) }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <FileText className="w-4 h-4 text-primary" />
              {viewingAio?.aio_name}
              <span className="text-xs font-normal text-muted-foreground ml-1">(read-only)</span>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto min-h-0 space-y-4">
            {viewingAio && (
              <>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">AIO Elements</p>
                  <div className="flex flex-wrap gap-1.5">
                    {viewingAio.elements.map((el, idx) =>
                      el ? (
                        <span key={idx} className="inline-flex px-2 py-1 rounded bg-secondary text-foreground text-xs font-mono">
                          {el}
                        </span>
                      ) : null
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Full AIO String</p>
                  <div className="p-3 rounded-lg bg-muted font-mono text-xs break-all leading-relaxed select-all">
                    {viewingAio.elements.filter(Boolean).join("")}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
                  <div><span className="font-medium text-foreground">Created:</span> {new Date(viewingAio.created_at).toLocaleString()}</div>
                  <div><span className="font-medium text-foreground">Updated:</span> {new Date(viewingAio.updated_at).toLocaleString()}</div>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ChatAioDialog open={showChat} onOpenChange={setShowChat} />
    </div>
  )
}
