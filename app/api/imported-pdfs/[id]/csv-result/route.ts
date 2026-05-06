import { NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8000"
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "tenantA"

// V5.0.4+ — proxy for the parsed CSV result of a persisted PDF.
// Used by extractPdfToCsvStream after it receives the tiny `complete`
// SSE event so the result data flows over a normal REST GET (no SSE
// payload-size buffering edge cases).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const res = await fetch(`${API_BASE}/v1/imported-pdfs/${id}/csv-result`, {
      headers: { "X-Tenant-Id": TENANT_ID },
      cache: "no-store",
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}
