// Testes do gerador de links do motoboy (courier.js). Uso: node tests/courier_unit.mjs <caminho do courier.js>
// Cada linha impressa é "OK nome" ou "FAIL nome: detalhe"; o api_tests.py lê essas linhas e conta como conferências.
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const file = path.resolve(process.argv[2] || new URL('../courier.js', import.meta.url).pathname);
const C = await import(pathToFileURL(file).href);

let failed = 0;
const t = (name, fn) => {
  try {
    const r = fn();
    if (r === false) throw new Error('retornou falso');
    console.log(`OK ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 300)}`);
  }
};
const eq = (a, b, what = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what} esperado ${JSON.stringify(b)} mas veio ${JSON.stringify(a)}`); };
const ok = (v, what = 'condição falsa') => { if (!v) throw new Error(what); };

const UNIT = { name: "Passo d'Areia (Zona Norte)", address: "R. Sapé, 947 - Passo d'Areia, Porto Alegre - RS, 91350-050", lat: -30.01758, lon: -51.1557 };
const order = (over = {}) => ({
  orderId: 'DAD-1234', paymentConfirmed: true,
  customer: { name: 'João da Silva', phone: '51999998888' },
  order: { mode: 'entrega', address: 'Rua João & Maria, 123 - Centro', addressDetails: { rua: 'Rua João & Maria #7', numero: '123', bairro: 'São João', cidade: 'Porto Alegre', cep: '90560-000', ref: 'portão azul; falar com a Zé' } },
  ...over
});
const CEP = { lat: -30.0321, lon: -51.2073, source: 'cep' };
const q = (url) => new URL(url).searchParams;

// ---------- endereço com acento, vírgula, "&" e "#": chega inteiro, sem quebrar os parâmetros ----------
t('uber: o link é o universal da Uber com action=setPickup', () => { const k = C.buildCourierKit({ order: order(), unit: UNIT, coords: CEP }); ok(k.links.uber.url.startsWith('https://m.uber.com/ul/?action=setPickup&'), k.links.uber.url); });
t('uber: endereço com acento, vírgula, & e # volta idêntico depois de ler o link', () => {
  const k = C.buildCourierKit({ order: order(), unit: UNIT, coords: CEP });
  const p = q(k.links.uber.url);
  eq(p.get('dropoff[formatted_address]'), 'Rua João & Maria #7, 123 - São João, Porto Alegre - RS, 90560-000');
  ok(!/[ &#]/.test(k.links.uber.url.split('?')[1].replace(/&(action|pickup|dropoff)/g, '')), 'sobrou caractere perigoso sem codificar');
});
t('uber: coleta e entrega com latitude e longitude, nome da loja como apelido', () => {
  const k = C.buildCourierKit({ order: order(), unit: UNIT, coords: CEP }); const p = q(k.links.uber.url);
  eq(p.get('pickup[latitude]'), '-30.017580', 'lat coleta'); eq(p.get('pickup[longitude]'), '-51.155700', 'lon coleta');
  eq(p.get('dropoff[latitude]'), '-30.032100', 'lat entrega'); eq(p.get('dropoff[longitude]'), '-51.207300', 'lon entrega');
  ok(/Passo d'Areia/.test(p.get('pickup[nickname]')) && p.get('pickup[formatted_address]') === UNIT.address, 'nome/endereço da coleta');
  eq(k.links.uber.prefilled, 'tudo');
});
t('uber: sem coordenada exata do cliente, só a coleta vai preenchida (nunca inventa a entrega)', () => {
  for (const coords of [null, undefined, { lat: -30.03, lon: -51.2, source: 'bairro' }, { lat: 'x', lon: 1, source: 'cep' }, { lat: 0, lon: 0, source: 'cep' }]) {
    const k = C.buildCourierKit({ order: order(), unit: UNIT, coords }); const p = q(k.links.uber.url);
    ok(!p.has('dropoff[latitude]') && !p.has('dropoff[formatted_address]'), `entrega apareceu com ${JSON.stringify(coords)}`);
    eq(k.links.uber.prefilled, 'coleta'); ok(k.warnings.includes('sem_coordenada'), 'aviso sem_coordenada');
    eq(k.dropoff.precise, false);
  }
});
t('uber: unidade sem coordenada usa pickup=my_location em vez de quebrar', () => {
  const k = C.buildCourierKit({ order: order(), unit: { name: 'X', address: 'Rua Y, 1' }, coords: CEP }); const p = q(k.links.uber.url);
  eq(p.get('pickup'), 'my_location'); ok(!p.has('pickup[latitude]')); eq(k.links.uber.prefilled, 'nada');
});

// ---------- pedido sem endereço ----------
t('pedido sem endereço: não quebra, avisa e não monta rota nem entrega', () => {
  const o = order({ order: { mode: 'entrega' } });
  const k = C.buildCourierKit({ order: o, unit: UNIT, coords: null });
  ok(k.warnings.includes('sem_endereco'), 'aviso sem_endereco'); eq(k.dropoff.address, ''); eq(k.links.maps, '');
  ok(/endereço não informado/.test(k.links.whatsapp.message), 'mensagem avisa'); ok(k.links.whatsapp.url.startsWith('https://wa.me/?text='), 'wa.me sem número');
  ok(!q(k.links.uber.url).has('dropoff[latitude]'), 'sem entrega no Uber');
});
t('pedido sem nada (objeto vazio, null, números) não lança erro', () => {
  for (const x of [{}, null, undefined, { customer: null, order: null }, { order: { addressDetails: 'texto' } }, { order: { addressDetails: [1, 2] } }, { customer: { name: 42, phone: {} }, order: { addressDetails: { rua: { a: 1 }, numero: ['x'] } } }]) {
    const k = C.buildCourierKit({ order: x, unit: UNIT, coords: null }); ok(typeof k.links.uber.url === 'string' && typeof k.links.whatsapp.message === 'string');
  }
  const k = C.buildCourierKit({}); ok(k.links.uber.url.startsWith('https://m.uber.com/ul/?'));
});
t('só o texto livre do site (sem campos) ainda serve de endereço', () => {
  const k = C.buildCourierKit({ order: order({ order: { mode: 'entrega', address: 'Av. Ipiranga, 5000 - Jardim Botânico, Porto Alegre - CEP 90000-000' } }), unit: UNIT, coords: CEP });
  eq(k.dropoff.address, 'Av. Ipiranga, 5000 - Jardim Botânico, Porto Alegre - CEP 90000-000');
});
t('endereço sem número da casa dá aviso sem_numero', () => {
  const o = order(); o.order.addressDetails.numero = '';
  ok(C.buildCourierKit({ order: o, unit: UNIT, coords: CEP }).warnings.includes('sem_numero'));
});

// ---------- texto do cliente nunca entra sem limpar ----------
t('quebra de linha, controle e texto gigante viram texto limpo e curto', () => {
  const o = order(); o.customer.name = 'Ana\nSilva‮\u0000' + 'x'.repeat(500); o.order.addressDetails.rua = 'Rua\r\nA\tB' + 'y'.repeat(900); o.order.addressDetails.ref = 'ref\n\n' + 'z'.repeat(900);
  const k = C.buildCourierKit({ order: o, unit: UNIT, coords: CEP });
  ok(!/[\n\r\t‮\u0000]/.test(k.customer.name + k.dropoff.address + k.dropoff.ref), 'sobrou controle');
  ok(k.customer.name.length <= 80 && k.dropoff.address.length <= 400 && k.dropoff.ref.length <= 160, 'passou do limite');
  ok(k.links.whatsapp.message.split('\n').length <= 9, 'mensagem ganhou linhas extras');
  ok(k.links.uber.url.length < 1700, `link do Uber enorme: ${k.links.uber.url.length}`);
});
t('cleanText: número vira texto, objeto vira vazio', () => { eq(C.cleanText(123), '123'); eq(C.cleanText({ a: 1 }), ''); eq(C.cleanText(null), ''); eq(C.cleanText('  a   b  '), 'a b'); });

// ---------- telefone ----------
t('telefone: celular e fixo ganham o 55; lixo vira vazio', () => {
  eq(C.phoneBR('(51) 99999-8888'), '5551999998888'); eq(C.phoneBR('51 3333-4444'), '555133334444'); eq(C.phoneBR('+55 51 99999-8888'), '5551999998888');
  eq(C.phoneBR('051 99999-8888'), '5551999998888'); eq(C.phoneBR('123'), ''); eq(C.phoneBR(''), ''); eq(C.phoneBR(null), ''); eq(C.phoneBR('+1 415 555 2671'), '');
  eq(C.phoneShow('5551999998888'), '(51) 99999-8888');
});
t('pedido sem telefone válido avisa sem_telefone e a mensagem não mostra telefone', () => {
  const o = order(); o.customer.phone = '12';
  const k = C.buildCourierKit({ order: o, unit: UNIT, coords: CEP }); ok(k.warnings.includes('sem_telefone')); ok(!/\(\d\d\)/.test(k.links.whatsapp.message));
});

// ---------- WhatsApp ----------
t('whatsapp: mensagem tem pedido, coleta, entrega, cliente com telefone, referência e aviso de pago', () => {
  const k = C.buildCourierKit({ order: order(), unit: UNIT, coords: CEP, brand: "Dad's Burger" }); const m = k.links.whatsapp.message;
  for (const part of ['DAD-1234', UNIT.address, 'João da Silva · (51) 99999-8888', 'Rua João & Maria #7, 123 - São João, Porto Alegre - RS, 90560-000', 'Ref.: portão azul; falar com a Zé', 'não cobrar', 'https://www.google.com/maps/dir/?api=1']) ok(m.includes(part), `falta "${part}"`);
});
t('whatsapp: pedido não pago não diz "já pago"', () => { ok(!/não cobrar/.test(C.buildCourierKit({ order: order({ paymentConfirmed: false }), unit: UNIT, coords: CEP }).links.whatsapp.message)); });
t('whatsapp: link com número guardado vai direto ao motoboy e o texto volta idêntico', () => {
  const k = C.buildCourierKit({ order: order(), unit: UNIT, coords: CEP, config: { whats: '(51) 98888-7777' } }); const u = k.links.whatsapp.url;
  ok(u.startsWith('https://wa.me/5551988887777?text='), u); eq(decodeURIComponent(u.split('?text=')[1]), k.links.whatsapp.message); eq(k.links.whatsapp.to, '(51) 98888-7777');
});
t('whatsapp: número guardado inválido é ignorado (abre a escolha de contato)', () => {
  const k = C.buildCourierKit({ order: order(), unit: UNIT, coords: CEP, config: { whats: 'abc' } }); ok(k.links.whatsapp.url.startsWith('https://wa.me/?text=')); eq(k.links.whatsapp.to, '');
});

// ---------- Google Maps ----------
t('maps: origem é o endereço da loja e destino o do cliente, ambos codificados', () => {
  const k = C.buildCourierKit({ order: order(), unit: UNIT, coords: null }); const p = q(k.links.maps);
  eq(p.get('origin'), UNIT.address); eq(p.get('destination'), 'Rua João & Maria #7, 123 - São João, Porto Alegre - RS, 90560-000'); eq(p.get('travelmode'), 'driving'); eq(p.get('api'), '1');
});

// ---------- 99 ----------
t('99: sem modelo de link abre a página da 99 para Empresas e avisa que não vem preenchido', () => {
  const k = C.buildCourierKit({ order: order(), unit: UNIT, coords: CEP }); eq(k.links.nn99, { url: 'https://99app.com/empresas/', prefilled: false });
  eq(k.copy.dropoff, 'Rua João & Maria #7, 123 - São João, Porto Alegre - RS, 90560-000');
});
t('99: com modelo de link, preenche coleta, entrega e coordenadas codificadas', () => {
  const tpl = 'https://painel.exemplo.com.br/corrida?de={coleta}&para={entrega}&lat={entrega_lat}&lon={entrega_lon}&ped={pedido}';
  const k = C.buildCourierKit({ order: order(), unit: UNIT, coords: CEP, config: { link99: tpl } }); const p = q(k.links.nn99.url);
  eq(k.links.nn99.prefilled, true); eq(p.get('de'), UNIT.address); eq(p.get('para'), 'Rua João & Maria #7, 123 - São João, Porto Alegre - RS, 90560-000'); eq(p.get('lat'), '-30.032100'); eq(p.get('ped'), 'DAD-1234');
  eq(new URL(k.links.nn99.url).hostname, 'painel.exemplo.com.br');
});
t('99: modelo inseguro ou torto é recusado e nunca vira link', () => {
  for (const bad of ['http://x.com/?a={entrega}', 'javascript:alert(1)', 'https://x.com/?a={nome_que_nao_existe}', 'https://{entrega}.com/', 'https://x.com/ a', 'https://user:pw@x.com/?a={entrega}', 'ftp://x.com', 'https://x.com/?a={entrega', 'https://localhost/?a=1', 'https://x.com/' + 'a'.repeat(700)]) {
    eq(C.checkLink99(bad).ok, false, bad.slice(0, 40));
    eq(C.buildCourierKit({ order: order(), unit: UNIT, coords: CEP, config: { link99: bad } }).links.nn99.prefilled, false, 'usou modelo ruim');
  }
  eq(C.checkLink99('').ok, true); eq(C.checkLink99('   ').value, ''); eq(C.checkLink99('https://x.com.br/?a={entrega}&b={cliente}&c={telefone}&d={coleta_lat}').ok, true);
});

// ---------- só entram links https dos domínios esperados ----------
t('todos os links de saída são https e dos sites esperados', () => {
  const k = C.buildCourierKit({ order: order(), unit: UNIT, coords: CEP, config: { whats: '51988887777', link99: 'https://painel.exemplo.com.br/?a={entrega}' } });
  const hosts = [k.links.uber.url, k.links.maps, k.links.whatsapp.url, k.links.nn99.url].map((u) => new URL(u).host);
  eq(hosts, ['m.uber.com', 'www.google.com', 'wa.me', 'painel.exemplo.com.br']);
});

console.log(failed ? `RESULT ${failed} falharam` : 'RESULT todos passaram');
process.exit(failed ? 1 : 0);
