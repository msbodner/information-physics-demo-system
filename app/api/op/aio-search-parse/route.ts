import { NextRequest, NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8000"
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "tenantA"
const TIMEOUT_MS = 30000 // single LLM parse call — much shorter than aio-search

// Proxy for the V4.5+ parse-only endpoint. Recall Search calls this in
// Thorough mode to import Live's LLM-driven semantic normalization
// (typo correction, synonym expansion) without paying for the full
// aio-search synthesis. See infophysics_impl_grade/api/routes/chat.py
// for the backend implementation.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const res = await fetch(`${API_BASE}/v1/op/aio-search-parse`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "X-Tenant-Id": TENANT_ID },
      body: JSON.stringify(body),
    })
    clearTimeout(timer)
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}
