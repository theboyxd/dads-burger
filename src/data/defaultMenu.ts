import { MenuItem, StoreConfig } from '../types/menu';

const normalizeImg = (idOrUrl: string, w = 500) => {
  if (!idOrUrl) return `https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=${w}&q=75`;
  if (idOrUrl.startsWith('http://') || idOrUrl.startsWith('https://') || idOrUrl.startsWith('/') || idOrUrl.startsWith('logo')) {
    return idOrUrl;
  }
  return `https://images.unsplash.com/photo-${idOrUrl}?auto=format&fit=crop&w=${w}&q=75`;
};

export const DADS_BURGER_CONFIG: StoreConfig = {
  nome: "Dad's Burger",
  tipo: "dads",
  cor: "#FAB309",
  cor2: "#121212",
  logo: "/logo.png",
  whats: "5551994575683",
  end: "Rua Sapé, 947 - Passo d'Areia, Porto Alegre - RS",
  nota: "4,8",
  aval: "1.250",
  tagline: "Os melhores hambúrgueres artesanais e combos na caixa de Porto Alegre. Smash na chapa e porções crocantes."
};

export const DADS_BURGER_ITEMS: MenuItem[] = [
  // Combos na Caixa
  {
    id: "combo-1",
    cat: "Combos na Caixa",
    name: "Combo na Caixa: 2x Big Bacon",
    desc: "2 Deliciosos Hambúrgueres Big Bacon, nuggets de frango, onion rings, calabresa e batata crocante.",
    price: 94.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202303112347_J55T_iblob",
    badge: "Campeão de Vendas",
    available: true
  },
  {
    id: "combo-2",
    cat: "Combos na Caixa",
    name: "Combo na Caixa: 3x Cheesburger",
    desc: "3 Deliciosos Hambúrgueres Cheesburger, nuggets de frango, onion rings, calabresa e batata frita especial.",
    price: 93.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202303120006_A4F6_iblob",
    available: true
  },
  {
    id: "combo-3",
    cat: "Combos na Caixa",
    name: "Combo na Caixa: 4x Big Dad´s Supremo + Refri 2L",
    desc: "4 Deliciosos Hambúrgueres Big Dad's Supremo, nuggets de frango, onion rings, batata frita e refrigerante 2L.",
    price: 152.91,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202303120019_ONI5_iblob",
    badge: "Galera",
    available: true
  },
  {
    id: "combo-4",
    cat: "Combos na Caixa",
    name: "Combo na Caixa: Dad's Top Premium",
    desc: "1x Delicioso Hambúrguer Dad's Top Premium, acompanhado de nuggets, onion rings e fritas sequinhas.",
    price: 71.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202211082221_VD03_iblob",
    available: true
  },
  {
    id: "combo-5",
    cat: "Combos na Caixa",
    name: "Combo na Caixa: 2x Magnífico",
    desc: "2 Deliciosos Hambúrgueres Magnífico, acompanhados de nuggets de frango, onion rings e calabresa fatiada.",
    price: 99.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202303112347_J55T_iblob",
    available: true
  },
  {
    id: "combo-6",
    cat: "Combos na Caixa",
    name: "Combo na Caixa: 4x Cheddar Duplo",
    desc: "4 Deliciosos Hambúrgueres Cheddar Duplo, acompanhados de nuggets, onion rings e batata frita especial.",
    price: 138.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202303120019_ONI5_iblob",
    available: true
  },
  {
    id: "combo-7",
    cat: "Combos na Caixa",
    name: "Combo na Caixa: 2x Dad's Top Premium",
    desc: "2 Deliciosos Hambúrgueres Dad's Top Premium, nuggets, onion rings, calabresa e batata com cheddar e bacon.",
    price: 96.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202303112347_J55T_iblob",
    badge: "Destaque",
    available: true
  },
  {
    id: "combo-8",
    cat: "Combos na Caixa",
    name: "Combo na Caixa: Cheddar Duplo",
    desc: "1x Delicioso Hambúrguer Cheddar Duplo, acompanhado de nuggets de frango, onion rings e fritas.",
    price: 71.91,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202211082221_VD03_iblob",
    available: true
  },
  {
    id: "combo-9",
    cat: "Combos na Caixa",
    name: "Combo na Caixa: Serve 6 Pessoas + Fritas",
    desc: "6 hambúrgueres artesanais com carne suculenta e molho especial + porção generosa de fritas.",
    price: 135.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202303120039_XLY5_iblob",
    badge: "Família",
    available: true
  },
  {
    id: "combo-10",
    cat: "Combos na Caixa",
    name: "Combo na Caixa: Serve 10 Pessoas Insano",
    desc: "10 burgers Db Carne ou Frango, 10 onion rings, 10 nuggets, batata com cheddar e bacon.",
    price: 203.00,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202212170055_16O5_iblob",
    available: true
  },
  {
    id: "combo-11",
    cat: "Combos na Caixa",
    name: "Combo na Caixa: Serve 7 Pessoas",
    desc: "7 burgers Db Carne ou Frango, 7 onion rings, 7 nuggets, batata com cheddar e bacon e calabresa.",
    price: 199.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202112150011_QTS0_iblob",
    available: true
  },
  {
    id: "combo-12",
    cat: "Combos na Caixa",
    name: "Combo: Big Bacon 1 Pessoa",
    desc: "1x Delicioso Hambúrguer Big Bacon, acompanhado de nuggets, onion rings e batata frita.",
    price: 71.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202211082221_VD03_iblob",
    available: true
  },
  {
    id: "combo-13",
    cat: "Combos na Caixa",
    name: "Combo na Caixa: 4x Cheddar Jr",
    desc: "4 Hambúrgueres Cheddar Jr, acompanhados de nuggets de frango, calabresa e onion rings.",
    price: 169.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202211082329_3V46_iblob",
    available: true
  },

  // Burgers Artesanais
  {
    id: "burger-1",
    cat: "Burgers Artesanais",
    name: "Cheese Salada Db",
    desc: "Blend artesanal 100g, alface e tomate frescos, maionese e molho especial no pão brioche amanteigado.",
    price: 32.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202310302325_1SEJ_iblob",
    available: true
  },
  {
    id: "burger-2",
    cat: "Burgers Artesanais",
    name: "Big Bacon",
    desc: "Blend artesanal 100g, bacon crocante, onion rings, muçarela, alface e molho no pão brioche.",
    price: 49.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202108280340_C42R_iblob",
    badge: "Favorito",
    available: true
  },
  {
    id: "burger-3",
    cat: "Burgers Artesanais",
    name: "Cheeseburguer Cheddar",
    desc: "Suculento hambúrguer artesanal 100g com muito queijo cheddar cremoso no pão brioche tostado.",
    price: 29.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202310302314_X2E8_iblob",
    available: true
  },
  {
    id: "burger-4",
    cat: "Burgers Artesanais",
    name: "Duplo Calabresa",
    desc: "2 blends artesanais de 100g cada, calabresa fatiada, molho barbecue e queijo derretido.",
    price: 45.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202207031919_82C3_iblob",
    available: true
  },
  {
    id: "burger-5",
    cat: "Burgers Artesanais",
    name: "Dad's Turbo",
    desc: "Blend artesanal 100g, calabresa, bacon defumado, cebola roxa, queijo cheddar e muçarela.",
    price: 59.43,
    img: "https://images.unsplash.com/photo-1586190848861-99aa4a171e90?auto=format&fit=crop&w=500&q=75",
    badge: "Top Chef",
    available: true
  },
  {
    id: "burger-6",
    cat: "Burgers Artesanais",
    name: "Big Mom Chicken",
    desc: "2 carnes de frango crocante de 100g cada, queijo muçarela, alface fresca e maionese especial.",
    price: 40.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202408100303_0IJ0_iblob",
    available: true
  },
  {
    id: "burger-7",
    cat: "Burgers Artesanais",
    name: "Db Chicken Bacon",
    desc: "Frango empanado crocante com maionese suave de queijo e fatias de bacon defumado crocante.",
    price: 38.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202211240120_2V2T_iblob",
    available: true
  },
  {
    id: "burger-8",
    cat: "Burgers Artesanais",
    name: "Db Cheddar Duplo",
    desc: "2 carnes artesanais de 100g, cheddar fatiado e cheddar cremoso com cebola caramelizada.",
    price: 49.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202310302252_ID22_iblob",
    available: true
  },
  {
    id: "burger-9",
    cat: "Burgers Artesanais",
    name: "Db Cowboy",
    desc: "Blend artesanal 100g, queijo muçarela, tomate fresco, onion rings empanadas e molho barbecue.",
    price: 49.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202108190130_3GTY_iblob",
    available: true
  },
  {
    id: "burger-10",
    cat: "Burgers Artesanais",
    name: "Dad's Top Premium",
    desc: "Blend artesanal 100g, bacon defumado crocante, queijo muçarela, cebola roxa e molho premium.",
    price: 49.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202108032319_01NG_iblob",
    badge: "Artesanal",
    available: true
  },
  {
    id: "burger-11",
    cat: "Burgers Artesanais",
    name: "Magnífico",
    desc: "Hambúrguer artesanal 100g, queijo cheddar, alface, tomate fresco e nosso molho especial da casa.",
    price: 47.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202310302258_7P32_iblob",
    available: true
  },
  {
    id: "burger-12",
    cat: "Burgers Artesanais",
    name: "Triplo Bacon",
    desc: "3 blends artesanais de 100g cada, triplo bacon crocante e triplo queijo cheddar derretido.",
    price: 64.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202303120237_ROT6_iblob",
    badge: "Monstruoso",
    available: true
  },
  {
    id: "burger-13",
    cat: "Burgers Artesanais",
    name: "Db Furioso",
    desc: "Blend artesanal 100g, muçarela, iscas de bacon defumado, onion rings e molho levemente picante.",
    price: 49.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202108190102_FW0H_iblob",
    available: true
  },
  {
    id: "burger-14",
    cat: "Burgers Artesanais",
    name: "Cheddar Duplo Salada",
    desc: "2 carnes artesanais de 100g cada, queijo cheddar, alface, tomate e maionese especial no brioche.",
    price: 59.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202310302316_A551_iblob",
    available: true
  },
  {
    id: "burger-15",
    cat: "Burgers Artesanais",
    name: "Triplo Magnífico",
    desc: "3 carnes artesanais de 100g cada, cheddar cremoso, alface crocante e tomate fresco no brioche.",
    price: 56.01,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202103042151_1J19_blob",
    available: true
  },
  {
    id: "burger-16",
    cat: "Burgers Artesanais",
    name: "Chicken Burger",
    desc: "Hambúrguer artesanal de frango empanado, alface fresca e maionese especial no pão brioche.",
    price: 35.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202310302256_4S70_iblob",
    available: true
  },

  // Porções
  {
    id: "porcao-1",
    cat: "Porções",
    name: "Onions Rings",
    desc: "Aproximadamente 150g de anéis de cebola dourados e super crocantes com molho.",
    price: 22.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202509302141_2260_iblob",
    available: true
  },
  {
    id: "porcao-2",
    cat: "Porções",
    name: "Trio Magnífico",
    desc: "Batata frita crocante coberta com molho cheddar e bacon + onion rings + nuggets dourados.",
    price: 44.92,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/201706231921_35183172blob",
    badge: "Super Porção",
    available: true
  },
  {
    id: "porcao-3",
    cat: "Porções",
    name: "Batata Frita",
    desc: "Aproximadamente 150g de batatas fritas sequinhas, crocantes e bem temperadas.",
    price: 22.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202509302134_SG75_iblob",
    available: true
  },
  {
    id: "porcao-4",
    cat: "Porções",
    name: "Combo Onion Rings",
    desc: "350g de onion rings empanadas (20 a 25 unidades) com molho barbecue e maionese especial.",
    price: 49.62,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202109032057_15LV_iblob",
    available: true
  },
  {
    id: "porcao-5",
    cat: "Porções",
    name: "Mega Dad´s Batata + Guaraná 2L",
    desc: "Combinação perfeita: batata frita com calabresa fatiada, bacon e cheddar cremoso + Guaraná 2L.",
    price: 95.92,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202211232123_N2HV_iblob",
    badge: "Combo Completo",
    available: true
  },
  {
    id: "porcao-6",
    cat: "Porções",
    name: "Combo Nuggets",
    desc: "650g de nuggets dourados crocantes (20 a 25 unidades) com 50ml de molho barbecue e maionese.",
    price: 63.92,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202109032101_4UI1_iblob",
    available: true
  },

  // Bebidas
  {
    id: "bebida-1",
    cat: "Bebidas",
    name: "Coca-Cola 350ml",
    desc: "Lata 350 ml, bem gelada.",
    price: 9.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202111190022_LMO1_iblob",
    available: true
  },
  {
    id: "bebida-2",
    cat: "Bebidas",
    name: "Sprite Lata",
    desc: "Lata 350 ml, refrescante e gelada.",
    price: 9.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202111190025_4E7Y_iblob",
    available: true
  },
  {
    id: "bebida-3",
    cat: "Bebidas",
    name: "Coca-Cola Original 2L",
    desc: "Garrafa 2 Litros para dividir com a galera.",
    price: 23.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202111190051_1Q77_iblob",
    available: true
  },
  {
    id: "bebida-4",
    cat: "Bebidas",
    name: "Coca-Cola Zero 2L",
    desc: "Garrafa 2 Litros Zero Açúcar bem gelada.",
    price: 22.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202111190017_0ARL_iblob",
    available: true
  },
  {
    id: "bebida-5",
    cat: "Bebidas",
    name: "Fanta Laranja Lata 350ml",
    desc: "Lata 350 ml, bem gelada.",
    price: 12.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202210211307_zym9dpas7inblob",
    available: true
  },
  {
    id: "bebida-6",
    cat: "Bebidas",
    name: "Refrigerante Guaraná Fruki Lata 350ml",
    desc: "O guaraná tradicional do RS, bem gelado.",
    price: 12.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202210180253_9cjw6ek1ic7blob",
    badge: "Tradicional RS",
    available: true
  },
  {
    id: "bebida-7",
    cat: "Bebidas",
    name: "Refrigerante Fruki Guaraná 200ml",
    desc: "Garrafinha 200 ml geladinha individual.",
    price: 5.90,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202210192223_hq8hi7dcoplblob",
    available: true
  },
  {
    id: "bebida-8",
    cat: "Bebidas",
    name: "Refrigerante Coca-Cola Garrafa 200ml",
    desc: "Garrafa 200 ml perfeita para o lanche.",
    price: 6.50,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202210180755_jbj81jt1flnblob",
    available: true
  },
  {
    id: "bebida-9",
    cat: "Bebidas",
    name: "Cerveja Amstel Latão 473ml",
    desc: "Latão 473 ml puro malte geladíssimo.",
    price: 13.50,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202111190019_RA0P_iblob",
    available: true
  },
  {
    id: "bebida-10",
    cat: "Bebidas",
    name: "Cerveja Heineken 330ml",
    desc: "Long neck 330 ml trincando de gelada.",
    price: 13.50,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202210200022_3etbaqlcl88blob",
    available: true
  },
  {
    id: "bebida-11",
    cat: "Bebidas",
    name: "Cerveja Heineken 600ml",
    desc: "Garrafa 600 ml puro malte bem gelada.",
    price: 19.00,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202111192252_263I_iblob",
    available: true
  },
  {
    id: "bebida-12",
    cat: "Bebidas",
    name: "Cerveja Polar 473ml",
    desc: "A cerveja do Rio Grande, latão 473 ml bem gelada.",
    price: 12.50,
    img: "https://client-assets.anota.ai/produtos/68dd67c43503c81262369b16/202111190018_21Y5_iblob",
    badge: "Gaúcha",
    available: true
  }
];

export const UPSELL_PRIORITY_NAMES = [
  'Coca-Cola 350ml',
  'Refrigerante Guaraná Fruki Lata 350ml',
  'Sprite Lata',
  'Fanta Laranja Lata 350ml',
  'Coca-Cola Original 2L',
  'Batata Frita',
  'Onions Rings'
];

export const TRENDING_ITEM_IDS = [
  'combo-1', // Combo na Caixa: 2x Big Bacon
  'burger-2', // Big Bacon
  'burger-10', // Dad's Top Premium
  'combo-7', // Combo 2x Dad's Top Premium
  'porcao-2', // Trio Magnífico
  'burger-5' // Dad's Turbo
];
