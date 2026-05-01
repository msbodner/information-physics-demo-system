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

# Source .env if present so ANTHROPIC_API_KEY (and the Apple signing
# vars, if used) flow into this shell. Existing env-var values win.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

# Sanity: every resource folder must be present — the local build
# needs all of them.
for d in frontend python postgres backend; do
  if [ ! -d "resources/$d" ]; then
    echo "❌ resources/$d missing — run bash scripts/build-resources.sh first."
    exit 1
  fi
done

MAIN_JS="main.js"

# Pre-flight: source must start with CLOUD_MODE=true. If it doesn't,
# something previously left it in a bad state (a prior build's restore
# trap that ran with main.js already false would no-op the cleanup).
# Refuse to proceed rather than ship a build whose CLOUD_MODE state
# we can't predict.
if ! grep -q '^const CLOUD_MODE = true;' "$MAIN_JS"; then
  echo "❌ $MAIN_JS does not start with CLOUD_MODE=true — refusing to build."
  echo "   Restore it manually and retry:"
  echo "     sed -i '' 's/^const CLOUD_MODE = false;/const CLOUD_MODE = true;/' $MAIN_JS"
  exit 1
fi

restore_main_js() {
  echo "↩  forcing $MAIN_JS back to CLOUD_MODE=true…"
  # Active restore via sed instead of relying on a backup file.
  # Idempotent: if it's already true (build aborted before flip) this
  # is a no-op; if it's false (normal case) it flips back.
  sed -i '' 's/^const CLOUD_MODE = false;/const CLOUD_MODE = true;/' "$MAIN_JS"
}
trap restore_main_js EXIT

echo "📦 flipping CLOUD_MODE → false in $MAIN_JS…"
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
# Re-arm the trap to also clean up the shim. The earlier `trap
# restore_main_js EXIT` is replaced wholesale here.
trap 'restore_main_js; rm -rf "$SHIM_DIR"' EXIT

# Seed the Anthropic API key into a generated migration so the local
# DMG's freshly-initdb'd Postgres ships with the key already set in
# system_settings. Without this, every ChatAIO call 503's with
# "ANTHROPIC_API_KEY not configured" until the operator pastes the
# key into System Management → API Key.
#
# The migration file is written into resources/backend/migrations/
# (gitignored — won't ever enter version control), packed into the
# DMG, and removed post-build. Filename is 990_… so it sorts AFTER
# every committed migration.
GENERATED_MIGRATION="resources/backend/migrations/990_seed_anthropic_api_key.sql"
cleanup_generated_migration() {
  rm -f "$GENERATED_MIGRATION"
}
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  echo "🔑 baking ANTHROPIC_API_KEY into bundled migrations…"
  # Single-quote escape: ' → '' for SQL literal safety.
  ESCAPED_KEY="${ANTHROPIC_API_KEY//\'/\'\'}"
  cat > "$GENERATED_MIGRATION" <<SQL
-- 990_seed_anthropic_api_key.sql (BUILD-TIME GENERATED — DO NOT COMMIT)
-- Seed system_settings with an Anthropic API key so the local DMG can
-- serve ChatAIO queries immediately on first launch. Idempotent —
-- ON CONFLICT DO NOTHING leaves any operator-set value intact.
INSERT INTO system_settings (key, value, updated_at)
VALUES ('anthropic_api_key', '${ESCAPED_KEY}', now())
ON CONFLICT (key) DO NOTHING;
SQL
  # Make sure the generated file is wiped on EVERY exit path, not
  # just success — even if electron-builder crashes mid-pack.
  trap 'restore_main_js; rm -rf "$SHIM_DIR"; cleanup_generated_migration' EXIT
else
  echo "ℹ️  ANTHROPIC_API_KEY not set — local DMG will require manual API key configuration on first launch."
fi

# Tag the local variant as "V4.6L" everywhere it's user-visible (splash
# screen, Next.js HTML titles, sidebar/dashboard chrome). The bundled
# frontend was already built with "V4.5"; we sed-swap that string to
# "V4.6L" across resources/frontend before packing, then restore after.
#
# Pre-flight: only swap if there's a "V4.5" to swap (idempotent / safe
# if the build is run twice in a row).
LOCAL_TAG="V4.6L"
LOCAL_TAG_FROM="V4.6"

# Snapshot which files contained the source string so we can revert
# only those files (and skip files that were already "V4.6L" from a
# half-finished prior run).
SWAP_LIST_FILE="$(mktemp)"
grep -rl "$LOCAL_TAG_FROM" resources/frontend splash.html 2>/dev/null > "$SWAP_LIST_FILE" || true
SWAP_COUNT=$(wc -l < "$SWAP_LIST_FILE" | tr -d ' ')

revert_local_tag() {
  if [ -s "$SWAP_LIST_FILE" ]; then
    echo "↩  reverting ${SWAP_COUNT} files: $LOCAL_TAG → $LOCAL_TAG_FROM…"
    while IFS= read -r f; do
      [ -f "$f" ] && sed -i '' "s/$LOCAL_TAG/$LOCAL_TAG_FROM/g" "$f"
    done < "$SWAP_LIST_FILE"
  fi
  rm -f "$SWAP_LIST_FILE"
}

echo "🏷  applying local-variant tag: $LOCAL_TAG_FROM → $LOCAL_TAG ($SWAP_COUNT files)…"
while IFS= read -r f; do
  [ -f "$f" ] && sed -i '' "s/$LOCAL_TAG_FROM/$LOCAL_TAG/g" "$f"
done < "$SWAP_LIST_FILE"

# Update the EXIT trap so the version-string revert always runs in
# addition to the prior cleanups.
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  trap 'restore_main_js; rm -rf "$SHIM_DIR"; cleanup_generated_migration; revert_local_tag' EXIT
else
  trap 'restore_main_js; rm -rf "$SHIM_DIR"; revert_local_tag' EXIT
fi

echo "🔨 running electron-builder for local variant…"
# DMG filename ends with "-4.6L-local-${arch}.dmg" — override the
# version segment of the artifactName template directly with a literal,
# rather than fighting electron-builder's semver requirement on the
# top-level "version" field (4.6.0 stays valid in package.json).
CSC_IDENTITY_AUTO_DISCOVERY=false \
  npx electron-builder \
    -c.artifactName='${productName}-4.6L-local-${arch}.${ext}' \
    -c.dmg.artifactName='${productName}-4.6L-local-${arch}.${ext}' \
    -c.mac.artifactName='${productName}-4.6L-local-${arch}.${ext}' \
    -c.dmg.title='${productName} 4.6L (Local)' \
    --mac

echo "✅ local DMGs built. Restoring $MAIN_JS…"
