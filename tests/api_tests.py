# Testes de API do Dad's Burger (rodados por tests/run-tests.sh, contra um Mercado Pago de mentira).
# Cobrem: login do painel, fotos (só jpg, png e webp, refeitas no servidor), preço e promoção no pedido, ordem do cardápio,
# produto escondido ou esgotado, logo da loja, cobrança Pix e cartão (o que vai ao Mercado Pago), webhook, devolução, horário da loja,
# raio de entrega, formas de pagamento ligadas no painel, valor mostrado, validação do que o painel grava e motoboy só ao aceitar.
import json, urllib.request, urllib.error, hmac, hashlib, time, base64, os, re, sys, datetime
import concurrent.futures as cf
from zoneinfo import ZoneInfo

B = 'http://127.0.0.1:3055'; B0 = 'http://127.0.0.1:3056'; MP = 'http://127.0.0.1:3099'
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
pickup = {'items': [{'name': p1['name'], 'q': 2}, {'name': p2['name'], 'q': 1}], 'mode': 'retirada', 'unitId': 'passo-dareia'}
expected = round(p1['price'] * 2 + p2['price'], 2)
def deliv(cep, bairro="Passo d'Areia", cidade='Porto Alegre'):
    return {**pickup, 'mode': 'entrega', 'address': 'Rua Teste, 10', 'addressDetails': {'rua': 'Rua Teste', 'numero': '10', 'bairro': bairro, 'cidade': cidade, 'cep': cep}}
def pix(order, **kw): return call(B, 'POST', '/api/mercadopago/pix', {'customer': cust, 'order': order, **kw})
def card(order, method='visa', c=None, **kw): return call(B, 'POST', '/api/mercadopago/card-payment', {'customer': c or cust, 'order': order, 'card': {'token': TOK, 'paymentMethodId': method, 'installments': 1, **kw}})
def counter(): return call(B, 'POST', '/api/orders', {'customer': {'name': 'Carlos Dias', 'phone': '51977776666'}, 'order': {'items': [{'name': p1['name'], 'q': 1}], 'mode': 'retirada', 'unitId': 'passo-dareia'}, 'payMode': 'balcao_vr'})
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
check('pix: a malformed Device ID is ignored without breaking the payment', pix(pickup, deviceId='bad value\r\nX-Evil: 1')[0] == 200 and posts()[-1]['device'] is None)
c, pk = pix(pickup); b2 = posts()[-1]['body']
check('pix pickup: no address and no shipment sent', 'address' not in b2['payer'] and 'shipments' not in b2['additional_info'])
check('pix: idempotency key differs per attempt', posts()[-1]['idem'] != s['idem'] and posts()[-1]['idem'].startswith(pk['orderId'] + '-'))
check('pix: expiry is -03:00 and at least 30 minutes ahead', b2['date_of_expiration'].endswith('-03:00') and 29 < (datetime.datetime.fromisoformat(b2['date_of_expiration']) - datetime.datetime.now(datetime.timezone.utc)).total_seconds() / 60 < 31)
check('pix: unpaid order is not on the board', board(pk['orderId']) is None)
for label, mod, err in [('missing email', {'email': ''}, 'email_invalido'), ('bad email', {'email': 'x'}, 'email_invalido'), ('one-word name', {'name': 'Joana'}, 'nome_completo'), ('bad CPF', {'cpf': '11111111111'}, 'cpf_invalido')]:
    n0 = len(posts()); c, d = call(B, 'POST', '/api/mercadopago/pix', {'customer': {**cust, **mod}, 'order': pickup})
    check(f'pix: {label} -> 400 {err}, nothing sent to Mercado Pago', c == 400 and d.get('error') == err and len(posts()) == n0, (c, d))
