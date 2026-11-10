import path from 'path';
import { defineConfig, loadEnv, Plugin } from 'vite';

import fs from 'fs';

const ORDERS_FILE = path.resolve(process.cwd(), 'orders.json');
let ORDERS: Record<string, any> = {};
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

function apiMockPlugin(): Plugin {
  return {
    name: 'api-mock-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url || '';
        if (rawUrl === '/admin' || rawUrl === '/admin/' || rawUrl.startsWith('/admin?')) {
          req.url = '/admin.html' + (rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?')) : '');
          return next();
        }

        const url = req.url || '';
        if (!url.startsWith('/api/')) return next();

        // 1. Tenta proxy para o backend local (porta 3333) se estiver rodando
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 800);
          const proxyRes = await fetch(`http://127.0.0.1:3333${url}`, {
            method: req.method,
            headers: req.headers as any,
            body: ['POST', 'PUT', 'PATCH'].includes(req.method || '') ? (req as any) : undefined,
            duplex: 'half',
            signal: controller.signal
          } as any);
          clearTimeout(timeoutId);
          res.statusCode = proxyRes.status;
          proxyRes.headers.forEach((val, key) => res.setHeader(key, val));
          const buf = await proxyRes.arrayBuffer();
          res.end(Buffer.from(buf));
          return;
        } catch {
          // Servidor backend offline (ambiente Google AI Studio) -> responde com Mock JSON
        }

        res.setHeader('Content-Type', 'application/json');

        // Ler corpo em requisições POST/PATCH
        let reqBody: any = null;
        if (['POST', 'PATCH', 'PUT'].includes(req.method || '')) {
          try {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
            }
            const rawBody = Buffer.concat(chunks).toString('utf-8');
            if (rawBody) reqBody = JSON.parse(rawBody);
          } catch {
            reqBody = {};
          }
        }

        // Endpoint GET /api/orders
        if (url.startsWith('/api/orders') && req.method === 'GET') {
          if (fs.existsSync(ORDERS_FILE)) {
            try {
              ORDERS = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
            } catch {}
          }
          const u = new URL(url, 'http://localhost:3000');
          const unitId = u.searchParams.get('unitId');
          const status = u.searchParams.get('status');

          const seen = new Set();
          const deduped: any[] = [];
          for (const ord of Object.values(ORDERS || {})) {
            const oid = (ord as any).orderId || (ord as any).id;
            if (!oid || seen.has(oid)) continue;
            seen.add(oid);
            deduped.push(ord);
          }

          let list = deduped;
          if (unitId && unitId !== 'todas') {
            list = list.filter((o: any) => o.unitId === unitId || o.order?.unitId === unitId);
          }
          if (status && status !== 'todos') {
            list = list.filter((o: any) => (o.status || '').toLowerCase() === status.toLowerCase());
          }
          list.sort((a: any, b: any) => (Number(b.created_at) || 0) - (Number(a.created_at) || 0));
          res.end(JSON.stringify({ success: true, count: list.length, orders: list }));
          return;
        }

        // Endpoint POST /api/orders (Criar pedido manual / teste / WhatsApp)
        if (url === '/api/orders' && req.method === 'POST') {
          const payload = reqBody || {};
          const orderId = payload.orderId || `DAD-${Math.floor(1000 + Math.random() * 9000)}`;
          const rawPayId = payload.paymentId || payload.mpOrderId;
          const cleanDigits = rawPayId ? String(rawPayId).replace(/\D/g, '') : '';
          const paymentId = cleanDigits && cleanDigits.length >= 8 && cleanDigits.length <= 12
            ? cleanDigits.slice(0, 10).padEnd(10, '0')
            : String(Math.floor(1000000000 + Math.random() * 9000000000));
          const id = orderId;

          const newOrder = {
            orderId,
            id,
            paymentId,
            mpOrderId: paymentId,
            status: payload.status || 'novo',
            total: Number(payload.total) || Number(payload.order?.total) || 0,
            customer: payload.customer || {
              name: payload.name || 'Cliente',
              phone: payload.phone || '',
              cpf: payload.cpf || ''
            },
            order: payload.order || {
              items: payload.items || [],
              total: Number(payload.total) || 0,
              mode: payload.mode || (payload.pickup ? 'retirada' : 'entrega'),
              address: payload.address || payload.addr || '',
              ref: payload.ref || '',
              unitId: payload.unitId || 'passo-dareia'
            },
            unitId: payload.unitId || payload.order?.unitId || 'passo-dareia',
            unitName: payload.unitName || payload.order?.unitName || "Passo d'Areia",
            paymentMethod: payload.paymentMethod || payload.payment || 'pix',
            created_at: payload.created_at || (Date.now() / 1000),
            isNew: true
          };

          ORDERS[orderId] = newOrder;
          saveOrders();
          res.statusCode = 201;
          res.end(JSON.stringify({ success: true, order: newOrder }));
          return;
        }

        // Endpoint PATCH /api/orders/:id (Atualizar status)
        if (url.startsWith('/api/orders/') && req.method === 'PATCH') {
          const rawId = decodeURIComponent(url.replace('/api/orders/', '').split('?')[0]).trim();
          const id = rawId.replace(/^#/, '');
          const updates = reqBody || {};

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
            res.statusCode = 404;
            res.end(JSON.stringify({ success: false, error: 'Pedido não encontrado' }));
            return;
          }

          let updatedOrder: any = null;
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
          res.end(JSON.stringify({ success: true, order: updatedOrder }));
          return;
        }

        if (url.startsWith('/api/cep/')) {
          const cep = url.replace('/api/cep/', '').split('?')[0].replace(/\D/g, '');
          if (cep.length !== 8) {
            res.statusCode = 400;
            res.end(JSON.stringify({ valid: false, error: 'CEP deve ter 8 dígitos' }));
            return;
          }

          try {
            const viaRes = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
            if (viaRes.ok) {
              const vData: any = await viaRes.json();
              if (vData && !vData.erro) {
                res.end(JSON.stringify({
                  valid: true,
                  cep,
                  logradouro: vData.logradouro || '',
                  bairro: vData.bairro || '',
                  localidade: vData.localidade || 'Porto Alegre',
                  uf: vData.uf || 'RS'
                }));
                return;
              }
              if (vData && vData.erro) {
                res.end(JSON.stringify({ valid: false, error: 'CEP não encontrado' }));
                return;
              }
            }
          } catch {}

          try {
            const brRes = await fetch(`https://brasilapi.com.br/api/cep/v2/${cep}`);
            if (brRes.ok) {
              const bData: any = await brRes.json();
              if (bData && bData.cep) {
                res.end(JSON.stringify({
                  valid: true,
                  cep,
                  logradouro: bData.street || '',
                  bairro: bData.neighborhood || '',
                  localidade: bData.city || 'Porto Alegre',
                  uf: bData.state || 'RS'
                }));
                return;
              }
            }
          } catch {}

          res.end(JSON.stringify({ valid: false, error: 'CEP não encontrado' }));
          return;
        }

        if (url === '/api/delivery/validate') {
          const s = reqBody?.addressDetails || {};
          const unitId = reqBody?.unitId || 'passo-dareia';

          const DADS_STORES: Record<string, { id: string; name: string; lat: number; lon: number }> = {
            "passo-dareia": { id: "passo-dareia", name: "Passo d'Areia (Zona Norte)", lat: -30.01758, lon: -51.15570 },
            "moinhos": { id: "moinhos", name: "Moinhos / Rio Branco", lat: -30.02987, lon: -51.20428 },
            "partenon": { id: "partenon", name: "Partenon (Zona Leste)", lat: -30.06190, lon: -51.17366 },
            "canoas-gracas": { id: "canoas-gracas", name: "Nossa Sra. das Graças (Canoas)", lat: -29.92756, lon: -51.17546 },
            "canoas-guajuviras": { id: "canoas-guajuviras", name: "Guajuviras (Canoas)", lat: -29.89663, lon: -51.13785 },
            "cachoeirinha": { id: "cachoeirinha", name: "Vila Vista Alegre (Cachoeirinha)", lat: -29.92380, lon: -51.07789 }
          };

          const POA_NEIGHBORHOODS: Record<string, { lat: number; lon: number }> = {
            "passo d'areia": { lat: -30.01758, lon: -51.15570 },
            "passo dareia": { lat: -30.01758, lon: -51.15570 },
            "passo de areia": { lat: -30.01758, lon: -51.15570 },
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
            "ipanema": { lat: -30.13000, lon: -51.22500 },
            "tristeza": { lat: -30.11200, lon: -51.25300 },
            "azambuja": { lat: -30.06200, lon: -51.21200 },
            "azenha": { lat: -30.05400, lon: -51.21500 },
            "praia de belas": { lat: -30.05000, lon: -51.22900 },
            "navegantes": { lat: -30.00500, lon: -51.20100 },
            "humaita": { lat: -29.98200, lon: -51.18200 },
            "anchieta": { lat: -29.97200, lon: -51.16500 },
            "itu sabara": { lat: -30.02500, lon: -51.13500 },
            "jardim itu": { lat: -30.02200, lon: -51.13800 },
            "jardim sabara": { lat: -30.03100, lon: -51.13200 },
            "morro santana": { lat: -30.03400, lon: -51.11800 },
            "protasio alves": { lat: -30.03600, lon: -51.12500 },
            "santo antonio": { lat: -30.05800, lon: -51.19800 },
            "gloria": { lat: -30.07200, lon: -51.18800 },
            "teresopolis": { lat: -30.08200, lon: -51.20200 },
            "nonoai": { lat: -30.08800, lon: -51.21500 },
            "medianeira": { lat: -30.06400, lon: -51.20800 }
          };

          const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
            const R = 6371;
            const toRad = (x: number) => (x * Math.PI) / 180;
            const dLat = toRad(lat2 - lat1);
            const dLon = toRad(lon2 - lon1);
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return Math.round(R * c * 10) / 10;
          };

          const store = DADS_STORES[unitId] || DADS_STORES["passo-dareia"];
          const bClean = (s.bairro || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
          const rawClean = (s.bairro || '').toLowerCase().trim();

          let matchedCoord = POA_NEIGHBORHOODS[rawClean] || POA_NEIGHBORHOODS[bClean];
          if (!matchedCoord && bClean) {
            const foundKey = Object.keys(POA_NEIGHBORHOODS).find(k => bClean.includes(k) || k.includes(bClean));
            if (foundKey) matchedCoord = POA_NEIGHBORHOODS[foundKey];
          }

          // Tenta obter coordenadas exatas via BrasilAPI caso o bairro não esteja mapeado
          const cleanCep = (s.cep || '').replace(/\D/g, '');
          if (!matchedCoord && cleanCep.length === 8) {
            try {
              const brRes = await fetch(`https://brasilapi.com.br/api/cep/v2/${cleanCep}`);
              if (brRes.ok) {
                const bData: any = await brRes.json();
                const lat = parseFloat(bData?.location?.coordinates?.latitude);
                const lon = parseFloat(bData?.location?.coordinates?.longitude);
                if (!isNaN(lat) && !isNaN(lon)) {
                  matchedCoord = { lat, lon };
                }
              }
            } catch {}
          }

          const isPoaOrMetro = !s.cidade || /porto alegre|canoas|cachoeirinha|alvorada|gravata[ií]|viam[aã]o|esteio|sapucaia|eldorado|gua[ií]ba/i.test(s.cidade);
          let distanceKm = 2.8;

          if (!isPoaOrMetro) {
            distanceKm = 24.5;
          } else if (matchedCoord) {
            distanceKm = haversineKm(matchedCoord.lat, matchedCoord.lon, store.lat, store.lon);
            if (distanceKm < 0.8) distanceKm = 0.8;
          } else {
            const cepNum = parseInt(cleanCep || '91350000', 10);
            if (cepNum >= 90000000 && cepNum <= 91999999) {
              distanceKm = 3.4;
            } else if (cepNum >= 92000000 && cepNum <= 94999999) {
              distanceKm = 5.2;
            } else {
              distanceKm = 4.5;
            }
          }

          const allowed = isPoaOrMetro && distanceKm <= 15.0;

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
              allowed: minD <= 15.0
            };
          }

          // Frete por tabela
          let deliveryFee = 15.50;
          let restaurantDeliveryFee = 14.50;
          let deliveryLeftover = 1.00;
          let tierLabel = 'Acima de 6 km';

          if (distanceKm <= 3.0) {
            deliveryFee = 7.50;
            restaurantDeliveryFee = 6.50;
            deliveryLeftover = 1.00;
            tierLabel = 'Até 3 km';
          } else if (distanceKm <= 6.0) {
            deliveryFee = 11.50;
            restaurantDeliveryFee = 9.00;
            deliveryLeftover = 2.50;
            tierLabel = '3 km a 6 km';
          }

          const fixedPlatformFee = 1.50;
          const platformFee = deliveryLeftover + fixedPlatformFee;

          res.end(JSON.stringify({
            valid: true,
            allowed,
            distanceKm,
            deliveryFee,
            restaurantDeliveryFee,
            deliveryLeftover,
            fixedPlatformFee,
            platformFee,
            tierLabel,
            split: {
              mode: 'entrega',
              distanceKm,
              tierLabel,
              deliveryFee,
              restaurantDeliveryFee,
              deliveryLeftover,
              fixedPlatformFee,
              platformFee
            },
            unitId: store.id,
            unitName: store.name,
            closestUnit
          }));
          return;
        }

        if (url === '/api/mercadopago/config') {
          res.end(JSON.stringify({
            publicKey: 'APP_USR-cf0ebb67-0ac2-4272-b496-a21b3b0302a4',
            environment: 'production'
          }));
          return;
        }

        if (url === '/api/mercadopago/pix') {
          const accessToken = (process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim();
          const orderId = reqBody?.orderId || `DAD-${Math.floor(1000 + Math.random() * 9000)}`;
          const mode = reqBody?.order?.mode || (reqBody?.order?.pickup ? 'retirada' : 'entrega');
          const distanceKm = Number(reqBody?.order?.distanceKm) || 2.8;
          const subtotal = Number(reqBody?.order?.subtotal) || Number(reqBody?.order?.total || reqBody?.total || 10.0);

          let deliveryFee = 0;
          let restaurantDeliveryFee = 0;
          let deliveryLeftover = 0;
          let fixedPlatformFee = 1.50;
          let platformFee = 1.50;

          if (mode !== 'retirada') {
            if (distanceKm <= 3.0) {
              deliveryFee = 7.50;
              restaurantDeliveryFee = 6.50;
              deliveryLeftover = 1.00;
            } else if (distanceKm <= 6.0) {
              deliveryFee = 11.50;
              restaurantDeliveryFee = 9.00;
              deliveryLeftover = 2.50;
            } else {
              deliveryFee = 15.50;
              restaurantDeliveryFee = 14.50;
              deliveryLeftover = 1.00;
            }
            platformFee = deliveryLeftover + fixedPlatformFee;
          }

          const total = Math.round((mode === 'retirada' ? subtotal : (subtotal + deliveryFee)) * 100) / 100;
          const restaurantAmount = Math.round(Math.max(0, total - platformFee) * 100) / 100;

          const split = {
            mode,
            distanceKm: mode === 'retirada' ? 0 : distanceKm,
            deliveryFee,
            restaurantDeliveryFee,
            deliveryLeftover,
            fixedPlatformFee,
            platformFee,
            restaurantAmount,
            customerTotal: total,
            subtotal
          };

          // Gera ID numérico único de 10 dígitos compatível com Mercado Pago
          let paymentId = String(Math.floor(1000000000 + Math.random() * 9000000000));
          let qrCode = '00020126580014BR.GOV.BCB.PIX0136dadsburger51993248655@mercadopago.com520400005303986540' + total.toFixed(2) + '5802BR5912DADS BURGER6012PORTO ALEGRE62070503***6304E2CA';
          let qrCodeImage = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(qrCode)}`;
          let isRealMP = false;

          if (accessToken) {
            try {
              const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'Content-Type': 'application/json',
                  'X-Idempotency-Key': `${orderId}-${Date.now()}`
                },
                body: JSON.stringify({
                  transaction_amount: total,
                  description: `Dad's Burger - Pedido ${orderId}`,
                  payment_method_id: 'pix',
                  application_fee: platformFee > 0 ? platformFee : undefined,
                  payer: {
                    email: reqBody?.customer?.email || 'contato@dadsburger.com.br',
                    first_name: reqBody?.customer?.name || 'Cliente',
                    identification: {
                      type: 'CPF',
                      number: (reqBody?.customer?.cpf || '00000000000').replace(/\D/g, '') || '00000000000'
                    }
                  },
                  external_reference: orderId,
                  metadata: {
                    order_id: orderId,
                    subtotal,
                    delivery_fee: deliveryFee,
                    restaurant_amount: restaurantAmount,
                    platform_fee: platformFee,
                    delivery_leftover: deliveryLeftover,
                    fixed_platform_fee: fixedPlatformFee
                  }
                })
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

          if (reqBody) {
            ORDERS[orderId] = {
              orderId,
              id: orderId,
              paymentId,
              mpOrderId: paymentId,
              status: 'novo',
              total,
              subtotal,
              deliveryFee,
              fixedFee: fixedPlatformFee,
              fixedPlatformFee,
              split,
              customer: reqBody.customer || { name: 'Cliente', phone: '' },
              order: {
                ...(reqBody.order || { items: [], total, mode: 'entrega' }),
                subtotal,
                deliveryFee,
                fixedFee: fixedPlatformFee,
                fixedPlatformFee,
                total
              },
              unitId: reqBody.order?.unitId || reqBody.unitId || 'passo-dareia',
              unitName: reqBody.order?.unitName || reqBody.unitName || "Dad's Burger",
              paymentMethod: 'Pix',
              created_at: Date.now() / 1000,
              isNew: true,
              isRealMP
            };
            saveOrders();
          }

          res.end(JSON.stringify({
            success: true,
            orderId,
            paymentId,
            mpOrderId: paymentId,
            qrCode,
            qrCodePayload: qrCode,
            qrCodeImage,
            split,
            status: 'pending'
          }));
          return;
        }

        if (url === '/api/mercadopago/card-payment') {
          const orderId = reqBody?.orderId || `DAD-${Date.now().toString().slice(-4)}`;
          const paymentId = 'PAY-' + Date.now();
          const mode = reqBody?.order?.mode || (reqBody?.order?.pickup ? 'retirada' : 'entrega');
          const distanceKm = Number(reqBody?.order?.distanceKm) || 2.8;
          const subtotal = Number(reqBody?.order?.subtotal) || Number(reqBody?.order?.total || reqBody?.total || 10.0);

          let deliveryFee = 0;
          let restaurantDeliveryFee = 0;
          let deliveryLeftover = 0;
          let fixedPlatformFee = 1.50;
          let platformFee = 1.50;

          if (mode !== 'retirada') {
            if (distanceKm <= 3.0) {
              deliveryFee = 7.50;
              restaurantDeliveryFee = 6.50;
              deliveryLeftover = 1.00;
            } else if (distanceKm <= 6.0) {
              deliveryFee = 11.50;
              restaurantDeliveryFee = 9.00;
              deliveryLeftover = 2.50;
            } else {
              deliveryFee = 15.50;
              restaurantDeliveryFee = 14.50;
              deliveryLeftover = 1.00;
            }
            platformFee = deliveryLeftover + fixedPlatformFee;
          }

          const total = Math.round((mode === 'retirada' ? subtotal : (subtotal + deliveryFee)) * 100) / 100;
          const restaurantAmount = Math.round(Math.max(0, total - platformFee) * 100) / 100;

          const split = {
            mode,
            distanceKm: mode === 'retirada' ? 0 : distanceKm,
            deliveryFee,
            restaurantDeliveryFee,
            deliveryLeftover,
            fixedPlatformFee,
            platformFee,
            restaurantAmount,
            customerTotal: total,
            subtotal
          };

          if (reqBody) {
            ORDERS[orderId] = {
              orderId,
              id: orderId,
              paymentId,
              status: 'approved',
              total,
              subtotal,
              deliveryFee,
              fixedFee: fixedPlatformFee,
              fixedPlatformFee,
              split,
              customer: reqBody.customer || {},
              order: {
                ...(reqBody.order || {}),
                subtotal,
                deliveryFee,
                fixedFee: fixedPlatformFee,
                fixedPlatformFee,
                total
              },
              unitId: reqBody.order?.unitId || 'passo-dareia',
              paymentMethod: 'cartao',
              created_at: Date.now() / 1000,
              isNew: true
            };
            saveOrders();
          }

          res.end(JSON.stringify({
            success: true,
            status: 'approved',
            orderId,
            paymentId,
            split
          }));
          return;
        }

        if (url.includes('/status')) {
          const rawId = decodeURIComponent(url.replace('/api/mercadopago/payment/', '').replace('/status', '').split('?')[0]);
          const accessToken = (process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim();

          if (accessToken && rawId && /^\d{8,12}$/.test(rawId)) {
            try {
              const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${rawId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
              });
              if (mpRes.ok) {
                const mpData = await mpRes.json();
                res.end(JSON.stringify({
                  status: mpData.status,
                  confirmed: mpData.status === 'approved'
                }));
                return;
              }
            } catch {}
          }

          const ord = Object.values(ORDERS).find((o: any) => o.paymentId === rawId || o.mpOrderId === rawId || o.orderId === rawId);
          const isApproved = ord && (ord.status === 'approved' || ord.status === 'pago' || ord.status === 'preparando' || ord.status === 'novo');
          res.end(JSON.stringify({
            status: ord ? ord.status : 'pending',
            confirmed: Boolean(isApproved)
          }));
          return;
        }

        // Webhook de Notificações Mercado Pago (IPN / Webhooks)
        if (url.startsWith('/api/mercadopago/webhook') || url.startsWith('/api/webhook')) {
          res.statusCode = 200;
          res.end(JSON.stringify({ success: true, message: 'Webhook recebido com sucesso' }));
          return;
        }

        res.end(JSON.stringify({ success: true }));
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  Object.assign(process.env, env);

  return {
    plugins: [apiMockPlugin()],
    server: {
      port: 3000,
      host: '0.0.0.0',
      allowedHosts: true,
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          admin: path.resolve(__dirname, 'admin.html')
        }
      }
    }
  };
});
