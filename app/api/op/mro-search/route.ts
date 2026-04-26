import { NextRequest, NextResponse } from "next/server"

// V4.4 — MRO-assisted retrieval. Proxies the substrate pipeline's
// "similar past episodes" lookup. Read-only, sub-second; safe to call
// on every chat invocation.
const API_BASE = process.env.API_BASE ?? "http://localhost:8000"
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "tenantA"
const TIMEOUT_MS = 10000

export async function GET(request: NextRequest) {
  try {
    const qs = request.nextUrl.search // includes leading "?" or ""
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const res = await fetch(`${API_BASE}/v1/op/mro-search${qs}`, {
      signal: controller.signal,
      headers: { "X-Tenant-Id": TENANT_ID },
    })
    clearTimeout(timer)
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}
