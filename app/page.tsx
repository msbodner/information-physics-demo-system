"use client"

import { useState, useCallback } from "react"
import { toast } from "sonner"
import { FileUpload } from "@/components/file-upload"
import { ConversionPreview } from "@/components/conversion-preview"
import { BackendStatusBadge } from "@/components/backend-status-badge"
import { SystemManagement, SearchStatsPane } from "@/components/system-management"
import { ChatAioDialog } from "@/components/chat-aio-dialog"
import { useBackendStatus } from "@/hooks/use-backend-status"
import { UserGuide } from "@/components/views/UserGuide"
import { WorkflowDescription } from "@/components/views/WorkflowDescription"
import { ReferencePage } from "@/components/views/ReferencePage"
import { SemanticProcessor } from "@/components/views/SemanticProcessor"
import { PdfImportView } from "@/components/views/PdfImportView"
import { ResearchAndDevelopment } from "@/components/views/ResearchAndDevelopment"
import { AIOReferencePaper } from "@/components/views/AIOReferencePaper"
import { MROReferencePaper } from "@/components/views/MROReferencePaper"
import { PaperIII } from "@/components/views/PaperIII"
import { BulkHslTechnote } from "@/components/views/BulkHslTechnote"
import { SearchModesTechnote } from "@/components/views/SearchModesTechnote"
import { createIO, listIOs, createAioData, loginUser, rebuildHslsFromAios, pruneHsls, type IORecord, type LoginResult } from "@/lib/api-client"
import {
  Database, ArrowRight, Layers, Cpu, Globe, BookOpen, FileText, Zap,
  Settings, FileSpreadsheet, LogOut, Lock, Eye, EyeOff, MessageSquare,
  Upload, Brain, Loader2, BarChart2, ArrowLeft, Scissors,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { parseCSV, csvToAio, reconstructCsvFromAios, parseAioLine, type ConvertedFile } from "@/lib/aio-utils"

// ── View type ────────────────────────────────────────────────────────

type View =
  | "home" | "converter" | "guide" | "workflow" | "reference"
  | "processor" | "paper" | "mro-paper" | "paper-iii" | "bulk-hsl-technote" | "search-modes-technote" | "sysadmin" | "rnd" | "pdf-import" | "search-stats"

// ── Main Page ────────────────────────────────────────────────────────

export default function HomePage() {
  // Auth
  const [currentUser, setCurrentUser] = useState<LoginResult | null>(null)
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [loginEmail, setLoginEmail] = useState("")
  const [loginPassword, setLoginPassword] = useState("")
  const [loginError, setLoginError] = useState<string | null>(null)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Navigation
  const [currentView, setCurrentView] = useState<View>("home")
  const [showHomeChatAIO, setShowHomeChatAIO] = useState(false)

  // Bulk HSL Build (front-page action)
  const [isBulkBuildingHsls, setIsBulkBuildingHsls] = useState(false)
  const handleBulkHslBuild = useCallback(async () => {
    if (isBulkBuildingHsls) return
    setIsBulkBuildingHsls(true)
    try {
      const result = await rebuildHslsFromAios()
      if (!result) {
        toast.error("Backend unavailable — could not build HSLs")
        return
      }
      toast.success(
        `Bulk HSL Build: ${result.created} created · ${result.already_existed} already existed · ${result.skipped_single_aio} skipped (single-AIO) · ${result.total_aios_scanned} AIOs scanned`,
        { duration: 6000 },
      )
    } catch {
      toast.error("Bulk HSL Build failed")
    } finally {
      setIsBulkBuildingHsls(false)
    }
  }, [isBulkBuildingHsls])

  // Prune HSLs (dual of Bulk HSL Build) — destructive, so confirm first.
  const [isPruningHsls, setIsPruningHsls] = useState(false)
  const handlePruneHsls = useCallback(async () => {
    if (isPruningHsls) return
    if (!window.confirm(
      "Prune HSLs?\n\n" +
      "This permanently deletes every HSL whose surviving live-AIO " +
      "member count has dropped below 2. MRO references do not count " +
      "toward the floor.\n\nThis action cannot be undone."
    )) return
    setIsPruningHsls(true)
    try {
      const result = await pruneHsls()
      if (!result) {
        toast.error("Backend unavailable — could not prune HSLs")
        return
      }
      const sample = result.names.slice(0, 5).join(", ")
      toast.success(
        result.pruned === 0
          ? "Prune HSLs: nothing to prune — every HSL still has ≥2 live AIO members."
          : `Prune HSLs: ${result.pruned} removed${sample ? ` · e.g. ${sample}${result.names.length > 5 ? "…" : ""}` : ""}`,
        { duration: 6000 },
      )
    } catch {
      toast.error("Prune HSLs failed")
    } finally {
      setIsPruningHsls(false)
    }
  }, [isPruningHsls])

  // Converter state
  const [downloadedFileNames, setDownloadedFileNames] = useState<string[]>([])
  const [convertedFiles, setConvertedFiles] = useState<ConvertedFile[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [isLoadingFromBackend, setIsLoadingFromBackend] = useState(false)

  // AIO DB dialog
  const [showAioDb, setShowAioDb] = useState(false)
  const [aioDbRecords, setAioDbRecords] = useState<IORecord[]>([])
  const [isLoadingAioDb, setIsLoadingAioDb] = useState(false)

  // CSV preview modal
  const [csvPreviewFile, setCsvPreviewFile] = useState<string | null>(null)
  const [csvPreviewHeaders, setCsvPreviewHeaders] = useState<string[]>([])
  const [csvPreviewRows, setCsvPreviewRows] = useState<string[][]>([])

  const { isOnline: backendIsOnline } = useBackendStatus()

  // ── Helpers ──────────────────────────────────────────────────────

  const handleSystemClick = useCallback(() => setCurrentView("sysadmin"), [])

  const handleLogout = useCallback(() => {
    setCurrentUser(null)
    if (currentView === "sysadmin") setCurrentView("home")
  }, [currentView])

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoggingIn(true)
    setLoginError(null)
    const { user, error } = await loginUser(loginEmail, loginPassword)
    setIsLoggingIn(false)
    if (error || !user) { setLoginError(error ?? "Login failed"); return }
    setCurrentUser(user)
    setShowLoginModal(false)
    setLoginEmail("")
    setLoginPassword("")
    setCurrentView("sysadmin")
  }, [loginEmail, loginPassword])

  // ── Backend save ─────────────────────────────────────────────────

  const saveAIOsToBackend = useCallback(async (files: ConvertedFile[]) => {
    const allPairs: { line: string; source: string }[] = []
    files.forEach((f) => f.aioLines.forEach((line) => allPairs.push({ line, source: f.originalName })))

    // Save to information_objects (AIO)
    let saved = 0, failed = 0
    for (let i = 0; i < allPairs.length; i += 5) {
      const batch = allPairs.slice(i, i + 5)
      const results = await Promise.all(
        batch.map(({ line, source }) =>
          createIO({
            type: "AIO",
            raw: { raw_uri: `data:text/aio,${encodeURIComponent(line)}`, mime_type: "text/aio", size_bytes: line.length },
            context: { source_system: "csv-converter", source_object_id: source },
          }),
        ),
      )
      results.forEach((r) => (r ? saved++ : failed++))
    }
    if (failed > 0) toast.error(`${failed} AIO record(s) failed to save`)
    else if (saved > 0) toast.success(`${saved} AIO records saved to database`)

    // Save parsed elements to aio_data
    let dataSaved = 0, dataFailed = 0
    for (let i = 0; i < allPairs.length; i += 5) {
      const batch = allPairs.slice(i, i + 5)
      const results = await Promise.all(
        batch.map(({ line, source }, batchIdx) => {
          const rowNum = i + batchIdx + 1
          const aioName = `${source} - Row ${rowNum}`
          const parsed = parseAioLine(line)
          const elements: (string | null)[] = Array(50).fill(null)
          parsed.slice(0, 50).forEach((el, idx) => { elements[idx] = el.raw })
          return createAioData(aioName, elements)
        }),
      )
      results.forEach((r) => (r ? dataSaved++ : dataFailed++))
    }
    if (dataFailed > 0) toast.warning(`${dataFailed} AIO element row(s) failed to save`)

    // Save original CSV files
    for (const file of files) {
      const csvText = [file.headers.join(","), ...file.csvData.map((r) => r.join(","))].join("\n")
      await createIO({
        type: "CSV",
        raw: { raw_uri: `data:text/csv,${encodeURIComponent(csvText)}`, mime_type: "text/csv", size_bytes: csvText.length },
        context: { source_system: "csv-converter", source_object_id: file.originalName },
      }).catch(() => toast.warning(`CSV "${file.originalName}" could not be saved`))
    }
  }, [])

  // ── File selection ───────────────────────────────────────────────

  const handleFilesSelected = useCallback(async (files: File[]) => {
    setIsProcessing(true)
    let filesToProcess = files

    // Duplicate check
    if (backendIsOnline) {
      const existing = await listIOs({ type: "CSV", source_system: "csv-converter", limit: 5000 })
      const existingNames = new Set(existing.map((r) => r.context.source_object_id).filter(Boolean))
      const duplicates = files.filter((f) => existingNames.has(f.name))
      if (duplicates.length > 0) {
        duplicates.forEach((f) =>
          toast.error(`"${f.name}" is already in the database. Please pick a different file.`, { duration: 6000 }),
        )
        filesToProcess = files.filter((f) => !existingNames.has(f.name))
        if (filesToProcess.length === 0) { setIsProcessing(false); return }
      }
    }

    const results: ConvertedFile[] = []
    for (const file of filesToProcess) {
      try {
        const text = await file.text()
        const { headers, rows } = parseCSV(text)
        if (headers.length === 0) continue
        const ts = new Date(file.lastModified)
        const fileDate = ts.toISOString().split("T")[0]
        const fileTime = ts.toTimeString().split(" ")[0]
        const aioLines = rows.map((row) => csvToAio(headers, row, file.name, fileDate, fileTime))
        results.push({ originalName: file.name, csvData: rows, headers, aioLines, fileDate, fileTime })
      } catch (err) {
        console.error(`Error processing ${file.name}:`, err)
      }
    }
    setConvertedFiles(results)
    setIsProcessing(false)
    if (backendIsOnline && results.length > 0) saveAIOsToBackend(results).catch(console.error)
  }, [backendIsOnline, saveAIOsToBackend])

  // ── Load from backend ────────────────────────────────────────────

  const handleLoadFromBackend = useCallback(async () => {
    setIsLoadingFromBackend(true)
    const [aioRecords, csvRecords] = await Promise.all([
      listIOs({ type: "AIO", source_system: "csv-converter", limit: 5000 }),
      listIOs({ type: "CSV", source_system: "csv-converter", limit: 5000 }),
    ])

    if (aioRecords.length > 0) {
      const grouped = new Map<string, IORecord[]>()
      aioRecords.forEach((r) => {
        const src = r.context.source_object_id ?? "unknown.csv"
        if (!grouped.has(src)) grouped.set(src, [])
        grouped.get(src)!.push(r)
      })
      const reconstructed: ConvertedFile[] = Array.from(grouped.entries()).map(([name, recs]) => {
        const aioLines = recs.map((r) => {
          const uri = r.raw.raw_uri ?? ""
          return uri.startsWith("data:text/aio,") ? decodeURIComponent(uri.slice("data:text/aio,".length)) : uri
        })
        const { headers, rows } = reconstructCsvFromAios(recs)
        const firstLine = aioLines[0] ?? ""
        const fileDate = firstLine.match(/\[FileDate\.([^\]]+)\]/)?.[1] ?? ""
        const fileTime = firstLine.match(/\[FileTime\.([^\]]+)\]/)?.[1] ?? ""
        return { originalName: name, csvData: rows, headers, aioLines, fileDate, fileTime }
      })
      setConvertedFiles(reconstructed)
      toast.success(`Loaded ${aioRecords.length} AIOs from ${reconstructed.length} file(s)`)
    } else if (csvRecords.length > 0) {
      const reconstructed: ConvertedFile[] = []
      for (const csvRec of csvRecords) {
        const uri = csvRec.raw.raw_uri ?? ""
        if (!uri.startsWith("data:text/csv,")) continue
        const csvText = decodeURIComponent(uri.slice("data:text/csv,".length))
        const { headers, rows } = parseCSV(csvText)
        if (headers.length === 0) continue
        const fileName = csvRec.context.source_object_id ?? "unknown.csv"
        const now = new Date()
        const fileDate = now.toISOString().split("T")[0]
        const fileTime = now.toTimeString().split(" ")[0]
        const aioLines = rows.map((row) => csvToAio(headers, row, fileName, fileDate, fileTime))
        reconstructed.push({ originalName: fileName, csvData: rows, headers, aioLines, fileDate, fileTime })
      }
      if (reconstructed.length > 0) {
        setConvertedFiles(reconstructed)
        toast.success(`Reconstructed ${reconstructed.length} file(s) from saved CSVs`)
      } else {
        toast.info("No saved AIOs or CSVs found in the backend.")
      }
    } else {
      toast.info("No saved AIOs found in the backend.")
    }
    setIsLoadingFromBackend(false)
  }, [])

  // ── View AIO DB dialog ───────────────────────────────────────────

  const handleViewAioDb = useCallback(async () => {
    setShowAioDb(true)
    setIsLoadingAioDb(true)
    const [aios, csvs] = await Promise.all([
      listIOs({ type: "AIO", source_system: "csv-converter", limit: 5000 }),
      listIOs({ type: "CSV", source_system: "csv-converter", limit: 5000 }),
    ])
    setAioDbRecords([...aios, ...csvs])
    setIsLoadingAioDb(false)
  }, [])

  const handleClear = useCallback(() => setConvertedFiles([]), [])

  // ── Route to sub-views ───────────────────────────────────────────

  if (currentView === "guide") return <UserGuide onBack={() => setCurrentView("home")} onSysAdmin={handleSystemClick} />
  if (currentView === "workflow") return <WorkflowDescription onBack={() => setCurrentView("home")} onSysAdmin={handleSystemClick} />
  if (currentView === "reference") return <ReferencePage onBack={() => setCurrentView("home")} onSysAdmin={handleSystemClick} />
  if (currentView === "paper") return <AIOReferencePaper onBack={() => setCurrentView("home")} onSysAdmin={handleSystemClick} />
  if (currentView === "mro-paper") return <MROReferencePaper onBack={() => setCurrentView("home")} onSysAdmin={handleSystemClick} />
  if (currentView === "paper-iii") return <PaperIII onBack={() => setCurrentView("home")} onSysAdmin={handleSystemClick} />
  if (currentView === "bulk-hsl-technote") return <BulkHslTechnote onBack={() => setCurrentView("home")} onSysAdmin={handleSystemClick} />
  if (currentView === "search-modes-technote") return <SearchModesTechnote onBack={() => setCurrentView("home")} onSysAdmin={handleSystemClick} />
  if (currentView === "processor") return <SemanticProcessor files={convertedFiles} downloadedFiles={downloadedFileNames} onBack={() => setCurrentView("converter")} backendIsOnline={backendIsOnline} onSysAdmin={handleSystemClick} />
  if (currentView === "sysadmin") return <SystemManagement onBack={() => setCurrentView("home")} onNavigate={setCurrentView} />
  if (currentView === "rnd") return <ResearchAndDevelopment onBack={() => setCurrentView("home")} backendIsOnline={backendIsOnline} onSysAdmin={handleSystemClick} />
  if (currentView === "pdf-import") return <PdfImportView onBack={() => setCurrentView("home")} onSysAdmin={handleSystemClick} onImportCsv={(csvData) => { setConvertedFiles((prev) => [...prev, csvData]); setCurrentView("converter") }} />
  if (currentView === "search-stats") return (
    <div className="min-h-screen bg-background">
      <header className="bg-[#1e3a5f] text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart2 className="w-6 h-6" />
          <h1 className="text-xl font-bold">Search Statistics Analytics</h1>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setCurrentView("home")} className="gap-2">
          <ArrowLeft className="w-4 h-4" />Back to Home
        </Button>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8">
        <Card><CardContent className="p-6"><SearchStatsPane /></CardContent></Card>
      </main>
    </div>
  )

  // ── Home view ────────────────────────────────────────────────────

  if (currentView === "home") {
    return (
      <div className="min-h-screen bg-background">
        {/* Header */}
        <header className="border-b border-border bg-card">
          <div className="max-w-6xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
                  <Database className="w-5 h-5 text-primary-foreground" />
                </div>
                <h1 className="text-xl font-bold text-foreground">AIO/HSL/MRO Demo System V4.4</h1>
              </div>
              <div className="flex items-center gap-3">
                <BackendStatusBadge />
                {currentUser && <span className="text-xs text-muted-foreground hidden sm:inline">{currentUser.username}</span>}
                {currentUser && (
                  <Button variant="ghost" size="sm" onClick={handleLogout} className="gap-1 text-xs text-muted-foreground">
                    <LogOut className="w-3 h-3" />Logout
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={handleSystemClick} className="gap-2">
                  <Settings className="w-4 h-4" />System Admin
                </Button>
              </div>
            </div>
          </div>
        </header>

        {/* Hero */}
        <section className="max-w-6xl mx-auto px-6 py-16 text-center">
          {/* Wide title tile — nearly spans the page width. Pulled out
              of the inner max-w-3xl container so it can stretch; uses a
              gradient navy with subtle shadow + ring to read as a
              raised banner rather than a flat pill. Type scale steps
              from text-3xl on phones up to text-5xl/6xl at md/lg. */}
          <div className="mx-auto mb-8 max-w-5xl rounded-2xl bg-gradient-to-r from-[#0b2a4a] via-[#0f3460] to-[#0b2a4a] px-6 sm:px-10 py-6 sm:py-8 shadow-lg ring-1 ring-white/10">
            <div className="flex items-center justify-center gap-3 sm:gap-5 text-white">
              <Globe className="w-7 h-7 sm:w-9 sm:h-9 lg:w-11 lg:h-11 shrink-0 opacity-90" />
              <h1 className="font-serif font-semibold tracking-tight leading-none text-3xl sm:text-4xl md:text-5xl lg:text-6xl">
                Information Physics Standard Model
              </h1>
            </div>
          </div>
          <div className="max-w-3xl mx-auto">
            <h2 className="text-4xl font-bold text-foreground mb-2">AIO/HSL/MRO Demo System V4.4</h2>
            <p className="text-lg text-muted-foreground mb-2">by InformationPhysics.ai</p>
            <p className="text-lg text-muted-foreground mb-10">
              Transform your CSV data into Associated Information Objects (AIOs) — the fundamental unit of information in the new Information Physics Standard Model.
            </p>
          </div>

          {/* Primary actions */}
          <div className="flex justify-center gap-4 mb-10 flex-wrap">
            <Button size="lg" onClick={() => setCurrentView("converter")} className="gap-2 px-8">
              Load New CSVs for Conversion<ArrowRight className="w-4 h-4" />
            </Button>
            {backendIsOnline && (
              <Button size="lg" variant="outline" onClick={() => setCurrentView("pdf-import")} className="gap-2 px-8">
                <Upload className="w-4 h-4" />Import PDFs→CSVs
              </Button>
            )}
            <Button size="lg" variant="outline" onClick={async () => { await handleLoadFromBackend(); setCurrentView("processor") }} className="gap-2 px-8">
              <Layers className="w-4 h-4" />Create New HSLs
            </Button>
            {backendIsOnline && (
              <Button
                size="lg"
                variant="outline"
                onClick={handleBulkHslBuild}
                disabled={isBulkBuildingHsls}
                className="gap-2 px-8"
                title="Scan every AIO and emit one HSL per shared [Key.Value] element group (≥2 AIOs). Existing HSLs are preserved."
              >
                {isBulkBuildingHsls ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
                {isBulkBuildingHsls ? "Building HSLs…" : "Bulk HSL Build"}
              </Button>
            )}
            {backendIsOnline && (
              <Button
                size="lg"
                variant="outline"
                onClick={handlePruneHsls}
                disabled={isPruningHsls}
                className="gap-2 px-8"
                title="Remove HSLs whose surviving live-AIO member count has dropped below 2. Dual of Bulk HSL Build. Destructive — confirms first."
              >
                {isPruningHsls ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                {isPruningHsls ? "Pruning HSLs…" : "Prune HSLs"}
              </Button>
            )}
            {backendIsOnline && (
              <Button size="lg" variant="outline" onClick={() => setShowHomeChatAIO(true)} className="gap-2 px-8">
                <MessageSquare className="w-4 h-4" />ChatAIO
              </Button>
            )}
            {backendIsOnline && (
              <Button size="lg" variant="outline" onClick={() => setCurrentView("search-stats")} className="gap-2 px-8">
                <BarChart2 className="w-4 h-4" />Search Statistics Analytics
              </Button>
            )}
            <Button size="lg" variant="outline" onClick={() => setCurrentView("guide")} className="gap-2 px-8">
              <BookOpen className="w-4 h-4" />User Guide
            </Button>
          </div>

          <ChatAioDialog open={showHomeChatAIO} onOpenChange={setShowHomeChatAIO} />

          {/* Feature cards */}
          <div className="grid md:grid-cols-3 gap-6 mb-16">
            {[
              { icon: Layers, title: "Application Agnostic", desc: "AIOs are information objects not tied to any application or relational database schema, enabling universal data interoperability." },
              { icon: Cpu, title: "Hyper-Semantic Model", desc: "AIOs form the basis of a new hyper-semantic model that captures meaning and relationships in a way traditional data formats cannot." },
              { icon: Zap, title: "Next-Gen LLM Foundation", desc: "This hyper-semantic model will serve as the foundation upon which a new class of Large Language Models will operate with enhanced understanding." },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="p-6 rounded-xl bg-card border border-border text-left">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>

          {/* Prominent ChatAIO CTA */}
          {backendIsOnline && (
            <div className="mb-16 flex justify-center">
              <Button
                size="lg"
                onClick={() => setShowHomeChatAIO(true)}
                className="gap-3 px-12 py-8 text-xl font-semibold shadow-lg hover:shadow-xl transition-shadow"
              >
                <MessageSquare className="w-6 h-6" />
                Launch ChatAIO
              </Button>
            </div>
          )}

          {/* Conversion process diagram */}
          <div className="mb-16">
            <h3 className="text-2xl font-bold text-foreground mb-8">The Conversion Process</h3>
            <div className="flex items-center justify-center gap-4 flex-wrap">
              {[
                { label: "CSV", sub: "Tabular Data", highlight: false },
                { label: "[Col.Val]", sub: "AIO Format", highlight: false },
                { label: ".aio", sub: "Semantic Object", highlight: false },
                { label: ".hsl", sub: "Hyper-Semantic-Layer Object", highlight: false },
                { label: ".mro", sub: "Memory Result Object", highlight: false },
              ].map(({ label, sub, highlight }, i) => (
                <div key={label} className="flex items-center gap-4">
                  {i > 0 && <ArrowRight className="w-6 h-6 text-muted-foreground" />}
                  <div className={`flex flex-col items-center gap-2 p-4 rounded-lg border min-w-[120px] ${highlight ? "bg-purple-950/30 border-purple-500/50" : "bg-card border-border"}`}>
                    <span className={`text-2xl font-mono font-bold ${highlight ? "text-purple-400" : "text-primary"}`}>{label}</span>
                    <span className="text-xs text-muted-foreground text-center">{sub}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground mt-6 max-w-2xl mx-auto">
              {"Each row becomes: [OriginalCSV.filename][FileDate.YYYY-MM-DD][FileTime.HH:MM:SS][Column1.Value1][Column2.Value2]..."}
            </p>
          </div>

        </section>

        <footer className="border-t border-border mt-16">
          <div className="max-w-6xl mx-auto px-6 py-6 text-center">
            <p className="text-sm text-muted-foreground">InformationPhysics.ai - Pioneering the Information Physics Standard Model</p>
          </div>
        </footer>

        {/* Login Modal */}
        <Dialog open={showLoginModal} onOpenChange={(open) => { if (!open) { setShowLoginModal(false); setLoginError(null) } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Lock className="w-4 h-4" />Admin Login</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleLogin} className="flex flex-col gap-4 mt-2">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-foreground">Email or Username</label>
                <input type="text" autoComplete="username" required value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="admin@example.com or username" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-foreground">Password</label>
                <div className="relative">
                  <input type={showPassword ? "text" : "password"} autoComplete="current-password" required value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} className="w-full px-3 py-2 pr-10 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="••••••••" />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {loginError && <p className="text-xs text-red-500">{loginError}</p>}
              <Button type="submit" disabled={isLoggingIn} className="gap-2">
                {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                {isLoggingIn ? "Signing in…" : "Sign In"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  // ── Converter view ───────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <button onClick={() => { setCurrentView("home"); handleClear() }} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center"><Database className="w-5 h-5 text-primary-foreground" /></div>
              <div className="text-left">
                <h1 className="text-xl font-bold text-foreground">AIO/HSL/MRO Demo System V4.4</h1>
                <p className="text-xs text-muted-foreground">by InformationPhysics.ai</p>
              </div>
            </button>
            <div className="flex items-center gap-3">
              <BackendStatusBadge />
              <Button variant="outline" size="sm" onClick={handleSystemClick} className="gap-2"><Settings className="w-4 h-4" />System Admin</Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {convertedFiles.length === 0 ? (
          <div>
            <FileUpload onFilesSelected={handleFilesSelected} isProcessing={isProcessing} />
            {backendIsOnline && (
              <div className="mt-6 flex items-center justify-center gap-3">
                <Button variant="outline" onClick={handleLoadFromBackend} disabled={isLoadingFromBackend} className="gap-2">
                  {isLoadingFromBackend ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                  Load Saved AIOs from Backend
                </Button>
                <Button variant="outline" onClick={handleViewAioDb} className="gap-2">
                  <Database className="w-4 h-4" />View Saved AIOs
                </Button>
              </div>
            )}
          </div>
        ) : (
          <ConversionPreview
            files={convertedFiles}
            onClear={handleClear}
            onProcess={(downloaded) => { setDownloadedFileNames(downloaded); setCurrentView("processor") }}
            backendIsOnline={backendIsOnline}
          />
        )}
      </main>

      <footer className="border-t border-border mt-8">
        <div className="max-w-6xl mx-auto px-6 py-4 text-center">
          <p className="text-xs text-muted-foreground">{"Each row becomes: [OriginalCSV.filename][FileDate.YYYY-MM-DD][FileTime.HH:MM:SS][Column1.Value1][Column2.Value2]..."}</p>
        </div>
      </footer>

      {/* Saved AIO/CSV Database Dialog */}
      <Dialog open={showAioDb} onOpenChange={setShowAioDb}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader><DialogTitle>Saved Records Database</DialogTitle></DialogHeader>
          {isLoadingAioDb ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : (
            (() => {
              const aioRecs = aioDbRecords.filter((r) => r.type === "AIO")
              const csvRecs = aioDbRecords.filter((r) => r.type === "CSV")

              const aioGroups = new Map<string, IORecord[]>()
              aioRecs.forEach((r) => {
                const src = r.context.source_object_id ?? "unknown.csv"
                if (!aioGroups.has(src)) aioGroups.set(src, [])
                aioGroups.get(src)!.push(r)
              })
              const fileEntries = Array.from(aioGroups.entries())

              const openCsvPreview = (src: string, recs: IORecord[]) => {
                const saved = csvRecs.find((c) => c.context.source_object_id === src)
                if (saved) {
                  const uri = saved.raw.raw_uri ?? ""
                  if (uri.startsWith("data:text/csv,")) {
                    const { headers, rows } = parseCSV(decodeURIComponent(uri.slice("data:text/csv,".length)))
                    setCsvPreviewFile(src); setCsvPreviewHeaders(headers); setCsvPreviewRows(rows); return
                  }
                }
                const { headers, rows } = reconstructCsvFromAios(recs)
                setCsvPreviewFile(src); setCsvPreviewHeaders(headers); setCsvPreviewRows(rows)
              }

              const renderGrouped = (recs: IORecord[], prefix: string, label: string) => {
                if (recs.length === 0) return <p className="text-sm text-muted-foreground py-6 text-center">No {label} saved yet.</p>
                const grouped = new Map<string, IORecord[]>()
                recs.forEach((r) => { const src = r.context.source_object_id ?? "unknown"; if (!grouped.has(src)) grouped.set(src, []); grouped.get(src)!.push(r) })
                return (
                  <div className="overflow-auto space-y-4">
                    {Array.from(grouped.entries()).map(([src, group]) => (
                      <div key={src}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold font-mono text-foreground">{src}</span>
                          <Badge variant="secondary">{group.length} {label}</Badge>
                        </div>
                        <div className="border border-border rounded-lg overflow-auto">
                          <table className="w-full text-xs">
                            <thead className="bg-muted/50"><tr><th className="px-3 py-2 text-left font-medium text-muted-foreground">Saved</th><th className="px-3 py-2 text-left font-medium text-muted-foreground">Content</th></tr></thead>
                            <tbody>
                              {group.map((r) => {
                                const uri = r.raw.raw_uri ?? ""
                                const content = uri.startsWith(prefix) ? decodeURIComponent(uri.slice(prefix.length)) : uri
                                return (
                                  <tr key={r.io_id} className="border-t border-border hover:bg-accent/50">
                                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                                    <td className="px-3 py-2 font-mono truncate max-w-xs" title={content}>{content.length > 80 ? content.slice(0, 80) + "…" : content}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              }

              return (
                <Tabs defaultValue="csvs" className="flex flex-col overflow-hidden">
                  <TabsList className="shrink-0 mb-3">
                    <TabsTrigger value="csvs">CSV Files <Badge variant="secondary" className="ml-2">{fileEntries.length}</Badge></TabsTrigger>
                    <TabsTrigger value="aios">AIO Records <Badge variant="secondary" className="ml-2">{aioRecs.length}</Badge></TabsTrigger>
                  </TabsList>
                  <TabsContent value="csvs" className="overflow-auto mt-0">
                    {fileEntries.length === 0
                      ? <p className="text-sm text-muted-foreground py-6 text-center">No saved CSV data found.</p>
                      : (
                        <div className="grid grid-cols-2 gap-3 p-1">
                          {fileEntries.map(([src, recs]) => (
                            <button key={src} className="text-left p-4 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors" onClick={() => openCsvPreview(src, recs)}>
                              <div className="flex items-center gap-2 mb-2"><FileSpreadsheet className="w-4 h-4 text-primary shrink-0" /><span className="text-sm font-medium font-mono truncate">{src}</span></div>
                              <div className="flex gap-3 text-xs text-muted-foreground"><span>{recs.length} AIO rows</span><span>·</span><span>Click to view data</span></div>
                            </button>
                          ))}
                        </div>
                      )}
                  </TabsContent>
                  <TabsContent value="aios" className="overflow-auto mt-0">{renderGrouped(aioRecs, "data:text/aio,", "AIOs")}</TabsContent>
                </Tabs>
              )
            })()
          )}
        </DialogContent>
      </Dialog>

      {/* CSV Preview Modal */}
      <Dialog open={!!csvPreviewFile} onOpenChange={(o) => { if (!o) { setCsvPreviewFile(null); setCsvPreviewHeaders([]); setCsvPreviewRows([]) } }}>
        <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="w-4 h-4 text-primary" /><span className="font-mono text-sm">{csvPreviewFile}</span></DialogTitle>
          </DialogHeader>
          {csvPreviewHeaders.length === 0
            ? <p className="text-sm text-muted-foreground py-6 text-center">No data to display.</p>
            : (
              <div className="overflow-auto flex-1 border border-border rounded-lg">
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-muted/70 sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-r border-border w-10">#</th>
                      {csvPreviewHeaders.map((h) => <th key={h} className="px-3 py-2 text-left font-semibold text-foreground border-b border-r border-border whitespace-nowrap">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {csvPreviewRows.map((row, i) => (
                      <tr key={i} className={i % 2 === 0 ? "bg-background hover:bg-accent/30" : "bg-muted/20 hover:bg-accent/30"}>
                        <td className="px-3 py-1.5 text-muted-foreground border-r border-border text-right">{i + 1}</td>
                        {row.map((cell, j) => <td key={j} className="px-3 py-1.5 border-r border-border max-w-[200px] truncate" title={cell}>{cell}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          <p className="text-xs text-muted-foreground pt-1 shrink-0">{csvPreviewRows.length} rows · {csvPreviewHeaders.length} columns</p>
        </DialogContent>
      </Dialog>
    </div>
  )
}
