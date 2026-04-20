"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { MessageSquare, Send, Download, FileText, History, Loader2, X, Printer, Bookmark, Search, BookOpen, Brain, Eye } from "lucide-react"
import { chatWithAIO, aioSearchChat, listSavedPrompts, createSavedPrompt, listMroObjects, createMroObject, listAioData, type ChatMessage, type SavedPrompt, type MroObject, type AioDataRecord } from "@/lib/api-client"
import { runChatPipeline } from "@/lib/aio-chat-pipeline"
import { parseAioLine } from "@/lib/aio-utils"
import type { ParsedAio } from "@/lib/aio-utils"
import { toast } from "sonner"

// ── Markdown table parser ─────────────────────────────────────────

function parseMarkdownTable(block: string): { headers: string[]; rows: string[][] } | null {
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return null
  const isTableLine = (l: string) => l.startsWith("|") && l.endsWith("|")
  if (!isTableLine(lines[0])) return null
  const parseCells = (l: string) => l.split("|").slice(1, -1).map((c) => c.trim())
  const headers = parseCells(lines[0])
  const isSep = (l: string) => /^\|[\s\-:|]+\|$/.test(l)
  if (!isSep(lines[1])) return null
  const rows = lines.slice(2).filter(isTableLine).map(parseCells)
  return { headers, rows }
}

