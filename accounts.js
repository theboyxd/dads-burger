// Contas de clientes, verificação em duas etapas (app autenticador) e raspadinha de brindes.
// Tudo fica na pasta de dados (accounts.json e account.key): dados pessoais, nunca no git nem como arquivo estático.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import QRCode from 'qrcode';

const scrypt = promisify(crypto.scrypt);
const DAY = 86400000;
const LOGIN_DAYS = 30;           // "continuar conectado": vale para pedir e ver a conta, nunca para a raspadinha
const FRESH_MINUTES = 120;       // a raspadinha só abre numa entrada com senha (e 2FA) feita nesta sessão do navegador
const norm = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 24);
const digits = (v) => String(v || '').replace(/\D/g, '');

// ---- código de 6 dígitos (TOTP, RFC 6238) sem biblioteca: serve o Google Authenticator e similares ----
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function b32decode(str) {
  let bits = 0, value = 0; const out = [];
  for (const ch of String(str).toUpperCase().replace(/[^A-Z2-7]/g, '')) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function hotp(secret, counter) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secret).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1000000)).padStart(6, '0');
}
export function totpCheck(secretB32, code, at = Date.now()) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  const secret = b32decode(secretB32); const step = Math.floor(at / 30000);
  for (const d of [-1, 0, 1]) if (crypto.timingSafeEqual(Buffer.from(hotp(secret, step + d)), Buffer.from(c))) return true;
  return false;
}
export const totpNow = (secretB32, at = Date.now()) => hotp(b32decode(secretB32), Math.floor(at / 30000));

// Tipos de prêmio: item grátis (nome do produto), desconto em % ou em R$ sobre os produtos, frete grátis, ou nada.
// Campos: weight (chance), value, minOrder (pedido mínimo em R$), validDays (0 = não vence), dailyLimit e totalLimit (0 = sem limite)
export const PRIZE_TYPES = ['item', 'desconto_pct', 'desconto_reais', 'frete_gratis', 'nada'];
const DEFAULT_PRIZES = [
  { id: 'refri', type: 'item', name: 'Refrigerante grátis', weight: 40, validDays: 30 },
  { id: 'batata', type: 'item', name: 'Batata frita grátis', weight: 25, validDays: 30 },
  { id: 'desc10', type: 'desconto_pct', value: 10, name: '', weight: 15, minOrder: 40, validDays: 30 },
  { id: 'nada', type: 'nada', name: '', weight: 20 } // sem prêmio desta vez
];
// Recompensa acumulada: cada raspadinha premiada soma 1; ao juntar "threshold" (padrão 10) a conta ganha o Dad's Special,
// um brinde surpresa (o cliente só vê o nome; o que vem nele é combinado com a cozinha).
const specialCfg = (r) => { const x = (r && r.special) || {}; return { enabled: x.enabled !== false, name: String(x.name || "Dad's Special").slice(0, 60), threshold: Math.min(50, Math.max(1, Math.round(Number(x.threshold) || 10))), validDays: Math.max(0, Number(x.validDays) || 30) }; };
const round2 = (n) => Math.round(n * 100) / 100;
const brl = (n) => String(round2(n).toFixed(2)).replace('.', ',');
const dayKey = (ts) => new Date(ts - 3 * 3600000).toISOString().slice(0, 10); // dia em Brasília
const normPrize = (p) => ({ id: String(p.id || ''), type: PRIZE_TYPES.includes(p.type) ? p.type : (p.name ? 'item' : 'nada'), name: String(p.name || ''), value: Number(p.value) || 0, weight: Math.max(0, Number(p.weight) || 0), minOrder: Math.max(0, Number(p.minOrder) || 0), validDays: Math.max(0, Number(p.validDays) || 0), dailyLimit: Math.max(0, Number(p.dailyLimit) || 0), totalLimit: Math.max(0, Number(p.totalLimit) || 0) });
function prizeLabel(p) {
  if (p.name) return p.name;
  if (p.type === 'desconto_pct') return `${p.value}% de desconto`;
  if (p.type === 'desconto_reais') return `R$ ${brl(p.value)} de desconto`;
  if (p.type === 'frete_gratis') return 'Frete grátis';
  return '';
}

