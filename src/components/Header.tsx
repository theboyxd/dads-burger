import React, { useState } from 'react';
import { Heart, Share2, Store, Clock, ShoppingBag, Utensils, Calendar, MapPin } from 'lucide-react';
import { StoreConfig } from '../types/menu';

interface HeaderProps {
  config: StoreConfig;
  activeTab: string;
  cartCount: number;
  isOpen: boolean;
  statusText: string;
  onSelectTab: (tab: string) => void;
  onOpenOwnerDashboard: () => void;
  onShowToast: (msg: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  config,
  activeTab,
  cartCount,
  isOpen,
  statusText,
  onSelectTab,
  onOpenOwnerDashboard,
  onShowToast
}) => {
  const [favorited, setFavorited] = useState(false);

  const handleFavorite = () => {
    const next = !favorited;
    setFavorited(next);
    onShowToast(next ? 'Dad\'s Burger adicionado aos favoritos! ❤️' : 'Removido dos favoritos');
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: config.nome,
          text: config.tagline,
          url: window.location.href
        });
      } catch {
        // User canceled or failed
      }
    } else {
      try {
        await navigator.clipboard.writeText(window.location.href);
        onShowToast('Link do cardápio copiado para a área de transferência! 📋');
      } catch {
        onShowToast('Link do cardápio pronto para compartilhar!');
      }
    }
  };

  return (
    <header className="w-full bg-[#121212] text-white border-b border-white/10 sticky top-0 z-30 shadow-md">
      {/* Top Banner / Announcement bar for desktop & mobile */}
      <div className="bg-[#FAB309] text-[#121212] text-xs font-bold py-1 px-4 text-center tracking-wide flex items-center justify-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full bg-black animate-pulse"></span>
        <span>DELIVERY GRÁTIS EM PORTO ALEGRE • COMBOS NA CAIXA & SMASH BURGER</span>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        {/* Logo and Brand Title */}
        <div 
          onClick={() => onSelectTab('home')}
          className="flex items-center gap-3 cursor-pointer group select-none"
        >
          <div className="relative w-12 h-12 rounded-full overflow-hidden bg-[#FAB309] border-2 border-[#FAB309] shadow-lg flex-shrink-0 group-hover:scale-105 transition-transform">
            <img 
              src={config.logo} 
              alt={config.nome}
              className="w-full h-full object-cover"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.src = '/logo.png';
              }}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase font-extrabold tracking-wider text-[#FAB309]">Cardápio Digital</span>
              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${isOpen ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isOpen ? 'bg-emerald-400' : 'bg-red-400'}`}></span>
                <span className="hidden sm:inline">{statusText}</span>
                <span className="sm:hidden">{isOpen ? 'Aberto' : 'Fechado'}</span>
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white leading-tight flex items-center gap-1.5">
              {config.nome}
            </h1>
          </div>
        </div>

        {/* Desktop Navigation Links */}
        <nav className="hidden md:flex items-center gap-1 lg:gap-2 text-sm font-bold">
          <button
            onClick={() => onSelectTab('home')}
            className={`px-3 py-2 rounded-xl transition-all flex items-center gap-1.5 ${activeTab === 'home' ? 'bg-[#FAB309] text-[#121212] shadow-sm' : 'text-zinc-300 hover:text-white hover:bg-white/5'}`}
          >
            <Utensils className="w-4 h-4" />
            <span>Cardápio</span>
          </button>

          <button
            onClick={() => onSelectTab('pedido')}
            className={`px-3 py-2 rounded-xl transition-all flex items-center gap-1.5 relative ${activeTab === 'pedido' ? 'bg-[#FAB309] text-[#121212] shadow-sm' : 'text-zinc-300 hover:text-white hover:bg-white/5'}`}
          >
            <ShoppingBag className="w-4 h-4" />
            <span>Seu Pedido</span>
            {cartCount > 0 && (
              <span className="ml-1 bg-red-600 text-white text-xs font-black px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                {cartCount}
              </span>
            )}
          </button>

          <button
            onClick={() => onSelectTab('reservas')}
            className={`px-3 py-2 rounded-xl transition-all flex items-center gap-1.5 ${activeTab === 'reservas' ? 'bg-[#FAB309] text-[#121212] shadow-sm' : 'text-zinc-300 hover:text-white hover:bg-white/5'}`}
          >
            <Calendar className="w-4 h-4" />
            <span>Reservas</span>
          </button>

          <button
            onClick={() => onSelectTab('local')}
            className={`px-3 py-2 rounded-xl transition-all flex items-center gap-1.5 ${activeTab === 'local' ? 'bg-[#FAB309] text-[#121212] shadow-sm' : 'text-zinc-300 hover:text-white hover:bg-white/5'}`}
          >
            <MapPin className="w-4 h-4" />
            <span>Onde Estamos</span>
          </button>
        </nav>

        {/* Right Actions: Favorite, Share & Owner Portal */}
        <div className="flex items-center gap-2">
          {/* Owner Portal Button - Highly visible for establishment owner */}
          <button
            onClick={onOpenOwnerDashboard}
            className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-[#FAB309] border border-[#FAB309]/30 hover:border-[#FAB309] px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-xl text-xs sm:text-sm font-bold shadow-sm transition-all active:scale-95"
            title="Acessar Painel do Estabelecimento e Comandas"
          >
            <Store className="w-4 h-4" />
            <span className="hidden sm:inline">Painel do Dono</span>
            <span className="sm:hidden font-black">Dono</span>
          </button>

          <button
            onClick={handleFavorite}
            aria-label="Favoritar restaurante"
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-white flex items-center justify-center transition-colors active:scale-95"
          >
            <Heart className={`w-4 h-4 sm:w-5 sm:h-5 ${favorited ? 'fill-red-500 text-red-500' : 'text-zinc-300'}`} />
          </button>

          <button
            onClick={handleShare}
            aria-label="Compartilhar cardápio"
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-white flex items-center justify-center transition-colors active:scale-95"
          >
            <Share2 className="w-4 h-4 sm:w-5 sm:h-5 text-zinc-300" />
          </button>
        </div>
      </div>
    </header>
  );
};
