import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { mountAccounts } from './accounts.js';
import { createVault } from './vault.js';
import { MercadoPagoConfig, Payment, Preference, PaymentRefund } from 'mercadopago';

dotenv.config({ quiet: true });

// Onde o servidor escuta. Por padrão só esta máquina enxerga o servidor (127.0.0.1): nenhuma porta fica aberta para a rede
// nem para a internet. Para hospedar de verdade, a hospedagem define HOST=0.0.0.0 no ambiente dela.
const HOST = (process.env.HOST || '').trim() || '127.0.0.1';
const EXPOSED = !(/^127\./.test(HOST) || ['localhost', '::1', '[::1]'].includes(HOST));

// Servidor aberto para a rede sem senha própria no painel: não liga. A senha antiga (dads123) está escrita na página
// publicada no GitHub, então qualquer um que a leia entraria no painel. (Só em 127.0.0.1 ela ainda vale, com aviso.)
const PUBLISHED_PASSWORDS = ['dads123', 'admin123', 'dads2026'];
if (EXPOSED) {
  const pw = (process.env.ADMIN_PASSWORD || '').trim();
  if (!pw || PUBLISHED_PASSWORDS.includes(pw.toLowerCase())) {
    console.error(`ERRO: o servidor ficaria aberto para a rede (HOST=${HOST}), mas ADMIN_PASSWORD ${pw ? 'é uma senha que já foi publicada' : 'não está definida'}. Defina uma senha própria e longa em ADMIN_PASSWORD, no ambiente da hospedagem, e inicie de novo.`);
    process.exit(1);
  }
}

// Processador das fotos enviadas pelo painel. Se não carregar neste servidor, só o envio de fotos fica indisponível:
// a loja, os pedidos e os pagamentos continuam funcionando.
let sharp = null;
try {
  sharp = (await import('sharp')).default;
  sharp.cache(false);
} catch (e) {
  console.warn('Aviso: o módulo de imagens (sharp) não carregou; o envio de fotos pelo painel fica desligado.', e && e.message);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Pasta de dados: cardápio (products.json), configurações (settings.json), pedidos (orders.json) e fotos (uploads/).
// Sem DATA_DIR ficam ao lado do server.js, como sempre. Na hospedagem, DATA_DIR aponta para o disco persistente (ex.: /data):
// o que está nele sobrevive a reinício e a nova publicação; o que fica na pasta do programa some.
const DATA_DIR = path.resolve((process.env.DATA_DIR || '').trim() || __dirname);
const CUSTOM_DATA_DIR = DATA_DIR !== __dirname;
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

// Cria a pasta e as que faltam acima dela, um nível por vez. (O mkdir recursivo do Node pode ficar preso para sempre em
// caminhos que o sistema não deixa criar, como /proc: aqui o primeiro nível que falhar já dá o erro.)
function makeDirs(dir) {
  const missing = [];
  for (let cur = dir; !fs.existsSync(cur); cur = path.dirname(cur)) {
    missing.push(cur);
    if (path.dirname(cur) === cur) break;
  }
  for (const d of missing.reverse()) fs.mkdirSync(d);
}

function prepareDataDir() {
  const fail = (msg) => { console.error(`ERRO: ${msg}`); process.exit(1); };
  // 1. Tem que existir e aceitar gravação (teste de verdade: criar e apagar um arquivo). Sem isso o servidor não liga,
  //    em vez de rodar "sem disco" e perder pedidos.
  try {
    makeDirs(UPLOADS_DIR); // cria a pasta de dados junto
    const probe = path.join(DATA_DIR, `.teste-de-gravacao-${process.pid}.tmp`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
  } catch (e) {
    fail(`não consegui gravar na pasta de dados (DATA_DIR=${DATA_DIR}): ${e.message}. Confira se o disco persistente está conectado nesse caminho e se o servidor tem permissão de escrita nele.`);
  }
  // 2. No mesmo disco do programa = disco temporário do container, que se perde na próxima troca.
  //    REQUIRE_VOLUME=1 transforma o aviso em recusa de iniciar (a imagem Docker já vem com isso ligado).
  try {
    if (fs.statSync(DATA_DIR).dev === fs.statSync(__dirname).dev) {
      const msg = `a pasta de dados (${DATA_DIR}) está no mesmo disco do programa. Num container ou numa hospedagem com disco temporário, pedidos, fotos e cardápio somem no próximo reinício ou publicação: conecte o disco persistente nesse caminho.`;
      if (['1', 'true', 'sim'].includes(String(process.env.REQUIRE_VOLUME || '').trim().toLowerCase())) fail(`${msg} (REQUIRE_VOLUME está ligada)`);
      console.warn(`Aviso: ${msg} Defina REQUIRE_VOLUME=1 para o servidor se recusar a iniciar assim.`);
    }
  } catch (e) { /* sem como comparar os discos: segue */ }
  // 3. Primeira vez numa pasta vazia: o cardápio e as configurações que vêm com o programa são o ponto de partida.
  //    Nada que já exista é sobrescrito (nem em reinício, nem em publicação nova); os pedidos começam vazios.
  for (const f of ['products.json', 'settings.json']) {
    try { fs.copyFileSync(path.join(__dirname, f), path.join(DATA_DIR, f), fs.constants.COPYFILE_EXCL); } catch (e) {
      if (e.code !== 'EEXIST' && e.code !== 'ENOENT') fail(`não consegui criar ${f} na pasta de dados: ${e.message}`);
    }
  }
  try { fs.writeFileSync(ORDERS_FILE, '{}', { flag: 'wx' }); } catch (e) {
    if (e.code !== 'EEXIST') fail(`não consegui criar orders.json na pasta de dados: ${e.message}`);
  }
  // 4. Restos de gravações interrompidas (arquivo temporário que não chegou a virar o definitivo)
  for (const n of fs.readdirSync(DATA_DIR)) {
    if (/\.json\.\d+\.tmp$/.test(n)) { try { fs.unlinkSync(path.join(DATA_DIR, n)); } catch (e) { /* segue */ } }
  }
}
if (CUSTOM_DATA_DIR) prepareDataDir();

// Foto de produto chega em JSON (base64): só essa rota aceita corpo grande; as outras ficam no limite padrão
app.use('/api/admin/upload', express.json({ limit: '9mb' }));
// A lista inteira do cardápio vai de uma vez: cabe folgado em 2 MB, o limite padrão (100 KB) cortaria um cardápio grande
app.use('/api/admin/products', express.json({ limit: '2mb' }));
app.use(express.json());
// Corpo grande demais (foto acima do limite do envio) volta como JSON, não como página de erro
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ success: false, error: req.path === '/api/admin/upload' ? 'imagem_grande_demais' : 'corpo_grande_demais' });
  next(err);
});
// Verificação de saúde para a hospedagem: sem dados e sem login. Responde 503 se a pasta de dados deixou de aceitar
// gravação (disco desconectado): a hospedagem então reinicia o servidor em vez de deixá-lo perder pedidos.
app.get('/healthz', (req, res) => {
  res.set('Cache-Control', 'no-store').type('text/plain');
  try {
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
    res.send('ok');
  } catch (e) {
    res.status(503).send('pasta de dados indisponivel');
  }
});
// Caminho com segmento "." ou "..", barra invertida ou byte nulo nunca é pedido legítimo. O servidor de arquivos resolve
// "/assets/../orders.json" para dentro da pasta do programa, o que furaria as listas de nomes abaixo (o nome não bate na lista).
app.use((req, res, next) => {
  let d;
  try { d = decodeURIComponent(req.path); } catch { return res.status(400).end(); }
  if (!/(^|[\/\\])\.\.?([\/\\]|$)/.test(d) && !d.includes('\\') && !d.includes('\0')) return next();
  return req.path.startsWith('/api/') ? res.status(404).json({ success: false, error: 'rota_nao_encontrada' }) : res.status(404).end();
});
// Pedidos (dados de clientes) e código do servidor não saem como arquivo estático; o site em si, sim.
// products.json também não: ele guarda os produtos escondidos pelo dono, e o cliente lê o cardápio em /api/menu.
app.use((req, res, next) => (/^\/(orders\.json|accounts\.json|account\.key|secrets\.json|secrets\.key|events\.json|products\.json|server\.js|accounts\.js|vault\.js|vite\.config\.ts|package(-lock)?\.json|tsconfig\.json|\.env.*)$/i.test(req.path) ? res.status(404).end() : next()));
// Fotos enviadas pelo painel: só os arquivos feitos pelo servidor (nome aleatório, .webp), o navegador não pode tratar
// nenhum como outro tipo de arquivo, e o nome nunca se repete, então o navegador pode guardar a foto por um ano.
app.use('/uploads', (req, res, next) => {
  if (!/^\/[a-z0-9-]+\.(webp|jpg|png)$/i.test(req.path)) return res.status(404).end();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  next();
});
// As fotos saem da pasta de dados (no disco persistente, quando há DATA_DIR). Foto que não existe dá 404: nunca a página inicial.
app.use('/uploads', express.static(UPLOADS_DIR, { index: false }));
app.use('/uploads', (req, res) => res.status(404).end());
// Pasta de dados dentro da pasta do programa (ex.: DATA_DIR=./dados) nunca sai como arquivo estático: tem os pedidos dos clientes.
const dataRel = path.relative(__dirname, DATA_DIR);
if (CUSTOM_DATA_DIR && dataRel && !dataRel.startsWith('..') && !path.isAbsolute(dataRel)) {
  app.use(`/${dataRel.split(path.sep)[0]}`, (req, res) => res.status(404).end());
}
// Da pasta do programa só saem estes arquivos: as duas páginas, a logo, as imagens de pagamento e o Leaflet do painel.
// Todo o resto (código, configurações, testes, notas, arquivos novos que alguém colocar aqui) nunca é servido, mesmo que a
// lista de nomes bloqueados acima não o conheça. Pedido de arquivo fora da lista (tem extensão) é 404 seco, nunca a página inicial.
const STATIC_OK = /^\/(index\.html|admin\.html|logo\.png|assets\/.+|vendor\/.+)?$/i;
const staticFiles = express.static(__dirname);
app.use((req, res, next) => {
  if (STATIC_OK.test(req.path)) return staticFiles(req, res, next);
  if (!req.path.startsWith('/api/') && /\.[a-z0-9]{1,8}$/i.test(req.path)) return res.status(404).end();
  next();
});

let ORDERS = {};
if (fs.existsSync(ORDERS_FILE)) {
  try {
    ORDERS = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
  } catch {
    ORDERS = {};
  }
}

// Os pedidos são o dado mais importante: gravação inteira de uma vez (arquivo temporário na mesma pasta + troca de nome)
// e, se o disco recusar, um erro bem visível no registro do servidor em vez de silêncio.
function saveOrders() {
  if (!writeJson(ORDERS_FILE, ORDERS)) console.error(`ERRO: não consegui gravar ${ORDERS_FILE}: os pedidos novos não ficaram salvos no disco.`);
}

// Pagamento presencial (maquininha na loja, type "pickup") não existe: um arquivo de configurações antigo que ainda o tenha
// perde essas formas ao carregar, e o painel nunca as grava de volta
function dropCounterPayments(s) {
  const pays = s && s.payments;
  if (pays && typeof pays === 'object' && !Array.isArray(pays)) {
    for (const [k, p] of Object.entries(pays)) if (p && p.type === 'pickup') delete pays[k];
  }
  return s;
}

let SETTINGS = {};
function loadSettings() {
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      SETTINGS = dropCounterPayments(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')));
    } catch {
      SETTINGS = {};
    }
  }
}
loadSettings();

