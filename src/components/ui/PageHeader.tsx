import React from 'react';
import { BlurText } from './BlurText';

interface PageHeaderProps {
  title: string;
  description?: string;
  kicker?: string;
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  kicker,
  actions,
  className = ''
}) => {
  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-end justify-between gap-3 sm:gap-4 pb-5 border-b border-black/[0.06] ${className}`}
    >
      <div className="min-w-0">
        {kicker && (
          <p className="text-xs font-medium text-[#0071e3] mb-1">
            {kicker}
          </p>
        )}
        <BlurText
          as="h2"
          mode="mount"
          blurPx={7}
          distance={8}
          className="xos-page-title text-[24px] sm:text-[28px] font-semibold text-[#1d1d1f]"
        >
          {title}
        </BlurText>
        {description && (
          <BlurText
            as="p"
            mode="mount"
            delay={0.07}
            blurPx={5}
            distance={6}
            className="text-[13px] sm:text-sm text-[#6e6e73] mt-1.5 leading-relaxed max-w-2xl"
          >
            {description}
          </BlurText>
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
