import { NextRequest, NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8000"

export async function GET(request: NextRequest) {
  try {
    const tenant = request.headers.get("x-tenant-id") ?? "tenantA"
    const res = await fetch(`${API_BASE}/v1/settings/budget`, {
      headers: { "X-Tenant-Id": tenant },
      cache: "no-store",
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const tenant = request.headers.get("x-tenant-id") ?? "tenantA"
    const body = await request.json()
    const res = await fetch(`${API_BASE}/v1/settings/budget`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Tenant-Id": tenant },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}