// Grava o arquivo inteiro de uma vez (arquivo temporário + troca de nome): uma queda no meio da gravação não deixa o
// cardápio ou as configurações pela metade. Devolve false se o disco recusou, para a rota avisar o painel.
function writeJson(file, data) {
  try {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

function saveSettings() {
  return writeJson(SETTINGS_FILE, SETTINGS);
}

let PRODUCTS = [];
function loadProducts() {
  if (fs.existsSync(PRODUCTS_FILE)) {
    try {
      PRODUCTS = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
    } catch {
      PRODUCTS = [];
    }
  }
}
loadProducts();

function saveProducts() {
  return writeJson(PRODUCTS_FILE, PRODUCTS);
}

// Preço que vale na venda: o promocional, quando o dono definiu um (sempre menor que o preço normal), senão o normal.
// Promoção salva errada (igual ou acima do preço) é ignorada aqui também: o cliente nunca paga mais por causa dela.
const promoOf = (p) => {
  const promo = Number(p && p.promo);
  return promo > 0 && promo < Number(p.price) ? Math.round(promo * 100) / 100 : null;
};
const sellPrice = (p) => promoOf(p) ?? Number(p.price);

// -------------------------------------------------------------
// UNIDADES DAD'S BURGER
// -------------------------------------------------------------
const DADS_STORES = {
  "passo-dareia": {
    id: "passo-dareia",
    name: "Passo d'Areia (Zona Norte)",
    address: "R. Sapé, 947 - Passo d'Areia, Porto Alegre - RS, 91350-050",
    whats: "5551993248655",
    lat: -30.01758,
    lon: -51.15570
  },
  "moinhos": {
    id: "moinhos",
    name: "Moinhos / Rio Branco",
    address: "R. Mariante, 617 - Rio Branco, Porto Alegre - RS, 90430-181",
    whats: "5551993248655",
    lat: -30.02987,
    lon: -51.20428
  },
  "partenon": {
    id: "partenon",
    name: "Partenon (Zona Leste)",
    address: "Av. Bento Gonçalves, 6746 - Partenon, Porto Alegre - RS, 91540-000",
    whats: "5551993248655",
    lat: -30.06190,
    lon: -51.17366
  },
  "canoas-gracas": {
    id: "canoas-gracas",
    name: "Nossa Sra. das Graças (Canoas)",
    address: "R. Santa Maria, 218 - Lj 2 - Nossa Sra. das Gracas, Canoas - RS, 92025-390",
    whats: "5551993248655",
    lat: -29.92756,
    lon: -51.17546
  },
  "canoas-guajuviras": {
    id: "canoas-guajuviras",
    name: "Guajuviras (Canoas)",
    address: "R. Quatro Ltm Nova Estancia, 235 - Guajuviras, Canoas - RS, 92440-274",
    whats: "5551993248655",
    lat: -29.89663,
    lon: -51.13785
  },
  "cachoeirinha": {
    id: "cachoeirinha",
    name: "Vila Vista Alegre (Cachoeirinha)",
    address: "R. São Pedro, 525 - Vila Vista Alegre, Cachoeirinha - RS, 94945-530",
    whats: "5551993248655",
    lat: -29.92380,
    lon: -51.07789
  }
};

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

// -------------------------------------------------------------
// ENDPOINTS DE API
// -------------------------------------------------------------

// Consulta de CEP via ViaCEP
app.get('/api/cep/:cep', async (req, res) => {
  const clean = (req.params.cep || '').replace(/\D/g, '');
  if (clean.length !== 8) {
    return res.status(400).json({ valid: false, error: 'CEP deve ter 8 dígitos' });
  }

  try {
    const response = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
    if (response.ok) {
      const data = await response.json();
      if (data && !data.erro) {
        return res.json({
          valid: true,
          cep: clean,
          logradouro: data.logradouro || '',
          bairro: data.bairro || '',
          localidade: data.localidade || 'Porto Alegre',
          uf: data.uf || 'RS'
        });
      }
      if (data && data.erro) {
        return res.json({ valid: false, error: 'CEP não encontrado' });
      }
    }
  } catch (e) {}

  try {
    const brRes = await fetch(`https://brasilapi.com.br/api/cep/v2/${clean}`);
    if (brRes.ok) {
      const bData = await brRes.json();
      if (bData && bData.cep) {
        return res.json({
          valid: true,
          cep: clean,
          logradouro: bData.street || '',
          bairro: bData.neighborhood || '',
          localidade: bData.city || 'Porto Alegre',
          uf: bData.state || 'RS'
        });
      }
    }
  } catch (e) {}

  return res.json({ valid: false, error: 'CEP não encontrado' });
});

// -------------------------------------------------------------
// TABELA DE FRETE E SPLIT MERCADO PAGO
// -------------------------------------------------------------
// Frete cobrado do cliente:
//   - até 3km: R$ 7,50
//   - 3km a 6km: R$ 11,50
//   - +6km (até 15km): R$ 15,50
// Repasse frete para restaurante:
//   - até 3km: R$ 6,50
//   - 3km a 6km: R$ 9,00
//   - +6km: R$ 14,50
// Sobra frete para plataforma:
//   - até 3km: R$ 1,00
//   - 3km a 6km: R$ 2,50
//   - +6km: R$ 1,00
// Adicional fixo plataforma por pedido: R$ 1,50
// Total split plataforma = Sobra do frete + R$ 1,50
// -------------------------------------------------------------
function calculateDeliveryAndSplit(distanceKm = 0, subtotal = 0) {
  const sub = Number(subtotal) || 0;
  const fixedPlatformFee = 1.50; // Adicional fixo da plataforma por pedido

  const dist = Number(distanceKm) || 0;
  let deliveryFee = 15.50;
  let restaurantDeliveryFee = 14.50;
  let deliveryLeftover = 1.00;
  let tierLabel = 'Acima de 6 km';

  const freeThreshold = Number(SETTINGS.delivery?.freeDeliveryThreshold) || 0;
  if (freeThreshold > 0 && sub >= freeThreshold) {
    deliveryFee = 0;
    restaurantDeliveryFee = 0;
    deliveryLeftover = 0;
    tierLabel = 'Entrega Grátis';
  } else if (Array.isArray(SETTINGS.delivery?.tiers) && SETTINGS.delivery.tiers.length > 0) {
    const sortedTiers = [...SETTINGS.delivery.tiers].sort((a, b) => a.maxKm - b.maxKm);
    let matched = null;
    for (const t of sortedTiers) {
      if (dist <= t.maxKm) {
        matched = t;
        break;
      }
    }
    if (!matched) matched = sortedTiers[sortedTiers.length - 1];
    deliveryFee = Number(matched.fee) || 7.50;
    restaurantDeliveryFee = Math.max(0, deliveryFee - 1.00);
    deliveryLeftover = Math.round((deliveryFee - restaurantDeliveryFee) * 100) / 100;
    tierLabel = matched.label || `Até ${matched.maxKm} km`;
  } else if (dist <= 3.0) {
    deliveryFee = 7.50;
    restaurantDeliveryFee = 6.50;
    deliveryLeftover = 1.00; // 7,50 - 6,50
    tierLabel = 'Até 3 km';
  } else if (dist <= 6.0) {
    deliveryFee = 11.50;
    restaurantDeliveryFee = 9.00;
    deliveryLeftover = 2.50; // 11,50 - 9,00
    tierLabel = '3 km a 6 km';
  } else {
    deliveryFee = 15.50;
    restaurantDeliveryFee = 14.50;
    deliveryLeftover = 1.00; // 15,50 - 14,50
    tierLabel = 'Acima de 6 km';
  }

  const platformFee = deliveryLeftover + fixedPlatformFee;
  const customerTotal = sub + deliveryFee;
  const restaurantAmount = Math.max(0, customerTotal - platformFee);

  return {
    mode: 'entrega',
    distanceKm: dist,
    tierLabel,
    deliveryFee: Math.round(deliveryFee * 100) / 100,
    restaurantDeliveryFee: Math.round(restaurantDeliveryFee * 100) / 100,
    deliveryLeftover: Math.round(deliveryLeftover * 100) / 100,
    fixedPlatformFee: Math.round(fixedPlatformFee * 100) / 100,
    platformFee: Math.round(platformFee * 100) / 100,
    restaurantAmount: Math.round(restaurantAmount * 100) / 100,
    customerTotal: Math.round(customerTotal * 100) / 100,
    subtotal: sub
  };
}

const POA_NEIGHBORHOODS = {
  "passo d'areia": { lat: -30.01758, lon: -51.15570 },
  "passo dareia": { lat: -30.01758, lon: -51.15570 },
  "cristo redentor": { lat: -30.01250, lon: -51.15100 },
  "jardim sao pedro": { lat: -30.00800, lon: -51.16200 },
  "sao joao": { lat: -30.01150, lon: -51.18500 },
  "higienopolis": { lat: -30.01850, lon: -51.17800 },
  "lindoia": { lat: -30.00500, lon: -51.15000 },
  "jardim lindoia": { lat: -30.00500, lon: -51.15000 },
  "boa vista": { lat: -30.02400, lon: -51.17000 },
  "auxiliadora": { lat: -30.02200, lon: -51.19200 },
  "moinhos de vento": { lat: -30.02600, lon: -51.20300 },
  "moinhos": { lat: -30.02600, lon: -51.20300 },
  "rio branco": { lat: -30.03500, lon: -51.20000 },
  "mont'serrat": { lat: -30.02500, lon: -51.19000 },
  "mont serrat": { lat: -30.02500, lon: -51.19000 },
  "bela vista": { lat: -30.03800, lon: -51.18800 },
  "petropolis": { lat: -30.04500, lon: -51.17900 },
  "santa cecilia": { lat: -30.04200, lon: -51.20100 },
  "santana": { lat: -30.04800, lon: -51.20500 },
  "floresta": { lat: -30.02400, lon: -51.21100 },
  "centro historico": { lat: -30.03200, lon: -51.22900 },
  "centro": { lat: -30.03200, lon: -51.22900 },
  "cidade baixa": { lat: -30.04200, lon: -51.22100 },
  "bom fim": { lat: -30.03400, lon: -51.21200 },
  "independencia": { lat: -30.02900, lon: -51.21000 },
  "menino deus": { lat: -30.05500, lon: -51.22000 },
  "partenon": { lat: -30.06190, lon: -51.17366 },
  "jardim botanico": { lat: -30.05200, lon: -51.18400 },
  "chacara das pedras": { lat: -30.03300, lon: -51.15800 },
  "tres figueiras": { lat: -30.03600, lon: -51.16400 },
  "vila ipiranga": { lat: -30.00900, lon: -51.14100 },
  "rubem berta": { lat: -29.99500, lon: -51.11800 },
  "sarandi": { lat: -29.98800, lon: -51.13400 },
  "cristal": { lat: -30.08200, lon: -51.24500 },
  "cavalhada": { lat: -30.09800, lon: -51.22800 },
  "ipanema": { lat: -30.13000, lon: -51.22500 }
};

// Coordenadas do CEP (da rua, não só da cidade): AwesomeAPI. O BrasilAPI devolve o centro da cidade para todo CEP,
// então não serve para medir distância. Guarda o resultado: 7 dias quando achou, 10 minutos quando não achou.
const CEP_CACHE = new Map();
async function cepCoords(cep8) {
  const hit = CEP_CACHE.get(cep8);
  if (hit && Date.now() - hit.at < (hit.coords ? 7 * 86400000 : 600000)) return hit.coords;
  let coords = null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4000);
  try {
    const r = await fetch(`https://cep.awesomeapi.com.br/json/${cep8}`, { signal: ctl.signal });
    if (r.ok) {
      const d = await r.json();
      const lat = parseFloat(d.lat);
      const lon = parseFloat(d.lng);
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) > 1 && Math.abs(lon) > 1) coords = { lat, lon };
    }
  } catch {} finally {
    clearTimeout(timer);
  }
  CEP_CACHE.set(cep8, { at: Date.now(), coords });
  return coords;
}

// Distância e permissão de entrega de um endereço (a mesma regra vale na validação e na cobrança).
// Mede em linha reta, da unidade até o CEP (coordenadas da rua); sem elas, pelo nome do bairro; sem nenhum dos dois o
// endereço não é confirmado e a entrega é negada. O limite é o raio que o dono definiu no painel.
async function deliveryCheck(addressDetails, unitId) {
  const s = addressDetails || {};
  const store = DADS_STORES[unitId] || DADS_STORES["passo-dareia"];
  const maxRadius = Number(SETTINGS.delivery?.maxRadiusKm) || 15.0;

  let matchedCoord = null;
  let source = '';
  const cep = String(s.cep || '').replace(/\D/g, '');
  if (cep.length === 8) {
    const c = await cepCoords(cep);
    if (c) { matchedCoord = c; source = 'cep'; }
  }
  if (!matchedCoord) {
    const bClean = (s.bairro || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const rawClean = (s.bairro || '').toLowerCase().trim();
    let m = POA_NEIGHBORHOODS[rawClean] || POA_NEIGHBORHOODS[bClean];
    if (!m && rawClean) {
      const foundKey = Object.keys(POA_NEIGHBORHOODS).find(k => rawClean.includes(k) || k.includes(rawClean));
      if (foundKey) m = POA_NEIGHBORHOODS[foundKey];
    }
    const metro = !s.cidade || /porto alegre|canoas|cachoeirinha|alvorada|gravata[ií]|viam[aã]o/i.test(s.cidade);
    if (m && metro) { matchedCoord = m; source = 'bairro'; }
  }
  if (!matchedCoord) return { store, matchedCoord: null, distanceKm: null, maxRadius, allowed: false, verified: false, source };

  let distanceKm = haversineKm(matchedCoord.lat, matchedCoord.lon, store.lat, store.lon);
  if (distanceKm < 0.8) distanceKm = 0.8;
  return { store, matchedCoord, distanceKm, maxRadius, allowed: distanceKm <= maxRadius, verified: true, source };
}

// Validação de Raio de Entrega (o limite vem do painel) e Cálculo da Taxa e Split
app.post('/api/delivery/validate', async (req, res) => {
  const { addressDetails, unitId, subtotal } = req.body || {};
  loadSettings();
  const chk = await deliveryCheck(addressDetails, unitId);
  if (!chk.verified) {
    return res.json({ valid: false, allowed: false, error: 'Não conseguimos localizar este endereço pelo CEP. Confira o CEP.' });
  }
  const { store, matchedCoord, distanceKm, maxRadius, allowed } = chk;
  const split = calculateDeliveryAndSplit(distanceKm, subtotal || 0);

  // Calcula unidade mais próxima se a atual estiver distante
  let closestUnit = {
    id: store.id,
    name: store.name,
    distanceKm,
    allowed
  };

  if (matchedCoord) {
    let minD = 999;
    let bestStore = store;
    for (const st of Object.values(DADS_STORES)) {
      const d = haversineKm(matchedCoord.lat, matchedCoord.lon, st.lat, st.lon);
      if (d < minD) {
        minD = d;
        bestStore = st;
      }
    }
    closestUnit = {
      id: bestStore.id,
      name: bestStore.name,
      distanceKm: minD < 0.8 ? 0.8 : minD,
      allowed: minD <= maxRadius
    };
  }

  res.json({
    valid: true,
    allowed,
    distanceKm,
    deliveryFee: split.deliveryFee,
    restaurantDeliveryFee: split.restaurantDeliveryFee,
    deliveryLeftover: split.deliveryLeftover,
    fixedPlatformFee: split.fixedPlatformFee,
    platformFee: split.platformFee,
    tierLabel: split.tierLabel,
    split,
    unitId: store.id,
    unitName: store.name,
    closestUnit
  });
});

// -------------------------------------------------------------
// LOGIN DO PAINEL: a senha é conferida aqui, no servidor, não na página.
// Quem não entrou não consegue mudar cardápio, horários, entrega nem pagamentos, não vê pedidos e não envia fotos.
// A senha vem de ADMIN_PASSWORD no .env; sem ela vale a senha antiga (dads123) e o servidor avisa ao ligar.
// -------------------------------------------------------------
const adminPassword = () => (process.env.ADMIN_PASSWORD || '').trim() || 'dads123';
const SESSION_SECRET = (process.env.SESSION_SECRET || '').trim() || crypto.randomBytes(32).toString('hex'); // sem SESSION_SECRET, quem entrou precisa entrar de novo depois que o servidor reinicia

// Cofre de chaves (Mercado Pago, 99 Empresas), acontecimentos ao vivo e Google Authenticator do Financeiro: vault.js, na pasta de dados.
const vault = createVault({ DATA_DIR, writeJson });
const ev = (kind, level, title, detail, extra) => { try { return vault.event(kind, level, title, detail, extra); } catch { return null; } };
const moneyBR = (n) => `R$ ${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace('.', ',')}`;
const shortCustomer = (o) => {
  const w = String((o && o.customer && o.customer.name) || 'Cliente').trim().split(/\s+/);
  return w.length > 1 ? `${w[0]} ${w[w.length - 1][0]}.` : w[0];
};
const payLabel = (o) => {
  if (!o) return '';
  if (o.paymentKind === 'pix') return 'Pix';
  if (o.paymentKind === 'wallet') return 'Saldo Mercado Pago';
  return /^deb/i.test(String(o.cardBrand || '')) || /d[eé]bito/i.test(String(o.paymentMethod || '')) ? 'Cartão de débito' : 'Cartão de crédito';
};
const SESSION_HOURS = 12;
const COOKIE_NAME = 'dads_admin';
const signSession = (exp) => `${exp}.${crypto.createHmac('sha256', SESSION_SECRET).update(String(exp)).digest('base64url')}`;
function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return ''; }
    }
  }
  return '';
}
const revokedSessions = new Set(); // sessões encerradas em "Sair do Caixa" deixam de valer na hora
function isAdmin(req) {
  const tok = readCookie(req, COOKIE_NAME);
  const exp = Number(tok.split('.')[0]);
  if (!(exp > Date.now()) || revokedSessions.has(tok)) return false;
  try { return crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(signSession(exp))); } catch { return false; }
}
const requireAdmin = (req, res, next) => (isAdmin(req) ? next() : res.status(401).json({ success: false, error: 'login_necessario' }));
const isHttps = (req) => req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
const setSessionCookie = (req, res, value, seconds) => res.setHeader('Set-Cookie',
  `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${isHttps(req) ? '; Secure' : ''}`);

