#!/usr/bin/env bash
# Build a stripped-down DMG variant for CLOUD_MODE deployments.
#
# The default DMG ships ~133 MB of resources that the app never starts
# in CLOUD_MODE: the bundled Postgres binary (15 MB), the Python
# interpreter (118 MB), and the FastAPI backend code (0.5 MB). All
# three are dead weight when main.js's CLOUD_MODE flag points the
# frontend at a remote API.
#
# This script temporarily moves those directories aside, runs
# electron-builder with a -cloud suffix in the artifact name, then
# restores them. Result: two DMG variants coexist in dist/, the full
# self-contained one and the lighter cloud-only one.
#
# Usage:
#   bash scripts/build-cloud-dmg.sh
#
# Run from the electron/ directory. Resources must already be built;
# call scripts/build-resources.sh first if needed.

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d "resources/frontend" ]; then
  echo "❌ resources/frontend missing — run bash scripts/build-resources.sh first."
  exit 1
fi

STASH=".stash-cloud-build"
mkdir -p "$STASH"

restore() {
  echo "↩  restoring stashed resources…"
  for d in python postgres backend; do
    if [ -d "$STASH/$d" ]; then
      mv "$STASH/$d" "resources/$d"
    fi
  done
  rmdir "$STASH" 2>/dev/null || true
}
trap restore EXIT

echo "📦 stashing unused-in-cloud resources…"
for d in python postgres backend; do
  if [ -d "resources/$d" ]; then
    mv "resources/$d" "$STASH/$d"
  fi
done

# Override artifactName + volume label so the cloud variant lands
# alongside the full variant in dist/ without clobbering it AND
# mounts as a distinct volume. Without `dmg.title`, both variants
# share the volume label `${productName} ${version}-${arch}`, which
# means macOS can't mount both at the same time. Also disable
# signing — parity with the default unsigned dist build.
echo "🔨 running electron-builder for cloud variant…"
CSC_IDENTITY_AUTO_DISCOVERY=false \
  npx electron-builder \
    -c.artifactName='${productName}-${version}-cloud-${arch}.${ext}' \
    -c.dmg.artifactName='${productName}-${version}-cloud-${arch}.${ext}' \
    -c.mac.artifactName='${productName}-${version}-cloud-${arch}.${ext}' \
    -c.dmg.title='${productName} ${version} (Cloud)' \
    --mac

echo "✅ cloud DMGs built. Restoring stashed resources…"
