import { NextRequest, NextResponse } from "next/server"

// V4.4 P0a — backend-side AIO neighborhood filter. Pushes the
// O(|cues|×|aios|) candidate scan from the browser into Postgres,
// where it rides the pg_trgm GIN index on aio_data.elements_text
// (migration 016). The Substrate pipeline calls this before
// ``traverseHSL`` so the deterministic scoring runs over a small
// candidate subset rather than the full corpus.
const API_BASE = process.env.API_BASE ?? "http://localhost:8000"
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "tenantA"
const TIMEOUT_MS = 10000

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const res = await fetch(`${API_BASE}/v1/aio-data/find-by-needles`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-Id": TENANT_ID,
      },
      body: JSON.stringify(body),
    })
    clearTimeout(timer)
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}
