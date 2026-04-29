import { NextRequest, NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8000"
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "tenantA"

// Allow multi-hundred-MB PDFs to traverse this route without Next.js
// truncating the body. The upstream backend caps at 100 MB.
export const maxDuration = 600
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    // CRITICAL: Pass the raw multipart body straight through.
    //
    // Earlier attempts went through `request.formData()` and rebuilt a
    // new FormData on the fly. Two failure modes blew up:
    //   1. Streaming the inbound formData object as the outbound `body`
    //      → Node's ReadableStream controller gets closed twice across
    //      the Next.js↔undici boundary →
    //      `TypeError: Invalid state: Controller is already closed`
    //      (ERR_INVALID_STATE) → uncaughtException killed the proxy.
    //   2. Reading the file out, wrapping in a fresh Blob, and
    //      `outboundForm.append("file", blob, filename)` → undici's
    //      File construction touches a property that's undefined for
    //      certain Blob → File transitions →
    //      `Cannot read properties of undefined (reading 'toLowerCase')`.
    //
    // Both are avoided by NOT parsing the multipart at all in the
    // proxy. We buffer the entire request body into a single Uint8Array
    // and re-emit it verbatim with the original `Content-Type` header
    // (which carries the multipart boundary). The upstream FastAPI
    // handler parses the multipart on its own — the proxy is now a
    // pure byte forwarder.
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

    const res = await fetch(`${API_BASE}/v1/op/pdf-extract`, {
      method: "POST",
      headers: {
        "X-Tenant-Id": TENANT_ID,
        "Content-Type": contentType,
      },
      body: bodyBytes,
      // Required by undici when sending a non-stream body via fetch
      // in Node — duplex doesn't apply to byte bodies but explicit
      // disable keeps the request firmly in non-streaming mode.
    })

    const text = await res.text()
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { parsed = { detail: text } }
    return NextResponse.json(parsed, { status: res.status })
  } catch (err) {
    console.error("pdf-extract proxy failed:", err)
    const message = err instanceof Error ? err.message : "backend_unavailable"
    return NextResponse.json({ error: "proxy_error", detail: message }, { status: 502 })
  }
}
