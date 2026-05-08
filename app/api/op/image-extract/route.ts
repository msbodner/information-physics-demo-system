import { NextRequest, NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8000"
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "tenantA"

// Mirrors app/api/op/pdf-extract — pure byte-passthrough so the
// inbound multipart boundary survives the proxy without going through
// Next.js's formData parser. See that route for the full rationale.
export const maxDuration = 600
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

    const res = await fetch(`${API_BASE}/v1/op/image-extract`, {
      method: "POST",
      headers: {
        "X-Tenant-Id": TENANT_ID,
        "Content-Type": contentType,
      },
      body: bodyBytes,
    })

    const text = await res.text()
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { parsed = { detail: text } }
    return NextResponse.json(parsed, { status: res.status })
  } catch (err) {
    console.error("image-extract proxy failed:", err)
    const message = err instanceof Error ? err.message : "backend_unavailable"
    return NextResponse.json({ error: "proxy_error", detail: message }, { status: 502 })
  }
}
