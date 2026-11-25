import React from 'react';
import { LucideIcon } from 'lucide-react';

interface ActionIconButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  variant?: 'neutral' | 'edit' | 'delete';
  disabled?: boolean;
  className?: string;
}

export const ActionIconButton: React.FC<ActionIconButtonProps> = ({
  icon: Icon,
  label,
  onClick,
  variant = 'neutral',
  disabled = false,
  className = ''
}) => {
  const toneClass =
    variant === 'delete'
      ? 'text-[#86868b] hover:text-rose-600 hover:bg-rose-50'
      : 'text-[#86868b] hover:text-[#1d1d1f] hover:bg-[#f5f5f7]';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] inline-flex items-center justify-center rounded-xl transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0284c7] disabled:opacity-40 disabled:cursor-not-allowed ${toneClass} ${className}`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
};
