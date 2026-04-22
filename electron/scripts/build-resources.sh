#!/bin/bash
set -e

# ═══════════════════════════════════════════════════════════════════
# AIO System App — Build Resources for Electron Packaging
# This script assembles all runtime dependencies into electron/resources/
# Run from the electron/ directory: bash scripts/build-resources.sh
# ═══════════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$ELECTRON_DIR")"
RESOURCES="$ELECTRON_DIR/resources"

echo "═══════════════════════════════════════════════════════════"
echo "  AIO System App — Building Electron Resources"
echo "═══════════════════════════════════════════════════════════"
echo "Project root: $PROJECT_ROOT"
echo "Resources dir: $RESOURCES"
echo ""

# Clean previous build
rm -rf "$RESOURCES"
mkdir -p "$RESOURCES/python" "$RESOURCES/backend" "$RESOURCES/frontend" "$RESOURCES/postgres"

# ── 1. Download Standalone Python 3.12 ───────────────────────────
echo "📦 Step 1: Downloading standalone Python 3.12..."
ARCH=$(uname -m)
# Normalize arch: macOS reports arm64, python-build-standalone uses aarch64
[ "$ARCH" = "arm64" ] && ARCH="aarch64"
OS=$(uname -s | tr '[:upper:]' '[:lower:]')

if [ "$OS" = "darwin" ]; then
  PYTHON_URL="https://github.com/indygreg/python-build-standalone/releases/download/20240224/cpython-3.12.2+20240224-${ARCH}-apple-darwin-install_only.tar.gz"
elif [ "$OS" = "linux" ]; then
  PYTHON_URL="https://github.com/indygreg/python-build-standalone/releases/download/20240224/cpython-3.12.2+20240224-${ARCH}-unknown-linux-gnu-install_only.tar.gz"
else
  echo "⚠️  Windows: skipping Python download (bundle manually)"
  PYTHON_URL=""
fi

if [ -n "$PYTHON_URL" ]; then
  curl -fsSL "$PYTHON_URL" -o /tmp/python-standalone.tar.gz
  tar -xzf /tmp/python-standalone.tar.gz -C "$RESOURCES/"
  # python-build-standalone extracts to python/ directory
  rm -f /tmp/python-standalone.tar.gz

  # Install Python dependencies into the bundled Python
  # Use python -m pip to avoid shebang path issues with spaces in directory names
  echo "  Installing Python packages..."
  "$RESOURCES/python/bin/python3.12" -m pip install --no-cache-dir \
    fastapi "uvicorn[standard]" pydantic "psycopg[binary,pool]" \
    python-dotenv "anthropic>=0.25" "bcrypt>=4.0" "python-multipart>=0.0.6"
  echo "  ✅ Python 3.12 ready"
fi

# ── 2. Copy Backend ──────────────────────────────────────────────
echo "📦 Step 2: Copying FastAPI backend..."
cp -r "$PROJECT_ROOT/infophysics_impl_grade/api" "$RESOURCES/backend/api"
cp -r "$PROJECT_ROOT/infophysics_impl_grade/migrations" "$RESOURCES/backend/migrations"
# Copy seeds if they exist
[ -d "$PROJECT_ROOT/infophysics_impl_grade/seeds" ] && \
  cp -r "$PROJECT_ROOT/infophysics_impl_grade/seeds" "$RESOURCES/backend/seeds"
echo "  ✅ Backend ready"

# ── 3. Build Next.js Frontend ────────────────────────────────────
echo "📦 Step 3: Building Next.js frontend (standalone)..."
cd "$PROJECT_ROOT"

# Set build-time env
export NEXT_PUBLIC_API_BASE=""
export NEXT_PUBLIC_TENANT_ID="tenantA"

pnpm build

# Copy standalone output
# NOTE: must copy files individually — the glob * skips dotfiles like .next/
cp -r "$PROJECT_ROOT/.next/standalone/server.js" "$RESOURCES/frontend/server.js"
cp -r "$PROJECT_ROOT/.next/standalone/package.json" "$RESOURCES/frontend/package.json"
cp -r "$PROJECT_ROOT/.next/standalone/node_modules" "$RESOURCES/frontend/node_modules"
# Copy standalone .next/ (contains BUILD_ID, routes-manifest, server/ etc.)
# Destination must NOT exist before cp -r or it nests inside itself
cp -r "$PROJECT_ROOT/.next/standalone/.next" "$RESOURCES/frontend/.next"
# Add static assets (.next/static is NOT inside standalone/.next)
cp -r "$PROJECT_ROOT/.next/static" "$RESOURCES/frontend/.next/static"
[ -d "$PROJECT_ROOT/public" ] && cp -r "$PROJECT_ROOT/public" "$RESOURCES/frontend/public"

