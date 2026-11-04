import { CartItem, DeliveryMode, OrderPayload, ReservationPayload } from '../types/menu';

export function calculateSubtotal(items: CartItem[]): number {
  return items.reduce((acc, curr) => acc + (curr.item.price * curr.quantity), 0);
}

export function calculateDeliveryFee(mode: DeliveryMode): number {
  return mode === 'entrega' ? 0.00 : 0.00; // Free delivery promo or can be configured
}

export function calculateTotal(items: CartItem[], mode: DeliveryMode): number {
  return calculateSubtotal(items) + calculateDeliveryFee(mode);
}

export function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function parseMoneyInput(text: string): number {
  if (!text) return 0;
  const clean = text
    .replace(/[^\d,.]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

export function validateChange(changeInput: string, total: number): { valid: boolean; value: number; error?: string } {
  const trimmed = changeInput.trim();
  if (!trimmed) {
    return { valid: true, value: 0 };
  }
  const parsed = parseMoneyInput(trimmed);
  if (parsed <= 0) {
    return { valid: false, value: 0, error: 'Valor inválido para o troco.' };
  }
  if (parsed <= total) {
    return {
      valid: false,
      value: parsed,
      error: `O valor do troco (${formatBRL(parsed)}) deve ser maior que o total (${formatBRL(total)}).`
    };
  }
  return { valid: true, value: parsed };
}

export function buildWhatsAppOrderMessage(payload: OrderPayload): string {
  const lines = [
    `🍔 *NOVO PEDIDO - DAD'S BURGER* 🍔`,
    `--------------------------------`,
    `*ITENS DO PEDIDO:*`
  ];

  payload.items.forEach((ci, idx) => {
    const itemSubtotal = ci.item.price * ci.quantity;
    lines.push(`${idx + 1}. ${ci.quantity}x ${ci.item.name} — ${formatBRL(itemSubtotal)}`);
  });

  lines.push(`--------------------------------`);
  lines.push(`*Subtotal:* ${formatBRL(payload.subtotal)}`);
  lines.push(`*Taxa de entrega:* ${payload.mode === 'entrega' ? 'Grátis' : 'Balcão / Retirada'}`);
  lines.push(`*TOTAL:* ${formatBRL(payload.total)}`);
  lines.push(`--------------------------------`);

  if (payload.mode === 'entrega') {
    lines.push(`📍 *TIPO:* Entrega em domicílio`);
    lines.push(`🏠 *Endereço:* ${payload.deliveryAddress}`);
    if (payload.deliveryReference && payload.deliveryReference.trim()) {
      lines.push(`📌 *Ref / Compl:* ${payload.deliveryReference.trim()}`);
    }
  } else {
    lines.push(`🛍️ *TIPO:* Retirada no balcão`);
    lines.push(`🏪 *Local:* Rua Sapé, 947 - Passo d'Areia`);
  }

  lines.push(`--------------------------------`);
  if (payload.paymentMethod === 'pix') {
    lines.push(`💳 *Pagamento:* PIX (Aguardando chave)`);
  } else if (payload.paymentMethod === 'cartao') {
    lines.push(`💳 *Pagamento:* Cartão (Levar maquininha)`);
  } else if (payload.paymentMethod === 'dinheiro') {
    if (payload.changeFor && payload.changeFor > payload.total) {
      const trocoDevolver = payload.changeFor - payload.total;
      lines.push(`💵 *Pagamento:* Dinheiro (Troco para ${formatBRL(payload.changeFor)} -> devolver ${formatBRL(trocoDevolver)})`);
    } else {
      lines.push(`💵 *Pagamento:* Dinheiro (Sem troco)`);
    }
  }

  if (payload.customerName && payload.customerName.trim()) {
    lines.push(`👤 *Cliente:* ${payload.customerName.trim()}`);
  }

  lines.push(`--------------------------------`);
  lines.push(`Obrigado pela preferência! Aguardo confirmação.`);

  return lines.join('\n');
}

export function buildWhatsAppReservationMessage(payload: ReservationPayload): string {
  const parts = payload.date.split('-');
  const formattedDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : payload.date;

  const lines = [
    `📅 *NOVA RESERVA DE MESA - DAD'S BURGER*`,
    `--------------------------------`,
    `👤 *Nome:* ${payload.name}`,
    `📆 *Data:* ${formattedDate}`,
    `⏰ *Horário:* ${payload.time}`,
    `👥 *Pessoas:* ${payload.people}`
  ];

  if (payload.notes && payload.notes.trim()) {
    lines.push(`📝 *Observações:* ${payload.notes.trim()}`);
  }

  lines.push(`--------------------------------`);
  lines.push(`Por favor, confirmem minha reserva. Obrigado!`);

  return lines.join('\n');
}

export function buildKitchenComanda(payload: OrderPayload, orderNumber = 101): string {
  const dateStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const lines = [
    `==============================`,
    `   DAD'S BURGER - COMANDA #${orderNumber}`,
    `   HORA: ${dateStr}`,
    `==============================`,
    `TIPO: ${payload.mode.toUpperCase()}`,
    `CLIENTE: ${payload.customerName || 'Cliente WhatsApp'}`,
    payload.mode === 'entrega' ? `END: ${payload.deliveryAddress}` : `RETIRADA NO BALCÃO`,
    payload.deliveryReference ? `REF: ${payload.deliveryReference}` : '',
    `------------------------------`,
    `QTD  ITEM`
  ].filter(Boolean);

  payload.items.forEach(ci => {
    lines.push(`${String(ci.quantity).padStart(2, ' ')}x  ${ci.item.name}`);
  });

  lines.push(`------------------------------`);
  lines.push(`TOTAL: ${formatBRL(payload.total)}`);
  lines.push(`PAGTO: ${payload.paymentMethod.toUpperCase()}`);
  if (payload.paymentMethod === 'dinheiro' && payload.changeFor && payload.changeFor > payload.total) {
    lines.push(`TROCO P/: ${formatBRL(payload.changeFor)} (LEV: ${formatBRL(payload.changeFor - payload.total)})`);
  }
  lines.push(`==============================`);

  return lines.join('\n');
}

export function isStoreOpen(now = new Date()): { isOpen: boolean; statusText: string } {
  const day = now.getDay(); // 0 is Sunday
  const hour = now.getHours();
  const minute = now.getMinutes();
  const currentMinutes = hour * 60 + minute;

  // Dad's Burger typical burger schedule:
  // Terça a Domingo das 18:00 às 23:30 (ou fechado às segundas)
  // Let's make it standard 18:00 to 23:45, open on weekends, closed Mondays or open every day from 18h to 23h30
  if (day === 1) { // Segunda-feira
    if (currentMinutes >= 18 * 60 && currentMinutes <= 23 * 60 + 30) {
      return { isOpen: true, statusText: "Aberto agora · fecha às 23:30" };
    }
    return { isOpen: false, statusText: "Fechado agora · abre hoje às 18:00" };
  }

  if (currentMinutes >= 18 * 60 && currentMinutes <= 23 * 60 + 45) {
    return { isOpen: true, statusText: "Aberto agora · fecha às 23:45" };
  }

  if (currentMinutes < 18 * 60) {
    return { isOpen: false, statusText: "Fechado agora · abre às 18:00" };
  }

  return { isOpen: false, statusText: "Fechado agora · abre amanhã às 18:00" };
}
