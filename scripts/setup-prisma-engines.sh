#!/usr/bin/env bash
# Fetch Prisma engine binaries with curl and place them where Prisma 6
# expects them, with checksum files so the CLI does not re-download.
#
# Why this exists: on this VM the egress proxy resets Node's HTTPS
# downloads from binaries.prisma.sh (ECONNRESET), while curl downloads
# the same files fine. On a normal machine / CI, `prisma generate`
# downloads the engines itself and this script is unnecessary.
set -euo pipefail

PRISMA_VERSION="${PRISMA_VERSION:-6.14.0}"
COMMIT="${PRISMA_COMMIT:-717184b7b35ea05dfa71a3236b7af656013e1e49}"
PLATFORM="${PRISMA_PLATFORM:-debian-openssl-3.0.x}"
BASE="https://binaries.prisma.sh/all_commits/${COMMIT}/${PLATFORM}"

ENGINE_DIR="$(pwd)/node_modules/@prisma/engines"
CACHE_DIR="${HOME}/.cache/prisma/master/${COMMIT}/${PLATFORM}"
mkdir -p "${ENGINE_DIR}" "${CACHE_DIR}"

download() {
  local file="$1" dest="$2"
  echo "== ${file}"
  curl -L --retry 5 --retry-all-errors --retry-delay 3 -C - \
    -o "${dest}.gz" "${BASE}/${file}.gz"
  gunzip -c "${dest}.gz" > "${dest}"
  chmod +x "${dest}"
  # No trailing newline: Prisma compares the file content verbatim
  # against the computed hash.
  sha256sum "${dest}" | awk '{print $1}' | tr -d '\n' > "${dest}.sha256"
}

download "schema-engine" \
  "${ENGINE_DIR}/schema-engine-${PLATFORM}"
download "libquery_engine.so.node" \
  "${ENGINE_DIR}/libquery_engine-${PLATFORM}.so.node"

# The Prisma cache keys binaries by their bare name (schema-engine,
# libquery-engine), not by the platform-suffixed target filename.
cp "${ENGINE_DIR}/schema-engine-${PLATFORM}" \
   "${CACHE_DIR}/schema-engine"
cp "${ENGINE_DIR}/schema-engine-${PLATFORM}.sha256" \
   "${CACHE_DIR}/schema-engine.sha256"
cp "${ENGINE_DIR}/libquery_engine-${PLATFORM}.so.node" \
   "${CACHE_DIR}/libquery-engine"
cp "${ENGINE_DIR}/libquery_engine-${PLATFORM}.so.node.sha256" \
   "${CACHE_DIR}/libquery-engine.sha256"
# `prisma generate` also wants the query engine next to the CLI.
cp "${ENGINE_DIR}/libquery_engine-${PLATFORM}.so.node" \
   "./node_modules/prisma/libquery_engine-${PLATFORM}.so.node"

echo "Engines installed. Verifying:"
./node_modules/.bin/prisma --version
