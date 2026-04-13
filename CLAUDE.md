# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AIO System App is a full-stack Information Physics platform that converts CSV/PDF data into Associated Information Objects (AIOs), links them via a Hyper-Semantic Layer (HSL), provides AI-powered retrieval via ChatAIO, and persists retrieval episodes as Memory Result Objects (MROs).

## Build & Run Commands

### Frontend (Next.js 16 + React 19)
```bash
pnpm install          # Install dependencies
pnpm dev              # Dev server with Turbopack (port 3000)
pnpm build            # Production build (standalone output)
```

### Backend (FastAPI + Python 3.10+)
```bash
cd infophysics_impl_grade
uvicorn api.main:app --reload --port 8080   # Dev server
```
The backend requires PostgreSQL. Migrations auto-run via `start.sh`.

### Full Stack (Docker)
```bash
docker compose up --build    # PostgreSQL + Backend + Frontend
```
Frontend at http://localhost:3000, Backend at http://localhost:8080.

### Electron Desktop App
```bash
cd electron
npm install
npm start              # Dev mode
npm run dist           # Build DMG/EXE/AppImage
```
Requires `electron/resources/` populated by `bash scripts/build-resources.sh`.

## Architecture

### Three-Layer Data Model
- **AIOs** (Layer 1): Self-describing observation objects in `[Key.Value]` bracket notation. Stored in `aio_data` table (50 element columns).
- **HSLs** (Relational): Precomputed pointer tables linking AIOs via shared elements. Stored in `hsl_data` table (100 element columns).
- **MROs** (Layer 2): Persisted retrieval episodes from ChatAIO. Stored in `mro_objects` table with query, result, search_terms (JSONB), and lineage.

### Frontend → Backend Communication
All frontend API calls go through Next.js API routes in `app/api/` which proxy to the FastAPI backend. The backend URL is configured via `API_BASE` env var (default: `http://localhost:8080`).

Pattern: `app/api/{resource}/route.ts` → `${API_BASE}/v1/{resource}`

### Key Frontend Files
- `app/page.tsx` — Main SPA with all views (home, converter, HSL builder, R&D, workflow, guides, reference papers)
- `components/chat-aio-dialog.tsx` — Full-screen ChatAIO with two search modes, MRO save, PDF export
- `components/system-management.tsx` — Admin panel with 10 tabs (users, roles, AIO data, HSL data, API key, saved CSVs, saved AIOs, saved prompts, info elements, architecture)
- `lib/api-client.ts` — Typed fetch wrappers for all API endpoints

### Key Backend Files
- `infophysics_impl_grade/api/main.py` — All FastAPI endpoints (~60KB). Key endpoints:
  - `/v1/op/chat` — Broad search (all AIOs as context)
  - `/v1/op/aio-search` — Four-phase search algebra (parse → match HSLs → gather AIOs → synthesize)
  - `/v1/op/pdf-extract` — PDF-to-CSV via Claude AI
  - CRUD for: `/v1/aio-data`, `/v1/hsl-data`, `/v1/mro-objects`, `/v1/information-elements`, `/v1/saved-prompts`, `/v1/io`, `/v1/users`, `/v1/roles`
- `infophysics_impl_grade/migrations/` — 11 SQL migration files (000-011), applied in order by `start.sh`

### Database
PostgreSQL 15 with Row-Level Security for tenant isolation. Tenant set via `X-Tenant-Id` header (default: `tenantA`). Key tables: `aio_data`, `hsl_data`, `mro_objects`, `information_elements`, `information_objects`, `saved_prompts`, `users`, `roles`, `system_settings`.

## Deployment

### Railway (Production)
Both services auto-deploy from GitHub `main` branch. Always deploy to **both** the AIO App and aio-processor Railway projects when pushing changes.
- Frontend: `railway.toml` at root (healthcheck: `/`)
- Backend: `infophysics_impl_grade/railway.toml` (healthcheck: `/v1/health`, rootDirectory: `infophysics_impl_grade`)

### Railway CLI
```bash
export RAILWAY_API_TOKEN="<token>"
railway link --project "AIO App"
railway service <service-name>
railway redeploy --yes
```

## Important Patterns

- **Version string**: Currently V3.1. Update in: `app/layout.tsx`, `app/page.tsx`, `components/chat-aio-dialog.tsx`, `components/user-guide.tsx`, `components/system-management.tsx`, `components/splash-screen.tsx`, `components/dashboard.tsx`, `components/app-sidebar.tsx`, `package.json`, `electron/package.json`, `electron/preload.js`
- **Adding a new API endpoint**: Create FastAPI route in `api/main.py` → create Next.js proxy in `app/api/{name}/route.ts` → add typed client function in `lib/api-client.ts`
- **Adding a System Admin tab**: Add `TabsTrigger` + `TabsContent` in `components/system-management.tsx`, create a new pane function
- **SQL migrations**: Add numbered file in `infophysics_impl_grade/migrations/` (e.g., `012_new_table.sql`). Migrations run automatically on backend startup. Use `IF NOT EXISTS` for idempotency.
- **Backend Dockerfile**: pip dependencies are hardcoded in the Dockerfile `RUN pip install` line, not read from `pyproject.toml`. Update both when adding Python packages.
