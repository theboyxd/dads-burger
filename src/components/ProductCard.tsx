import React from 'react';
import { Plus, Check, AlertCircle } from 'lucide-react';
import { MenuItem } from '../types/menu';
import { formatBRL } from '../utils/orderCalculator';

interface ProductCardProps {
  item: MenuItem;
  quantity: number;
  onAddToCart: (item: MenuItem) => void;
  onItemClick?: (item: MenuItem) => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({
  item,
  quantity,
  onAddToCart,
  onItemClick
}) => {
  const isAvailable = item.available !== false;

  return (
    <div 
      className={`bg-white rounded-2xl sm:rounded-3xl p-3 sm:p-4 border border-zinc-200/80 shadow-xs hover:shadow-md transition-all flex flex-col justify-between group relative overflow-hidden ${
        !isAvailable ? 'opacity-60 grayscale-[40%]' : ''
      }`}
    >
      <div>
        {/* Image Container with high fidelity framing */}
        <div 
          onClick={() => onItemClick && onItemClick(item)}
          className="relative w-full aspect-[4/3] rounded-xl sm:rounded-2xl overflow-hidden bg-zinc-100 cursor-pointer shadow-inner mb-3"
        >
          <img
            src={item.img}
            alt={item.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.src = 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=400&q=70';
            }}
          />

          {/* Badges */}
          {item.badge && (
            <span className="absolute top-2 left-2 bg-[#121212]/90 backdrop-blur-xs text-[#FAB309] text-[10px] sm:text-xs font-black px-2.5 py-0.5 rounded-full shadow-md">
              {item.badge}
            </span>
          )}

          {/* Active Cart Counter Badge */}
          {quantity > 0 && (
            <span className="absolute top-2 right-2 bg-[#FAB309] text-black text-xs font-black min-w-[24px] h-6 px-1.5 rounded-full flex items-center justify-center shadow-lg border border-black/10 animate-scale-in">
              {quantity}
            </span>
          )}

          {!isAvailable && (
            <div className="absolute inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center text-white font-extrabold text-xs sm:text-sm gap-1">
              <AlertCircle className="w-4 h-4 text-amber-400" />
              <span>Esgotado hoje</span>
            </div>
          )}
        </div>

        {/* Text information - legible for both customer & business owner */}
        <h3 
          onClick={() => onItemClick && onItemClick(item)}
          className="font-extrabold text-sm sm:text-base text-zinc-900 group-hover:text-amber-600 transition-colors cursor-pointer leading-snug"
        >
          {item.name}
        </h3>

        <p className="text-zinc-500 text-xs sm:text-sm mt-1 line-clamp-2 leading-relaxed">
          {item.desc}
        </p>
      </div>

      {/* Price & Action row */}
      <div className="flex items-center justify-between pt-3 mt-2 border-t border-zinc-100">
        <div>
          <span className="text-xs text-zinc-400 font-semibold block sm:hidden">Preço</span>
          <span className="font-black text-base sm:text-lg text-zinc-950">
            {formatBRL(item.price)}
          </span>
        </div>

        <button
          onClick={() => isAvailable && onAddToCart(item)}
          disabled={!isAvailable}
          aria-label={`Adicionar ${item.name} ao pedido`}
          className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-black transition-all shadow-xs active:scale-90 ${
            !isAvailable
              ? 'bg-zinc-200 text-zinc-400 cursor-not-allowed'
              : quantity > 0
              ? 'bg-[#121212] text-[#FAB309] hover:bg-zinc-800'
              : 'bg-[#FAB309] text-black hover:bg-[#d99800]'
          }`}
        >
          {quantity > 0 ? (
            <Check className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
          ) : (
            <Plus className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
          )}
        </button>
      </div>
    </div>
  );
};
