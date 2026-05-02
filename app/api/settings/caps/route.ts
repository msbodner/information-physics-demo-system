import { NextRequest, NextResponse } from "next/server"

// V4.6+ — proxy for the operator-tunable substrate caps. Three keys
// in system_settings: recall_max_aios, recall_thorough_max_aios,
// live_aio_cap_max. See infophysics_impl_grade/api/routes/settings.py
// for the resolver chain (system_settings → env var → fallback).

const API_BASE = process.env.API_BASE ?? "http://localhost:8000"

export async function GET() {
  try {
    const res = await fetch(`${API_BASE}/v1/settings/caps`, {
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
    const body = await request.json()
    const res = await fetch(`${API_BASE}/v1/settings/caps`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}
