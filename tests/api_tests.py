# Testes de API do Dad's Burger (rodados por tests/run-tests.sh, contra um Mercado Pago de mentira).
# Cobrem: login do painel, fotos (só jpg, png e webp, refeitas no servidor), preço e promoção no pedido, ordem do cardápio,
# produto escondido ou esgotado, logo da loja, link privado de acompanhamento do pedido, hospedagem (pasta de dados, senha
# obrigatória, saúde do servidor), cobrança Pix e cartão (o que vai ao Mercado Pago), webhook, devolução, horário da loja,
# raio de entrega, formas de pagamento ligadas no painel, valor mostrado, validação do que o painel grava e motoboy só ao aceitar.
import json, urllib.request, urllib.error, hmac, hashlib, time, base64, os, re, sys, datetime
import concurrent.futures as cf
from zoneinfo import ZoneInfo

# Portas escolhidas livres por tests/run-tests.sh (sem ele, as de sempre)
B = 'http://127.0.0.1:' + os.environ.get('TEST_PORT_MAIN', '3055'); B0 = 'http://127.0.0.1:' + os.environ.get('TEST_PORT_NOCRED', '3056'); MP = 'http://127.0.0.1:' + os.environ.get('TEST_PORT_MOCK', '3099')
SITE = os.environ['TEST_SITE_DIR']; LOGD = os.environ['TEST_LOG_DIR']
res_all = []

def rcall(base, method, path, body=None, headers=None):
    req = urllib.request.Request(base + path, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers={'Content-Type': 'application/json', **(headers or {})})
    try:
        r = urllib.request.urlopen(req, timeout=30); raw = r.read(); code = r.status; hd = r.headers
    except urllib.error.HTTPError as e:
        raw = e.read(); code = e.code; hd = e.headers
    try: data = json.loads(raw)
    except Exception: data = raw
    return code, data, hd
def call(base, method, path, body=None, headers=None):
    c, d, _ = rcall(base, method, path, body, headers); return c, d
def check(name, cond, extra=''):
    res_all.append(bool(cond)); print(('PASS ' if cond else 'FAIL ') + name + (' | ' + str(extra)[:400] if extra and not cond else ''))
def login(base=B, pw='testpass-123'):
    c, d, hd = rcall(base, 'POST', '/api/admin/login', {'password': pw}); return c, (hd.get('Set-Cookie') or '')
COOKIE = login()[1].split(';')[0]
def acall(base, method, path, body=None, headers=None): return call(base, method, path, body, {'Cookie': COOKIE, **(headers or {})})
def until(fn, secs=6):
    t0 = time.time()
    while time.time() - t0 < secs:
        v = fn()
        if v: return v
        time.sleep(0.2)
    return None

products = json.load(open(SITE + '/products.json', encoding='utf-8'))
p1 = products[0]; p2 = products[12]
CPF = '52998224725'; EMAIL = 'joana.teste@example.com'
cust = {'name': 'Joana Pereira Lima', 'phone': '51988776655', 'cpf': CPF, 'email': EMAIL}
TOK = 'tok_ok_0000000000000000'
base_items = {'items': [{'name': p1['name'], 'q': 2}, {'name': p2['name'], 'q': 1}], 'unitId': 'passo-dareia'}
expected = round(p1['price'] * 2 + p2['price'], 2)
FEE = 7.5  # frete da faixa até 3 km (o CEP 91350050 fica bem perto da loja)
expected_total = round(expected + FEE, 2)
def deliv(cep, bairro="Passo d'Areia", cidade='Porto Alegre'):
    return {**base_items, 'mode': 'entrega', 'address': 'Rua Teste, 10', 'addressDetails': {'rua': 'Rua Teste', 'numero': '10', 'bairro': bairro, 'cidade': cidade, 'cep': cep}}
order1 = deliv('91350050')  # entrega dentro do raio: o pedido que quase todos os testes usam
def pix(order, **kw): return call(B, 'POST', '/api/mercadopago/pix', {'customer': cust, 'order': order, **kw})
def card(order, method='visa', c=None, **kw): return call(B, 'POST', '/api/mercadopago/card-payment', {'customer': c or cust, 'order': order, 'card': {'token': TOK, 'paymentMethodId': method, 'installments': 1, **kw}})
def mp_log(): return call(MP, 'GET', '/__log')[1]
def posts(): return [x for x in mp_log() if x.get('body')]
def reset(): call(MP, 'GET', '/__reset')
def get_settings(): return call(B, 'GET', '/api/admin/settings')[1]
def set_settings(fn):
    s = get_settings(); fn(s); return acall(B, 'POST', '/api/admin/settings', s)
def baseline():
    def f(s):
        s['store'].update({'isOpenManual': True, 'autoSchedule': False}); s['delivery']['maxRadiusKm'] = 15.0
        for k in ('pix_online', 'cartao_online', 'cartao_debito_online'): s['payments'][k]['enabled'] = True
    set_settings(f)
def board(oid):
    l = [o for o in acall(B, 'GET', '/api/orders')[1]['orders'] if o['orderId'] == oid]; return l[0] if l else None
def sig(secret, did, rid, ts): return hmac.new(secret.encode(), f'id:{did};request-id:{rid};ts:{ts};'.encode(), hashlib.sha256).hexdigest()
def webhook(pid, secret='whsec_test'):
    ts = str(int(time.time() * 1000)); rid = 'req-' + str(pid)
    return call(B, 'POST', f'/api/mercadopago/webhook?data.id={pid}&type=payment', {'type': 'payment', 'data': {'id': str(pid)}}, {'x-signature': f'ts={ts},v1={sig(secret, pid, rid, ts)}', 'x-request-id': rid})
def geo(cep, lat, lng): call(MP, 'GET', f'/__setgeo?cep={cep}&lat={lat}&lng={lng}')
def orders_file(): return json.load(open(SITE + '/orders.json', encoding='utf-8'))

baseline(); reset()

# ============================================================ ARQUIVOS E CONFIGURAÇÃO
c, d = call(B, 'GET', '/api/mercadopago/config'); check('config: public key only, never the access token', c == 200 and d.get('publicKey') == 'TEST-PUBLIC-KEY' and 'TESTTOKEN' not in json.dumps(d), d)
check('config without credentials: configured false', call(B0, 'GET', '/api/mercadopago/config')[1].get('configured') is False)
for path, want in [('/orders.json', 404), ('/products.json', 404), ('/server.js', 404), ('/package.json', 404), ('/.env', 404), ('/assets/pay/visa.svg', 200), ('/index.html', 200)]:
    try: code = urllib.request.urlopen(B + path).status
    except urllib.error.HTTPError as e: code = e.code
    check(f'static {path} -> {want}', code == want, code)
check('every payment logo file is served', all(urllib.request.urlopen(B + f'/assets/pay/{n}').status == 200 for n in ['visa.svg', 'mastercard.svg', 'elo.png', 'amex.svg', 'pix.svg', 'mercadopago.svg', 'vr.png', 'alelo.png', 'pluxee.svg', 'ticket.svg']))

# ============================================================ LOGIN DO PAINEL
check('auth: order list without login -> 401', call(B, 'GET', '/api/orders')[0] == 401)
check('auth: change order status without login -> 401', call(B, 'PATCH', '/api/orders/DAD-1', {'status': 'preparando'})[0] == 401)
check('auth: save settings / products / upload without login -> 401', all(call(B, 'POST', p, b)[0] == 401 for p, b in [('/api/admin/settings', {'store': {}}), ('/api/admin/products', []), ('/api/admin/upload', {'dataUrl': 'data:image/png;base64,AAAA'})]))
check('auth: the site reads settings and the public menu; the full product list needs the login', call(B, 'GET', '/api/admin/settings')[0] == 200 and call(B, 'GET', '/api/menu')[0] == 200 and call(B, 'GET', '/api/admin/products')[0] == 401)
check('auth: wrong or old passwords -> 401', all(login(B, pw)[0] == 401 for pw in ('dads123', 'admin123', 'dads2026', '')))
c, d, hd = rcall(B, 'POST', '/api/admin/login', {'password': 'testpass-123'}); sc = hd.get('Set-Cookie') or ''
check('auth: right password -> cookie scripts cannot read', c == 200 and 'HttpOnly' in sc and 'SameSite=Strict' in sc, sc)
tok = sc.split(';')[0]
check('auth: tampered cookie -> 401, real cookie -> 200', call(B, 'GET', '/api/orders', None, {'Cookie': tok[:-3] + 'abc'})[0] == 401 and call(B, 'GET', '/api/orders', None, {'Cookie': tok})[0] == 200)
rcall(B, 'POST', '/api/admin/logout', None, {'Cookie': tok})
check('auth: logout stops the cookie at once', call(B, 'GET', '/api/orders', None, {'Cookie': tok})[0] == 401)
for i in range(6): login(B, 'wrong-' + str(i))
check('auth: many wrong tries never lock the owner out', login()[0] == 200)
c, sc0 = login(B0, 'dads123'); tok0 = sc0.split(';')[0]
check('auth: without ADMIN_PASSWORD the panel is told the password is the default', c == 200 and call(B0, 'GET', '/api/admin/session', None, {'Cookie': tok0})[1].get('defaultPassword') is True)

