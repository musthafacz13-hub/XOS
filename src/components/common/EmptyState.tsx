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
    <div className={`p-8 sm:p-12 text-center rounded-2xl border border-black/[0.08] bg-white flex flex-col items-center justify-center space-y-3 ${className}`}>
      <div className="w-12 h-12 rounded-2xl bg-neutral-100 flex items-center justify-center text-neutral-800 shrink-0">
        <Icon className="w-6 h-6 stroke-[1.5]" />
      </div>
      <div className="space-y-1 max-w-sm">
        <h3 className="font-semibold text-sm sm:text-base text-[#111111] tracking-tight">
          {title}
        </h3>
        <p className="text-xs sm:text-sm text-neutral-500 font-normal leading-relaxed">
          {description}
        </p>
      </div>
      {actionLabel && onAction && (
        <div className="pt-2">
          <button
            onClick={onAction}
            type="button"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#111111] text-white text-xs font-semibold hover:bg-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB] cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-[#87CEEB]" />
            <span>{actionLabel}</span>
          </button>
        </div>
      )}
    </div>
  );
};
