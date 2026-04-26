import { NextRequest, NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8000"
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "tenantA"

export async function POST(req: NextRequest) {
  try {
    // Forward optional ?as_of=<ISO8601> for point-in-time rebuilds.
    const asOf = req.nextUrl.searchParams.get("as_of")
    const qs = asOf ? `?as_of=${encodeURIComponent(asOf)}` : ""
    const res = await fetch(`${API_BASE}/v1/hsl-data/rebuild-from-aios${qs}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Tenant-Id": TENANT_ID },
      // This can take a while for large AIO corpora — set a generous timeout
      signal: AbortSignal.timeout(300_000),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}
