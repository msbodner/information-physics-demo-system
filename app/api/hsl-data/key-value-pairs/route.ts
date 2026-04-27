import { NextRequest, NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8000"
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "tenantA"
const TIMEOUT_MS = 10000

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const qs = searchParams.toString()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const res = await fetch(
      `${API_BASE}/v1/hsl-data/key-value-pairs${qs ? `?${qs}` : ""}`,
      {
        signal: controller.signal,
        headers: { "X-Tenant-Id": TENANT_ID },
      },
    )
    clearTimeout(timer)
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}
