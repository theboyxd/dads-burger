import React from 'react';
import { ShoppingBag, ChevronRight } from 'lucide-react';
import { formatBRL } from '../utils/orderCalculator';

interface FloatingCartBarProps {
  total: number;
  itemCount: number;
  onOpenCart: () => void;
}

export const FloatingCartBar: React.FC<FloatingCartBarProps> = ({
  total,
  itemCount,
  onOpenCart
}) => {
  if (itemCount === 0) return null;

  return (
    <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-30 w-[calc(100%-2rem)] max-w-md animate-slide-up">
      <div 
        onClick={onOpenCart}
        className="bg-[#121212] text-white p-3.5 px-5 rounded-2xl sm:rounded-full shadow-2xl flex items-center justify-between cursor-pointer border border-zinc-700 hover:bg-black transition-all group active:scale-98"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#FAB309] text-black flex items-center justify-center font-black relative flex-shrink-0">
            <ShoppingBag className="w-5 h-5 stroke-[2.5]" />
            <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center border border-white">
              {itemCount}
            </span>
          </div>

          <div>
            <span className="text-xs text-zinc-400 block font-medium">
              {itemCount} {itemCount === 1 ? 'item selecionado' : 'itens selecionados'}
            </span>
            <span className="text-base sm:text-lg font-black text-[#FAB309]">
              {formatBRL(total)}
            </span>
          </div>
        </div>

        <button 
          className="bg-[#FAB309] group-hover:bg-[#d69700] text-black font-extrabold text-xs sm:text-sm px-4 py-2 rounded-full flex items-center gap-1 transition-colors"
        >
          <span>Ver pedido</span>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
