#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../services/resolver"
[ -d .venv ] || python3 -m venv .venv
[ -f .venv/.deps-installed ] || {
  .venv/bin/pip install --quiet --upgrade pip
  .venv/bin/pip install --quiet -r requirements.txt
  touch .venv/.deps-installed
}
exec .venv/bin/uvicorn app.main:app --host "${RESOLVER_HOST:-0.0.0.0}" --port "${RESOLVER_PORT:-8000}"
