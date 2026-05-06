import { NextRequest, NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8080"
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "tenantA"

// V5.0+ — Prompt Library proxy. List + create.
// Forwards Cookie so the prototype's auth middleware can derive the
// tenant; the demo just relies on the X-Tenant-Id header.

export async function GET(request: NextRequest) {
  try {
    const qs = request.nextUrl.search ?? ""
    const res = await fetch(`${API_BASE}/v1/prompt-library${qs}`, {
      headers: {
        "X-Tenant-Id": TENANT_ID,
        "Cookie": request.headers.get("cookie") ?? "",
      },
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const res = await fetch(`${API_BASE}/v1/prompt-library`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-Id": TENANT_ID,
        "Cookie": request.headers.get("cookie") ?? "",
      },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}
