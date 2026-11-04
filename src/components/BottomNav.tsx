import React from 'react';
import { Utensils, ShoppingBag, Calendar, MapPin } from 'lucide-react';

interface BottomNavProps {
  activeTab: string;
  cartCount: number;
  onSelectTab: (tab: string) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  cartCount,
  onSelectTab
}) => {
  return (
    <nav className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 md:hidden liquid-glass rounded-full p-1.5 flex items-center gap-1.5 shadow-2xl border border-white/60">
      <button
        onClick={() => onSelectTab('home')}
        aria-label="Início e cardápio"
        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
          activeTab === 'home'
            ? 'bg-[#121212] text-white shadow-md scale-105'
            : 'text-zinc-700 hover:text-black active:scale-95'
        }`}
      >
        <Utensils className="w-5 h-5" />
      </button>

      <button
        onClick={() => onSelectTab('pedido')}
        aria-label="Ver pedido"
        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all relative ${
          activeTab === 'pedido'
            ? 'bg-[#121212] text-white shadow-md scale-105'
            : 'text-zinc-700 hover:text-black active:scale-95'
        }`}
      >
        <ShoppingBag className="w-5 h-5" />
        {cartCount > 0 && (
          <span className="absolute top-1 right-1 bg-red-600 text-white text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center border-2 border-white">
            {cartCount}
          </span>
        )}
      </button>

      <button
        onClick={() => onSelectTab('reservas')}
        aria-label="Reservar mesa"
        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
          activeTab === 'reservas'
            ? 'bg-[#121212] text-white shadow-md scale-105'
            : 'text-zinc-700 hover:text-black active:scale-95'
        }`}
      >
        <Calendar className="w-5 h-5" />
      </button>

      <button
        onClick={() => onSelectTab('local')}
        aria-label="Onde estamos"
        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
          activeTab === 'local'
            ? 'bg-[#121212] text-white shadow-md scale-105'
            : 'text-zinc-700 hover:text-black active:scale-95'
        }`}
      >
        <MapPin className="w-5 h-5" />
      </button>
    </nav>
  );
};
