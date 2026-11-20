// Chamar o motoboy à mão: links e mensagem prontos de um pedido de entrega.
// Este arquivo só monta texto e endereços (nada de rede, disco ou relógio): o servidor entrega o resultado ao painel.
//
// O que existe de verdade (conferido em 2026-11-20):
//  - Uber: link universal https://m.uber.com/ul/?action=setPickup&pickup[...]&dropoff[...] (documentado pela Uber).
//    No celular com o app instalado ele abre com coleta e entrega preenchidas; no computador abre o site, sem preencher.
//  - 99: NÃO existe link público que preencha os endereços (e a API para empresas está "temporariamente indisponível").
//    O painel copia o endereço e abre a 99. Se a 99 passar um modelo de link, o dono cola em Conexões e ele entra aqui,
//    com {entrega}, {coleta} e as outras chaves de NN99_FIELDS no lugar do texto.
//  - WhatsApp: https://wa.me/NUMERO?text=MENSAGEM (documentado pelo WhatsApp).
//  - Google Maps: https://www.google.com/maps/dir/?api=1&origin=...&destination=... (documentado pelo Google).
//
// Tudo que vem do pedido é texto do cliente: aqui sempre vira texto limpo (sem quebra de linha, sem caractere de
// controle, com tamanho máximo) antes de entrar em qualquer link ou mensagem.

export const UBER_BASE = 'https://m.uber.com/ul/';
export const MAPS_BASE = 'https://www.google.com/maps/dir/';
// Página da 99 que abre quando o dono não colou um link próprio: a da 99 para Empresas (o painel de gestão fica ali)
export const NN99_URL = 'https://99app.com/empresas/';
export const NN99_FIELDS = ['coleta', 'entrega', 'coleta_lat', 'coleta_lon', 'entrega_lat', 'entrega_lon', 'pedido', 'cliente', 'telefone'];

// Controle, separadores de linha e marcas de direção do texto (usadas para disfarçar texto): tudo vira espaço.
// A lista é de números (e não de caracteres escritos no arquivo) para nenhum editor ou ferramenta estragar o padrão.
const CTRL_RANGES = [[0, 31], [127, 159], [0x2028, 0x2029], [0x200b, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff]];
const CTRL = new RegExp(`[${CTRL_RANGES.map(([x, y]) => String.fromCharCode(x) + (y > x ? `-${String.fromCharCode(y)}` : '')).join('')}]`, 'g');

export function cleanText(v, max = 200) {
  if (v === null || v === undefined || typeof v === 'object' || typeof v === 'function' || typeof v === 'symbol') return '';
  const s = String(v).replace(CTRL, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, max).join('').trim();
}

const digitsOf = (v) => cleanText(v, 40).replace(/\D/g, '');

// Celular ou fixo do Brasil -> só números, com o 55 na frente. Vazio quando não parece um telefone (ou quando o "+" na
// frente mostra que é de outro país).
export function phoneBR(v) {
  const d = digitsOf(v).replace(/^0+/, '');
  if (cleanText(v, 40).startsWith('+') && !d.startsWith('55')) return '';
  if (d.length === 12 || d.length === 13) return d.startsWith('55') ? d : '';
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return '';
}

