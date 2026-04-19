import { NextRequest, NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8000"

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const res = await fetch(`${API_BASE}/v1/op/pdf-extract`, {
      method: "POST",
      body: formData,
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}
