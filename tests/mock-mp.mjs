// Mercado Pago e consulta de CEP de mentira, só para os testes (porta 3099, só em 127.0.0.1).
// Registra o que o servidor envia e simula as respostas: idempotência (repete a resposta como o Mercado Pago),
// busca por external_reference, erro 5xx, resposta lenta (com ou sem criar o pagamento), devolução e contestação.
import http from 'http';
let seq = (Date.now() % 900000) * 10, log = [], failNext = false, fail5xx = 0, slow = { n: 0, ms: 0, create: true };
const pays = new Map();
const idem = new Map();
// lat/lng de CEPs conhecidos (a loja Passo d'Areia fica em -30.01758, -51.15570)
const geo = { '91350050': { lat: '-30.0178258', lng: '-51.1583857' }, '90430181': { lat: '-30.0325456', lng: '-51.2040873' }, '80000000': { lat: '-25.4284', lng: '-49.2733' } };
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const reply = (res, code, obj) => {
  if (slow.n > 0) { slow.n--; setTimeout(() => json(res, code, obj), slow.ms); return; }
  json(res, code, obj);
};
http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    const url = new URL(req.url, 'http://x');
    const q = url.searchParams;
    if (url.pathname === '/__log') return json(res, 200, log);
    if (url.pathname === '/__reset') { log = []; failNext = false; fail5xx = 0; slow = { n: 0, ms: 0, create: true }; return json(res, 200, {}); }
    if (url.pathname === '/__fail_next') { failNext = true; return json(res, 200, {}); }
    if (url.pathname === '/__fail5xx') { fail5xx = Number(q.get('n') || 1); return json(res, 200, {}); }
    if (url.pathname === '/__slow') { slow = { n: Number(q.get('n') || 1), ms: Number(q.get('ms') || 3000), create: q.get('create') !== '0' }; return json(res, 200, {}); }
    if (url.pathname === '/__setgeo') { geo[q.get('cep')] = { lat: q.get('lat'), lng: q.get('lng') }; return json(res, 200, {}); }
    const ap = url.pathname.match(/^\/__(approve|refund|partial|chargeback)\/(\d+)$/);
    if (ap) {
      const p = pays.get(ap[2]); if (!p) return json(res, 404, {});
      if (ap[1] === 'approve') p.status = 'approved';
      if (ap[1] === 'refund') { p.status = 'refunded'; p.transaction_amount_refunded = p.transaction_amount; }
      if (ap[1] === 'partial') { p.transaction_amount_refunded = Number(q.get('amount') || 1); }
      if (ap[1] === 'chargeback') p.status = 'charged_back';
      return json(res, 200, p);
    }
    if (url.pathname.startsWith('/geo/json/')) {
      const cep = url.pathname.split('/').pop();
      log.push({ geo: cep });
      const g = geo[cep];
      return g ? json(res, 200, { cep, address: 'Rua Teste', district: 'Bairro Teste', city: 'Porto Alegre', state: 'RS', ...g }) : json(res, 404, { code: 'not_found', message: 'CEP nao encontrado' });
    }
    const auth = req.headers.authorization;
    if (req.method === 'POST' && url.pathname === '/v1/payments') {
      const key = req.headers['x-idempotency-key'];
      log.push({ auth, idem: key, device: req.headers['x-meli-session-id'] || null, product: req.headers['x-product-id'] || null, tracking: req.headers['x-tracking-id'] || null, ua: req.headers['user-agent'] || null, body });
      if (auth !== 'Bearer TESTTOKEN') return json(res, 401, { message: 'invalid token', status: 401 });
      if (fail5xx > 0) { fail5xx--; return json(res, 503, { message: 'service unavailable', status: 503 }); }
      if (key && idem.has(key)) { const r = idem.get(key); return reply(res, r.code, r.body); }
      if (failNext) { failNext = false; return json(res, 400, { message: 'invalid parameter', error: 'bad_request', status: 400, cause: [{ code: 1 }] }); }
      if (body.application_fee !== undefined) return json(res, 403, { message: 'You cannot use application_fee with this payment', error: 'forbidden', status: 403, cause: [{ code: 2059 }] });
      if (slow.n > 0 && !slow.create) return reply(res, 200, {}); // o pedido nunca chegou a ser processado
      const id = String(1000000000 + ++seq);
      const base = { id: Number(id), transaction_amount: body.transaction_amount, external_reference: body.external_reference, payment_method_id: body.payment_method_id, installments: body.installments || 1, status: 'pending', transaction_amount_refunded: 0 };
      let p;
      if (body.payment_method_id === 'pix') {
        if (!body.payer || !body.payer.email || !body.payer.identification || !body.payer.identification.number || !body.date_of_expiration) return json(res, 400, { message: 'payer/expiration required', status: 400 });
        p = { ...base, status_detail: 'pending_waiting_transfer', point_of_interaction: { transaction_data: { qr_code: '00020126MOCKPIX' + id, qr_code_base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', ticket_url: 'https://mp.test/ticket/' + id } } };
      } else if (body.token === 'tok_decline_000000000000') p = { ...base, status: 'rejected', status_detail: 'cc_rejected_insufficient_amount' };
      else if (body.token === 'tok_error_00000000000000') return json(res, 400, { message: 'invalid card token', error: 'bad_request', status: 400, cause: [{ code: 2006 }] });
      else if (body.token === 'tok_pending_0000000000000') p = { ...base, status: 'in_process', status_detail: 'pending_review_manual' };
      else p = { ...base, status: 'approved', status_detail: 'accredited' };
      pays.set(id, p);
      if (key) idem.set(key, { code: 201, body: p });
      return reply(res, 201, p);
    }
    if (req.method === 'GET' && url.pathname === '/v1/payments/search') {
      log.push({ search: Object.fromEntries(q), auth });
      const ref = q.get('external_reference');
      const results = [...pays.values()].filter((p) => !ref || p.external_reference === ref).reverse().slice(0, Number(q.get('limit') || 30));
      return json(res, 200, { paging: { total: results.length, limit: Number(q.get('limit') || 30), offset: 0 }, results });
    }
    const g = url.pathname.match(/^\/v1\/payments\/(\d+)$/);
    if (req.method === 'GET' && g) { log.push({ get: g[1], auth }); const p = pays.get(g[1]); return p ? json(res, 200, p) : json(res, 404, { message: 'not found', status: 404 }); }
    json(res, 404, { message: 'no route', status: 404 });
  });
}).listen(3099, '127.0.0.1', () => console.log('mock MP on 127.0.0.1:3099'));
