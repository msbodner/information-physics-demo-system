"use client"

import { useState, useCallback, useMemo, useEffect } from "react"
import { ArrowLeft, Search, X, Download, Database, Layers, Cpu, FileText, Network, Loader2, Settings, FileSpreadsheet, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { toast } from "sonner"
import { parseAioLine, type ConvertedFile, type ParsedAio, type ParsedElement } from "@/lib/aio-utils"
import { summarizeAIOs, resolveEntities, listHslData, createIO, createHslData, listAioData, listInformationElements, type IORecord, type EntityItem, type HslDataRecord, type AioDataRecord, type InformationElement } from "@/lib/api-client"
import { ChatAioDialog } from "@/components/chat-aio-dialog"

export function SemanticProcessor({ files, downloadedFiles, onBack, backendIsOnline, onSysAdmin }: { files: ConvertedFile[]; downloadedFiles: string[]; onBack: () => void; backendIsOnline: boolean; onSysAdmin: () => void }) {
  const [selectedAioIndex, setSelectedAioIndex] = useState<number | null>(null)
  const [selectedElement, setSelectedElement] = useState<ParsedElement | null>(null)
  const [summaryCsv, setSummaryCsv] = useState<{ headers: string[]; rows: string[][]; csvString: string } | null>(null)
  const [hslData, setHslData] = useState<{ label: string; fileName: string; rows: { aioName: string; csvRoot: string; lineNumber: number; createdAt: string }[]; content: string } | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [summaryText, setSummaryText] = useState<string | null>(null)
  const [isSummarizing, setIsSummarizing] = useState(false)
  const [entityData, setEntityData] = useState<EntityItem[] | null>(null)
  const [isExtractingEntities, setIsExtractingEntities] = useState(false)
  const [showHslDb, setShowHslDb] = useState(false)
  const [hslDbRecords, setHslDbRecords] = useState<HslDataRecord[]>([])
  const [isLoadingHslDb, setIsLoadingHslDb] = useState(false)
  const [hslDbSelectedRecord, setHslDbSelectedRecord] = useState<HslDataRecord | null>(null)
  const [backendAios, setBackendAios] = useState<ParsedAio[]>([])
  const [isLoadingBackendAios, setIsLoadingBackendAios] = useState(false)
  const [showChat, setShowChat] = useState(false)

  useEffect(() => {
    if (!backendIsOnline) return
    setIsLoadingBackendAios(true)
    listAioData().then((records: AioDataRecord[]) => {
      const parsed: ParsedAio[] = records.map((r) => {
        const raw = r.elements.filter(Boolean).join("")
        const csvRoot = r.aio_name.replace(/\s*-\s*Row\s*\d+$/i, "").replace(/\.csv$/i, "") || "backend"
        const lineNumberMatch = r.aio_name.match(/-\s*Row\s*(\d+)$/i)
        const lineNumber = lineNumberMatch ? parseInt(lineNumberMatch[1], 10) : 0
        return { fileName: r.aio_name, elements: parseAioLine(raw), raw, csvRoot, lineNumber }
      })
      setBackendAios(parsed)
      setIsLoadingBackendAios(false)
    }).catch(() => setIsLoadingBackendAios(false))
  }, [backendIsOnline])

  const parsedAios = useMemo<ParsedAio[]>(() => {
    const results: ParsedAio[] = []
    files.forEach((file, fileIndex) => {
      const csvRoot = file.originalName.replace(/\.csv$/i, "")
      file.aioLines.forEach((line, lineIndex) => {
        const elements = parseAioLine(line)
        const fileName = downloadedFiles.length > 0
          ? downloadedFiles[fileIndex * file.aioLines.length + lineIndex] ?? `${csvRoot}_${String(fileIndex * 1000 + lineIndex + 1).padStart(4, "0")}.aio`
          : `${csvRoot}_${String(fileIndex * 1000 + lineIndex + 1).padStart(4, "0")}.aio`
        results.push({ fileName, elements, raw: line, csvRoot, lineNumber: lineIndex + 1 })
      })
    })
    // Merge backend AIOs, deduplicating by raw line
    const rawSet = new Set(results.map((a) => a.raw))
    backendAios.forEach((a) => { if (!rawSet.has(a.raw)) results.push(a) })
    return results
  }, [files, downloadedFiles, backendAios])

  const filteredAios = useMemo<ParsedAio[]>(() => {
    if (!searchQuery.trim()) return parsedAios
    const q = searchQuery.toLowerCase()
    return parsedAios.filter((aio) =>
      aio.fileName.toLowerCase().includes(q) ||
      aio.elements.some((el) => el.key.toLowerCase().includes(q) || el.value.toLowerCase().includes(q))
    )
  }, [parsedAios, searchQuery])

  const matchingAios = useMemo<ParsedAio[]>(() => {
    if (!selectedElement) return []
    return parsedAios.filter((aio) => aio.elements.some((el) => el.key === selectedElement.key && el.value === selectedElement.value))
  }, [parsedAios, selectedElement])

  const handleAioClick = useCallback((index: number) => {
    setSelectedAioIndex(index === selectedAioIndex ? null : index)
    setSelectedElement(null)
    setSummaryCsv(null)
    setHslData(null)
    setEntityData(null)
  }, [selectedAioIndex])

  const handleSummarize = useCallback(async () => {
    if (!backendIsOnline) { toast.error("Backend offline — connect the backend to use AI summarization"); return }
    setIsSummarizing(true)
    const result = await summarizeAIOs(parsedAios.map((a) => a.raw))
    setSummaryText(result?.summary ?? "Summary unavailable. Check backend connection.")
    setIsSummarizing(false)
  }, [parsedAios, backendIsOnline])

  const handleExtractEntities = useCallback(async (aioText: string) => {
    if (!backendIsOnline) { toast.error("Backend offline — connect the backend to extract entities"); return }
    setIsExtractingEntities(true)
    const result = await resolveEntities(aioText)
    setEntityData(result?.entities ?? [])
    setIsExtractingEntities(false)
  }, [backendIsOnline])

  const handleElementClick = useCallback((element: ParsedElement) => {
    setSelectedElement(element)
    setSummaryCsv(null)
    setHslData(null)
  }, [])

  const handleCreateSummaryCsv = useCallback(() => {
    if (matchingAios.length === 0) return
    const headerSet = new Set<string>()
    matchingAios.forEach((aio) => { aio.elements.forEach((el) => headerSet.add(el.key)) })
    const headers = Array.from(headerSet)
    const rows = matchingAios.map((aio) => {
      const valMap = new Map<string, string>()
      aio.elements.forEach((el) => { valMap.set(el.key, el.value) })
      return headers.map((h) => valMap.get(h) ?? "")
    })
    const escapeCsvField = (field: string) => {
      if (field.includes(",") || field.includes('"') || field.includes("\n")) { return `"${field.replace(/"/g, '""')}"` }
      return field
    }
    const csvLines = [headers.map(escapeCsvField).join(","), ...rows.map((row) => row.map(escapeCsvField).join(","))]
    setSummaryCsv({ headers, rows, csvString: csvLines.join("\n") })
  }, [matchingAios])

  const handleDownloadCsv = useCallback(() => {
    if (!summaryCsv) return
    const blob = new Blob([summaryCsv.csvString], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `matching_aios_${selectedElement ? `${selectedElement.key}_${selectedElement.value}` : "summary"}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [summaryCsv, selectedElement])

  const handleViewHslDb = useCallback(async () => {
    setShowHslDb(true)
    setHslDbSelectedRecord(null)
    setIsLoadingHslDb(true)
    const records = await listHslData()
    setHslDbRecords(records)
    setIsLoadingHslDb(false)
  }, [])

  const handleCreateHsl = useCallback(() => {
    if (!selectedElement || matchingAios.length === 0) return
    const now = new Date()
    const createdAt = now.toISOString().replace("T", " ").substring(0, 19)
    const label = `${selectedElement.key}: ${selectedElement.value}`
    const hslFileName = `[${selectedElement.key}.${selectedElement.value}].hsl`

    const rows = matchingAios.map((aio) => ({
      aioName: aio.fileName,
      csvRoot: aio.csvRoot,
      lineNumber: aio.lineNumber,
      createdAt,
    }))

    const lines: string[] = []
    lines.push(`HSL File: ${hslFileName}`)
    lines.push(`Selected Value: ${label}`)
    lines.push(`Created: ${createdAt}`)
    lines.push(`Matches: ${rows.length}`)
    lines.push("")
    lines.push("AIO Name\tCSV Source\tLine #\tCreated")
    lines.push("─".repeat(80))
    rows.forEach((r) => {
      lines.push(`${r.aioName}\t${r.csvRoot}\t${r.lineNumber}\t${r.createdAt}`)
    })

    const content = lines.join("\n")
    setHslData({ label, fileName: hslFileName, rows, content })
    if (backendIsOnline) {
      const rowElements: (string | null)[] = rows.slice(0, 100).map((r) => `${r.aioName}\t${r.csvRoot}\t${r.lineNumber}\t${r.createdAt}`)
      while (rowElements.length < 100) rowElements.push(null)
      Promise.all([
        createIO({
          type: "HSL",
          raw: { raw_uri: `data:text/hsl,${encodeURIComponent(content)}`, mime_type: "text/hsl", size_bytes: content.length },
          context: { source_system: "csv-converter", source_object_id: hslFileName },
        }),
        createHslData(hslFileName, rowElements),
      ]).then(([ioResult, hslResult]) => { if (ioResult && hslResult) toast.success("HSL saved to database") })
    }
  }, [selectedElement, matchingAios, backendIsOnline])

  const handleDownloadHsl = useCallback(() => {
    if (!hslData) return
    const blob = new Blob([hslData.content], { type: "text/plain;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = hslData.fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [hslData])

  const selectedAio = selectedAioIndex !== null ? parsedAios[selectedAioIndex] : null

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={onBack} className="gap-2"><ArrowLeft className="w-4 h-4" />Back to Converter</Button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-600 flex items-center justify-center"><Search className="w-5 h-5 text-white" /></div>
                <div><h1 className="text-xl font-bold text-foreground">Hyper-Semantic Processor</h1><p className="text-xs text-muted-foreground">{searchQuery ? `${filteredAios.length} of ${parsedAios.length}` : parsedAios.length} AIO files loaded</p></div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {backendIsOnline && (
                <Button variant="outline" size="sm" onClick={handleViewHslDb} className="gap-2 shrink-0">
                  <Database className="w-4 h-4" />
                  View HSL Database
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handleSummarize} disabled={isSummarizing || !backendIsOnline} className="gap-2 shrink-0">
                {isSummarizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cpu className="w-4 h-4" />}
                Summarize All
              </Button>
              {backendIsOnline && (
                <Button variant="outline" size="sm" onClick={() => setShowChat(true)} className="gap-2 shrink-0">
                  <MessageSquare className="w-4 h-4" />
                  ChatAIO
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={onSysAdmin} className="gap-2 shrink-0"><Settings className="w-4 h-4" />System Admin</Button>
            </div>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Search bar */}
        <div className="relative">
          {isLoadingBackendAios
            ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />
            : <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />}
          <input
            type="text"
            placeholder={isLoadingBackendAios ? "Loading AIOs from database…" : "Search AIOs by file name, key, or value…"}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-10 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Summary card */}
        {summaryText && (
          <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
            <CardHeader className="py-3 shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2"><Cpu className="w-4 h-4 text-amber-600" />AI Summary</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setSummaryText(null)}><X className="w-3 h-3" /></Button>
              </div>
            </CardHeader>
            <CardContent className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{summaryText}</CardContent>
          </Card>
        )}

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Left: AIO Files */}
          <Card className="max-h-[calc(100vh-200px)] flex flex-col">
            <CardHeader className="py-3 shrink-0"><CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4" />AIO Files<span className="text-xs font-normal text-muted-foreground">({filteredAios.length} files)</span></CardTitle></CardHeader>
            <CardContent className="p-0 overflow-hidden flex-1 min-h-0">
              <div className="h-full overflow-y-auto overflow-x-auto">
                {filteredAios.map((aio) => {
                  const idx = parsedAios.indexOf(aio)
                  return <button key={idx} onClick={() => handleAioClick(idx)} className={`w-full text-left px-4 py-3 border-b border-border transition-colors ${idx === selectedAioIndex ? "bg-primary/10" : "hover:bg-accent/50"}`}>
                    <div className="flex items-center gap-2 mb-1"><FileText className="w-3 h-3 text-muted-foreground" /><span className="text-xs font-medium text-foreground truncate">{aio.fileName}</span></div>
                    <p className="text-xs text-muted-foreground font-mono truncate">{aio.raw}</p>
                  </button>
                })}
              </div>
            </CardContent>
          </Card>

          {/* Right: Elements or Matches */}
          {selectedElement ? (
            <Card className="max-h-[calc(100vh-200px)] flex flex-col">
              <CardHeader className="py-3 shrink-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2"><Search className="w-4 h-4" />Matching AIOs<span className="text-xs font-normal text-muted-foreground">({matchingAios.length} matches)</span></CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => { setSelectedElement(null); setSummaryCsv(null); setHslData(null) }} className="gap-1 shrink-0"><X className="w-3 h-3" />Clear</Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Searching for: <span className="font-mono bg-primary/15 text-primary px-1 rounded">{selectedElement.raw}</span></p>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <Button variant="outline" size="sm" onClick={handleCreateSummaryCsv} className="gap-1"><FileText className="w-3 h-3" />Create Summary CSV</Button>
                  <Button variant="outline" size="sm" onClick={handleCreateHsl} className="gap-1 bg-amber-600 hover:bg-amber-700 text-white border-amber-600 hover:border-amber-700"><Layers className="w-3 h-3" />Create/Append HSL</Button>
                </div>
              </CardHeader>
              <CardContent className="p-0 overflow-hidden flex-1 min-h-0">
                <div className="h-full overflow-y-auto overflow-x-auto">
                  {matchingAios.map((aio, index) => (
                    <div key={index} className="px-4 py-3 border-b border-border">
                      <div className="flex items-center gap-2 mb-2"><FileText className="w-3 h-3 text-muted-foreground" /><span className="text-xs font-medium text-foreground">{aio.fileName}</span></div>
                      <div className="flex flex-wrap gap-1">
                        {aio.elements.map((el, elIdx) => (
                          <span key={elIdx} className={`inline-flex px-2 py-0.5 rounded text-xs font-mono ${el.key === selectedElement.key && el.value === selectedElement.value ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 ring-1 ring-amber-400" : "bg-secondary text-foreground"}`}>{el.raw}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : selectedAio ? (
            <Card className="max-h-[calc(100vh-200px)] flex flex-col">
              <CardHeader className="py-3 shrink-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4" />AIO Elements<span className="text-xs font-normal text-muted-foreground">({selectedAio.elements.length} elements)</span></CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => handleExtractEntities(selectedAio.raw)} disabled={isExtractingEntities || !backendIsOnline} className="gap-1 text-xs shrink-0">
                    {isExtractingEntities ? <Loader2 className="w-3 h-3 animate-spin" /> : <Network className="w-3 h-3" />}
                    Extract Entities
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Click an element to find all AIOs that share it</p>
              </CardHeader>
              <CardContent className="overflow-y-auto overflow-x-auto flex-1 min-h-0 space-y-4">
                <div className="flex flex-wrap gap-2">
                  {selectedAio.elements.map((element, index) => (
                    <button key={index} onClick={() => handleElementClick(element)} className="inline-flex px-3 py-1.5 rounded-lg bg-secondary text-foreground text-xs font-mono hover:bg-primary/15 hover:text-primary transition-colors cursor-pointer">{element.raw}</button>
                  ))}
                </div>
                {entityData && entityData.length > 0 && (
                  <div className="border-t border-border pt-3">
                    <p className="text-xs font-medium text-foreground mb-2 flex items-center gap-1"><Network className="w-3 h-3" />Extracted Entities</p>
                    <div className="flex flex-wrap gap-1.5">
                      {entityData.map((entity, i) => {
                        const colorMap: Record<string, string> = {
                          Person: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
                          Organization: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
                          Location: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
                          Date: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
                          Product: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400",
                          Project: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400",
                        }
                        const cls = colorMap[entity.type] ?? "bg-secondary text-foreground"
                        return <Badge key={i} className={`text-xs font-normal ${cls}`}>{entity.type}: {entity.value}</Badge>
                      })}
                    </div>
                  </div>
                )}
                {entityData && entityData.length === 0 && (
                  <p className="text-xs text-muted-foreground border-t border-border pt-3">No entities found in this AIO.</p>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card><CardContent className="flex items-center justify-center h-full min-h-[200px]"><div className="text-center"><Search className="w-8 h-8 text-muted-foreground mx-auto mb-3" /><p className="text-sm text-muted-foreground">Select an AIO file to view its elements</p><p className="text-xs text-muted-foreground mt-1">Then click an element to find semantic matches</p></div></CardContent></Card>
          )}
        </div>

        {/* Summary CSV Pane */}
        {summaryCsv && (
          <Card className="max-h-[calc(100vh-200px)] flex flex-col">
            <CardHeader className="py-3 shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4" />Summary CSV<span className="text-xs font-normal text-muted-foreground">({summaryCsv.rows.length} rows x {summaryCsv.headers.length} columns)</span></CardTitle>
                <div className="flex items-center gap-2">
                  <Button variant="default" size="sm" onClick={handleDownloadCsv} className="gap-1"><Download className="w-3 h-3" />Download CSV</Button>
                  <Button variant="ghost" size="sm" onClick={() => setSummaryCsv(null)} className="gap-1"><X className="w-3 h-3" />Close</Button>
                </div>
              </div>
              {selectedElement && (<p className="text-xs text-muted-foreground">Matching element: <span className="font-mono bg-primary/15 text-primary px-1 rounded">{selectedElement.raw}</span></p>)}
            </CardHeader>
            <CardContent className="p-0 overflow-hidden flex-1 min-h-0">
              <div className="h-full overflow-x-auto overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground w-12">#</th>
                      {summaryCsv.headers.map((header, i) => (<th key={i} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">{header}</th>))}
                    </tr>
                  </thead>
                  <tbody>
                    {summaryCsv.rows.map((row, rowIdx) => (
                      <tr key={rowIdx} className="border-t border-border hover:bg-accent/50 transition-colors">
                        <td className="px-3 py-2 text-muted-foreground">{rowIdx + 1}</td>
                        {row.map((cell, cellIdx) => (<td key={cellIdx} className="px-3 py-2 font-mono whitespace-nowrap">{cell}</td>))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* HSL Display Pane */}
        {hslData && (
          <Card className="max-h-[calc(100vh-200px)] flex flex-col">
            <CardHeader className="py-3 shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4 text-amber-600" />
                  {hslData.fileName}
                  <span className="text-xs font-normal text-muted-foreground">
                    ({hslData.rows.length} entries)
                  </span>
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button variant="default" size="sm" onClick={handleDownloadHsl} className="gap-1 bg-amber-600 hover:bg-amber-700">
                    <Download className="w-3 h-3" />
                    Download HSL
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setHslData(null)} className="gap-1">
                    <X className="w-3 h-3" />
                    Close
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Selected value: <span className="font-mono bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 px-1 rounded">{hslData.label}</span>
              </p>
            </CardHeader>
            <CardContent className="p-0 overflow-hidden flex-1 min-h-0">
              <div className="h-full overflow-x-auto overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground w-12">#</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">AIO Name</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">CSV Source</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Line #</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hslData.rows.map((row, idx) => (
                      <tr key={idx} className="border-t border-border hover:bg-accent/50 transition-colors">
                        <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap">{row.aioName}</td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap">{row.csvRoot}</td>
                        <td className="px-3 py-2 font-mono">{row.lineNumber}</td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap">{row.createdAt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      {/* HSL Database Dialog — list */}
      <Dialog open={showHslDb && !hslDbSelectedRecord} onOpenChange={(open) => { if (!open) setShowHslDb(false) }}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Layers className="w-4 h-4 text-amber-600" />HSL Database <span className="text-xs font-normal text-muted-foreground">(read-only)</span></DialogTitle>
          </DialogHeader>
          {isLoadingHslDb ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : hslDbRecords.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No HSL records saved yet.</p>
          ) : (
            <div className="overflow-auto border border-border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">HSL Name</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Entries</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Created</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {hslDbRecords.map((r) => (
                    <tr key={r.hsl_id} className="border-t border-border hover:bg-accent/50 transition-colors">
                      <td className="px-3 py-2 font-mono text-xs">{r.hsl_name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.elements.filter(Boolean).length}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                      <td className="px-3 py-2"><Button variant="ghost" size="sm" onClick={() => setHslDbSelectedRecord(r)} className="text-xs gap-1"><Search className="w-3 h-3" />View</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* HSL Database Dialog — detail */}
      <Dialog open={!!hslDbSelectedRecord} onOpenChange={(open) => { if (!open) setHslDbSelectedRecord(null) }}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Layers className="w-4 h-4 text-amber-600" />{hslDbSelectedRecord?.hsl_name}</DialogTitle>
          </DialogHeader>
          {hslDbSelectedRecord && (
            <div className="flex flex-col gap-3 overflow-auto">
              <p className="text-xs text-muted-foreground">Created: {new Date(hslDbSelectedRecord.created_at).toLocaleString()} · {hslDbSelectedRecord.elements.filter(Boolean).length} entries</p>
              <div className="overflow-auto border border-border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground w-8">#</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">AIO Name</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">CSV Source</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Line #</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hslDbSelectedRecord.elements.filter(Boolean).map((el, idx) => {
                      const [aioName, csvRoot, lineNumber, createdAt] = (el ?? "").split("\t")
                      return (
                        <tr key={idx} className="border-t border-border hover:bg-accent/50">
                          <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                          <td className="px-3 py-2 font-mono whitespace-nowrap">{aioName}</td>
                          <td className="px-3 py-2 font-mono whitespace-nowrap">{csvRoot}</td>
                          <td className="px-3 py-2 font-mono">{lineNumber}</td>
                          <td className="px-3 py-2 font-mono whitespace-nowrap">{createdAt}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <Button variant="outline" size="sm" className="self-start gap-2" onClick={() => setHslDbSelectedRecord(null)}><ArrowLeft className="w-3 h-3" />Back to list</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ChatAioDialog open={showChat} onOpenChange={setShowChat} />
    </div>
  )
}
