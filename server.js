import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const ORDERS_FILE = path.join(__dirname, 'orders.json');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const PRODUCTS_FILE = path.join(__dirname, 'products.json');

let ORDERS = {};
if (fs.existsSync(ORDERS_FILE)) {
  try {
    ORDERS = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
  } catch {
    ORDERS = {};
  }
}

function saveOrders() {
  try {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(ORDERS, null, 2), 'utf-8');
  } catch {}
}

let SETTINGS = {};
function loadSettings() {
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      SETTINGS = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    } catch {
      SETTINGS = {};
    }
  }
}
loadSettings();

function saveSettings() {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(SETTINGS, null, 2), 'utf-8');
  } catch {}
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
  try {
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(PRODUCTS, null, 2), 'utf-8');
  } catch {}
}

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
function calculateDeliveryAndSplit(distanceKm = 0, mode = 'entrega', subtotal = 0) {
  const isRetirada = mode === 'retirada' || mode === 'pickup';
  const sub = Number(subtotal) || 0;
  const fixedPlatformFee = 1.50; // Adicional fixo da plataforma por pedido

  if (isRetirada) {
    const platformFee = fixedPlatformFee;
    const customerTotal = sub;
    const restaurantAmount = Math.max(0, customerTotal - platformFee);

    return {
      mode: 'retirada',
      distanceKm: 0,
      deliveryFee: 0,
      restaurantDeliveryFee: 0,
      deliveryLeftover: 0,
      fixedPlatformFee,
      platformFee,
      restaurantAmount: Math.round(restaurantAmount * 100) / 100,
      customerTotal: Math.round(customerTotal * 100) / 100,
      subtotal: sub
    };
  }

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

// Validação de Raio de Entrega (<= 15 km) e Cálculo da Taxa e Split
app.post('/api/delivery/validate', (req, res) => {
  const { addressDetails, unitId, subtotal } = req.body || {};
  const s = addressDetails || {};
  const store = DADS_STORES[unitId] || DADS_STORES["passo-dareia"];

  let distanceKm = 2.8;
  const bClean = (s.bairro || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const rawClean = (s.bairro || '').toLowerCase().trim();

  let matchedCoord = POA_NEIGHBORHOODS[rawClean] || POA_NEIGHBORHOODS[bClean];
  if (!matchedCoord) {
    const foundKey = Object.keys(POA_NEIGHBORHOODS).find(k => rawClean.includes(k) || k.includes(rawClean));
    if (foundKey) matchedCoord = POA_NEIGHBORHOODS[foundKey];
  }

  const isPoaOrMetro = !s.cidade || /porto alegre|canoas|cachoeirinha|alvorada|gravata[ií]|viam[aã]o/i.test(s.cidade);

  if (!isPoaOrMetro) {
    distanceKm = 24.5;
  } else if (matchedCoord) {
    distanceKm = haversineKm(matchedCoord.lat, matchedCoord.lon, store.lat, store.lon);
    if (distanceKm < 0.8) distanceKm = 0.8;
  } else {
    // Estimativa segura por CEP ou município
    const cepNum = parseInt((s.cep || '91350000').replace(/\D/g, ''), 10);
    if (cepNum >= 90000000 && cepNum <= 91999999) {
      distanceKm = 2.8; // Bairros próximos POA
    } else if (cepNum >= 92000000 && cepNum <= 94999999) {
      distanceKm = 5.2; // Canoas / Cachoeirinha / Alvorada
    } else {
      distanceKm = 4.2;
    }
  }

  const maxRadius = Number(SETTINGS.delivery?.maxRadiusKm) || 15.0;
  const allowed = isPoaOrMetro && distanceKm <= maxRadius;
  const split = calculateDeliveryAndSplit(distanceKm, 'entrega', subtotal || 0);

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
// GESTOR DE RESTAURANTE ESTILO IFOOD (SETTINGS, CARDÁPIO, HORÁRIOS, RAIO, PAGAMENTOS)
// -------------------------------------------------------------
app.get('/api/admin/settings', (req, res) => {
  loadSettings();
  res.json(SETTINGS);
});

app.post('/api/admin/settings', (req, res) => {
  loadSettings();
  SETTINGS = {
    ...SETTINGS,
    ...(req.body || {})
  };
  saveSettings();
  res.json({ success: true, settings: SETTINGS });
});

app.get('/api/admin/products', (req, res) => {
  loadProducts();
  res.json(PRODUCTS);
});

app.post('/api/admin/products', (req, res) => {
  if (Array.isArray(req.body)) {
    PRODUCTS = req.body;
    saveProducts();
    return res.json({ success: true, count: PRODUCTS.length });
  }
  res.status(400).json({ success: false, error: 'Esperado array de produtos' });
});

// Configuração Mercado Pago
app.get('/api/mercadopago/config', (req, res) => {
  const token = (process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim();
  const publicKey = (process.env.MERCADOPAGO_PUBLIC_KEY || 'APP_USR-cf0ebb67-0ac2-4272-b496-a21b3b0302a4').trim();

  res.json({
    configured: Boolean(token),
    environment: token.startsWith('APP_USR-') ? 'production' : 'sandbox',
    publicKey: publicKey,
    hasPublicKey: Boolean(publicKey)
  });
});

// Criação de Pix Mercado Pago com Split de Pagamentos
app.post('/api/mercadopago/pix', async (req, res) => {
  const { customer, order, orderId } = req.body || {};
  const mode = order?.mode || (order?.pickup ? 'retirada' : 'entrega');
  const distanceKm = Number(order?.distanceKm) || Number(order?.dist) || 2.8;
  const subtotal = Number(order?.subtotal) || Number(order?.itemsTotal) || Number(order?.total) || 10.0;

  // Calcula split exato: tabela de frete + sobra + R$ 1,50 adicional da plataforma
  const split = calculateDeliveryAndSplit(distanceKm, mode, subtotal);
  const total = Number(order?.total) || split.customerTotal;
  const oid = orderId || `DAD-${Math.floor(1000 + Math.random() * 9000)}`;
  const accessToken = (process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim();

  // Gera ID numérico único de 10 dígitos compatível com Mercado Pago
  let paymentId = String(Math.floor(1000000000 + Math.random() * 9000000000));
  let qrCode = `00020126580014BR.GOV.BCB.PIX0136dadsburger51993248655@mercadopago.com520400005303986540${total.toFixed(2)}5802BR5912DADS BURGER6012PORTO ALEGRE62070503***6304E2CA`;
  let qrCodeImage = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(qrCode)}`;
  let isRealMP = false;

  if (accessToken) {
    try {
      const mpPayload = {
        transaction_amount: total,
        description: `Dad's Burger - Pedido ${oid}`,
        payment_method_id: 'pix',
        payer: {
          email: customer?.email || 'contato@dadsburger.com.br',
          first_name: customer?.name || 'Cliente',
          identification: {
            type: 'CPF',
            number: (customer?.cpf || '00000000000').replace(/\D/g, '') || '00000000000'
          }
        },
        external_reference: oid,
        metadata: {
          order_id: oid,
          subtotal: split.subtotal,
          delivery_fee: split.deliveryFee,
          restaurant_amount: split.restaurantAmount,
          platform_fee: split.platformFee,
          delivery_leftover: split.deliveryLeftover,
          fixed_platform_fee: split.fixedPlatformFee
        }
      };

      // Se houver split de marketplace, inclui application_fee para a plataforma
      if (split.platformFee > 0) {
        mpPayload.application_fee = split.platformFee;
      }

      const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': `${oid}-${Date.now()}`
        },
        body: JSON.stringify(mpPayload)
      });
      if (mpRes.ok) {
        const mpData = await mpRes.json();
        if (mpData && mpData.id) {
          paymentId = String(mpData.id);
          isRealMP = true;
          if (mpData.point_of_interaction?.transaction_data?.qr_code) {
            qrCode = mpData.point_of_interaction.transaction_data.qr_code;
          }
          if (mpData.point_of_interaction?.transaction_data?.qr_code_base64) {
            qrCodeImage = `data:image/png;base64,${mpData.point_of_interaction.transaction_data.qr_code_base64}`;
          }
        }
      }
    } catch (err) {
      console.warn('Falha na chamada da API Mercado Pago:', err);
    }
  }

  ORDERS[oid] = {
    orderId: oid,
    id: oid,
    paymentId,
    mpOrderId: paymentId,
    status: 'novo',
    total,
    subtotal: split.subtotal,
    deliveryFee: split.deliveryFee,
    fixedFee: split.fixedPlatformFee,
    fixedPlatformFee: split.fixedPlatformFee,
    split: {
      subtotal: split.subtotal,
      deliveryFee: split.deliveryFee,
      restaurantDeliveryFee: split.restaurantDeliveryFee,
      deliveryLeftover: split.deliveryLeftover,
      fixedPlatformFee: split.fixedPlatformFee,
      platformFee: split.platformFee,
      restaurantAmount: split.restaurantAmount,
      customerTotal: total
    },
    customer: customer || {},
    order: {
      ...(order || {}),
      subtotal: split.subtotal,
      deliveryFee: split.deliveryFee,
      fixedFee: split.fixedPlatformFee,
      fixedPlatformFee: split.fixedPlatformFee,
      total
    },
    unitId: order?.unitId || 'passo-dareia',
    unitName: order?.unitName || "Dad's Burger",
    paymentMethod: 'Pix',
    created_at: Date.now() / 1000,
    isNew: true,
    isRealMP
  };
  saveOrders();

  res.json({
    success: true,
    orderId: oid,
    paymentId,
    mpOrderId: paymentId,
    qrCode,
    qrCodePayload: qrCode,
    qrCodeImage,
    split,
    status: 'pending'
  });
});

