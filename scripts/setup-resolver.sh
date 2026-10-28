#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../services/resolver"
if [ ! -d .venv ]; then
  echo "→ creating python venv"
  python3 -m venv .venv
fi
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt
echo "→ resolver dependencies ready (services/resolver/.venv)"
