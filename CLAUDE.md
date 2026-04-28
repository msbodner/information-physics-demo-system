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
pnpm test             # node --test --import tsx lib/__tests__/*.test.ts
```

### Backend (FastAPI + Python 3.10+)
```bash
cd infophysics_impl_grade
uvicorn api.main:app --reload --port 8080   # Dev server
python3 -m pytest tests/ -q                 # Backend tests
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

**macOS code signing & notarization (optional but strongly recommended for distribution).** The build degrades gracefully — if no certificate is installed and no env vars are set, it produces unsigned DMGs that work but require right-click → Open on first launch. To produce signed + notarized DMGs:

1. Have an active **Apple Developer Program** membership.
2. Install a **Developer ID Application** certificate in Keychain (download .cer from developer.apple.com).
3. Generate an **app-specific password** at appleid.apple.com (for notarization).
4. Copy `electron/.env.example` to `electron/.env` and fill in `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. The `.env` file is gitignored.
5. `npm run dist` — the script auto-sources `.env`, signs with the Keychain identity, and submits for notarization (3-15 minutes).

The Hardened Runtime entitlements live in `electron/build/entitlements.mac.plist` — they enable Electron's V8 JIT and allow loading the bundled Python/Postgres binaries without library validation. Don't tighten without testing the embedded backend still launches.

## Architecture

### Three-Layer Data Model
- **AIOs** (Layer 1): Self-describing observation objects in `[Key.Value]` bracket notation. Stored in `aio_data` table (50 element columns).
- **HSLs** (Relational): Precomputed pointer tables linking AIOs via shared elements. Stored in `hsl_data` table (100 element columns).
- **MROs** (Layer 2): Persisted retrieval episodes from ChatAIO. Stored in `mro_objects` table with query, result, search_terms (JSONB), and lineage.

### Substrate Mode (Paper III pipeline)
Headline retrieval pipeline. Client assembles a JSON substrate envelope (HSL gating + MRO-assisted retrieval + needle-matched AIOs) and calls `/v1/op/substrate-chat` (or `/stream`). Find-by-needles endpoints (`/v1/aio-data/find-by-needles`, `/v1/hsl-data/find-by-needles`) and `/v1/op/mro-search` feed the substrate; `trust_score` on MROs ranks prior episodes.

### Frontend → Backend Communication
All frontend API calls go through Next.js API routes in `app/api/` which proxy to the FastAPI backend. The backend URL is configured via `API_BASE` env var (default: `http://localhost:8080`).

Pattern: `app/api/{resource}/route.ts` → `${API_BASE}/v1/{resource}`

### Key Frontend Files
- `app/page.tsx` — Main SPA with all views (home, converter, HSL builder, R&D, workflow, guides, reference papers)
- `components/chat-aio-dialog.tsx` — Full-screen ChatAIO with all four search modes (Recall/Live/Broad/Raw), MRO save, PDF export
- `components/system-management.tsx` — Admin panel with tabs for users, roles, AIO data, HSL data, MRO data, API key, **Models** (LLM selection), saved CSVs/AIOs/prompts, info elements, search statistics, references, architecture, demo reset/backup
- `components/benchmark-runner.tsx` — Full-screen four-mode benchmark UI mounted from R&D; Print/Save-as-PDF
- `lib/api-client.ts` — Typed fetch wrappers for all API endpoints
- `lib/benchmarks.ts` — Saved benchmark prompts + `runFourModes()` (browser-side counterpart to `scripts/measure_modes.ts`)
- `lib/aio-math.ts` — AIO ranking with cap-by-CSV diversity (prevents single-CSV dominance in the substrate)
- `lib/hsl-aliases.ts` — Canonical field-name aliasing (`Project_ID` ≡ `Project ID` ≡ `Projects Assigned` ≡ `Applicable Projects` → `Project`)

### Key Backend Files
- `infophysics_impl_grade/api/main.py` — App wiring + middleware only. Endpoints live in `api/routes/`.
- `infophysics_impl_grade/api/routes/` — Per-resource routers: `aio.py`, `hsl.py`, `mro.py`, `chat.py`, `io.py`, `users.py`, `prompts.py`, `settings.py`, `stats.py`, `demo_reset.py`. Key endpoints:
  - `/v1/op/chat` — Broad search (all AIOs as context)
  - `/v1/op/aio-search` (+ `/stream`) — Four-phase search algebra (parse → match HSLs → gather AIOs → synthesize)
  - `/v1/op/substrate-chat` (+ `/stream`) — Substrate Mode: client-assembled JSON envelope to LLM
  - `/v1/op/mro-search` — MRO-assisted retrieval over prior episodes
  - `/v1/op/pdf-extract` — PDF-to-CSV via Claude AI
  - `/v1/aio-data/find-by-needles`, `/v1/hsl-data/find-by-needles` — Needle-keyed lookups feeding substrate
  - `/v1/mro-objects/bump-trust`, `/v1/hsl-data/{id}/link-mro` — Trust scoring + HSL↔MRO lineage
  - CRUD for: `/v1/aio-data`, `/v1/hsl-data`, `/v1/mro-objects`, `/v1/information-elements`, `/v1/saved-prompts`, `/v1/io`, `/v1/users`, `/v1/roles`