// Pagamento com Cartão com Split
app.post('/api/mercadopago/card-payment', (req, res) => {
  const { card, customer, order, orderId } = req.body || {};
  const oid = orderId || `DAD-${Date.now().toString().slice(-4)}`;
  const mode = order?.mode || (order?.pickup ? 'retirada' : 'entrega');
  const distanceKm = Number(order?.distanceKm) || Number(order?.dist) || 2.8;
  const subtotal = Number(order?.subtotal) || Number(order?.itemsTotal) || Number(order?.total) || 10.0;
  const split = calculateDeliveryAndSplit(distanceKm, mode, subtotal);
  const total = Number(order?.total) || split.customerTotal;

  ORDERS[oid] = {
    orderId: oid,
    id: oid,
    status: 'approved',
    paymentMethod: 'cartao',
    cardLast4: (card?.cardNumber || '').slice(-4),
    customer,
    order: {
      ...(order || {}),
      subtotal: split.subtotal,
      deliveryFee: split.deliveryFee,
      fixedFee: split.fixedPlatformFee,
      fixedPlatformFee: split.fixedPlatformFee,
      total
    },
    total,
    subtotal: split.subtotal,
    deliveryFee: split.deliveryFee,
    fixedFee: split.fixedPlatformFee,
    fixedPlatformFee: split.fixedPlatformFee,
    split: {
      subtotal: split.subtotal,
      deliveryFee: split.deliveryFee,
      restaurantDeliveryFee: split.restaurantDeliveryFee,
      deliveryLeftover: split.deliveryLeftover,
      fixedPlatformFee: split.fixedPlatformFee,
      platformFee: split.platformFee,
      restaurantAmount: split.restaurantAmount,
      customerTotal: total
    },
    unitId: order?.unitId || 'passo-dareia',
    unitName: order?.unitName || "Dad's Burger",
    created_at: Date.now() / 1000,
    isNew: true
  };
  saveOrders();

  res.json({
    success: true,
    status: 'approved',
    orderId: oid,
    paymentId: 'CARD-' + Date.now().toString().slice(-6),
    split
  });
});