// Senha errada fica cada vez mais lenta (quanto mais erros seguidos, mais demora a resposta), então adivinhar a senha
// não compensa. A senha certa nunca espera nem é bloqueada: ninguém consegue trancar o dono para fora.
// checkAdminPassword vale no login e nas ações que pedem a senha de novo (trocar chave, ligar o Authenticator): 'ok' | 'bad' | 'busy'.
let loginFails = { n: 0, since: Date.now(), pending: 0 };
async function checkAdminPassword(pw) {
  const now = Date.now();
  const given = crypto.createHash('sha256').update(String(pw || '')).digest();
  const real = crypto.createHash('sha256').update(adminPassword()).digest();
  if (crypto.timingSafeEqual(given, real)) {
    loginFails = { n: 0, since: now, pending: loginFails.pending };
    return 'ok';
  }
  if (now - loginFails.since > 600000) loginFails = { n: 0, since: now, pending: loginFails.pending };
  if (loginFails.pending >= 50) return 'busy';
  loginFails.n += 1;
  loginFails.pending += 1;
  await new Promise((r) => setTimeout(r, Math.min(3000, (Number(process.env.LOGIN_DELAY_MS) || 300) * loginFails.n)));
  loginFails.pending -= 1;
  return 'bad';
}
let lastFailEv = 0;
app.post('/api/admin/login', async (req, res) => {
  const r = await checkAdminPassword((req.body || {}).password);
  if (r === 'ok') {
    setSessionCookie(req, res, signSession(Date.now() + SESSION_HOURS * 3600000), SESSION_HOURS * 3600);
    ev('admin.login', 'ok', 'Entrada no painel', 'Senha conferida.');
    return res.json({ success: true });
  }
  if (r === 'busy') return res.status(429).json({ success: false, error: 'muitas_tentativas' });
  if (Date.now() - lastFailEv > 60000) { lastFailEv = Date.now(); ev('admin.login_failed', 'warn', 'Senha errada ao entrar no painel', 'Se não foi você, troque a senha do painel (ADMIN_PASSWORD).'); }
  res.status(401).json({ success: false, error: 'senha_incorreta' });
});
app.post('/api/admin/logout', (req, res) => {
  const tok = readCookie(req, COOKIE_NAME);
  if (tok) {
    for (const t of revokedSessions) if (!(Number(t.split('.')[0]) > Date.now())) revokedSessions.delete(t);
    revokedSessions.add(tok);
  }
  setSessionCookie(req, res, '', 0);
  res.json({ success: true });
});
app.get('/api/admin/session', (req, res) => {
  const ok = isAdmin(req);
  res.json({ authenticated: ok, defaultPassword: ok && !(process.env.ADMIN_PASSWORD || '').trim() });
});

