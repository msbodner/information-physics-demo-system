import { NextRequest, NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8000"
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "tenantA"
const TIMEOUT_MS = 60000 // chat may take longer with large context

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const res = await fetch(`${API_BASE}/v1/op/chat`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-Id": TENANT_ID,
      },
      body: JSON.stringify(body),
    })
    clearTimeout(timer)
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}
