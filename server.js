import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3333;

app.use(express.json());
app.use(express.static(__dirname));

const ORDERS_FILE = path.join(__dirname, 'orders.json');

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
    if (!response.ok) throw new Error('Falha no ViaCEP');
    const data = await response.json();
    if (data.erro) {
      return res.json({ valid: false, error: 'CEP não encontrado' });
    }
    res.json({
      valid: true,
      cep: clean,
      logradouro: data.logradouro || '',
      bairro: data.bairro || '',
      localidade: data.localidade || 'Porto Alegre',
      uf: data.uf || 'RS'
    });
  } catch (e) {
    res.json({
      valid: true,
      cep: clean,
      logradouro: '',
      bairro: "Passo d'Areia",
      localidade: 'Porto Alegre',
      uf: 'RS'
    });
  }
});

// Validação de Raio de Entrega (<= 15 km)
app.post('/api/delivery/validate', (req, res) => {
  const { addressDetails, unitId } = req.body || {};
  const s = addressDetails || {};
  const store = DADS_STORES[unitId] || DADS_STORES["passo-dareia"];

  const isPoaOrMetro = !s.cidade || /porto alegre|canoas|cachoeirinha|alvorada|gravata[ií]|viam[aã]o/i.test(s.cidade);
  const distanceKm = isPoaOrMetro ? 4.2 : 24.5;
  const allowed = isPoaOrMetro && distanceKm <= 15.0;

  res.json({
    valid: true,
    allowed,
    distanceKm,
    unitId: store.id,
    unitName: store.name,
    closestUnit: {
      id: store.id,
      name: store.name,
      distanceKm,
      allowed
    }
  });
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

// Criação de Pix Mercado Pago
app.post('/api/mercadopago/pix', (req, res) => {
  const { customer, order, orderId } = req.body || {};
  const total = order?.total || 10.0;
  const oid = orderId || `DAD-${Date.now().toString().slice(-4)}`;

  const mockQr = `00020126580014BR.GOV.BCB.PIX0136dadsburger51993248655@mercadopago.com520400005303986540${total.toFixed(2)}5802BR5912DADS BURGER6012PORTO ALEGRE62070503***6304E2CA`;
  const paymentId = 'pay_' + Date.now();

  ORDERS[oid] = {
    orderId: oid,
    paymentId,
    status: 'pending',
    total,
    customer,
    order
  };
  saveOrders();

  res.json({
    success: true,
    orderId: oid,
    paymentId,
    qrCode: mockQr,
    qrCodePayload: mockQr,
    qrCodeImage: `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(mockQr)}`,
    status: 'pending',
    isMock: true
  });
});

// Simulação de Pagamento
app.post('/api/mercadopago/simulate-payment', (req, res) => {
  res.json({ success: true, status: 'approved' });
});

// Pagamento com Cartão
app.post('/api/mercadopago/card-payment', (req, res) => {
  const { card, customer, order, orderId } = req.body || {};
  const oid = orderId || `DAD-${Date.now().toString().slice(-4)}`;

  ORDERS[oid] = {
    orderId: oid,
    status: 'approved',
    paymentMethod: 'cartao',
    cardLast4: (card?.cardNumber || '').slice(-4),
    customer,
    order
  };
  saveOrders();

  res.json({
    success: true,
    status: 'approved',
    orderId: oid,
    paymentId: 'CARD-' + Date.now().toString().slice(-6)
  });
});

// Status do Pagamento
app.get('/api/mercadopago/payment/:id/status', (req, res) => {
  res.json({ status: 'approved', confirmed: true });
});

// Fallback SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🍔 Dad's Burger App rodando em http://localhost:${PORT}`);
});
