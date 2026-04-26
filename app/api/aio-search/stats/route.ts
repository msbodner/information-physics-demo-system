import { NextRequest, NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8000"
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "tenantA"

// Proxy for the AIO Search quality readback (V4.4 P14).
// Backend reads from aio_search_quality (migration 024), populated when
// AIO_SEARCH_LOG_QUALITY=1 is set on the API. Returns p50/p95/p99 timings,
// cache hit rates, and retrieval-shape averages over a time window.
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const qs = url.searchParams.toString()
    const target = `${API_BASE}/v1/aio-search/stats${qs ? `?${qs}` : ""}`
    const res = await fetch(target, {
      headers: { "X-Tenant-Id": TENANT_ID },
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}