check('pix: unknown item and quantity 0 and 51 refused', all(pix({**pickup, 'items': [it]})[0] == 400 for it in ({'name': 'Produto que nao existe', 'q': 1}, {'name': p1['name'], 'q': 0}, {'name': p1['name'], 'q': 51})))
check('no credentials: Pix and card answer 503 (no fake approval)', call(B0, 'POST', '/api/mercadopago/pix', {'customer': cust, 'order': pickup})[0] == 503 and call(B0, 'POST', '/api/mercadopago/card-payment', {'customer': cust, 'order': pickup, 'card': {'token': 'x' * 32, 'paymentMethodId': 'visa', 'installments': 1}})[0] == 503)
def one(i): return pix(pickup, deviceId=f'dev-par-{i}')
with cf.ThreadPoolExecutor(8) as ex: rs = list(ex.map(one, range(8)))
by_ref = {x['body']['external_reference']: x for x in posts()}
check('8 parallel Pix: each carries its own Device ID and idempotency key', all(c == 200 and by_ref[d['orderId']]['device'] == f'dev-par-{i}' for i, (c, d) in enumerate(rs)) and len({x['idem'] for x in by_ref.values()}) >= 8)

# ============================================================ CARTÃO
c, cd = card(deliv('91350050'), issuerId=25, installments=3, deviceId='dev-card-1'); s = posts()[-1]; b = s['body']
check('card: approved, token + issuer + installments + binary_mode + descriptor + buyer email + items + Device ID', c == 200 and cd.get('status') == 'approved' and b['token'] == TOK and b['issuer_id'] == 25 and b['installments'] == 3 and b['binary_mode'] is True and b['statement_descriptor'] == 'DADS BURGER' and b['payer']['email'] == EMAIL and len(b['additional_info']['items']) == 2 and s['device'] == 'dev-card-1', (c, cd))
check('card: paid order reaches the board', board(cd['orderId']) is not None and board(cd['orderId'])['paymentConfirmed'] is True)
check('card: the buyer email is not stored in orders.json', EMAIL not in open(SITE + '/orders.json', encoding='utf-8').read())
c, d = call(B, 'POST', '/api/mercadopago/card-payment', {'customer': cust, 'order': pickup, 'card': {'token': 'tok_decline_000000000000', 'paymentMethodId': 'master', 'installments': 1}})
check('card: rejected -> 402 with reason, no order', c == 402 and d.get('reason') == 'cc_rejected_insufficient_amount', (c, d))
c, d = call(B, 'POST', '/api/mercadopago/card-payment', {'customer': cust, 'order': pickup, 'card': {'token': 'tok_error_00000000000000', 'paymentMethodId': 'master', 'installments': 1}})
check('card: Mercado Pago error -> 502', c == 502, (c, d))
c, d = call(B, 'POST', '/api/mercadopago/card-payment', {'customer': cust, 'order': pickup, 'card': {'cardNumber': '4111111111111111', 'securityCode': '123', 'paymentMethodId': 'visa', 'installments': 1}})
check('card: raw card data without a token refused (never forwarded)', c == 400 and d.get('error') == 'dados_do_cartao_invalidos', (c, d))
c, d = call(B, 'POST', '/api/mercadopago/card-payment', {'customer': cust, 'order': pickup, 'card': {'token': 'tok_pending_0000000000000', 'paymentMethodId': 'visa', 'installments': 1}})
check('card: in_process is not confirmed and not on the board', c == 200 and d.get('status') == 'in_process' and board(d['orderId']) is None, (c, d))
for label, mod, err in [('missing email', {'email': ''}, 'email_invalido'), ('one-word name', {'name': 'Joana'}, 'nome_completo')]:
    c, d = card(pickup, c={**cust, **mod}); check(f'card: {label} -> 400 {err}', c == 400 and d.get('error') == err, (c, d))

