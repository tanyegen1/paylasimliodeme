#!/usr/bin/env bash
# Codespace ilk oluşturulduğunda bir kez çalışır: bağımlılıklar, ayarlar, demo verisi, derleme.
set -euo pipefail
cd "$(dirname "$0")/.."

npm ci

if [ ! -f .env.local ]; then
  cat > .env.local <<ENV
DATABASE_URL=${DATABASE_URL}
APP_SECRET=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')
CRON_SECRET=$(node -e 'console.log(require("crypto").randomBytes(16).toString("hex"))')
DEMO_MODE=true
PAYMENT_PROVIDER=sandbox
PAYMENT_WEBHOOK_SECRET=$(node -e 'console.log(require("crypto").randomBytes(16).toString("hex"))')
OCR_PROVIDER=demo
NLP_PROVIDER=rules
ANALYTICS_PROVIDER=db
STORAGE_DIR=./storage/demo
SERVER_ACTIONS_ALLOWED_ORIGINS=*.app.github.dev
ENV
fi

# Veritabanı hazır olana kadar bekle (en fazla ~60 sn).
for i in $(seq 1 30); do
  node -e 'const {Client}=require("pg");const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.end()).then(()=>process.exit(0),()=>process.exit(1))' && break
  echo "Veritabanı bekleniyor…"; sleep 2
done

npm run db:seed:demo
npm run build
echo "Kurulum tamam. Uygulama başlatılıyor…"
