import { NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8080"

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const res = await fetch(`${API_BASE}/v1/roles/${id}`, { method: "DELETE" })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}
