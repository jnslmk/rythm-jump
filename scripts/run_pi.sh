#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export RHYTHM_HEADLESS_MODE="${RHYTHM_HEADLESS_MODE:-1}"
export RHYTHM_CONTACT_PIN="${RHYTHM_CONTACT_PIN:-17}"

cd "$ROOT_DIR/backend"
exec uv run --project . uvicorn rhythm_jump.main:app --host 0.0.0.0 --port 8000