// Status do Pagamento (Verificação Real)
app.get('/api/mercadopago/payment/:id/status', async (req, res) => {
  const rawId = req.params.id;
  const accessToken = (process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim();

  if (accessToken && rawId && /^\d{8,12}$/.test(rawId)) {
    try {
      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${rawId}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      if (mpRes.ok) {
        const mpData = await mpRes.json();
        return res.json({
          status: mpData.status,
          confirmed: mpData.status === 'approved'
        });
      }
    } catch (e) {
      console.warn('Erro ao verificar status MP:', e);
    }
  }

  const ord = Object.values(ORDERS).find(o => o.paymentId === rawId || o.mpOrderId === rawId || o.orderId === rawId);
  const isApproved = ord && (ord.status === 'approved' || ord.status === 'pago' || ord.status === 'preparando' || ord.status === 'novo');
  res.json({
    status: ord ? ord.status : 'pending',
    confirmed: Boolean(isApproved)
  });
});

// Webhook de Notificações Mercado Pago (IPN / Webhooks)
app.all(['/api/mercadopago/webhook', '/api/webhook'], async (req, res) => {
  const body = req.body || {};
  const paymentId = body.data?.id || body.id || req.query?.['data.id'] || req.query?.id;
  if (paymentId) {
    const accessToken = (process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim();
    let isApproved = false;
    if (accessToken) {
      try {
        const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (mpRes.ok) {
          const mpData = await mpRes.json();
          if (mpData.status === 'approved') isApproved = true;
        }
      } catch (err) {}
    } else {
      isApproved = true;
    }

    if (isApproved) {
      for (const k of Object.keys(ORDERS)) {
        if (ORDERS[k].paymentId === String(paymentId) || ORDERS[k].mpOrderId === String(paymentId) || k === String(paymentId)) {
          ORDERS[k].status = 'novo';
          ORDERS[k].paid_at = Date.now() / 1000;
        }
      }
      saveOrders();
    }
  }
  res.status(200).json({ success: true, message: 'Webhook recebido com sucesso' });
});

// -------------------------------------------------------------
// PORTAL DO RESTAURANTE - GESTÃO DE PEDIDOS
// -------------------------------------------------------------
app.get('/api/orders', (req, res) => {
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
    if (!oid || seen.has(oid)) continue;
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

app.post('/api/orders', (req, res) => {
  const payload = req.body || {};
  const orderId = payload.orderId || `DAD-${Math.floor(1000 + Math.random() * 9000)}`;
  const rawPayId = payload.paymentId || payload.mpOrderId;
  const cleanDigits = rawPayId ? String(rawPayId).replace(/\D/g, '') : '';
  const paymentId = cleanDigits && cleanDigits.length >= 8 && cleanDigits.length <= 12
    ? cleanDigits.slice(0, 10).padEnd(10, '0')
    : String(Math.floor(1000000000 + Math.random() * 9000000000));
  const id = orderId;
  const mode = payload.mode || (payload.pickup ? 'retirada' : (payload.order?.mode || 'entrega'));
  const distanceKm = Number(payload.distanceKm) || Number(payload.order?.distanceKm) || 2.8;
  const subtotal = Number(payload.subtotal) || Number(payload.order?.subtotal) || Number(payload.total) || 10.0;
  const split = calculateDeliveryAndSplit(distanceKm, mode, subtotal);
  const total = Number(payload.total) || Number(payload.order?.total) || split.customerTotal;

  const newOrder = {
    orderId,
    id,
    paymentId,
    mpOrderId: paymentId,
    status: payload.status || 'novo',
    total,
    subtotal: split.subtotal,
    deliveryFee: split.deliveryFee,
    split: {
      subtotal: split.subtotal,
      deliveryFee: split.deliveryFee,
      restaurantDeliveryFee: split.restaurantDeliveryFee,
      deliveryLeftover: split.deliveryLeftover,
      fixedPlatformFee: split.fixedPlatformFee,
      platformFee: split.platformFee,
      restaurantAmount: split.restaurantAmount,
      customerTotal: total
    },
    customer: payload.customer || {
      name: payload.name || 'Cliente',
      phone: payload.phone || '',
      cpf: payload.cpf || ''
    },
    order: {
      items: payload.items || payload.order?.items || [],
      subtotal: split.subtotal,
      deliveryFee: split.deliveryFee,
      total,
      mode,
      address: payload.address || payload.addr || payload.order?.address || '',
      ref: payload.ref || payload.order?.ref || '',
      unitId: payload.unitId || payload.order?.unitId || 'passo-dareia'
    },
    unitId: payload.unitId || payload.order?.unitId || 'passo-dareia',
    unitName: payload.unitName || payload.order?.unitName || "Passo d'Areia",
    paymentMethod: payload.paymentMethod || payload.payment || 'pix',
    created_at: payload.created_at || (Date.now() / 1000),
    isNew: true
  };

  ORDERS[orderId] = newOrder;
  saveOrders();

  res.status(201).json({ success: true, order: newOrder });
});

app.patch('/api/orders/:id', (req, res) => {
  const rawId = decodeURIComponent(req.params.id || '').trim();
  const id = rawId.replace(/^#/, '');
  const updates = req.body || {};

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
    (numId && numId.length >= 3 && ORDERS[k]?.orderId?.replace(/\D/g, '') === numId) ||
    (numId && numId.length >= 4 && ORDERS[k]?.paymentId?.includes(numId))
  );

  if (matchingKeys.length === 0) {
    return res.status(404).json({ success: false, error: 'Pedido não encontrado' });
  }

  let updatedOrder = null;
  for (const k of matchingKeys) {
    ORDERS[k] = {
      ...ORDERS[k],
      ...updates,
      status: updates.status || ORDERS[k].status,
      updated_at: Date.now() / 1000
    };
    updatedOrder = ORDERS[k];
  }

  if (updatedOrder && updatedOrder.orderId) {
    ORDERS[updatedOrder.orderId] = updatedOrder;
  }

  saveOrders();

  res.json({ success: true, order: updatedOrder });
});

// Portal do Restaurante / Admin (Desktop)
app.get(['/admin', '/admin/*'], (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Fallback SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🍔 Dad's Burger App rodando em http://localhost:${PORT}`);
});
