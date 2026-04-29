import { NextRequest, NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8000"
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "tenantA"

// Allow multi-hundred-MB PDFs to traverse this route without Next.js
// truncating the body. The upstream backend caps at 100 MB.
export const maxDuration = 600
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    // CRITICAL: Read the file into memory before forwarding.
    //
    // Previously we passed `request.formData()` directly as the upstream
    // `body`, which made Next.js re-stream the multipart payload. On
    // large PDFs that triggered Node's
    //   TypeError: Invalid state: Controller is already closed
    //   (ERR_INVALID_STATE)
    // — the underlying ReadableStream's controller gets closed twice
    // when the stream is consumed-then-forwarded across the Next.js
    // ↔ Node fetch boundary. The uncaughtException killed the proxy
    // process, which the browser saw as "fetch failed" and the UI
    // surfaced as "backend_unavailable".
    //
    // Re-building the FormData from a fresh Blob over the file's bytes
    // avoids the race entirely — fetch sees a static, fully-buffered
    // body and serializes the multipart itself.
    const inboundForm = await request.formData()
    const file = inboundForm.get("file")
    if (!(file instanceof Blob)) {
      return NextResponse.json({ detail: "Missing or invalid file field" }, { status: 400 })
    }

    const buf = Buffer.from(await file.arrayBuffer())
    const filename = (file as File).name ?? "upload.pdf"
    const blob = new Blob([buf], { type: file.type || "application/pdf" })

    const outboundForm = new FormData()
    outboundForm.append("file", blob, filename)

    const res = await fetch(`${API_BASE}/v1/op/pdf-extract`, {
      method: "POST",
      headers: { "X-Tenant-Id": TENANT_ID },
      body: outboundForm,
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
