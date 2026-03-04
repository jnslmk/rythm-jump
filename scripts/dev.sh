#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]]; then kill "$BACKEND_PID" 2>/dev/null || true; fi
  if [[ -n "${WEB_PID:-}" ]]; then kill "$WEB_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

(
  cd "$ROOT_DIR/backend"
  uv run --project . uvicorn rhythm_jump.main:app --host 0.0.0.0 --port 8000
) &
BACKEND_PID=$!

(
  cd "$ROOT_DIR/web"
  npm run dev -- --host 0.0.0.0 --port 5173
) &
WEB_PID=$!

wait "$BACKEND_PID" "$WEB_PID"
