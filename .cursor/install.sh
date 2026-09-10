#!/usr/bin/env bash
# Idempotent Cloud Agent setup for Screen Ping (server API + web dashboard).
# Desktop (Electron/Windows) is intentionally out of scope for the Linux Cloud Agent.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "== Screen Ping install: server (FastAPI) =="
cd "$ROOT/server"

# The default base image may lack ensurepip (python3-venv). Install it once if
# creating a venv would fail. Guarded so it is a no-op when already present.
if ! python3 -c "import ensurepip" >/dev/null 2>&1; then
  echo "Installing python3-venv (ensurepip missing)"
  sudo apt-get update -qq
  sudo apt-get install -y -qq python3-venv
fi

# Create the venv once; reuse it on subsequent runs.
if [ ! -x ".venv/bin/python" ]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
. .venv/bin/activate
python -m pip install --upgrade pip >/dev/null
pip install -r requirements.txt
# pytest is used by the test suite but not pinned in requirements.txt.
pip install pytest

# Generate a local dev .env (SQLite, no external services required) if absent.
# This file is gitignored and never overwrites an existing one.
if [ ! -f ".env" ]; then
  SECRET="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
  cat > .env <<EOF
SECRET_KEY=${SECRET}
DATABASE_URL=sqlite:///./screen_ping.db
CORS_ORIGINS=http://localhost:5173,http://localhost:5174
ENABLE_API_DOCS=true
AUTH_COOKIE_SECURE=false
# Expose verification codes in API responses so signup/login can be tested
# without an SMTP server (dev only — never enable in production).
EMAIL_DEV_EXPOSE_CODES=true
EOF
  echo "Wrote server/.env (dev defaults, SQLite)"
else
  echo "server/.env already exists — leaving it untouched"
fi

deactivate

echo "== Screen Ping install: web (React + Vite) =="
cd "$ROOT/web"
npm ci

echo "== Screen Ping install complete =="
