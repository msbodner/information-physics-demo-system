"""Imported PDFs — list/view/delete persisted PDF originals.

V5.0+ — every PDF run through `/v1/op/pdf-extract` is stored verbatim
in the `imported_pdfs` table (migration 035) so admins can review,
re-download, or delete the original document from System Admin → PDFs.

Endpoints:
  GET    /v1/imported-pdfs                 — list (no bytea — metadata only)
  GET    /v1/imported-pdfs/{pdf_id}        — single record metadata
  GET    /v1/imported-pdfs/{pdf_id}/content — original PDF bytes (octet-stream)
  DELETE /v1/imported-pdfs/{pdf_id}        — drop the record + bytes

The bytea content is intentionally NOT included on list responses —
listing 100 PDFs at ~1 MB each over the wire defeats the purpose of
having a viewer endpoint. Operators fetch /content only when they
click "View" or "Download" in the admin pane.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel

from api.db import db, set_tenant

logger = logging.getLogger("infophysics.api.imported_pdfs")

router = APIRouter()


class ImportedPdfMeta(BaseModel):
    pdf_id: uuid.UUID
    filename: str
    size_bytes: int
    page_count: Optional[int] = None
    sha256: Optional[str] = None
    status: str
    row_count: Optional[int] = None
    chunk_count: Optional[int] = None
    chunks_failed: Optional[int] = None
    current_chunk: Optional[int] = None  # V5.0.5+ — live progress index
    duration_ms: Optional[int] = None
    error: Optional[str] = None
    created_at: datetime


_META_COLS = (
    "pdf_id, filename, size_bytes, page_count, sha256, status, "
    "row_count, chunk_count, chunks_failed, current_chunk, duration_ms, error, created_at"
)


def _row_to_meta(row) -> ImportedPdfMeta:
    return ImportedPdfMeta(
        pdf_id=row[0],
        filename=row[1],
        size_bytes=int(row[2]),
        page_count=row[3],
        sha256=row[4],
        status=row[5],
        row_count=row[6],
        chunk_count=row[7],
        chunks_failed=row[8],
        current_chunk=row[9],
        duration_ms=row[10],
        error=row[11],
        created_at=row[12],
    )


@router.get("/v1/imported-pdfs", response_model=List[ImportedPdfMeta])
def list_imported_pdfs(
    limit: int = Query(500, ge=1, le=5_000),
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    """Return all PDFs imported by this tenant, newest first.

    Bytea content is excluded — call /content for individual bytes.
    """
    tenant = x_tenant_id or "tenantA"
    with db() as conn:
        with conn.cursor() as cur:
            set_tenant(conn, tenant)
            cur.execute(
                f"SELECT {_META_COLS} FROM imported_pdfs "
                "WHERE tenant_id = %s ORDER BY created_at DESC LIMIT %s",
                (tenant, limit),
            )
            rows = cur.fetchall()
    return [_row_to_meta(r) for r in rows]


@router.get("/v1/imported-pdfs/{pdf_id}", response_model=ImportedPdfMeta)
def get_imported_pdf(
    pdf_id: str,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    tenant = x_tenant_id or "tenantA"
    with db() as conn:
        with conn.cursor() as cur:
            set_tenant(conn, tenant)
            cur.execute(
                f"SELECT {_META_COLS} FROM imported_pdfs "
                "WHERE tenant_id = %s AND pdf_id = %s",
                (tenant, pdf_id),
            )
            row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="PDF not found")
    return _row_to_meta(row)


@router.get("/v1/imported-pdfs/{pdf_id}/content")
def get_imported_pdf_content(
    pdf_id: str,
    download: bool = Query(False, description="If true, set Content-Disposition: attachment"),
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    """Stream the original PDF bytes back to the caller.

    The browser PDF viewer uses inline (default) so the file renders in
    a new tab / iframe; the System Admin "Download" action passes
    ?download=true so the file lands on disk.
    """
    tenant = x_tenant_id or "tenantA"
    with db() as conn:
        with conn.cursor() as cur:
            set_tenant(conn, tenant)
            cur.execute(
                "SELECT filename, content FROM imported_pdfs "
                "WHERE tenant_id = %s AND pdf_id = %s",
                (tenant, pdf_id),
            )
            row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="PDF not found")
    filename, content = row
    if content is None:
        raise HTTPException(status_code=410, detail="PDF content has been purged")
    safe_name = (filename or "document.pdf").replace('"', "")
    disposition = (
        f'attachment; filename="{safe_name}"' if download
        else f'inline; filename="{safe_name}"'
    )
    return Response(
        content=bytes(content),
        media_type="application/pdf",
        headers={"Content-Disposition": disposition},
    )


@router.get("/v1/imported-pdfs/{pdf_id}/csv-result")
def get_imported_pdf_csv_result(
    pdf_id: str,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    """Return the parsed CSV + rows extracted from this PDF.

    V5.0.4+ — used by the streaming PDF extraction flow. The streaming
    endpoint persists the extraction result then yields a tiny
    `complete` event with just the pdf_id; the client fetches the
    actual rows via this endpoint. Avoids ~3KB+ SSE payloads getting
    stuck in proxy buffers.
    """
    tenant = x_tenant_id or "tenantA"
    with db() as conn:
        with conn.cursor() as cur:
            set_tenant(conn, tenant)
            cur.execute(
                """
                SELECT filename, csv_text, headers, row_count, page_count,
                       chunk_count, chunks_failed, duration_ms, status, error
                FROM imported_pdfs
                WHERE tenant_id = %s AND pdf_id = %s
                """,
                (tenant, pdf_id),
            )
            row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="PDF not found")
    filename, csv_text, headers_json, row_count, page_count, chunk_count, chunks_failed, duration_ms, status, error = row
    if csv_text is None:
        raise HTTPException(status_code=409, detail="PDF extraction not yet complete")
    # Parse CSV back into rows (we stored the canonical CSV text).
    import csv as csv_mod
    import io as io_mod
    reader = csv_mod.reader(io_mod.StringIO(csv_text))
    parsed = list(reader)
    out_headers = parsed[0] if parsed else []
    out_rows = parsed[1:] if len(parsed) > 1 else []
    return {
        "csv_text": csv_text,
        "headers": out_headers,
        "rows": out_rows,
        "filename": filename,
        "document_count": row_count or len(out_rows),
        "page_count": page_count,
        "chunk_count": chunk_count,
        "chunks_failed": chunks_failed,
        "elapsed_seconds": (duration_ms or 0) / 1000.0,
        "pdf_id": pdf_id,
        "status": status,
        "error": error,
    }


@router.delete("/v1/imported-pdfs/{pdf_id}", status_code=204)
def delete_imported_pdf(
    pdf_id: str,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    tenant = x_tenant_id or "tenantA"
    with db() as conn:
        with conn.cursor() as cur:
            set_tenant(conn, tenant)
            cur.execute(
                "DELETE FROM imported_pdfs WHERE tenant_id = %s AND pdf_id = %s",
                (tenant, pdf_id),
            )
            deleted = cur.rowcount
        conn.commit()
    if not deleted:
        raise HTTPException(status_code=404, detail="PDF not found")
    return Response(status_code=204)
