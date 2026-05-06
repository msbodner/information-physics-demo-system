import { NextRequest, NextResponse } from "next/server"

const API_BASE = process.env.API_BASE ?? "http://localhost:8080"
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "tenantA"

// V5.0+ — Prompt Library proxy. Get / update / delete one entry.

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const res = await fetch(`${API_BASE}/v1/prompt-library/${id}`, {
      headers: {
        "X-Tenant-Id": TENANT_ID,
        "Cookie": request.headers.get("cookie") ?? "",
      },
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const body = await request.json()
    const res = await fetch(`${API_BASE}/v1/prompt-library/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-Id": TENANT_ID,
        "Cookie": request.headers.get("cookie") ?? "",
      },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const res = await fetch(`${API_BASE}/v1/prompt-library/${id}`, {
      method: "DELETE",
      headers: {
        "X-Tenant-Id": TENANT_ID,
        "Cookie": request.headers.get("cookie") ?? "",
      },
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "backend_unavailable" }, { status: 503 })
  }
}
