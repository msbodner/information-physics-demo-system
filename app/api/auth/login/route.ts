import { NextRequest, NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8000"
const TIMEOUT_MS = 8000

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(`${API_BASE}/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    // Try to parse JSON; if backend returns non-JSON (e.g. 500 HTML), handle gracefully
    let data: unknown
    try {
      data = await res.json()
    } catch {
      data = { detail: `Backend error (HTTP ${res.status})` }
    }
    return NextResponse.json(data, { status: res.status })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    const isTimeout = msg.includes("abort") || msg.includes("timeout")
    return NextResponse.json(
      { error: "backend_unavailable", detail: isTimeout ? "Login request timed out" : msg },
      { status: 503 }
    )
  }
}
