import React from 'react';

interface CategoryNavProps {
  categories: string[];
  activeCategory: string;
  onSelectCategory: (cat: string) => void;
  categoryCounts: Record<string, number>;
}

export const CategoryNav: React.FC<CategoryNavProps> = ({
  categories,
  activeCategory,
  onSelectCategory,
  categoryCounts
}) => {
  return (
    <div className="w-full">
      <div className="flex gap-2.5 overflow-x-auto no-scrollbar py-2 px-0.5 scroll-smooth">
        {categories.map((c) => {
          const isActive = c === activeCategory;
          const count = categoryCounts[c] ?? 0;

          return (
            <button
              key={c}
              onClick={() => onSelectCategory(c)}
              className={`flex-shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-full text-xs sm:text-sm font-extrabold transition-all select-none active:scale-95 shadow-xs ${
                isActive
                  ? 'bg-[#121212] text-[#FAB309] border-2 border-[#FAB309] shadow-md'
                  : 'bg-white text-zinc-700 hover:text-zinc-950 border border-zinc-200 hover:border-zinc-300'
              }`}
            >
              <span>{c}</span>
              {count > 0 && (
                <span
                  className={`text-[11px] font-black px-1.5 py-0.5 rounded-full ${
                    isActive
                      ? 'bg-[#FAB309] text-black'
                      : 'bg-zinc-100 text-zinc-500'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
