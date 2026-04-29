#!/usr/bin/env bash
# Build a fully self-contained DMG variant with CLOUD_MODE=false.
#
# The default DMG (and the cloud-stripped one) launches with
# CLOUD_MODE=true: only the bundled Next.js frontend starts; the
# embedded Postgres / Python / FastAPI ride along but never get
# spawned, and the frontend talks to the Railway production API.
#
# This script flips CLOUD_MODE to false for the duration of the
# build, producing a DMG whose Electron host process spawns the
# bundled Postgres on 127.0.0.1:5433+, runs all migrations, starts
# the bundled FastAPI on 127.0.0.1:9080+, and then loads the local
# frontend pointing at localhost. No internet required at runtime;
# every Mac that mounts this DMG becomes its own isolated tenant
# with its own Postgres data under
# ~/Library/Application Support/Information Physics Demo System/pgdata.
#
# Output: dist/Information Physics Demo System-${version}-local-${arch}.dmg
# Volume label: "Information Physics Demo System ${version} (Local)"
#
# Usage:
#   bash scripts/build-local-dmg.sh
#
# Run from the electron/ directory. Resources must already be built;
# call scripts/build-resources.sh first if needed.

set -euo pipefail

cd "$(dirname "$0")/.."

# Sanity: every resource folder must be present — the local build
# needs all of them.
for d in frontend python postgres backend; do
  if [ ! -d "resources/$d" ]; then
    echo "❌ resources/$d missing — run bash scripts/build-resources.sh first."
    exit 1
  fi
done

MAIN_JS="main.js"
BACKUP="$MAIN_JS.cloud-mode-backup"

restore_main_js() {
  if [ -f "$BACKUP" ]; then
    echo "↩  restoring $MAIN_JS (CLOUD_MODE = true)…"
    mv "$BACKUP" "$MAIN_JS"
  fi
}
trap restore_main_js EXIT

echo "📦 flipping CLOUD_MODE → false in $MAIN_JS…"
cp "$MAIN_JS" "$BACKUP"
# In-place edit: change `const CLOUD_MODE = true;` → `const CLOUD_MODE = false;`
# BSD sed (macOS default) requires the empty backup arg.
sed -i '' 's/^const CLOUD_MODE = true;/const CLOUD_MODE = false;/' "$MAIN_JS"

# Verify the edit landed — abort if not, rather than ship a cloud
# build labelled as local.
if ! grep -q '^const CLOUD_MODE = false;' "$MAIN_JS"; then
  echo "❌ Failed to flip CLOUD_MODE — aborting build."
  exit 1
fi

# dmg-builder calls `which python` during DMG layout (legacy name —
# modern macOS only ships python3). Without a `python` in PATH the
# arm64 build aborts mid-pack with a Compound error. Shim it: temp
# dir at the head of PATH containing python → python3.
SHIM_DIR="$(mktemp -d)"
ln -sf "$(command -v python3)" "$SHIM_DIR/python"
export PATH="$SHIM_DIR:$PATH"
trap 'restore_main_js; rm -rf "$SHIM_DIR"' EXIT

echo "🔨 running electron-builder for local variant…"
CSC_IDENTITY_AUTO_DISCOVERY=false \
  npx electron-builder \
    -c.artifactName='${productName}-${version}-local-${arch}.${ext}' \
    -c.dmg.artifactName='${productName}-${version}-local-${arch}.${ext}' \
    -c.mac.artifactName='${productName}-${version}-local-${arch}.${ext}' \
    -c.dmg.title='${productName} ${version} (Local)' \
    --mac

echo "✅ local DMGs built. Restoring $MAIN_JS…"
