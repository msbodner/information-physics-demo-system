import { NextRequest, NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8000"
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "tenantA"

// V5.0.2+ — SSE-streaming PDF extraction proxy.
//
// Same byte-forwarding pattern as /api/op/pdf-extract: we never parse
// the inbound multipart, we just hand the raw body to FastAPI which
// handles boundary parsing. The response body is text/event-stream;
// we pipe it back to the browser unbuffered so per-chunk events show
// up immediately rather than getting batched on a 4 KB or 60s flush.
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

    const upstream = await fetch(`${API_BASE}/v1/op/pdf-extract/stream`, {
      method: "POST",
      headers: {
        "X-Tenant-Id": TENANT_ID,
        "Content-Type": contentType,
      },
      body: bodyBytes,
    })

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "")
      let parsed: unknown
      try { parsed = JSON.parse(text) } catch { parsed = { detail: text || `HTTP ${upstream.status}` } }
      return NextResponse.json(parsed, { status: upstream.status })
    }

    // Pipe the SSE body straight through.
    const headers = new Headers()
    headers.set("Content-Type", "text/event-stream")
    headers.set("Cache-Control", "no-cache, no-transform")
    headers.set("X-Accel-Buffering", "no")
    headers.set("Connection", "keep-alive")
    return new NextResponse(upstream.body, { status: 200, headers })
  } catch (err) {
    console.error("pdf-extract stream proxy failed:", err)
    const message = err instanceof Error ? err.message : "backend_unavailable"
    return NextResponse.json({ error: "proxy_error", detail: message }, { status: 502 })
  }
}
