"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { MessageSquare, Send, Download, FileText, History, Loader2, X, Printer, Bookmark, Search, BookOpen, Brain, Eye, Sparkles } from "lucide-react"
import { chatWithAIO, pureLlmChat, aioSearchChat, aioSearchChatStream, aioSearchParse, listSavedPrompts, createSavedPrompt, listMroObjects, getMroObject, createMroObject, listAioData, listHslKeyValuePairs, findHslsByNeedlesFull, createChatStat, linkMroToHsl, findHslsByNeedles, getCapSettings, type ChatMessage, type SavedPrompt, type MroObject, type AioDataRecord, type HslDataRecord, type HslKeyValuePair, type AioSearchStreamMeta } from "@/lib/api-client"
import { runChatPipeline } from "@/lib/aio-chat-pipeline"
import { parseAioLine } from "@/lib/aio-utils"
import type { ParsedAio } from "@/lib/aio-utils"
import { toast } from "sonner"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

// ── Error normalization ───────────────────────────────────────────
//
// Backend errors arrive in two shapes: plain strings ("404 Not Found",
// "Backend unavailable") and JSON envelopes (the budget rate-limiter
// returns {error, tenant_id, used_today, limit, percent_used,
// message}). Calling .toLowerCase() on the latter throws and crashes
// the React tree. asErrorString() coerces any shape to a single
// human-readable string by preferring `message`, then `error`, then
// JSON.stringify.
function asErrorString(e: unknown): string {
  if (e == null) return "unknown_error"
  if (typeof e === "string") return e
  if (e instanceof Error) return e.message || String(e)
  if (typeof e === "object") {
    const o = e as Record<string, unknown>
    if (typeof o.message === "string" && o.message) return String(o.message)
    if (typeof o.error === "string" && o.error) return String(o.error)
    try { return JSON.stringify(o) } catch { return String(o) }
  }
  return String(e)
}

// ── Pane header metadata for assistant replies ────────────────────
//
// Each successful assistant message gets a header chip rendered ABOVE
// its bubble: "▸ <Search Type> · <weekday>, <date> · <time>". The
// suffix (-F for Force fresh, -T for Thorough) is part of the search
// type label so the operator can see at a glance which Recall mode
// was active for this answer.
//
// CRITICAL: the header is rendered as a separate React element, NOT
// embedded in the message content. If the header lived in `content`,
// it would (a) ride along with the prior in the next LLM call's chat
// history, and (b) the model would imitate the "▸ <Label> · <date>"
// pattern at the top of its own reply, producing a double-header. The
// metadata-side rendering keeps content pristine.

interface PaneHeader {
  searchType: string
  when: Date
}

function makePaneHeader(searchType: string, when: Date): PaneHeader {
  return { searchType, when }
}

