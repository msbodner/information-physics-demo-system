import { NextRequest, NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8000"
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "tenantA"

// Next.js 16 made dynamic route `params` Promise-typed. Awaiting it
// is mandatory; the previous sync signature ({ params: { id: string } })
// silently delivered `undefined` for `params.id` at runtime, which the
// backend then tried to parse as a UUID and 503'd with
// "Database unavailable" — the cause of every silent linkMroToHsl
// failure in production before this fix. Every Recall and Live Search
// since Next.js 16 dropped its back-pointer writes for this reason.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    if (!id || id === "undefined") {
      return NextResponse.json({ error: "missing_hsl_id" }, { status: 400 })
    }
    const body = await request.json()
    const res = await fetch(`${API_BASE}/v1/hsl-data/${encodeURIComponent(id)}/link-mro`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Tenant-Id": TENANT_ID },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}
