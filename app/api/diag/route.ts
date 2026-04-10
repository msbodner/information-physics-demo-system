import { NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8080"

export async function GET() {
  try {
    const res = await fetch(`${API_BASE}/v1/diag`)
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}
