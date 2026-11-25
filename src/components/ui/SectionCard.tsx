import React from 'react';

interface SectionCardProps {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  surface?: 'white' | 'subtle';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  className?: string;
}

const PADDING_MAP = {
  none: '',
  sm: 'p-4',
  md: 'p-4 sm:p-5',
  lg: 'p-5 sm:p-6'
} as const;

export const SectionCard: React.FC<SectionCardProps> = ({
  title,
  subtitle,
  action,
  children,
  surface = 'white',
  padding = 'md',
  className = ''
}) => {
  const surfaceClasses =
    surface === 'subtle'
      ? 'bg-[#f5f5f7] border border-transparent'
      : 'bg-white border border-black/[0.08]';

  return (
    <section
      className={`rounded-2xl ${surfaceClasses} ${PADDING_MAP[padding]} ${className}`}
    >
      {(title || subtitle || action) && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 ${
            padding === 'none' ? 'px-4 sm:px-5 py-4 border-b border-black/[0.06]' : 'pb-3.5 mb-4 border-b border-black/[0.06]'
          }`}
        >
          <div className="min-w-0">
            {title && (
              <h3 className="text-[15px] font-semibold text-[#1d1d1f] tracking-[-0.01em]">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-xs text-[#6e6e73] mt-0.5 leading-snug">
                {subtitle}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
};
