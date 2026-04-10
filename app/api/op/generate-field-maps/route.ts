import { NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8080"

export async function POST() {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120000) // 2 min for LLM
    const res = await fetch(`${API_BASE}/v1/op/generate-field-maps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    })
    clearTimeout(timeout)
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}