# ============================================================ PIX: o que vai ao Mercado Pago
c, px = pix(deliv('91350050'), deviceId='armor.' + ('A1b2' * 48) + '.' + ('c3' * 16))
s = posts()[-1]; b = s['body']
check('pix: 200 with QR code', c == 200 and px.get('success') and px.get('qrCode', '').startswith('00020126'), (c, px))
check('pix: official back-end SDK headers', (s['product'] or '').startswith('bc32') and 'SDK' in (s['tracking'] or '') and (s['ua'] or '').startswith('MercadoPago Node.js SDK'), (s['product'], s['ua']))
check('pix: amount recomputed on the server, no application_fee', abs(b['transaction_amount'] - px['total']) < 0.001 and px['total'] > expected and 'application_fee' not in b, (b['transaction_amount'], expected))
check('pix: buyer email, names, CPF, external_reference, statement_descriptor', b['payer']['email'] == EMAIL and b['payer']['first_name'] == 'Joana' and b['payer']['last_name'] == 'Pereira Lima' and b['payer']['identification'] == {'type': 'CPF', 'number': CPF} and b['external_reference'] == px['orderId'] and b['statement_descriptor'] == 'DADS BURGER', b['payer'])
check('pix: payer.address from the delivery address', b['payer'].get('address') == {'zip_code': '91350050', 'street_name': 'Rua Teste', 'street_number': '10', 'neighborhood': "Passo d'Areia", 'city': 'Porto Alegre', 'federal_unit': 'RS'}, b['payer'].get('address'))
ai = b['additional_info']
exp_items = [{'id': str(p1['id']), 'title': p1['name'], 'description': p1['name'], 'category_id': 'food', 'quantity': 2, 'unit_price': p1['price']}, {'id': str(p2['id']), 'title': p2['name'], 'description': p2['name'], 'category_id': 'food', 'quantity': 1, 'unit_price': p2['price']}]
check('pix: additional_info items (id, title, description, category, quantity, unit_price)', ai['items'] == exp_items, ai['items'])
check('pix: additional_info payer phone/names and shipment address', ai['payer'].get('phone') == {'area_code': '51', 'number': '988776655'} and ai['payer']['last_name'] == 'Pereira Lima' and ai['shipments']['receiver_address']['zip_code'] == '91350050', ai)
check('pix: a real-size Device ID (231 chars) reaches Mercado Pago untouched', len(s['device'] or '') == 231, len(s['device'] or ''))
check('pix: a malformed Device ID is ignored without breaking the payment', pix(order1, deviceId='bad value\r\nX-Evil: 1')[0] == 200 and posts()[-1]['device'] is None)
c, pk = pix(order1); b2 = posts()[-1]['body']
n_posts = len(posts()); c_pk, d_pk = pix({**order1, 'mode': 'retirada'})
check('pix: store pick-up is refused (so_entrega) and nothing reaches Mercado Pago', c_pk == 400 and d_pk.get('error') == 'so_entrega' and len(posts()) == n_posts, (c_pk, d_pk))
check('pix: idempotency key differs per attempt', posts()[-1]['idem'] != s['idem'] and posts()[-1]['idem'].startswith(pk['orderId'] + '-'))
check('pix: expiry is -03:00 and at least 30 minutes ahead', b2['date_of_expiration'].endswith('-03:00') and 29 < (datetime.datetime.fromisoformat(b2['date_of_expiration']) - datetime.datetime.now(datetime.timezone.utc)).total_seconds() / 60 < 31)
check('pix: unpaid order is not on the board', board(pk['orderId']) is None)
for label, mod, err in [('missing email', {'email': ''}, 'email_invalido'), ('bad email', {'email': 'x'}, 'email_invalido'), ('one-word name', {'name': 'Joana'}, 'nome_completo'), ('bad CPF', {'cpf': '11111111111'}, 'cpf_invalido')]:
    n0 = len(posts()); c, d = call(B, 'POST', '/api/mercadopago/pix', {'customer': {**cust, **mod}, 'order': order1})
    check(f'pix: {label} -> 400 {err}, nothing sent to Mercado Pago', c == 400 and d.get('error') == err and len(posts()) == n0, (c, d))
check('pix: unknown item and quantity 0 and 51 refused', all(pix({**order1, 'items': [it]})[0] == 400 for it in ({'name': 'Produto que nao existe', 'q': 1}, {'name': p1['name'], 'q': 0}, {'name': p1['name'], 'q': 51})))
check('no credentials: Pix and card answer 503 (no fake approval)', call(B0, 'POST', '/api/mercadopago/pix', {'customer': cust, 'order': order1})[0] == 503 and call(B0, 'POST', '/api/mercadopago/card-payment', {'customer': cust, 'order': order1, 'card': {'token': 'x' * 32, 'paymentMethodId': 'visa', 'installments': 1}})[0] == 503)
def one(i): return pix(order1, deviceId=f'dev-par-{i}')
with cf.ThreadPoolExecutor(8) as ex: rs = list(ex.map(one, range(8)))
by_ref = {x['body']['external_reference']: x for x in posts()}
check('8 parallel Pix: each carries its own Device ID and idempotency key', all(c == 200 and by_ref[d['orderId']]['device'] == f'dev-par-{i}' for i, (c, d) in enumerate(rs)) and len({x['idem'] for x in by_ref.values()}) >= 8)

# ============================================================ CARTÃO
c, cd = card(deliv('91350050'), issuerId=25, installments=3, deviceId='dev-card-1'); s = posts()[-1]; b = s['body']
check('card: approved, token + issuer + installments + binary_mode + descriptor + buyer email + items + Device ID', c == 200 and cd.get('status') == 'approved' and b['token'] == TOK and b['issuer_id'] == 25 and b['installments'] == 3 and b['binary_mode'] is True and b['statement_descriptor'] == 'DADS BURGER' and b['payer']['email'] == EMAIL and len(b['additional_info']['items']) == 2 and s['device'] == 'dev-card-1', (c, cd))
check('card: paid order reaches the board', board(cd['orderId']) is not None and board(cd['orderId'])['paymentConfirmed'] is True)
check('card: the buyer email is not stored in orders.json', EMAIL not in open(SITE + '/orders.json', encoding='utf-8').read())
c, d = call(B, 'POST', '/api/mercadopago/card-payment', {'customer': cust, 'order': order1, 'card': {'token': 'tok_decline_000000000000', 'paymentMethodId': 'master', 'installments': 1}})
check('card: rejected -> 402 with reason, no order', c == 402 and d.get('reason') == 'cc_rejected_insufficient_amount', (c, d))
c, d = call(B, 'POST', '/api/mercadopago/card-payment', {'customer': cust, 'order': order1, 'card': {'token': 'tok_error_00000000000000', 'paymentMethodId': 'master', 'installments': 1}})
check('card: Mercado Pago error -> 502', c == 502, (c, d))
c, d = call(B, 'POST', '/api/mercadopago/card-payment', {'customer': cust, 'order': order1, 'card': {'cardNumber': '4111111111111111', 'securityCode': '123', 'paymentMethodId': 'visa', 'installments': 1}})
check('card: raw card data without a token refused (never forwarded)', c == 400 and d.get('error') == 'dados_do_cartao_invalidos', (c, d))
c, d = call(B, 'POST', '/api/mercadopago/card-payment', {'customer': cust, 'order': order1, 'card': {'token': 'tok_pending_0000000000000', 'paymentMethodId': 'visa', 'installments': 1}})
check('card: in_process is not confirmed and not on the board', c == 200 and d.get('status') == 'in_process' and board(d['orderId']) is None, (c, d))
for label, mod, err in [('missing email', {'email': ''}, 'email_invalido'), ('one-word name', {'name': 'Joana'}, 'nome_completo')]:
    c, d = card(order1, c={**cust, **mod}); check(f'card: {label} -> 400 {err}', c == 400 and d.get('error') == err, (c, d))

