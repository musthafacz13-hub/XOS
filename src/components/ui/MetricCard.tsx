import React from 'react';

interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  sublabel?: React.ReactNode;
  variant?: 'default' | 'subtle' | 'focal' | 'plain';
  tone?: 'default' | 'positive' | 'negative' | 'accent';
  progress?: number;
  className?: string;
}

const VALUE_TONE_CLASS = {
  default: 'text-[#1d1d1f]',
  positive: 'text-[#1f7a4c]',
  negative: 'text-[#c92a2a]',
  accent: 'text-[#0071e3]'
} as const;

export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  sublabel,
  variant = 'default',
  tone = 'default',
  progress,
  className = ''
}) => {
  const surfaceClass =
    variant === 'plain'
      ? 'bg-transparent border-0 p-0'
      : variant === 'focal'
        ? 'bg-[#f5f5f7] border border-black/[0.06] rounded-2xl p-4 sm:p-5'
        : variant === 'subtle'
          ? 'bg-[#f5f5f7] border border-transparent rounded-2xl p-4 sm:p-5'
          : 'bg-white border border-black/[0.08] rounded-2xl p-4 sm:p-5';

  return (
    <div
      className={`flex flex-col justify-between gap-2.5 ${surfaceClass} ${className}`}
    >
      <div className="space-y-1.5">
        <span className="block text-[12px] font-medium text-[#6e6e73]">
          {label}
        </span>
        <div
          className={`text-2xl sm:text-[28px] font-semibold tracking-[-0.025em] font-mono tabular-nums leading-tight ${VALUE_TONE_CLASS[tone]}`}
        >
          {value}
        </div>
      </div>

      {typeof progress === 'number' && Number.isFinite(progress) && (
        <div className="w-full h-1.5 rounded-full bg-black/[0.06] overflow-hidden">
          <div
            className="h-full rounded-full bg-[#0071e3] transition-all duration-300"
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </div>
      )}

      {sublabel && (
        <div className="text-xs text-[#6e6e73] leading-snug">
          {sublabel}
        </div>
      )}
    </div>
  );
};
