import { NextRequest, NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8000"
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "tenantA"

// V5.0.10+ — comprehensive summarize takes 25-45s on large corpora
// (LLM produces structured industry / categories / entities /
// patterns / narrative blocks). Old proxy hardcoded 30s, which
// fired right at the edge of typical runs and surfaced as
// `backend_unavailable` to the operator. Bump to 180s with hooks
// for the cooperating Vercel/Next.js platform timeout.
const TIMEOUT_MS = 180_000

export const maxDuration = 240
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const res = await fetch(`${API_BASE}/v1/op/summarize`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-Id": TENANT_ID,
        "Cookie": request.headers.get("cookie") ?? "",
      },
      body: JSON.stringify(body),
    })
    clearTimeout(timer)
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError"
    const detail = isTimeout
      ? `Summarize exceeded ${Math.round(TIMEOUT_MS / 1000)}s`
      : "backend_unavailable"
    return NextResponse.json({ error: detail }, { status: 503 })
  }
}
