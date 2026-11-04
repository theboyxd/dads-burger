import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight, Plus, Star } from 'lucide-react';
import { MenuItem } from '../types/menu';
import { formatBRL } from '../utils/orderCalculator';

interface TrendingCarouselProps {
  items: MenuItem[];
  cartQuantities: Record<string, number>;
  onAddToCart: (item: MenuItem) => void;
}

export const TrendingCarousel: React.FC<TrendingCarouselProps> = ({
  items,
  cartQuantities,
  onAddToCart
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const offset = direction === 'left' ? -260 : 260;
      scrollRef.current.scrollBy({ left: offset, behavior: 'smooth' });
    }
  };

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-zinc-900 tracking-tight flex items-center gap-2">
            <span>Mais pedidos</span>
            <span className="text-xs bg-[#FAB309] text-black font-extrabold px-2 py-0.5 rounded-full">
              Favoritos
            </span>
          </h2>
          <p className="text-xs sm:text-sm text-zinc-500 font-medium">Os queridinhos da galera de Porto Alegre</p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => scroll('left')}
            aria-label="Rolar para esquerda"
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-white hover:bg-zinc-100 border border-zinc-200 text-zinc-700 flex items-center justify-center transition-colors shadow-xs active:scale-95"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => scroll('right')}
            aria-label="Rolar para direita"
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-white hover:bg-zinc-100 border border-zinc-200 text-zinc-700 flex items-center justify-center transition-colors shadow-xs active:scale-95"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto no-scrollbar py-2 px-0.5 scroll-smooth"
      >
        {items.map((item, idx) => {
          const qty = cartQuantities[item.id] || 0;
          const bgShades = [
            'bg-amber-50/80 border-amber-200/70',
            'bg-orange-50/80 border-orange-200/70',
            'bg-yellow-50/80 border-yellow-200/70',
            'bg-zinc-50 border-zinc-200/70'
          ];
          const bgClass = bgShades[idx % bgShades.length];

          return (
            <div
              key={item.id}
              className={`flex-shrink-0 w-48 sm:w-56 p-3 rounded-2xl border ${bgClass} shadow-xs flex flex-col justify-between hover:shadow-md transition-all group`}
            >
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-zinc-500 mb-1">
                  <span className="flex items-center gap-1 text-amber-600 font-bold">
                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                    <span>5,0</span>
                  </span>
                  <span className="truncate max-w-[100px] text-[11px]">{item.cat}</span>
                </div>

                <h3 className="font-extrabold text-sm sm:text-base text-zinc-900 leading-snug line-clamp-1 group-hover:text-amber-800 transition-colors">
                  {item.name}
                </h3>
              </div>

              <div className="relative w-full h-28 sm:h-32 my-2 rounded-xl overflow-hidden bg-zinc-200 shadow-inner">
                <img
                  src={item.img}
                  alt={item.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
                {qty > 0 && (
                  <span className="absolute top-2 right-2 bg-[#FAB309] text-black text-xs font-black px-2 py-0.5 rounded-full shadow-md">
                    {qty} no pedido
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between mt-1 pt-1 border-t border-black/5">
                <span className="font-black text-sm sm:text-base text-zinc-950">
                  {formatBRL(item.price)}
                </span>
                <button
                  onClick={() => onAddToCart(item)}
                  aria-label={`Adicionar ${item.name}`}
                  className="w-8 h-8 rounded-full bg-[#FAB309] hover:bg-[#d69700] text-black font-black flex items-center justify-center shadow-xs transition-transform active:scale-90"
                >
                  <Plus className="w-4 h-4 stroke-[3]" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