export function phoneShow(p) {
  const d = String(p || '');
  if (!/^55\d{10,11}$/.test(d)) return d;
  const n = d.slice(2);
  return n.length === 11 ? `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}` : `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
}

const cepShow = (v) => { const d = digitsOf(v); return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : ''; };

// Coordenada válida (dentro do planeta e não o ponto 0,0) com 6 casas, ou null
export function coordOf(lat, lon) {
  if (lat === null || lat === undefined || lat === '' || lon === null || lon === undefined || lon === '') return null;
  const a = Number(lat); const b = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180 || (a === 0 && b === 0)) return null;
  return { lat: Math.round(a * 1e6) / 1e6, lon: Math.round(b * 1e6) / 1e6 };
}

// "Rua X, 1 - Bairro, Porto Alegre - RS, 90000-000" -> "RS" (a sigla vem do endereço da própria unidade)
const stateOf = (addr) => { const m = / - ([A-Z]{2})(?:,|\s|$)/.exec(String(addr || '')); return m ? m[1] : ''; };

// Endereço de entrega do pedido. Vale o endereço em campos (é o mesmo que mediu a distância e o frete); sem ele, o texto
// que o cliente montou no site. Tudo é texto não confiável.
export function dropoffOf(order, state = '') {
  const o = order && typeof order === 'object' ? order : {};
  const inner = o.order && typeof o.order === 'object' ? o.order : {};
  const det = inner.addressDetails && typeof inner.addressDetails === 'object' && !Array.isArray(inner.addressDetails) ? inner.addressDetails : {};
  const rua = cleanText(det.rua, 120); const numero = cleanText(det.numero, 20);
  const bairro = cleanText(det.bairro, 80); const cidade = cleanText(det.cidade, 80); const cep = cepShow(det.cep);
  const ref = cleanText(det.ref !== undefined ? det.ref : inner.ref, 160);
  if (rua) {
    const street = numero ? `${rua}, ${numero}` : rua;
    const area = [bairro, cidade && state ? `${cidade} - ${state}` : cidade].filter(Boolean).join(', ');
    return { text: [area ? `${street} - ${area}` : street, cep].filter(Boolean).join(', '), ref, hasNumber: Boolean(numero) };
  }
  const free = cleanText(inner.address || (o.customer && o.customer.address), 300);
  return { text: free, ref, hasNumber: /\d/.test(free) };
}

const enc = encodeURIComponent;
const num6 = (n) => n.toFixed(6);

// Link do Uber. Com coordenada da coleta e da entrega abre o app com os dois endereços preenchidos (prefilled "tudo").
// Sem a coordenada exata do cliente, só a coleta vai preenchida ("coleta"). As chaves usam colchetes, como na documentação.
export function uberLink(pickup, dropoff) {
  const parts = [['action', 'setPickup']];
  const add = (prefix, loc) => {
    if (!loc || !coordOf(loc.lat, loc.lon)) return false;
    parts.push([`${prefix}[latitude]`, num6(loc.lat)], [`${prefix}[longitude]`, num6(loc.lon)]);
    if (loc.nickname) parts.push([`${prefix}[nickname]`, loc.nickname]);
    if (loc.address) parts.push([`${prefix}[formatted_address]`, loc.address]);
    return true;
  };
  const hasPickup = add('pickup', pickup);
  if (!hasPickup) parts.push(['pickup', 'my_location']);
  const hasDrop = add('dropoff', dropoff && { ...dropoff, nickname: dropoff.nickname || dropoff.name });
  return { url: `${UBER_BASE}?${parts.map(([k, v]) => `${k}=${enc(v)}`).join('&')}`, prefilled: hasDrop && hasPickup ? 'tudo' : hasPickup ? 'coleta' : 'nada' };
}

// Rota no Google Maps (o texto do endereço acha o número da casa melhor que a coordenada do CEP)
export function mapsLink(pickup, dropoff) {
  const dest = (dropoff && dropoff.address) || (dropoff && coordOf(dropoff.lat, dropoff.lon) ? `${num6(dropoff.lat)},${num6(dropoff.lon)}` : '');
  if (!dest) return '';
  const orig = (pickup && pickup.address) || (pickup && coordOf(pickup.lat, pickup.lon) ? `${num6(pickup.lat)},${num6(pickup.lon)}` : '');
  return `${MAPS_BASE}?api=1${orig ? `&origin=${enc(orig)}` : ''}&destination=${enc(dest)}&travelmode=driving`;
}

// Modelo de link da 99 (opcional): https com as chaves {entrega}, {coleta}... Devolve { ok, value }; vazio é válido (= sem modelo).
export function checkLink99(tpl) {
  const s = String(tpl === null || tpl === undefined ? '' : tpl).trim();
  if (!s) return { ok: true, value: '' };
  if (s.length > 600 || /\s/.test(s)) return { ok: false };
  const keys = s.match(/\{[^{}]*\}/g) || [];
  if (keys.some((k) => !NN99_FIELDS.includes(k.slice(1, -1)))) return { ok: false };
  if (/[{}]/.test(s.replace(/\{[^{}]*\}/g, ''))) return { ok: false };
  if (!/^https:\/\//i.test(s) || s.slice(8).split(/[/?#]/)[0].includes('{')) return { ok: false };
  let u;
  try { u = new URL(s.replace(/\{[^{}]*\}/g, 'x')); } catch { return { ok: false }; }
  if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return { ok: false };
  return { ok: true, value: s };
}
const fill99 = (tpl, vars) => tpl.replace(/\{([a-z_]+)\}/g, (_, k) => enc(vars[k] === undefined || vars[k] === null ? '' : String(vars[k])));

// Tudo o que o painel mostra em "Chamar motoboy".
//  order: o pedido guardado · unit: { name, address, lat, lon } da unidade que recebeu · brand: nome da loja
//  coords: { lat, lon, source: 'cep' | 'bairro' } do endereço do cliente (só a do CEP vale como ponto de entrega)
//  config: { whats, link99 } guardados em Conexões
export function buildCourierKit({ order, unit, brand, coords, config } = {}) {
  const o = order && typeof order === 'object' ? order : {};
  const u = unit && typeof unit === 'object' ? unit : {};
  const cfg = config && typeof config === 'object' ? config : {};
  const brandName = cleanText(brand, 40) || "Dad's Burger";
  const orderId = cleanText(o.orderId || o.id, 40);
  const cust = o.customer && typeof o.customer === 'object' ? o.customer : {};
  const name = cleanText(cust.name, 80) || 'Cliente';
  const phone = phoneBR(cust.phone);
  const paid = o.paymentConfirmed === true;

  const unitName = cleanText(u.name, 60);
  const pc = coordOf(u.lat, u.lon);
  const pickup = {
    name: cleanText(unitName ? `${brandName} · ${unitName}` : brandName, 100),
    nickname: cleanText(unitName ? `${brandName} ${unitName}` : brandName, 60),
    address: cleanText(u.address, 200),
    lat: pc ? pc.lat : null,
    lon: pc ? pc.lon : null
  };
  const d = dropoffOf(o, stateOf(pickup.address));
  // A coordenada do bairro é o centro do bairro: serviria só para levar o motoboy ao lugar errado. Só a do CEP entra.
  const dc = coords && coords.source === 'cep' ? coordOf(coords.lat, coords.lon) : null;
  const dropoff = { address: d.text, ref: d.ref, lat: dc ? dc.lat : null, lon: dc ? dc.lon : null, precise: Boolean(dc) };

  const warnings = [];
  if (!dropoff.address) warnings.push('sem_endereco');
  else if (!d.hasNumber) warnings.push('sem_numero');
  if (dropoff.address && !dropoff.precise) warnings.push('sem_coordenada');
  if (!phone) warnings.push('sem_telefone');

  const uber = uberLink(pickup, { ...dropoff, nickname: cleanText(dropoff.address, 60) });
  const maps = mapsLink(pickup, dropoff);
  const tel = phone ? ` · ${phoneShow(phone)}` : '';
  const lines = [
    `*Entrega ${brandName}*${orderId ? ` · pedido ${orderId}` : ''}`,
    `*Coleta:* ${pickup.name}`,
    pickup.address,
    `*Entrega:* ${name}${tel}`,
    dropoff.address || 'endereço não informado (confirme com o cliente)',
    dropoff.ref ? `Ref.: ${dropoff.ref}` : '',
    paid ? 'Pedido já pago online: não cobrar nada do cliente.' : '',
    maps ? `Rota: ${maps}` : ''
  ].filter(Boolean);
  const message = lines.join('\n');
  const whats = phoneBR(cfg.whats);
  const waUrl = `https://wa.me/${whats}?text=${enc(message)}`;

  const tpl = checkLink99(cfg.link99);
  const nn99 = tpl.ok && tpl.value
    ? { url: fill99(tpl.value, {
      coleta: pickup.address, entrega: dropoff.address,
      coleta_lat: pickup.lat === null ? '' : num6(pickup.lat), coleta_lon: pickup.lon === null ? '' : num6(pickup.lon),
      entrega_lat: dropoff.lat === null ? '' : num6(dropoff.lat), entrega_lon: dropoff.lon === null ? '' : num6(dropoff.lon),
      pedido: orderId, cliente: name, telefone: phone
    }), prefilled: true }
    : { url: NN99_URL, prefilled: false };

  return {
    orderId, paid,
    customer: { name, phone, phoneShow: phone ? phoneShow(phone) : '' },
    pickup, dropoff,
    links: { uber, maps, whatsapp: { url: waUrl, to: whats ? phoneShow(whats) : '', message }, nn99 },
    copy: {
      dropoff: dropoff.address,
      both: [`Coleta: ${pickup.name}`, pickup.address, '', `Entrega: ${name}${tel}`, dropoff.address || 'endereço não informado', dropoff.ref ? `Ref.: ${dropoff.ref}` : ''].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n').trim()
    },
    warnings
  };
}
