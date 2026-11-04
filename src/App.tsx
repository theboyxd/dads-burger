import React, { useState, useEffect, useMemo } from 'react';
import { 
  DADS_BURGER_CONFIG, 
  DADS_BURGER_ITEMS, 
  TRENDING_ITEM_IDS 
} from './data/defaultMenu';
import { CartItem, MenuItem, StoreConfig } from './types/menu';
import { calculateSubtotal, isStoreOpen } from './utils/orderCalculator';
import { Header } from './components/Header';
import { FeaturedHero } from './components/FeaturedHero';
import { CategoryNav } from './components/CategoryNav';
import { TrendingCarousel } from './components/TrendingCarousel';
import { ProductCard } from './components/ProductCard';
import { CartTab } from './components/CartTab';
import { ReservasTab } from './components/ReservasTab';
import { LocationTab } from './components/LocationTab';
import { OwnerDashboardModal } from './components/OwnerDashboardModal';
import { BottomNav } from './components/BottomNav';
import { FloatingCartBar } from './components/FloatingCartBar';
import { Monitor, Smartphone, Utensils, CheckCircle2 } from 'lucide-react';

export default function App() {
  // Store Configuration
  const [config, setConfig] = useState<StoreConfig>(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      nome: params.get('nome') || DADS_BURGER_CONFIG.nome,
      tipo: params.get('tipo') || DADS_BURGER_CONFIG.tipo,
      cor: params.get('cor') ? `#${params.get('cor')}` : DADS_BURGER_CONFIG.cor,
      cor2: params.get('cor2') ? `#${params.get('cor2')}` : DADS_BURGER_CONFIG.cor2,
      logo: params.get('logo') || DADS_BURGER_CONFIG.logo,
      whats: params.get('whats') || DADS_BURGER_CONFIG.whats,
      end: params.get('end') || DADS_BURGER_CONFIG.end,
      nota: params.get('nota') || DADS_BURGER_CONFIG.nota,
      aval: params.get('aval') || DADS_BURGER_CONFIG.aval,
      tagline: DADS_BURGER_CONFIG.tagline
    };
  });

  // App Navigation & Tabs
  const [activeTab, setActiveTab] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('aba') || 'home';
  });

  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);

  // Menu items list (with availability toggles for store owner)
  const [menuItems, setMenuItems] = useState<MenuItem[]>(DADS_BURGER_ITEMS);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('Todos');

  // Store hours & status
  const [manualStoreOpen, setManualStoreOpen] = useState<boolean | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isOwnerModalOpen, setIsOwnerModalOpen] = useState(false);

  // Responsive frame previewer (allows the owner or reviewer to test in mobile frame or full desktop width)
  const [deviceFrameMode, setDeviceFrameMode] = useState<'responsive' | 'mobile-mock'>('responsive');

  // Compute store status
  const currentStatus = isStoreOpen();
  const effectiveIsOpen = manualStoreOpen !== null ? manualStoreOpen : currentStatus.isOpen;
  const effectiveStatusText = manualStoreOpen !== null
    ? (manualStoreOpen ? 'Aberto agora (Modo Manual)' : 'Fechado temporariamente')
    : currentStatus.statusText;

  // Categories list
  const categories = useMemo(() => {
    const unique = Array.from(new Set(menuItems.map(m => m.cat)));
    return ['Todos', ...unique];
  }, [menuItems]);

  // Counts per category
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { Todos: menuItems.length };
    menuItems.forEach(item => {
      counts[item.cat] = (counts[item.cat] || 0) + 1;
    });
    return counts;
  }, [menuItems]);

  // Cart quantities map
  const cartQuantities = useMemo(() => {
    const map: Record<string, number> = {};
    cart.forEach(ci => {
      map[ci.item.id] = ci.quantity;
    });
    return map;
  }, [cart]);

  // Total cart items count & value
  const cartCount = useMemo(() => cart.reduce((sum, ci) => sum + ci.quantity, 0), [cart]);
  const cartSubtotal = useMemo(() => calculateSubtotal(cart), [cart]);

  // Filtered Menu Items
  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return menuItems.filter(item => {
      const matchCat = activeCategory === 'Todos' || item.cat === activeCategory;
      const matchQuery = !query || 
        item.name.toLowerCase().includes(query) || 
        item.desc.toLowerCase().includes(query);
      return matchCat && matchQuery;
    });
  }, [menuItems, activeCategory, searchQuery]);

  // Trending items
  const trendingItems = useMemo(() => {
    return TRENDING_ITEM_IDS.map(id => menuItems.find(m => m.id === id))
      .filter((m): m is MenuItem => Boolean(m));
  }, [menuItems]);

  // Featured Hero Item (Combo 2x Dad's Top Premium or first combo)
  const featuredItem = useMemo(() => {
    return menuItems.find(m => m.id === 'combo-7') || menuItems[0];
  }, [menuItems]);

  // Cart operations
  const handleAddToCart = (item: MenuItem) => {
    setCart(prev => {
      const existing = prev.find(ci => ci.item.id === item.id);
      if (existing) {
        return prev.map(ci => 
          ci.item.id === item.id ? { ...ci, quantity: ci.quantity + 1 } : ci
        );
      }
      return [...prev, { item, quantity: 1 }];
    });
    showToast(`${item.name} adicionado ao pedido! 🍔`);
  };

  const handleUpdateQuantity = (itemId: string, delta: number) => {
    setCart(prev => {
      return prev.map(ci => {
        if (ci.item.id === itemId) {
          const newQty = ci.quantity + delta;
          return newQty > 0 ? { ...ci, quantity: newQty } : null;
        }
        return ci;
      }).filter((ci): ci is CartItem => ci !== null);
    });
  };

  const handleClearCart = () => {
    setCart([]);
    showToast('Pedido limpo');
  };

  const handleToggleItemAvailability = (itemId: string) => {
    setMenuItems(prev => 
      prev.map(m => m.id === itemId ? { ...m, available: m.available === false ? true : false } : m)
    );
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
  };

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 2800);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // URL query param `?editar` opens owner dashboard automatically
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('editar')) {
      setIsOwnerModalOpen(true);
    }
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-[#EFEAE6] text-[#121212]">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-[#121212] text-white px-5 py-2.5 rounded-full shadow-2xl text-xs sm:text-sm font-bold flex items-center gap-2 border border-white/20 animate-fade-in pointer-events-none">
          <CheckCircle2 className="w-4 h-4 text-[#FAB309]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Header */}
      <Header
        config={config}
        activeTab={activeTab}
        cartCount={cartCount}
        isOpen={effectiveIsOpen}
        statusText={effectiveStatusText}
        onSelectTab={setActiveTab}
        onOpenOwnerDashboard={() => setIsOwnerModalOpen(true)}
        onShowToast={showToast}
      />

      {/* Main App Container - Adapts to chosen frame or expands fluidly to widescreen desktop */}
      <main className={`flex-1 w-full mx-auto transition-all duration-300 pb-28 md:pb-12 ${
        deviceFrameMode === 'mobile-mock' 
          ? 'max-w-[440px] my-4 shadow-2xl rounded-3xl border border-zinc-300 bg-[#F4EFEB] overflow-hidden' 
          : 'max-w-6xl px-4 sm:px-6 lg:px-8 py-5 sm:py-7'
      }`}>
        <div className={deviceFrameMode === 'mobile-mock' ? 'p-4' : ''}>
          {/* TAB 1: CARDÁPIO & HOME */}
          {activeTab === 'home' && (
            <div className="space-y-6 sm:space-y-8">
              {/* Hero Banner with Featured Product */}
              <FeaturedHero
                tagline={config.tagline}
                rating={config.nota}
                reviewsCount={config.aval}
                featuredItem={featuredItem}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onAddToCart={handleAddToCart}
                onGoToTab={setActiveTab}
              />

              {/* Category Filter Chips */}
              <CategoryNav
                categories={categories}
                activeCategory={activeCategory}
                onSelectCategory={setActiveCategory}
                categoryCounts={categoryCounts}
              />

              {/* Trending Items Carousel */}
              {!searchQuery && activeCategory === 'Todos' && (
                <TrendingCarousel
                  items={trendingItems}
                  cartQuantities={cartQuantities}
                  onAddToCart={handleAddToCart}
                />
              )}

              {/* Menu Grid Section */}
              <div id="cardapio-section" className="space-y-4 pt-2">
                <div className="flex items-center justify-between border-b border-zinc-200 pb-2">
                  <div className="flex items-baseline gap-2">
                    <h2 className="text-xl sm:text-2xl font-black text-zinc-950 tracking-tight">
                      Cardápio
                    </h2>
                    <span className="text-xs sm:text-sm font-semibold text-zinc-500">
                      ({filteredItems.length} {filteredItems.length === 1 ? 'item' : 'itens'})
                    </span>
                  </div>

                  {activeCategory !== 'Todos' && (
                    <button
                      onClick={() => setActiveCategory('Todos')}
                      className="text-xs text-amber-700 font-extrabold hover:underline"
                    >
                      Mostrar todos
                    </button>
                  )}
                </div>

                {filteredItems.length === 0 ? (
                  <div className="bg-white rounded-3xl p-8 text-center border border-zinc-200/80 space-y-3">
                    <p className="text-zinc-600 font-bold">Nenhum produto encontrado para "{searchQuery}"</p>
                    <button
                      onClick={() => {
                        setSearchQuery('');
                        setActiveCategory('Todos');
                      }}
                      className="text-xs bg-[#121212] text-white px-4 py-2 rounded-full font-bold"
                    >
                      Limpar filtros
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3.5 sm:gap-4.5">
                    {filteredItems.map(item => (
                      <ProductCard
                        key={item.id}
                        item={item}
                        quantity={cartQuantities[item.id] || 0}
                        onAddToCart={handleAddToCart}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: SEU PEDIDO (CART & CHECKOUT) */}
          {activeTab === 'pedido' && (
            <CartTab
              cart={cart}
              allMenuItems={menuItems}
              config={config}
              onUpdateQuantity={handleUpdateQuantity}
              onClearCart={handleClearCart}
              onGoToMenu={() => setActiveTab('home')}
              onShowToast={showToast}
            />
          )}

          {/* TAB 3: RESERVAR MESA */}
          {activeTab === 'reservas' && (
            <ReservasTab
              config={config}
              onShowToast={showToast}
            />
          )}

          {/* TAB 4: ONDE ESTAMOS (LOCALIZAÇÃO & MAPA) */}
          {activeTab === 'local' && (
            <LocationTab
              config={config}
              isOpen={effectiveIsOpen}
              statusText={effectiveStatusText}
            />
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full bg-[#121212] text-zinc-400 py-8 px-4 text-center text-xs space-y-2 border-t border-zinc-800">
        <div className="max-w-6xl mx-auto space-y-2">
          <p className="font-extrabold text-sm text-white">
            {config.nome} • Hambúrgueres Artesanais & Combos na Caixa
          </p>
          <p className="text-zinc-500">
            {config.end} • WhatsApp: {config.whats}
          </p>
          <p className="text-[11px] text-zinc-600">
            Cardápio digital responsivo otimizado para pedidos rápidos no WhatsApp.
          </p>
        </div>
      </footer>

      {/* Floating Cart Bar (appears on home tab when cart has items) */}
      {activeTab === 'home' && (
        <FloatingCartBar
          total={cartSubtotal}
          itemCount={cartCount}
          onOpenCart={() => setActiveTab('pedido')}
        />
      )}

      {/* Mobile Liquid-Glass Bottom Navigation */}
      <BottomNav
        activeTab={activeTab}
        cartCount={cartCount}
        onSelectTab={setActiveTab}
      />

      {/* Owner Dashboard Modal ("Visão do Dono") */}
      <OwnerDashboardModal
        isOpen={isOwnerModalOpen}
        onClose={() => setIsOwnerModalOpen(false)}
        config={config}
        onUpdateConfig={setConfig}
        menuItems={menuItems}
        onToggleItemAvailability={handleToggleItemAvailability}
        isStoreOpen={effectiveIsOpen}
        onToggleStoreOpen={() => setManualStoreOpen(!effectiveIsOpen)}
        onShowToast={showToast}
      />
    </div>
  );
}
