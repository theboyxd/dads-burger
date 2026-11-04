import React from 'react';
import { Search, Star, Sparkles, ChevronRight, UtensilsCrossed, Calendar } from 'lucide-react';
import { MenuItem } from '../types/menu';

interface FeaturedHeroProps {
  tagline: string;
  rating: string;
  reviewsCount: string;
  featuredItem: MenuItem;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onAddToCart: (item: MenuItem) => void;
  onGoToTab: (tab: string) => void;
}

export const FeaturedHero: React.FC<FeaturedHeroProps> = ({
  tagline,
  rating,
  reviewsCount,
  featuredItem,
  searchQuery,
  onSearchChange,
  onAddToCart,
  onGoToTab
}) => {
  return (
    <div className="w-full space-y-4">
      {/* Introduction & Rating */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <p className="text-zinc-600 font-medium text-sm sm:text-base leading-snug max-w-2xl">
            {tagline}
          </p>
        </div>

        <div className="inline-flex items-center gap-2 bg-white px-3 py-1.5 rounded-full border border-zinc-200/80 shadow-xs self-start md:self-auto">
          <div className="flex items-center text-amber-500">
            <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
          </div>
          <span className="font-extrabold text-xs sm:text-sm text-zinc-900">{rating}</span>
          <span className="text-zinc-400 text-xs">•</span>
          <span className="text-xs text-zinc-500 font-medium">{reviewsCount} avaliações</span>
        </div>
      </div>

      {/* Hero Featured Card - responsive grid */}
      <div className="relative rounded-3xl overflow-hidden bg-[#121212] text-white shadow-xl border border-zinc-800">
        <div className="grid grid-cols-1 md:grid-cols-12 items-center">
          {/* Text & CTAs */}
          <div className="p-6 md:p-8 md:col-span-7 flex flex-col justify-center space-y-3 z-10">
            <div className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-[#FAB309] bg-[#FAB309]/15 px-3 py-1 rounded-full w-fit">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Destaque da Casa</span>
            </div>

            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white leading-tight tracking-tight">
              {featuredItem.name}
            </h2>

            <p className="text-zinc-300 text-sm sm:text-base line-clamp-2 leading-relaxed">
              {featuredItem.desc}
            </p>

            <div className="pt-2 flex flex-wrap items-center gap-3">
              <span className="text-2xl sm:text-3xl font-black text-[#FAB309]">
                R$ {featuredItem.price.toFixed(2).replace('.', ',')}
              </span>
              <button
                onClick={() => onAddToCart(featuredItem)}
                className="bg-[#FAB309] hover:bg-[#e09e00] text-black font-extrabold text-sm sm:text-base px-6 py-3 rounded-full transition-all shadow-md active:scale-95 flex items-center gap-2"
              >
                <span>Pedir agora</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Featured Image */}
          <div className="md:col-span-5 relative h-44 sm:h-64 md:h-full min-h-[180px] overflow-hidden bg-zinc-900">
            <img
              src={featuredItem.img}
              alt={featuredItem.name}
              className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-500"
              loading="eager"
            />
            <div className="absolute inset-0 bg-gradient-to-t md:bg-gradient-to-r from-[#121212] via-transparent to-transparent"></div>
          </div>
        </div>
      </div>

      {/* Quick Action Buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => onGoToTab('reservas')}
          className="flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl bg-[#121212] text-white hover:bg-zinc-800 font-extrabold text-sm transition-all shadow-xs active:scale-95"
        >
          <Calendar className="w-4 h-4 text-[#FAB309]" />
          <span>Reservar mesa</span>
        </button>

        <button
          onClick={() => {
            const el = document.getElementById('cardapio-section');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
          }}
          className="flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl bg-white text-zinc-900 hover:bg-zinc-50 border border-zinc-200/80 font-extrabold text-sm transition-all shadow-xs active:scale-95"
        >
          <UtensilsCrossed className="w-4 h-4 text-[#FAB309]" />
          <span>Ver cardápio</span>
        </button>
      </div>

      {/* Search Input */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-zinc-400">
          <Search className="w-5 h-5" />
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Buscar no cardápio (ex: Big Bacon, Fritas, Guaraná...)"
          className="w-full pl-11 pr-10 py-3.5 bg-white text-zinc-900 placeholder:text-zinc-400 rounded-2xl border border-zinc-200/90 focus:outline-none focus:ring-2 focus:ring-[#FAB309] focus:border-transparent text-sm sm:text-base font-medium shadow-xs transition-all"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-xs font-bold text-zinc-400 hover:text-zinc-700"
          >
            Limpar
          </button>
        )}
      </div>
    </div>
  );
};