// Split message content into text and table segments for rendering
function renderContent(content: string): React.ReactNode[] {
  const segments: Array<{ type: "text" | "table"; text?: string; headers?: string[]; rows?: string[][] }> = []
  const lines = content.split("\n")
  let textBuf: string[] = []
  let tableBuf: string[] = []

  const flushText = () => {
    if (textBuf.length) { segments.push({ type: "text", text: textBuf.join("\n") }); textBuf = [] }
  }
  const flushTable = () => {
    if (tableBuf.length) {
      const parsed = parseMarkdownTable(tableBuf.join("\n"))
      if (parsed) segments.push({ type: "table", ...parsed })
      else textBuf.push(...tableBuf)
      tableBuf = []
    }
  }

  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith("|") && t.endsWith("|") && t.length > 1) {
      flushText(); tableBuf.push(line)
    } else {
      flushTable(); textBuf.push(line)
    }
  }
  flushTable(); flushText()

  return segments.map((seg, i) => {
    if (seg.type === "table" && seg.headers && seg.rows) {
      return (
        <div key={i} className="overflow-x-auto my-2 rounded-lg border border-border">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-[#0f3460] text-white">
                {seg.headers.map((h, j) => (
                  <th key={j} className="px-3 py-2 text-left font-semibold border-r border-[#1a4a7a] last:border-0 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {seg.rows.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? "bg-background" : "bg-slate-50 dark:bg-slate-900/40"}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-1.5 border-r border-border last:border-0 whitespace-nowrap">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    return <span key={i} className="whitespace-pre-wrap">{seg.text}</span>
  })
}

// ── PDF helpers ───────────────────────────────────────────────────

function markdownTableToHtml(block: string): string | null {
  const parsed = parseMarkdownTable(block)
  if (!parsed) return null
  const headerHtml = parsed.headers.map((h) => `<th>${h}</th>`).join("")
  const rowsHtml = parsed.rows.map((row, i) => {
    const cls = i % 2 !== 0 ? ' class="alt"' : ""
    return `<tr${cls}>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`
  }).join("")
  return `<table><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`
}

function convertContentForPdf(content: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const lines = content.split("\n")
  let html = ""
  let tableBuf: string[] = []
  let textBuf: string[] = []

  const flushText = () => {
    if (textBuf.length) {
      const t = textBuf.join("\n").trim()
      if (t) html += `<p>${esc(t)}</p>`
      textBuf = []
    }
  }
  const flushTable = () => {
    if (tableBuf.length) {
      const tableHtml = markdownTableToHtml(tableBuf.join("\n"))
      if (tableHtml) { flushText(); html += tableHtml }
      else textBuf.push(...tableBuf)
      tableBuf = []
    }
  }

  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith("|") && t.endsWith("|") && t.length > 1) {
      flushText(); tableBuf.push(line)
    } else {
      flushTable(); textBuf.push(line)
    }
  }
  flushTable(); flushText()
  return html
}

function buildPdfHtml(chatMessages: ChatMessage[]): string {
  const messagesHtml = chatMessages.map((m, i) => {
    const isUser = m.role === "user"
    return `
      ${i > 0 ? '<hr class="divider">' : ""}
      <div class="message ${isUser ? "user" : "assistant"}">
        <div class="label">${isUser ? "You" : "ChatAIO"}</div>
        <div class="bubble">${convertContentForPdf(m.content)}</div>
      </div>`
  }).join("")

  const qCount = chatMessages.filter((m) => m.role === "user").length
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>ChatAIO Session — ${new Date().toLocaleDateString()}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 13px; color: #1a1a2e; background: #fff; margin: 0; padding: 48px 40px; }
    .header { display: flex; align-items: flex-end; justify-content: space-between; border-bottom: 3px solid #0f3460; padding-bottom: 16px; margin-bottom: 32px; }
    .header-left h1 { font-size: 26px; font-weight: 800; color: #0f3460; letter-spacing: -0.5px; }
    .header-left .subtitle { font-size: 12px; color: #64748b; margin-top: 4px; }
    .header-right { font-size: 11px; color: #94a3b8; text-align: right; }
    .message { margin-bottom: 4px; }
    .label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
    .user .label { color: #2563eb; }
    .assistant .label { color: #0f3460; }
    .bubble { padding: 14px 18px; border-radius: 8px; line-height: 1.75; word-break: break-word; }
    .user .bubble { background: #eff6ff; border: 1px solid #bfdbfe; border-left: 4px solid #2563eb; }
    .assistant .bubble { background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #0f3460; }
    .bubble p { margin-bottom: 8px; white-space: pre-wrap; }
    .bubble p:last-child { margin-bottom: 0; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 12px; }
    thead tr { background: #0f3460; color: white; }
    thead th { padding: 8px 12px; text-align: left; font-weight: 600; border-right: 1px solid #1a4a7a; }
    thead th:last-child { border-right: none; }
    tbody tr { border-bottom: 1px solid #e2e8f0; }
    tbody tr.alt { background: #f8fafc; }
    tbody td { padding: 6px 12px; border-right: 1px solid #e2e8f0; }
    tbody td:last-child { border-right: none; }
    .divider { border: none; border-top: 1px solid #e2e8f0; margin: 20px 0; }
    .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; }
    @media print { body { padding: 20px; } .bubble { break-inside: avoid; } table { break-inside: avoid; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>ChatAIO Session</h1>
      <div class="subtitle">Information Physics AIO Generator V3.2</div>
    </div>
    <div class="header-right">
      ${new Date().toLocaleString()}<br/>
      ${qCount} question${qCount !== 1 ? "s" : ""}
    </div>
  </div>
  ${messagesHtml}
  <div class="footer">Generated by AIO Generator V3.2 · InformationPhysics.ai</div>
</body>
</html>`
}

// ── Component ─────────────────────────────────────────────────────

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChatAioDialog({ open, onOpenChange }: Props) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState("")
  const [isChatLoading, setIsChatLoading] = useState(false)
  const [promptHistory, setPromptHistory] = useState<string[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [historyMode, setHistoryMode] = useState<"session" | "saved">("session")
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([])
  const [isSavedLoading, setIsSavedLoading] = useState(false)
  const [showPdfModal, setShowPdfModal] = useState(false)
  const [pdfSrcdoc, setPdfSrcdoc] = useState("")
  const [showGuide, setShowGuide] = useState(false)
  const [showMroViewer, setShowMroViewer] = useState(false)
  const [mroList, setMroList] = useState<MroObject[]>([])
  const [mroLoading, setMroLoading] = useState(false)
  const [viewMro, setViewMro] = useState<MroObject | null>(null)
  const [lastSearchMeta, setLastSearchMeta] = useState<{ matched_hsls: number; matched_aios: number; search_terms: string; seed_hsls: string } | null>(null)
  const [substrateAios, setSubstrateAios] = useState<ParsedAio[]>([])
  const [substrateReady, setSubstrateReady] = useState(false)
  const [lastSubstrateMeta, setLastSubstrateMeta] = useState<{ cues: number; neighborhood: number; priors: number; mroSaved: boolean } | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const pdfIframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }) }, [chatMessages, isChatLoading])

  // Load AIO corpus into substrate cache when the dialog opens (for Substrate Mode)
  useEffect(() => {
    if (!open || substrateReady) return
    listAioData().then((records: AioDataRecord[]) => {
      const parsed: ParsedAio[] = records.map((r) => {
        const raw = r.elements.filter(Boolean).join("")
        const csvRoot = r.aio_name.replace(/\s*-\s*Row\s*\d+$/i, "").replace(/\.csv$/i, "") || "backend"
        const lineMatch = r.aio_name.match(/-\s*Row\s*(\d+)$/i)
        const lineNumber = lineMatch ? parseInt(lineMatch[1], 10) : 0
        return { fileName: r.aio_name, elements: parseAioLine(raw), raw, csvRoot, lineNumber }
      })
      setSubstrateAios(parsed)
      setSubstrateReady(true)
    }).catch(() => setSubstrateReady(true))
  }, [open, substrateReady])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) setShowHistory(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  const loadSavedPrompts = useCallback(async () => {
    setIsSavedLoading(true)
    const result = await listSavedPrompts()
    setSavedPrompts(result)
    setIsSavedLoading(false)
  }, [])

  const handleSavePrompt = useCallback(async (text: string) => {
    const result = await createSavedPrompt({ prompt_text: text })
    if (result) {
      toast.success("Prompt saved")
      setSavedPrompts((prev) => [result, ...prev])
    } else {
      toast.error("Failed to save prompt")
    }
  }, [])

  const handleSend = useCallback(async () => {
    const text = chatInput.trim()
    if (!text || isChatLoading) return
    const next: ChatMessage[] = [...chatMessages, { role: "user", content: text }]
    setChatMessages(next)
    setChatInput("")
    setPromptHistory((prev) => (prev.includes(text) ? prev : [text, ...prev].slice(0, 20)))
    setIsChatLoading(true)
    const result = await chatWithAIO(next)
    setIsChatLoading(false)
    if (!result) {
      setChatMessages([...next, { role: "assistant", content: "❌ Backend unreachable. Check your Railway deployment." }])
    } else if ("error" in result) {
      const isKeyMissing = result.error.toLowerCase().includes("api_key") || result.error.toLowerCase().includes("not configured")
      setChatMessages([...next, { role: "assistant", content: isKeyMissing
        ? "❌ Anthropic API key not configured.\n\nGo to System Admin → API Key tab and paste your key (starts with sk-ant-…)."
        : `❌ ${result.error}` }])
    } else {
      setChatMessages([...next, { role: "assistant", content: result.reply }])
    }
  }, [chatInput, chatMessages, isChatLoading])

  const handleAioSearch = useCallback(async () => {
    const text = chatInput.trim()
    if (!text || isChatLoading) return
    const next: ChatMessage[] = [...chatMessages, { role: "user", content: text }]
    setChatMessages(next)
    setChatInput("")
    setPromptHistory((prev) => (prev.includes(text) ? prev : [text, ...prev].slice(0, 20)))
    setIsChatLoading(true)
    const result = await aioSearchChat(next)
    setIsChatLoading(false)
    if (!result) {
      setChatMessages([...next, { role: "assistant", content: "Backend unreachable." }])
    } else if ("error" in result) {
      setChatMessages([...next, { role: "assistant", content: `Error: ${result.error}` }])
    } else {
      const meta = `\n\n---\n_AIO Search: ${result.matched_hsls} HSLs matched, ${result.matched_aios} AIOs in context_`
      setChatMessages([...next, { role: "assistant", content: result.reply + meta }])
      setLastSearchMeta({
        matched_hsls: result.matched_hsls,
        matched_aios: result.matched_aios,
        search_terms: typeof result.search_terms === "string" ? result.search_terms : JSON.stringify(result.search_terms || {}),
        seed_hsls: `${result.matched_hsls} HSLs`
      })
    }
  }, [chatInput, chatMessages, isChatLoading])

  const handleSubstrateSearch = useCallback(async () => {
    const text = chatInput.trim()
    if (!text || isChatLoading) return
    const next: ChatMessage[] = [...chatMessages, { role: "user", content: text }]
    setChatMessages(next)
    setChatInput("")
    setPromptHistory((prev) => (prev.includes(text) ? prev : [text, ...prev].slice(0, 20)))
    setIsChatLoading(true)
    const history = chatMessages
    const result = await runChatPipeline(text, substrateAios, {
      history,
      maxPriors: 3,
      maxAios: 40,
      saveMRO: true,
    })
    setIsChatLoading(false)
    if ("error" in result) {
      const isKeyMissing = result.error.toLowerCase().includes("api_key") || result.error.toLowerCase().includes("not configured")
      setChatMessages([...next, { role: "assistant", content: isKeyMissing
        ? "❌ Anthropic API key not configured.\n\nGo to System Admin → API Key tab and paste your key (starts with sk-ant-…)."
        : `❌ ${result.error}` }])
    } else {
      const meta =
        `\n\n---\n_Substrate pipeline: ${result.cost.cues} cues → ` +
        `${result.cost.neighborhood} AIOs in neighborhood · ` +
        `${result.cost.priors} MRO priors used · ` +
        `${result.mro_saved ? "MRO saved" : "MRO not saved"}_`
      setChatMessages([...next, { role: "assistant", content: result.reply + meta }])
      setLastSubstrateMeta({
        cues: result.cost.cues,
        neighborhood: result.cost.neighborhood,
        priors: result.cost.priors,
        mroSaved: result.mro_saved,
      })
    }
  }, [chatInput, chatMessages, isChatLoading, substrateAios])

  const handleDownloadChat = useCallback(() => {
    if (chatMessages.length === 0) return
    const lines = chatMessages.map((m) => `${m.role === "user" ? "## You" : "## ChatAIO"}\n\n${m.content}`)
    const content = `# ChatAIO Session\n_${new Date().toLocaleString()}_\n\n---\n\n${lines.join("\n\n---\n\n")}\n`
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = `chataio-${new Date().toISOString().slice(0, 10)}.md`; a.click()
    URL.revokeObjectURL(url)
  }, [chatMessages])

  const handleShowPdf = useCallback(() => {
    if (chatMessages.length === 0) return
    setPdfSrcdoc(buildPdfHtml(chatMessages))
    setShowPdfModal(true)
  }, [chatMessages])

  const handlePrint = useCallback(() => {
    pdfIframeRef.current?.contentWindow?.print()
  }, [])

  const handleSaveHtml = useCallback(() => {
    const blob = new Blob([pdfSrcdoc], { type: "text/html;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = `chataio-${new Date().toISOString().slice(0, 10)}.html`; a.click()
    URL.revokeObjectURL(url)
  }, [pdfSrcdoc])

  const handleSaveMro = useCallback(async () => {
    if (chatMessages.length < 2) { toast.error("No conversation to save as MRO"); return }
    const lastUser = [...chatMessages].reverse().find((m) => m.role === "user")
    const lastAssistant = [...chatMessages].reverse().find((m) => m.role === "assistant")
    if (!lastUser || !lastAssistant) { toast.error("Need both a question and response"); return }
    const queryText = lastUser.content
    const resultText = lastAssistant.content
    // Build MRO key from HSL context or query text
    const mroKey = lastSearchMeta ? `HSL-${lastSearchMeta.matched_hsls}-AIO-${lastSearchMeta.matched_aios}` : queryText.slice(0, 60)
    // Build bracket-notation MRO object
    const elements = [
      `[MROKey.${mroKey}]`,
      `[Query.${queryText}]`,
      `[Result.${resultText.replace(/\n/g, " ").slice(0, 2000)}]`,
      `[SearchTerms.${lastSearchMeta?.search_terms || "none"}]`,
      `[SeedHSLs.${lastSearchMeta?.seed_hsls || "none"}]`,
      `[MatchedAIOs.${lastSearchMeta?.matched_aios || 0}]`,
      `[Confidence.derived]`,
      `[Timestamp.${new Date().toISOString()}]`,
    ]
    let searchTermsParsed: Record<string, unknown> = {}
    try {
      const raw = lastSearchMeta?.search_terms || "{}"
      searchTermsParsed = typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown>)
    } catch { /* keep empty */ }
    try {
      const result = await createMroObject({
        mro_key: mroKey,
        query_text: queryText,
        intent: queryText.slice(0, 200),
        seed_hsls: lastSearchMeta?.seed_hsls || "",
        matched_aios_count: lastSearchMeta?.matched_aios || 0,
        search_terms: searchTermsParsed,
        result_text: resultText,
        context_bundle: elements.join("\n"),
        confidence: "derived",
      })
      if (result) toast.success("MRO saved successfully")
      else toast.error("Failed to save MRO")
    } catch (err) {
      console.error("MRO save error:", err)
      toast.error("Failed to save MRO")
    }
  }, [chatMessages, lastSearchMeta])

  const handleLoadMros = useCallback(async () => {
    setShowMroViewer(true)
    setMroLoading(true)
    const data = await listMroObjects()
    setMroList(data)
    setMroLoading(false)
  }, [])

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[95vw] w-full h-[95vh] flex flex-col p-0 gap-0 overflow-hidden">
          {/* Navy header — title on top, buttons below */}
          <DialogHeader className="px-6 py-3 shrink-0 bg-[#0f3460] rounded-t-lg">
            <DialogTitle className="flex items-center gap-2 text-white text-lg mb-2">
              <MessageSquare className="w-5 h-5 text-white" />
              ChatAIO - AI Access to AIO/HSL/MRO Information
            </DialogTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="ghost" size="sm" onClick={handleDownloadChat} disabled={chatMessages.length === 0}
                className="gap-1.5 text-xs text-white hover:bg-white/20 hover:text-white border-white/30" title="Download chat as markdown">
                <Download className="w-3.5 h-3.5" />Chat
              </Button>
              <Button variant="ghost" size="sm" onClick={handleShowPdf} disabled={chatMessages.length === 0}
                className="gap-1.5 text-xs text-white hover:bg-white/20 hover:text-white border-white/30" title="Preview PDF">
                <FileText className="w-3.5 h-3.5" />PDF
              </Button>
              <Button variant="ghost" size="sm" onClick={handleSaveMro} disabled={chatMessages.length < 2}
                className="gap-1.5 text-xs text-white hover:bg-white/20 hover:text-white border-white/30" title="Save last response as a Memory Result Object">
                <Brain className="w-3.5 h-3.5" />Save MRO
              </Button>
              <Button variant="ghost" size="sm" onClick={handleLoadMros}
                className="gap-1.5 text-xs text-white hover:bg-white/20 hover:text-white border-white/30" title="View saved MROs">
                <Eye className="w-3.5 h-3.5" />View MROs
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowGuide(!showGuide)}
                className="gap-1.5 text-xs text-white hover:bg-white/20 hover:text-white border-white/30" title="ChatAIO User Guide">
                <BookOpen className="w-3.5 h-3.5" />Guide
              </Button>
              <div className="flex-1" />
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}
                className="gap-1.5 text-xs text-white hover:bg-white/20 hover:text-white border-white/30" title="Close">
                <X className="w-4 h-4" />Close
              </Button>
            </div>
          </DialogHeader>

          {/* Guide Panel */}
          {showGuide && (
            <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
              <div className="max-w-3xl mx-auto space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold flex items-center gap-2"><BookOpen className="w-5 h-5 text-primary" />ChatAIO User Guide</h2>
                  <Button variant="ghost" size="sm" onClick={() => setShowGuide(false)}>Back to Chat</Button>
                </div>

                <div className="space-y-4">
                  <div className="rounded-lg border p-4 space-y-2">
                    <h3 className="font-semibold text-lg">Overview</h3>
                    <p className="text-sm text-muted-foreground">ChatAIO is a full-screen AI-powered conversational interface for querying your AIO and HSL data using natural language. It uses Claude AI to analyze your data and answer questions with contextual, data-grounded responses.</p>
                  </div>

                  <div className="rounded-lg border p-4 space-y-2">
                    <h3 className="font-semibold text-lg">Three Search Modes</h3>
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm font-semibold">Send (Broad Search)</p>
                        <p className="text-sm text-muted-foreground">Sends your question to Claude along with ALL stored AIO and HSL records as context (up to 500 records). Best for general questions like &quot;What vendors are in this data?&quot; or &quot;Total invoice amount by vendor.&quot;</p>
                      </div>
                      <div>
                        <p className="text-sm font-semibold">AIO Search (Targeted Search Algebra)</p>
                        <p className="text-sm text-muted-foreground">Uses a four-phase search algebra for focused, precise answers:</p>
                        <ol className="list-decimal list-inside text-sm text-muted-foreground ml-2 mt-1 space-y-1">
                          <li><span className="font-medium text-foreground">Parse:</span> Claude extracts key search terms from your prompt (names, projects, dates, amounts)</li>
                          <li><span className="font-medium text-foreground">Match HSLs:</span> Searches the HSL library for records containing those terms</li>
                          <li><span className="font-medium text-foreground">Gather AIOs:</span> Collects only the AIOs referenced in matching HSLs</li>
                          <li><span className="font-medium text-foreground">Answer:</span> Responds using ONLY the focused AIO subset</li>
                        </ol>
                        <p className="text-sm text-muted-foreground mt-1">If no HSLs match, falls back to direct element-level search across all AIOs. The response footer shows how many HSLs and AIOs were matched.</p>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-purple-600">🧠 Substrate Mode (Paper III Pipeline) — purple button</p>
                        <p className="text-sm text-muted-foreground">The most precise retrieval mode. Implements the full 5-step Information Physics pipeline:</p>
                        <ol className="list-decimal list-inside text-sm text-muted-foreground ml-2 mt-1 space-y-1">
                          <li><span className="font-medium text-foreground">Cue Extraction:</span> Deterministically extracts semantic cues from your query</li>
                          <li><span className="font-medium text-foreground">HSL Traversal:</span> Computes N(K) = ⋂ H(k) — the intersection of AIO neighborhoods for each cue</li>
                          <li><span className="font-medium text-foreground">MRO Pre-fetch:</span> Ranks prior Memory Result Objects by Jaccard × freshness × confidence</li>
                          <li><span className="font-medium text-foreground">Context Assembly:</span> Builds a tiered context bundle from matched AIOs and MRO priors</li>
                          <li><span className="font-medium text-foreground">MRO Capture:</span> Automatically saves the answer as a new MRO in the information universe</li>
                        </ol>
                        <p className="text-sm text-muted-foreground mt-1">The response footer shows: cues extracted, AIOs in neighborhood, MRO priors used, and whether an MRO was saved. The Substrate button activates once the AIO corpus is loaded (a moment after opening ChatAIO).</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border p-4 space-y-2">
                    <h3 className="font-semibold text-lg">Saved Prompts (Remember Prompts)</h3>
                    <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                      <li>Click the <span className="font-medium text-foreground">bookmark icon</span> to save the current prompt</li>
                      <li>Choose <span className="font-medium text-foreground">&quot;Current Session&quot;</span> to keep for this session only, or <span className="font-medium text-foreground">&quot;Save to Database&quot;</span> to persist across sessions</li>
                      <li>Database-saved prompts are stored in PostgreSQL and available in future sessions</li>
                      <li>Click the <span className="font-medium text-foreground">history icon</span> to browse and reuse previous prompts from both session and database</li>
                      <li>Manage saved prompts via <span className="font-medium text-foreground">System Admin → Saved Prompts</span> tab</li>
                    </ul>
                  </div>

                  <div className="rounded-lg border p-4 space-y-2">
                    <h3 className="font-semibold text-lg">Header Toolbar</h3>
                    <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                      <li><span className="font-medium text-foreground">Chat:</span> Download the full chat session as a Markdown file</li>
                      <li><span className="font-medium text-foreground">PDF:</span> Generate and preview a PDF report of the conversation with print/save options</li>
                      <li><span className="font-medium text-foreground">Save MRO:</span> Manually save the last AI response as a Memory Result Object</li>
                      <li><span className="font-medium text-foreground">View MROs:</span> Browse all saved Memory Result Objects</li>
                      <li><span className="font-medium text-foreground">Guide:</span> Open this ChatAIO user guide</li>
                      <li><span className="font-medium text-foreground">Close:</span> Close ChatAIO and return to the home page</li>
                    </ul>
                  </div>

                  <div className="rounded-lg border p-4 space-y-2">
                    <h3 className="font-semibold text-lg">Memory Result Objects (MROs)</h3>
                    <p className="text-sm text-muted-foreground">MROs are derived episodic objects that preserve the results of retrieval-and-inference events. Based on Information Physics theory, an MRO captures not just the answer, but the full context of how it was generated — the query, search terms, matched HSLs, contributing AIOs, and the synthesized result.</p>
                    <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                      <li>Click <span className="font-medium text-foreground">Save MRO</span> after receiving an AIO Search response to preserve the result as a Memory Result Object</li>
                      <li>MROs are stored in bracket-notation format: [MROKey.key], [Query.text], [Result.text], [SearchTerms.json], [SeedHSLs.count], [MatchedAIOs.count], [Confidence.derived], [Timestamp.iso]</li>
                      <li>Click <span className="font-medium text-foreground">View MROs</span> to browse all saved Memory Result Objects</li>
                      <li>Each MRO records its provenance — the query cue, the HSL traversal path, the recovered context, and the AI-generated synthesis</li>
                      <li>MROs enable the system to remember prior retrieval episodes, creating recursive memory where past successful queries become reusable organizational knowledge</li>
                      <li>MROs are <span className="font-medium text-foreground">derived</span> objects — they are always subordinate to the originating AIOs and must not replace source evidence</li>
                    </ul>
                  </div>

                  <div className="rounded-lg border p-4 space-y-2">
                    <h3 className="font-semibold text-lg">Tips</h3>
                    <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                      <li>Use <span className="font-medium text-foreground">Send</span> for broad exploratory questions across all data</li>
                      <li>Use <span className="font-medium text-foreground">AIO Search</span> when asking about specific people, projects, or entities</li>
                      <li>Use <span className="font-medium text-purple-600 font-semibold">Substrate</span> (purple button, right side of input bar) for the full Paper III pipeline — most precise, auto-saves MRO</li>
                      <li>Press <span className="font-medium text-foreground">Enter</span> to quick-send with the Send button</li>
                      <li>ChatAIO requires a valid Anthropic API key configured in System Admin → API Key</li>
                      <li>Responses include markdown tables when relevant — they render as formatted tables in the chat</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Messages */}
          {!showGuide && (
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 min-h-0">
              {chatMessages.length === 0 && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Suggested questions:</p>
                  {["What vendors are in this data?", "Total invoice amount by vendor", "List all projects with their status"].map((q) => (
                    <button key={q} onClick={() => setChatInput(q)}
                      className="block text-left text-sm px-3 py-2 rounded-lg border border-border hover:bg-muted w-full transition-colors">
                      {q}
                    </button>
                  ))}
                </div>
              )}
              {chatMessages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[90%] rounded-lg px-4 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                    {renderContent(m.content)}
                  </div>
                </div>
              ))}
              {isChatLoading && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-lg px-4 py-2">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}

          {/* Input area */}
          <div className="px-6 py-4 border-t border-border shrink-0">
            {/* Row 1: history + text input */}
            <div className="flex gap-2 mb-2">
              <div className="relative" ref={historyRef}>
                <Button variant="outline" size="sm" onClick={() => {
                  const opening = !showHistory
                  setShowHistory(opening)
                  if (opening && historyMode === "saved") loadSavedPrompts()
                }} className="gap-1.5 h-9 px-3" title="Previous prompts">
                  <History className="w-4 h-4" />
                </Button>
                {showHistory && (
                  <div className="absolute bottom-full mb-2 left-0 w-96 bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden">
                    {/* Header with toggle */}
                    <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                      <div className="flex gap-1">
                        <button onClick={() => setHistoryMode("session")}
                          className={`text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${historyMode === "session" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
                          Current Session
                        </button>
                        <button onClick={() => { setHistoryMode("saved"); loadSavedPrompts() }}
                          className={`text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${historyMode === "saved" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
                          Saved (Prior)
                        </button>
                      </div>
                      <button onClick={() => setShowHistory(false)}><X className="w-3.5 h-3.5 text-muted-foreground" /></button>
                    </div>

                    {/* Content */}
                    <div className="max-h-48 overflow-y-auto">
                      {historyMode === "session" ? (
                        promptHistory.length === 0 ? (
                          <div className="px-3 py-4 text-center text-xs text-muted-foreground">No prompts in this session yet</div>
                        ) : (
                          promptHistory.map((p, i) => (
                            <div key={i} className="flex items-center gap-1 border-b border-border/50 last:border-0">
                              <button onClick={() => { setChatInput(p); setShowHistory(false) }}
                                className="flex-1 text-left text-sm px-3 py-2 hover:bg-muted truncate">
                                {p}
                              </button>
                              <button onClick={() => handleSavePrompt(p)} title="Save for later"
                                className="shrink-0 px-2 py-2 hover:bg-muted text-muted-foreground hover:text-primary transition-colors">
                                <Bookmark className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))
                        )
                      ) : isSavedLoading ? (
                        <div className="px-3 py-4 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                      ) : savedPrompts.length === 0 ? (
                        <div className="px-3 py-4 text-center text-xs text-muted-foreground">No saved prompts yet. Save prompts from your current session using the bookmark icon.</div>
                      ) : (
                        savedPrompts.map((sp) => (
                          <button key={sp.prompt_id} onClick={() => { setChatInput(sp.prompt_text); setShowHistory(false) }}
                            className="block w-full text-left text-sm px-3 py-2 hover:bg-muted truncate border-b border-border/50 last:border-0">
                            {sp.label ? <span className="font-medium">{sp.label}: </span> : null}
                            {sp.prompt_text}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
              <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                placeholder="Ask about your AIO data…"
                className="flex-1 text-sm px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                disabled={isChatLoading} />
            </div>
            {/* Row 2: action buttons */}
            <div className="flex gap-2 justify-end">
              <Button size="sm" onClick={handleSend} disabled={!chatInput.trim() || isChatLoading} className="gap-2 shrink-0 h-9">
                <Send className="w-4 h-4" />Send
              </Button>
              <Button size="sm" variant="outline" onClick={handleAioSearch} disabled={!chatInput.trim() || isChatLoading} className="gap-2 shrink-0 h-9" title="Search HSL library first, then answer with matching AIOs only">
                <Search className="w-4 h-4" />AIO Search
              </Button>
              <Button size="sm" variant="outline" onClick={handleSubstrateSearch}
                disabled={!chatInput.trim() || isChatLoading || !substrateReady}
                className="gap-2 shrink-0 h-9 border-purple-500/50 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/30"
                title="Substrate Mode: extract cues, traverse HSL neighborhoods, pre-fetch MRO priors, and persist the answer as a new MRO (Paper III pipeline)">
                <Brain className="w-4 h-4" />Substrate
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* PDF Preview Modal */}
      <Dialog open={showPdfModal} onOpenChange={setShowPdfModal}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 shrink-0 bg-[#0f3460] rounded-t-lg">
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2 text-white">
                <FileText className="w-5 h-5 text-white" />
                PDF Preview
              </DialogTitle>
              <div className="flex items-center gap-3">
                <Button size="sm" onClick={handleSaveHtml}
                  className="gap-1.5 bg-white text-[#0f3460] hover:bg-white/90 font-semibold">
                  <Download className="w-4 h-4" />Save
                </Button>
                <Button size="sm" onClick={handlePrint}
                  className="gap-1.5 bg-white text-[#0f3460] hover:bg-white/90 font-semibold">
                  <Printer className="w-4 h-4" />Print
                </Button>
              </div>
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0 bg-gray-100">
            <iframe ref={pdfIframeRef} srcDoc={pdfSrcdoc} className="w-full h-full border-0" title="PDF Preview" />
          </div>
        </DialogContent>
      </Dialog>

      {/* MRO Viewer Dialog */}
      <Dialog open={showMroViewer} onOpenChange={setShowMroViewer}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 shrink-0 bg-[#0f3460] rounded-t-lg">
            <DialogTitle className="flex items-center gap-2 text-white">
              <Brain className="w-5 h-5 text-white" />
              Memory Result Objects (MROs)
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto p-6 min-h-0">
            {mroLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : mroList.length === 0 ? (
              <p className="text-center py-12 text-muted-foreground">No MROs saved yet. Use &quot;Save MRO&quot; after an AIO Search to create one.</p>
            ) : (
              <div className="rounded border border-border overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#0f3460] sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-white">MRO Key</th>
                      <th className="text-left px-4 py-2 font-medium text-white">Query</th>
                      <th className="text-left px-4 py-2 font-medium text-white">AIOs</th>
                      <th className="text-left px-4 py-2 font-medium text-white">Created</th>
                      <th className="text-left px-4 py-2 font-medium text-white">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {mroList.map((mro) => (
                      <tr key={mro.mro_id} className="hover:bg-muted/30">
                        <td className="px-4 py-2 font-medium text-xs">{mro.mro_key}</td>
                        <td className="px-4 py-2 text-xs truncate max-w-[250px]">{mro.query_text}</td>
                        <td className="px-4 py-2 text-xs">{mro.matched_aios_count}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{mro.created_at?.substring(0, 19)}</td>
                        <td className="px-4 py-2">
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-blue-600" onClick={() => setViewMro(mro)}>
                            <Eye className="w-3 h-3 mr-1" />View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* MRO Detail Viewer */}
      <Dialog open={!!viewMro} onOpenChange={(open) => { if (!open) setViewMro(null) }}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 shrink-0 bg-[#0f3460] rounded-t-lg">
            <DialogTitle className="flex items-center gap-2 text-white">
              <Brain className="w-5 h-5 text-white" />
              MRO Detail: {viewMro?.mro_key}
            </DialogTitle>
          </DialogHeader>
          {viewMro && (
            <div className="flex-1 overflow-auto p-6 min-h-0 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border p-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">MRO Key</p>
                  <p className="text-sm font-medium">{viewMro.mro_key}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Confidence</p>
                  <p className="text-sm font-medium">{viewMro.confidence || "derived"}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Matched AIOs</p>
                  <p className="text-sm font-medium">{viewMro.matched_aios_count}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Created</p>
                  <p className="text-sm font-medium">{viewMro.created_at?.substring(0, 19)}</p>
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Query (Cue)</p>
                <p className="text-sm">{viewMro.query_text}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Seed HSLs</p>
                <p className="text-sm">{viewMro.seed_hsls || "none"}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Search Terms</p>
                <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-24">{typeof viewMro.search_terms === "string" ? viewMro.search_terms : JSON.stringify(viewMro.search_terms, null, 2)}</pre>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Result (Synthesis)</p>
                <div className="text-sm whitespace-pre-wrap max-h-48 overflow-auto">{viewMro.result_text}</div>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">MRO Object (Bracket Notation)</p>
                <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-48 font-mono leading-relaxed">{viewMro.context_bundle}</pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
