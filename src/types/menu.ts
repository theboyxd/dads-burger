export type MenuCategory = 
  | 'Todos'
  | 'Combos na Caixa'
  | 'Burgers Artesanais'
  | 'Porções'
  | 'Bebidas'
  | 'Pratos'
  | 'Massas e pizzas'
  | 'Lanches'
  | 'Especiais'
  | 'Saladas'
  | 'Sobremesas'
  | 'Tradicionais'
  | 'Combinados'
  | 'Peças'
  | 'Rolls'
  | 'Entradas';

export interface MenuItem {
  id: string;
  cat: string;
  name: string;
  desc: string;
  price: number;
  img: string;
  badge?: string;
  available?: boolean;
}

export interface CartItem {
  item: MenuItem;
  quantity: number;
}

export type DeliveryMode = 'entrega' | 'retirada';
export type PaymentMethod = 'pix' | 'cartao' | 'dinheiro';

export interface StoreConfig {
  nome: string;
  tipo: string;
  cor: string;
  cor2: string;
  logo: string;
  whats: string;
  end: string;
  nota: string;
  aval: string;
  por?: string;
  tagline: string;
}

export interface OrderPayload {
  customerName?: string;
  items: CartItem[];
  mode: DeliveryMode;
  deliveryAddress: string;
  deliveryReference?: string;
  paymentMethod: PaymentMethod;
  changeFor?: number;
  subtotal: number;
  deliveryFee: number;
  total: number;
}

export interface ReservationPayload {
  name: string;
  date: string;
  time: string;
  people: number;
  notes?: string;
}
