import React from 'react';

type JarvisLogoSize = 'xs' | 'sm' | 'md' | 'lg';

interface JarvisLogoProps {
  size?: JarvisLogoSize;
  className?: string;
  decorative?: boolean;
}

const SIZE_CLASSES: Record<JarvisLogoSize, { box: string; px: number }> = {
  xs: { box: 'w-6 h-6 rounded-lg p-1', px: 24 },
  sm: { box: 'w-8 h-8 rounded-xl p-1.5', px: 32 },
  md: { box: 'w-10 h-10 rounded-xl p-1.5', px: 40 },
  lg: { box: 'w-14 h-14 rounded-2xl p-2.5', px: 56 }
};

/**
 * Dedicated Jarvis AI emblem used exclusively inside the Jarvis AI section.
 * Crisp Apple-minimal geometry with black ink and subtle sky-blue accents.
 */
export const JarvisLogo: React.FC<JarvisLogoProps> = ({
  size = 'sm',
  className = '',
  decorative = true
}) => {
  const { box, px } = SIZE_CLASSES[size];

  return (
    <div
      data-testid="jarvis-logo"
      className={`bg-white border border-black/[0.08] flex items-center justify-center shrink-0 select-none shadow-2xs ${box} ${className}`}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': 'Jarvis AI Logo' })}
    >
      <svg
        width={px}
        height={px}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
      >
        {/* Outer precision optical arcs */}
        <path
          d="M16 3.25A12.75 12.75 0 0 1 28.75 16"
          stroke="#111111"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
        <path
          d="M26.95 22.45A12.75 12.75 0 0 1 5.05 22.45"
          stroke="#111111"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
        <path
          d="M3.25 16A12.75 12.75 0 0 1 11.45 4.08"
          stroke="#0284C7"
          strokeWidth="2.1"
          strokeLinecap="round"
        />

        {/* Inner sky-blue neural ring */}
        <circle
          cx="16"
          cy="16"
          r="8.25"
          stroke="#38BDF8"
          strokeWidth="1.5"
          strokeDasharray="11 4.5"
          strokeLinecap="round"
        />

        {/* Cardinal telemetry ticks */}
        <path
          d="M16 6.2V8.1M16 23.9V25.8M6.2 16H8.1M23.9 16H25.8"
          stroke="#111111"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeOpacity="0.65"
        />

        {/* Core aperture */}
        <circle
          cx="16"
          cy="16"
          r="4.2"
          fill="#111111"
        />
        <circle
          cx="16"
          cy="16"
          r="1.9"
          fill="#38BDF8"
        />
      </svg>
    </div>
  );
};
