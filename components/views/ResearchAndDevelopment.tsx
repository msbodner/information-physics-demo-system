"use client"

import { useState, useCallback, useMemo, useEffect } from "react"
import { ArrowLeft, Search, X, Download, Database, Layers, FileText, Atom, Loader2, Settings, FileSpreadsheet, Eye, Upload, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { toast } from "sonner"
import { parseAioLine, parseCSV, csvToAio, downloadBlob, type ConvertedFile, type ParsedAio, type ParsedElement } from "@/lib/aio-utils"
import { summarizeAIOs, resolveEntities, listHslData, createIO, createHslData, listAioData, listInformationElements, createInformationElement, rebuildHslsFromAios, type IORecord, type EntityItem, type HslDataRecord, type AioDataRecord, type InformationElement, type RebuildHslsResult } from "@/lib/api-client"
import { ChatAioDialog } from "@/components/chat-aio-dialog"

export function ResearchAndDevelopment({ onBack, backendIsOnline, onSysAdmin }: { onBack: () => void; backendIsOnline: boolean; onSysAdmin: () => void }) {
  const [aioRecords, setAioRecords] = useState<AioDataRecord[]>([])
  const [isLoadingAios, setIsLoadingAios] = useState(false)
  const [infoElements, setInfoElements] = useState<InformationElement[]>([])
  const [isLoadingElements, setIsLoadingElements] = useState(false)
  const [selectedFieldName, setSelectedFieldName] = useState<string | null>(null)
  const [fieldSearchQuery, setFieldSearchQuery] = useState("")
  const [valueSearchQuery, setValueSearchQuery] = useState("")
  const [selectedElements, setSelectedElements] = useState<{ element: ParsedElement; sourceAio: string }[]>([])
  const [compoundHslData, setCompoundHslData] = useState<{ labels: string[]; fileName: string; rows: { aioName: string; csvRoot: string; lineNumber: number; createdAt: string }[]; content: string; matchingAioDetails: ParsedAio[] } | null>(null)
  const [showFileViewer, setShowFileViewer] = useState(false)
  const [showDetailsAio, setShowDetailsAio] = useState<ParsedAio | null>(null)
  const [isRebuildingHsls, setIsRebuildingHsls] = useState(false)
  const [rebuildResult, setRebuildResult] = useState<RebuildHslsResult | null>(null)

  const handleRebuildAllHsls = useCallback(async () => {
    setIsRebuildingHsls(true)
    setRebuildResult(null)
    try {
      const result = await rebuildHslsFromAios()
      if (!result) {
        toast.error("Backend unavailable — could not rebuild HSLs")
        return
      }
      setRebuildResult(result)
      toast.success(`Created ${result.created} new HSL${result.created === 1 ? "" : "s"} from ${result.total_aios_scanned} AIOs`)
    } catch {
      toast.error("Failed to rebuild HSLs")
    } finally {
      setIsRebuildingHsls(false)
    }
  }, [])

  // Load AIOs and Information Elements
  useEffect(() => {
    if (!backendIsOnline) return
    setIsLoadingAios(true)
    listAioData().then((records) => { setAioRecords(records); setIsLoadingAios(false) }).catch(() => setIsLoadingAios(false))
    setIsLoadingElements(true)
    listInformationElements().then((els) => { setInfoElements(els); setIsLoadingElements(false) }).catch(() => setIsLoadingElements(false))
  }, [backendIsOnline])

  const allParsedAios = useMemo<ParsedAio[]>(() => {
    return aioRecords.map((r) => {
      const raw = r.elements.filter(Boolean).join("")
      const csvRoot = r.aio_name.replace(/\s*-\s*Row\s*\d+$/i, "").replace(/\.csv$/i, "") || "backend"
      const lineNumberMatch = r.aio_name.match(/-\s*Row\s*(\d+)$/i)
      const lineNumber = lineNumberMatch ? parseInt(lineNumberMatch[1], 10) : 0
      return { fileName: r.aio_name, elements: parseAioLine(raw), raw, csvRoot, lineNumber }
    })
  }, [aioRecords])

  // Filter field names by search
  const filteredInfoElements = useMemo(() => {
    if (!fieldSearchQuery.trim()) return infoElements
    const q = fieldSearchQuery.toLowerCase()
    return infoElements.filter((el) => el.field_name.toLowerCase().includes(q))
  }, [infoElements, fieldSearchQuery])

  // Get unique values for the selected field name across all AIOs
  const fieldValues = useMemo<{ value: string; count: number }[]>(() => {
    if (!selectedFieldName) return []
    const valueCounts = new Map<string, number>()
    for (const aio of allParsedAios) {
      for (const el of aio.elements) {
        if (el.key === selectedFieldName) {
          valueCounts.set(el.value, (valueCounts.get(el.value) ?? 0) + 1)
        }
      }
    }
    return Array.from(valueCounts.entries()).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count)
  }, [allParsedAios, selectedFieldName])

  // Filter values by search
  const filteredFieldValues = useMemo(() => {
    if (!valueSearchQuery.trim()) return fieldValues
    const q = valueSearchQuery.toLowerCase()
    return fieldValues.filter((v) => v.value.toLowerCase().includes(q))
  }, [fieldValues, valueSearchQuery])

  // Count occurrences of each element's value across ALL AIOs
  const valueCounts = useMemo<Map<string, number>>(() => {
    const counts = new Map<string, number>()
    for (const aio of allParsedAios) {
      for (const el of aio.elements) {
        counts.set(el.value, (counts.get(el.value) ?? 0) + 1)
      }
    }
    return counts
  }, [allParsedAios])

  const queryElements = useMemo(() => selectedElements.map((s) => s.element), [selectedElements])

  // Match on value (data portion) only, across all AIOs regardless of field name
  const compoundMatchingAios = useMemo<ParsedAio[]>(() => {
    if (queryElements.length === 0) return []
    const matchSets = queryElements.map((sel) => new Set(allParsedAios.filter((aio) => aio.elements.some((el) => el.value === sel.value)).map((aio) => aio.raw)))
    return allParsedAios.filter((aio) => matchSets.every((set) => set.has(aio.raw)))
  }, [allParsedAios, queryElements])

  const handleValueSelect = useCallback((value: string) => {
    if (!selectedFieldName) return
    const element: ParsedElement = { key: selectedFieldName, value, raw: `[${selectedFieldName}.${value}]` }
    setSelectedElements((prev) => {
      const exists = prev.some((e) => e.element.key === element.key && e.element.value === element.value)
      return exists ? prev.filter((e) => !(e.element.key === element.key && e.element.value === element.value)) : [...prev, { element, sourceAio: selectedFieldName }]
    })
    setCompoundHslData(null)
  }, [selectedFieldName])

  const isValueSelected = useCallback((value: string) => {
    return selectedElements.some((s) => s.element.value === value)
  }, [selectedElements])

  const handleRemoveElement = useCallback((element: ParsedElement) => {
    setSelectedElements((prev) => prev.filter((e) => !(e.element.key === element.key && e.element.value === element.value)))
    setCompoundHslData(null)
  }, [])

  const handleClearQuery = useCallback(() => {
    setSelectedElements([])
    setCompoundHslData(null)
  }, [])

  const handleCreateCompoundHsl = useCallback(() => {
    if (queryElements.length < 2 || compoundMatchingAios.length === 0) return
    const now = new Date()
    const createdAt = now.toISOString().replace("T", " ").substring(0, 19)
    const labels = queryElements.map((el) => `${el.key}: ${el.value}`)
    const elementParts = queryElements.map((el) => `[${el.key}.${el.value}]`)
    const hslFileName = elementParts.length <= 3 ? `${elementParts.join("")}.hsl` : `${elementParts.slice(0, 3).join("")}+${elementParts.length - 3}_more.hsl`

    const rows = compoundMatchingAios.map((aio) => ({ aioName: aio.fileName, csvRoot: aio.csvRoot, lineNumber: aio.lineNumber, createdAt }))

    const lines: string[] = []
    lines.push(`HSL File: ${hslFileName}`)
    lines.push(`Type: Compound HSL`)
    lines.push(`Selected Elements: ${queryElements.length}`)
    queryElements.forEach((el, i) => { lines.push(`  Element ${i + 1}: ${el.key}: ${el.value}`) })
    lines.push(`Query: ${queryElements.map((el) => `[${el.key}.${el.value}]`).join(" AND ")}`)
    lines.push(`Created: ${createdAt}`)
    lines.push(`Matches: ${rows.length}`)
    lines.push("")
    lines.push("AIO Name\tCSV Source\tLine #\tCreated")
    lines.push("\u2500".repeat(80))
    rows.forEach((r) => { lines.push(`${r.aioName}\t${r.csvRoot}\t${r.lineNumber}\t${r.createdAt}`) })

    const content = lines.join("\n")
    setCompoundHslData({ labels, fileName: hslFileName, rows, content, matchingAioDetails: compoundMatchingAios })

    if (backendIsOnline) {
      const rowElements: (string | null)[] = rows.slice(0, 100).map((r) => `${r.aioName}\t${r.csvRoot}\t${r.lineNumber}\t${r.createdAt}`)
      while (rowElements.length < 100) rowElements.push(null)
      Promise.all([
        createIO({ type: "HSL", raw: { raw_uri: `data:text/hsl,${encodeURIComponent(content)}`, mime_type: "text/hsl", size_bytes: content.length }, context: { source_system: "csv-converter", source_object_id: hslFileName } }),
        createHslData(hslFileName, rowElements),
      ]).then(([ioResult, hslResult]) => { if (ioResult && hslResult) toast.success("Compound HSL saved to database") })
    }
  }, [queryElements, compoundMatchingAios, backendIsOnline])

  const handleDownloadCompoundHsl = useCallback(() => {
    if (!compoundHslData) return
    const blob = new Blob([compoundHslData.content], { type: "text/plain;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = compoundHslData.fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [compoundHslData])

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-2"><ArrowLeft className="w-4 h-4" />Back</Button>
            <h1 className="text-lg font-bold text-foreground">R &amp; D — Compound HSL Builder</h1>
          </div>
          <Button variant="outline" size="sm" onClick={onSysAdmin} className="gap-2"><Settings className="w-4 h-4" />System Admin</Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Layers className="w-4 h-4" />
              Rebuild HSLs from All AIOs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-6 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">AIOs in database</p>
                  <p className="text-2xl font-bold text-foreground">{isLoadingAios ? "…" : aioRecords.length.toLocaleString()}</p>
                </div>
                {rebuildResult && (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground">HSLs created</p>
                      <p className="text-2xl font-bold text-emerald-600">{rebuildResult.created.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Already existed</p>
                      <p className="text-2xl font-bold text-muted-foreground">{rebuildResult.already_existed.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Skipped (single-AIO)</p>
                      <p className="text-2xl font-bold text-muted-foreground">{rebuildResult.skipped_single_aio.toLocaleString()}</p>
                    </div>
                  </>
                )}
              </div>
              <Button
                onClick={handleRebuildAllHsls}
                disabled={isRebuildingHsls || !backendIsOnline || aioRecords.length === 0}
                className="gap-2"
              >
                {isRebuildingHsls ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
                {isRebuildingHsls ? "Rebuilding…" : "Rebuild All HSLs"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Scans every AIO and creates one HSL per shared [Key.Value] element group (≥2 AIOs). Existing HSLs are preserved.
            </p>
          </CardContent>
        </Card>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Left Column: Information Elements (Field Names) */}
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input type="text" placeholder="Search field names..." value={fieldSearchQuery} onChange={(e) => setFieldSearchQuery(e.target.value)} className="w-full pl-10 pr-10 py-2 border border-border rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              {fieldSearchQuery && <button onClick={() => setFieldSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-4 h-4 text-muted-foreground" /></button>}
            </div>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{isLoadingElements ? "Loading..." : `Field Names (${filteredInfoElements.length})`}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[500px] overflow-y-auto divide-y divide-border">
                  {filteredInfoElements.map((el) => (
                    <button key={el.element_id} onClick={() => { setSelectedFieldName(el.field_name); setValueSearchQuery("") }} className={`w-full text-left px-4 py-2.5 hover:bg-muted/50 transition-colors ${selectedFieldName === el.field_name ? "bg-amber-600/10 border-l-2 border-amber-600" : ""}`}>
                      <p className="text-sm font-medium text-foreground">{el.field_name}</p>
                      <p className="text-xs text-muted-foreground">{el.aio_count} AIOs</p>
                    </button>
                  ))}
                  {filteredInfoElements.length === 0 && !isLoadingElements && <p className="text-sm text-muted-foreground text-center py-8">No field names found</p>}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Middle Column: Values for Selected Field */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                {selectedFieldName ? `Values for: ${selectedFieldName}` : "Select a field name"}
              </CardTitle>
              <p className="text-xs text-muted-foreground">Click a value to add it to your compound query</p>
              {selectedFieldName && fieldValues.length > 10 && (
                <div className="relative mt-2">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                  <input type="text" placeholder="Filter values..." value={valueSearchQuery} onChange={(e) => setValueSearchQuery(e.target.value)} className="w-full pl-7 pr-7 py-1 border border-border rounded text-xs bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
                  {valueSearchQuery && <button onClick={() => setValueSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2"><X className="w-3 h-3 text-muted-foreground" /></button>}
                </div>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {selectedFieldName ? (
                <div className="max-h-[460px] overflow-y-auto divide-y divide-border">
                  {filteredFieldValues.map((fv, i) => {
                    const selected = isValueSelected(fv.value)
                    return (
                      <button key={i} onClick={() => handleValueSelect(fv.value)} className={`w-full text-left px-4 py-2 hover:bg-muted/50 transition-colors ${selected ? "bg-amber-600/10 border-l-2 border-amber-600" : ""}`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className={`text-sm truncate ${selected ? "font-semibold text-amber-700" : "text-foreground"}`}>{fv.value}</p>
                          <span className={`inline-flex items-center justify-center min-w-[22px] h-[20px] px-1.5 rounded-full text-[10px] font-bold shrink-0 ${selected ? "bg-amber-600 text-white" : "bg-blue-600 text-white"}`}>{fv.count}</span>
                        </div>
                      </button>
                    )
                  })}
                  {filteredFieldValues.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No values found</p>}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-12">Pick a field name from the left</p>
              )}
            </CardContent>
          </Card>

          {/* Right Column: Query Builder Box */}
          <Card className="border-amber-600/30">
            <CardHeader className="pb-2 bg-amber-600/5 rounded-t-lg">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-amber-700">Compound Query ({selectedElements.length} fields)</CardTitle>
                {selectedElements.length > 0 && <Button size="sm" variant="ghost" onClick={handleClearQuery} className="text-xs h-6 px-2 text-muted-foreground">Clear All</Button>}
              </div>
              <p className="text-xs text-muted-foreground">Pick field names and values to build your AND query</p>
            </CardHeader>
            <CardContent className="pt-3">
              {selectedElements.length > 0 ? (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {selectedElements.map((sel, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded-md bg-amber-600/5 border border-amber-600/20">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-medium text-foreground">{sel.element.key}: {sel.element.value}</p>
                          <span className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-full text-[10px] font-bold bg-blue-600 text-white">{valueCounts.get(sel.element.value) ?? 0}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground truncate">field: {sel.sourceAio}</p>
                      </div>
                      <button onClick={() => handleRemoveElement(sel.element)} className="shrink-0 mt-0.5"><X className="w-3 h-3 text-muted-foreground hover:text-foreground" /></button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No fields selected yet. Pick a field name, then click a value to add it here.</p>
              )}

              {/* Live match count */}
              {selectedElements.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-xs text-muted-foreground mb-3">
                    {queryElements.length < 2 ? "Select at least 2 fields" : `${compoundMatchingAios.length} AIO${compoundMatchingAios.length !== 1 ? "s" : ""} match ALL fields (AND)`}
                  </p>
                  <Button size="sm" className="w-full bg-amber-600 hover:bg-amber-700 text-white gap-2" onClick={handleCreateCompoundHsl} disabled={queryElements.length < 2 || compoundMatchingAios.length === 0}>
                    <Layers className="w-4 h-4" />Create Compound HSL
                  </Button>
                </div>
              )}

              {/* View Compound HSL button when created */}
              {compoundHslData && (
                <div className="mt-3 pt-3 border-t border-border">
                  <Button size="sm" variant="outline" className="w-full gap-2" onClick={() => setShowFileViewer(true)}>
                    <FileText className="w-4 h-4" />View Compound HSL
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Compound HSL Result Summary */}
        {compoundHslData && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold">Compound HSL Created</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">{compoundHslData.labels.join(" + ")} — {compoundHslData.rows.length} matching AIOs</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setShowFileViewer(true)} className="gap-2"><FileText className="w-4 h-4" />View HSL</Button>
                  <Button size="sm" variant="outline" onClick={handleDownloadCompoundHsl} className="gap-2"><Download className="w-4 h-4" />Download</Button>
                  <Button size="sm" variant="ghost" onClick={() => setCompoundHslData(null)}><X className="w-4 h-4" /></Button>
                </div>
              </div>
            </CardHeader>
          </Card>
        )}
      </main>

      {/* ── File Viewer Dialog ── */}
      <Dialog open={showFileViewer} onOpenChange={setShowFileViewer}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="w-5 h-5" />Compound HSL File</DialogTitle>
          </DialogHeader>
          {compoundHslData && (
            <div className="flex-1 overflow-auto space-y-4">
              {/* File content */}
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <pre className="text-xs font-mono whitespace-pre-wrap text-foreground">{compoundHslData.content}</pre>
              </div>
              {/* Result table */}
              <div className="rounded border border-border overflow-auto max-h-[300px]">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">AIO Name</th>
                      <th className="text-left px-4 py-2 font-medium">CSV Source</th>
                      <th className="text-left px-4 py-2 font-medium">Line #</th>
                      <th className="text-left px-4 py-2 font-medium">Created</th>
                      <th className="text-left px-4 py-2 font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {compoundHslData.rows.map((row, i) => (
                      <tr key={i} className="hover:bg-muted/30">
                        <td className="px-4 py-2 font-mono text-xs">{row.aioName}</td>
                        <td className="px-4 py-2 text-xs">{row.csvRoot}</td>
                        <td className="px-4 py-2 text-xs">{row.lineNumber}</td>
                        <td className="px-4 py-2 text-xs">{row.createdAt}</td>
                        <td className="px-4 py-2"><Button size="sm" variant="ghost" className="h-6 px-2 text-xs gap-1" onClick={() => { const aio = compoundHslData.matchingAioDetails.find((a) => a.fileName === row.aioName); if (aio) setShowDetailsAio(aio) }}><Eye className="w-3 h-3" />View Details</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="outline" onClick={handleDownloadCompoundHsl} className="gap-2"><Download className="w-4 h-4" />Download HSL</Button>
                <Button size="sm" variant="ghost" onClick={() => setShowFileViewer(false)}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── AIO Details Dialog ── */}
      <Dialog open={!!showDetailsAio} onOpenChange={(open) => { if (!open) setShowDetailsAio(null) }}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Database className="w-5 h-5" />AIO Elements: {showDetailsAio?.fileName}</DialogTitle>
          </DialogHeader>
          {showDetailsAio && (
            <div className="flex-1 overflow-auto space-y-4">
              <div className="rounded-lg border border-border overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium w-8">#</th>
                      <th className="text-left px-4 py-2 font-medium">Key</th>
                      <th className="text-left px-4 py-2 font-medium">Value</th>
                      <th className="text-left px-4 py-2 font-medium w-20">In Query</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {showDetailsAio.elements.map((el, i) => {
                      const inQuery = queryElements.some((q) => q.value === el.value)
                      return (
                        <tr key={i} className={inQuery ? "bg-amber-600/10" : "hover:bg-muted/30"}>
                          <td className="px-4 py-2 text-xs text-muted-foreground">{i + 1}</td>
                          <td className="px-4 py-2 text-xs font-medium">{el.key}</td>
                          <td className="px-4 py-2 text-xs">{el.value}</td>
                          <td className="px-4 py-2 text-xs">{inQuery && <Badge className="bg-amber-600 text-white text-[10px] h-5">Match</Badge>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-between items-center">
                <p className="text-xs text-muted-foreground">{showDetailsAio.elements.length} elements — Source: {showDetailsAio.csvRoot}</p>
                <Button size="sm" variant="ghost" onClick={() => setShowDetailsAio(null)}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
