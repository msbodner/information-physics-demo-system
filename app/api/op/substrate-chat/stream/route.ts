import { NextRequest } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8080"
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "tenantA"

// Pass-through proxy for the SSE stream. See aio-search/stream for the
// rationale on raw forwarding. V5.0+ — forwards Cookie so the
// prototype's auth middleware can derive the tenant from the JWT.
// (Was missed by the V5.0 cookie-forwarding patch because the regex
// only caught the multi-line trailing-comma form, but the trailing
// `,\n      },` here didn't match cleanly.)
export async function POST(request: NextRequest) {
  try {
    const body = await request.text()
    const upstream = await fetch(`${API_BASE}/v1/op/substrate-chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-Id": TENANT_ID,
        "Cookie": request.headers.get("cookie") ?? "",
      },
      body,
    })
    if (!upstream.body) {
      return new Response("upstream returned no body", { status: 502 })
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    })
  } catch {
    return new Response("backend_unavailable", { status: 503 })
  }
}
