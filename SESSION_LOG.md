# AIO Generator V1.1 — Full Development Session Log

**Date:** March 2026
**Repository:** `v0-information-physics-aio-processor`
**Deployment:** Railway (project `aio-processor`)
**Stack:** Next.js 16 (Turbopack) + FastAPI + PostgreSQL 15 + Anthropic Claude Sonnet 4.6

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Session 1 — Initial Build & Railway Deployment](#3-session-1--initial-build--railway-deployment)
4. [Session 2 — HSL Enhancements, Backend Fixes & ChatAIO](#4-session-2--hsl-enhancements-backend-fixes--chataio)
5. [Session 3 — System Management, User CRUD & CSV Viewer](#5-session-3--system-management-user-crud--csv-viewer)
6. [Session 4 — CSV Display Fixes & Row Detail Modal](#6-session-4--csv-display-fixes--row-detail-modal)
7. [Session 5 — Login Gate, Saved CSVs & Saved AIOs in System Management](#7-session-5--login-gate-saved-csvs--saved-aios-in-system-management)
8. [Database Schema](#8-database-schema)
9. [API Endpoints](#9-api-endpoints)
10. [Key Files Reference](#10-key-files-reference)
11. [Railway Deployment Reference](#11-railway-deployment-reference)
12. [Commit History](#12-commit-history)

---

## 1. Project Overview

The **AIO Generator V1.1** converts CSV files into **Associated Information Objects (AIOs)** — the fundamental unit of information in the Information Physics Standard Model.

### AIO Format

Each CSV row becomes a single-line AIO string:

```
[OriginalCSV.filename.csv][FileDate.2024-01-15][FileTime.10:00:00][Column1.Value1][Column2.Value2]...
```

### HSL (Hyper-Semantic Layer)

A `.hsl` file lists all AIOs that share a selected semantic element, enabling cross-document semantic discovery:

```
Filename: [Vendor.Acme Corp].hsl
Contents: all AIO lines where [Vendor.Acme Corp] appears
```

### Key Concepts

| Term | Description |
|------|-------------|
| AIO | Associated Information Object — single bracketed key-value line |
| HSL | Hyper-Semantic Layer — file grouping AIOs by shared element |
| Semantic Processor | UI for browsing, summarizing, and extracting entities from AIOs |
| ChatAIO | Natural-language chatbot that queries stored AIOs/HSLs via Claude |

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Next.js Frontend                       │
│  app/page.tsx          — main SPA (home/converter/       │
│                           processor/sysadmin views)      │
│  components/           — SemanticProcessor, ConversionPreview,│
│                           SystemManagement, FileUpload    │
│  app/api/              — proxy routes to FastAPI          │
│  lib/api-client.ts     — typed fetch wrappers            │
└────────────────┬────────────────────────────────────────┘
                 │  HTTP  (X-Tenant-Id header)
┌────────────────▼────────────────────────────────────────┐
│              FastAPI Backend (Python)                    │
│  infophysics_impl_grade/api/main.py                     │
│  • /v1/health          • /v1/io (CRUD)                  │
│  • /v1/op/summarize    • /v1/op/resolve-entities        │
│  • /v1/op/chat         • /v1/users (CRUD)               │
│  • /v1/settings/apikey                                  │
└────────────────┬────────────────────────────────────────┘
                 │  psycopg3 + RLS (app.tenant_id)
┌────────────────▼────────────────────────────────────────┐
│           PostgreSQL 15 (Railway managed)               │
│  information_objects   users   system_settings          │
│  tenants   entities   io_links   derivation_events …    │
└─────────────────────────────────────────────────────────┘
```

### Multi-Tenancy

- Every request carries `X-Tenant-Id` header (default: `tenantA`)
- FastAPI sets `SET LOCAL app.tenant_id = '<id>'` before each query
- PostgreSQL Row-Level Security policies enforce isolation at the DB layer

### Data Storage

AIO, HSL, and CSV content is stored as data URIs inside `information_objects.raw->>'raw_uri'`:

| Type | URI scheme | Example |
|------|-----------|---------|
| AIO  | `data:text/aio,<encoded>` | `data:text/aio,%5BOriginalCSV...%5D` |
| HSL  | `data:text/hsl,<encoded>` | `data:text/hsl,...` |
| CSV  | `data:text/csv,<encoded>` | `data:text/csv,col1%2Ccol2%0A...` |

---

## 3. Session 1 — Initial Build & Railway Deployment

### What was built

- CSV → AIO conversion engine (client-side, `parseCSV` + `csvToAio`)
- `SemanticProcessor` component with:
  - Per-element semantic clustering
  - HSL file creation and download
  - AI summarization via Claude
  - Entity extraction with confidence scores
- Full-stack FastAPI backend with PostgreSQL
- Railway monorepo deployment (frontend + backend + Postgres)

### Railway Infrastructure Setup

```
Project:     aio-processor
Environment: production (698762c4-abfb-467a-aa0e-369628e1eb21)

Services:
  aio-processor   7cfbae6b-3d76-4277-aeca-8b513cf078c3  (Next.js frontend)
  infophysics-api 86e2b84b-bee9-48ea-b953-6efda19cd91a  (FastAPI backend)
  postgres        b6e817d0-704e-4376-bc14-bb7c33921d03  (Railway Postgres)
```

### Key Fixes

- **Railway build failure — RLS policy duplicate:** `CREATE POLICY` crashed on existing DB.
  Fix: Wrapped all 15 policies in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;`

- **Backend not loading ANTHROPIC_API_KEY:** System Python 3.9 was used instead of venv.
  Fix: Updated `launch.json` to use `.venv/bin/python -m uvicorn` with `set -a && . .env && set +a`

---

## 4. Session 2 — HSL Enhancements, Backend Fixes & ChatAIO

### Features Delivered

#### HSL Naming Convention
HSL files are now named using the selected element's key and value:
```
[Vendor.Acme Corp].hsl
```
Previously unnamed/generic filenames.

#### HSL Saved to PostgreSQL
After HSL creation, a fire-and-forget `createIO()` call saves the HSL as a `type: "HSL"` record with `source_system: "csv-converter"`.

#### "View HSL Database" Button
In the SemanticProcessor header — opens a Dialog listing all saved HSL records grouped by source file, with full content expandable.

#### "View Saved AIOs" Button
In the converter view — opens a Dialog with two tabs:
- **AIOs tab:** AIO records grouped by source CSV filename
- **CSV Files tab:** File cards reconstructed from AIO records (see Session 3)

#### CSV Saved to PostgreSQL
When AIOs are saved, the original CSV is also saved as `type: "CSV"`:
```typescript
createIO({
  type: "CSV",
  raw: { raw_uri: `data:text/csv,${encodeURIComponent(csvText)}`, mime_type: "text/csv", size_bytes: csvText.length },
  context: { source_system: "csv-converter", source_object_id: file.originalName },
})
```

#### V1.1 Title Updates
All "AIO Generator" text across all pages updated to "AIO Generator V1.1":
- `app/layout.tsx` metadata title
- All heading and header instances in `app/page.tsx`

#### ChatAIO — Chatbot Modal

**Frontend (`components/conversion-preview.tsx`):**
- "ChatAIO" button in the action row (visible when backend is online)
- Opens a full Dialog with:
  - Scrollable message bubbles (user = blue right-aligned, assistant = gray left-aligned)
  - Starter prompt chips: "Total invoice amount by vendor", "List all unique vendors", etc.
  - Auto-scroll to latest message via `useRef`/`useEffect`
  - Enter-key send support

**Backend (`infophysics_impl_grade/api/main.py` — `POST /v1/op/chat`):**
```python
# Fetches up to 500 AIO/HSL/CSV records for the tenant
# Builds system prompt with up to 300 AIO lines as context
# Calls claude-sonnet-4-6 with max_tokens=2048
# Returns { reply, model_ref, context_records }
```

**Next.js proxy (`app/api/op/chat/route.ts`):**
- Forwards to `${API_BASE}/v1/op/chat` with `X-Tenant-Id` header
- 60-second timeout with `AbortController`

**API client (`lib/api-client.ts`):**
```typescript
export async function chatWithAIO(messages: ChatMessage[]): Promise<ChatResponse | null>
```

---

## 5. Session 3 — System Management, User CRUD & CSV Viewer

### Features Delivered

#### System Management Page

Accessible via **"System"** button in the top-right header. Full-screen page with tabbed interface:

**Tab 1 — User Management**
| Field | Type | Notes |
|-------|------|-------|
| username | text | Required |
| email | text | Unique, required |
| password | bcrypt hash | Required on create |
| role | enum | "System Admin" or "General User" |
| is_active | boolean | Toggle in edit dialog |
| created_at | timestamp | Auto-set |

- Add / Edit / Delete dialogs with validation
- Delete confirmation dialog
- Role badges: System Admin (primary) vs General User (secondary)
- Active/Inactive status badges

**Default seed user (created on first backend startup):**
```
Username: Michael Bodner
Email:    bodner.michael@gmail.com
Role:     System Admin
```

**Tab 2 — API Key Settings**
- Shows current masked key: `sk-ant-...xxxx`
- Input field to update key (stored in `system_settings` table)
- Validates `sk-` prefix before saving
- Takes effect immediately without redeploy (backend reads from DB at request time)

#### Backend — Users API

New endpoints added to `infophysics_impl_grade/api/main.py`:

```
GET    /v1/users              List all users
POST   /v1/users              Create user (bcrypt hashes password)
PATCH  /v1/users/{id}         Update user fields
DELETE /v1/users/{id}         Soft-delete (sets is_active=false) or hard delete
GET    /v1/settings/apikey    Get masked API key status
PATCH  /v1/settings/apikey    Update API key (writes env + DB)
```

#### Database Tables

**`users` table (`004_users.sql`):**
```sql
CREATE TABLE IF NOT EXISTS users (
  user_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username   TEXT NOT NULL,
  email      TEXT UNIQUE NOT NULL,
  password   TEXT NOT NULL,              -- bcrypt hash
  role       TEXT NOT NULL DEFAULT 'General User',
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**`system_settings` table:**
```sql
CREATE TABLE IF NOT EXISTS system_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### Next.js API Proxy Routes

```
app/api/users/route.ts          — GET + POST /api/users
app/api/users/[id]/route.ts     — PATCH + DELETE /api/users/:id
app/api/settings/apikey/route.ts — GET + PATCH /api/settings/apikey
```

#### API Client Functions

```typescript
listUsers(): Promise<SystemUser[]>
createUser(payload): Promise<SystemUser | null>
updateUser(id, updates): Promise<SystemUser | null>
deleteUser(id): Promise<boolean>
getApiKeySetting(): Promise<{ configured: boolean; masked: string | null } | null>
updateApiKeySetting(key: string): Promise<{ ok: boolean } | null>
```

#### CSV File Viewer — "View Saved AIOs" Dialog

**Problem:** The CSV tab showed 0 records because files processed before the CSV-saving feature was added only have AIO-type records in the DB.

**Solution:**
1. CSVs tab now shows **file cards** built from AIO records (works for all historical data)
2. Each card shows filename, row count, column count
3. Clicking a card opens a **CSV Preview Modal** with a full spreadsheet-style table
4. Logic prioritizes saved CSV records if available; otherwise reconstructs from AIO lines

**AIO → CSV Reconstruction:**
```typescript
function reconstructCsvFromAios(records: IORecord[]): { headers: string[]; rows: string[][] } {
  const META_KEYS = new Set(["OriginalCSV", "FileDate", "FileTime"])
  // Parse each AIO line → skip metadata keys → build header/row table
}
```

The `parseAioLine()` function (already in codebase) handles the bracket parsing:
```
[Vendor.Acme][Amount.500][Date.2024-01-01]
→ { Vendor: "Acme", Amount: "500", Date: "2024-01-01" }
```

**CSV Preview Modal:**
- Full `max-w-5xl` Dialog
- Sticky header row with column names
- Striped rows with hover highlight
- Row number column
- Cell truncation with full-value `title` tooltip
- Footer showing `N rows · M columns`

---

## 6. Session 4 — CSV Display Fixes & Row Detail Modal

### Problems Fixed

#### 1. CSV Table Always Blank After "Load Saved AIOs"

**Root cause:** `handleLoadFromBackend()` in `app/page.tsx` reconstructed `ConvertedFile` objects with hardcoded `csvData: []` and `headers: []`. The AIO lines were decoded but never parsed back into tabular form, so the CSV Data table always showed 0 rows.

**Fix:** Groups raw `IORecord[]` objects per source file and passes them to `reconstructCsvFromAios()`, which parses each AIO's bracket key-value pairs (skipping `OriginalCSV`, `FileDate`, `FileTime` metadata fields) to rebuild the full header/row table. `FileDate` and `FileTime` are also extracted from the first AIO line so the AIO breakdown section shows correct metadata.

```typescript
// Before (broken)
const reconstructed = Array.from(grouped.entries()).map(([name, aioLines]) => ({
  originalName: name, csvData: [], headers: [], aioLines, fileDate: "", fileTime: "",
}))

// After (fixed)
const reconstructed = Array.from(groupedRecs.entries()).map(([name, recs]) => {
  const aioLines = recs.map(r => decodeUri(r.raw.raw_uri))
  const { headers, rows } = reconstructCsvFromAios(recs)           // ← parses AIO brackets
  const fileDate = aioLines[0]?.match(/\[FileDate\.([^\]]+)\]/)?.[1] ?? ""
  const fileTime = aioLines[0]?.match(/\[FileTime\.([^\]]+)\]/)?.[1] ?? ""
  return { originalName: name, csvData: rows, headers, aioLines, fileDate, fileTime }
})
```

#### 2. Only One Row Stored Per CSV File (Database Constraint Bug)

**Root cause:** `001_base_tables.sql` created a `UNIQUE(tenant_id, source_system, source_object_id)` constraint on `information_objects`. Since every AIO row from the same CSV file shares the same `source_object_id` (the filename), the database rejected every row after the first with a constraint violation. The frontend's `safeFetch()` swallowed these errors silently, making it appear that saving worked.

**Fix:** Migration `005_fix_aio_dedup.sql` idempotently drops both over-broad constraints:

```sql
-- uq_io_source: blocks all rows after row 1 per file
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_io_source') THEN
    ALTER TABLE information_objects DROP CONSTRAINT uq_io_source;
  END IF;
END $$;

-- uq_io_dedupe_hash: raw_hash is never populated, safe to remove
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_io_dedupe_hash') THEN
    ALTER TABLE information_objects DROP CONSTRAINT uq_io_dedupe_hash;
  END IF;
END $$;
```

After this migration, re-uploading a CSV saves all rows and `Load Saved AIOs` correctly reconstructs the full table.

#### 3. Row Click Modal Added

Clicking any row in the CSV Data table now opens a **Row Detail Modal** with three sections:

| Section | Content |
|---------|---------|
| **CSV Data** | Full Field → Value table, all columns, no truncation, alternating shading |
| **AIO Elements** | Colour-coded chips: blue for metadata (`OriginalCSV`, `FileDate`, `FileTime`), gray for data fields |
| **Full AIO String** | Monospace block, `select-all` CSS for easy one-click copy |

The AIO Output box in the main view also updates to the clicked row simultaneously (both views stay in sync via shared `selectedRowIndex` state).

#### 4. "View Saved AIOs" Dialog — CSV Files Tab

The CSV Files tab (in the `View Saved AIOs` dialog) was rebuilt in this session:
- **File cards grid** built from AIO records — works even if no CSV-type records were ever saved
- Each card shows filename + AIO row count + "Click to view data" hint
- **Clicking a card** opens a full spreadsheet-style preview modal:
  - Sticky column headers
  - Striped rows with hover highlight
  - Row number column
  - Cell truncation with `title` tooltip showing full value
  - Footer: `N rows · M columns`
- If a saved CSV-type record exists for the file it is used directly; otherwise the table is reconstructed from AIO lines

### Commits in This Session

| Hash | Description |
|------|-------------|
| `5ff9d60` | Fix: drop uq_io_source constraint that blocked multi-row CSV saves |
| `0bb51ea` | Fix CSV data display and add row detail modal |
| `893b027` | Replace CSV tab with clickable file cards and add CSV data preview modal |

---

## 7. Session 5 — Login Gate, Saved CSVs & Saved AIOs in System Management

### Features Added

#### 1. System Management Login Gate

The System Management page now requires authentication before any content is shown.

**Flow:**
1. User clicks "System Management" → sees `LoginGateScreen` (full-page form)
2. Enters email + password → client POSTs to `/api/auth/login` → proxied to `POST /v1/auth/login`
3. Backend queries `users` table, verifies bcrypt hash, returns `{ user_id, username, email, role }`
4. If `role !== "System Admin"` (case-insensitive) → error: "Access denied. Your role does not have System Admin privileges."
5. On success → `authedUser` state set → full SystemManagement UI rendered
6. Header shows logged-in username + "Sign Out" button that clears `authedUser` state

**Backend endpoint added (`infophysics_impl_grade/api/main.py`):**
```python
@app.post("/v1/auth/login", response_model=LoginOut)
def login(payload: LoginRequest):
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT user_id, username, email, role, password_hash FROM users "
                "WHERE email = %s AND is_active = true",
                (payload.email,),
            )
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not bcrypt.checkpw(payload.password.encode(), row[4].encode()):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return LoginOut(user_id=row[0], username=row[1], email=row[2], role=row[3])
```

**Next.js proxy (`app/api/auth/login/route.ts`):**
```typescript
export async function POST(request: NextRequest) {
  const body = await request.json()
  const res = await fetch(`${API_BASE}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
```

**API client (`lib/api-client.ts`):**
```typescript
export async function loginUser(email, password): Promise<{ user: LoginResult | null; error: string | null }> {
  const res = await fetch("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) })
  if (res.status === 401) return { user: null, error: "Invalid email or password" }
  if (!res.ok) return { user: null, error: "Backend unavailable" }
  return { user: await res.json(), error: null }
}
```

#### 2. Saved CSVs Browser Tab

New **"Saved CSVs"** tab in System Management (4th tab, after API Key Settings):

- Loads all `type=CSV` `source_system=csv-converter` records via `listIOs()`
- Displays as a **responsive card grid** (1–3 columns depending on viewport)
- Each card shows: filename, save timestamp, file size (formatted KB/MB)
- Clicking a card opens a **full spreadsheet preview modal** (`max-w-5xl`):
  - Parses `data:text/csv,…` URI on the fly with a custom CSV tokenizer (handles quoted commas)
  - Sticky column header row
  - Striped rows with hover highlight
  - Footer: `N rows · M columns · saved <timestamp>`
- "Refresh" button to reload from backend
- Empty state with `FileSpreadsheet` icon and helpful hint text

#### 3. Saved AIOs Browser Tab

New **"Saved AIOs"** tab in System Management (5th tab):

- Loads all `type=AIO` `source_system=csv-converter` records (limit 500) via `listIOs()`
- Groups records by `source_object_id` (original filename), sorted by newest first
- Displays as the same **responsive card grid** style
- Each card shows: filename, record count ("N AIO records"), save timestamp
- Clicking a card opens an **AIO Lines Modal** (`max-w-3xl`) showing:
  - Each AIO line in a monospace block with line number prefix
  - `break-all` wrapping for long AIO strings
- "Refresh" button to reload from backend
- Empty state with `FileText` icon and helpful hint text

### Component Architecture

```
SystemManagement (system-management.tsx)
├── LoginGateScreen          ← shown when authedUser === null
│   ├── Email input
│   ├── Password input (show/hide toggle)
│   └── Error message
└── Main UI (shown after successful System Admin login)
    ├── Header (username + Sign Out)
    └── Tabs
        ├── UserManagementPane   (existing)
        ├── ApiKeyPane           (existing)
        ├── SavedCsvsPane        (NEW)
        └── SavedAiosPane        (NEW)
```

### Commit in This Session

| Hash | Description |
|------|-------------|
| `c2afb4a` | Add login gate, Saved CSVs, and Saved AIOs to System Management |

---

## 8. Database Schema

> **Note:** Migration `005_fix_aio_dedup.sql` dropped `uq_io_source` and `uq_io_dedupe_hash` constraints. The schema below reflects the current post-migration state.

### `information_objects` (core AIO storage)

```sql
io_id           UUID PRIMARY KEY
tenant_id       UUID NOT NULL  -- RLS enforced
type            TEXT           -- 'AIO', 'HSL', 'CSV'
raw_uri         TEXT           -- data: URI containing content
raw_hash        TEXT           -- SHA-256 for deduplication
mime_type       TEXT
size_bytes      BIGINT
source_system   TEXT           -- e.g. 'csv-converter'
source_object_id TEXT          -- original filename
is_deleted      BOOLEAN DEFAULT FALSE
created_at      TIMESTAMPTZ DEFAULT now()
```

### `users`

```sql
user_id    UUID PRIMARY KEY
username   TEXT NOT NULL
email      TEXT UNIQUE NOT NULL
password   TEXT NOT NULL          -- bcrypt $2b$12$...
role       TEXT DEFAULT 'General User'
is_active  BOOLEAN DEFAULT TRUE
created_at TIMESTAMPTZ DEFAULT now()
updated_at TIMESTAMPTZ DEFAULT now()
```

### `system_settings`

```sql
key        TEXT PRIMARY KEY   -- e.g. 'anthropic_api_key'
value      TEXT NOT NULL
updated_at TIMESTAMPTZ DEFAULT now()
```

### `tenants`, `policy_scopes`, `entities`, `io_links`, `derivation_events`
See `infophysics_impl_grade/migrations/001_base_tables.sql` for full schema.

---

## 9. API Endpoints

### FastAPI Backend (port 8000 / Railway)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/health` | Health check → `{"status": "ok"}` |
| POST | `/v1/io` | Create Information Object (AIO/HSL/CSV) |
| GET | `/v1/io` | List IOs (filter by type, source_system, date) |
| GET | `/v1/io/{id}` | Get single IO |
| POST | `/v1/op/summarize` | AI summarization of AIO texts |
| POST | `/v1/op/resolve-entities` | Entity extraction from AIO text |
| POST | `/v1/op/chat` | ChatAIO — natural language Q&A over stored AIOs |
| GET | `/v1/users` | List all users |
| POST | `/v1/users` | Create user |
| PATCH | `/v1/users/{id}` | Update user |
| DELETE | `/v1/users/{id}` | Delete user |
| POST | `/v1/auth/login` | Login — verifies bcrypt password, returns `{ user_id, username, email, role }` or 401 |
| GET | `/v1/settings/apikey` | Get API key status (masked) |
| PATCH | `/v1/settings/apikey` | Update API key |

### Next.js API Routes (proxy layer)

| Path | Proxies to |
|------|-----------|
| `/api/health` | `GET /v1/health` |
| `/api/io` | `GET/POST /v1/io` |
| `/api/io/[id]` | `GET /v1/io/{id}` |
| `/api/op/summarize` | `POST /v1/op/summarize` |
| `/api/op/resolve-entities` | `POST /v1/op/resolve-entities` |
| `/api/op/chat` | `POST /v1/op/chat` |
| `/api/users` | `GET/POST /v1/users` |
| `/api/users/[id]` | `PATCH/DELETE /v1/users/{id}` |
| `/api/auth/login` | `POST /v1/auth/login` |
| `/api/settings/apikey` | `GET/PATCH /v1/settings/apikey` |

---

## 10. Key Files Reference

### Frontend

| File | Purpose |
|------|---------|
| `app/page.tsx` | Main SPA — all views, state, dialogs |
| `app/layout.tsx` | Root layout, metadata title |
| `components/conversion-preview.tsx` | CSV/AIO preview + ChatAIO modal |
| `components/system-management.tsx` | System Management page (users + API key) |
| `components/file-upload.tsx` | Drag-and-drop CSV uploader |
| `components/backend-status-badge.tsx` | Online/offline indicator |
| `lib/api-client.ts` | All typed API call functions |
| `hooks/use-backend-status.ts` | Polls `/api/health` every 30s |
| `app/api/op/chat/route.ts` | Chat proxy with 60s timeout |
| `app/api/auth/login/route.ts` | Auth proxy — forwards to `POST /v1/auth/login` |

### Backend

| File | Purpose |
|------|---------|
| `infophysics_impl_grade/api/main.py` | All FastAPI endpoints |
| `infophysics_impl_grade/migrations/000_extensions.sql` | pgcrypto extension |
| `infophysics_impl_grade/migrations/001_base_tables.sql` | Core 14-table schema |
| `infophysics_impl_grade/migrations/002_indexes.sql` | Performance indexes |
| `infophysics_impl_grade/migrations/003_rls.sql` | Row-Level Security policies |
| `infophysics_impl_grade/migrations/004_users.sql` | Users + system_settings + seed |
| `infophysics_impl_grade/migrations/005_fix_aio_dedup.sql` | Drop over-broad unique constraints blocking multi-row saves |
| `infophysics_impl_grade/Dockerfile` | Python 3.11-slim + bcrypt + psycopg3 |

### Config

| File | Purpose |
|------|---------|
| `railway.json` | Frontend build/deploy config |
| `infophysics_impl_grade/railway.json` | Backend build/deploy config |
| `.claude/launch.json` | Local dev server definitions |

---

## 11. Railway Deployment Reference

### Project IDs

```
Workspace:   c0581275-727e-43a0-94a3-6985ed0af8af  (Michael Bodner's Projects)
Project:     fc6c9213-edcd-43e8-88c0-0d12182f9a50  (aio-processor)
Environment: 698762c4-abfb-467a-aa0e-369628e1eb21  (production)

Services:
  aio-processor   7cfbae6b-3d76-4277-aeca-8b513cf078c3
  infophysics-api 86e2b84b-bee9-48ea-b953-6efda19cd91a
  postgres        b6e817d0-704e-4376-bc14-bb7c33921d03
```

### Deploy Command (GraphQL)

```bash
curl -s -X POST https://backboard.railway.app/graphql/v2 \
  -H "Authorization: Bearer $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"mutation { serviceInstanceDeployV2(
    serviceId: \\\"<SERVICE_ID>\\\",
    environmentId: \\\"698762c4-abfb-467a-aa0e-369628e1eb21\\\",
    commitSha: \\\"<FULL_SHA>\\\"
  ) }\"}"
```

### Check Status

```bash
curl -s -X POST https://backboard.railway.app/graphql/v2 \
  -H "Authorization: Bearer $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"{ deployments(input: {
    projectId: \\\"fc6c9213-edcd-43e8-88c0-0d12182f9a50\\\",
    environmentId: \\\"698762c4-abfb-467a-aa0e-369628e1eb21\\\"
  }, first: 3) { edges { node { id status serviceId } } } }\"}"
```

### Local Development

```bash
# Frontend
cd v0-information-physics-aio-processor
npm run dev   # port 3003

# Backend
cd infophysics_impl_grade
set -a && . .env && set +a
.venv/bin/python -m uvicorn api.main:app --reload --port 8000

# PostgreSQL (Homebrew)
brew services start postgresql@15
```

---

## 12. Commit History

| Hash | Description |
|------|-------------|
| `c2afb4a` | Add login gate, Saved CSVs, and Saved AIOs to System Management |
| `93d1bf3` | Update SESSION_LOG.md with Session 4 — CSV fixes and row detail modal |
| `5ff9d60` | Fix: drop uq_io_source constraint that blocked multi-row CSV saves |
| `0bb51ea` | Fix CSV data display and add row detail modal |
| `0780702` | Add full development session log (SESSION_LOG.md) |
| `893b027` | Replace CSV tab with clickable file cards and add CSV data preview modal |
| `7fb342d` | Fix: force bcrypt layer rebuild in Docker, make seed non-fatal |
| `3d3b078` | Fix AIO dedup constraint, add bcrypt to Docker, and harden users migration |
| `6b9b590` | Add System Management page, user/API-key CRUD, and fix CSV list |
| `cb5b323` | Add ChatAIO chatbot, CSV DB save, and V1.1 title updates |
| `7a50725` | Make RLS policy migrations idempotent (fix Railway redeploy crash) |
| `df82ea6` | Add HSL bracket naming, database persistence, and DB viewer dialogs |
| `ca71dbb` | Fix backend container startup: use sh explicitly, strip CRLF |
| `03dba84` | Fix Railway deployment: libpq-dev, python path in container |
| `6911914` | Add full-stack backend integration, Railway deployment config |
| `fd3368e` | Style: update hero title badge color |
| `fade6d6` | Fix: standardize box styles in Conversion Process map |
| `6171f55` | Feat: add .hsl box to Conversion Process map |
| `aa47bf9` | Feat: add HSL file creation step and glossary entry |
| `473e52f` | Feat: add AIO Reference Paper button and view |
| `df59f12` | Feat: add HSL creation and tracking for AIOs |
| `24ab33f` | Initial commit from v0 |

---

## Issues Encountered & Resolutions

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| `DuplicateObject: policy already exists` | Bare `CREATE POLICY` in migration re-run on existing DB | Wrapped in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` |
| "Summary unavailable" in UI | FastAPI using system Python 3.9 without .env loaded | Switched to `.venv/bin/python` with `set -a && . .env && set +a` |
| `bcrypt` missing in Docker | `bcrypt` not in `requirements.txt`, compiled C extension needs build tools | Added `bcrypt` to requirements, added `gcc libffi-dev` to Dockerfile |
| Stale Turbopack cache errors | Module resolution cache from previous build | Stopped/restarted preview server to force fresh build |
| CSV tab showing 0 records | CSV-type records not saved for historical data | Rebuilt CSV view from AIO records using `reconstructCsvFromAios()` |
| `projects{}` GraphQL returns empty | Personal token needs workspace-scoped query | Used `me { workspaces { projects { ... } } }` query structure |
| CSV Data table always blank after Load Saved AIOs | `handleLoadFromBackend` built `ConvertedFile` with `csvData:[]` | Fixed to call `reconstructCsvFromAios()` to populate headers + rows |
| Only 1 AIO row saved per CSV file | `UNIQUE(tenant_id, source_system, source_object_id)` constraint rejected all rows after the first | Migration `005_fix_aio_dedup.sql` idempotently drops the constraint |
| Railway token expired mid-session | API token `431fca67…` returned "Not Authorized" on all GraphQL calls | Push to GitHub triggers Railway auto-deploy via GitHub integration; obtain fresh token from Railway dashboard if manual deploy needed |
| Context window exhausted (Session 5) | Long multi-session conversation exceeded Claude's context limit | Session auto-summarized; resumed from summary — all state preserved |

---

*Generated March 2026 — AIO Generator V1.1 by InformationPhysics.ai*
