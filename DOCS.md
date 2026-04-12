# Information Physics Demo System &mdash; Documentation

**Version 3.0** | InformationPhysics.ai

---

## Table of Contents

1. [Data Model](#data-model)
2. [API Reference](#api-reference)
3. [Frontend Architecture](#frontend-architecture)
4. [Backend Architecture](#backend-architecture)
5. [ChatAIO Search Modes](#chataio-search-modes)
6. [MRO Research Parser](#mro-research-parser)
7. [Storage System](#storage-system)
8. [System Administration](#system-administration)
9. [Database & Migrations](#database--migrations)
10. [Electron Desktop App](#electron-desktop-app)
11. [Development Patterns](#development-patterns)
12. [Deployment](#deployment)

---

## Data Model

The Information Physics Standard Model organizes data into three layers:

### Layer 1: Associated Information Objects (AIOs)

AIOs are self-describing observation objects stored in bracket notation:

```
[Name.Sarah Mitchell][Role.Project Manager][Department.Construction][Project.Highway Bridge]
```

Each AIO record supports up to **50 element columns** (`element_1` through `element_50`), plus metadata fields:

| Field | Type | Description |
|-------|------|-------------|
| `aio_id` | UUID | Primary key |
| `source_system` | text | Origin (e.g., `csv-converter`, `pdf-extract`) |
| `element_1..50` | text | Bracket-notation key-value pairs |
| `tenant_id` | text | Tenant partition key |
| `created_at` | timestamptz | Creation timestamp |

### Hyper-Semantic Layer (HSLs)

HSLs are precomputed relational pointer tables that link AIOs through shared information elements:

| Field | Type | Description |
|-------|------|-------------|
| `hsl_id` | UUID | Primary key |
| `hsl_name` | text | Descriptive name |
| `element_1..100` | text | Element slots linking to AIO elements |
| `source_system` | text | Origin identifier |
| `tenant_id` | text | Tenant partition key |

HSLs enable the four-phase AIO Search by providing pre-indexed relationships between data objects.

### Layer 2: Memory Result Objects (MROs)

MROs persist complete retrieval episodes from ChatAIO sessions:

| Field | Type | Description |
|-------|------|-------------|
| `mro_id` | UUID | Primary key |
| `mro_key` | text | Human-readable key (e.g., `HSL-3-AIO-47`) |
| `query_text` | text | Original user query |
| `intent` | text | Parsed intent |
| `seed_hsls` | text | HSLs that seeded the search |
| `matched_aios_count` | integer | Number of AIOs matched |
| `search_terms` | JSONB | Structured search terms |
| `result_text` | text | AI-generated result |
| `context_bundle` | text | Full bracket-notation context |
| `confidence` | text | Confidence level |
| `policy_scope` | text | Access scope |

### Information Elements

The element registry tracks all unique `[Key.Value]` pairs discovered across AIOs:

| Field | Type | Description |
|-------|------|-------------|
| `element_id` | UUID | Primary key |
| `element_key` | text | The key portion (e.g., `Name`) |
| `element_value` | text | The value portion (e.g., `Sarah Mitchell`) |
| `aio_id` | UUID | Source AIO reference |
| `element_position` | integer | Position within the AIO |

### Field Maps

AI-generated mappings from CSV column headers to standard element keys:

| Field | Type | Description |
|-------|------|-------------|
| `field_map_id` | UUID | Primary key |
| `source_column` | text | Original CSV header |
| `target_element` | text | Mapped element key |
| `confidence` | float | AI confidence score |

---

## API Reference

All endpoints are served by the FastAPI backend at `/v1/`. The Next.js frontend proxies through `app/api/` routes.

### CRUD Resources

| Resource | Endpoint | Methods |
|----------|----------|---------|
| AIOs | `/v1/aio-data` | GET, POST, PUT, DELETE |
| HSLs | `/v1/hsl-data` | GET, POST, PUT, DELETE |
| MROs | `/v1/mro-objects` | GET, POST, PUT, DELETE |
| Info Elements | `/v1/information-elements` | GET, POST, DELETE |
| Field Maps | `/v1/field-maps` | GET, POST, DELETE |
| Saved Prompts | `/v1/saved-prompts` | GET, POST, PUT, DELETE |
| Users | `/v1/users` | GET, POST, PUT, DELETE |
| Roles | `/v1/roles` | GET, POST, PUT, DELETE |
| Information Objects | `/v1/io` | GET, POST, PUT, DELETE |

### AI Operations

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/op/chat` | POST | Broad search &mdash; sends all AIOs as context to Claude |
| `/v1/op/aio-search` | POST | Four-phase search algebra |
| `/v1/op/pdf-extract` | POST | PDF-to-CSV extraction via Claude AI |
| `/v1/op/summarize` | POST | Text summarization |
| `/v1/op/resolve-entities` | POST | Entity resolution across AIOs |
| `/v1/op/generate-field-maps` | POST | AI-generated column-to-element mappings |

### System

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/health` | GET | Health check |
| `/v1/settings/apikey` | GET, PUT | Anthropic API key management |
| `/v1/settings/storage` | GET, PUT | Storage directory configuration |

### Query Parameters

Most list endpoints support:

- `?limit=N` &mdash; Maximum records to return (default: 200)
- `?offset=N` &mdash; Pagination offset
- `?source_system=X` &mdash; Filter by source system

### Headers

- `X-Tenant-Id` &mdash; Tenant identifier for RLS isolation (default: `tenantA`)
- `Content-Type: application/json` &mdash; Required for POST/PUT

---

## Frontend Architecture

### Single-Page Application

The entire UI is rendered from `app/page.tsx` with persistent sidebar navigation (`components/app-sidebar.tsx`). Major views:

| View | Component | Description |
|------|-----------|-------------|
| Dashboard | `components/dashboard.tsx` | Live metrics with AIO/HSL/MRO/IE/FM counts |
| CSV Converter | `app/page.tsx` (inline) | Upload, preview, convert CSV to AIOs |
| HSL Builder | `app/page.tsx` (inline) | Create/edit HSL records |
| ChatAIO | `components/chat-aio-dialog.tsx` | Full-screen AI search dialog |
| R&D | `app/page.tsx` (inline) | Compound HSL builder |
| System Admin | `components/system-management.tsx` | 12-tab admin panel |
| User Guide | `components/user-guide.tsx` | In-app documentation |
| Workflow | `app/page.tsx` (inline) | Process workflow reference |
| Reference | `components/reference-page.tsx` | Academic papers and standards |

### UI Component Library

Built on **shadcn/ui** (Radix primitives + Tailwind):

- 59 components in `components/ui/`
- Design tokens: navy (`#0f3460`) primary, slate grays, amber accents
- Responsive layout with collapsible sidebar

### API Client (`lib/api-client.ts`)

Typed fetch wrappers for every backend endpoint. Each function:
- Uses relative URLs (proxied through Next.js API routes)
- Returns typed responses matching backend schemas
- Handles errors with toast notifications

Key interfaces: `AioData`, `HslData`, `MroObject`, `InformationElement`, `FieldMap`, `SavedPrompt`

---

## ChatAIO Search Modes

### Broad Search

Sends the entire AIO dataset as context to Claude AI for open-ended queries.

```
User Query → Fetch all AIOs → Build context → Claude generates response → Display result
```

### AIO Search (Four-Phase Algebra)

Structured retrieval using the HSL relational layer:

1. **Parse** &mdash; Extract search terms and intent from the user query
2. **Match HSLs** &mdash; Find HSL records with matching elements
3. **Gather AIOs** &mdash; Collect all AIOs linked through matched HSLs
4. **Synthesize** &mdash; Send matched AIOs to Claude with the original query

The response includes a **context bundle** in bracket notation:

```
[MROKey.HSL-3-AIO-47][Query.Tell me about Sarah]
[Result.**Full Name:** Sarah Mitchell ...]
[SearchTerms.{"terms":["sarah"]}][SeedHSLs.3 HSLs]
[MatchedAIOs.47][Confidence.derived][Timestamp.2026-...]
```

### MRO Save

After any search, users can save the complete retrieval episode as an MRO, preserving query, result, search terms, matched counts, and the full context bundle for later analysis.

---

## MRO Research Parser

The research parser (`lib/mro-research-parser.ts`) extracts structured data from MRO context bundles into seven tables:

| Table | Content |
|-------|---------|
| `metadata` | MRO key, query, search terms, timestamps |
| `employee_profile` | Parsed `**Key:** value` employee data |
| `projects` | Project blocks (`### PRJ-NNN &mdash; Name`) |
| `issues_observations` | Issues/observations markdown tables |
| `rfis` | RFI markdown tables |
| `submittals` | Submittal markdown tables |
| `invoices` | Financial/invoice markdown tables |

### Derived Research Objects

When an MRO has no context bundle (or the bundle contains no structured tables), the system builds a **Derived Research Object** via best-effort extraction from `result_text`:

- **Key Facts** &mdash; Parsed from `**Label:** value` and bare `Key: value` patterns
- **Sections** &mdash; Extracted from `##` and `###` markdown headings
- **Raw Result** &mdash; Normalized full result text
- **Opportunistic Tables** &mdash; The standard 7-table parsers also run against result text

The research dialog displays a yellow banner indicating derived mode and offers:
- Download JSON (full structured payload)
- Download Text (human-readable report)
- Print PDF (formatted HTML report)

---

## Storage System

### Storage Adapter (`lib/storage-adapter.ts`)

A three-tier adapter pattern with runtime mechanism detection:

1. **Electron IPC** &mdash; Direct filesystem access via `ipcMain.handle` / `contextBridge`
2. **File System Access API** &mdash; Chromium-only, uses directory handle persistence in IndexedDB
3. **Downloads Fallback** &mdash; Creates a Blob URL and triggers browser download

### Storage Settings

Configurable per-directory storage for four data types:

| Key | Default | Description |
|-----|---------|-------------|
| `aio_dir` | `~/AIO_System/aios` | AIO export directory |
| `hsl_dir` | `~/AIO_System/hsls` | HSL export directory |
| `mro_dir` | `~/AIO_System/mros` | MRO export directory |
| `pdf_dir` | `~/AIO_System/pdfs` | PDF output directory |

Settings are persisted in the `system_settings` PostgreSQL table and managed via the Storage Settings tab in System Admin.

---

## System Administration

The admin panel (`components/system-management.tsx`) provides 12 tabs:

| Tab | Description |
|-----|-------------|
| Users | CRUD user management |
| Roles | Role-based access control |
| AIO Data | Browse, edit, delete AIOs with full-width editor |
| HSL Data | Browse, edit HSL records |
| API Key | Configure Anthropic API key |
| Saved CSVs | View CSVs from converter and bulk processing |
| Saved AIOs | View generated AIO records |
| Saved Prompts | Manage reusable ChatAIO prompts |
| Info Elements | Browse element registry with counts |
| Architecture | System architecture reference |
| Storage Settings | Configure file export directories |
| Saved MROs | View/download/print/research MRO records |

### Saved MROs Actions

Each MRO in the Saved MROs tab has five action buttons:

- **View** &mdash; Full MRO detail dialog with formatted sections
- **Research** &mdash; Parse context bundle into structured tables (or build Derived Research Object)
- **Download** &mdash; Save as `.mro` text file
- **Print** &mdash; Generate formatted PDF via print dialog
- **Delete** &mdash; Remove from database (with confirmation)

---

## Database & Migrations

### PostgreSQL 15

- **Row-Level Security (RLS)** enforces tenant isolation per request
- Tenant set via `SET LOCAL app.tenant_id` in middleware
- Default tenant: `tenantA`

### Migration Files

Located in `infophysics_impl_grade/migrations/`, applied in numeric order by `start.sh`:

| File | Purpose |
|------|---------|
| `000_extensions.sql` | PostgreSQL extensions (uuid-ossp, etc.) |
| `001_base_tables.sql` | Core tables: aio_data, hsl_data, mro_objects |
| `002_indexes.sql` | Performance indexes |
| `003_rls.sql` | Row-Level Security policies |
| `004_information_elements.sql` | Element registry table |
| `005_information_objects.sql` | IO registry |
| `006_saved_prompts.sql` | Saved prompts table |
| `007_users_roles.sql` | Users and roles tables |
| `008_system_settings.sql` | Key-value settings table |
| `009_field_maps.sql` | AI field map storage |
| `010_mro_context_bundle.sql` | Context bundle column on MROs |
| `011_element_key_index.sql` | Element key indexing |
| `012_storage_default_dirs.sql` | Default storage directory values |
| `013_storage_settings.sql` | Storage settings seed data |

All migrations use `IF NOT EXISTS` for idempotency.

---

## Electron Desktop App

### Architecture

```
electron/main.js (Main Process)
  ├── Spawns PostgreSQL (bundled)
  ├── Spawns Python/uvicorn (bundled)
  ├── Creates BrowserWindow → loads Next.js standalone
  └── IPC handlers for filesystem operations

electron/preload.js (Renderer Bridge)
  └── contextBridge.exposeInMainWorld('electronAPI', { ... })
```

### Build Requirements

- macOS: Xcode command-line tools
- Bundled binaries in `electron/resources/`: Python 3.12, PostgreSQL 16
- Build via `scripts/build-resources.sh` then `npm run dist`

### IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `save-file` | Renderer &rarr; Main | Save file to configured directory |
| `read-dir` | Renderer &rarr; Main | List directory contents |
| `get-storage-path` | Renderer &rarr; Main | Get storage directory for a type |

---

## Development Patterns

### Adding a New API Endpoint

1. Add FastAPI route in `infophysics_impl_grade/api/main.py`
2. Create Next.js proxy in `app/api/{name}/route.ts`
3. Add typed client function in `lib/api-client.ts`

### Adding a System Admin Tab

1. Add `TabsTrigger` in the admin panel tab list
2. Add `TabsContent` with a new pane component
3. Create the pane function in `system-management.tsx`

### Adding a SQL Migration

1. Create numbered file: `infophysics_impl_grade/migrations/NNN_description.sql`
2. Use `IF NOT EXISTS` / `DO $$ ... $$` for idempotency
3. Migrations run automatically on backend startup via `start.sh`

### Version String

Update the version number in these locations:
- `app/layout.tsx`
- `app/page.tsx`
- `components/chat-aio-dialog.tsx`
- `components/user-guide.tsx`
- `components/system-management.tsx`

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_BASE` | `http://localhost:8080` | Backend URL |
| `DATABASE_URL` | &mdash; | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | &mdash; | Claude AI API key (or set via admin UI) |

---

## Deployment

### Railway

Both services auto-deploy when commits are pushed to `main`:

- **Frontend Service**: Builds from project root using `railway.toml`
  - Healthcheck: `GET /`
  - Build: `pnpm build` &rarr; standalone output
- **Backend Service**: Builds from `infophysics_impl_grade/` subdirectory
  - Healthcheck: `GET /v1/health`
  - Build: Docker image from `Dockerfile`
  - Migrations run on startup

### GitHub Repository

`msbodner/information-physics-demo-system` &mdash; `main` branch

### Docker Compose (Local)

```bash
docker compose up --build
```

Starts PostgreSQL, backend, and frontend containers with health checks and automatic migration application.