export function mountAccounts(app, ctx) {
  const { DATA_DIR, SESSION_SECRET, readCookie, isHttps, writeJson, validCpf, getOrders, saveOrders, getSettings, requireAdmin, appUrl } = ctx;
  const FILE = path.join(DATA_DIR, 'accounts.json');
  const KEY_FILE = path.join(DATA_DIR, 'account.key');
  let DB = { accounts: {}, claims: [], blocked: [], qrToken: '' };
  try { DB = { ...DB, ...JSON.parse(fs.readFileSync(FILE, 'utf-8')) }; } catch { /* primeira partida */ }
  function save() { return writeJson(FILE, DB); }
  if (!DB.qrToken) { DB.qrToken = crypto.randomBytes(12).toString('base64url'); save(); }
  let KEY = null;
  try { KEY = Buffer.from(fs.readFileSync(KEY_FILE, 'utf-8').trim(), 'hex'); } catch { /* cria abaixo */ }
  if (!KEY || KEY.length !== 32) { KEY = crypto.randomBytes(32); fs.writeFileSync(KEY_FILE, KEY.toString('hex'), { mode: 0o600 }); }
  const enc = (text) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', KEY, iv); const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url'); };
  const dec = (s) => { const b = Buffer.from(s, 'base64url'); const d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); };

  // ---- sessões: cookies assinados. "dads_user" fica 30 dias; "dads_fresh" morre ao fechar o navegador ----
  const sign = (kind, payload) => crypto.createHmac('sha256', `${SESSION_SECRET}:${kind}`).update(payload).digest('base64url');
  const token = (kind, acc, ms) => { const p = `${acc.id}.${acc.ver}.${Date.now() + ms}`; return `${p}.${sign(kind, p)}`; };
  function accountFrom(req, name, kind) {
    const t = readCookie(req, name); const parts = t.split('.');
    if (parts.length !== 4) return null;
    const p = parts.slice(0, 3).join('.');
    try { if (!crypto.timingSafeEqual(Buffer.from(sign(kind, p)), Buffer.from(parts[3]))) return null; } catch { return null; }
    const acc = DB.accounts[parts[0]];
    return acc && !acc.blocked && String(acc.ver) === parts[1] && Number(parts[2]) > Date.now() ? acc : null;
  }
  const accountOf = (req) => accountFrom(req, 'dads_user', 'user');
  const freshOf = (req) => { const a = accountFrom(req, 'dads_fresh', 'fresh'); const u = accountOf(req); return a && u && a.id === u.id ? a : null; };
  const cookie = (req, name, value, maxAge) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${maxAge === undefined ? '' : `; Max-Age=${maxAge}`}${isHttps(req) ? '; Secure' : ''}`;
  function startSession(req, res, acc) {
    acc.lastLogin = Date.now(); save();
    res.append('Set-Cookie', cookie(req, 'dads_user', token('user', acc, LOGIN_DAYS * DAY), LOGIN_DAYS * 86400));
    res.append('Set-Cookie', cookie(req, 'dads_fresh', token('fresh', acc, FRESH_MINUTES * 60000)));
  }
  const endSession = (req, res) => { res.append('Set-Cookie', cookie(req, 'dads_user', '', 0)); res.append('Set-Cookie', cookie(req, 'dads_fresh', '', 0)); };
  const needUser = (req, res, next) => { const a = accountOf(req); if (!a) return res.status(401).json({ success: false, error: 'entre_na_conta' }); req.account = a; next(); };
  const needFresh = (req, res, next) => { const a = freshOf(req); if (!a) return res.status(401).json({ success: false, error: 'entrada_recente_necessaria' }); req.account = a; next(); };

  async function hashPw(pw, salt = crypto.randomBytes(16)) { return { salt: salt.toString('base64url'), hash: (await scrypt(pw, salt, 64)).toString('base64url') }; }
  async function checkPw(acc, pw) {
    const h = await scrypt(String(pw || ''), Buffer.from(acc.pass.salt, 'base64url'), 64);
    const want = Buffer.from(acc.pass.hash, 'base64url');
    return h.length === want.length && crypto.timingSafeEqual(h, want);
  }
  const slow = new Map(); // erros seguidos de senha por e-mail: cada erro demora mais (nunca trava a conta)
  const totpFails = new Map(); // 5 códigos errados em 5 min: espera 5 min
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  function totpLocked(acc) { const f = totpFails.get(acc.id); return Boolean(f && f.n >= 5 && Date.now() - f.at < 300000); }
  function totpFail(acc) { const f = totpFails.get(acc.id); const n = f && Date.now() - f.at < 300000 ? f.n + 1 : 1; totpFails.set(acc.id, { n, at: Date.now() }); }

  const maskCpf = (c) => `***.***.***-${String(c).slice(-2)}`;
  const view = (acc, req, fresh = false) => ({
    name: acc.name, cpf: maskCpf(acc.cpf), phone: acc.phone, email: acc.email,
    twoFactor: Boolean(acc.totp && acc.totp.enabled),
    fresh: fresh || Boolean(freshOf(req)),
    tickets: acc.tickets.filter((t) => !t.used && ticketOk(t)).length,
    progress: acc.progress || 0, threshold: specialCfg(getSettings().raspadinha).enabled ? specialCfg(getSettings().raspadinha).threshold : 0, specialName: specialCfg(getSettings().raspadinha).name,
    prizes: acc.prizes.filter((p) => !p.usedOrder && !(p.expiresAt && p.expiresAt < Date.now())).map((p) => ({ id: p.id, name: p.name, type: p.type, mystery: Boolean(p.mystery), minOrder: p.minOrder || 0, expiresAt: p.expiresAt || 0 })),
    won: acc.prizes.length
  });
  const validEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || '').trim()) && String(v).trim().length <= 120;
  const err = (res, code, error, extra = {}) => res.status(code).json({ success: false, error, ...extra });

  // ---- cadastro e entrada ----
  app.post('/api/account/register', async (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim().replace(/\s+/g, ' ');
    const cpf = digits(b.cpf); const phone = digits(b.phone); const email = String(b.email || '').trim().toLowerCase();
    if (name.split(' ').length < 2 || name.length > 80) return err(res, 400, 'nome_completo');
    if (!validCpf(cpf)) return err(res, 400, 'cpf_invalido');
    if (phone.length < 10 || phone.length > 13) return err(res, 400, 'telefone_invalido');
    if (!validEmail(email)) return err(res, 400, 'email_invalido');
    if (String(b.password || '').length < 8 || String(b.password).length > 100) return err(res, 400, 'senha_curta');
    const all = Object.values(DB.accounts);
    if (all.some((a) => a.cpf === cpf)) return err(res, 409, 'cpf_ja_cadastrado');
    if (all.some((a) => a.email === email)) return err(res, 409, 'email_ja_cadastrado');
    const acc = { id: crypto.randomBytes(9).toString('base64url'), ver: 1, name, nameKey: norm(name), cpf, phone, email, pass: await hashPw(String(b.password)), totp: null, createdAt: Date.now(), prizes: [],
      // um brinde de boas-vindas por conta, enquanto ela ainda não fez nenhum pedido
      tickets: [{ id: crypto.randomBytes(6).toString('hex'), kind: 'welcome', used: false, at: Date.now() }] };
    DB.accounts[acc.id] = acc;
    if (!save()) { delete DB.accounts[acc.id]; return err(res, 500, 'nao_foi_possivel_salvar'); }
    startSession(req, res, acc);
    res.status(201).json({ success: true, account: view(acc, req, true) });
  });

  app.post('/api/account/login', async (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const acc = Object.values(DB.accounts).find((a) => a.email === email);
    const f = slow.get(email) || { n: 0, at: 0 };
    const ok = acc ? await checkPw(acc, (req.body || {}).password) : (await scrypt('x', 'y', 64), false);
    if (!ok) {
      const n = Date.now() - f.at > 600000 ? 1 : f.n + 1; slow.set(email, { n, at: Date.now() });
      await delay(Math.min(3000, (Number(process.env.LOGIN_DELAY_MS) || 300) * n));
      return err(res, 401, 'email_ou_senha_incorretos');
    }
    slow.delete(email);
    if (acc.blocked) return err(res, 403, 'conta_bloqueada');
    if (acc.totp && acc.totp.enabled) {
      const code = (req.body || {}).code;
      if (!code) return err(res, 401, 'codigo_2fa');
      if (totpLocked(acc)) return err(res, 429, 'muitas_tentativas');
      if (!totpCheck(dec(acc.totp.secret), code)) { totpFail(acc); return err(res, 401, 'codigo_incorreto'); }
      totpFails.delete(acc.id);
    }
    startSession(req, res, acc);
    res.json({ success: true, account: view(acc, req, true) });
  });

  app.post('/api/account/logout', (req, res) => { endSession(req, res); res.json({ success: true }); });
  app.get('/api/account/me', (req, res) => {
    const acc = accountOf(req);
    res.json(acc ? { authenticated: true, account: view(acc, req) } : { authenticated: false });
  });

  // ---- o que a pessoa pode mudar: e-mail, senha e a 2ª etapa. Nome, CPF e telefone não mudam. ----
  app.post('/api/account/email', needUser, async (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!validEmail(email)) return err(res, 400, 'email_invalido');
    if (!(await checkPw(req.account, (req.body || {}).password))) return err(res, 401, 'senha_incorreta');
    if (Object.values(DB.accounts).some((a) => a.email === email && a.id !== req.account.id)) return err(res, 409, 'email_ja_cadastrado');
    req.account.email = email; save();
    res.json({ success: true, account: view(req.account, req) });
  });
  app.post('/api/account/password', needUser, async (req, res) => {
    const next = String((req.body || {}).next || '');
    if (!(await checkPw(req.account, (req.body || {}).current))) return err(res, 401, 'senha_incorreta');
    if (next.length < 8 || next.length > 100) return err(res, 400, 'senha_curta');
    req.account.pass = await hashPw(next); req.account.ver += 1; save(); // todas as outras sessões deixam de valer
    startSession(req, res, req.account);
    res.json({ success: true });
  });
  app.post('/api/account/2fa/setup', needUser, async (req, res) => {
    if (!(await checkPw(req.account, (req.body || {}).password))) return err(res, 401, 'senha_incorreta');
    if (req.account.totp && req.account.totp.enabled) return err(res, 409, '2fa_ja_ligado');
    const secret = b32encode(crypto.randomBytes(20));
    req.account.totp = { secret: enc(secret), enabled: false }; save();
    const label = encodeURIComponent(`Dad's Burger:${req.account.email}`);
    res.json({ success: true, secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent("Dad's Burger")}&digits=6&period=30` });
  });
  app.post('/api/account/2fa/enable', needUser, (req, res) => {
    const t = req.account.totp;
    if (!t || t.enabled) return err(res, 400, '2fa_nao_iniciado');
    if (totpLocked(req.account)) return err(res, 429, 'muitas_tentativas');
    if (!totpCheck(dec(t.secret), (req.body || {}).code)) { totpFail(req.account); return err(res, 401, 'codigo_incorreto'); }
    totpFails.delete(req.account.id); t.enabled = true; save();
    res.json({ success: true, account: view(req.account, req) });
  });
  app.post('/api/account/2fa/disable', needUser, async (req, res) => {
    const t = req.account.totp;
    if (!t || !t.enabled) return err(res, 400, '2fa_desligado');
    if (!(await checkPw(req.account, (req.body || {}).password))) return err(res, 401, 'senha_incorreta');
    if (totpLocked(req.account)) return err(res, 429, 'muitas_tentativas');
    if (!totpCheck(dec(t.secret), (req.body || {}).code)) { totpFail(req.account); return err(res, 401, 'codigo_incorreto'); }
    req.account.totp = null; save();
    res.json({ success: true, account: view(req.account, req) });
  });

  // ---- raspadinha ----
  function addrKey(order) {
    const d = (order && order.order && order.order.addressDetails) || {};
    const cep = digits(d.cep); const num = norm(d.numero);
    return cep && num ? `${cep}|${num}` : '';
  }
  function payFp(p) {
    if (p && p.card && p.card.first_six_digits && p.card.last_four_digits) return 'c' + sha(`${p.card.first_six_digits}${p.card.last_four_digits}`);
    const id = p && p.payer && p.payer.identification && p.payer.identification.number;
    return id ? 'd' + sha(id) : '';
  }
  // Brinde de pedido só vale enquanto o pedido está pago e de pé (cancelado ou devolvido não conta)
  function ticketOk(t) {
    if (t.kind !== 'order') return true;
    const o = getOrders()[t.orderId];
    return Boolean(o && o.paymentConfirmed && !o.refunded && o.status !== 'cancelado');
  }
  function keysFor(acc, t) {
    const o = t.kind === 'order' ? getOrders()[t.orderId] : null;
    return { cpf: sha(acc.cpf), name: sha(acc.nameKey), addr: o ? addrKey(o) : '', pay: o ? String(o.payFp || '') : '' };
  }
  // Outra conta já pegou brinde com o mesmo CPF, nome, endereço ou meio de pagamento?
  function conflict(acc, k) {
    for (const c of DB.claims) {
      if (c.acc === acc.id) continue;
      if (c.cpf === k.cpf) return 'cpf';
      if (c.name === k.name) return 'nome';
      if (k.addr && c.addr === k.addr) return 'local';
      if (k.pay && c.pay === k.pay) return 'pagamento';
    }
    return '';
  }
  const blockLog = (acc, reason) => { DB.blocked = [...DB.blocked.slice(-99), { at: Date.now(), account: acc.email, reason }]; save(); };
  const prizeConfig = () => {
    const r = getSettings().raspadinha;
    return (r && Array.isArray(r.prizes) && r.prizes.length ? r.prizes : DEFAULT_PRIZES).map(normPrize);
  };
  function awardedCount(prizeId) {
    const today = dayKey(Date.now()); let total = 0, day = 0;
    for (const a of Object.values(DB.accounts)) for (const p of a.prizes) if (p.prizeId === prizeId) { total++; if (dayKey(p.at) === today) day++; }
    return { total, today: day };
  }
  // Brinde livre para usar: não usado, não vencido, pedido mínimo atendido e não preso a um pedido ainda em andamento
  function usable(p, subtotal) {
    if (p.usedOrder || (p.expiresAt && p.expiresAt < Date.now())) return false;
    if (p.reservedOrder) {
      const o = getOrders()[p.reservedOrder];
      const dead = !o || (!o.paymentConfirmed && (['rejected', 'cancelled'].includes(String(o.mpStatus)) || Date.now() - (p.reservedAt || 0) > 45 * 60000));
      if (!dead) return false;
    }
    return subtotal === undefined || subtotal >= (p.minOrder || 0);
  }
  const codes = new Map(); // código de 10 min gerado ao ler o QR do balcão
  const nextTicket = (acc) => acc.tickets.find((t) => !t.used && ticketOk(t));
  const tokenOk = (given) => { try { return crypto.timingSafeEqual(Buffer.from(String(given || '')), Buffer.from(DB.qrToken)); } catch { return false; } };

  app.post('/api/account/raspadinha/code', needFresh, (req, res) => {
    const acc = req.account;
    if (!tokenOk((req.body || {}).qr)) return err(res, 400, 'qr_invalido');
    const t = nextTicket(acc);
    if (!t) return err(res, 409, 'sem_raspadinha');
    const why = conflict(acc, keysFor(acc, t));
    if (why) { blockLog(acc, why); return err(res, 403, 'raspadinha_bloqueada'); }
    for (const [c, v] of codes) if (v.acc === acc.id || v.exp < Date.now()) codes.delete(c);
    const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const code = Array.from(crypto.randomBytes(8), (x) => A[x % A.length]).join('');
    codes.set(code, { acc: acc.id, ticket: t.id, exp: Date.now() + 600000 });
    res.json({ success: true, code, expiresInSec: 600 });
  });

  app.post('/api/account/raspadinha/scratch', needFresh, (req, res) => {
    const acc = req.account;
    const code = String((req.body || {}).code || '').toUpperCase();
    const c = codes.get(code);
    if (!c || c.acc !== acc.id || c.exp < Date.now()) return err(res, 400, 'codigo_invalido');
    const t = acc.tickets.find((x) => x.id === c.ticket && !x.used && ticketOk(x));
    if (!t) { codes.delete(code); return err(res, 409, 'sem_raspadinha'); }
    const k = keysFor(acc, t);
    const why = conflict(acc, k);
    if (why) { codes.delete(code); blockLog(acc, why); return err(res, 403, 'raspadinha_bloqueada'); }
    codes.delete(code);
    // Prêmio com limite (por dia ou no total) esgotado sai do sorteio
    const cfg = prizeConfig().filter((p) => {
      if (!p.dailyLimit && !p.totalLimit) return true;
      const n = awardedCount(p.id);
      return (!p.totalLimit || n.total < p.totalLimit) && (!p.dailyLimit || n.today < p.dailyLimit);
    });
    const total = cfg.reduce((s, p) => s + p.weight, 0);
    let won = null;
    if (total > 0) { let r = crypto.randomInt(0, total * 100) / 100; for (const p of cfg) { r -= p.weight; if (r < 0) { won = p; break; } } }
    if (won && won.type === 'nada') won = null;
    t.used = true; t.usedAt = Date.now();
    DB.claims.push({ acc: acc.id, cpf: k.cpf, name: k.name, addr: k.addr, pay: k.pay, at: Date.now() });
    const prize = won ? { id: crypto.randomBytes(6).toString('hex'), prizeId: won.id, type: won.type, value: won.value, name: prizeLabel(won), minOrder: won.minOrder, at: Date.now(), expiresAt: won.validDays ? Date.now() + won.validDays * DAY : 0, usedOrder: null } : null;
    if (prize) acc.prizes.push(prize);
    // Recompensa acumulada: raspadinha premiada soma 1; ao completar, ganha o Dad's Special e a contagem recomeça
    let special = false;
    const sp = specialCfg(getSettings().raspadinha);
    if (prize && sp.enabled) {
      acc.progress = (acc.progress || 0) + 1;
      if (acc.progress >= sp.threshold) {
        acc.progress = 0; special = true;
        acc.prizes.push({ id: crypto.randomBytes(6).toString('hex'), prizeId: 'special', type: 'item', mystery: true, value: 0, name: sp.name, minOrder: 0, at: Date.now(), expiresAt: sp.validDays ? Date.now() + sp.validDays * DAY : 0, usedOrder: null });
      }
    }
    save();
    res.json({ success: true, special: special ? sp.name : null, progress: acc.progress || 0, threshold: sp.enabled ? sp.threshold : 0, prize: prize ? { name: prize.name, type: prize.type, minOrder: prize.minOrder, expiresAt: prize.expiresAt } : null, left: acc.tickets.filter((x) => !x.used && ticketOk(x)).length });
  });

  // Dono: endereço que vira o QR code impresso no balcão e as tentativas barradas
  // O QR do balcão tem que apontar para o endereço público (https); sem APP_URL usa o endereço por onde o painel foi aberto
  const qrUrl = (req) => { const base = appUrl() || `${req.protocol}://${req.get('host')}`; return { url: `${base}/?raspadinha=${DB.qrToken}`, https: /^https:\/\//i.test(base) }; };
  app.get('/api/admin/raspadinha', requireAdmin, (req, res) => {
    const cfg = getSettings().raspadinha && Array.isArray(getSettings().raspadinha.prizes) && getSettings().raspadinha.prizes.length ? getSettings().raspadinha.prizes : null;
    const awarded = {}; for (const p of prizeConfig()) awarded[p.id] = awardedCount(p.id);
    res.json({ ...qrUrl(req), prizes: prizeConfig(), special: specialCfg(getSettings().raspadinha), awarded, defaultPrizes: !cfg, blocked: DB.blocked.slice(-30).reverse(), accounts: Object.keys(DB.accounts).length, claims: DB.claims.length });
  });
  // ---- Clientes no painel: ver, bloquear, redefinir senha, desligar a 2ª etapa, dar raspadinha, apagar ----
  const orderCount = (acc) => Object.values(getOrders()).filter((o) => o && o.accountId === acc.id && o.paymentConfirmed).length;
  const adminView = (acc) => ({
    id: acc.id, name: acc.name, cpf: maskCpf(acc.cpf), phone: acc.phone, email: acc.email, createdAt: acc.createdAt, lastLogin: acc.lastLogin || 0,
    blocked: Boolean(acc.blocked), blockReason: acc.blockReason || '', twoFactor: Boolean(acc.totp && acc.totp.enabled), orders: orderCount(acc),
    progress: acc.progress || 0, tickets: acc.tickets.filter((t) => !t.used && ticketOk(t)).length,
    prizes: acc.prizes.filter((p) => !p.usedOrder && !(p.expiresAt && p.expiresAt < Date.now())).map((p) => ({ name: p.name, mystery: Boolean(p.mystery), expiresAt: p.expiresAt || 0 })),
    won: acc.prizes.length
  });
  app.get('/api/admin/users', requireAdmin, (req, res) => {
    const q = norm(req.query.q || ''); const qd = digits(req.query.q || '');
    const list = Object.values(DB.accounts).filter((a) => !q || a.nameKey.includes(q) || a.email.includes(String(req.query.q || '').trim().toLowerCase()) || (qd.length >= 4 && (a.phone.includes(qd) || a.cpf.endsWith(qd)))).sort((a, b) => b.createdAt - a.createdAt).slice(0, 200);
    res.json({ total: Object.keys(DB.accounts).length, users: list.map(adminView) });
  });
  const userOr404 = (req, res) => { const a = DB.accounts[req.params.id]; if (!a) err(res, 404, 'conta_nao_encontrada'); return a; };
  app.post('/api/admin/users/:id/block', requireAdmin, (req, res) => {
    const a = userOr404(req, res); if (!a) return;
    a.blocked = Boolean((req.body || {}).blocked); a.blockReason = a.blocked ? String((req.body || {}).reason || '').slice(0, 120) : '';
    if (a.blocked) a.ver += 1; // derruba as sessões abertas na hora
    save(); res.json({ success: true, user: adminView(a) });
  });
  app.post('/api/admin/users/:id/reset-password', requireAdmin, async (req, res) => {
    const a = userOr404(req, res); if (!a) return;
    const A = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const temp = Array.from(crypto.randomBytes(12), (x) => A[x % A.length]).join('');
    a.pass = await hashPw(temp); a.ver += 1; save(); // a senha provisória só aparece agora, uma vez
    res.json({ success: true, tempPassword: temp });
  });
  app.post('/api/admin/users/:id/2fa-off', requireAdmin, (req, res) => {
    const a = userOr404(req, res); if (!a) return;
    a.totp = null; a.ver += 1; save(); res.json({ success: true, user: adminView(a) });
  });
  app.post('/api/admin/users/:id/ticket', requireAdmin, (req, res) => {
    const a = userOr404(req, res); if (!a) return;
    a.tickets.push({ id: crypto.randomBytes(6).toString('hex'), kind: 'gift', used: false, at: Date.now() }); save();
    res.json({ success: true, user: adminView(a) });
  });
  app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
    const a = userOr404(req, res); if (!a) return;
    // Apagar a conta apaga os dados pessoais dela; os pedidos ficam (sem o vínculo) e a memória anti-fraude guarda só códigos embaralhados
    for (const o of Object.values(getOrders())) if (o && o.accountId === a.id) delete o.accountId;
    if (typeof saveOrders === 'function') saveOrders();
    for (const [c, v] of codes) if (v.acc === a.id) codes.delete(c);
    delete DB.accounts[a.id]; save();
    res.json({ success: true });
  });

  app.get('/api/admin/raspadinha/qr.svg', requireAdmin, async (req, res) => {
    res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    res.send(await QRCode.toString(qrUrl(req).url, { type: 'svg', margin: 2, width: 320, errorCorrectionLevel: 'M' }));
  });

  return {
    accountOf,
    // Chamado quando o Mercado Pago confirma um pedido: brinde ganho entra no pedido e o pedido gera uma raspadinha
    // Pedido feito com conta: usa o brinde livre mais antigo cujo pedido mínimo foi atendido. Desconto já entra no valor cobrado
    // (priced.total); o brinde fica preso a este pedido até o pagamento sair (ou até o pedido morrer).
    reserveBenefit(req, oid, priced) {
      const acc = accountOf(req);
      const p = acc && (acc.prizes.find((x) => x.mystery && usable(x, priced.subtotal)) || acc.prizes.find((x) => usable(x, priced.subtotal)));
      if (!p) return null;
      let discount = 0;
      if (p.type === 'desconto_pct') discount = round2(priced.subtotal * p.value / 100);
      else if (p.type === 'desconto_reais') discount = Math.min(p.value, priced.subtotal);
      else if (p.type === 'frete_gratis') discount = priced.deliveryFee;
      discount = Math.max(0, Math.min(round2(discount), round2(priced.total - 1))); // a cobrança nunca fica abaixo de R$ 1
      if (discount > 0) { priced.discount = discount; priced.total = round2(priced.total - discount); }
      p.reservedOrder = oid; p.reservedAt = Date.now();
      save();
      return { prizeId: p.id, name: p.name, type: p.type, mystery: Boolean(p.mystery), discount };
    },
    onPaid(order, mpPayment) {
      const acc = order.accountId && DB.accounts[order.accountId];
      if (!acc) return;
      order.payFp = payFp(mpPayment);
      const b = order.benefit;
      const pr = b && acc.prizes.find((x) => x.id === b.prizeId);
      if (pr && !pr.usedOrder && order.order && Array.isArray(order.order.items)) {
        pr.usedOrder = order.orderId;
        const line = b.mystery ? { name: `🎁 ${b.name} — item surpresa da casa`, q: 1, price: 0 } : b.type === 'item' ? { name: `🎁 Brinde: ${b.name}`, q: 1, price: 0 } : { name: `🎁 ${b.name}`, q: 1, price: -(Number(b.discount) || 0) };
        order.order.items = [...order.order.items, line];
      }
      if (!acc.tickets.some((t) => t.orderId === order.orderId)) acc.tickets.push({ id: crypto.randomBytes(6).toString('hex'), kind: 'order', orderId: order.orderId, used: false, at: Date.now() });
      save();
    },
    _db: () => DB
  };
}