# ============================================================ WEBHOOK, DEVOLUÇÃO E CONTESTAÇÃO
c, w = pix(order1); pid = w['paymentId']; call(MP, 'GET', f'/__approve/{pid}')
ts = str(int(time.time() * 1000))
check('webhook: unsigned and wrong signature -> 401, order not confirmed', call(B, 'POST', f'/api/mercadopago/webhook?data.id={pid}&type=payment', {'data': {'id': pid}})[0] == 401 and webhook(pid, 'wrong')[0] == 401 and board(w['orderId']) is None)
check('webhook: valid signature -> 200, then the order is confirmed after the server asks Mercado Pago', webhook(pid)[0] == 200 and until(lambda: board(w['orderId'])))
check('status route: pending while unpaid, approved only after Mercado Pago says so', call(B, 'GET', f"/api/mercadopago/payment/{pix(order1)[1]['paymentId']}/status")[1] == {'status': 'pending', 'confirmed': False})
c, ca = card(order1); cp, co = ca['paymentId'], ca['orderId']
call(MP, 'GET', f'/__partial/{cp}?amount=1'); webhook(cp)
check('after sale: partial refund flagged, order stays paid', until(lambda: board(co).get('refunded') is True) and board(co)['refundedAmount'] == 1 and board(co)['paymentConfirmed'] is True)
call(MP, 'GET', f'/__refund/{cp}'); webhook(cp)
check('after sale: full refund recorded', until(lambda: board(co).get('mpStatus') == 'refunded'))
c, cb = card(order1, 'master'); call(MP, 'GET', f"/__chargeback/{cb['paymentId']}"); webhook(cb['paymentId'])
check('after sale: chargeback flagged', until(lambda: board(cb['orderId']).get('chargedBack') is True))
c, cc = card(order1); call(MP, 'GET', f"/__refund/{cc['paymentId']}"); call(B, 'POST', f"/api/mercadopago/webhook?data.id={cc['paymentId']}&type=payment", {'data': {'id': cc['paymentId']}}); time.sleep(0.5)
check('after sale: an unsigned webhook cannot flag a refund', not board(cc['orderId']).get('refunded'))

# ============================================================ RESPOSTA PERDIDA
reset(); call(MP, 'GET', '/__fail5xx?n=1'); c, d = pix(order1); ps = posts()
check('5xx once: the SDK retries with the SAME idempotency key, customer sees a normal answer, one payment exists', c == 200 and len(ps) == 2 and ps[0]['idem'] == ps[1]['idem'] and len(call(MP, 'GET', '/v1/payments/search?external_reference=' + d['orderId'])[1]['results']) == 1, (c, len(ps)))
reset(); call(MP, 'GET', '/__slow?n=2&ms=2500&create=1'); c, d = pix(order1)
check('lost answer: payment is found by external_reference, order saved, QR returned', c == 200 and d.get('qrCode') and d['orderId'] in orders_file() and any(x.get('search') for x in mp_log()), (c, d))
reset(); n0 = len(orders_file()); call(MP, 'GET', '/__slow?n=2&ms=2500&create=0'); c, d = pix(order1)
check('nothing created at Mercado Pago: 502, no QR, no order saved', c == 502 and 'qrCode' not in d and len(orders_file()) == n0, (c, d))

# ============================================================ HORÁRIO DA LOJA (fuso de Brasília, regra do servidor)
reset()
def closed_everywhere(label):
    c, d = pix(order1); check(f'{label}: Pix refused with loja_fechada and the owner notice', c == 403 and d.get('error') == 'loja_fechada' and d.get('notice'), (c, d))
    c, d = card(order1); check(f'{label}: card refused', c == 403 and d.get('error') == 'loja_fechada')
set_settings(lambda s: s['store'].update({'isOpenManual': False, 'autoSchedule': False}))
st = call(B, 'GET', '/api/store/status')[1]
check('closed by the owner switch: status pausada, timezone Brasilia', st['open'] is False and st['reason'] == 'pausada' and st['timezone'] == 'America/Sao_Paulo', st)
n0 = len(posts()); closed_everywhere('closed by the owner switch'); check('closed: nothing reached Mercado Pago', len(posts()) == n0)
now = datetime.datetime.now(ZoneInfo('America/Sao_Paulo')); m = now.hour * 60 + now.minute
DAYK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab']; today = DAYK[now.isoweekday() % 7]; yest = DAYK[(now.isoweekday() % 7 - 1) % 7]
def hhmm(x): x %= 1440; return f'{x // 60:02d}:{x % 60:02d}'
def sched(**days):
    def f(s):
        s['store'].update({'isOpenManual': True, 'autoSchedule': True})
        for k in s['store']['schedule']: s['store']['schedule'][k]['active'] = False
        for k, (o, c2) in days.items(): s['store']['schedule'][k].update({'active': True, 'open': o, 'close': c2})
    set_settings(f)
sched(**{today: (hhmm(m - 120), hhmm(m - 60)) if m >= 120 else (hhmm(m + 60), hhmm(m + 120))})
check('closed outside today window: fora_do_horario', call(B, 'GET', '/api/store/status')[1].get('reason') == 'fora_do_horario'); closed_everywhere('closed outside the hours')
sched(**{today: (hhmm(max(0, m - 30)), hhmm(min(1439, m + 30)))})
check('open inside today window (Brasilia time, this machine may be in another zone)', call(B, 'GET', '/api/store/status')[1]['open'] is True and pix(order1)[0] == 200)
if m + 30 <= 1438:
    sched(**{yest: ('23:59', hhmm(m + 30))}); check('open: yesterday window that runs past midnight still counts', call(B, 'GET', '/api/store/status')[1]['open'] is True)
set_settings(lambda s: s['store'].update({'isOpenManual': True, 'autoSchedule': False}))
check('manual mode: the switch alone decides, open even with a closed grid', call(B, 'GET', '/api/store/status')[1]['open'] is True)
baseline()

# ============================================================ RAIO DE ENTREGA (do dono, medido pelo CEP)
geo('91000001', '-30.0626', '-51.1557'); geo('91000002', '-30.1256', '-51.1557'); geo('91000003', '-30.0220', '-51.1557')   # ~5 km, ~12 km, ~0,5 km
def radius(km): set_settings(lambda s: s['delivery'].update({'maxRadiusKm': km}))
radius(6)
check('radius 6 km: 5 km accepted, 12 km refused (Pix and card)', pix(deliv('91000001'))[0] == 200 and pix(deliv('91000002'))[1].get('error') == 'fora_do_raio' and card(deliv('91000002'))[1].get('error') == 'fora_do_raio')
check('radius: lying about the neighborhood does not help (the CEP point decides)', pix(deliv('91000002', bairro="Passo d'Areia"))[1].get('error') == 'fora_do_raio')
radius(15); check('radius raised to 15: the same address is accepted at once', pix(deliv('91000002'))[0] == 200)
radius(3); check('radius lowered to 3: 5 km refused, 0.5 km accepted', pix(deliv('91000001'))[1].get('error') == 'fora_do_raio' and pix(deliv('91000003'))[0] == 200); radius(15)
c, d = call(B, 'POST', '/api/delivery/validate', {'addressDetails': deliv('91000002')['addressDetails'], 'unitId': 'passo-dareia'})
check('validate endpoint: distance from the CEP point', c == 200 and d.get('valid') and d.get('allowed') and 11 < d['distanceKm'] < 13, d)
n0 = len([x for x in mp_log() if x.get('geo') == '91000002']); pix(deliv('91000002'))
check('radius: the CEP lookup is cached', len([x for x in mp_log() if x.get('geo') == '91000002']) == n0)
check('unknown CEP + unknown neighborhood -> endereco_nao_confirmado; empty neighborhood too', pix(deliv('99999999', bairro='Lugar Que Nao Existe'))[1].get('error') == 'endereco_nao_confirmado' and pix(deliv('99999998', bairro=''))[1].get('error') == 'endereco_nao_confirmado')
check('CEP service without an answer: the neighborhood name is the fallback', pix(deliv('99999997', bairro="Passo d'Areia"))[0] == 200)
check('far city refused', pix(deliv('80000000', bairro='Centro', cidade='Curitiba'))[1].get('error') == 'fora_do_raio')

# ============================================================ FORMAS DE PAGAMENTO E VALOR MOSTRADO
def pay(key, on): set_settings(lambda s: s['payments'][key].update({'enabled': on}))
pay('pix_online', False); check('payment off: Pix refused (forma_desativada)', pix(order1)[1].get('error') == 'forma_desativada'); pay('pix_online', True)
pay('cartao_online', False); check('payment off: credit refused, debit still works', card(order1, 'visa')[1].get('error') == 'forma_desativada' and card(order1, 'debvisa')[0] == 200); pay('cartao_online', True)
pay('cartao_debito_online', False); check('payment off: debit refused, credit still works', card(order1, 'debvisa')[1].get('error') == 'forma_desativada' and card(order1, 'visa')[0] == 200); pay('cartao_debito_online', True)
c, d = pix({**order1, 'expectedTotal': expected_total - 5})
check('shown total lower than the real one: 409 valor_mudou with the new total', c == 409 and d.get('error') == 'valor_mudou' and abs(d['total'] - expected_total) < 0.01, (c, d))
check('shown total equal or higher: accepted, charged the real total', pix({**order1, 'expectedTotal': expected_total})[0] == 200 and abs(pix({**order1, 'expectedTotal': expected_total + 3})[1]['total'] - expected_total) < 0.01)

# ============================================================ O QUE O PAINEL GRAVA
orig = acall(B, 'GET', '/api/admin/products')[1]
def with_item(**mod):
    l = json.loads(json.dumps(orig)); l[0].update(mod); return l
