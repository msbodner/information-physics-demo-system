import { NextRequest, NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8000"
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "tenantA"

// V5.0.5+ — kicks off async PDF extraction, returns pdf_id immediately.
// Same byte-forwarding pattern as /api/op/pdf-extract.
export const maxDuration = 60
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || ""
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return NextResponse.json(
        { detail: `Expected multipart/form-data, got: ${contentType || "(none)"}` },
        { status: 400 },
      )
    }

    const arrayBuf = await request.arrayBuffer()
    const bodyBytes = new Uint8Array(arrayBuf)
    if (bodyBytes.byteLength === 0) {
      return NextResponse.json({ detail: "Empty request body" }, { status: 400 })
    }

    const res = await fetch(`${API_BASE}/v1/op/pdf-extract-async`, {
      method: "POST",
      headers: { "X-Tenant-Id": TENANT_ID, "Content-Type": contentType },
      body: bodyBytes,
    })

    const text = await res.text()
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { parsed = { detail: text } }
    return NextResponse.json(parsed, { status: res.status })
  } catch (err) {
    console.error("pdf-extract-async proxy failed:", err)
    const message = err instanceof Error ? err.message : "backend_unavailable"
    return NextResponse.json({ error: "proxy_error", detail: message }, { status: 502 })
  }
}
