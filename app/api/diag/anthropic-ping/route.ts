import { NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8000"
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "tenantA"

// V5.0.7+ — proxy for the Anthropic-ping diagnostic. Times a tiny
// 'hi' Haiku request end-to-end so the UI can isolate whether
// extraction slowness is in Anthropic/network or in our pipeline.
export async function GET() {
  try {
    const res = await fetch(`${API_BASE}/v1/diag/anthropic-ping`, {
      headers: { "X-Tenant-Id": TENANT_ID },
      cache: "no-store",
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}
