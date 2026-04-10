import { NextRequest, NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8080"
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "tenantA"

export async function GET() {
  try {
    const res = await fetch(`${API_BASE}/v1/settings/apikey`, {
      headers: { "X-Tenant-Id": TENANT_ID },
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const res = await fetch(`${API_BASE}/v1/settings/apikey`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Tenant-Id": TENANT_ID },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}
