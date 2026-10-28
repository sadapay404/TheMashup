#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../services/resolver"
if [ ! -d .venv ]; then
  echo "venv missing — run: pnpm setup" >&2
  exit 1
fi
exec .venv/bin/python -m pytest -q
