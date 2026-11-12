#!/bin/bash
# Roda os testes de API numa cópia temporária do site: sem .env, sem os pedidos de verdade, com o Mercado Pago e a
# consulta de CEP de mentira (tests/mock-mp.mjs). Tudo escuta só em 127.0.0.1 e é desligado no fim.
#   bash tests/run-tests.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SITE=$(cd "$HERE/.." && pwd)
TMP=$(mktemp -d)
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; rm -rf "$TMP"; }
trap cleanup EXIT

mkdir -p "$TMP/site"
for f in server.js index.html admin.html products.json settings.json package.json package-lock.json logo.png; do [ -e "$SITE/$f" ] && cp "$SITE/$f" "$TMP/site/$f"; done
[ -d "$SITE/assets" ] && cp -r "$SITE/assets" "$TMP/site/assets"
[ -d "$SITE/vendor" ] && cp -r "$SITE/vendor" "$TMP/site/vendor"
ln -s "$SITE/node_modules" "$TMP/site/node_modules"
echo '{}' > "$TMP/site/orders.json"
python3 -I - "$TMP/site/settings.json" <<'PY'
import json, sys
p = sys.argv[1]
s = json.load(open(p, encoding='utf-8'))
s['store']['autoSchedule'] = False; s['store']['isOpenManual'] = True
s['delivery']['maxRadiusKm'] = 15.0
for k in ('pix_online', 'cartao_online', 'cartao_debito_online'): s['payments'][k]['enabled'] = True
json.dump(s, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
PY

node "$HERE/mock-mp.mjs" > "$TMP/mock.log" 2>&1 & PIDS+=($!)
( cd "$TMP/site" && exec env PORT=3055 MERCADOPAGO_ACCESS_TOKEN=TESTTOKEN MERCADOPAGO_PUBLIC_KEY=TEST-PUBLIC-KEY MERCADOPAGO_WEBHOOK_SECRET=whsec_test \
    APP_URL=https://dads.example.test MP_API_BASE=http://127.0.0.1:3099 GEO_API_BASE=http://127.0.0.1:3099/geo ADMIN_PASSWORD=testpass-123 \
    SESSION_SECRET=test-session-secret LOGIN_DELAY_MS=5 MP_RECONCILE_MS=800 MP_TIMEOUT_MS=700 node server.js > "$TMP/server3055.log" 2>&1 ) & PIDS+=($!)
( cd "$TMP/site" && exec env PORT=3056 LOGIN_DELAY_MS=5 node server.js > "$TMP/server3056.log" 2>&1 ) & PIDS+=($!)
for i in $(seq 1 40); do
  ok=1; for p in 3099 3055 3056; do curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$p/__log" || curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$p/settings.json" || ok=0; done
  [ $ok = 1 ] && break; sleep 0.25
done
node "$HERE/make-images.mjs" "$TMP/img" > /dev/null || { echo "não deu para criar as imagens de teste (falta npm install?)"; exit 1; }
TEST_SITE_DIR="$TMP/site" TEST_LOG_DIR="$TMP" TEST_IMG_DIR="$TMP/img" python3 -I "$HERE/api_tests.py"