check('products: zero, negative price, empty name, duplicate id, non-list all refused', all(acall(B, 'POST', '/api/admin/products', body)[0] == 400 for body in (with_item(price=0), with_item(price=-5), with_item(name='  '), {'not': 'a list'}, [{**orig[0]}, {**orig[1], 'id': orig[0]['id']}])))
check('products: a valid price change is what Pix charges at once', acall(B, 'POST', '/api/admin/products', with_item(price=77.77))[0] == 200 and abs(pix({**order1, 'items': [{'name': p1['name'], 'q': 1}]})[1]['total'] - (77.77 + FEE)) < 0.01)
acall(B, 'POST', '/api/admin/products', orig)
check('settings: radius 0, invalid hour and negative fee refused, saved radius untouched', set_settings(lambda s: s['delivery'].update({'maxRadiusKm': 0}))[0] == 400 and set_settings(lambda s: s['store']['schedule']['seg'].update({'open': '25:00'}))[0] == 400 and set_settings(lambda s: s['delivery'].update({'tiers': [{'maxKm': 3, 'fee': -1}]}))[0] == 400 and get_settings()['delivery']['maxRadiusKm'] == 15.0)
import struct, zlib
IMG = os.environ['TEST_IMG_DIR']
def img(n): return open(f'{IMG}/{n}', 'rb').read()
def up(data, mime='image/png', **kw): return rcall(B, 'POST', '/api/admin/upload', {'dataUrl': f'data:{mime};base64,' + base64.b64encode(data).decode(), **kw}, {'Cookie': COOKIE})
def uploaded(url):
    r = urllib.request.urlopen(B + url); return r.read(), r.headers
def webp_size(b):
    t = b[12:16]
    if t == b'VP8 ': w, h = struct.unpack('<HH', b[26:30]); return w & 0x3fff, h & 0x3fff
    if t == b'VP8L': bits = struct.unpack('<I', b[21:25])[0]; return (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1
    if t == b'VP8X': return int.from_bytes(b[24:27], 'little') + 1, int.from_bytes(b[27:30], 'little') + 1
    return None
def png_chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
def blank_png(w, h):  # PNG cinza todo preto: o arquivo é pequeno, mas abre como uma imagem enorme
    return b'\x89PNG\r\n\x1a\n' + png_chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 0, 0, 0, 0)) + png_chunk(b'IDAT', zlib.compress((b'\x00' + bytes(w)) * h, 9)) + png_chunk(b'IEND', b'')
def status(path):
    try: return urllib.request.urlopen(B + path).status
    except urllib.error.HTTPError as e: return e.code
camera = img('camera.jpg'); alpha = img('alpha.png'); photo_webp = img('photo.webp'); plain = img('plain.png')

c, d, _ = up(camera, 'image/jpeg'); data, hd = uploaded(d['url']) if c == 201 else (b'', {})
check('upload: a camera JPEG (4000x3000, rotated by EXIF) becomes a small WEBP, upright, with the EXIF gone', c == 201 and data[:4] == b'RIFF' and data[8:12] == b'WEBP' and webp_size(data) == (1050, 1400) and b'SECRET-EXIF-MARK' not in data and b'GPS-FAKE-LOCATION' not in data and b'EXIF' not in data and b'SECRET-EXIF-MARK' in camera and len(data) < len(camera), (c, d, webp_size(data) if data else None))
check('upload: served as image/webp with nosniff, a sandbox CSP and a year of cache; the name is random', hd.get('Content-Type') == 'image/webp' and hd.get('X-Content-Type-Options') == 'nosniff' and 'sandbox' in (hd.get('Content-Security-Policy') or '') and 'immutable' in (hd.get('Cache-Control') or '') and re.fullmatch(r'/uploads/[a-z0-9]+-[a-f0-9]{16}\.webp', d.get('url', '')), dict(hd))
c, d, _ = up(alpha, 'image/png', kind='logo'); data, _ = uploaded(d['url']) if c == 201 else (b'', {})
check('upload: a PNG logo keeps its transparency and is cut to 640 px', c == 201 and b'ALPH' in data and webp_size(data) == (640, 640), (c, webp_size(data) if data else None))
c, d, _ = up(photo_webp, 'image/webp'); data, _ = uploaded(d['url']) if c == 201 else (b'', {})
check('upload: WEBP in, WEBP out, product photos cut to 1400 px (kept in proportion)', c == 201 and webp_size(data) == (1400, 700), (c, webp_size(data) if data else None))
c, d, _ = up(plain + b'<script>EVIL-MARK</script>'); data, _ = uploaded(d['url']) if c == 201 else (b'', {})
check('upload: code appended after the image never reaches the saved file', c == 201 and b'EVIL-MARK' not in data and b'<script' not in data, c)
check('upload: the kind decides the size: logo 640 px, product 1400 px', webp_size(uploaded(up(camera, 'image/jpeg', kind='logo')[1]['url'])[0]) == (480, 640))
svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'
check('upload: GIF, SVG, HTML, text, empty and non-data-URL are refused (only jpg, png and webp)', all(up(*a)[0] == 400 for a in [(b'GIF89a' + b'0' * 30, 'image/gif'), (svg, 'image/svg+xml'), (b'<html></html>',), (b'text', 'image/jpeg')]) and rcall(B, 'POST', '/api/admin/upload', {'dataUrl': 'data:image/png;base64,'}, {'Cookie': COOKIE})[0] == 400 and rcall(B, 'POST', '/api/admin/upload', {'dataUrl': 'http://evil.example/x.png'}, {'Cookie': COOKIE})[0] == 400 and up(b'GIF89a' + b'0' * 30, 'image/png')[1].get('error') == 'formato_nao_aceito')
check('upload: the file is judged by its content, not by the type the browser says', up(plain, 'image/jpeg')[0] == 201)
check('upload: broken image data and a decompression bomb (9000x9000 px) are refused', up(b'\xff\xd8\xff\xe0' + b'garbage' * 50, 'image/jpeg')[1].get('error') == 'imagem_invalida' and up(blank_png(9000, 9000))[1].get('error') == 'imagem_invalida')
c, d, _ = up(b'\x89PNG\r\n\x1a\n' + b'0' * (5 * 1024 * 1024 + 10)); c2, d2, _ = rcall(B, 'POST', '/api/admin/upload', {'dataUrl': 'data:image/png;base64,' + 'A' * (10 * 1024 * 1024)}, {'Cookie': COOKIE})
check('upload: more than 5 MB -> 413, and a body above the limit -> 413 as JSON too', c == 413 and d.get('error') == 'imagem_grande_demais' and c2 == 413 and d2.get('error') == 'imagem_grande_demais', (c, d, c2))
names = os.listdir(SITE + '/uploads')
check('upload: only server-made file names exist, all .webp', names and all(re.fullmatch(r'[a-z0-9]+-[a-f0-9]{16}\.webp', n) for n in names), names)
open(SITE + '/uploads/x.html', 'w').write('<script>1</script>')
check('uploads folder: no listing, no path traversal, nothing but server-made images', all(status(p) == 404 for p in ['/uploads/', '/uploads', '/uploads/..%2fserver.js', '/uploads/%2e%2e/orders.json', '/uploads/../server.js', '/uploads/x.html', '/uploads/.env']), [(p, status(p)) for p in ['/uploads/', '/uploads/..%2fserver.js', '/uploads/x.html']])
os.remove(SITE + '/uploads/x.html')