// -------------------------------------------------------------
// HORÁRIO DA LOJA: vale no servidor, no fuso de Brasília (a hora do servidor ou do celular do cliente não importa)
// -------------------------------------------------------------
const SHOP_TZ = 'America/Sao_Paulo';
const DAY_KEYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
function shopClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: SHOP_TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return { dow: { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[get('weekday')], minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}
const toMinutes = (hhmm, dflt) => { const [h, m] = String(hhmm || dflt).split(':').map(Number); return (h || 0) * 60 + (m || 0); };

// Aberta = chave "Loja aberta" ligada E dentro do horário do dia (se "seguir os horários" estiver ligado).
// Horário que passa da meia-noite (ex.: 18:00 às 00:30) vale também na madrugada do dia seguinte.
function storeStatus(date = new Date()) {
  const st = SETTINGS.store || {};
  const notice = st.closedNotice || 'Estamos fechados no momento.';
  if (st.isOpenManual === false) return { open: false, reason: 'pausada', notice };
  if (st.autoSchedule === false || !st.schedule) return { open: true };
  const { dow, minutes } = shopClock(date);
  const today = st.schedule[DAY_KEYS[dow]];
  const yesterday = st.schedule[DAY_KEYS[(dow + 6) % 7]];
  if (today && today.active !== false) {
    const o = toMinutes(today.open, '18:00');
    const c = toMinutes(today.close, '23:45');
    if (c >= o ? (minutes >= o && minutes <= c) : minutes >= o) return { open: true };
  }
  if (yesterday && yesterday.active !== false) {
    const o = toMinutes(yesterday.open, '18:00');
    const c = toMinutes(yesterday.close, '23:45');
    if (c < o && minutes < c) return { open: true };
  }
  return { open: false, reason: 'fora_do_horario', notice };
}
// Unidades e coordenadas: o painel desenha o círculo do raio no mesmo ponto de onde o servidor mede a distância
app.get('/api/stores', (req, res) => {
  res.json(Object.values(DADS_STORES).map(({ id, name, lat, lon }) => ({ id, name, lat, lon })));
});
app.get('/api/store/status', (req, res) => {
  loadSettings();
  res.json({ ...storeStatus(), now: new Date().toISOString(), timezone: SHOP_TZ });
});

// Regras do dono que valem no servidor para todo pedido: loja aberta e forma de pagamento ligada no painel.
function shopGate(res, methodKey) {
  loadSettings();
  const s = storeStatus();
  if (!s.open) { res.status(403).json({ success: false, error: 'loja_fechada', notice: s.notice }); return false; }
  const p = methodKey && SETTINGS.payments && SETTINGS.payments[methodKey];
  if (p && p.enabled === false) { res.status(403).json({ success: false, error: 'forma_desativada' }); return false; }
  return true;
}

// -------------------------------------------------------------
// GESTOR DE RESTAURANTE ESTILO IFOOD (SETTINGS, CARDÁPIO, HORÁRIOS, RAIO, PAGAMENTOS)
// O site lê (GET) sem login; só quem entrou no painel grava (POST).
// -------------------------------------------------------------
function checkSettingsPatch(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return 'corpo_invalido';
  for (const k of ['store', 'delivery', 'payments']) {
    if (k in b && (!b[k] || typeof b[k] !== 'object' || Array.isArray(b[k]))) return `${k}_invalido`;
  }
  const d = b.delivery;
  if (d) {
    if (!(Number(d.maxRadiusKm) >= 0.5 && Number(d.maxRadiusKm) <= 100)) return 'raio_invalido';
    if (d.freeDeliveryThreshold !== undefined && !(Number(d.freeDeliveryThreshold) >= 0)) return 'frete_gratis_invalido';
    if (d.tiers !== undefined) {
      if (!Array.isArray(d.tiers) || d.tiers.length > 10) return 'faixas_invalidas';
      for (const t of d.tiers) if (!t || !(Number(t.maxKm) > 0) || !(Number(t.fee) >= 0 && Number(t.fee) < 1000)) return 'faixas_invalidas';
    }
  }
  const rp = b.raspadinha;
  if (rp !== undefined) {
    const list = rp && rp.prizes;
    if (!Array.isArray(list) || list.length < 1 || list.length > 12) return 'premios_invalidos';
    let total = 0;
    const inRange = (v, max) => v === undefined || v === null || v === '' || (Number(v) >= 0 && Number(v) <= max);
    for (const p of list) {
      if (!p || String(p.name || '').length > 60 || !(Number(p.weight) >= 0 && Number(p.weight) <= 1000)) return 'premios_invalidos';
      if (p.type !== undefined && !['item', 'desconto_pct', 'desconto_reais', 'frete_gratis', 'nada'].includes(p.type)) return 'premios_invalidos';
      if (!inRange(p.value, 10000) || !inRange(p.minOrder, 1000) || !inRange(p.validDays, 365) || !inRange(p.dailyLimit, 100000) || !inRange(p.totalLimit, 100000)) return 'premios_invalidos';
      if (p.type === 'desconto_pct' && !(Number(p.value) > 0 && Number(p.value) <= 90)) return 'premios_invalidos';
      if (p.type === 'desconto_reais' && !(Number(p.value) > 0)) return 'premios_invalidos';
      if (p.type === 'item' && !String(p.name || '').trim()) return 'premios_invalidos';
      total += Number(p.weight);
    }
    if (!(total > 0)) return 'premios_invalidos';
    const sp = rp.special;
    if (sp !== undefined && (!sp || typeof sp !== 'object' || String(sp.name || '').length > 60 || !(Number(sp.threshold) >= 1 && Number(sp.threshold) <= 50) || !inRange(sp.validDays, 365))) return 'premios_invalidos';
  }
  const s = b.store;
  if (s) {
    const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
    for (const [k, day] of Object.entries(s.schedule || {})) {
      if (!DAY_KEYS.includes(k) || !day || (day.open && !hhmm.test(day.open)) || (day.close && !hhmm.test(day.close))) return 'horario_invalido';
    }
    for (const k of ['preparationTimeMin', 'preparationTimeMax']) {
      if (s[k] !== undefined && !(Number(s[k]) >= 1 && Number(s[k]) <= 300)) return `${k}_invalido`;
    }
    // Logo da loja: vazia (vale a logo original do site) ou uma foto enviada pelo painel
    if (s.logo !== undefined && s.logo !== null && s.logo !== '' && !/^\/uploads\/[a-z0-9-]+\.(webp|jpg|png)$/i.test(String(s.logo))) return 'logo_invalida';
  }
  return '';
}

// Foto de produto: vazia (vale a logo da loja), enviada pelo painel (/uploads/…), link que o produto já tinha ou id curto do Unsplash
const PHOTO_OK = /^(\/uploads\/[a-z0-9-]+\.(webp|jpg|png)|https?:\/\/[^\s"'<>]{4,580}|[\w.-]{1,80})$/i;

// A ordem da lista é a ordem em que o cliente vê os produtos. Devolve { list } ou { error, detail } (o painel mostra o motivo).
function cleanProducts(list) {
  if (!Array.isArray(list) || list.length > 1000) return { error: 'produtos_invalidos' };
  const ids = new Set();
  const names = new Set();
  const out = [];
  for (const p of list) {
    if (!p || typeof p !== 'object') return { error: 'produtos_invalidos' };
    const id = String(p.id || '');
    const name = String(p.name || '').trim();
    const price = Math.round(Number(p.price) * 100) / 100;
    if (!/^[\w-]{1,60}$/.test(id) || ids.has(id) || !name || name.length > 200 || !(price > 0 && price < 10000)) return { error: 'produtos_invalidos', detail: name };
    // O pedido acha o produto pelo nome: dois com o mesmo nome se confundiriam
    if (names.has(name.toLowerCase())) return { error: 'nome_repetido', detail: name };
    ids.add(id);
    names.add(name.toLowerCase());
    let promo = null; // vazio = sem promoção
    if (p.promo !== undefined && p.promo !== null && p.promo !== '') {
      promo = Math.round(Number(p.promo) * 100) / 100;
      if (!(promo > 0 && promo < price)) return { error: 'promo_invalida', detail: name };
    }
    const img = String(p.img || '').trim();
    if (img && (img.length > 600 || !PHOTO_OK.test(img))) return { error: 'foto_invalida', detail: name };
    const cat = String(p.cat || p.category || '').trim().slice(0, 80) || 'Outros';
    const desc = String(p.desc || p.description || '').slice(0, 1000);
    out.push({ id, name, price, ...(promo ? { promo } : {}), img, cat, category: cat, desc, description: desc, paused: Boolean(p.paused), hidden: Boolean(p.hidden) });
  }
  return { list: out };
}

app.get('/api/admin/settings', (req, res) => {
  loadSettings();
  const pays = SETTINGS.payments;
  if (pays && pays.mercadopago_saldo) pays.mercadopago_saldo = { ...pays.mercadopago_saldo, connected: walletReady() };
  res.json(SETTINGS);
});

app.post('/api/admin/settings', requireAdmin, (req, res) => {
  const bad = checkSettingsPatch(req.body);
  if (bad) return res.status(400).json({ success: false, error: bad });
  loadSettings();
  SETTINGS = dropCounterPayments({
    ...SETTINGS,
    ...(req.body || {})
  });
  if (!saveSettings()) return res.status(500).json({ success: false, error: 'nao_foi_possivel_salvar' });
  res.json({ success: true, settings: SETTINGS });
});

// Cardápio que o cliente vê: sem os produtos que o dono escondeu, na ordem escolhida no painel
app.get('/api/menu', (req, res) => {
  loadProducts();
  res.set('Cache-Control', 'no-store');
  res.json(PRODUCTS.filter((p) => !p.hidden));
});

// Cardápio completo (com os escondidos): só para quem entrou no painel
app.get('/api/admin/products', requireAdmin, (req, res) => {
  loadProducts();
  res.json(PRODUCTS);
});

app.post('/api/admin/products', requireAdmin, (req, res) => {
  const r = cleanProducts(req.body);
  if (!r.list) return res.status(400).json({ success: false, error: r.error, detail: r.detail });
  const before = PRODUCTS;
  PRODUCTS = r.list;
  if (!saveProducts()) {
    PRODUCTS = before;
    return res.status(500).json({ success: false, error: 'nao_foi_possivel_salvar' });
  }
  res.json({ success: true, count: PRODUCTS.length });
});

// Foto enviada pelo painel (produto ou logo da loja). Só entra jpg, png ou webp, conferido pelo conteúdo e não pelo nome
// nem pelo tipo que o navegador diz. O servidor nunca guarda o arquivo recebido: decodifica, gira conforme a câmera,
// reduz (produto até 1400 px, logo até 640 px) e grava uma imagem WEBP nova com nome aleatório. Isso tira tudo o que
// não é imagem (código escondido no arquivo) e os metadados (EXIF: local, aparelho, data).
const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
const UPLOAD_MAX_PIXELS = 40_000_000; // acima disso é recusada: um arquivo pequeno pode abrir como uma imagem de gigabytes
const UPLOAD_SIDE = { product: 1400, logo: 640 };
const IMAGE_KINDS = [
  (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, // jpg
  (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), // png
  (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' // webp
];
app.post('/api/admin/upload', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const m = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(body.dataUrl || ''));
  if (!m) return res.status(400).json({ success: false, error: 'imagem_invalida' });
  const buf = Buffer.from(m[1], 'base64');
  if (!buf.length) return res.status(400).json({ success: false, error: 'imagem_invalida' });
  if (buf.length > UPLOAD_MAX_BYTES) return res.status(413).json({ success: false, error: 'imagem_grande_demais' });
  if (!IMAGE_KINDS.some((is) => is(buf))) return res.status(400).json({ success: false, error: 'formato_nao_aceito' });
  if (!sharp) return res.status(503).json({ success: false, error: 'imagens_indisponiveis' });
  const side = UPLOAD_SIDE[body.kind === 'logo' ? 'logo' : 'product'];
  let out;
  try {
    out = await sharp(buf, { limitInputPixels: UPLOAD_MAX_PIXELS, failOn: 'error' })
      .rotate()
      .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    return res.status(400).json({ success: false, error: 'imagem_invalida' });
  }
  try {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}.webp`;
    fs.writeFileSync(path.join(UPLOADS_DIR, name), out.data, { flag: 'wx' });
    res.status(201).json({ success: true, url: `/uploads/${name}`, width: out.info.width, height: out.info.height, bytes: out.data.length });
  } catch {
    res.status(500).json({ success: false, error: 'nao_foi_possivel_salvar' });
  }
});

// -------------------------------------------------------------
// MERCADO PAGO: cobrança real (Checkout Transparente, API de pagamentos)
// -------------------------------------------------------------
// O servidor cria a cobrança e decide se ela foi paga. O navegador nunca aprova nada: o pedido só vale depois
// que o Mercado Pago confirmar (consulta direta à API, pelo status ou pelo webhook). Sem credencial
// configurada não existe cobrança: o site avisa que o pagamento online está indisponível.
const envFirst = (...names) => {
  for (const n of names) {
    const v = (process.env[n] || '').trim();
    if (v) return v;
  }
  return '';
};
// Chaves e endereço do site: valem os que o dono conectou no painel (cofre criptografado) e, na falta deles, as variáveis de ambiente
const mpToken = () => vault.secret('mp.accessToken') || envFirst('MERCADOPAGO_ACCESS_TOKEN', 'MERCADO_PAGO_ACCESS_TOKEN');
const mpPublicKey = () => vault.secret('mp.publicKey') || envFirst('MERCADOPAGO_PUBLIC_KEY', 'MERCADO_PAGO_PUBLIC_KEY');
const mpWebhookSecret = () => vault.secret('mp.webhookSecret') || envFirst('MERCADOPAGO_WEBHOOK_SECRET', 'MERCADO_PAGO_WEBHOOK_SECRET');
const appBase = () => (vault.config('appUrl') || envFirst('APP_URL')).replace(/\/+$/, '');
// MP_API_BASE e GEO_API_BASE: só para testes locais. Apontam o SDK oficial e a consulta de CEP para APIs de mentira; em produção não existem.
if (process.env.MP_API_BASE || process.env.GEO_API_BASE) {
  const redirects = [['https://api.mercadopago.com', process.env.MP_API_BASE], ['https://cep.awesomeapi.com.br', process.env.GEO_API_BASE]].filter(([, to]) => to);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    const hit = typeof url === 'string' && redirects.find(([from]) => url.startsWith(from));
    return realFetch(hit ? hit[1].replace(/\/+$/, '') + url.slice(hit[0].length) : url, init);
  };
}
// O Mercado Pago só aceita notification_url em https
const mpNotificationUrl = () => {
  const base = appBase();
  return /^https:\/\//i.test(base) ? `${base}/api/mercadopago/webhook` : '';
};

// SDK oficial do Mercado Pago no back-end. Um cliente novo a cada chamada: o SDK guarda as opções da chamada
// (chave de idempotência, id do dispositivo) dentro do próprio cliente, e um cliente compartilhado repetiria a chave
// de um pagamento no pagamento do cliente seguinte. Em erro de rede ou 5xx o SDK tenta mais uma vez com a MESMA chave
// de idempotência, então o Mercado Pago devolve o mesmo pagamento em vez de cobrar duas vezes.
const mpCfg = () => new MercadoPagoConfig({
  accessToken: mpToken(),
  options: { timeout: Number(process.env.MP_TIMEOUT_MS) || 12000, maxRetries: 1, initialDelay: 500 }
});
const mpPayments = () => new Payment(mpCfg());

// Pagar com saldo ou crédito do Mercado Pago: o cliente entra na conta dele no Mercado Pago e volta para o site. Precisa de
// endereço https público (volta e aviso de pagamento), então só fica disponível quando o servidor tem chave e APP_URL https.
const walletReady = () => Boolean(mpToken() && mpNotificationUrl());

// O SDK lança erro quando o Mercado Pago recusa a chamada; aqui vira { ok, status, data }, o formato que o resto do servidor usa
async function mpCall(fn) {
  try {
    return { ok: true, status: 200, data: await fn() };
  } catch (err) {
    const status = Number(err && err.status) || 0;
    return { ok: false, status, data: { message: err && err.message, error: err && err.error, causes: err && err.causes }, error: String((err && err.message) || err) };
  }
}

// Cria o pagamento. A chave de idempotência é nova a cada tentativa do cliente (o número do pedido pode se repetir depois
// de uma falha). Se a resposta se perder (tempo esgotado ou erro do servidor deles) o pagamento pode existir mesmo assim:
// procura pelo número do pedido antes de dar a compra como falha, para não cobrar de novo nem deixar pagamento sem pedido.
async function mpCreatePayment(body, oid, deviceId) {
  const requestOptions = { idempotencyKey: `${oid}-${crypto.randomUUID()}` };
  // O Device ID de verdade tem uns 230 caracteres (armor.xxxx.yyyy): vai inteiro, só letras, números, ponto, hífen e sublinhado.
  const dev = /^[A-Za-z0-9._-]{1,512}$/.test(String(deviceId || '')) ? String(deviceId) : '';
  if (dev) requestOptions.meliSessionId = dev;
  let r = await mpCall(() => mpPayments().create({ body, requestOptions }));
  if (!r.ok && (r.status === 0 || r.status >= 500)) {
    const f = await mpCall(() => mpPayments().search({ options: { external_reference: oid, sort: 'date_created', criteria: 'desc', limit: 1 } }));
    const found = f.ok && f.data && Array.isArray(f.data.results) ? f.data.results[0] : null;
    if (found && found.id) r = { ok: true, status: 200, data: found };
  }
  return r;
}

const onlyDigits = (v) => String(v || '').replace(/\D/g, '');

function validCpf(v) {
  const c = onlyDigits(v);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(c[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

function newOrderId() {
  for (let i = 0; i < 60; i++) {
    const id = `DAD-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!ORDERS[id]) return id;
  }
  return `DAD-${Date.now().toString().slice(-6)}`;
}

// Validade do Pix: o Mercado Pago exige de 30 minutos a 30 dias, em horário de Brasília (UTC-3, sem horário de verão)
function mpExpiry(minutes) {
  return new Date(Date.now() + minutes * 60000 - 3 * 3600000).toISOString().replace('Z', '-03:00');
}

const nameParts = (customer) => String((customer && customer.name) || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
const validEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || '').trim()) && String(v).trim().length <= 120;

// Quem paga online precisa de e-mail de verdade (recibo do Mercado Pago e antifraude) e de nome com sobrenome.
// Devolve o código do erro, ou '' se estiver certo.
function checkBuyer(customer) {
  if (!validEmail(customer.email)) return 'email_invalido';
  if (nameParts(customer).length < 2) return 'nome_completo';
  return '';
}

function mpPayer(customer, cpf, addr) {
  const parts = nameParts(customer);
  return {
    email: String(customer.email).trim(),
    first_name: parts[0].slice(0, 50),
    last_name: parts.slice(1).join(' ').slice(0, 50) || undefined,
    identification: { type: 'CPF', number: cpf },
    ...(addr ? { address: addr } : {})
  };
}

// Endereço de entrega (só no modo entrega): vai em payer.address e em additional_info.shipments
function mpAddress(order, priced) {
  const a = priced.mode === 'entrega' ? (order.addressDetails || {}) : {};
  const zip = onlyDigits(a.cep);
  if (zip.length !== 8) return null;
  return {
    zip_code: zip,
    street_name: String(a.rua || '').slice(0, 100),
    street_number: String(a.numero || '').slice(0, 20),
    neighborhood: String(a.bairro || '').slice(0, 60),
    city: String(a.cidade || '').slice(0, 60),
    federal_unit: 'RS' // as seis lojas e a área de entrega ficam no Rio Grande do Sul
  };
}

// Dados extras que o antifraude do Mercado Pago usa e que a medição de qualidade da integração confere:
// itens do pedido, telefone e endereço de entrega
function mpAdditionalInfo(priced, customer, addr) {
  const parts = nameParts(customer);
  const ph = onlyDigits(customer.phone);
  return {
    items: priced.items.map((it) => ({ id: String(it.id), title: String(it.name).slice(0, 256), description: String(it.name).slice(0, 256), category_id: 'food', quantity: it.q, unit_price: it.price })),
    payer: {
      first_name: parts[0].slice(0, 50),
      ...(parts.length > 1 ? { last_name: parts.slice(1).join(' ').slice(0, 50) } : {}),
      ...(ph.length >= 10 ? { phone: { area_code: ph.slice(0, 2), number: ph.slice(2) } } : {}),
      ...(addr ? { address: { zip_code: addr.zip_code, street_name: addr.street_name, street_number: addr.street_number } } : {})
    },
    ...(addr ? { shipments: { receiver_address: { zip_code: addr.zip_code, state_name: addr.federal_unit, city_name: addr.city, street_name: addr.street_name, street_number: addr.street_number } } } : {})
  };
}

// O cliente nunca paga mais do que viu na tela: se o total do servidor é maior que o mostrado (o dono mudou preço ou
// taxa no meio do pedido), a cobrança não sai e a página pede para conferir o novo valor. Se o servidor cobra menos
// (por exemplo, frete grátis), vale o valor menor.
function totalMismatch(order, priced) {
  const expected = Number(order.expectedTotal);
  if (order.expectedTotal === undefined || !Number.isFinite(expected)) return null;
  return priced.total - expected > 0.005 ? { success: false, error: 'valor_mudou', total: priced.total } : null;
}

// Entrega 99: o motoboy só é chamado quando o restaurante ACEITA o pedido (novo -> preparando), nunca logo depois do
// pagamento. Esta função é chamada pelo PATCH /api/orders/:id nessa troca e só vale para pedido de entrega, uma vez por pedido.
// Falta ligar a API da 99 aqui (endereço, telefone e valor do pedido); enquanto isso o pedido fica marcado como aguardando.
function requestCourier(order) {
  if (!order || order.order?.mode !== 'entrega' || order.courier) return;
  order.courier = { provider: '99', status: 'aguardando_integracao', acceptedAt: Date.now() / 1000 };
  ev('courier.requested', 'warn', `Entrega do pedido ${order.orderId}`, vault.has('nn.apiKey') && vault.has('nn.clientId')
    ? '99 Empresas: credenciais guardadas, mas a chamada automática do entregador ainda não está ativa. Chame o entregador por lá.'
    : '99 Empresas ainda não conectada (aba Conexões). Chame o entregador por lá.', { orderId: order.orderId });
  console.log(`Entrega 99: pedido ${order.orderId} aceito pelo restaurante; o motoboy será chamado quando a integração da 99 estiver ligada.`);
}

// Preço e frete sempre calculados aqui, com o cardápio e as regras do servidor: o total que o navegador manda não vale.
async function priceOrder(order = {}) {
  loadProducts();
  const byId = new Map(PRODUCTS.map((p) => [String(p.id), p]));
  const byName = new Map(PRODUCTS.map((p) => [String(p.name), p]));
  const items = [];
  let cents = 0;
  for (const it of Array.isArray(order.items) ? order.items : []) {
    const p = (it && it.id !== undefined && byId.get(String(it.id))) || byName.get(String(it && it.name));
    const q = Math.floor(Number(it && it.q));
    // Esgotado ou escondido pelo dono: não se vende. O preço vem do cardápio do servidor (o promocional, quando há um), nunca do navegador.
    if (!p || p.paused || p.hidden || !(Number(p.price) > 0) || !(q >= 1 && q <= 50)) {
      return { error: 'item_indisponivel', detail: String((it && it.name) || '') };
    }
    const unit = sellPrice(p);
    items.push({ id: String(p.id), name: p.name, price: unit, ...(unit < Number(p.price) ? { regularPrice: Number(p.price) } : {}), q });
    cents += Math.round(unit * 100) * q;
  }
  if (!items.length) return { error: 'pedido_vazio' };
  const subtotal = cents / 100;
  // A loja não recebe pagamento presencial (tudo é pago online), então não existe retirada no balcão: só entrega
  if (order.mode === 'retirada' || order.mode === 'pickup' || order.pickup === true) return { error: 'so_entrega' };
  const chk = await deliveryCheck(order.addressDetails, order.unitId);
  if (!chk.verified) return { error: 'endereco_nao_confirmado' };
  if (!chk.allowed) return { error: 'fora_do_raio' };
  const distanceKm = chk.distanceKm;
  const split = calculateDeliveryAndSplit(distanceKm, subtotal);
  return {
    items,
    subtotal,
    deliveryFee: split.deliveryFee,
    distanceKm,
    mode: 'entrega',
    total: split.customerTotal,
    split
  };
}

function buildOrder(oid, priced, customer, order, paymentMethod, extra) {
  const unit = DADS_STORES[order.unitId] || DADS_STORES['passo-dareia'];
  const address = String(order.address || '').slice(0, 300);
  const created = Date.now() / 1000;
  return {
    orderId: oid,
    id: oid,
    status: 'aguardando_pagamento',
    total: priced.total,
    subtotal: priced.subtotal,
    deliveryFee: priced.deliveryFee,
    fixedFee: priced.split.fixedPlatformFee,
    fixedPlatformFee: priced.split.fixedPlatformFee,
    split: {
      subtotal: priced.split.subtotal,
      deliveryFee: priced.split.deliveryFee,
      restaurantDeliveryFee: priced.split.restaurantDeliveryFee,
      deliveryLeftover: priced.split.deliveryLeftover,
      fixedPlatformFee: priced.split.fixedPlatformFee,
      platformFee: priced.split.platformFee,
      restaurantAmount: priced.split.restaurantAmount,
      customerTotal: priced.total
    },
    customer: {
      name: String(customer.name || 'Cliente').slice(0, 80),
      phone: onlyDigits(customer.phone).slice(0, 13),
      address
    },
    order: {
      items: priced.items,
      subtotal: priced.subtotal,
      deliveryFee: priced.deliveryFee,
      distanceKm: priced.distanceKm,
      total: priced.total,
      mode: priced.mode,
      address,
      addressDetails: order.addressDetails,
      ref: String(order.ref || '').slice(0, 120),
      unitId: unit.id
    },
    unitId: unit.id,
    unitName: unit.name,
    paymentMethod,
    created_at: created,
    // Código secreto do link de acompanhamento do cliente (/?pedido=CÓDIGO). O número do pedido (DAD-1234) é fácil de
    // adivinhar e nunca serve de chave: só quem recebeu este código vê o andamento do pedido.
    trackToken: crypto.randomBytes(16).toString('base64url'),
    history: [{ status: 'aguardando_pagamento', at: created }],
    isNew: true,
    ...extra
  };
}

// Muda o andamento do pedido e guarda a hora de cada mudança (a página de acompanhamento mostra esses horários)
function setStatus(order, status, at = Date.now() / 1000) {
  if (order.status === status && Array.isArray(order.history) && order.history.length) return;
  order.status = status;
  order.history = [...(Array.isArray(order.history) ? order.history : []), { status, at }];
}

let accountsApi = null; // contas de clientes e raspadinha (accounts.js), ligado mais abaixo
const acctOf = (req) => { const a = accountsApi && accountsApi.accountOf(req); return a ? a.id : undefined; };

function markPaid(order, mpPayment) {
  order.paymentConfirmed = true;
  order.paid_at = Date.now() / 1000;
  // Previsão inicial: o tempo máximo de preparo da loja; o restaurante ajusta ao vivo no painel
  const prepMax = Number(SETTINGS.store && SETTINGS.store.preparationTimeMax) || 45;
  if (!order.etaAt) order.etaAt = order.paid_at + prepMax * 60;
  if (accountsApi) accountsApi.onPaid(order, mpPayment);
  setStatus(order, 'novo', order.paid_at);
  order.mpStatus = mpPayment.status;
  order.isNew = true;
  ORDERS[order.orderId] = order;
  saveOrders();
  ev('payment.confirmed', 'ok', `Pagamento confirmado · ${order.orderId}`, `${shortCustomer(order)} · ${moneyBR(order.total)} · ${payLabel(order)}. O pedido já está na coluna Novos do quadro.`, { orderId: order.orderId });
}

// Pergunta ao Mercado Pago, nunca ao navegador: só vira pago o que a API confirma, para o mesmo pedido e valor.
// Depois de pago, o pedido ainda pode ser devolvido ou contestado no Mercado Pago: o quadro do restaurante mostra a marca.
function noteAfterSale(order, p) {
  const refundedAmount = Number(p.transaction_amount_refunded) || 0;
  const flags = { mpStatus: String(p.status || ''), refundedAmount, refunded: p.status === 'refunded' || refundedAmount > 0, chargedBack: p.status === 'charged_back' };
  if (Object.keys(flags).every((k) => order[k] === flags[k])) return;
  Object.assign(order, flags);
  ORDERS[order.orderId] = order;
  saveOrders();
}

// refresh: consulta de novo mesmo com o pedido já pago (aviso do webhook), para registrar devolução ou contestação.
async function reconcilePayment(paymentId, { refresh = false } = {}) {
  let order = Object.values(ORDERS).find((o) => String(o.paymentId) === String(paymentId));
  let fetched = null;
  if (!order) {
    // Pagamento de saldo/crédito: o Mercado Pago cria o pagamento depois do clique, então o pedido ainda não conhece o número.
    // Liga os dois pelo número do pedido (external_reference); um pedido já pago nunca troca de pagamento.
    fetched = await mpCall(() => mpPayments().get({ id: paymentId }));
    const ref = fetched.ok && fetched.data ? String(fetched.data.external_reference || '') : '';
    const cand = ref && ORDERS[ref];
    if (!cand || cand.paymentKind !== 'wallet' || cand.paymentConfirmed) return { status: 'desconhecido', confirmed: false };
    cand.paymentId = String(fetched.data.id);
    order = cand;
  }
  if (order.paymentConfirmed && !refresh) return { status: 'approved', confirmed: true };
  const r = fetched || await mpCall(() => mpPayments().get({ id: paymentId }));
  if (!r.ok || !r.data) return order.paymentConfirmed ? { status: 'approved', confirmed: true } : { status: 'pending', confirmed: false };
  const p = r.data;
  if (order.paymentConfirmed) {
    noteAfterSale(order, p);
    return { status: 'approved', confirmed: true };
  }
  const sameOrder = String(p.external_reference || '') === String(order.orderId)
    && Math.abs(Number(p.transaction_amount) - Number(order.total)) < 0.005
    && String(p.currency_id || 'BRL') === 'BRL';
  if (p.status === 'approved' && sameOrder) {
    markPaid(order, p);
    return { status: 'approved', confirmed: true };
  }
  return { status: String(p.status || 'pending'), confirmed: false };
}

// Assinatura do webhook (x-signature): HMAC SHA256 do manifesto com o segredo do webhook.
// Sem segredo configurado a notificação é só um aviso: o status sempre vem da consulta à API.
function verifyMpSignature(req) {
  const secret = mpWebhookSecret();
  if (!secret) return true;
  const parts = {};
  String(req.get('x-signature') || '').split(',').forEach((kv) => {
    const i = kv.indexOf('=');
    if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  });
  if (!parts.ts || !parts.v1) return false;
  const dataId = String(req.query['data.id'] || (req.body && req.body.data && req.body.data.id) || '').toLowerCase();
  const requestId = req.get('x-request-id');
  const manifest = `${dataId ? `id:${dataId};` : ''}${requestId ? `request-id:${requestId};` : ''}ts:${parts.ts};`;
  const mine = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(parts.v1));
  } catch {
    return false;
  }
}

