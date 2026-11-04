import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSubtotal,
  calculateTotal,
  validateChange,
  formatBRL,
  buildWhatsAppOrderMessage,
  buildKitchenComanda
} from './orderCalculator';
import { CartItem, MenuItem } from '../types/menu';

const sampleBurger: MenuItem = {
  id: 'b1',
  cat: 'Burgers Artesanais',
  name: 'Big Bacon',
  desc: 'Blend artesanal 100g com bacon',
  price: 49.90,
  img: 'test.jpg'
};

const sampleDrink: MenuItem = {
  id: 'd1',
  cat: 'Bebidas',
  name: 'Coca-Cola 350ml',
  desc: 'Lata gelada',
  price: 9.90,
  img: 'coca.jpg'
};

test('calculateSubtotal sums up item prices multiplied by quantities correctly', () => {
  const items: CartItem[] = [
    { item: sampleBurger, quantity: 2 }, // 49.90 * 2 = 99.80
    { item: sampleDrink, quantity: 1 }   // 9.90 * 1 = 9.90
  ];
  const subtotal = calculateSubtotal(items);
  assert.equal(Math.round(subtotal * 100) / 100, 109.70);
});

test('calculateTotal correctly calculates total for delivery and pickup', () => {
  const items: CartItem[] = [{ item: sampleBurger, quantity: 1 }];
  assert.equal(calculateTotal(items, 'retirada'), 49.90);
  assert.equal(calculateTotal(items, 'entrega'), 49.90);
});

test('validateChange correctly validates cash change amounts', () => {
  // Empty change input is valid (exact change)
  assert.equal(validateChange('', 50).valid, true);

  // Change less than total is invalid
  const invalidResult = validateChange('40', 50);
  assert.equal(invalidResult.valid, false);
  assert.ok(invalidResult.error?.includes('maior que o total'));

  // Change equal to total is invalid (no change needed)
  const equalResult = validateChange('50', 50);
  assert.equal(equalResult.valid, false);

  // Change greater than total is valid
  const validResult = validateChange('100', 50);
  assert.equal(validResult.valid, true);
  assert.equal(validResult.value, 100);
});

test('formatBRL formats numbers with R$ and decimals', () => {
  const formatted = formatBRL(94.90);
  assert.ok(formatted.includes('94,90'));
  assert.ok(formatted.includes('R$'));
});

test('buildWhatsAppOrderMessage includes all items, delivery address, and payment method', () => {
  const msg = buildWhatsAppOrderMessage({
    customerName: 'Lucas Oliveira',
    items: [
      { item: sampleBurger, quantity: 1 },
      { item: sampleDrink, quantity: 2 }
    ],
    mode: 'entrega',
    deliveryAddress: 'Rua Anita Garibaldi, 1200',
    deliveryReference: 'Apto 302',
    paymentMethod: 'pix',
    subtotal: 69.70,
    deliveryFee: 0,
    total: 69.70
  });

  assert.ok(msg.includes('Big Bacon'));
  assert.ok(msg.includes('Coca-Cola 350ml'));
  assert.ok(msg.includes('Rua Anita Garibaldi, 1200'));
  assert.ok(msg.includes('Apto 302'));
  assert.ok(msg.includes('PIX'));
  assert.ok(msg.includes('Lucas Oliveira'));
});

test('buildKitchenComanda generates clear ticket format for owner', () => {
  const ticket = buildKitchenComanda({
    customerName: 'Mariana Silva',
    items: [{ item: sampleBurger, quantity: 2 }],
    mode: 'entrega',
    deliveryAddress: 'Av Assis Brasil, 800',
    paymentMethod: 'dinheiro',
    changeFor: 120,
    subtotal: 99.80,
    deliveryFee: 0,
    total: 99.80
  }, 105);

  assert.ok(ticket.includes('COMANDA #105'));
  assert.ok(ticket.includes('Mariana Silva'));
  assert.ok(ticket.includes('Av Assis Brasil, 800'));
  assert.ok(ticket.includes('2x  Big Bacon'));
  assert.ok(ticket.includes('DINHEIRO'));
  assert.ok(ticket.includes('TROCO P/:'));
});
