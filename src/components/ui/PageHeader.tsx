import React from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  actions,
  className = ''
}) => {
  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-end justify-between gap-3 sm:gap-4 pb-4 border-b border-black/[0.06] ${className}`}
    >
      <div className="min-w-0">
        <h2 className="text-[22px] sm:text-[26px] font-semibold text-[#1d1d1f] tracking-[-0.02em] leading-tight">
          {title}
        </h2>
        {description && (
          <p className="text-[13px] sm:text-sm text-[#6e6e73] mt-1 leading-relaxed max-w-2xl">
            {description}
          </p>
        )}
      </div>

      {actions && (
        <div className="flex flex-wrap items-center gap-2 shrink-0 self-start sm:self-end">
          {actions}
        </div>
      )}
    </div>
  );
};
