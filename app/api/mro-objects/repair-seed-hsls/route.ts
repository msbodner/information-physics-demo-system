import { NextRequest, NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8000"
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "tenantA"

export async function POST(_request: NextRequest) {
  try {
    const res = await fetch(`${API_BASE}/v1/mro-objects/repair-seed-hsls`, {
      method: "POST",
      headers: { "X-Tenant-Id": TENANT_ID },
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}
