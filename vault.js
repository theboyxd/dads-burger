// Cofre de chaves, registro de acontecimentos e senha de uso único (Google Authenticator) do Financeiro.
// Tudo fica na pasta de dados, nunca no git nem como arquivo estático:
//   secrets.json  as chaves (Mercado Pago, 99 Empresas) criptografadas com AES-256-GCM e o estado do Authenticator
//   secrets.key   a chave que as protege (modo 600: só o usuário do servidor lê). Sem ela o secrets.json não abre.
//   events.json   as últimas 400 coisas que aconteceram (pedido, pagamento, entrega, entrada no painel...), sem dados de clientes
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { b32encode, b32decode, hotp } from './accounts.js';

const EVENT_KEEP = 400;
const PENDING_MINUTES = 30;      // o QR Code de configuração vale 30 minutos
const TRIES = 5;                 // erros seguidos de código antes de travar
const LOCK_MS = 10 * 60 * 1000;  // quanto tempo o Financeiro fica travado depois disso
const sha256hex = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const same = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const plain = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});

export function createVault({ DATA_DIR, writeJson, log = console }) {
  const SECRETS_FILE = path.join(DATA_DIR, 'secrets.json');
  const KEY_FILE = path.join(DATA_DIR, 'secrets.key');
  const EVENTS_FILE = path.join(DATA_DIR, 'events.json');

  // ---- a chave que protege tudo ----
  const readKey = () => { try { const k = Buffer.from(fs.readFileSync(KEY_FILE, 'utf-8').trim(), 'hex'); return k.length === 32 ? k : null; } catch { return null; } };
  let KEY = readKey();
  if (!KEY) {
    const fresh = crypto.randomBytes(32);
    const exists = fs.existsSync(KEY_FILE); // arquivo estragado: refaz; arquivo que não existe: cria sem passar por cima de outro processo que criou agora
    try { fs.writeFileSync(KEY_FILE, fresh.toString('hex'), { mode: 0o600, flag: exists ? 'w' : 'wx' }); KEY = fresh; } catch { KEY = readKey() || fresh; }
  }
  // AAD = nome do campo: um valor guardado num campo não abre em outro
  const seal = (name, text) => {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
    c.setAAD(Buffer.from(name));
    const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
  };
  const open = (name, s) => {
    const b = Buffer.from(String(s), 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12));
    d.setAAD(Buffer.from(name));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  };

  // ---- estado gravado ----
  let DB = { v: 1, secrets: {}, config: {}, finance: null };
  try {
    const j = plain(JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf-8')));
    DB = { v: 1, secrets: plain(j.secrets), config: plain(j.config), finance: j.finance && typeof j.finance === 'object' ? j.finance : null };
  } catch { /* primeira vez */ }
  const cache = new Map();
  let warned = false;

  // grava uma cópia alterada; só vira o estado de verdade se o disco aceitou
  function commit(mutate) {
    const next = JSON.parse(JSON.stringify(DB));
    mutate(next);
    if (!writeJson(SECRETS_FILE, next)) return false;
    try { fs.chmodSync(SECRETS_FILE, 0o600); } catch { /* sistemas sem modo de arquivo */ }
    DB = next;
    cache.clear();
    return true;
  }

  // ---- chaves ----
  function secret(name) {
    if (cache.has(name)) return cache.get(name);
    const e = DB.secrets[name];
    let v = '';
    if (e && e.ct) {
      try { v = open(name, e.ct); } catch {
        if (!warned) { warned = true; log.warn('Aviso: não consegui abrir as chaves guardadas (secrets.json). A secrets.key mudou ou foi apagada: conecte as chaves de novo no painel.'); }
      }
    }
    cache.set(name, v);
    return v;
  }
  const has = (name) => Boolean(secret(name));
  const hint = (name) => (has(name) ? String((DB.secrets[name] || {}).hint || '') : '');
  const savedAt = (name) => (has(name) ? Number((DB.secrets[name] || {}).at) || 0 : 0);
  const setSecrets = (obj) => commit((n) => {
    for (const [name, value] of Object.entries(obj)) {
      const v = String(value);
      n.secrets[name] = { ct: seal(name, v), hint: v.slice(-4), at: Math.round(Date.now() / 1000) };
    }
  });
  const removeSecrets = (names) => commit((n) => { for (const name of names) delete n.secrets[name]; });
  const config = (name) => String(DB.config[name] || '');
  const setConfig = (name, value) => commit((n) => { if (value) n.config[name] = String(value); else delete n.config[name]; });

  // ---- acontecimentos (o terminal do painel) ----
  let EV = [];
  let seq = 0;
  try {
    const j = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf-8'));
    if (Array.isArray(j)) {
      EV = j.filter((e) => e && Number(e.id) > 0 && e.title).slice(-EVENT_KEEP);
      seq = EV.reduce((m, e) => Math.max(m, Number(e.id)), 0);
    }
  } catch { /* primeira vez */ }
  let evTimer = null;
  const flush = () => { if (evTimer) { clearTimeout(evTimer); evTimer = null; } writeJson(EVENTS_FILE, EV); };
  function event(kind, level, title, detail = '', extra = {}) {
    const e = {
      id: ++seq,
      at: Math.round(Date.now()) / 1000,
      kind: String(kind).slice(0, 40),
      level: ['ok', 'info', 'warn', 'error'].includes(level) ? level : 'info',
      title: String(title).slice(0, 140),
      detail: String(detail || '').slice(0, 280),
      ...(extra && extra.orderId ? { orderId: String(extra.orderId).slice(0, 24) } : {})
    };
    EV.push(e);
    if (EV.length > EVENT_KEEP) EV.splice(0, EV.length - EVENT_KEEP);
    if (!evTimer) { evTimer = setTimeout(() => { evTimer = null; writeJson(EVENTS_FILE, EV); }, 1000); if (evTimer.unref) evTimer.unref(); }
    return e;
  }
  const events = (after = 0, limit = 80) => EV.filter((e) => e.id > after).slice(-Math.max(1, Math.min(200, limit)));
  const clearEvents = () => { EV = []; flush(); };

  // ---- Financeiro: Google Authenticator (TOTP, RFC 6238) ----
  const fin = () => DB.finance || null;
  function finStatus() {
    const f = fin();
    const pending = Boolean(f && !f.active && f.pending && Date.now() - Number(f.pendingAt || 0) < PENDING_MINUTES * 60000);
    return { configured: Boolean(f && f.active), pending, recoveryLeft: f && f.active ? (f.recovery || []).length : 0 };
  }
  // devolve o número do passo de 30 s em que o código vale (ou -1). Sem saída antecipada: o tempo não revela nada.
  function totpStep(secretB32, code, now = Date.now()) {
    const c = String(code || '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(c)) return -1;
    const sec = b32decode(secretB32);
    const cur = Math.floor(now / 30000);
    let hit = -1;
    for (const d of [-1, 0, 1]) if (same(hotp(sec, cur + d), c)) hit = cur + d;
    return hit;
  }
  // 5 códigos errados seguidos travam o Financeiro por 10 minutos (vale para qualquer sessão: o dono é um só)
  const lim = { fails: [], lockedUntil: 0 };
  const gate = () => {
    const now = Date.now();
    return now < lim.lockedUntil ? { error: 'bloqueado_temporariamente', waitSec: Math.ceil((lim.lockedUntil - now) / 1000) } : null;
  };
  const miss = () => {
    const now = Date.now();
    lim.fails = lim.fails.filter((t) => now - t < LOCK_MS);
    lim.fails.push(now);
    if (lim.fails.length >= TRIES) { lim.lockedUntil = now + LOCK_MS; lim.fails = []; return { error: 'bloqueado_temporariamente', waitSec: Math.round(LOCK_MS / 1000) }; }
    return { error: 'codigo_incorreto', left: TRIES - lim.fails.length };
  };
  const hit = () => { lim.fails = []; };

  async function finBeginSetup({ issuer, account }) {
    if (finStatus().configured) return { ok: false, error: 'ja_configurado' };
    const secretB32 = b32encode(crypto.randomBytes(20));
    if (!commit((n) => { n.finance = { active: false, pending: seal('fin.pending', secretB32), pendingAt: Date.now() }; })) return { ok: false, error: 'nao_foi_possivel_salvar' };
    const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 260, errorCorrectionLevel: 'M' });
    return { ok: true, secret: secretB32, uri, qr };
  }

  // O primeiro código certo liga o Authenticator e entrega 8 códigos de recuperação (aparecem só agora; guardamos só o resumo deles)
  function finActivate(code) {
    const f = fin();
    if (!f || f.active || !f.pending || Date.now() - Number(f.pendingAt || 0) > PENDING_MINUTES * 60000) return { ok: false, error: 'sem_configuracao_pendente' };
    const g = gate();
    if (g) return { ok: false, ...g };
    let secretB32 = '';
    try { secretB32 = open('fin.pending', f.pending); } catch { return { ok: false, error: 'sem_configuracao_pendente' }; }
    const step = totpStep(secretB32, code);
    if (step < 0) return { ok: false, ...miss() };
    const codes = Array.from({ length: 8 }, () => crypto.randomBytes(4).toString('hex').replace(/^(.{4})/, '$1-'));
    const ok = commit((n) => { n.finance = { active: true, secret: seal('fin.totp', secretB32), at: Date.now(), recovery: codes.map((c) => sha256hex(c.replace('-', ''))), lastStep: step }; });
    if (!ok) return { ok: false, error: 'nao_foi_possivel_salvar' };
    hit();
    return { ok: true, recovery: codes };
  }

  // Código do app (6 dígitos) ou código de recuperação (xxxx-xxxx, vale uma vez). O mesmo código do app não abre duas vezes.
  function finVerify(code) {
    const f = fin();
    if (!f || !f.active) return { ok: false, error: 'nao_configurado' };
    const g = gate();
    if (g) return { ok: false, ...g };
    const raw = String(code || '').trim();
    if (/^\d{3}\s?\d{3}$/.test(raw)) {
      let sec = '';
      try { sec = open('fin.totp', f.secret); } catch { return { ok: false, error: 'nao_configurado' }; }
      const step = totpStep(sec, raw);
      if (step < 0) return { ok: false, ...miss() };
      if (step <= Number(f.lastStep || -1)) return { ok: false, error: 'codigo_ja_usado' };
      if (!commit((n) => { n.finance.lastStep = step; })) return { ok: false, error: 'nao_foi_possivel_salvar' };
      hit();
      return { ok: true, how: 'app' };
    }
    const rc = raw.toLowerCase().replace(/[\s-]/g, '');
    if (/^[0-9a-f]{8}$/.test(rc)) {
      const h = sha256hex(rc);
      let idx = -1;
      (f.recovery || []).forEach((x, i) => { if (same(x, h)) idx = i; });
      if (idx < 0) return { ok: false, ...miss() };
      if (!commit((n) => { n.finance.recovery.splice(idx, 1); })) return { ok: false, error: 'nao_foi_possivel_salvar' };
      hit();
      return { ok: true, how: 'recuperacao', left: Math.max(0, (f.recovery || []).length - 1) };
    }
    return { ok: false, ...miss() };
  }
  const finReset = () => commit((n) => { n.finance = null; });

  return { secret, has, hint, savedAt, setSecrets, removeSecrets, config, setConfig, event, events, clearEvents, flush, finStatus, finBeginSetup, finActivate, finVerify, finReset };
}
