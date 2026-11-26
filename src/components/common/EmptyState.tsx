import React from 'react';
import { LucideIcon, Plus } from 'lucide-react';
import { XOSIconName, XOSModuleIcon } from '../icons/XOSIcons';
import { BlurText } from '../ui/BlurText';

interface EmptyStateProps {
  icon?: LucideIcon;
  iconName?: XOSIconName;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  iconName,
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
      <div className="w-11 h-11 rounded-2xl bg-[#f5f5f7] flex items-center justify-center text-[#0071e3] shrink-0">
        {iconName ? (
          <XOSModuleIcon name={iconName} isActive size={20} />
        ) : Icon ? (
          <Icon className="w-5 h-5 stroke-[1.6]" />
        ) : null}
      </div>
      <div className="space-y-1 max-w-sm">
        <BlurText
          as="h3"
          mode="mount"
          blurPx={5}
          distance={6}
          className="font-semibold text-base text-[#1d1d1f] tracking-[-0.015em]"
        >
          {title}
        </BlurText>
        <p className="text-[13px] sm:text-sm text-[#6e6e73] font-normal leading-relaxed">
          {description}
        </p>
      </div>
      {actionLabel && onAction && (
        <div className="pt-2">
          <button
            onClick={onAction}
            type="button"
            className="inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-[40px] px-4 py-2 rounded-xl bg-[#0071e3] hover:bg-[#0077ed] active:scale-[0.985] text-white text-[13px] font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3] cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{actionLabel}</span>
          </button>
        </div>
      )}
    </div>
  );
};
