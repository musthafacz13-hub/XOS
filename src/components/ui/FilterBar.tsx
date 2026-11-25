import React from 'react';
import { Search, X } from 'lucide-react';

interface FilterBarProps {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  leading?: React.ReactNode;
  filters?: React.ReactNode;
  className?: string;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search…',
  searchAriaLabel = 'Search',
  leading,
  filters,
  className = ''
}) => {
  const showSearch = typeof searchValue === 'string' && typeof onSearchChange === 'function';

  return (
    <div
      className={`flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 sm:gap-3 ${className}`}
    >
      {leading && <div className="flex flex-wrap items-center gap-2">{leading}</div>}

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-2.5 flex-1 lg:justify-end">
        {showSearch && (
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="w-4 h-4 text-[#86868b] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchAriaLabel}
              className="w-full min-h-[44px] sm:min-h-[40px] pl-10 pr-9 py-2 text-base sm:text-sm text-[#1d1d1f] bg-[#f5f5f7] border border-transparent focus:bg-white focus:border-[#0284c7] focus:ring-2 focus:ring-[#0284c7]/15 rounded-xl placeholder:text-[#86868b] transition-colors focus:outline-none"
            />
            {searchValue && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-[#86868b] hover:text-[#1d1d1f] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {filters && (
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
            {filters}
          </div>
        )}
      </div>
    </div>
  );
};
