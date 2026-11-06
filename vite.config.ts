import path from 'path';
import { defineConfig, Plugin } from 'vite';

function apiMockPlugin(): Plugin {
  return {
    name: 'api-mock-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
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

        if (url.startsWith('/api/cep/')) {
          const cep = url.replace('/api/cep/', '').replace(/\D/g, '');
          res.end(JSON.stringify({
            valid: true,
            cep,
            logradouro: 'Rua Sapé',
            bairro: "Passo d'Areia",
            localidade: 'Porto Alegre',
            uf: 'RS'
          }));
          return;
        }

        if (url === '/api/delivery/validate') {
          res.end(JSON.stringify({
            valid: true,
            allowed: true,
            distanceKm: 3.8,
            unitId: 'passo-dareia',
            unitName: "Dad's Burger – Passo d'Areia"
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
          const orderId = `DAD-${Date.now().toString().slice(-4)}`;
          const mockQr = '00020126580014BR.GOV.BCB.PIX0136dadsburger51993248655@mercadopago.com520400005303986540510.005802BR5912DADS BURGER6012PORTO ALEGRE62070503***6304E2CA';
          res.end(JSON.stringify({
            success: true,
            orderId,
            paymentId: 'mock_pix_' + Date.now(),
            qrCode: mockQr,
            qrCodePayload: mockQr,
            qrCodeImage: `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(mockQr)}`,
            status: 'pending',
            isMock: true
          }));
          return;
        }

        if (url === '/api/mercadopago/card-payment' || url === '/api/mercadopago/simulate-payment') {
          res.end(JSON.stringify({
            success: true,
            status: 'approved',
            paymentId: 'PAY-' + Date.now()
          }));
          return;
        }

        res.end(JSON.stringify({ success: true }));
      });
    }
  };
}

export default defineConfig(() => {
  return {
    plugins: [apiMockPlugin()],
    server: {
      port: 3000,
      host: '0.0.0.0',
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
