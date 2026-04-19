// Shared types and pure utility functions for the AIO Generator.
// Extracted from app/page.tsx so they can be imported by any component.

import type { IORecord } from "./api-client"

// ── Types ────────────────────────────────────────────────────────────

export interface ConvertedFile {
  originalName: string
  csvData: string[][]
  headers: string[]
  aioLines: string[]
  fileDate: string
  fileTime: string
}

export interface ParsedElement {
  key: string
  value: string
  raw: string
}

export interface ParsedAio {
  fileName: string
  elements: ParsedElement[]
  raw: string
  csvRoot: string
  lineNumber: number
}

// ── CSV / AIO helpers ────────────────────────────────────────────────

/** Parse a CSV text string into headers + rows. Handles quoted fields. */
export function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "")
  if (lines.length === 0) return { headers: [], rows: [] }

  const parseLine = (line: string): string[] => {
    const result: string[] = []
    let current = ""
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
        else { inQuotes = !inQuotes }
      } else if (char === "," && !inQuotes) {
        result.push(current); current = ""
      } else {
        current += char
      }
    }
    result.push(current)
    return result
  }

  const headers = parseLine(lines[0])
  const rows = lines.slice(1).map(parseLine)
  return { headers, rows }
}

/** Convert a single CSV row into an AIO bracket string. */
export function csvToAio(
  headers: string[],
  row: string[],
  originalFileName: string,
  fileDate: string,
  fileTime: string,
): string {
  const parts: string[] = [
    `[OriginalCSV.${originalFileName}]`,
    `[FileDate.${fileDate}]`,
    `[FileTime.${fileTime}]`,
  ]
  for (let i = 0; i < headers.length; i++) {
    const key = headers[i]
    let val = row[i] ?? ""
    val = val
      .replace(/\r\n/g, " ")
      .replace(/\n/g, " ")
      .replace(/\r/g, " ")
      .replace(/\t/g, " ")
    parts.push(`[${key}.${val}]`)
  }
  return parts.join("")
}

/** Parse a single AIO bracket string into a flat list of ParsedElement objects. */
export function parseAioLine(line: string): ParsedElement[] {
  const elements: ParsedElement[] = []
  const regex = /\[([^\]]+)\]/g
  let match
  while ((match = regex.exec(line)) !== null) {
    const raw = match[1]
    const dotIndex = raw.indexOf(".")
    if (dotIndex > 0) {
      elements.push({
        key: raw.substring(0, dotIndex),
        value: raw.substring(dotIndex + 1),
        raw: `[${raw}]`,
      })
    }
  }
  return elements
}

/** Reconstruct tabular CSV data from a set of saved AIO IORecords. */
export function reconstructCsvFromAios(records: IORecord[]): {
  headers: string[]
  rows: string[][]
} {
  const META_KEYS = new Set(["OriginalCSV", "FileDate", "FileTime"])

  const parsed = records.map((r) => {
    const uri = r.raw.raw_uri ?? ""
    const line = uri.startsWith("data:text/aio,")
      ? decodeURIComponent(uri.slice("data:text/aio,".length))
      : uri
    const row: Record<string, string> = {}
    parseAioLine(line).forEach((el) => {
      if (!META_KEYS.has(el.key)) row[el.key] = el.value
    })
    return row
  })

  const seen = new Set<string>()
  const headers: string[] = []
  parsed.forEach((row) =>
    Object.keys(row).forEach((k) => {
      if (!seen.has(k)) { seen.add(k); headers.push(k) }
    }),
  )
  const rows = parsed.map((row) => headers.map((h) => row[h] ?? ""))
  return { headers, rows }
}

/** Download a text blob as a file. */
export function downloadBlob(content: string, filename: string, mimeType = "text/plain;charset=utf-8;"): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