function PaneHeaderChip({ header }: { header: PaneHeader }) {
  const date = header.when.toLocaleDateString(undefined, {
    weekday: "short", year: "numeric", month: "short", day: "numeric",
  })
  const time = header.when.toLocaleTimeString(undefined, {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
  return (
    <div className="flex items-center gap-1.5 mb-1.5 text-[11px] text-muted-foreground/80 font-medium">
      <span className="text-[#0f3460] dark:text-blue-400">▸</span>
      <span className="text-foreground font-semibold">{header.searchType}</span>
      <span>·</span>
      <span>{date}</span>
      <span>·</span>
      <span className="tabular-nums">{time}</span>
    </div>
  )
}

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

// ── Rich markdown rendering ───────────────────────────────────────
//
// Replaces the prior table-only renderer with a full GFM markdown
// pipeline (react-markdown + remark-gfm). Element-level component
// overrides preserve the existing navy-branded styling for tables
// and add professional treatment for headings, lists, blockquotes,
// inline/block code, links, and horizontal rules.
//
// Style rationale:
//   - Headings stair-step (H1 18px → H4 13px) with a subtle navy
//     accent so multi-section LLM replies scan cleanly.
//   - Lists get tight spacing and proper indentation; nested lists
//     inherit the same treatment via Tailwind's `ml-` utilities.
//   - Code blocks render in a slate background with a 2px navy
//     left border, matching the assistant bubble's visual language.
//   - Inline code uses the same accent at smaller scale.
//   - Tables retain the #0f3460 navy header from before, with
//     zebra striping that respects light/dark mode.
//   - Footer perf-metric line (`---\n_…_`) becomes a muted italic
//     blockquote-style rule via the <hr> + emphasized-paragraph
//     treatment, reading as production-quality reportage.
function renderContent(content: string): React.ReactNode {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="text-lg font-bold text-[#0f3460] dark:text-blue-300 mt-3 mb-2 pb-1 border-b border-slate-200 dark:border-slate-700">
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-base font-bold text-[#0f3460] dark:text-blue-300 mt-3 mb-1.5">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-2.5 mb-1">{children}</h3>
        ),
        h4: ({ children }) => (
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mt-2 mb-1">{children}</h4>
        ),
        p: ({ children }) => (
          <p className="my-2 leading-relaxed text-slate-800 dark:text-slate-200">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="my-2 ml-5 list-disc space-y-1 text-slate-800 dark:text-slate-200 marker:text-[#0f3460] dark:marker:text-blue-400">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="my-2 ml-5 list-decimal space-y-1 text-slate-800 dark:text-slate-200 marker:text-[#0f3460] marker:font-semibold dark:marker:text-blue-400">
            {children}
          </ol>
        ),
        li: ({ children }) => <li className="leading-relaxed pl-1">{children}</li>,
        strong: ({ children }) => (
          <strong className="font-semibold text-slate-900 dark:text-white">{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#0f3460] dark:text-blue-400 underline underline-offset-2 hover:opacity-80"
          >
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-4 border-[#0f3460] dark:border-blue-500 bg-slate-50 dark:bg-slate-900/40 pl-3 pr-2 py-1 italic text-slate-700 dark:text-slate-300">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-3 border-t border-slate-200 dark:border-slate-700" />,
        code: ({ className, children, ...props }) => {
          const isInline = !className?.includes("language-")
          if (isInline) {
            return (
              <code
                className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[0.85em] font-mono text-[#0f3460] dark:text-blue-300"
                {...props}
              >
                {children}
              </code>
            )
          }
          return (
            <code className={`${className} font-mono text-xs`} {...props}>
              {children}
            </code>
          )
        },
        pre: ({ children }) => (
          <pre className="my-2 overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700 border-l-2 border-l-[#0f3460] dark:border-l-blue-500 bg-slate-50 dark:bg-slate-900/60 p-3 text-xs leading-relaxed">
            {children}
          </pre>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto my-3 rounded-lg border border-border">
            <table className="min-w-full text-xs border-collapse">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead>{children}</thead>,
        tbody: ({ children }) => <tbody>{children}</tbody>,
        tr: ({ children, ...props }) => {
          // remark-gfm marks header rows by placing them inside <thead>.
          // We don't have access to that context here, so apply zebra
          // striping via :nth-child in a wrapper class; header styling
          // is keyed off the parent <thead> via descendant selectors
          // expressed as Tailwind utilities on <th>/<td> below.
          return <tr className="border-b border-border last:border-0 even:bg-slate-50 dark:even:bg-slate-900/40" {...props}>{children}</tr>
        },
        th: ({ children, style }) => (
          <th
            style={style}
            className="bg-[#0f3460] text-white px-3 py-2 text-left font-semibold border-r border-[#1a4a7a] last:border-0 whitespace-nowrap"
          >
            {children}
          </th>
        ),
        td: ({ children, style }) => (
          <td
            style={style}
            className="px-3 py-1.5 border-r border-border last:border-0 align-top"
          >
            {children}
          </td>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  )
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

// Inline markdown → HTML: bold, italic, inline code, links.
// Order matters: code first (so its contents aren't re-processed for
// bold/italic), then bold, italic, then links.
function inlineMarkdownToHtml(s: string): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  // Snapshot inline code spans so their bodies aren't re-processed.
  const codeSpans: string[] = []
  let out = esc(s).replace(/`([^`]+)`/g, (_m, body: string) => {
    const idx = codeSpans.push(body) - 1
    return ` CODE${idx} `
  })
  // Bold (** or __), then italic (* or _) — non-greedy so adjacent
  // emphasis doesn't merge. Single underscores inside words (e.g.
  // table_name) are protected by requiring word-boundary on the
  // opening token.
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
  out = out.replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
  out = out.replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>")
  // Links: [text](url)
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    '<a href="$2">$1</a>',
  )
  // Restore code spans last (already escaped at the top, just wrap).
  out = out.replace(/ CODE(\d+) /g, (_m, i: string) => `<code>${codeSpans[Number(i)]}</code>`)
  return out
}

// Block-level markdown → HTML for the PDF export. Mirrors the
// in-app react-markdown renderer (headings, lists, blockquotes,
// fenced code, hr, tables) with print-tuned styling defined in
// buildPdfHtml's <style>. Conservative scope on purpose: this is
// not a full CommonMark implementation, only what LLMs actually
// emit in practice.
function convertContentForPdf(content: string): string {
  const lines = content.split("\n")
  let html = ""

  let i = 0
  // Paragraph + table buffers (existing behavior, preserved).
  let para: string[] = []
  let tableBuf: string[] = []

  const flushPara = () => {
    if (para.length) {
      const t = para.join("\n").trim()
      if (t) html += `<p>${inlineMarkdownToHtml(t)}</p>`
      para = []
    }
  }
  const flushTable = () => {
    if (tableBuf.length) {
      const tableHtml = markdownTableToHtml(tableBuf.join("\n"))
      if (tableHtml) {
        flushPara()
        html += tableHtml
      } else {
        para.push(...tableBuf)
      }
      tableBuf = []
    }
  }

  while (i < lines.length) {
    const raw = lines[i]
    const line = raw.trimEnd()
    const t = line.trim()

    // Fenced code block ```lang ... ```
    if (t.startsWith("```")) {
      flushPara(); flushTable()
      i++
      const codeLines: string[] = []
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i])
        i++
      }
      i++ // consume closing fence
      const escaped = codeLines.join("\n")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
      html += `<pre><code>${escaped}</code></pre>`
      continue
    }

    // Heading
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(t)
    if (headingMatch) {
      flushPara(); flushTable()
      const level = headingMatch[1].length
      html += `<h${level}>${inlineMarkdownToHtml(headingMatch[2])}</h${level}>`
      i++
      continue
    }

    // Horizontal rule
    if (/^(---+|\*\*\*+|___+)$/.test(t)) {
      flushPara(); flushTable()
      html += "<hr/>"
      i++
      continue
    }

    // Blockquote
    if (t.startsWith("> ")) {
      flushPara(); flushTable()
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith("> ")) {
        quoteLines.push(lines[i].trim().slice(2))
        i++
      }
      html += `<blockquote>${inlineMarkdownToHtml(quoteLines.join(" "))}</blockquote>`
      continue
    }

    // Unordered list
    if (/^[-*+]\s+/.test(t)) {
      flushPara(); flushTable()
      const items: string[] = []
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ""))
        i++
      }
      html += `<ul>${items.map((x) => `<li>${inlineMarkdownToHtml(x)}</li>`).join("")}</ul>`
      continue
    }

    // Ordered list
    if (/^\d+[.)]\s+/.test(t)) {
      flushPara(); flushTable()
      const items: string[] = []
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ""))
        i++
      }
      html += `<ol>${items.map((x) => `<li>${inlineMarkdownToHtml(x)}</li>`).join("")}</ol>`
      continue
    }

    // Table row (existing behavior, unchanged)
    if (t.startsWith("|") && t.endsWith("|") && t.length > 1) {
      flushPara()
      tableBuf.push(line)
      i++
      continue
    }

    // Plain paragraph: blank line ends current paragraph
    if (t === "") {
      flushPara(); flushTable()
      i++
      continue
    }
    flushTable()
    para.push(line)
    i++
  }
  flushTable()
  flushPara()
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
    .bubble { padding: 14px 18px; border-radius: 8px; line-height: 1.7; word-break: break-word; }
    .user .bubble { background: #eff6ff; border: 1px solid #bfdbfe; border-left: 4px solid #2563eb; }
    .assistant .bubble { background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #0f3460; }
    .bubble p { margin-bottom: 8px; }
    .bubble p:last-child { margin-bottom: 0; }
    .bubble h1, .bubble h2, .bubble h3, .bubble h4 { color: #0f3460; font-weight: 700; margin: 14px 0 6px 0; line-height: 1.3; }
    .bubble h1 { font-size: 17px; padding-bottom: 4px; border-bottom: 1px solid #cbd5e1; }
    .bubble h2 { font-size: 15px; }
    .bubble h3 { font-size: 13.5px; color: #1e293b; }
    .bubble h4 { font-size: 13px; color: #334155; }
    .bubble h1:first-child, .bubble h2:first-child, .bubble h3:first-child, .bubble h4:first-child { margin-top: 0; }
    .bubble ul, .bubble ol { margin: 8px 0 8px 24px; padding-left: 8px; }
    .bubble li { margin-bottom: 4px; line-height: 1.65; }
    .bubble ul li::marker { color: #0f3460; }
    .bubble ol li::marker { color: #0f3460; font-weight: 600; }
    .bubble strong { color: #0f172a; font-weight: 600; }
    .bubble em { font-style: italic; color: #1e293b; }
    .bubble a { color: #0f3460; text-decoration: underline; text-underline-offset: 2px; }
    .bubble code { background: #e2e8f0; color: #0f3460; padding: 1px 5px; border-radius: 3px; font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 11.5px; }
    .bubble pre { margin: 10px 0; padding: 10px 12px; background: #f1f5f9; border: 1px solid #e2e8f0; border-left: 2px solid #0f3460; border-radius: 4px; font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 11px; line-height: 1.55; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
    .bubble pre code { background: none; color: inherit; padding: 0; border-radius: 0; font-size: inherit; }
    .bubble blockquote { margin: 10px 0; padding: 4px 12px; background: #f8fafc; border-left: 3px solid #0f3460; color: #475569; font-style: italic; border-radius: 0 4px 4px 0; }
    .bubble hr { border: none; border-top: 1px solid #cbd5e1; margin: 12px 0; }
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
      <div class="subtitle">Information Physics AIO/HSL/MRO Demo System V4.5</div>
    </div>
    <div class="header-right">
      ${new Date().toLocaleString()}<br/>
      ${qCount} question${qCount !== 1 ? "s" : ""}
    </div>
  </div>
  ${messagesHtml}
  <div class="footer">Generated by AIO/HSL/MRO Demo System V4.5 · InformationPhysics.ai</div>
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
  // Pane headers indexed by message index in chatMessages. Rendered as
  // a metadata chip ABOVE the bubble (see PaneHeaderChip), kept out of
  // message content so the LLM never sees and never imitates the
  // "▸ <Label> · <date>" pattern in its replies.
  const [messageHeaders, setMessageHeaders] = useState<Map<number, PaneHeader>>(new Map())
  // Helper: assign a header to the assistant slot we're about to push.
  // Caller passes the index that the new assistant message will occupy
  // (typically `next.length` since `next` is the array before the
  // assistant slot is appended).
  const setHeaderAt = useCallback((index: number, header: PaneHeader) => {
    setMessageHeaders((prev) => {
      const m = new Map(prev)
      m.set(index, header)
      return m
    })
  }, [])
  const [chatInput, setChatInput] = useState("")
  const [isChatLoading, setIsChatLoading] = useState(false)
  const [promptHistory, setPromptHistory] = useState<string[]>([])
  const [showHistory, setShowHistory] = useState(false)
  // "Force fresh" toggle for Recall Search. When true, runChatPipeline
  // skips its MRO short-circuit at score ≥ 0.85 and runs the full
  // retrieval through to the LLM. Priors still seed cues and inject
  // at the 0.50 bundle-augment threshold; only the zero-token early
  // return is suppressed. Default off (production behavior — use
  // the cache); operators flip it for one-off diagnostics or to
  // re-run a query whose cached MRO is stale.
  const [forceFresh, setForceFresh] = useState(false)
  // "Thorough" toggle for Recall Search. When true, runChatPipeline:
  //   • bypasses the MRO short-circuit (same as Force fresh)
  //   • raises maxAios from 200 → 600 (more rows reach the LLM)
  //   • raises maxPriors from 3 → 8 (more cached findings inform the LLM)
  // Use when the question is fuzzy/typo-laden or when you want to merge
  // cached MRO findings WITH fresh retrieval rather than pick one.
  // Costs more tokens; default off.
  const [thoroughRecall, setThoroughRecall] = useState(false)
  // V5.0 — "Exhaustive" toggle for Live Search. When true, the backend
  // routes the request through the chunked map-reduce path
  // (api/exhaustive.py): every matched AIO is processed by per-chunk
  // LLM classification with strict JSON output, then merged in-Python.
  // Guarantees full coverage on enumeration queries that the bounded
  // single-call Live mode can silently truncate via diversify_by_csv +
  // LLM filter drift. Costs more tokens (~N×Live); default off.
  const [exhaustiveLive, setExhaustiveLive] = useState(false)
  // V5.0 — operator picks the per-chunk classifier model. Haiku is the
  // default (fastest + cheapest, sufficient for record classification).
  // Sonnet trades latency/$ for higher recall on fuzzy queries; Opus is
  // available for hardest-of-the-hard cases. Stored locally — not
  // persisted server-side, since it's a per-query operator choice.
  const [chunkModel, setChunkModel] = useState<string>("claude-haiku-4-5")
  // V4.6+ — operator-tunable substrate caps fetched once at dialog open.
  // Falls back to the same defaults the backend uses (800 / 2500) if the
  // caps endpoint is unreachable.
  const [recallCap, setRecallCap] = useState<number>(800)
  const [recallThoroughCap, setRecallThoroughCap] = useState<number>(2500)
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
  // `lastSearchMeta` carries the data that handleSaveMro needs to
  // persist a manual MRO save. `matched_hsl_ids` is the canonical list
  // of HSL UUIDs that contributed to the answer — it goes verbatim
  // into the MRO's `seed_hsls` (pipe-joined) AND drives linkMroToHsl()
  // calls so the back-pointers actually land. Keeping a separate
  // `seed_hsls_display` string for the human-readable bracket-notation
  // context bundle (e.g. "629 HSLs") so we never confuse persistence
  // payload with display payload again.
  const [lastSearchMeta, setLastSearchMeta] = useState<{
    matched_hsls: number
    matched_aios: number
    search_terms: string
    matched_hsl_ids: string[]
    seed_hsls_display: string
  } | null>(null)
  const [recallAios, setRecallAios] = useState<ParsedAio[]>([])
  // V4.4 P3 — at dialog open we only fetch the deduped (Key, Value)
  // catalog parsed from HSL names (~tens of KB max) rather than the
  // full HSL row corpus. Full HSL rows are pulled at query time via
  // findHslsByNeedlesFull only for the cue values that actually fired.
  const [hslCatalog, setHslCatalog] = useState<HslKeyValuePair[]>([])
  // Transient: HSLs returned by the resolver during the *current* pipeline
  // run. Used to render the family-count meta line — replaces the role
  // formerly played by the full ``recallHsls`` corpus. Refs (not state)
  // because we only read it once, immediately after the pipeline returns,
  // and don't need a re-render to refresh stale UI.
  const lastQueryHslsRef = useRef<HslDataRecord[]>([])
  const [recallReady, setRecallReady] = useState(false)
  const [recallCache, setRecallCache] = useState<{ mros: MroObject[] } | null>(null)
  const [lastRecallMeta, setLastRecallMeta] = useState<{ cues: number; neighborhood: number; priors: number; mroSaved: boolean } | null>(null)
  const [lastPerfMetrics, setLastPerfMetrics] = useState<{ elapsedMs: number; inputTokens: number; outputTokens: number; searchMode: string } | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const pdfIframeRef = useRef<HTMLIFrameElement>(null)
  // Tracks the AbortController for the current Recall pipeline run. A new
  // submit aborts the prior controller; unmount aborts whatever is in-flight.
  const pipelineAbortRef = useRef<AbortController | null>(null)
  useEffect(() => () => { pipelineAbortRef.current?.abort() }, [])

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }) }, [chatMessages, isChatLoading])

  // Load AIO + HSL corpus + MRO cache when the dialog opens (for Recall Search).
  // All three are fetched in parallel so the first Recall Search query pays no
  // extra latency. HSLs are used as a non-gating ranking booster — missing
  // them only removes the boost; it never breaks retrieval.
  useEffect(() => {
    if (!open || recallReady) return
    // V4.6+ — fetch operator-tunable substrate caps in parallel with
    // the corpus load. Best-effort: if the endpoint is unreachable the
    // chat dialog falls back to its hard-coded defaults (500 / 1500).
    getCapSettings().then((caps) => {
      if (caps) {
        if (typeof caps.recall_max_aios === "number") setRecallCap(caps.recall_max_aios)
        if (typeof caps.recall_thorough_max_aios === "number") setRecallThoroughCap(caps.recall_thorough_max_aios)
      }
    }).catch(() => { /* keep defaults */ })
    Promise.all([
      listAioData().catch(() => [] as AioDataRecord[]),
      // Summary mode: drops result_text + context_bundle (~80% smaller
      // payload). The substrate pipeline hydrates the top-K priors lazily.
      listMroObjects(200, { summary: true }).catch(() => [] as MroObject[]),
      // V4.4 P3 — replaces the prior listHslData() call. Pulls only
      // deduped (key, value) pairs parsed from HSL names. Full HSL rows
      // for the matching scope are fetched per query via
      // findHslsByNeedlesFull, after cue extraction.
      listHslKeyValuePairs().catch(() => [] as HslKeyValuePair[]),
    ]).then(([records, mros, kvPairs]) => {
      const parsed: ParsedAio[] = records.map((r) => {
        const raw = r.elements.filter(Boolean).join("")
        const csvRoot = r.aio_name.replace(/\s*-\s*Row\s*\d+$/i, "").replace(/\.csv$/i, "") || "backend"
        const lineMatch = r.aio_name.match(/-\s*Row\s*(\d+)$/i)
        const lineNumber = lineMatch ? parseInt(lineMatch[1], 10) : 0
        return { fileName: r.aio_name, elements: parseAioLine(raw), raw, csvRoot, lineNumber }
      })
      setRecallAios(parsed)
      setHslCatalog(kvPairs)
      setRecallCache({ mros })
      setRecallReady(true)
    })
  }, [open, recallReady])

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
    const t0 = Date.now()
    const result = await chatWithAIO(next)
    const elapsedMs = Date.now() - t0
    setIsChatLoading(false)
    if (!result) {
      setChatMessages([...next, { role: "assistant", content: "❌ Backend unreachable. Check your Railway deployment." }])
    } else if ("error" in result) {
      const errMsg = asErrorString(result.error)
      const errLower = errMsg.toLowerCase()
      const isKeyMissing = errLower.includes("api_key") || errLower.includes("not configured")
      setChatMessages([...next, { role: "assistant", content: isKeyMissing
        ? "❌ Anthropic API key not configured.\n\nGo to System Admin → API Key tab and paste your key (starts with sk-ant-…)."
        : `❌ ${errMsg}` }])
    } else {
      const inTok = result.input_tokens ?? 0
      const outTok = result.output_tokens ?? 0
      const perfLine = `\n\n---\n_Broad Search · ⏱ ${(elapsedMs / 1000).toFixed(1)}s · 📥 ${inTok.toLocaleString()} in · 📤 ${outTok.toLocaleString()} out · ${(inTok + outTok).toLocaleString()} total tokens_`
      setHeaderAt(next.length, makePaneHeader("Broad Search", new Date()))
      setChatMessages([...next, { role: "assistant", content: result.reply + perfLine }])
      setLastPerfMetrics({ elapsedMs, inputTokens: inTok, outputTokens: outTok, searchMode: "BroadSearch" })
      // Broad Search ships the first N AIOs + first M HSLs to Claude with
      // no retrieval. context_records is the combined count from the
      // backend; we approximate matched_aios as that figure (no separate
      // HSL count is returned, so matched_hsls stays 0). cue_count and
      // neighborhood_size are intentionally 0 — Broad Search has no
      // parsing or topology traversal step.
      createChatStat({
        search_mode: "BroadSearch", query_text: text,
        result_preview: result.reply.slice(0, 500),
        elapsed_ms: elapsedMs, input_tokens: inTok, output_tokens: outTok,
        total_tokens: inTok + outTok, context_records: result.context_records ?? 0,
        matched_hsls: 0, matched_aios: result.context_records ?? 0, cue_count: 0,
        neighborhood_size: 0, prior_count: 0, mro_saved: false,
      }).catch((e) => { console.error("createChatStat failed (BroadSearch)", e) })
    }
  }, [chatInput, chatMessages, isChatLoading])

  const handlePureLlm = useCallback(async () => {
    const text = chatInput.trim()
    if (!text || isChatLoading) return
    const next: ChatMessage[] = [...chatMessages, { role: "user", content: text }]
    setChatMessages(next)
    setChatInput("")
    setPromptHistory((prev) => (prev.includes(text) ? prev : [text, ...prev].slice(0, 20)))
    setIsChatLoading(true)
    const t0 = Date.now()
    const result = await pureLlmChat(next)
    const elapsedMs = Date.now() - t0
    setIsChatLoading(false)
    if (!result) {
      setChatMessages([...next, { role: "assistant", content: "❌ Backend unreachable. Check your Railway deployment." }])
    } else if ("error" in result) {
      const errMsg = asErrorString(result.error)
      const errLower = errMsg.toLowerCase()
      const isKeyMissing = errLower.includes("api_key") || errLower.includes("not configured")
      setChatMessages([...next, { role: "assistant", content: isKeyMissing
        ? "❌ Anthropic API key not configured.\n\nGo to System Admin → API Key tab and paste your key (starts with sk-ant-…)."
        : `❌ ${errMsg}` }])
    } else {
      const inTok = result.input_tokens ?? 0
      const outTok = result.output_tokens ?? 0
      const perfLine = `\n\n---\n_Raw Search · ⏱ ${(elapsedMs / 1000).toFixed(1)}s · 📥 ${inTok.toLocaleString()} in · 📤 ${outTok.toLocaleString()} out · ${(inTok + outTok).toLocaleString()} total tokens · ${result.context_records ?? 0} CSV files_`
      setHeaderAt(next.length, makePaneHeader("Raw Search", new Date()))
      setChatMessages([...next, { role: "assistant", content: result.reply + perfLine }])
      setLastPerfMetrics({ elapsedMs, inputTokens: inTok, outputTokens: outTok, searchMode: "RawSearch" })
      // Raw Search (Pure LLM) ships raw CSV files to Claude with no IP
      // machinery. matched_hsls / matched_aios / cue_count / neighborhood
      // are accurate at 0 — no AIO/HSL/MRO subsystem participates.
      // context_records is the count of CSV files sent.
      createChatStat({
        search_mode: "RawSearch", query_text: text,
        result_preview: result.reply.slice(0, 500),
        elapsed_ms: elapsedMs, input_tokens: inTok, output_tokens: outTok,
        total_tokens: inTok + outTok, context_records: result.context_records ?? 0,
        matched_hsls: 0, matched_aios: 0, cue_count: 0,
        neighborhood_size: 0, prior_count: 0, mro_saved: false,
      }).catch((e) => { console.error("createChatStat failed (RawSearch)", e) })
    }
  }, [chatInput, chatMessages, isChatLoading])

  const handleAioSearch = useCallback(async () => {
    const text = chatInput.trim()
    if (!text || isChatLoading) return
    const next: ChatMessage[] = [...chatMessages, { role: "user", content: text }]
    // V5.0 — pane header reflects mode. "Exhaustive Live" gets a model
    // shorthand suffix so the operator can see at a glance which
    // chunk-classifier ran: -H (Haiku), -S (Sonnet), -O (Opus).
    const modelSuffix = exhaustiveLive
      ? (chunkModel.includes("haiku") ? "-H"
          : chunkModel.includes("sonnet") ? "-S"
          : chunkModel.includes("opus") ? "-O"
          : "")
      : ""
    const liveLabel = exhaustiveLive
      ? `Exhaustive Live${modelSuffix}`
      : "Live Search"
    setHeaderAt(next.length, makePaneHeader(liveLabel, new Date()))
    setChatMessages([...next, { role: "assistant", content: "" }])
    setChatInput("")
    setPromptHistory((prev) => (prev.includes(text) ? prev : [text, ...prev].slice(0, 20)))
    setIsChatLoading(true)
    // Abort any in-flight pipeline run before starting a new one. The
    // controller's signal is also threaded into the post-stream MRO→HSL
    // back-pointer writes so they don't keep firing if the user closes the
    // dialog mid-query (the unmount cleanup in pipelineAbortRef aborts it).
    pipelineAbortRef.current?.abort()
    const controller = new AbortController()
    pipelineAbortRef.current = controller
    const t0 = Date.now()
    let acc = ""
    let metaCaptured: AioSearchStreamMeta | null = null
    let errMsg: string | null = null
    await aioSearchChatStream(next, {
      onText: (chunk) => {
        acc += chunk
        const snap = acc
        setChatMessages((prev) => {
          const last = prev[prev.length - 1]
          if (!last || last.role !== "assistant") return prev
          return [...prev.slice(0, -1), { ...last, content: snap }]
        })
      },
      onMeta: (m) => { metaCaptured = m },
      onError: (e) => { errMsg = e },
      // bypassCache=true: in-app users iterating through the dialog
      // expect fresh retrieval. The server-side query_cache is intended
      // for repeated identical API calls in production, not interactive
      // sessions where stale cached entries (especially from before
      // retrieval-pipeline changes) cause confusing "this should work"
      // failures.
      //
      // V5.0: when exhaustiveLive is on, route to the chunked map-reduce
      // backend path with the operator's chosen chunk classifier.
    }, {
      bypassCache: true,
      ...(exhaustiveLive ? { mode: "exhaustive" as const, chunkModel } : {}),
    }).catch((e) => { errMsg = String(e) })
    const elapsedMs = Date.now() - t0
    setIsChatLoading(false)
    if (errMsg && !acc) {
      setChatMessages([...next, { role: "assistant", content: `Error: ${errMsg}` }])
      return
    }
    if (!metaCaptured) {
      // Stream finished without meta — leave the accumulated text and bail
      // on the bookkeeping path (no MRO save without counts).
      return
    }
    const meta = metaCaptured
    const inTok = meta.input_tokens ?? 0
    const outTok = meta.output_tokens ?? 0
    // V5.0 — partial-coverage warning callout (Markdown blockquote so it
    // renders as a tinted ribbon at the top of the answer pane). Only
    // surfaces when meta.partial_warning is set (Exhaustive partial-run).
    const warningPrefix = meta.partial_warning
      ? `> ⚠️ **Partial coverage** — ${meta.partial_warning}\n\n`
      : ""
    // V5.0 — exhaustive footer extension: chunks total/failed, model,
    // coverage. Falls back to the legacy single-line footer for Live.
    const exhaustiveDetails = meta.mode === "exhaustive"
      ? ` · ⚙️ Exhaustive: ${meta.chunks_total ?? 0} chunks (${meta.chunks_failed ?? 0} failed) · model: ${meta.chunk_model ?? "?"} · coverage: ${((meta.coverage ?? 1) * 100).toFixed(0)}%`
      : ""
    const modeLabel = meta.mode === "exhaustive" ? "Exhaustive Live" : "Live Search"
    const footer = `\n\n---\n_${modeLabel}: ${meta.matched_hsls} HSLs matched · ${meta.matched_aios} AIOs in context · ⏱ ${(elapsedMs / 1000).toFixed(1)}s · 📥 ${inTok.toLocaleString()} in · 📤 ${outTok.toLocaleString()} out · ${(inTok + outTok).toLocaleString()} total tokens${exhaustiveDetails}_`
    const finalText = warningPrefix + acc + footer
    setChatMessages((prev) => {
      const last = prev[prev.length - 1]
      if (!last || last.role !== "assistant") return prev
      return [...prev.slice(0, -1), { ...last, content: finalText }]
    })
    setLastSearchMeta({
      matched_hsls: meta.matched_hsls,
      matched_aios: meta.matched_aios,
      search_terms: typeof meta.search_terms === "string" ? meta.search_terms : JSON.stringify(meta.search_terms || {}),
      matched_hsl_ids: meta.matched_hsl_ids ?? [],
      seed_hsls_display: `${meta.matched_hsls} HSLs`,
    })
    setLastPerfMetrics({
      elapsedMs, inputTokens: inTok, outputTokens: outTok,
      searchMode: meta.mode === "exhaustive" ? "ExhaustiveLive" : "AIOSearch",
    })

    const hslIds = meta.matched_hsl_ids ?? []
    // V5.0 — Exhaustive runs persist as a separate MRO intent so
    // operators (and the trust-ranker) can distinguish the two modes
    // when ranking priors. Trust seed for Exhaustive bakes coverage in.
    const isExhaustive = meta.mode === "exhaustive"
    const intent = isExhaustive ? "aio-search-exhaustive" : "aio-search"
    const baseConfidence = 0.85  // Exhaustive starts higher than Live's 0.75
    const trustSeed = isExhaustive
      ? (baseConfidence * (meta.coverage ?? 1)).toFixed(2)
      : "0.75"
    const mroKey = `${isExhaustive ? "ExhaustiveLive" : "AIOSearch"}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    createMroObject({
      mro_key: mroKey,
      query_text: text,
      intent,
      seed_hsls: hslIds.join("|"),
      matched_aios_count: meta.matched_aios,
      search_terms: meta.search_terms as Record<string, unknown>,
      result_text: acc,
      confidence: trustSeed,
      policy_scope: "default",
    }).then((mro) => {
      if (mro?.mro_id && hslIds.length > 0) {
        if (controller.signal.aborted) return
        Promise.all(hslIds.map((hslId) =>
          linkMroToHsl(hslId, mro.mro_id, { signal: controller.signal })))
          .catch((e) => {
            if (controller.signal.aborted) return
            console.error("linkMroToHsl failed (Live Search)", e)
          })
      }
    }).catch((e) => { console.error("createMroObject failed (Live Search)", e) })

    createChatStat({
      search_mode: isExhaustive ? "ExhaustiveLive" : "AIOSearch",
      query_text: text,
      result_preview: acc.slice(0, 500),
      elapsed_ms: elapsedMs, input_tokens: inTok, output_tokens: outTok,
      total_tokens: inTok + outTok, context_records: meta.context_records ?? 0,
      matched_hsls: meta.matched_hsls, matched_aios: meta.matched_aios,
      cue_count: 0, neighborhood_size: 0, prior_count: 0, mro_saved: hslIds.length > 0,
    }).catch((e) => { console.error("createChatStat failed (AIOSearch)", e) })
  }, [chatInput, chatMessages, isChatLoading, exhaustiveLive, chunkModel])

  const handleRecallSearch = useCallback(async () => {
    const text = chatInput.trim()
    if (!text || isChatLoading) return
    const next: ChatMessage[] = [...chatMessages, { role: "user", content: text }]
    // Pane header chip: search type + suffix + timestamp. Assigned
    // BEFORE the assistant slot is appended so PaneHeaderChip renders
    // immediately. Suffix mirrors the footer (-T for Thorough, -F for
    // Force fresh).
    const recallSuffix = thoroughRecall ? "-T" : (forceFresh ? "-F" : "")
    setHeaderAt(next.length, makePaneHeader(`Recall Search${recallSuffix}`, new Date()))
    setChatMessages([...next, { role: "assistant", content: "" }])
    setChatInput("")
    setPromptHistory((prev) => (prev.includes(text) ? prev : [text, ...prev].slice(0, 20)))
    setIsChatLoading(true)
    const history = chatMessages
    const t0 = Date.now()
    // Abort any in-flight pipeline run before starting a new one.
    pipelineAbortRef.current?.abort()
    const controller = new AbortController()
    pipelineAbortRef.current = controller
    // V4.4 P3 — capture the HSLs the resolver returns for *this* query
    // so we can render the family-count meta line below without holding
    // the full corpus in browser memory.
    const queryHsls: HslDataRecord[] = []
    const result = await runChatPipeline(text, recallAios, {
      history,
      // Thorough mode raises priors 3 → 8 so more cached findings flow
      // into the LLM context section as framing.
      maxPriors: thoroughRecall ? 8 : 3,
      // V4.5 update: raised from 40 → 200 to close the substrate-cap
      // gap with Live Search's adaptive 100–300 cap. Thorough mode
      // raises further to 600 — useful for fuzzy/typo-laden queries
      // that need both the cached MRO findings AND a wider fresh
      // retrieval to be merged.
      // V4.6+ — operator-tunable caps fetched on dialog open from
      // /v1/settings/caps. Defaults: 500 / 1500. Hard clamp [50, 5000]
      // is enforced server-side.
      maxAios: thoroughRecall ? recallThoroughCap : recallCap,
      saveMRO: true,
      // Force fresh OR Thorough both bypass the score-≥-0.85 short-circuit.
      // Force fresh: just disables the cache early-return. Thorough: also
      // raises caps so Recall captures everything the cache would have
      // skipped. Priors still inform the bundle at the 0.50 threshold
      // in both cases; only the zero-token early-return is suppressed.
      bypassMroCache: forceFresh || thoroughRecall,
      cachedMros: recallCache?.mros,
      hslCatalog,
      resolveHsls: async (cueValues, signal) => {
        // Thorough mode (V4.5+):
        //   1. LLM parse augmentation — call /api/op/aio-search-parse to
        //      get Live-quality semantic normalization (typo correction,
        //      synonym expansion). Merge the field_values + keywords from
        //      the LLM into the cue list so Recall probes the same needles
        //      Live would.
        //   2. Lower trigram threshold (0.30 → 0.20) so loose matches like
        //      "Perkins Will" → "Perkins & Will" fire.
        //   3. Combined with the backend's bidirectional substring fallback
        //      (V4.5), this catches token-break and short-cue cases trigram
        //      alone misses.
        let augmentedCues = cueValues
        if (thoroughRecall) {
          try {
            const parse = await aioSearchParse(next, { signal })
            if (parse && !("error" in parse)) {
              const fvVals = (parse.search_terms.field_values ?? [])
                .map((fv) => (fv?.value ?? "").trim()).filter(Boolean)
              const kwVals = (parse.search_terms.keywords ?? [])
                .map((k) => (k ?? "").trim()).filter(Boolean)
              const seen = new Set(cueValues.map((v) => v.toLowerCase()))
              const extra: string[] = []
              for (const v of [...fvVals, ...kwVals]) {
                if (v.length < 3) continue
                if (seen.has(v.toLowerCase())) continue
                seen.add(v.toLowerCase())
                extra.push(v)
              }
              if (extra.length > 0) {
                augmentedCues = [...cueValues, ...extra]
                console.info(
                  "Thorough Recall: LLM parse augmented cue set with %d extra needles",
                  extra.length, extra,
                )
              }
            }
          } catch {
            // Non-fatal — fall back to deterministic cues only.
          }
        }
        const rows = await findHslsByNeedlesFull(augmentedCues, {
          signal,
          ...(thoroughRecall ? { similarity: 0.20 } : {}),
        })
        // Side-channel: stash the rows for the meta-line renderer.
        queryHsls.length = 0
        queryHsls.push(...rows)
        return rows.map((r) => ({
          hsl_name: r.hsl_name,
          elements: r.elements,
          hsl_id: r.hsl_id,
        }))
      },
      signal: controller.signal,
      onChunk: (chunk) => {
        setChatMessages((prev) => {
          const last = prev[prev.length - 1]
          if (!last || last.role !== "assistant") return prev
          return [...prev.slice(0, -1), { ...last, content: last.content + chunk }]
        })
      },
    })
    const elapsedMs = Date.now() - t0
    setIsChatLoading(false)
    if ("error" in result) {
      const errMsg = asErrorString(result.error)
      const errLower = errMsg.toLowerCase()
      const isKeyMissing = errLower.includes("api_key") || errLower.includes("not configured")
      setChatMessages([...next, { role: "assistant", content: isKeyMissing
        ? "❌ Anthropic API key not configured.\n\nGo to System Admin → API Key tab and paste your key (starts with sk-ant-…)."
        : `❌ ${errMsg}` }])
    } else {
      const inTok = result.input_tokens ?? 0
      const outTok = result.output_tokens ?? 0
      // Resolve matched HSL ids back to names so we can show which HSL
      // families contributed to this Recall Search bundle. Distinct count
      // == "how many HSL families lit up across the cue set".
      // V4.4 P3 — names come from the per-query resolver scope, not a
      // full-corpus preload.
      lastQueryHslsRef.current = queryHsls
      const matchedHslIdSet = new Set(result.matched_hsl_ids ?? [])
      const matchedHslNames = queryHsls
        .filter((h) => matchedHslIdSet.has(h.hsl_id))
        .map((h) => h.hsl_name)
      const familyCount = matchedHslIdSet.size
      const familyTooltipNames = matchedHslNames.slice(0, 8).join(", ")
      const familyOverflow = matchedHslNames.length > 8 ? `, +${matchedHslNames.length - 8} more` : ""
      const familyDisplay = familyCount === 0
        ? "0 HSL families"
        : `${familyCount} HSL ${familyCount === 1 ? "family" : "families"}` +
          (matchedHslNames.length > 0 ? ` (${familyTooltipNames}${familyOverflow})` : "")
      // Recall mode suffix already captured at handler entry as
      // `recallSuffix` (and used in `recallPaneHeader` for the streaming
      // placeholder). Surfaces in the footer so the operator can see
      // at a glance which knobs were active for this answer.
      const meta =
        `\n\n---\n_Recall Search${recallSuffix}: ${result.cost.cues} cues → ` +
        `${familyDisplay} → ` +
        `${result.cost.neighborhood} AIOs in neighborhood · ` +
        `${result.cost.priors} priors · ` +
        `${result.mro_saved ? "MRO saved" : "MRO not saved"} · ` +
        `⏱ ${(elapsedMs / 1000).toFixed(1)}s · 📥 ${inTok.toLocaleString()} in · 📤 ${outTok.toLocaleString()} out · ${(inTok + outTok).toLocaleString()} total tokens_`
      // Final assistant content: LLM reply + perf footer. Pane header
      // is rendered separately via PaneHeaderChip from messageHeaders.
      setChatMessages([...next, { role: "assistant", content: result.reply + meta }])
      setLastRecallMeta({
        cues: result.cost.cues,
        neighborhood: result.cost.neighborhood,
        priors: result.cost.priors,
        mroSaved: result.mro_saved,
      })
      // Mirror Live Search behavior: stash the matched HSL UUIDs and
      // counts so the manual "Save MRO" button has real data to write
      // (and link back-pointers) when the user clicks it after a
      // Recall query.
      setLastSearchMeta({
        matched_hsls: matchedHslIdSet.size,
        matched_aios: result.cost.neighborhood,
        search_terms: JSON.stringify(result.cue_values ?? []),
        matched_hsl_ids: result.matched_hsl_ids ?? [],
        seed_hsls_display: `${matchedHslIdSet.size} HSLs (Recall)`,
      })
      setLastPerfMetrics({ elapsedMs, inputTokens: inTok, outputTokens: outTok, searchMode: "Substrate" })
      createChatStat({
        search_mode: "Substrate", query_text: text,
        result_preview: result.reply.slice(0, 500),
        elapsed_ms: elapsedMs, input_tokens: inTok, output_tokens: outTok,
        total_tokens: inTok + outTok, context_records: 0,
        matched_hsls: familyCount, matched_aios: result.cost.neighborhood,
        cue_count: result.cost.cues, neighborhood_size: result.cost.neighborhood,
        prior_count: result.cost.priors, mro_saved: result.mro_saved,
      }).catch((e) => { console.error("createChatStat failed (Recall Search)", e) })
      // Refresh MRO cache (summary mode again) so the newly saved MRO is
      // available as a prior next query
      if (result.mro_saved) {
        listMroObjects(200, { summary: true })
          .then((mros) => setRecallCache({ mros }))
          .catch((e) => { console.error("listMroObjects refresh failed (Recall Search)", e) })

        // Back-link the new MRO into the HSLs that contributed to this
        // bundle. matched_hsl_ids comes from the in-memory pipeline
        // (getMatchedHslIds) — no server round-trip, no duplicate ILIKE
        // scan. Fallback to findHslsByNeedles only if HSLs weren't loaded.
        if (result.mro_id) {
          if (result.matched_hsl_ids.length > 0) {
            Promise.all(result.matched_hsl_ids.map((hslId) =>
              linkMroToHsl(hslId, result.mro_id!),
            )).catch((e) => { console.error("linkMroToHsl failed (Recall Search, in-memory)", e) })
          } else if (result.cue_values.length > 0) {
            findHslsByNeedles(result.cue_values).then((hslIds) => {
              if (hslIds.length > 0) {
                Promise.all(hslIds.map((hslId) => linkMroToHsl(hslId, result.mro_id!)))
                  .catch((e) => { console.error("linkMroToHsl failed (Recall Search, needle fallback)", e) })
              }
            }).catch((e) => { console.error("findHslsByNeedles failed (Recall Search)", e) })
          }
        }
      }
    }
  }, [chatInput, chatMessages, isChatLoading, recallAios, hslCatalog, recallCache, forceFresh, thoroughRecall])

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
      `[SeedHSLs.${lastSearchMeta?.seed_hsls_display || "none"}]`,
      `[MatchedAIOs.${lastSearchMeta?.matched_aios || 0}]`,
      `[Confidence.derived]`,
      `[Timestamp.${new Date().toISOString()}]`,
      ...(lastPerfMetrics ? [
        `[SearchMode.${lastPerfMetrics.searchMode}]`,
        `[ElapsedMs.${lastPerfMetrics.elapsedMs}]`,
        `[InputTokens.${lastPerfMetrics.inputTokens}]`,
        `[OutputTokens.${lastPerfMetrics.outputTokens}]`,
        `[TotalTokens.${lastPerfMetrics.inputTokens + lastPerfMetrics.outputTokens}]`,
      ] : []),
    ]
    let searchTermsParsed: Record<string, unknown> = {}
    try {
      const raw = lastSearchMeta?.search_terms || "{}"
      searchTermsParsed = typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown>)
    } catch { /* keep empty */ }
    // Persist UUIDs (pipe-joined) — not the human-readable count
    // string. The Linkage view in System Management compares these
    // against hsl_member back-pointers; if seed_hsls is a display
    // string, every row reports asymmetry forever.
    const hslIds = lastSearchMeta?.matched_hsl_ids ?? []
    try {
      const result = await createMroObject({
        mro_key: mroKey,
        query_text: queryText,
        intent: queryText.slice(0, 200),
        seed_hsls: hslIds.join("|"),
        matched_aios_count: lastSearchMeta?.matched_aios || 0,
        search_terms: searchTermsParsed,
        result_text: resultText,
        context_bundle: elements.join("\n"),
        confidence: "derived",
      })
      if (!result) {
        toast.error("Failed to save MRO")
        return
      }
      // Write the back-pointer into every contributing HSL so the
      // Linkage view stays symmetric. Best-effort; failures log but
      // don't fail the user-facing save.
      if (result.mro_id && hslIds.length > 0) {
        Promise.all(hslIds.map((hslId) => linkMroToHsl(hslId, result.mro_id)))
          .catch((e) => { console.error("linkMroToHsl failed (manual Save MRO)", e) })
      }
      toast.success("MRO saved successfully")
    } catch (err) {
      console.error("MRO save error:", err)
      toast.error("Failed to save MRO")
    }
  }, [chatMessages, lastSearchMeta, lastPerfMetrics])

  const handleLoadMros = useCallback(async () => {
    setShowMroViewer(true)
    setMroLoading(true)
    // Index in summary mode — heavy fields (result_text, context_bundle)
    // are lazy-loaded via getMroObject when the user clicks View on a row.
    const data = await listMroObjects(500, { summary: true })
    setMroList(data)
    setMroLoading(false)
  }, [])

  // Click-to-hydrate: the list is loaded in summary mode, so when the user
  // opens an MRO we fetch the full record (with result_text / context_bundle)
  // before the detail dialog reads those fields.
  const handleViewMro = useCallback(async (mro: MroObject) => {
    if (mro.result_text && mro.context_bundle !== null) {
      // Already hydrated (e.g. created in this session) — show as-is.
      setViewMro(mro)
      return
    }
    setViewMro(mro)  // immediate open with summary fields visible
    const full = await getMroObject(mro.mro_id).catch(() => null)
    if (full) setViewMro(full)
  }, [])

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="!max-w-none !w-screen !h-screen !rounded-none !translate-x-0 !translate-y-0 !top-0 !left-0 !m-0 flex flex-col p-0 gap-0 overflow-hidden">
          {/* Navy header — title centered, action buttons centered below,
              Close pinned to the upper-right corner so it never reflows
              with the wrapping action row. The title uses a serif display
              face (font-serif) at a larger size for a tighter, more
              document-like feel that fills the bar properly. */}
          <DialogHeader className="relative px-6 pt-4 pb-3 shrink-0 bg-[#0f3460] rounded-t-lg">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="absolute right-4 top-4 gap-1.5 text-xs text-white hover:bg-white/20 hover:text-white border-white/30"
              title="Close"
            >
              <X className="w-4 h-4" />Close
            </Button>

            <DialogTitle asChild>
              <h2 className="flex items-center justify-center gap-3 text-white font-serif font-semibold text-2xl md:text-3xl tracking-tight text-center mb-3">
                <MessageSquare className="w-7 h-7 text-white shrink-0" />
                <span>ChatAIO — AI Access to AIO / HSL / MRO Information</span>
              </h2>
            </DialogTitle>

            <div className="flex items-center justify-center gap-2 flex-wrap">
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
            </div>
          </DialogHeader>

          {/* Guide Panel */}
          {showGuide && (
            <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
              <div className="max-w-5xl mx-auto space-y-6">
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
                        <p className="text-sm font-semibold">Live Search <span className="text-muted-foreground font-normal">(formerly AIO Search — targeted search algebra)</span></p>
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
                        <p className="text-sm font-semibold text-purple-600">🧠 Recall Search <span className="text-muted-foreground font-normal">(formerly Substrate Mode — Paper III pipeline)</span> — purple button</p>
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
                      <li>Click <span className="font-medium text-foreground">Save MRO</span> after receiving a Live Search response to preserve the result as a Memory Result Object</li>
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
                      <li><span className="font-medium text-purple-600 font-semibold">Recall</span> (purple, leftmost) is the default — press <span className="font-medium text-foreground">Enter</span> to run it. Memory-augmented (uses prior MROs), auto-saves a new MRO</li>
                      <li>Use <span className="font-medium text-foreground">Live Search</span> when you want a fresh four-phase retrieval with no memory of prior queries — best for one-off lookups</li>
                      <li>Use <span className="font-medium text-foreground">Raw Search</span> <span className="text-muted-foreground">(formerly CSV→LLM Raw)</span> as the control case — standard Claude with the raw saved CSVs only (no AIO/HSL machinery)</li>
                      <li>Use <span className="font-medium text-foreground">Broad Search</span> <span className="text-muted-foreground">(formerly Blind Dump AIO/HSL)</span> only for exploratory questions — NO retrieval, just dumps the first 300 AIOs + 10 HSLs at Claude unfiltered (slow, token-heavy)</li>
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
            <div className="flex-1 overflow-y-auto min-h-0">
            <div className="max-w-5xl mx-auto px-6 py-4 space-y-4">
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
              {chatMessages.map((m, i) => {
                const header = m.role === "assistant" ? messageHeaders.get(i) : undefined
                return (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={m.role === "user" ? "max-w-[80%]" : "max-w-[88%] flex flex-col"}>
                      {header && <PaneHeaderChip header={header} />}
                      <div
                        className={
                          m.role === "user"
                            ? "rounded-lg px-4 py-2 text-sm bg-primary text-primary-foreground whitespace-pre-wrap"
                            : "rounded-lg px-5 py-3 text-sm bg-muted text-foreground border border-slate-200/60 dark:border-slate-700/60 shadow-sm"
                        }
                      >
                        {m.role === "user" ? m.content : renderContent(m.content)}
                      </div>
                    </div>
                  </div>
                )
              })}
              {isChatLoading && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-lg px-4 py-2">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            </div>
          )}

          {/* Input area */}
          <div className="border-t border-border shrink-0">
          <div className="max-w-5xl mx-auto px-6 py-4">
            {/* Row 1: history + text input */}
            <div className="flex gap-2 mb-2">
              <div className="relative" ref={historyRef}>
                <Button variant="outline" size="sm" onClick={() => {
                  const opening = !showHistory
                  setShowHistory(opening)
                  if (opening && historyMode === "saved") loadSavedPrompts()
                }} className="gap-1.5 h-9 px-3" title="Browse session prompts and saved prompts">
                  <History className="w-4 h-4" />Prior Prompts
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
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    // Default to Substrate (fast, cheap, MRO-capturing). Fall back to
                    // broad Send only while the AIO corpus is still loading.
                    if (recallReady) handleRecallSearch()
                    else handleSend()
                  }
                }}
                placeholder="Ask about your AIO data…"
                className="flex-1 text-sm px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                disabled={isChatLoading} />
            </div>
            {/* Row 2: action buttons — Substrate is the default (Enter key) */}
            <div className="flex gap-2 justify-end items-center">
              {/* Force-fresh toggle for Recall. Off by default (production
                  uses the MRO cache for cost discipline); flip on for one-
                  off diagnostics or when a stale cached answer is masking
                  a deployed retrieval fix. Affects only Recall — Live and
                  Raw never short-circuit on MROs anyway. */}
              <label
                className="flex items-center gap-1.5 text-xs text-muted-foreground select-none cursor-pointer h-9 px-2 rounded-md border border-border hover:bg-muted/40"
                title="When checked, Recall skips its MRO short-circuit (score ≥ 0.85) and always runs the full retrieval through to the LLM. Priors still seed cues and inject at the 0.50 threshold; only the zero-token cache hit is suppressed."
              >
                <input
                  type="checkbox"
                  checked={forceFresh}
                  onChange={(e) => setForceFresh(e.target.checked)}
                  disabled={isChatLoading || thoroughRecall}
                  className="h-3.5 w-3.5 accent-purple-600 cursor-pointer"
                />
                Force fresh
              </label>
              <label
                className="flex items-center gap-1.5 text-xs text-muted-foreground select-none cursor-pointer h-9 px-2 rounded-md border border-border hover:bg-muted/40"
                title="Thorough Recall: bypass the MRO short-circuit AND raise the substrate cap (200 → 600 AIOs) AND raise the prior count (3 → 8). Use for fuzzy/typo-laden queries or whenever you want the cached MRO findings merged WITH a wider fresh retrieval, instead of one replacing the other. Costs more tokens; supersedes Force fresh."
              >
                <input
                  type="checkbox"
                  checked={thoroughRecall}
                  onChange={(e) => setThoroughRecall(e.target.checked)}
                  disabled={isChatLoading}
                  className="h-3.5 w-3.5 accent-amber-600 cursor-pointer"
                />
                Thorough
              </label>
              <Button size="sm" onClick={handleRecallSearch}
                disabled={!chatInput.trim() || isChatLoading || !recallReady}
                className="gap-2 shrink-0 h-9 bg-purple-600 hover:bg-purple-700 text-white"
                title="Recall Search (formerly Substrate Mode — default, Enter key): extract cues, traverse HSL neighborhoods, pre-fetch MRO priors from past episodes, and persist this answer as a new MRO. Memory-augmented — gets richer with use.">
                <Brain className="w-4 h-4" />Recall
              </Button>
              {/* V5.0 — Exhaustive toggle for Live Search. When checked,
                  the next Live click routes through the chunked
                  map-reduce path (api/exhaustive.py) instead of the
                  bounded single-call path. Guarantees full coverage on
                  enumeration queries that the legacy Live can silently
                  truncate via diversify_by_csv + LLM filter drift. */}
              <label
                className="flex items-center gap-1.5 text-xs text-muted-foreground select-none cursor-pointer h-9 px-2 rounded-md border border-border hover:bg-muted/40"
                title="Exhaustive Live: chunked map-reduce — every matched AIO is processed by per-chunk LLM classification with strict JSON output, then merged in-Python by max similarity. Guarantees completeness on enumeration queries (no diversify_by_csv truncation, no LLM filter drift). Costs more tokens (~N×Live)."
              >
                <input
                  type="checkbox"
                  checked={exhaustiveLive}
                  onChange={(e) => setExhaustiveLive(e.target.checked)}
                  disabled={isChatLoading}
                  className="h-3.5 w-3.5 accent-blue-600 cursor-pointer"
                />
                Exhaustive
              </label>
              {/* V5.0 — chunk-model dropdown. Only enabled when
                  Exhaustive is on. Haiku is the default (cheapest +
                  fastest, sufficient for record classification). */}
              <select
                value={chunkModel}
                onChange={(e) => setChunkModel(e.target.value)}
                disabled={isChatLoading || !exhaustiveLive}
                className="h-9 px-2 rounded-md border border-border text-xs bg-background hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Per-chunk classifier model for Exhaustive Live. Haiku is the default — fastest and cheapest, sufficient for record-level matching. Sonnet trades latency/$ for higher recall on fuzzy queries. Opus is for hardest-of-the-hard cases."
              >
                <option value="claude-haiku-4-5">Haiku (default)</option>
                <option value="claude-sonnet-4-6">Sonnet</option>
                <option value="claude-opus-4-7">Opus</option>
              </select>
              <Button size="sm" variant="outline" onClick={handleAioSearch} disabled={!chatInput.trim() || isChatLoading} className="gap-2 shrink-0 h-9" title="Live Search (formerly AIO Search): fresh four-phase retrieval — parse cues, match HSLs, gather AIOs, synthesize. No memory of prior queries. Toggle Exhaustive to route through chunked map-reduce for guaranteed enumeration completeness.">
                <Search className="w-4 h-4" />Live Search
              </Button>
              <Button size="sm" variant="outline" onClick={handlePureLlm} disabled={!chatInput.trim() || isChatLoading} className="gap-2 shrink-0 h-9" title="Raw Search (formerly CSV→LLM Raw): standard Claude prompt with the raw saved CSV files as context (no AIO/HSL/MRO machinery — control case)">
                <Sparkles className="w-4 h-4" />Raw Search
              </Button>
              <Button size="sm" variant="outline" onClick={handleSend} disabled={!chatInput.trim() || isChatLoading} className="gap-2 shrink-0 h-9" title="Broad Search (formerly Blind Dump AIO/HSL): NO retrieval — ships the first 300 AIOs + 10 HSLs from the DB to Claude with no relevance filtering. Slow and token-heavy.">
                <Send className="w-4 h-4" />Broad Search
              </Button>
            </div>
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
              <p className="text-center py-12 text-muted-foreground">No MROs saved yet. Use &quot;Save MRO&quot; after a Live Search or Recall Search to create one.</p>
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
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-blue-600" onClick={() => handleViewMro(mro)}>
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