// Configuração para o navegador (só a chave pública)
app.get('/api/mercadopago/config', (req, res) => {
  const publicKey = mpPublicKey();
  res.json({ configured: Boolean(mpToken()), publicKey, hasPublicKey: Boolean(publicKey) });
});

// Pix: cria a cobrança no Mercado Pago e devolve o QR Code. O pedido só aparece no quadro depois de pago.
app.post('/api/mercadopago/pix', async (req, res) => {
  if (!mpToken()) return res.status(503).json({ success: false, error: 'mp_nao_configurado' });
  const { customer = {}, order = {} } = req.body || {};
  if (!shopGate(res, 'pix_online')) return;
  const cpf = onlyDigits(customer.cpf);
  if (!validCpf(cpf)) return res.status(400).json({ success: false, error: 'cpf_invalido' });
  const buyerErr = checkBuyer(customer);
  if (buyerErr) return res.status(400).json({ success: false, error: buyerErr });
  const priced = await priceOrder(order);
  if (priced.error) return res.status(400).json({ success: false, error: priced.error, detail: priced.detail });
  const changed = totalMismatch(order, priced);
  if (changed) return res.status(409).json(changed);

  const oid = newOrderId();
  const benefit = accountsApi ? accountsApi.reserveBenefit(req, oid, priced) : null; // brinde ou desconto da raspadinha, se a conta tiver
  const expires = mpExpiry(30);
  const notificationUrl = mpNotificationUrl();
  const addr = mpAddress(order, priced);
  const r = await mpCreatePayment({
    transaction_amount: priced.total,
    description: `Dad's Burger - Pedido ${oid}`,
    payment_method_id: 'pix',
    date_of_expiration: expires,
    external_reference: oid,
    statement_descriptor: 'DADS BURGER',
    ...(notificationUrl ? { notification_url: notificationUrl } : {}),
    payer: mpPayer(customer, cpf, addr),
    additional_info: mpAdditionalInfo(priced, customer, addr),
    metadata: { order_id: oid, unit_id: order.unitId || '', mode: priced.mode }
  }, oid, (req.body || {}).deviceId);
  const tx = r.data && r.data.point_of_interaction && r.data.point_of_interaction.transaction_data;
  if (!r.ok || !r.data || !r.data.id || !tx || !tx.qr_code) {
    console.warn('Mercado Pago não gerou o Pix:', r.status, (r.data && (r.data.message || r.data.error)) || r.error || '');
    return res.status(502).json({ success: false, error: 'mp_recusou' });
  }

  ORDERS[oid] = buildOrder(oid, priced, customer, order, 'Pix', {
    accountId: acctOf(req),
    benefit,
    discount: priced.discount || 0,
    paymentId: String(r.data.id),
    mpOrderId: String(r.data.id),
    paymentKind: 'pix',
    paymentConfirmed: false,
    mpStatus: r.data.status,
    expires_at: expires
  });
  saveOrders();
  ev('order.created', 'info', `Pedido ${oid} aguardando o Pix`, `${shortCustomer(ORDERS[oid])} gerou o QR Code de ${moneyBR(priced.total)}. O pedido só aparece no quadro depois que o Mercado Pago confirmar o pagamento.`, { orderId: oid });

  res.json({
    success: true,
    orderId: oid,
    paymentId: String(r.data.id),
    qrCode: tx.qr_code,
    qrCodeImage: tx.qr_code_base64 ? `data:image/png;base64,${tx.qr_code_base64}` : '',
    total: priced.total,
    items: priced.items,
    expiresAt: expires,
    status: 'pending',
    trackToken: ORDERS[oid].trackToken
  });
});

// Cartão: o navegador manda só o token gerado pelo Mercado Pago (o número do cartão nunca passa por aqui).
app.post('/api/mercadopago/card-payment', async (req, res) => {
  if (!mpToken()) return res.status(503).json({ success: false, error: 'mp_nao_configurado' });
  const { customer = {}, order = {}, card = {} } = req.body || {};
  const cpf = onlyDigits(customer.cpf);
  const token = String(card.token || '');
  const methodId = String(card.paymentMethodId || '');
  const installments = Math.floor(Number(card.installments) || 1);
  if (!validCpf(cpf)) return res.status(400).json({ success: false, error: 'cpf_invalido' });
  const buyerErr = checkBuyer(customer);
  if (buyerErr) return res.status(400).json({ success: false, error: buyerErr });
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token) || !/^[a-z0-9_]{2,30}$/.test(methodId) || installments < 1 || installments > 12) {
    return res.status(400).json({ success: false, error: 'dados_do_cartao_invalidos' });
  }
  if (!shopGate(res, methodId.startsWith('deb') ? 'cartao_debito_online' : 'cartao_online')) return;
  const priced = await priceOrder(order);
  if (priced.error) return res.status(400).json({ success: false, error: priced.error, detail: priced.detail });
  const changed = totalMismatch(order, priced);
  if (changed) return res.status(409).json(changed);

  const oid = newOrderId();
  const benefit = accountsApi ? accountsApi.reserveBenefit(req, oid, priced) : null; // brinde ou desconto da raspadinha, se a conta tiver
  const notificationUrl = mpNotificationUrl();
  const addr = mpAddress(order, priced);
  const r = await mpCreatePayment({
    transaction_amount: priced.total,
    token,
    description: `Dad's Burger - Pedido ${oid}`,
    installments,
    payment_method_id: methodId,
    ...(Number(card.issuerId) ? { issuer_id: Number(card.issuerId) } : {}),
    payer: mpPayer(customer, cpf, addr),
    additional_info: mpAdditionalInfo(priced, customer, addr),
    external_reference: oid,
    binary_mode: true,
    statement_descriptor: 'DADS BURGER',
    ...(notificationUrl ? { notification_url: notificationUrl } : {}),
    metadata: { order_id: oid, unit_id: order.unitId || '', mode: priced.mode }
  }, oid, card.deviceId);
  if (!r.data || !r.data.id) {
    console.warn('Mercado Pago não processou o cartão:', r.status, (r.data && (r.data.message || r.data.error)) || r.error || '');
    return res.status(502).json({ success: false, error: 'mp_recusou' });
  }
  const p = r.data;
  if (p.status === 'rejected') {
    ev('payment.rejected', 'warn', 'Cartão recusado', `${shortCustomer({ customer })} · ${moneyBR(priced.total)} · motivo: ${String(p.status_detail || 'não informado').slice(0, 60)}. Nenhum pedido foi criado.`);
    return res.status(402).json({ success: false, status: 'rejected', reason: String(p.status_detail || '') });
  }
  if (!r.ok || (p.status !== 'approved' && p.status !== 'in_process' && p.status !== 'pending')) {
    console.warn('Mercado Pago respondeu algo inesperado ao cartão:', r.status, p.status);
    return res.status(502).json({ success: false, error: 'mp_recusou' });
  }

  const rec = buildOrder(oid, priced, customer, order, 'Cartão', {
    accountId: acctOf(req),
    benefit,
    discount: priced.discount || 0,
    paymentId: String(p.id),
    mpOrderId: String(p.id),
    paymentKind: 'cartao',
    paymentConfirmed: false,
    mpStatus: p.status,
    cardBrand: String(p.payment_method_id || methodId),
    installments: Number(p.installments) || installments
  });
  ORDERS[oid] = rec;
  ev('order.created', 'info', `Pedido ${oid} · ${payLabel(rec).toLowerCase()}`, `${shortCustomer(rec)} · ${moneyBR(priced.total)} · resposta do Mercado Pago: ${p.status === 'approved' ? 'aprovado' : 'em análise'}.`, { orderId: oid });
  if (p.status === 'approved') markPaid(rec, p); else saveOrders();

  res.json({
    success: true,
    status: p.status === 'approved' ? 'approved' : 'in_process',
    orderId: oid,
    paymentId: String(p.id),
    total: priced.total,
    items: priced.items,
    brand: rec.cardBrand,
    installments: rec.installments,
    trackToken: rec.trackToken
  });
});

// Status do pagamento: consulta o Mercado Pago (falha = ainda não pago)
app.get('/api/mercadopago/payment/:id/status', async (req, res) => {
  res.json(await reconcilePayment(req.params.id));
});

// Saldo ou crédito do Mercado Pago: cria uma preferência (purpose wallet_purchase) e devolve o endereço do Mercado Pago, onde o
// cliente entra na conta dele e paga. A volta é a página de acompanhamento; quem confirma o pagamento é o Mercado Pago
// (aviso ou conferência do servidor), nunca o navegador.
app.post('/api/mercadopago/wallet', async (req, res) => {
  if (!mpToken()) return res.status(503).json({ success: false, error: 'mp_nao_configurado' });
  if (!walletReady()) return res.status(503).json({ success: false, error: 'carteira_indisponivel' });
  const { customer = {}, order = {} } = req.body || {};
  if (!shopGate(res, 'mercadopago_saldo')) return;
  const buyerErr = checkBuyer(customer);
  if (buyerErr) return res.status(400).json({ success: false, error: buyerErr });
  const priced = await priceOrder(order);
  if (priced.error) return res.status(400).json({ success: false, error: priced.error, detail: priced.detail });
  const changed = totalMismatch(order, priced);
  if (changed) return res.status(409).json(changed);

  const oid = newOrderId();
  const benefit = accountsApi ? accountsApi.reserveBenefit(req, oid, priced) : null; // brinde ou desconto da raspadinha, se a conta tiver
  const rec = buildOrder(oid, priced, customer, order, 'Mercado Pago (saldo ou crédito)', {
    accountId: acctOf(req),
    benefit,
    discount: priced.discount || 0,
    paymentKind: 'wallet',
    paymentConfirmed: false,
    expires_at: mpExpiry(30)
  });
  const parts = nameParts(customer);
  const back = `${appBase()}/?pedido=${rec.trackToken}`;
  let items = priced.items.map((it) => ({ id: it.id, title: it.name, quantity: it.q, unit_price: it.price, currency_id: 'BRL' }));
  if (priced.deliveryFee > 0) items.push({ id: 'entrega', title: 'Taxa de entrega', quantity: 1, unit_price: priced.deliveryFee, currency_id: 'BRL' });
  // Com desconto o Mercado Pago recebe um item só, no valor final (preferência não aceita item com preço negativo)
  if (priced.discount) items = [{ id: 'pedido', title: `Pedido ${oid} - Dad's Burger`, quantity: 1, unit_price: priced.total, currency_id: 'BRL' }];
  const exp = new Date(Date.now() + 30 * 60000);
  const r = await mpCall(() => new Preference(mpCfg()).create({
    body: {
      items,
      purpose: 'wallet_purchase',
      external_reference: oid,
      statement_descriptor: 'DADS BURGER',
      notification_url: mpNotificationUrl(),
      back_urls: { success: back, pending: back, failure: back },
      auto_return: 'approved',
      payer: { name: parts[0], surname: parts.slice(1).join(' '), email: String(customer.email).trim() },
      expires: true,
      expiration_date_to: exp.toISOString(),
      metadata: { order_id: oid, unit_id: order.unitId || '' }
    },
    requestOptions: { idempotencyKey: `${oid}-${crypto.randomUUID()}` }
  }));
  if (!r.ok || !r.data || !r.data.id || !r.data.init_point) {
    console.warn('Mercado Pago não criou o pagamento por saldo/crédito:', r.status, (r.data && (r.data.message || r.data.error)) || r.error || '');
    return res.status(502).json({ success: false, error: 'mp_recusou' });
  }
  rec.preferenceId = String(r.data.id);
  ORDERS[oid] = rec;
  saveOrders();
  ev('order.created', 'info', `Pedido ${oid} aguardando pagamento no Mercado Pago`, `${shortCustomer(rec)} foi levado ao Mercado Pago para pagar ${moneyBR(priced.total)} com saldo ou crédito.`, { orderId: oid });
  res.json({ success: true, orderId: oid, initPoint: r.data.init_point, total: priced.total, trackToken: rec.trackToken });
});

