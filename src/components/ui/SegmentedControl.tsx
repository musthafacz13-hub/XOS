import React from 'react';

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'sm',
  fullWidth = false,
  className = ''
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-0.5 bg-[#f5f5f7] p-1 rounded-xl max-w-full overflow-x-auto ${
        fullWidth ? 'w-full' : ''
      } ${className}`}
    >
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            aria-pressed={active}
            className={`rounded-lg font-medium transition-all cursor-pointer whitespace-nowrap shrink-0 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0284c7] ${
              fullWidth ? 'flex-1' : ''
            } ${
              size === 'md'
                ? 'min-h-[40px] sm:min-h-[36px] px-3.5 py-1.5 text-xs sm:text-[13px]'
                : 'min-h-[38px] sm:min-h-[32px] px-3 py-1 text-xs'
            } ${
              active
                ? 'bg-white text-[#1d1d1f] font-semibold shadow-2xs ring-1 ring-black/[0.05]'
                : 'text-[#6e6e73] hover:text-[#1d1d1f]'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