# Fix: pnpm standalone builds omit Next.js runtime dependencies because pnpm uses
# a virtual store with symlinks that Node.js cannot resolve inside a packaged app.
# Copy all declared Next.js runtime deps + their transitive deps into standalone/node_modules.
PNPM_SHARED="$PROJECT_ROOT/node_modules/.pnpm/node_modules"
PNPM_ROOT="$PROJECT_ROOT/node_modules"
STANDALONE_MODS="$RESOURCES/frontend/node_modules"

patch_pkg() {
  local pkg="$1"
  # Handle scoped packages like @next/env → @next/ subdirectory
  if [[ "$pkg" == @*/* ]]; then
    local ns="${pkg%%/*}"      # e.g. @next
    local name="${pkg##*/}"    # e.g. env
    local dest="$STANDALONE_MODS/$ns"
    mkdir -p "$dest"
    if [ -d "$PNPM_SHARED/$ns/$name" ]; then
      cp -r "$PNPM_SHARED/$ns/$name" "$dest/$name" && echo "  ✅ $pkg"
    elif [ -d "$PNPM_ROOT/$pkg" ]; then
      cp -r "$PNPM_ROOT/$pkg" "$dest/$name" && echo "  ✅ $pkg (root)"
    else
      echo "  ⚠️  $pkg not found — frontend may fail"
    fi
  else
    if [ -d "$PNPM_SHARED/$pkg" ]; then
      cp -r "$PNPM_SHARED/$pkg" "$STANDALONE_MODS/$pkg" && echo "  ✅ $pkg"
    elif [ -d "$PNPM_ROOT/$pkg" ]; then
      cp -r "$PNPM_ROOT/$pkg" "$STANDALONE_MODS/$pkg" && echo "  ✅ $pkg (root)"
    else
      echo "  ⚠️  $pkg not found — frontend may fail"
    fi
  fi
}

echo "  Patching pnpm-omitted Next.js runtime deps..."
# Next.js declared deps (from next/package.json > dependencies)
patch_pkg "styled-jsx"
patch_pkg "@next/env"
patch_pkg "@swc/helpers"
patch_pkg "baseline-browser-mapping"
patch_pkg "caniuse-lite"
patch_pkg "postcss"
# postcss transitive deps
patch_pkg "nanoid"
patch_pkg "picocolors"
patch_pkg "source-map-js"

echo "  ✅ Frontend ready"

# ── 4. PostgreSQL Binaries (platform-specific) ───────────────────
echo "📦 Step 4: PostgreSQL binaries..."
if [ "$OS" = "darwin" ]; then
  # Try to copy from Homebrew installation
  PG_BIN=$(pg_config --bindir 2>/dev/null || echo "")
  if [ -n "$PG_BIN" ] && [ -f "$PG_BIN/pg_ctl" ]; then
    echo "  Copying from Homebrew: $PG_BIN"
    mkdir -p "$RESOURCES/postgres/bin"
    for cmd in pg_ctl initdb postgres createdb psql; do
      [ -f "$PG_BIN/$cmd" ] && cp "$PG_BIN/$cmd" "$RESOURCES/postgres/bin/"
    done
    # Copy shared libraries
    PG_LIB=$(pg_config --libdir 2>/dev/null || echo "")
    if [ -n "$PG_LIB" ]; then
      mkdir -p "$RESOURCES/postgres/lib"
      cp -r "$PG_LIB"/*.dylib "$RESOURCES/postgres/lib/" 2>/dev/null || true
    fi
    PG_SHARE=$(pg_config --sharedir 2>/dev/null || echo "")
    if [ -n "$PG_SHARE" ]; then
      mkdir -p "$RESOURCES/postgres/share"
      cp -r "$PG_SHARE/"* "$RESOURCES/postgres/share/" 2>/dev/null || true
    fi
    echo "  ✅ PostgreSQL binaries ready"
  else
    echo "  ⚠️  PostgreSQL not found via Homebrew. Install with: brew install postgresql@15"
    echo "  The app will require system PostgreSQL at runtime."
  fi
else
  echo "  ⚠️  PostgreSQL binary bundling for $OS not automated."
  echo "  Ensure PostgreSQL binaries are available in PATH at runtime."
fi

# ── Summary ──────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Build complete! Resource sizes:"
echo "═══════════════════════════════════════════════════════════"
du -sh "$RESOURCES/python" 2>/dev/null || echo "  python:   (not bundled)"
du -sh "$RESOURCES/backend"
du -sh "$RESOURCES/frontend"
du -sh "$RESOURCES/postgres" 2>/dev/null || echo "  postgres: (not bundled)"
echo ""
echo "Next steps:"
echo "  cd $ELECTRON_DIR"
echo "  npm install"
echo "  npm run dist"
echo ""