// Devolve ao cliente o valor de um pedido pago que o restaurante cancelou. A chave de idempotência é fixa por pedido:
// repetir o cancelamento nunca devolve duas vezes. Se o Mercado Pago recusar, o pedido fica cancelado com o aviso
// (refundError) e o painel manda devolver à mão no Mercado Pago.
async function refundOrder(order) {
  if (!order || !order.paymentConfirmed || !order.paymentId) return { done: false, reason: 'sem_pagamento' };
  if (order.refunded) return { done: true, already: true };
  const r = await mpCall(() => new PaymentRefund(mpCfg()).create({ payment_id: order.paymentId, body: {}, requestOptions: { idempotencyKey: `refund-${order.orderId}` } }));
  if (r.ok) {
    Object.assign(order, { refunded: true, refundedAmount: Number(order.total) || 0, mpStatus: 'refunded', refundError: undefined, refundId: String((r.data && r.data.id) || '') });
    ev('refund.done', 'ok', `Devolução feita · ${order.orderId}`, `${moneyBR(order.total)} voltou para o cliente pelo Mercado Pago.`, { orderId: order.orderId });
  } else {
    order.refundError = String((r.data && r.data.message) || r.error || 'erro').slice(0, 200);
    console.warn(`Devolução do pedido ${order.orderId} falhou:`, r.status, order.refundError);
    ev('refund.failed', 'error', `Devolução recusada · ${order.orderId}`, 'O Mercado Pago não fez a devolução. Devolva à mão no painel do Mercado Pago.', { orderId: order.orderId });
  }
  ORDERS[order.orderId] = order;
  saveOrders();
  return r.ok ? { done: true } : { done: false, reason: 'mp_recusou' };
}

// Webhook do Mercado Pago: o corpo não é confiado, só serve para saber qual pagamento consultar
const evRate = new Map(); // chave -> horas dos últimos registros (o webhook é público: sem limite, qualquer um encheria o terminal)
const evAllow = (key, max, windowMs) => {
  const now = Date.now();
  const a = (evRate.get(key) || []).filter((t) => now - t < windowMs);
  if (a.length >= max) { evRate.set(key, a); return false; }
  a.push(now); evRate.set(key, a);
  return true;
};
app.post(['/api/mercadopago/webhook', '/api/webhook'], async (req, res) => {
  if (!verifyMpSignature(req)) {
    if (evAllow('whbad', 3, 60000)) ev('webhook.rejected', 'warn', 'Aviso recusado: a assinatura não confere', 'Alguém pode ter tentado enviar um aviso falso. Nada foi alterado.');
    return res.status(401).json({ success: false });
  }
  const type = String(req.query.type || req.query.topic || (req.body && req.body.type) || '');
  const id = req.query['data.id'] || (req.body && req.body.data && req.body.data.id) || (req.query.topic === 'payment' ? req.query.id : '');
  // Responde logo (o Mercado Pago espera até 22 s e senão reenvia o aviso); a conferência na API segue depois
  res.status(200).json({ success: true });
  if (id && (!type || type === 'payment') && evAllow('wh', 20, 60000)) ev('webhook.received', 'info', 'Aviso do Mercado Pago recebido', `Pagamento ${String(id).replace(/[^\w-]/g, '').slice(0, 20)}: o servidor confere o status direto na API antes de confiar.`);
  if (id && (!type || type === 'payment')) {
    try { await reconcilePayment(id, { refresh: true }); } catch (e) { /* o laço de conferência tenta de novo */ }
  }
});

// Vale-refeição online (VR / Pluxee / Ticket): ainda sem provedor conectado.
// Não cria cobrança nem pedido: responde 501 até a integração existir. Quando existir, a chave secreta do
// provedor fica só aqui (variável de ambiente) e o pedido só vira "pago" pelo webhook do provedor.
app.post('/api/vr/charges', (req, res) => {
  res.status(501).json({ ok: false, error: 'vr_provider_not_connected' });
});

// -------------------------------------------------------------
// PORTAL DO RESTAURANTE - GESTÃO DE PEDIDOS
// -------------------------------------------------------------
// Pedido de verdade = pago e confirmado pelo Mercado Pago (a loja não recebe pagamento presencial).
// Cobrança sem pagamento, recusada, de simulação ou de teste não aparece no quadro (fica só no arquivo).
const isRealOrder = (o) => Boolean(o && o.paymentConfirmed === true);

// -------------------------------------------------------------
// PAINEL: início (números do dia), acontecimentos ao vivo, conexões (chaves) e Financeiro com Google Authenticator.
//   Chaves: as do Mercado Pago e da 99 Empresas são coladas na aba Conexões, ficam criptografadas na pasta de dados
//   (vault.js) e valem no lugar das variáveis de ambiente. Trocar ou remover uma chave pede a senha do painel de novo
//   (assim uma sessão esquecida aberta não consegue desviar os pagamentos para outra conta).
//   Financeiro: abre com o código de 6 dígitos do Google Authenticator (ou um código de recuperação) e fecha sozinho em 10 minutos.
//   DEMO_MODE=1: demonstração; aceita só a chave de teste que já está conectada (nunca guarda chave de verdade).
// -------------------------------------------------------------
const DEMO_MODE = process.env.DEMO_MODE === '1';
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest();
const FIN_COOKIE = 'dads_fin';
const FIN_MINUTES = 10;
const adminTok = (req) => readCookie(req, COOKIE_NAME);
const finSig = (exp, tok) => crypto.createHmac('sha256', SESSION_SECRET).update(`fin|${exp}|${sha256(tok).toString('base64url')}`).digest('base64url');
function finExpiry(req) { // quando o Financeiro aberto nesta sessão fecha (em ms), ou 0 se está fechado
  const [exp, sig] = readCookie(req, FIN_COOKIE).split('.');
  const tok = adminTok(req);
  if (!(Number(exp) > Date.now()) || !sig || !tok) return 0;
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(finSig(exp, tok))) ? Number(exp) : 0; } catch { return 0; }
}
const finUnlocked = (req) => finExpiry(req) > 0;
const setFinCookie = (req, res, value, seconds) => res.append('Set-Cookie',
  `${FIN_COOKIE}=${encodeURIComponent(value)}; Path=/api/admin/finance; HttpOnly; SameSite=Strict; Max-Age=${seconds}${isHttps(req) ? '; Secure' : ''}`);
const openFinance = (req, res) => {
  const exp = Date.now() + FIN_MINUTES * 60000;
  setFinCookie(req, res, `${exp}.${finSig(exp, adminTok(req))}`, FIN_MINUTES * 60);
};

function financeReport() {
  const BRT = 3 * 3600; // Brasília = UTC-3, sem horário de verão
  const dayOf = (sec) => new Date((sec - BRT) * 1000).toISOString().slice(0, 10);
  const nowS = Date.now() / 1000;
  const ts = (o) => Number(o.paid_at) || Number(o.created_at) || 0;
  const paid = Object.values(ORDERS).filter(isRealOrder);
  const days = Array.from({ length: 30 }, (_, i) => dayOf(nowS - (29 - i) * 86400)); // do mais antigo ao de hoje
  const idx = Object.fromEntries(days.map((d, i) => [d, i]));
  const live = paid.filter((o) => o.status !== 'cancelado' && !o.refunded);
  const gone = paid.filter((o) => o.status === 'cancelado' || o.refunded);
  const r2 = (n) => Math.round(n * 100) / 100;
  const sum = (arr, f) => r2(arr.reduce((t, o) => t + (Number(f(o)) || 0), 0));
  const within = (arr, n) => arr.filter((o) => (idx[dayOf(ts(o))] ?? -1) >= 30 - n);
  const block = (arr) => ({ orders: arr.length, gross: sum(arr, (o) => o.total), avgTicket: arr.length ? r2(sum(arr, (o) => o.total) / arr.length) : 0, deliveryFees: sum(arr, (o) => o.deliveryFee), discounts: sum(arr, (o) => o.discount) });
  const group = (arr, keyOf) => {
    const m = new Map();
    for (const o of arr) { const k = keyOf(o); const g = m.get(k) || { name: k, orders: 0, gross: 0 }; g.orders += 1; g.gross = r2(g.gross + (Number(o.total) || 0)); m.set(k, g); }
    return [...m.values()].sort((a, b) => b.gross - a.gross);
  };
  const methodKey = (m) => { const t = String(m || ''); if (/pix/i.test(t)) return 'Pix'; if (/d[eé]bito/i.test(t)) return 'Cartão de débito'; if (/cart/i.test(t)) return 'Cartão de crédito'; return 'Saldo Mercado Pago'; };
  const items = new Map();
  for (const o of live) for (const it of (o.order && o.order.items) || []) {
    const name = String(it.name || ''); if (!name || name.startsWith('🎁')) continue;
    const g = items.get(name) || { name, qty: 0, gross: 0 }; g.qty += Number(it.q) || 0; g.gross = r2(g.gross + (Number(it.price) || 0) * (Number(it.q) || 0)); items.set(name, g);
  }
  const shortName = (n) => { const w = String((n && n.name) || 'Cliente').trim().split(/\s+/); return w.length > 1 ? `${w[0]} ${w[w.length - 1][0]}.` : w[0]; };
  return {
    generatedAt: nowS,
    periods: { today: block(within(live, 1)), last7: block(within(live, 7)), last30: block(within(live, 30)), all: block(live) },
    daily: days.slice(-14).map((d) => { const a = live.filter((o) => dayOf(ts(o)) === d); return { day: d, orders: a.length, gross: sum(a, (o) => o.total) }; }),
    byMethod: group(live, (o) => methodKey(o.paymentMethod)),
    byUnit: group(live, (o) => o.unitName || o.unitId || 'Loja'),
    topItems: [...items.values()].sort((a, b) => b.gross - a.gross).slice(0, 6),
    recent: [...live].sort((a, b) => ts(b) - ts(a)).slice(0, 8).map((o) => ({ orderId: o.orderId, at: ts(o), customer: shortName(o.customer), total: r2(o.total), method: methodKey(o.paymentMethod), status: o.status })),
    refunds: { orders: gone.length, amount: sum(gone, (o) => o.total) }
  };
}

// ---- Conexões: chaves do Mercado Pago e da 99 Empresas ----
const relaxedKeys = Boolean(process.env.MP_API_BASE); // com o Mercado Pago de mentira (testes) as chaves não têm o formato real
const MP_FIELDS = {
  accessToken: { name: 'mp.accessToken', env: ['MERCADOPAGO_ACCESS_TOKEN', 'MERCADO_PAGO_ACCESS_TOKEN'], re: /^(APP_USR|TEST)-[A-Za-z0-9_-]{16,200}$/ },
  publicKey: { name: 'mp.publicKey', env: ['MERCADOPAGO_PUBLIC_KEY', 'MERCADO_PAGO_PUBLIC_KEY'], re: /^(APP_USR|TEST)-[A-Za-z0-9_-]{16,100}$/ },
  webhookSecret: { name: 'mp.webhookSecret', env: ['MERCADOPAGO_WEBHOOK_SECRET', 'MERCADO_PAGO_WEBHOOK_SECRET'], re: /^[A-Za-z0-9]{16,128}$/ }
};
// 99 Empresas: ainda não existe chamada à API deles neste servidor. Os campos só guardam as credenciais, criptografadas, para
// quando a integração for ligada (o formato das credenciais da 99 não é público: aqui só se confere tamanho e caracteres).
const NN_FIELDS = {
  clientId: { name: 'nn.clientId', re: /^[\w.@:-]{3,120}$/ },
  apiKey: { name: 'nn.apiKey', re: /^[\w.~+/=:-]{8,300}$/ },
  storeId: { name: 'nn.storeId', re: /^[\w.@:-]{1,120}$/, optional: true }
};
const fieldState = (def) => {
  if (vault.has(def.name)) return { set: true, source: 'painel', hint: vault.hint(def.name), at: vault.savedAt(def.name) };
  const v = def.env ? envFirst(...def.env) : '';
  return v ? { set: true, source: 'ambiente', hint: v.slice(-4), at: 0 } : { set: false, source: null, hint: '', at: 0 };
};

