import React from 'react';
import { LucideIcon, Plus } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  className = ''
}) => {
  return (
    <div
      className={`p-8 sm:p-12 text-center rounded-2xl border border-black/[0.08] bg-white flex flex-col items-center justify-center space-y-3 ${className}`}
    >
      <div className="w-11 h-11 rounded-2xl bg-[#f5f5f7] flex items-center justify-center text-[#6e6e73] shrink-0">
        <Icon className="w-5 h-5 stroke-[1.6]" />
      </div>
      <div className="space-y-1 max-w-sm">
        <h3 className="font-semibold text-base text-[#1d1d1f] tracking-[-0.015em]">
          {title}
        </h3>
        <p className="text-[13px] sm:text-sm text-[#6e6e73] font-normal leading-relaxed">
          {description}
        </p>
      </div>
      {actionLabel && onAction && (
        <div className="pt-2">
          <button
            onClick={onAction}
            type="button"
            className="inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-[40px] px-4 py-2 rounded-xl bg-[#1d1d1f] text-white text-[13px] font-medium hover:bg-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0284c7] cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{actionLabel}</span>
          </button>
        </div>
      )}
    </div>
  );
};
