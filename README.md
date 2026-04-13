# Information Physics Demo System

**V3.1** &mdash; by [InformationPhysics.ai](https://informationphysics.ai)

A full-stack platform that converts structured and unstructured data into **Associated Information Objects (AIOs)**, links them through a **Hyper-Semantic Layer (HSL)**, provides AI-powered retrieval via **ChatAIO**, and persists retrieval episodes as **Memory Result Objects (MROs)**. Built on the Information Physics Standard Model.

---

## Features

- **CSV/PDF Converter** &mdash; Upload CSVs or extract tables from PDFs using Claude AI; automatically generates AIOs with `[Key.Value]` bracket notation
- **HSL Builder** &mdash; Create and manage Hyper-Semantic Layer records that link AIOs by shared information elements
- **ChatAIO** &mdash; Two search modes: Broad Search (all AIOs as context) and AIO Search (four-phase algebra: parse &rarr; match HSLs &rarr; gather AIOs &rarr; synthesize)
- **MRO Management** &mdash; Save, view, download, print, and research retrieval episodes; includes Derived Research Object extraction for MROs without structured context bundles
- **AI Field Maps** &mdash; Automatically generate column-to-element mappings for CSV imports
- **Bulk CSV Processing** &mdash; Batch-process multiple CSV files with progress tracking
- **R&D Compound HSL** &mdash; Advanced multi-AIO linking for research workflows
- **System Administration** &mdash; 12-tab admin panel: users, roles, data management, storage settings, saved MROs, API configuration, and architecture reference
- **Dashboard** &mdash; Live counts of AIOs, HSLs, MROs, Information Elements, and Field Maps
- **Standalone Desktop App** &mdash; Electron-based macOS DMG with bundled Python and PostgreSQL

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, Tailwind CSS, Radix UI, Recharts |
| Backend | FastAPI, Python 3.10+, psycopg |
| Database | PostgreSQL 15, Row-Level Security |
| AI | Claude Sonnet 4.6 (Anthropic API) |
| Desktop | Electron 28, electron-builder |
| Deployment | Railway (auto-deploy from GitHub) |

## Quick Start

### Prerequisites

- Node.js 20+ / pnpm
- Python 3.10+
- PostgreSQL 15+
- Anthropic API key

### Frontend

```bash
pnpm install
pnpm dev              # Dev server at http://localhost:3000
pnpm build            # Production build (standalone output)
```

### Backend

```bash
cd infophysics_impl_grade
pip install -r requirements.txt   # Or see Dockerfile for deps
uvicorn api.main:app --reload --port 8080
```

Migrations run automatically via `start.sh` on startup.

### Full Stack (Docker)

```bash
docker compose up --build
```

Frontend at `http://localhost:3000`, Backend at `http://localhost:8080`.

### Desktop App (macOS)

```bash
cd electron
npm install
npm start              # Dev mode
npm run dist           # Build DMG
```

## Architecture

```
                    ┌─────────────────────┐
                    │     Next.js SPA      │
                    │   (React 19 + UI)    │
                    └──────────┬──────────┘
                               │ API routes (proxy)
                    ┌──────────▼──────────┐
                    │   FastAPI Backend    │
                    │   (~60 endpoints)   │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
     ┌────────▼───────┐ ┌─────▼──────┐ ┌───────▼────────┐
     │  PostgreSQL 15  │ │ Claude AI  │ │  File Storage  │
     │  (RLS tenants)  │ │ (Sonnet)   │ │  (configurable)│
     └────────────────┘ └────────────┘ └────────────────┘
```

### Three-Layer Data Model

1. **AIOs (Layer 1)** &mdash; Self-describing observation objects in `[Key.Value]` bracket notation. 50 element columns per record.
2. **HSLs (Relational)** &mdash; Precomputed pointer tables linking AIOs via shared information elements. 100 element columns.
3. **MROs (Layer 2)** &mdash; Persisted retrieval episodes with query, result, search terms (JSONB), context bundle, and lineage metadata.

### Frontend &rarr; Backend Pattern

All API calls route through Next.js API routes (`app/api/{resource}/route.ts`) which proxy to the FastAPI backend at `API_BASE` (default `http://localhost:8080`).

## Project Structure

```
├── app/                    # Next.js app directory
│   ├── page.tsx            # Main SPA entry point
│   └── api/                # API proxy routes (16 resource groups)
├── components/             # React components
│   ├── chat-aio-dialog.tsx # ChatAIO full-screen dialog
│   ├── system-management.tsx # 12-tab admin panel
│   ├── dashboard.tsx       # Live metrics dashboard
│   └── ui/                 # shadcn/Radix primitives
├── lib/                    # Shared utilities
│   ├── api-client.ts       # Typed API client
│   ├── mro-research-parser.ts # MRO context bundle parser
│   └── storage-adapter.ts  # File save abstraction
├── infophysics_impl_grade/ # Python backend
│   ├── api/main.py         # All FastAPI endpoints
│   ├── migrations/         # SQL migrations (000-013)
│   └── Dockerfile          # Production container
├── electron/               # Desktop app shell
│   ├── main.js             # Electron main process
│   └── preload.js          # Context bridge
├── docs/                   # Documentation
└── public/                 # Static assets
```

## Deployment

Both services auto-deploy from the `main` branch on GitHub via Railway:

- **Frontend**: `railway.toml` at project root
- **Backend**: `infophysics_impl_grade/railway.toml`

## Documentation

See [DOCS.md](DOCS.md) for comprehensive documentation covering the data model, API reference, system administration, and development patterns.

## License

Proprietary &mdash; InformationPhysics.ai