# ============================================================ CARDÁPIO: PROMOÇÃO, ESTOQUE, ORDEM E LOGO
def cur(): return acall(B, 'GET', '/api/admin/products')[1]
def put(lst): return acall(B, 'POST', '/api/admin/products', lst)
def menu(): return call(B, 'GET', '/api/menu')[1]
def charge(items): c, d = pix({**order1, 'items': items}); return c, d, (posts()[-1]['body'] if c == 200 else None)
base_list = cur()
def mod(i, **kw): l = json.loads(json.dumps(base_list)); l[i].update(kw); return l
promo_ok = round(p1['price'] * 0.85, 2); promo_total = round(promo_ok * 2 + p2['price'] + FEE, 2)
c, mrk, mh = rcall(B, 'GET', '/api/menu')
check('menu: the public menu is /api/menu (never cached); the full list needs the login', c == 200 and len(mrk) == len(base_list) and mh.get('Cache-Control') == 'no-store' and call(B, 'GET', '/api/admin/products')[0] == 401)
check('promo: equal to the price, above it, zero, negative and text are refused (promo_invalida)', all(put(mod(0, promo=v))[1].get('error') == 'promo_invalida' for v in (p1['price'], p1['price'] + 5, 0, -1, 'abc', p1['price'] - 0.001)))
check('promo: empty or null means no discount, nothing stored', put(mod(0, promo=''))[0] == 200 and 'promo' not in cur()[0] and put(mod(0, promo=None))[0] == 200 and 'promo' not in cur()[0])
check('promo: a valid promo is stored and the public menu shows both prices', put(mod(0, promo=promo_ok))[0] == 200 and menu()[0]['promo'] == promo_ok and menu()[0]['price'] == p1['price'])
reset(); c, d, b = charge([{'name': p1['name'], 'q': 2}, {'name': p2['name'], 'q': 1}])
check('promo: checkout charges the promo price (total and what goes to Mercado Pago)', c == 200 and abs(d['total'] - promo_total) < 0.005 and abs(b['transaction_amount'] - promo_total) < 0.005 and b['additional_info']['items'][0]['unit_price'] == promo_ok, (c, d.get('total'), promo_total))
c, d, b = charge([{'name': p1['name'], 'price': 0.01, 'promo': 0.01, 'unitPrice': 0.01, 'q': 2}, {'name': p2['name'], 'price': 0.01, 'q': 1}])
check('promo: a price sent by the browser is ignored (the server menu decides)', c == 200 and abs(d['total'] - promo_total) < 0.005, (c, d.get('total')))
c, d, b = charge([{'id': p1['id'], 'name': 'nome que nao vale', 'q': 1}])
check('promo: an item sent with its id is priced from that product', c == 200 and abs(d['total'] - (promo_ok + FEE)) < 0.005, (c, d.get('total')))
check('promo: the shown total with the old (higher) price is accepted, the real one is charged', abs(pix({**order1, 'items': [{'name': p1['name'], 'q': 2}, {'name': p2['name'], 'q': 1}], 'expectedTotal': expected_total})[1]['total'] - promo_total) < 0.005)
put(mod(0, promo=None)); c, d, b = charge([{'name': p1['name'], 'q': 2}, {'name': p2['name'], 'q': 1}])
check('promo: taking the promo away brings the regular price back at once', c == 200 and abs(d['total'] - expected_total) < 0.005, (c, d.get('total'), expected))
bad_file = json.loads(json.dumps(base_list)); bad_file[0]['promo'] = 999
json.dump(bad_file, open(SITE + '/products.json', 'w', encoding='utf-8'))
c, d, b = charge([{'name': p1['name'], 'q': 2}, {'name': p2['name'], 'q': 1}])
check('promo: a wrong promo that got into the file (above the price) never makes the customer pay more', c == 200 and abs(d['total'] - expected_total) < 0.005, (c, d.get('total'), expected))
put(base_list)
h = mod(1, hidden=True); name_h = base_list[1]['name']
check('hidden: the owner can hide a product: gone from the public menu, still in the owner list', put(h)[0] == 200 and all(m['name'] != name_h for m in menu()) and cur()[1]['hidden'] is True)
c, d, _ = charge([{'name': name_h, 'q': 1}])
check('hidden: a hidden product cannot be bought even with a copy of the old menu (item_indisponivel)', c == 400 and d.get('error') == 'item_indisponivel', (c, d))
put(mod(1, paused=True)); c, d, _ = charge([{'name': name_h, 'q': 1}])
check('sold out: still on the menu (as paused) but cannot be bought', next(m for m in menu() if m['name'] == name_h)['paused'] is True and c == 400 and d.get('error') == 'item_indisponivel', (c, d))
put(base_list); c, d, _ = charge([{'name': name_h, 'q': 1}])
check('available again: back on the menu and can be bought', c == 200 and any(m['name'] == name_h for m in menu()))
names_before = [p['name'] for p in base_list]
rev = json.loads(json.dumps(base_list)); rev[:6] = rev[:6][::-1]
check('order: the owner order is saved, written to the file and served by the menu in that order', put(rev)[0] == 200 and [m['name'] for m in menu()] == [p['name'] for p in rev] and [p['name'] for p in json.load(open(SITE + '/products.json', encoding='utf-8'))] == [p['name'] for p in rev] and [p['name'] for p in cur()] == [p['name'] for p in rev])
newp = {'id': 'prod_novo_1', 'name': 'Sundae de Teste', 'price': 12.5, 'promo': 9.9, 'cat': 'Sobremesas', 'img': '', 'desc': 'novo'}
c, _ = put(rev + [newp]); m = menu()
check('new product: added last, a new category goes to the end of the menu, promo kept', c == 200 and m[-1]['name'] == 'Sundae de Teste' and m[-1]['promo'] == 9.9 and [x['cat'] for x in m][-1] == 'Sobremesas' and len(m) == len(rev) + 1)
check('products: two with the same name (any capitals) are refused (nome_repetido)', put(rev + [{**newp, 'id': 'dup_1'}, {**newp, 'id': 'dup_2', 'name': 'SUNDAE DE TESTE'}])[1].get('error') == 'nome_repetido')
for photo in ['', '/uploads/abc-1234567890abcdef.webp', 'https://example.com/a.jpg', '1586190848861-99aa4a171e90']:
    check(f'photo "{photo[:30]}" is accepted', put(mod(0, img=photo))[0] == 200)
check('photo: scripts, protocol-less links, data URLs, path tricks, spaces and huge values are refused (foto_invalida)', all(put(mod(0, img=v))[1].get('error') == 'foto_invalida' for v in ['javascript:alert(1)', '//evil.example/x.png', 'data:image/png;base64,AAAA', '/uploads/../server.js', 'http://x y.png', 'x' * 700]))
put(base_list)
big = base_list + [{'id': f'extra_{i}', 'name': f'Produto extra {i} ' + 'x' * 40, 'price': 10 + i / 100, 'cat': 'Extras', 'desc': 'd' * 200} for i in range(400)]
check('products: a long list (over 100 KB) is accepted', len(json.dumps(big)) > 100000 and put(big)[0] == 200 and len(menu()) == len(big))
put(base_list)
check('products: the list is back to the original and no half-written .tmp file is left', [p['name'] for p in cur()] == names_before and not [n for n in os.listdir(SITE) if n.endswith('.tmp')], [n for n in os.listdir(SITE) if n.endswith('.tmp')])
def set_logo(v): return set_settings(lambda s: s['store'].update({'logo': v}))
check('logo: an uploaded photo can be set as the store logo; it is kept in the settings', set_logo('/uploads/abc-1234567890abcdef.webp')[0] == 200 and get_settings()['store']['logo'] == '/uploads/abc-1234567890abcdef.webp')
check('logo: links, path tricks and other files are refused (logo_invalida), the saved logo stays', all(set_logo(v)[1].get('error') == 'logo_invalida' for v in ['http://evil.example/x.png', '/uploads/../server.js', 'javascript:1', '/uploads/a.html']) and get_settings()['store']['logo'] == '/uploads/abc-1234567890abcdef.webp')
check('logo: removing it (empty) is accepted: the site goes back to its own logo', set_logo('')[0] == 200 and get_settings()['store']['logo'] == '')
set_settings(lambda s: s['store'].pop('logo', None))

# ============================================================ MOTOBOY SÓ DEPOIS QUE O RESTAURANTE ACEITA
def paid_delivery():
    c, d = pix(deliv('91000003')); call(MP, 'GET', f"/__approve/{d['paymentId']}"); call(B, 'GET', f"/api/mercadopago/payment/{d['paymentId']}/status"); return d['orderId']
oid = paid_delivery(); o = board(oid)
check('courier: a PAID delivery order is only "novo": the courier is NOT called at payment', o['status'] == 'novo' and o['paymentConfirmed'] is True and 'courier' not in o, o.get('courier'))
acall(B, 'PATCH', f'/api/orders/{oid}', {'status': 'preparando'}); o = board(oid)
check('courier: accepting (novo -> preparando) triggers the courier request', o.get('courier', {}).get('provider') == '99' and o['courier']['status'] == 'aguardando_integracao', o.get('courier'))
t0 = o['courier']['acceptedAt']; acall(B, 'PATCH', f'/api/orders/{oid}', {'status': 'entrega'}); acall(B, 'PATCH', f'/api/orders/{oid}', {'status': 'novo'}); acall(B, 'PATCH', f'/api/orders/{oid}', {'status': 'preparando'})
check('courier: later steps and re-accepting never call it twice', board(oid)['courier']['acceptedAt'] == t0 and open(LOGD + '/server-main.log', encoding='utf-8').read().count(f'pedido {oid} aceito') == 1)
oid2 = paid_delivery(); acall(B, 'PATCH', f'/api/orders/{oid2}', {'status': 'cancelado'})
check('courier: a cancelled order never calls it', 'courier' not in board(oid2))
check('board: only paid orders are listed, PATCH limits hold', all(o2.get('paymentConfirmed') is True for o2 in acall(B, 'GET', '/api/orders')[1]['orders']) and acall(B, 'PATCH', f'/api/orders/{oid}', {'status': 'hacked'})[0] == 400 and acall(B, 'PATCH', '/api/orders/DAD-0000', {'status': 'concluido'})[0] == 404)

