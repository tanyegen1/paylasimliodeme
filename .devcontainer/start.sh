#!/usr/bin/env bash
# Codespace her açıldığında uygulamayı arka planda başlatır.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "${CODESPACE_NAME:-}" ] && [ -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]; then
  export APP_URL="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
else
  export APP_URL="${APP_URL:-http://localhost:3000}"
fi

if [ ! -d .next ]; then npm run build; fi
pkill -f "next start" 2>/dev/null || true
nohup npx next start -p 3000 > /tmp/payda.log 2>&1 &
disown || true
echo "Payda başladı: ${APP_URL}  (kayıt: /tmp/payda.log)"
