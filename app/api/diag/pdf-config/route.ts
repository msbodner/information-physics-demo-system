import { NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8000"
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "tenantA"

// V5.0.7+ — proxy for the PDF-extract config diagnostic. Lets the UI
// auto-surface "your backend is using claude-opus-4-7, restart to pick
// up the Haiku default" inline when extraction is slow, without making
// the operator hunt through curl.
export async function GET() {
  try {
    const res = await fetch(`${API_BASE}/v1/diag/pdf-config`, {
      headers: { "X-Tenant-Id": TENANT_ID },
      cache: "no-store",
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}
