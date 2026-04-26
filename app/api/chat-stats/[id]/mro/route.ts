import { NextRequest, NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8000"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const tenant = request.headers.get("x-tenant-id") ?? "tenantA"
    const res = await fetch(`${API_BASE}/v1/chat-stats/${id}/mro`, {
      headers: { "X-Tenant-Id": tenant },
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}
