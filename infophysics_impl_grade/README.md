# InformationPhysics Implementation-Grade Skeleton

This repo is a minimal but production-oriented starting point for the InformationPhysics.ai platform:
- IO Registry + versioned representations (Postgres)
- Derivation DAG (immutable events)
- Operator workers (extract/chunk/embed/summarize/link/derive_view/validate)
- Measurement API (router for sql/retrieval/llm/estimator instruments)
- Dev stack via docker-compose

## Quick start (dev)
1. `docker compose up -d postgres qdrant opensearch minio`
2. Apply migrations:
   - `psql $DATABASE_URL -f migrations/000_extensions.sql`
   - `psql $DATABASE_URL -f migrations/001_base_tables.sql`
   - `psql $DATABASE_URL -f migrations/002_indexes.sql`
   - `psql $DATABASE_URL -f migrations/003_rls.sql`
3. Start services:
   - `uvicorn api.main:app --reload --port 8080`
   - `python -m worker.runner`

## Tenant isolation
Per request, middleware sets:
- `SET LOCAL app.tenant_id = '<tenant>'`
and RLS enforces tenant partitioning.

## OpenAPI
See `openapi/openapi.yaml`.