# ============================================================ WEBHOOK, DEVOLUÇÃO E CONTESTAÇÃO
c, w = pix(pickup); pid = w['paymentId']; call(MP, 'GET', f'/__approve/{pid}')
ts = str(int(time.time() * 1000))
check('webhook: unsigned and wrong signature -> 401, order not confirmed', call(B, 'POST', f'/api/mercadopago/webhook?data.id={pid}&type=payment', {'data': {'id': pid}})[0] == 401 and webhook(pid, 'wrong')[0] == 401 and board(w['orderId']) is None)
check('webhook: valid signature -> 200, then the order is confirmed after the server asks Mercado Pago', webhook(pid)[0] == 200 and until(lambda: board(w['orderId'])))
check('status route: pending while unpaid, approved only after Mercado Pago says so', call(B, 'GET', f"/api/mercadopago/payment/{pix(pickup)[1]['paymentId']}/status")[1] == {'status': 'pending', 'confirmed': False})
c, ca = card(pickup); cp, co = ca['paymentId'], ca['orderId']
call(MP, 'GET', f'/__partial/{cp}?amount=1'); webhook(cp)
check('after sale: partial refund flagged, order stays paid', until(lambda: board(co).get('refunded') is True) and board(co)['refundedAmount'] == 1 and board(co)['paymentConfirmed'] is True)
call(MP, 'GET', f'/__refund/{cp}'); webhook(cp)
check('after sale: full refund recorded', until(lambda: board(co).get('mpStatus') == 'refunded'))
c, cb = card(pickup, 'master'); call(MP, 'GET', f"/__chargeback/{cb['paymentId']}"); webhook(cb['paymentId'])
check('after sale: chargeback flagged', until(lambda: board(cb['orderId']).get('chargedBack') is True))
c, cc = card(pickup); call(MP, 'GET', f"/__refund/{cc['paymentId']}"); call(B, 'POST', f"/api/mercadopago/webhook?data.id={cc['paymentId']}&type=payment", {'data': {'id': cc['paymentId']}}); time.sleep(0.5)
check('after sale: an unsigned webhook cannot flag a refund', not board(cc['orderId']).get('refunded'))

# ============================================================ RESPOSTA PERDIDA
reset(); call(MP, 'GET', '/__fail5xx?n=1'); c, d = pix(pickup); ps = posts()
check('5xx once: the SDK retries with the SAME idempotency key, customer sees a normal answer, one payment exists', c == 200 and len(ps) == 2 and ps[0]['idem'] == ps[1]['idem'] and len(call(MP, 'GET', '/v1/payments/search?external_reference=' + d['orderId'])[1]['results']) == 1, (c, len(ps)))
reset(); call(MP, 'GET', '/__slow?n=2&ms=2500&create=1'); c, d = pix(pickup)
check('lost answer: payment is found by external_reference, order saved, QR returned', c == 200 and d.get('qrCode') and d['orderId'] in orders_file() and any(x.get('search') for x in mp_log()), (c, d))
reset(); n0 = len(orders_file()); call(MP, 'GET', '/__slow?n=2&ms=2500&create=0'); c, d = pix(pickup)
check('nothing created at Mercado Pago: 502, no QR, no order saved', c == 502 and 'qrCode' not in d and len(orders_file()) == n0, (c, d))

# ============================================================ HORÁRIO DA LOJA (fuso de Brasília, regra do servidor)
reset()
def closed_everywhere(label):
    c, d = pix(pickup); check(f'{label}: Pix refused with loja_fechada and the owner notice', c == 403 and d.get('error') == 'loja_fechada' and d.get('notice'), (c, d))
    c, d = card(pickup); check(f'{label}: card refused', c == 403 and d.get('error') == 'loja_fechada')
    c, d = counter(); check(f'{label}: counter order refused', c == 403 and d.get('error') == 'loja_fechada')
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
check('open inside today window (Brasilia time, this machine may be in another zone)', call(B, 'GET', '/api/store/status')[1]['open'] is True and pix(pickup)[0] == 200 and counter()[0] == 201)
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
pay('pix_online', False); check('payment off: Pix refused (forma_desativada)', pix(pickup)[1].get('error') == 'forma_desativada'); pay('pix_online', True)
pay('cartao_online', False); check('payment off: credit refused, debit still works', card(pickup, 'visa')[1].get('error') == 'forma_desativada' and card(pickup, 'debvisa')[0] == 200); pay('cartao_online', True)
pay('cartao_debito_online', False); check('payment off: debit refused, credit still works', card(pickup, 'debvisa')[1].get('error') == 'forma_desativada' and card(pickup, 'visa')[0] == 200); pay('cartao_debito_online', True)
c, d = pix({**pickup, 'expectedTotal': expected - 5})
check('shown total lower than the real one: 409 valor_mudou with the new total', c == 409 and d.get('error') == 'valor_mudou' and abs(d['total'] - expected) < 0.01, (c, d))
check('shown total equal or higher: accepted, charged the real total', pix({**pickup, 'expectedTotal': expected})[0] == 200 and abs(pix({**pickup, 'expectedTotal': expected + 3})[1]['total'] - expected) < 0.01)

