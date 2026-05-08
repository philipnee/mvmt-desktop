#!/usr/bin/env bash
# Vendor the mvmt engine into vendor/mvmt/ for packaging.
# Builds the engine, prunes dev deps, copies what we need to ship.
#
# Source can be overridden via MVMT_SOURCE_DIR; default is ../mvmt next to
# this repo, falling back to ~/code/mvmt.

set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEFAULT_LOCAL="${HOME}/code/mvmt"
NEIGHBOR="$(cd "${DESKTOP_DIR}/.." && pwd)/mvmt"
SOURCE_DIR="${MVMT_SOURCE_DIR:-${NEIGHBOR}}"

if [ ! -d "${SOURCE_DIR}" ] && [ -d "${DEFAULT_LOCAL}" ]; then
  SOURCE_DIR="${DEFAULT_LOCAL}"
fi

if [ ! -d "${SOURCE_DIR}" ]; then
  echo "mvmt source not found. Set MVMT_SOURCE_DIR or place the repo at ${NEIGHBOR}." >&2
  exit 1
fi

VENDOR_DIR="${DESKTOP_DIR}/vendor/mvmt"
STAGING_DIR="${DESKTOP_DIR}/vendor/.mvmt-staging"

echo "Syncing mvmt engine from ${SOURCE_DIR}…"

rm -rf "${STAGING_DIR}"
mkdir -p "${STAGING_DIR}"

# Copy source we need to (re)build inside the staging dir. We do this in a
# staging copy so the user's working clone keeps its dev-dep node_modules.
rsync -a \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='dist' \
  --exclude='coverage' \
  --exclude='tests' \
  "${SOURCE_DIR}/" "${STAGING_DIR}/"

pushd "${STAGING_DIR}" >/dev/null
echo "Installing all deps for compile…"
npm install --no-audit --no-fund --silent
echo "Building…"
npm run build --silent
popd >/dev/null

echo "Promoting staging → ${VENDOR_DIR}"
rm -rf "${VENDOR_DIR}"
mkdir -p "${VENDOR_DIR}"

# Ship: dist, package.json, node_modules (prod). Re-run npm install with
# --omit=dev to drop the typescript we added for compilation.
cp -R "${STAGING_DIR}/dist" "${VENDOR_DIR}/dist"
cp "${STAGING_DIR}/package.json" "${VENDOR_DIR}/package.json"
[ -f "${STAGING_DIR}/package-lock.json" ] && cp "${STAGING_DIR}/package-lock.json" "${VENDOR_DIR}/package-lock.json" || true

pushd "${VENDOR_DIR}" >/dev/null
echo "Reinstalling prod-only deps in vendor (skipping scripts; dist is already built)…"
npm install --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund --silent
popd >/dev/null

rm -rf "${STAGING_DIR}"

VENDORED_SIZE=$(du -sh "${VENDOR_DIR}" | cut -f1)
echo "Vendored mvmt engine (${VENDORED_SIZE}) at ${VENDOR_DIR}"
echo "Entry: ${VENDOR_DIR}/dist/bin/mvmt.js"