// Pergunta ao Mercado Pago quem é o dono da chave (GET /users/me): 401/403 = chave recusada; erro de rede = não deu para conferir
async function mpProbe(token) {
  try {
    const r = await fetch('https://api.mercadopago.com/users/me', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    if (r.status === 401 || r.status === 403) return { ok: false, rejected: true };
    if (!r.ok) return { ok: false, unreachable: true };
    const d = await r.json().catch(() => ({}));
    return { ok: true, nickname: String(d.nickname || '').slice(0, 60), siteId: String(d.site_id || '').slice(0, 6), test: Array.isArray(d.tags) && d.tags.includes('test_user') };
  } catch {
    return { ok: false, unreachable: true };
  }
}
const connState = { mp: null }; // última conferência: { ok: true | false | null, nickname, siteId, test, checkedAt }
async function refreshMpState() {
  const token = mpToken();
  const prev = connState.mp;
  if (!token) { connState.mp = null; return null; }
  const r = await mpProbe(token);
  const at = Date.now() / 1000;
  connState.mp = r.ok ? { ok: true, nickname: r.nickname, siteId: r.siteId, test: r.test, checkedAt: at }
    : r.rejected ? { ok: false, checkedAt: at }
      : { ...(prev || {}), ok: prev ? prev.ok : null, unreachable: true, checkedAt: at };
  if (prev && prev.ok === true && connState.mp.ok === false) ev('mp.health', 'error', 'O Mercado Pago recusou a chave', 'Os pagamentos online podem falhar. Conecte a chave de novo na aba Conexões.');
  if (prev && prev.ok === false && connState.mp.ok === true) ev('mp.health', 'ok', 'Mercado Pago voltou a aceitar a chave', 'Os pagamentos online estão normais.');
  return connState.mp;
}

function connectionsView(req) {
  const site = appBase();
  const host = String((req && req.get('host')) || '').toLowerCase();
  const nnSaved = Object.values(NN_FIELDS).filter((d) => !d.optional).every((d) => vault.has(d.name));
  return {
    success: true,
    demo: DEMO_MODE,
    mp: {
      connected: Boolean(mpToken()),
      fields: Object.fromEntries(Object.entries(MP_FIELDS).map(([k, d]) => [k, fieldState(d)])),
      account: connState.mp,
      wallet: walletReady(),
      test: Boolean(process.env.MP_API_BASE) || Boolean(connState.mp && connState.mp.test),
      webhookUrl: mpNotificationUrl(),
      webhookSigned: Boolean(mpWebhookSecret())
    },
    nn: { saved: nnSaved, active: false, fields: Object.fromEntries(Object.entries(NN_FIELDS).map(([k, d]) => [k, fieldState(d)])) },
    site: {
      url: site,
      https: /^https:\/\//i.test(site),
      source: vault.config('appUrl') ? 'painel' : (envFirst('APP_URL') ? 'ambiente' : null),
      suggested: req && isHttps(req) && /^[a-z0-9.-]+(:\d{2,5})?$/.test(host) ? `https://${host}` : ''
    }
  };
}

const demoOnlyTest = (res) => res.status(403).json({ success: false, error: 'demo_somente_teste' });
// Ações que mexem em chave ou no Authenticator pedem a senha do painel de novo. Errar a senha aqui é 403 (não 401: 401 faria o painel dar a sessão por encerrada).
async function askPassword(req, res) {
  const r = await checkAdminPassword((req.body || {}).password);
  if (r === 'ok') return true;
  res.status(r === 'busy' ? 429 : 403).json({ success: false, error: r === 'busy' ? 'muitas_tentativas' : 'senha_incorreta' });
  return false;
}
const pick = (body, defs) => {
  const out = {};
  for (const k of Object.keys(defs)) {
    const v = String(body[k] === undefined || body[k] === null ? '' : body[k]).trim();
    if (v) out[k] = v;
  }
  return out;
};
const badField = (given, defs, relaxed) => Object.keys(given).find((k) => !(relaxed ? /^[A-Za-z0-9_.~+/=:-]{4,300}$/.test(given[k]) : defs[k].re.test(given[k])));

app.get('/api/admin/connections', requireAdmin, (req, res) => res.json(connectionsView(req)));

app.put('/api/admin/connections/mp', requireAdmin, async (req, res) => {
  const given = pick(req.body || {}, MP_FIELDS);
  if (!Object.keys(given).length) return res.status(400).json({ success: false, error: 'nada_para_salvar' });
  const bad = badField(given, MP_FIELDS, relaxedKeys);
  if (bad) return res.status(400).json({ success: false, error: 'formato_invalido', field: bad });
  if (!(await askPassword(req, res))) return;
  // Demonstração: chave de verdade nunca é guardada num servidor temporário; só vale salvar de novo a chave de teste que já está conectada
  if (DEMO_MODE && Object.entries(given).some(([k, v]) => v !== envFirst(...MP_FIELDS[k].env))) return demoOnlyTest(res);
  let probe = null;
  if (given.accessToken) {
    probe = await mpProbe(given.accessToken);
    if (probe.rejected) return res.status(400).json({ success: false, error: 'chave_recusada' });
  }
  if (!DEMO_MODE) {
    if (!vault.setSecrets(Object.fromEntries(Object.entries(given).map(([k, v]) => [MP_FIELDS[k].name, v])))) return res.status(500).json({ success: false, error: 'nao_foi_possivel_salvar' });
    ev('keys.saved', 'ok', 'Chaves do Mercado Pago atualizadas', Object.keys(given).map((k) => ({ accessToken: 'chave de acesso', publicKey: 'chave pública', webhookSecret: 'segredo do webhook' }[k])).join(', ') + '.');
  }
  if (probe) connState.mp = probe.ok ? { ok: true, nickname: probe.nickname, siteId: probe.siteId, test: probe.test, checkedAt: Date.now() / 1000 } : { ok: null, unreachable: true, checkedAt: Date.now() / 1000 };
  res.json({ ...connectionsView(req), ...(probe && probe.unreachable ? { warning: 'nao_foi_possivel_conferir' } : {}) });
});

app.post('/api/admin/connections/mp/test', requireAdmin, async (req, res) => {
  if (!mpToken()) return res.status(400).json({ success: false, error: 'sem_chave' });
  const st = await refreshMpState();
  ev('keys.tested', st && st.ok ? 'ok' : 'warn', st && st.ok ? 'Teste da conexão com o Mercado Pago: tudo certo' : 'Teste da conexão com o Mercado Pago: não passou', st && st.ok ? 'A chave é aceita e a conta foi encontrada.' : (st && st.ok === false ? 'O Mercado Pago recusou a chave.' : 'Não consegui falar com o Mercado Pago agora.'));
  res.json({ ...connectionsView(req), result: st });
});

app.post('/api/admin/connections/mp/disconnect', requireAdmin, async (req, res) => {
  if (!(await askPassword(req, res))) return;
  if (DEMO_MODE) return demoOnlyTest(res);
  vault.removeSecrets(Object.values(MP_FIELDS).map((d) => d.name));
  await refreshMpState();
  ev('keys.removed', 'warn', 'Chaves do Mercado Pago removidas do painel', mpToken() ? 'Ainda há chaves do ambiente do servidor em uso.' : 'Os pagamentos online ficam indisponíveis até conectar de novo.');
  res.json(connectionsView(req));
});

app.put('/api/admin/connections/nn', requireAdmin, async (req, res) => {
  const given = pick(req.body || {}, NN_FIELDS);
  const missing = Object.entries(NN_FIELDS).filter(([k, d]) => !d.optional && !given[k] && !vault.has(d.name)).map(([k]) => k);
  if (!Object.keys(given).length || missing.length) return res.status(400).json({ success: false, error: 'faltam_campos', fields: missing });
  const bad = Object.keys(given).find((k) => !NN_FIELDS[k].re.test(given[k]));
  if (bad) return res.status(400).json({ success: false, error: 'formato_invalido', field: bad });
  if (!(await askPassword(req, res))) return;
  if (DEMO_MODE) return demoOnlyTest(res);
  if (!vault.setSecrets(Object.fromEntries(Object.entries(given).map(([k, v]) => [NN_FIELDS[k].name, v])))) return res.status(500).json({ success: false, error: 'nao_foi_possivel_salvar' });
  ev('keys.saved', 'info', 'Credenciais da 99 Empresas guardadas', 'A chamada automática do entregador ainda precisa ser ativada.');
  res.json(connectionsView(req));
});

app.post('/api/admin/connections/nn/disconnect', requireAdmin, async (req, res) => {
  if (!(await askPassword(req, res))) return;
  if (DEMO_MODE) return demoOnlyTest(res);
  vault.removeSecrets(Object.values(NN_FIELDS).map((d) => d.name));
  ev('keys.removed', 'warn', 'Credenciais da 99 Empresas removidas', '');
  res.json(connectionsView(req));
});

// Endereço público do site (https): para onde o Mercado Pago avisa que o pagamento saiu e para onde o cliente volta
app.put('/api/admin/connections/site', requireAdmin, async (req, res) => {
  const url = String((req.body || {}).appUrl || '').trim().replace(/\/+$/, '').toLowerCase();
  if (url && !/^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{2,5})?$/.test(url)) return res.status(400).json({ success: false, error: 'formato_invalido', field: 'appUrl' });
  if (!(await askPassword(req, res))) return;
  if (DEMO_MODE) return demoOnlyTest(res);
  if (!vault.setConfig('appUrl', url)) return res.status(500).json({ success: false, error: 'nao_foi_possivel_salvar' });
  ev('site.url', 'ok', url ? 'Endereço do site atualizado' : 'Endereço do site voltou ao do servidor', url ? 'Os avisos do Mercado Pago passam a usar o novo endereço.' : '');
  res.json(connectionsView(req));
});

// Confere sozinho, de tempos em tempos, se o Mercado Pago ainda aceita a chave (e avisa no terminal se deixar de aceitar)
setTimeout(() => { refreshMpState().catch(() => {}); }, 2500).unref();
setInterval(() => { refreshMpState().catch(() => {}); }, Number(process.env.MP_PROBE_MS) || 20 * 60 * 1000).unref();

// ---- Estado do sistema: alimenta os selos do painel e o passo a passo "como funciona" ----
app.get('/api/admin/system', requireAdmin, (req, res) => {
  const real = Object.values(ORDERS).filter(isRealOrder);
  const fin = vault.finStatus();
  res.json({
    success: true,
    demo: DEMO_MODE,
    server: { persistent: CUSTOM_DATA_DIR, https: /^https:\/\//i.test(appBase()), uptimeSec: Math.round(process.uptime()) },
    menu: { products: PRODUCTS.length, visible: PRODUCTS.filter((p) => !p.hidden).length, paused: PRODUCTS.filter((p) => p.paused).length },
    orders: { paid: real.length },
    mp: {
      keys: Boolean(mpToken()), publicKey: Boolean(mpPublicKey()), webhookSecret: Boolean(mpWebhookSecret()), wallet: walletReady(),
      mode: process.env.MP_API_BASE ? 'teste' : (mpToken() ? 'chaves' : 'sem_chaves'),
      account: connState.mp
    },
    courier: { provider: '99 Empresas', connected: false, saved: vault.has(NN_FIELDS.apiKey.name) && vault.has(NN_FIELDS.clientId.name) },
    finance: { configured: fin.configured }
  });
});

// ---- Início: números do dia, sem dinheiro (o faturamento só aparece no Financeiro, depois do código) ----
const payKind = (o) => (o && o.paymentKind === 'pix' ? 'pix' : o && o.paymentKind === 'wallet' ? 'saldo' : 'cartao');
app.get('/api/admin/dashboard', requireAdmin, (req, res) => {
  const BRT = 3 * 3600; // Brasília = UTC-3, sem horário de verão
  const nowS = Date.now() / 1000;
  const dayOf = (sec) => new Date((sec - BRT) * 1000).toISOString().slice(0, 10);
  const hourOf = (sec) => new Date((sec - BRT) * 1000).getUTCHours();
  const ts = (o) => Number(o.paid_at) || Number(o.created_at) || 0;
  const all = Object.values(ORDERS);
  const real = all.filter(isRealOrder);
  const live = real.filter((o) => o.status !== 'cancelado' && !o.refunded);
  const today = dayOf(nowS);
  const todays = real.filter((o) => dayOf(ts(o)) === today);
  const todaysLive = todays.filter((o) => o.status !== 'cancelado' && !o.refunded);
  const hourly = Array(24).fill(0);
  for (const o of todaysLive) hourly[hourOf(ts(o))] += 1;
  const days = Array.from({ length: 7 }, (_, i) => dayOf(nowS - (6 - i) * 86400));
  const week = days.map((d) => ({ day: d, orders: live.filter((o) => dayOf(ts(o)) === d).length }));
  const week7 = live.filter((o) => days.includes(dayOf(ts(o))));
  const channels = { pix: 0, cartao: 0, saldo: 0 };
  for (const o of week7) channels[payKind(o)] += 1;
  const items = new Map();
  for (const o of week7) for (const it of (o.order && o.order.items) || []) {
    const name = String(it.name || '');
    if (!name || name.startsWith('🎁')) continue;
    items.set(name, (items.get(name) || 0) + (Number(it.q) || 0));
  }
  const at = (o, s) => { const h = (Array.isArray(o.history) ? o.history : []).find((x) => x.status === s); return h ? Number(h.at) : 0; };
  const mins = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length / 60) : null);
  const ok = (x) => x > 0 && x < 6 * 3600;
  const accept = todaysLive.map((o) => at(o, 'preparando') - (Number(o.paid_at) || at(o, 'novo'))).filter(ok);
  const prep = todaysLive.map((o) => (at(o, 'entrega') || at(o, 'concluido')) - at(o, 'preparando')).filter(ok);
  const open = (s) => real.filter((o) => o.status === s).length;
  const yesterday = dayOf(nowS - 86400);
  res.json({
    success: true,
    generatedAt: nowS,
    today: {
      orders: todaysLive.length,
      cancelled: todays.length - todaysLive.length,
      waitingPayment: all.filter((o) => o.paymentConfirmed === false && o.status === 'aguardando_pagamento' && nowS - Number(o.created_at) < 40 * 60).length,
      avgAcceptMin: mins(accept),
      avgPrepMin: mins(prep)
    },
    open: { novo: open('novo'), preparando: open('preparando'), entrega: open('entrega') },
    yesterdayOrders: live.filter((o) => dayOf(ts(o)) === yesterday).length,
    hourly,
    week,
    channels,
    topItems: [...items.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, qty]) => ({ name, qty }))
  });
});

// ---- Acontecimentos ao vivo (o terminal): o painel pergunta de poucos em poucos segundos só o que é novo ----
app.get('/api/admin/events', requireAdmin, (req, res) => {
  res.json({ success: true, events: vault.events(Number(req.query.after) || 0, Number(req.query.limit) || 80), serverTime: Date.now() / 1000 });
});

// ---- Financeiro: Google Authenticator ----
const finFail = (res, r) => {
  const code = { bloqueado_temporariamente: 429, codigo_incorreto: 403, codigo_ja_usado: 403, sem_configuracao_pendente: 410, nao_configurado: 409, ja_configurado: 409 }[r.error] || 500;
  res.status(code).json({ success: false, error: r.error, ...(r.left !== undefined ? { left: r.left } : {}), ...(r.waitSec ? { waitSec: r.waitSec } : {}) });
};
const finEvents = (r) => {
  if (r.error === 'codigo_incorreto') ev('finance.failed', 'warn', 'Código errado no Financeiro', r.left ? `Restam ${r.left} tentativas antes de travar por 10 minutos.` : '');
  if (r.error === 'bloqueado_temporariamente') ev('finance.lockout', 'error', 'Financeiro travado por 10 minutos', 'Houve vários códigos errados seguidos.');
};

app.get('/api/admin/finance/status', requireAdmin, (req, res) => {
  const s = vault.finStatus();
  const open = s.configured && finUnlocked(req);
  res.json({ success: true, ...s, unlocked: open, minutes: FIN_MINUTES, expiresInSec: open ? Math.max(0, Math.round((finExpiry(req) - Date.now()) / 1000)) : 0 });
});

// 1) Mostra o QR Code para o dono ler no Google Authenticator (só enquanto o Authenticator ainda não foi ligado)
app.post('/api/admin/finance/setup', requireAdmin, async (req, res) => {
  if (vault.finStatus().configured) return res.status(409).json({ success: false, error: 'ja_configurado' });
  if (!(await askPassword(req, res))) return;
  const issuer = String((SETTINGS.store && SETTINGS.store.name) || "Dad's Burger").replace(/[:%]/g, '').slice(0, 40) || "Dad's Burger";
  const r = await vault.finBeginSetup({ issuer, account: 'Financeiro' });
  if (!r.ok) return finFail(res, r);
  ev('finance.setup', 'info', 'Configuração do Google Authenticator iniciada', 'Falta o primeiro código do aplicativo para ligar.');
  res.json({ success: true, secret: r.secret, uri: r.uri, qr: r.qr, minutes: 30 });
});