- `infophysics_impl_grade/migrations/` — Numbered SQL migrations (000–029, latest: `029_fix_hsl_ier_index.sql`), applied in order by `start.sh`. Notable: `017_information_element_refs.sql` introduced the inverted index that backs `find-by-needles-full`; `029_fix_hsl_ier_index.sql` extended `ier_refresh_hsl()` to also parse `hsl_data.hsl_name` (the bracket token lives there, not in the element columns), with backfill for existing rows.

### Database
PostgreSQL 15 with Row-Level Security for tenant isolation. Tenant set via `X-Tenant-Id` header (default: `tenantA`). Key tables: `aio_data`, `hsl_data`, `mro_objects`, `information_elements`, `information_objects`, `saved_prompts`, `users`, `roles`, `system_settings`.

## Deployment

### Railway (Production)
All services live in the **Information Physics Demo System** Railway project and auto-deploy from GitHub `main` branch.
- Frontend (`frontend` service): `railway.toml` at root (healthcheck: `/`)
- Backend (`infophysics-api` service): `infophysics_impl_grade/railway.toml` (healthcheck: `/v1/health`, rootDirectory: `infophysics_impl_grade`)
- Database: managed `postgres` service

### Railway CLI
```bash
# Link (one-time)
railway link --project "Information Physics Demo System"

# Redeploy a service
railway service redeploy --service frontend --yes
railway service redeploy --service infophysics-api --yes

# Check status
railway service status --all
```

## Important Patterns

- **Version string**: Currently V4.5 (`package.json` is source of truth). Grep the repo before bumping — known hardcoded sites include: `app/layout.tsx`, `app/page.tsx`, `components/chat-aio-dialog.tsx`, `components/user-guide.tsx`, `components/system-management.tsx`, `components/splash-screen.tsx`, `components/dashboard.tsx`, `components/app-sidebar.tsx`, `package.json`, `electron/package.json`, `electron/preload.js`, `electron/splash.html`. Historical references (e.g. "V4.3 added X", changelog entries in technotes) should NOT be retconned.
- **Adding a new API endpoint**: Create FastAPI route in the appropriate `api/routes/*.py` (or add a new router and include it in `api/main.py`) → create Next.js proxy in `app/api/{name}/route.ts` → add typed client function in `lib/api-client.ts`
- **Adding a System Admin tab**: Add `TabsTrigger` + `TabsContent` in `components/system-management.tsx`, create a new pane function
- **SQL migrations**: Add numbered file in `infophysics_impl_grade/migrations/` (e.g., `012_new_table.sql`). Migrations run automatically on backend startup. Use `IF NOT EXISTS` for idempotency.
- **Backend Dockerfile**: pip dependencies are hardcoded in the Dockerfile `RUN pip install` line, not read from `pyproject.toml`. Update both when adding Python packages.
- **LLM model selection**: Every Anthropic call site goes through `get_default_model()` / `get_parse_model()` in `infophysics_impl_grade/api/llm.py`. Resolution order: `system_settings.{default_model,parse_model}` (set via System Management → Models tab) → env var (`ANTHROPIC_DEFAULT_MODEL`, `AIO_SEARCH_PARSE_MODEL`) → fallback (`claude-sonnet-4-6`). Never reintroduce hardcoded model strings.
- **Benchmarks**: Two saved prompts in `lib/benchmarks.ts` and `scripts/benchmark_prompt.txt`. Run via the R&D **Benchmark 1 / Benchmark 2** buttons (UI), or `BENCHMARK=1 pnpm dlx tsx scripts/measure_modes.ts` (CLI). The runners must stay in sync with each other.

## V4.5 — what changed since V4.4

V4.5 is a retrieval-quality + operability release. The four ChatAIO modes (Recall, Live, Broad, Raw) and the architecture they sit on are unchanged. What's new is the work needed to keep retrieval honest at scale and to give operators in-app controls for the things that previously required SQL.

### Retrieval correctness