# ============================================================ O QUE O PAINEL GRAVA
orig = acall(B, 'GET', '/api/admin/products')[1]
def with_item(**mod):
    l = json.loads(json.dumps(orig)); l[0].update(mod); return l
check('products: zero, negative price, empty name, duplicate id, non-list all refused', all(acall(B, 'POST', '/api/admin/products', body)[0] == 400 for body in (with_item(price=0), with_item(price=-5), with_item(name='  '), {'not': 'a list'}, [{**orig[0]}, {**orig[1], 'id': orig[0]['id']}])))
check('products: a valid price change is what Pix charges at once', acall(B, 'POST', '/api/admin/products', with_item(price=77.77))[0] == 200 and abs(pix({**pickup, 'items': [{'name': p1['name'], 'q': 1}]})[1]['total'] - 77.77) < 0.01)
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
def charge(items): c, d = pix({**pickup, 'items': items}); return c, d, (posts()[-1]['body'] if c == 200 else None)
base_list = cur()
def mod(i, **kw): l = json.loads(json.dumps(base_list)); l[i].update(kw); return l
promo_ok = round(p1['price'] * 0.85, 2); promo_total = round(promo_ok * 2 + p2['price'], 2)
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
check('promo: an item sent with its id is priced from that product', c == 200 and abs(d['total'] - promo_ok) < 0.005, (c, d.get('total')))
c, d = call(B, 'POST', '/api/orders', {'customer': {'name': 'Carlos Dias', 'phone': '51977776666'}, 'order': {'items': [{'name': p1['name'], 'q': 1}], 'mode': 'retirada', 'unitId': 'passo-dareia'}, 'payMode': 'balcao_vr'})
check('promo: the counter order (pay at pickup) uses the promo price too', c == 201 and abs(d['order']['total'] - promo_ok) < 0.005 and d['order']['order']['items'][0]['price'] == promo_ok, (c, d.get('order', {}).get('total')))
check('promo: the shown total with the old (higher) price is accepted, the real one is charged', abs(pix({**pickup, 'items': [{'name': p1['name'], 'q': 2}, {'name': p2['name'], 'q': 1}], 'expectedTotal': expected})[1]['total'] - promo_total) < 0.005)
put(mod(0, promo=None)); c, d, b = charge([{'name': p1['name'], 'q': 2}, {'name': p2['name'], 'q': 1}])
check('promo: taking the promo away brings the regular price back at once', c == 200 and abs(d['total'] - expected) < 0.005, (c, d.get('total'), expected))
bad_file = json.loads(json.dumps(base_list)); bad_file[0]['promo'] = 999
json.dump(bad_file, open(SITE + '/products.json', 'w', encoding='utf-8'))
c, d, b = charge([{'name': p1['name'], 'q': 2}, {'name': p2['name'], 'q': 1}])
check('promo: a wrong promo that got into the file (above the price) never makes the customer pay more', c == 200 and abs(d['total'] - expected) < 0.005, (c, d.get('total'), expected))
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
check('courier: later steps and re-accepting never call it twice', board(oid)['courier']['acceptedAt'] == t0 and open(LOGD + '/server3055.log', encoding='utf-8').read().count(f'pedido {oid} aceito') == 1)
oid2 = paid_delivery(); acall(B, 'PATCH', f'/api/orders/{oid2}', {'status': 'cancelado'}); c, co = counter(); acall(B, 'PATCH', f"/api/orders/{co['orderId']}", {'status': 'preparando'})
check('courier: cancelled and pickup orders never call it', 'courier' not in board(oid2) and 'courier' not in board(co['orderId']))
check('board: only paid or counter orders are listed, PATCH limits hold', all(o2.get('paymentConfirmed') is True or o2.get('payAt') == 'balcao' for o2 in acall(B, 'GET', '/api/orders')[1]['orders']) and acall(B, 'PATCH', f'/api/orders/{oid}', {'status': 'hacked'})[0] == 400 and acall(B, 'PATCH', '/api/orders/DAD-0000', {'status': 'concluido'})[0] == 404)

print(f"\n{sum(res_all)}/{len(res_all)} checks passed")
sys.exit(0 if all(res_all) else 1)