// 2) O primeiro código certo liga o Authenticator, abre o Financeiro e entrega os códigos de recuperação (só desta vez)
app.post('/api/admin/finance/activate', requireAdmin, (req, res) => {
  const r = vault.finActivate((req.body || {}).code);
  if (!r.ok) { finEvents(r); return finFail(res, r); }
  openFinance(req, res);
  ev('finance.activated', 'ok', 'Google Authenticator ligado', 'O Financeiro agora só abre com o código do aplicativo.');
  res.json({ success: true, recovery: r.recovery, minutes: FIN_MINUTES });
});

// 3) Dia a dia: o código de 6 dígitos (ou um código de recuperação) abre o Financeiro por 10 minutos
app.post('/api/admin/finance/verify', requireAdmin, (req, res) => {
  const r = vault.finVerify((req.body || {}).code);
  if (!r.ok) { finEvents(r); return finFail(res, r); }
  openFinance(req, res);
  ev('finance.unlocked', 'ok', 'Financeiro aberto', r.how === 'recuperacao' ? `Aberto com um código de recuperação (restam ${r.left}).` : `Aberto com o código do Google Authenticator. Fecha sozinho em ${FIN_MINUTES} minutos.`);
  res.json({ success: true, minutes: FIN_MINUTES, how: r.how, ...(r.how === 'recuperacao' ? { recoveryLeft: r.left } : {}) });
});

app.post('/api/admin/finance/lock', requireAdmin, (req, res) => {
  const was = finUnlocked(req);
  setFinCookie(req, res, '', 0);
  if (was) ev('finance.locked', 'info', 'Financeiro fechado', '');
  res.json({ success: true });
});

// Trocou de celular? Desliga o Authenticator (senha do painel + um código do app ou de recuperação) e liga de novo no aparelho novo
app.post('/api/admin/finance/reset', requireAdmin, async (req, res) => {
  if (!vault.finStatus().configured) return res.status(409).json({ success: false, error: 'nao_configurado' });
  if (!(await askPassword(req, res))) return;
  const r = vault.finVerify((req.body || {}).code);
  if (!r.ok) { finEvents(r); return finFail(res, r); }
  if (!vault.finReset()) return res.status(500).json({ success: false, error: 'nao_foi_possivel_salvar' });
  setFinCookie(req, res, '', 0);
  ev('finance.reset', 'warn', 'Google Authenticator desligado', 'Ligue de novo, com o aplicativo no aparelho novo.');
  res.json({ success: true });
});

app.get('/api/admin/finance', requireAdmin, (req, res) => {
  if (!finUnlocked(req)) return res.status(423).json({ success: false, error: 'bloqueado' });
  res.json({ success: true, ...financeReport() });
});

app.get('/api/orders', requireAdmin, (req, res) => {
  if (fs.existsSync(ORDERS_FILE)) {
    try {
      ORDERS = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
    } catch {}
  }
  const { unitId, status } = req.query;

  const seen = new Set();
  const deduped = [];
  for (const ord of Object.values(ORDERS || {})) {
    const oid = ord?.orderId || ord?.id;
    if (!oid || seen.has(oid) || !isRealOrder(ord)) continue;
    seen.add(oid);
    deduped.push(ord);
  }

  let list = deduped;
  if (unitId && unitId !== 'todas') {
    list = list.filter(o => (o.unitId === unitId) || (o.order?.unitId === unitId));
  }
  if (status && status !== 'todos') {
    list = list.filter(o => (o.status || '').toLowerCase() === status.toLowerCase());
  }
  list.sort((a, b) => (Number(b.created_at) || 0) - (Number(a.created_at) || 0));
  res.json({ success: true, count: list.length, orders: list });
});

// O que o terminal do painel conta a cada mudança de andamento de um pedido
const STATUS_EV = {
  novo: ['info', 'voltou para Novos', ''],
  preparando: ['info', 'foi aceito', 'A cozinha começou o preparo.'],
  entrega: ['info', 'saiu para entrega', 'O cliente vê o andamento na página de acompanhamento.'],
  concluido: ['ok', 'foi entregue', 'Pedido concluído.'],
  cancelado: ['warn', 'foi cancelado', 'O restaurante cancelou o pedido.']
};
app.patch('/api/orders/:id', requireAdmin, async (req, res) => {
  const rawId = decodeURIComponent(req.params.id || '').trim();
  const id = rawId.replace(/^#/, '');
  // O painel só muda o andamento do pedido; pagamento e valores não se alteram por aqui
  const status = String((req.body || {}).status || '').toLowerCase();
  if (!['novo', 'preparando', 'entrega', 'concluido', 'cancelado'].includes(status)) {
    return res.status(400).json({ success: false, error: 'status_invalido' });
  }
  const updates = { status };

  if (fs.existsSync(ORDERS_FILE)) {
    try {
      ORDERS = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
    } catch {}
  }
  
  const numId = id.replace(/\D/g, '');
  const matchingKeys = Object.keys(ORDERS).filter(k => 
    k === id || 
    k.replace(/^#/, '') === id ||
    ORDERS[k]?.orderId === id || 
    ORDERS[k]?.orderId?.replace(/^#/, '') === id ||
    ORDERS[k]?.paymentId === id ||
    ORDERS[k]?.id === id ||
    (numId && numId.length >= 3 && ORDERS[k]?.orderId?.replace(/\D/g, '') === numId)
  ).filter(k => isRealOrder(ORDERS[k]));

  if (matchingKeys.length === 0) {
    return res.status(404).json({ success: false, error: 'Pedido não encontrado' });
  }

  let updatedOrder = null;
  for (const k of matchingKeys) {
    const wasNew = ORDERS[k].status === 'novo';
    const prevStatus = ORDERS[k].status;
    ORDERS[k] = {
      ...ORDERS[k],
      ...updates,
      status: updates.status || ORDERS[k].status,
      updated_at: Date.now() / 1000
    };
    // o horário de cada mudança aparece para o cliente na página de acompanhamento
    const hist = Array.isArray(ORDERS[k].history) ? ORDERS[k].history : [];
    if (!hist.length || hist[hist.length - 1].status !== ORDERS[k].status) {
      ORDERS[k].history = [...hist, { status: ORDERS[k].status, at: ORDERS[k].updated_at }];
    }
    updatedOrder = ORDERS[k];
    if (prevStatus !== ORDERS[k].status) { const t = STATUS_EV[ORDERS[k].status]; if (t) ev('order.status', t[0], `Pedido ${ORDERS[k].orderId} ${t[1]}`, t[2], { orderId: ORDERS[k].orderId }); }
    // O restaurante aceitou o pedido (novo -> preparando): só agora o motoboy pode ser chamado
    if (wasNew && updates.status === 'preparando') requestCourier(ORDERS[k]);
  }

  if (updatedOrder && updatedOrder.orderId) {
    ORDERS[updatedOrder.orderId] = updatedOrder;
  }

  saveOrders();

  // Pedido pago que o restaurante cancela: o valor volta para o cliente na mesma hora
  let refund;
  if (updatedOrder && updates.status === 'cancelado' && updatedOrder.paymentConfirmed) {
    refund = await refundOrder(ORDERS[updatedOrder.orderId] || updatedOrder);
    updatedOrder = ORDERS[updatedOrder.orderId] || updatedOrder;
  }

  res.json({ success: true, order: updatedOrder, ...(refund ? { refund } : {}) });
});

// -------------------------------------------------------------
// ACOMPANHAR PEDIDO (cliente): página pública, mas só abre com o código secreto do pedido.
// Devolve só o andamento: nada de nome, telefone, endereço, e-mail nem dados do pagamento.
// O número do pedido não serve de chave (é fácil de adivinhar); o código tem 128 bits sorteados.
// -------------------------------------------------------------
const TRACK_TOKEN = /^[A-Za-z0-9_-]{22}$/;
app.get('/api/track/:token', (req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
  const token = String(req.params.token || '');
  const want = Buffer.from(token);
  const o = TRACK_TOKEN.test(token) && Object.values(ORDERS).find((x) => {
    const have = x && typeof x.trackToken === 'string' ? Buffer.from(x.trackToken) : null;
    return have && have.length === want.length && crypto.timingSafeEqual(have, want);
  });
  if (!o) return res.status(404).json({ success: false, error: 'pedido_nao_encontrado' });
  loadSettings();
  const st = SETTINGS.store || {};
  const paid = o.paymentConfirmed === true;
  res.json({
    success: true,
    orderId: o.orderId,
    status: String(o.status || 'novo'),
    paid,
    pay: String(o.paymentKind || ''),
    // Pix que passou da validade sem ser pago: o cliente precisa saber que o pedido não vale mais
    expired: !paid && o.status === 'aguardando_pagamento' && Boolean(o.expires_at) && Date.parse(o.expires_at) < Date.now(),
    refunded: Boolean(o.refunded),
    unitId: o.unitId || '',
    unitName: o.unitName || '',
    items: ((o.order && o.order.items) || []).map((i) => ({ name: String(i.name), q: Number(i.q), price: Number(i.price) })),
    deliveryFee: Number(o.deliveryFee) || 0,
    total: Number(o.total) || 0,
    createdAt: Number(o.created_at) || 0,
    updatedAt: Number(o.updated_at || o.paid_at || o.created_at) || 0,
    history: (Array.isArray(o.history) ? o.history : []).map((h) => ({ status: String(h.status), at: Number(h.at) || 0 })),
    etaAt: Number(o.etaAt) || 0,
    prepMin: Number(st.preparationTimeMin) || 0,
    prepMax: Number(st.preparationTimeMax) || 0,
    now: Date.now() / 1000
  });
});

// O restaurante muda a previsão de entrega ao vivo: "minutes" = quantos minutos faltam a partir de agora
app.post('/api/orders/:id/eta', requireAdmin, (req, res) => {
  const min = Number((req.body || {}).minutes);
  if (!(min >= 0 && min <= 300)) return res.status(400).json({ success: false, error: 'minutos_invalidos' });
  const o = ORDERS[String(req.params.id || '').replace(/^#/, '')];
  if (!o || !isRealOrder(o)) return res.status(404).json({ success: false, error: 'Pedido não encontrado' });
  o.etaAt = Date.now() / 1000 + Math.round(min) * 60;
  o.updated_at = Date.now() / 1000;
  saveOrders();
  res.json({ success: true, order: o });
});

// Contas de clientes, 2FA e raspadinha
accountsApi = mountAccounts(app, {
  DATA_DIR, SESSION_SECRET, readCookie, isHttps, writeJson, validCpf, requireAdmin,
  getOrders: () => ORDERS,
  saveOrders,
  getSettings: () => { loadSettings(); return SETTINGS; },
  appUrl: () => appBase()
});

// Rota de API que não existe: resposta JSON 404, e não a página inicial do site
app.use('/api', (req, res) => res.status(404).json({ success: false, error: 'rota_nao_encontrada' }));

// Portal do Restaurante / Admin (Desktop)
app.get(['/admin', '/admin/*'], (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Fallback SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Rede de segurança: se o cliente fechou a página depois de pagar, ou o webhook não chegou, o próprio servidor
// pergunta ao Mercado Pago pelos pagamentos ainda abertos (até 40 minutos) e o pedido chega ao quadro.
setInterval(async () => {
  if (!mpToken()) return;
  const now = Date.now() / 1000;
  const open = Object.values(ORDERS).filter((o) => o.paymentId && o.paymentConfirmed === false && o.status === 'aguardando_pagamento' && now - Number(o.created_at) < 40 * 60);
  for (const o of open) await reconcilePayment(o.paymentId);
  // Saldo/crédito: o pedido ainda não tem número de pagamento; procura pelo número do pedido
  const wallets = Object.values(ORDERS).filter((o) => o.paymentKind === 'wallet' && !o.paymentId && o.paymentConfirmed === false && o.status === 'aguardando_pagamento' && now - Number(o.created_at) < 40 * 60);
  for (const o of wallets) {
    const f = await mpCall(() => mpPayments().search({ options: { external_reference: o.orderId, sort: 'date_created', criteria: 'desc', limit: 1 } }));
    const hit = f.ok && f.data && Array.isArray(f.data.results) ? f.data.results[0] : null;
    if (hit && hit.id) await reconcilePayment(hit.id);
  }
}, Number(process.env.MP_RECONCILE_MS) || 20000);

if (!(process.env.ADMIN_PASSWORD || '').trim()) {
  // (com o servidor aberto para a rede isto nem chega aqui: ele se recusa a iniciar, no começo do arquivo)
  console.warn('Aviso: ADMIN_PASSWORD não está configurada no .env. O painel usa a senha antiga (dads123): troque antes de abrir o site para os clientes.');
}

if (EXPOSED && !(process.env.SESSION_SECRET || '').trim()) {
  console.warn('Aviso: SESSION_SECRET não está configurada. Quem entrou no painel precisa entrar de novo a cada reinício do servidor.');
}

if (mpToken() && !mpWebhookSecret()) {
  console.warn('Aviso: MERCADOPAGO_WEBHOOK_SECRET não está configurado. Os avisos do webhook ficam sem a assinatura conferida (o status do pagamento continua vindo da API do Mercado Pago).');
}

// Perdeu o celular e os códigos de recuperação? Ligue o servidor uma vez com RESET_FINANCE_AUTH=1: o Authenticator do Financeiro é desligado
// e o painel pede para ligar de novo (com a senha do painel). Remova a variável depois, senão ele é desligado a cada reinício.
if (process.env.RESET_FINANCE_AUTH === '1') {
  vault.finReset();
  ev('finance.reset', 'warn', 'Google Authenticator desligado pelo servidor', 'Remova RESET_FINANCE_AUTH do ambiente e ligue o Authenticator de novo no painel.');
  console.warn('Aviso: RESET_FINANCE_AUTH=1 desligou o Google Authenticator do Financeiro. Remova essa variável e ligue o Authenticator de novo no painel (senão ele é desligado a cada reinício).');
}

const server = app.listen(PORT, HOST, () => {
  ev('system.start', 'info', 'Sistema ligado', `${mpToken() ? 'Mercado Pago conectado' : 'Mercado Pago sem chaves'} · ${CUSTOM_DATA_DIR ? 'dados no disco persistente' : 'dados ao lado do programa'}.`);
  console.log(`🍔 Dad's Burger App rodando em http://localhost:${PORT}`);
  console.log(`Pasta de dados: ${DATA_DIR}${CUSTOM_DATA_DIR ? '' : ' (ao lado do server.js)'}`);
  if (EXPOSED) {
    console.warn(`Aviso: o servidor está aberto em ${HOST}: qualquer aparelho que alcance esta máquina pela rede consegue acessá-lo.`);
  }
});
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `ERRO: a porta ${PORT} já está em uso por outro programa. Use outra porta (variável PORT) ou feche o outro programa.` : `ERRO: o servidor não conseguiu escutar em ${HOST}:${PORT}: ${e.message}`);
  process.exit(1);
});

// A hospedagem (Docker, "reiniciar", "publicar de novo") pede para encerrar com SIGTERM: termina o que está em andamento e sai.
// Sem isto, um servidor que é o processo 1 do container ignoraria o pedido e seria morto à força depois de alguns segundos.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`Recebi ${sig}: encerrando o servidor.`);
    vault.flush();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
