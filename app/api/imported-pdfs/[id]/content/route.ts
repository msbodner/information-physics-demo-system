import { NextRequest, NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8000"
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "tenantA"

// V5.0+ — proxy raw PDF bytes back to the browser. The viewer uses
// inline disposition so the file renders in an <iframe>; the Download
// button passes ?download=true so the file lands on disk instead.
//
// Streaming the body avoids buffering large PDFs in Node memory.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const download = request.nextUrl.searchParams.get("download") === "true"
  const upstreamUrl = `${API_BASE}/v1/imported-pdfs/${id}/content${download ? "?download=true" : ""}`

  try {
    const res = await fetch(upstreamUrl, {
      headers: { "X-Tenant-Id": TENANT_ID },
      cache: "no-store",
    })
    if (!res.ok) {
      const text = await res.text()
      return new NextResponse(text || "Upstream error", { status: res.status })
    }
    // Re-emit headers we care about and stream body straight through.
    const headers = new Headers()
    const ct = res.headers.get("content-type")
    if (ct) headers.set("Content-Type", ct)
    const cd = res.headers.get("content-disposition")
    if (cd) headers.set("Content-Disposition", cd)
    const cl = res.headers.get("content-length")
    if (cl) headers.set("Content-Length", cl)
    headers.set("Cache-Control", "no-store")
    return new NextResponse(res.body, { status: 200, headers })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}
