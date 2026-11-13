#!/bin/bash
# Roda os testes de API numa cópia temporária do site: sem .env, sem os pedidos de verdade, com o Mercado Pago e a
# consulta de CEP de mentira (tests/mock-mp.mjs). Tudo escuta só em 127.0.0.1, em portas livres escolhidas na hora
# (nunca conversa com um servidor que já estava aberto por outro programa), e é desligado no fim.
#   bash tests/run-tests.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SITE=$(cd "$HERE/.." && pwd)
TMP=$(mktemp -d)
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; rm -rf "$TMP"; }
trap cleanup EXIT

# Três portas livres e diferentes entre si: servidor com credenciais, servidor sem credenciais e o Mercado Pago de mentira
free_port() { python3 -I -c "import socket; s = socket.socket(); s.bind(('127.0.0.1', 0)); print(s.getsockname()[1]); s.close()"; }
TEST_PORT_MAIN=$(free_port); TEST_PORT_NOCRED=$(free_port); TEST_PORT_MOCK=$(free_port)
while [ "$TEST_PORT_NOCRED" = "$TEST_PORT_MAIN" ]; do TEST_PORT_NOCRED=$(free_port); done
while [ "$TEST_PORT_MOCK" = "$TEST_PORT_MAIN" ] || [ "$TEST_PORT_MOCK" = "$TEST_PORT_NOCRED" ]; do TEST_PORT_MOCK=$(free_port); done
export TEST_PORT_MAIN TEST_PORT_NOCRED TEST_PORT_MOCK

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

MOCK_PORT=$TEST_PORT_MOCK node "$HERE/mock-mp.mjs" > "$TMP/mock.log" 2>&1 & PIDS+=($!)
( cd "$TMP/site" && exec env PORT=$TEST_PORT_MAIN MERCADOPAGO_ACCESS_TOKEN=TESTTOKEN MERCADOPAGO_PUBLIC_KEY=TEST-PUBLIC-KEY MERCADOPAGO_WEBHOOK_SECRET=whsec_test \
    APP_URL=https://dads.example.test MP_API_BASE=http://127.0.0.1:$TEST_PORT_MOCK GEO_API_BASE=http://127.0.0.1:$TEST_PORT_MOCK/geo ADMIN_PASSWORD=testpass-123 \
    SESSION_SECRET=test-session-secret LOGIN_DELAY_MS=5 MP_RECONCILE_MS=800 MP_TIMEOUT_MS=700 node server.js > "$TMP/server-main.log" 2>&1 ) & PIDS+=($!)
( cd "$TMP/site" && exec env PORT=$TEST_PORT_NOCRED LOGIN_DELAY_MS=5 node server.js > "$TMP/server-nocred.log" 2>&1 ) & PIDS+=($!)

# Espera os três ficarem prontos; se algum não ficar (ou morrer), avisa com o registro dele e não roda teste nenhum
alive() { [ "$(curl -s --max-time 1 "http://127.0.0.1:$1/healthz")" = "ok" ]; }  # tem que responder "ok" de verdade, não só atender
ready=0
for i in $(seq 1 80); do
  if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$TEST_PORT_MOCK/__log" && alive "$TEST_PORT_MAIN" && alive "$TEST_PORT_NOCRED"; then ready=1; break; fi
  sleep 0.25
done
for p in "${PIDS[@]}"; do kill -0 "$p" 2>/dev/null || ready=0; done
if [ $ready != 1 ]; then
  echo "ERRO: os servidores de teste não ficaram prontos (portas $TEST_PORT_MAIN, $TEST_PORT_NOCRED e $TEST_PORT_MOCK). Registros:"
  for f in "$TMP"/*.log; do echo "--- $(basename "$f")"; tail -n 15 "$f"; done
  exit 1
fi

node "$HERE/make-images.mjs" "$TMP/img" > /dev/null || { echo "não deu para criar as imagens de teste (falta npm install?)"; exit 1; }
TEST_SITE_DIR="$TMP/site" TEST_LOG_DIR="$TMP" TEST_IMG_DIR="$TMP/img" python3 -I "$HERE/api_tests.py"
