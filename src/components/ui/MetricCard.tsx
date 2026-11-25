import React from 'react';

interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  sublabel?: React.ReactNode;
  variant?: 'default' | 'subtle' | 'focal';
  tone?: 'default' | 'positive' | 'negative' | 'accent';
  progress?: number;
  className?: string;
}

const VALUE_TONE_CLASS = {
  default: 'text-[#1d1d1f]',
  positive: 'text-emerald-700',
  negative: 'text-rose-600',
  accent: 'text-[#0284c7]'
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
    variant === 'focal'
      ? 'bg-[#f5f5f7] border border-black/[0.06]'
      : variant === 'subtle'
        ? 'bg-[#f5f5f7] border border-transparent'
        : 'bg-white border border-black/[0.08]';

  return (
    <div
      className={`rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-2.5 ${surfaceClass} ${className}`}
    >
      <div className="space-y-1.5">
        <span className="block text-[11px] font-medium text-[#6e6e73] tracking-normal">
          {label}
        </span>
        <div
          className={`text-2xl sm:text-[28px] font-semibold tracking-[-0.02em] font-mono tabular-nums leading-tight ${VALUE_TONE_CLASS[tone]}`}
        >
          {value}
        </div>
      </div>

      {typeof progress === 'number' && Number.isFinite(progress) && (
        <div className="w-full h-1.5 rounded-full bg-black/[0.06] overflow-hidden">
          <div
            className="h-full rounded-full bg-[#0284c7] transition-all duration-300"
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
