#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "[1/2] Deploying Worker API..."
cd "$ROOT_DIR/workers/api"
npm run deploy

echo "[2/2] Deploying Web Pages..."
cd "$ROOT_DIR/apps/web"
npm run deploy

echo "Done. Cloudflare deploy completed."