# ============================================================ SÓ ENTREGA, SÓ PAGAMENTO ONLINE (sem retirada, sem balcão)
n_orders = len(orders_file())
c, d = call(B, 'POST', '/api/orders', {'customer': {'name': 'Carlos Dias', 'phone': '51977776666'}, 'order': {'items': [{'name': p1['name'], 'q': 1}], 'mode': 'retirada', 'unitId': 'passo-dareia'}, 'payMode': 'balcao_vr'})
check('no counter payment: the old pay-at-counter route is gone (JSON 404) and creates nothing', c == 404 and d.get('error') == 'rota_nao_encontrada' and len(orders_file()) == n_orders, (c, d))
n_posts = len(posts())
refused = [pix({**order1, 'mode': 'retirada'}), pix({**order1, 'mode': 'pickup'}), pix({**order1, 'pickup': True}), card({**order1, 'mode': 'retirada'})]
check('no pick-up: "retirada", "pickup" and pickup=true are refused on Pix and card (so_entrega) and never reach Mercado Pago', all(c == 400 and d.get('error') == 'so_entrega' for c, d in refused) and len(posts()) == n_posts, refused)
check('no pick-up: a delivery order without a confirmed address is still refused (endereco_nao_confirmado)', pix({**base_items, 'mode': 'entrega'})[1].get('error') == 'endereco_nao_confirmado')
def legacy_pay(): return {'id': 'balcao_vr', 'name': 'Vale-Refeição no Balcão', 'enabled': True, 'type': 'pickup'}
c, _ = set_settings(lambda s: s['payments'].update({'balcao_vr': legacy_pay()}))
check('no counter payment: a method of type "pickup" sent by an old panel is not saved', c == 200 and 'balcao_vr' not in get_settings()['payments'] and 'balcao_vr' not in json.load(open(SITE + '/settings.json', encoding='utf-8'))['payments'])
sj = json.load(open(SITE + '/settings.json', encoding='utf-8')); sj['payments']['balcao_vr'] = legacy_pay(); json.dump(sj, open(SITE + '/settings.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
check('no counter payment: an old settings file that still has one is never served by the settings route', 'balcao_vr' not in get_settings()['payments'])
baseline()
check('no counter payment: the shipped settings.json has only online methods', all(p.get('type') == 'online' for p in json.load(open(SITE + '/settings.json', encoding='utf-8'))['payments'].values()))

# ============================================================ ACOMPANHAR PEDIDO (link privado do cliente)
import urllib.parse as uparse
TOKEN_RE = re.compile(r'^[A-Za-z0-9_-]{22}$')
def track(tok): return rcall(B, 'GET', '/api/track/' + uparse.quote(tok, safe=''))
def approve(pid): call(MP, 'GET', f'/__approve/{pid}'); return call(B, 'GET', f'/api/mercadopago/payment/{pid}/status')[1]
reset()
c, px1 = pix(order1); tok1 = px1.get('trackToken', '')
check('track: a new Pix order comes with a private 22-character code (not the order number)', c == 200 and TOKEN_RE.match(tok1) and px1['orderId'] not in tok1, px1.get('trackToken'))
c, t0, hd = track(tok1)
check('track: an unpaid Pix shows aguardando_pagamento; the answer is never cached or indexed', c == 200 and t0['status'] == 'aguardando_pagamento' and t0['paid'] is False and t0['pay'] == 'pix' and t0['expired'] is False and t0['orderId'] == px1['orderId'] and hd.get('Cache-Control') == 'no-store' and 'noindex' in (hd.get('X-Robots-Tag') or ''), (c, t0))
check('track: the preparation time comes from the store settings', t0['prepMin'] == get_settings()['store']['preparationTimeMin'] and t0['prepMax'] == get_settings()['store']['preparationTimeMax'] and t0['prepMax'] > 0, t0)
c, pxd = pix(deliv('91350050')); c2, td, _ = track(pxd['trackToken']); raw = json.dumps(td)
check('track: no personal data in the answer (name, phone, e-mail, CPF, street, payment id)', c == 200 and c2 == 200 and 'mode' not in td and all(x not in raw for x in (cust['name'], 'Joana', cust['phone'], EMAIL, CPF, 'Rua Teste', pxd['paymentId'], 'addressDetails', 'customer')), raw[:200])
st = approve(px1['paymentId']); c, t, _ = track(tok1)
check('track: once Mercado Pago confirms, the order is novo and paid, each step with its time', st.get('confirmed') is True and t['status'] == 'novo' and t['paid'] is True and [h['status'] for h in t['history']] == ['aguardando_pagamento', 'novo'] and t['history'][0]['at'] <= t['history'][1]['at'] <= t['now'], t)
seen_status = []
for s_ in ('preparando', 'entrega', 'concluido'):
    acall(B, 'PATCH', f"/api/orders/{px1['orderId']}", {'status': s_}); seen_status.append(track(tok1)[1]['status'])
acall(B, 'PATCH', f"/api/orders/{px1['orderId']}", {'status': 'concluido'}); t = track(tok1)[1]
check('track: the restaurant board drives the customer view (preparando, entrega, concluido) with the time of each step, no repeats', seen_status == ['preparando', 'entrega', 'concluido'] and [h['status'] for h in t['history']] == ['aguardando_pagamento', 'novo', 'preparando', 'entrega', 'concluido'] and all(a['at'] <= b['at'] for a, b in zip(t['history'], t['history'][1:])), t['history'])
c, pxc = pix(order1); approve(pxc['paymentId']); acall(B, 'PATCH', f"/api/orders/{pxc['orderId']}", {'status': 'cancelado'})
check('track: a cancelled order shows cancelado', track(pxc['trackToken'])[1]['status'] == 'cancelado')
c, cd2 = card(order1); t = track(cd2.get('trackToken', ''))[1]
check('track: an approved card payment is novo and paid (pay cartao)', c == 200 and t.get('status') == 'novo' and t['paid'] is True and t['pay'] == 'cartao', t)
c, cp = call(B, 'POST', '/api/mercadopago/card-payment', {'customer': cust, 'order': order1, 'card': {'token': 'tok_pending_0000000000000', 'paymentMethodId': 'visa', 'installments': 1}}); t = track(cp.get('trackToken', ''))[1]
check('track: a card payment still in analysis is aguardando_pagamento (pay cartao)', c == 200 and t.get('status') == 'aguardando_pagamento' and t['pay'] == 'cartao' and t['paid'] is False, t)
c, pe = pix(order1); of = orders_file(); of[pe['orderId']]['expires_at'] = '2020-01-01T00:00:00.000-03:00'
json.dump(of, open(SITE + '/orders.json', 'w', encoding='utf-8')); acall(B, 'GET', '/api/orders')  # o servidor relê o arquivo
check('track: a Pix past its expiry that was never paid is marked expired', track(pe['trackToken'])[1].get('expired') is True and track(tok1)[1]['expired'] is False)
wrong = ['x', 'a' * 21, 'a' * 23, 'A' * 22, px1['orderId'], 'DAD-1234', '..%2f..%2forders.json', tok1[:-1] + ('A' if tok1[-1] != 'A' else 'B')]
check('track: wrong, short or long codes, an order number and path tricks all answer 404 pedido_nao_encontrado', all(track(w)[0] == 404 and track(w)[1].get('error') == 'pedido_nao_encontrado' for w in wrong), [(w, track(w)[0]) for w in wrong])
check('track: no code, an extra path and unknown API routes answer a JSON 404, not the home page', all(rcall(B, 'GET', p)[0] == 404 and isinstance(rcall(B, 'GET', p)[1], dict) for p in ['/api/track/', '/api/track', '/api/track/../orders.json', '/api/nope']))
toks = [pix(order1)[1]['trackToken'] for _ in range(15)] + [tok1, pxd['trackToken'], pxc['trackToken']]
check('track: every order gets its own random code', len(set(toks)) == len(toks) and all(TOKEN_RE.match(x) for x in toks))
leaks = ''.join(json.dumps(call(B, 'GET', p)[1]) for p in ['/api/menu', '/api/admin/settings', '/api/stores', '/api/store/status', '/api/mercadopago/config'])
check('track: the code is in no other public answer, and the order list still needs the login', tok1 not in leaks and call(B, 'GET', '/api/orders')[0] == 401)

# ============================================================ HOSPEDAGEM: PASTA DE DADOS (DATA_DIR), SENHA OBRIGATÓRIA E SAÚDE
import subprocess, tempfile, shutil, socket, hashlib, atexit
def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p
def sha(path): return hashlib.sha256(open(path, 'rb').read()).hexdigest()
HOSTED = tempfile.mkdtemp(prefix='dads-host-'); EXTRA_DIRS = []; RUNNING = []
def _cleanup_hosting():
    for p in RUNNING:
        if p.poll() is None: p.kill()
    for d in [HOSTED] + EXTRA_DIRS:
        for root, dirs, files in os.walk(d):
            try: os.chmod(root, 0o700)
            except OSError: pass
        shutil.rmtree(d, ignore_errors=True)
atexit.register(_cleanup_hosting)

# Cópia do programa SEM nenhum arquivo de dados (como a imagem Docker): é daqui que o servidor parte
APP2 = HOSTED + '/app'; os.makedirs(APP2)
for f in ('server.js', 'package.json', 'index.html', 'admin.html', 'logo.png', 'products.json'): shutil.copy(f'{SITE}/{f}', f'{APP2}/{f}')
seed = json.load(open(f'{SITE}/settings.json', encoding='utf-8')); seed['store'].update({'isOpenManual': True, 'autoSchedule': False})
json.dump(seed, open(f'{APP2}/settings.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
os.symlink(f'{SITE}/node_modules', f'{APP2}/node_modules')
APP2_FILES = sorted(os.listdir(APP2))

def start_node(env_extra, app=APP2, wrapper=()):
    port = free_port()
    env = {'PATH': os.environ['PATH'], 'HOME': os.environ.get('HOME', '/tmp'), 'PORT': str(port), 'LOGIN_DELAY_MS': '5', **env_extra}
    log = open(f'{LOGD}/host-{port}.log', 'w')
    p = subprocess.Popen([*wrapper, 'node', 'server.js'], cwd=app, env=env, stdout=log, stderr=subprocess.STDOUT); RUNNING.append(p)
    return p, port
def logtext(port): return open(f'{LOGD}/host-{port}.log', encoding='utf-8').read()
def wait_up(p, port, secs=10):
    t0 = time.time()
    while time.time() - t0 < secs:
        if p.poll() is not None: return False
        try:
            if urllib.request.urlopen(f'http://127.0.0.1:{port}/healthz', timeout=1).read() == b'ok': return True
        except Exception: time.sleep(0.15)
    return False
def stop_node(p):
    if p.poll() is None: p.terminate()
    try: return p.wait(timeout=8)
    except subprocess.TimeoutExpired: p.kill(); return p.wait()
PRIVATE_NET = bool(shutil.which('unshare')) and subprocess.run(['unshare', '-rn', 'true'], capture_output=True).returncode == 0
def must_refuse(env_extra, app=APP2, private_net=False):  # (código de saída, registro) de uma partida que tem que falhar rápido
    # private_net: roda numa rede privada (unshare -rn), para que um servidor que por defeito LIGASSE em 0.0.0.0 não abra porta de verdade
    p, port = start_node(env_extra, app, ['unshare', '-rn'] if (private_net and PRIVATE_NET) else [])
    try: code = p.wait(timeout=10)
    except subprocess.TimeoutExpired: stop_node(p); code = None
    return code, logtext(port)
PW = 'Segredo-de-teste-9Xk'
def hosted_login(port):
    c, d, hd = rcall(f'http://127.0.0.1:{port}', 'POST', '/api/admin/login', {'password': PW}); return (hd.get('Set-Cookie') or '').split(';')[0]
def hcall(port, method, path, body=None, cookie=None): return call(f'http://127.0.0.1:{port}', method, path, body, {'Cookie': cookie} if cookie else None)

# ---- 1. primeira partida numa pasta vazia
D1 = HOSTED + '/disco'                      # ainda não existe: o servidor tem que criar
p1, port1 = start_node({'DATA_DIR': D1, 'ADMIN_PASSWORD': PW, 'SESSION_SECRET': 'segredo-longo-de-teste', 'MERCADOPAGO_ACCESS_TOKEN': 'TESTTOKEN', 'MERCADOPAGO_PUBLIC_KEY': 'TEST-PUBLIC-KEY',
                        'APP_URL': 'https://dads.example.test', 'MP_API_BASE': MP, 'GEO_API_BASE': MP + '/geo', 'MP_RECONCILE_MS': '600000'})
up1 = wait_up(p1, port1)
log1 = logtext(port1)
check('hosting: first start on an empty DATA_DIR creates the folder, uploads/, an empty orders.json and the shipped menu and settings', up1 and os.path.isdir(D1 + '/uploads') and json.load(open(D1 + '/orders.json')) == {} and sha(D1 + '/products.json') == sha(APP2 + '/products.json') and sha(D1 + '/settings.json') == sha(APP2 + '/settings.json'), (up1, os.listdir(D1) if os.path.isdir(D1) else None, log1[-300:]))
check('hosting: the log says which data folder is in use (and warns when it is on the same disk as the program)', f'Pasta de dados: {D1}' in log1 and 'mesmo disco do programa' in log1, log1[-400:])
check('hosting: the program folder gets no data files', sorted(os.listdir(APP2)) == APP2_FILES, sorted(os.listdir(APP2)))
c, d, hd = rcall(f'http://127.0.0.1:{port1}', 'GET', '/healthz')
check('hosting: /healthz answers ok without login, never cached, nothing else', c == 200 and d == b'ok' and hd.get('Cache-Control') == 'no-store', (c, d))

# ---- 2. o que o painel e os clientes gravam vai para o DATA_DIR, não para a pasta do programa
cookie1 = hosted_login(port1)
products1 = hcall(port1, 'GET', '/api/admin/products', None, cookie1)[1]
shipped_hash = sha(APP2 + '/products.json'); shipped_settings = sha(APP2 + '/settings.json')
edited = json.loads(json.dumps(products1)); edited[0]['price'] = 61.5
c_prod, _ = hcall(port1, 'POST', '/api/admin/products', edited, cookie1)
c_set, st1 = hcall(port1, 'POST', '/api/admin/settings', {**seed, 'store': {**seed['store'], 'closedNotice': 'AVISO-DE-TESTE'}}, cookie1)
check('hosting: menu and settings saved by the owner land in DATA_DIR; the shipped copies next to server.js stay untouched', c_prod == 200 and c_set == 200 and json.load(open(D1 + '/products.json'))[0]['price'] == 61.5 and 'AVISO-DE-TESTE' in open(D1 + '/settings.json', encoding='utf-8').read() and sha(APP2 + '/products.json') == shipped_hash and sha(APP2 + '/settings.json') == shipped_settings)
c, d, _ = rcall(f'http://127.0.0.1:{port1}', 'POST', '/api/admin/upload', {'dataUrl': 'data:image/png;base64,' + base64.b64encode(plain).decode(), 'kind': 'product'}, {'Cookie': cookie1})
photo_url = d.get('url', ''); photo_file = D1 + photo_url
c2, body2, hd2 = rcall(f'http://127.0.0.1:{port1}', 'GET', photo_url)
c3, body3, _ = rcall(f'http://127.0.0.1:{port1}', 'GET', '/uploads/aaaaaaaaaaaaaaaa.webp')
check('hosting: an uploaded photo is written to DATA_DIR/uploads and served from there (nosniff); a missing photo is a 404, not the home page', c == 201 and os.path.isfile(photo_file) and not os.path.exists(APP2 + '/uploads') and c2 == 200 and hd2.get('Content-Type') == 'image/webp' and hd2.get('X-Content-Type-Options') == 'nosniff' and c3 == 404 and not (isinstance(body3, bytes) and b'<html' in body3.lower()), (c, d, c2, c3))
menu1 = hcall(port1, 'GET', '/api/menu')[1]
c, ord1 = hcall(port1, 'POST', '/api/mercadopago/pix', {'customer': cust, 'order': {**deliv('91350050'), 'items': [{'name': menu1[0]['name'], 'q': 1}]}})
saved1 = json.load(open(D1 + '/orders.json')).get(ord1.get('orderId'), {})
check('hosting: orders are saved in DATA_DIR/orders.json (price 61.50 from the owner edit), none next to server.js', c == 200 and abs(saved1.get('subtotal', 0) - 61.5) < 0.01 and not os.path.exists(APP2 + '/orders.json'), (c, ord1))
check('hosting: writes leave no half-written .tmp file in DATA_DIR', not [n for n in os.listdir(D1) if n.endswith('.tmp')], os.listdir(D1))
hash_prod_after = sha(D1 + '/products.json'); hash_set_after = sha(D1 + '/settings.json')

# ---- 3. reinício e versão nova não sobrescrevem nada
code = stop_node(p1)
check('hosting: SIGTERM ends the server cleanly (exit 0) and says so', code == 0 and 'encerrando o servidor' in logtext(port1), (code, logtext(port1)[-200:]))
json.dump([{**json.load(open(APP2 + '/products.json'))[0], 'name': 'SEMENTE-NOVA-DA-VERSAO'}], open(APP2 + '/products.json', 'w', encoding='utf-8'))   # a "versão nova" traz outro cardápio de partida
open(D1 + '/products.json.99999.tmp', 'w').write('lixo de gravação interrompida')
orders_before = open(D1 + '/orders.json').read()
p2, port2 = start_node({'DATA_DIR': D1, 'ADMIN_PASSWORD': PW, 'SESSION_SECRET': 'segredo-longo-de-teste'})
up2 = wait_up(p2, port2)
check('hosting: a restart or a new release never overwrites the data (menu, settings, orders and photos are as the owner left them)', up2 and sha(D1 + '/products.json') == hash_prod_after and sha(D1 + '/settings.json') == hash_set_after and open(D1 + '/orders.json').read() == orders_before and os.path.isfile(photo_file) and 'SEMENTE-NOVA' not in open(D1 + '/products.json', encoding='utf-8').read())
check('hosting: leftovers of an interrupted write are cleaned at start', not os.path.exists(D1 + '/products.json.99999.tmp'))
check('hosting: the owner menu is what customers get after the restart', hcall(port2, 'GET', '/api/menu')[1][0]['price'] == 61.5)
stop_node(p2)

# ---- 4. pasta de dados que não dá para usar: falha rápida, com mensagem clara
code_a, log_a = must_refuse({'DATA_DIR': photo_file, 'ADMIN_PASSWORD': PW})      # um ARQUIVO no lugar da pasta
check('hosting: DATA_DIR that is a file -> exit 1 right away with a clear message', code_a == 1 and 'ERRO' in log_a and 'pasta de dados' in log_a and 'DATA_DIR' in log_a, (code_a, log_a[-300:]))
code_b, log_b = must_refuse({'DATA_DIR': '/proc/dads-sem-disco/dados', 'ADMIN_PASSWORD': PW})   # nem dá para criar
check('hosting: DATA_DIR that cannot be created (disk not mounted) -> exit 1 with a clear message', code_b == 1 and 'ERRO' in log_b and 'disco persistente' in log_b, (code_b, log_b[-300:]))
if os.geteuid() != 0:
    RO = HOSTED + '/somente-leitura'; os.makedirs(RO + '/uploads'); os.chmod(RO, 0o500)
    code_c, log_c = must_refuse({'DATA_DIR': RO, 'ADMIN_PASSWORD': PW})
    check('hosting: DATA_DIR without write permission -> exit 1 with a clear message', code_c == 1 and 'ERRO' in log_c and 'permissão de escrita' in log_c, (code_c, log_c[-300:]))
    # disco que deixa de aceitar gravação com o servidor ligado: a verificação de saúde avisa (a hospedagem reinicia)
    p3, port3 = start_node({'DATA_DIR': HOSTED + '/disco3', 'ADMIN_PASSWORD': PW}); up3 = wait_up(p3, port3)
    os.chmod(HOSTED + '/disco3', 0o500); c_sick = rcall(f'http://127.0.0.1:{port3}', 'GET', '/healthz')[0]
    os.chmod(HOSTED + '/disco3', 0o700); c_ok = rcall(f'http://127.0.0.1:{port3}', 'GET', '/healthz')[0]; stop_node(p3)
    check('hosting: /healthz turns 503 while the data folder refuses writes and 200 again when it works', up3 and c_sick == 503 and c_ok == 200, (c_sick, c_ok))
else:
    check('hosting: (running as root: the permission cases cannot be tested here)', True)

# ---- 5. servidor aberto para a rede só liga com senha própria; sem tocar no disco antes
D5 = HOSTED + '/disco5'
code_e, log_e = must_refuse({'HOST': '0.0.0.0', 'DATA_DIR': D5}, private_net=True)
check('hosting: exposed (HOST=0.0.0.0) without ADMIN_PASSWORD refuses to start, with one clear line, before touching the disk', code_e == 1 and 'ADMIN_PASSWORD' in log_e and 'ERRO' in log_e and not os.path.exists(D5), (code_e, log_e[-300:], os.path.exists(D5)))
code_f, log_f = must_refuse({'HOST': '0.0.0.0', 'ADMIN_PASSWORD': 'dads123', 'DATA_DIR': D5}, private_net=True)
check('hosting: exposed with the published old password (dads123) is refused too', code_f == 1 and 'já foi publicada' in log_f, (code_f, log_f[-300:]))
# Com senha própria o servidor aberto liga. Para não abrir porta de verdade na rede (nem por um segundo), este teste roda dentro de
# uma rede privada (unshare -rn): o servidor escuta em 0.0.0.0, mas só enxerga o próprio loopback dessa rede, e o curl roda lá dentro.
if shutil.which('unshare') and subprocess.run(['unshare', '-rn', 'true'], capture_output=True).returncode == 0:
    script = r'''ip link set lo up 2>/dev/null || true
cd "$APP2"
HOST=0.0.0.0 PORT=3999 ADMIN_PASSWORD="$PW" DATA_DIR="$D5" LOGIN_DELAY_MS=5 node server.js > "$LOGFILE" 2>&1 &
pid=$!
up=0
for i in $(seq 1 60); do curl -s -o /dev/null --max-time 1 http://127.0.0.1:3999/healthz && { up=1; break; }; sleep 0.2; done
bad=$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d '{"password":"dads123"}' http://127.0.0.1:3999/api/admin/login)
good=$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d "{\"password\":\"$PW\"}" http://127.0.0.1:3999/api/admin/login)
kill $pid; wait $pid 2>/dev/null
echo "up=$up bad=$bad good=$good"'''
    r5 = subprocess.run(['unshare', '-rn', 'sh', '-c', script], capture_output=True, text=True, timeout=60, env={'PATH': os.environ['PATH'], 'HOME': os.environ.get('HOME', '/tmp'), 'APP2': APP2, 'PW': PW, 'D5': D5, 'LOGFILE': f'{LOGD}/host-exposed.log'})
    log5 = open(f'{LOGD}/host-exposed.log', encoding='utf-8').read()
    check('hosting: exposed (0.0.0.0) with its own password starts and checks the password (warns that SESSION_SECRET is missing)', 'up=1 bad=401 good=200' in r5.stdout and 'SESSION_SECRET' in log5 and 'o servidor está aberto em 0.0.0.0' in log5 and os.path.isfile(D5 + '/orders.json'), (r5.stdout, r5.stderr[-200:], log5[-300:]))
else:
    check('hosting: (no private network available here: the exposed-with-password start was not run, to avoid opening a real port)', True)
p6, port6 = start_node({'ADMIN_PASSWORD': ''}); up6 = wait_up(p6, port6)
check('hosting: on 127.0.0.1 without ADMIN_PASSWORD it still starts, with the old warning (nothing changes for local use)', up6 and 'ADMIN_PASSWORD não está configurada' in logtext(port6) and 'ao lado do server.js' in logtext(port6), logtext(port6)[-300:])
stop_node(p6)

# ---- 6. REQUIRE_VOLUME: disco que não é de verdade não serve
code_g, log_g = must_refuse({'DATA_DIR': HOSTED + '/disco7', 'ADMIN_PASSWORD': PW, 'REQUIRE_VOLUME': '1'})
check('hosting: REQUIRE_VOLUME=1 on the same disk as the program (what a container without a mounted disk looks like) refuses to start', code_g == 1 and 'REQUIRE_VOLUME' in log_g and 'mesmo disco' in log_g, (code_g, log_g[-300:]))
SHM = f'/dev/shm/dads-test-{os.getpid()}'
if os.path.isdir('/dev/shm') and os.access('/dev/shm', os.W_OK) and os.stat('/dev/shm').st_dev != os.stat(HOSTED).st_dev:
    EXTRA_DIRS.append(SHM)
    p7, port7 = start_node({'DATA_DIR': SHM, 'ADMIN_PASSWORD': PW, 'REQUIRE_VOLUME': '1'}); up7 = wait_up(p7, port7)
    check('hosting: REQUIRE_VOLUME=1 on a different disk starts normally (no warning about the disk)', up7 and 'mesmo disco' not in logtext(port7), logtext(port7)[-300:])
    stop_node(p7)
else:
    check('hosting: (no second disk available here to test REQUIRE_VOLUME on a separate disk)', True)

# ---- 7. pasta de dados dentro da pasta do programa nunca sai como arquivo estático
p8, port8 = start_node({'DATA_DIR': APP2 + '/dados', 'ADMIN_PASSWORD': PW}); up8 = wait_up(p8, port8)
leak = [rcall(f'http://127.0.0.1:{port8}', 'GET', f'/dados/{n}')[0] for n in ('orders.json', 'products.json', 'settings.json')] + [rcall(f'http://127.0.0.1:{port8}', 'GET', '/DADOS/orders.json')[0]]
check('hosting: a data folder inside the program folder is never served as static files (orders hold customer data)', up8 and os.path.isfile(APP2 + '/dados/orders.json') and leak == [404, 404, 404, 404], leak)
stop_node(p8)

# ---- 8. atrás do proxy https da hospedagem
c, d, hd = rcall(B, 'POST', '/api/admin/login', {'password': 'testpass-123'}, {'X-Forwarded-Proto': 'https'}); c0, d0, hd0 = rcall(B, 'POST', '/api/admin/login', {'password': 'testpass-123'})
check('hosting: behind the https proxy (X-Forwarded-Proto) the login cookie is Secure and HttpOnly; plain http does not force Secure', c == 200 and 'Secure' in (hd.get('Set-Cookie') or '') and 'HttpOnly' in (hd.get('Set-Cookie') or '') and 'Secure' not in (hd0.get('Set-Cookie') or ''), (hd.get('Set-Cookie'), hd0.get('Set-Cookie')))
check('hosting: /healthz also works in the default mode (no DATA_DIR) and needs no login', rcall(B, 'GET', '/healthz')[0] == 200 and rcall(B0, 'GET', '/healthz')[0] == 200)

print(f"\n{sum(res_all)}/{len(res_all)} checks passed")
sys.exit(0 if all(res_all) else 1)