- **Migration 029 — HSL inverted index population.** `ier_refresh_hsl()` was only parsing the element columns (which carry AIO row refs like `acc_rfis.csv - Row 162`, not `[Key.Value]` tokens). The actual bracket token lives in `hsl_data.hsl_name` (e.g. `[Project ID.PRJ-003].hsl`). Migration 029 extends the function to parse both and backfills every existing HSL. Before: cue-to-HSL probes returned 0. After: returned the right HSL set.
- **Cap-by-CSV diversity in the AIO ranker.** Both pipelines (frontend Recall in `lib/aio-math.ts`, backend Live in `infophysics_impl_grade/api/search_helpers.py`) used a flat top-N cap on the matched AIO list. On corpora dominated by one CSV (the demo is 80% AIA305), that flat cap filled with AIA305 records and starved the operational CSVs (acc_rfis, acc_issues, acc_submittals, acc_vendors, acc_cost_codes). Result: multi-CSV joins on a shared key failed silently with "no matching records." Both paths now bucket by `OriginalCSV` first and take a fair per-CSV share before back-filling from the highest-ranked leftovers. The frontend (`diversifyByCSV`) and backend (`diversify_by_csv`) implementations mirror each other.
- **HSL field-name aliasing.** `lib/hsl-aliases.ts` folds equivalent field names — `Project_ID`, `Project ID`, `Projects Assigned`, `Applicable Projects`, `Active Projects` — to a single canonical `Project` for cue matching. Frontend-only for V1 so the alias table can iterate without DB migrations; promote to the backend in a future migration once stable.
- **Pipeline error hardening.** `lib/aio-chat-pipeline.ts` and the chat dialog used to call `chatResponse.error.toLowerCase()` blindly, which crashed when the backend returned a JSON error envelope (the budget rate-limiter does this). Now coerced to a string via a shared `asErrorString()` helper at every error site.

### Operability

- **System Management → Models tab.** Runtime LLM model selection. Dropdowns for `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5` (any other valid SKU works too). Two slots: a default model (used by all four modes plus summarize / entity-resolution) and an optional parse-phase override for Live Search. Saved to `system_settings`, no restart needed. Resolution order: `system_settings` → env var → fallback. All ~22 hardcoded `model="claude-sonnet-4-6"` strings in `chat.py` now route through `get_default_model()` / `get_parse_model()`.
- **Daily Token Budget pane** (under the Models tab). Live progress bar showing `used_today / limit` with green/amber/red thresholds, plus inputs for per-tenant override and global default. Eliminates the "drop into psql to fix the budget" friction. Backed by `GET/PUT /v1/settings/budget`.
- **R&D → Benchmark 1 / Benchmark 2 buttons.** In-app full-screen benchmark runner with side-by-side metrics, verbatim replies for all four modes, and Print / Save-as-PDF. Prompts ship in `lib/benchmarks.ts` and `scripts/benchmark_prompt.txt`. CLI parity: `BENCHMARK=1 pnpm dlx tsx scripts/measure_modes.ts`.
- **References tab — embedded inline viewer.** The two Technical Reports and the Recall trace now open as full-screen pages instead of triggering .docx downloads. `mammoth` converts the .docx to HTML in the browser on click; the original .docx files still live in `public/docs/` for tooling.
- **Cache bypass on interactive Live Search.** `aioSearchChat` and `aioSearchChatStream` accept an opt-in `bypassCache: true` flag that appends `?bypass_cache=true` to the proxy URL. The chat dialog and benchmark runner pass `true` so users iterating through the UI never see a stale cached reply mask a deployed retrieval fix.

### UI polish

- **Edge-to-edge "Information Physics Standard Model" banner** on the home page. Spans the full viewport with a navy gradient and responsive type scale (text-3xl → text-7xl).
- **ChatAIO header recentered.** Title now centered with `font-serif` semibold at text-2xl/3xl. Five action buttons (Chat, PDF, Save MRO, View MROs, Guide) form a centered group below the title; Close pinned to the upper-right corner.

### Distribution

- **Electron code signing & notarization wired.** `electron/package.json` has `hardenedRuntime`, entitlements, and `notarize.teamId` (`P4CWP6XFVD`) configured. `electron/build/entitlements.mac.plist` carries the minimum entitlements needed for V8 JIT plus the embedded Python/Postgres binaries. `electron/.env.example` documents the `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` triple. The build degrades gracefully when `.env` is absent (unsigned DMGs as before). With `.env` present and a `Developer ID Application` cert in Keychain, `npm run dist` produces signed + notarized + stapled DMGs that launch with no Gatekeeper warning.
