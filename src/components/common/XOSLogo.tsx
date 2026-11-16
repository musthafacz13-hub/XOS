import React from 'react';

type XOSLogoSize = 'xs' | 'sm' | 'md' | 'lg';

interface XOSLogoProps {
  size?: XOSLogoSize;
  className?: string;
  alt?: string;
  priority?: boolean;
}

const SIZE_CLASSES: Record<XOSLogoSize, { box: string; px: number }> = {
  xs: { box: 'w-6 h-6 rounded-lg p-0.5', px: 24 },
  sm: { box: 'w-8 h-8 rounded-xl p-1', px: 32 },
  md: { box: 'w-9 h-9 rounded-xl p-1', px: 36 },
  lg: { box: 'w-16 h-16 rounded-2xl p-1.5', px: 64 }
};

export const XOSLogo: React.FC<XOSLogoProps> = ({
  size = 'md',
  className = '',
  alt = 'XOS Logo',
  priority = false
}) => {
  const { box, px } = SIZE_CLASSES[size];

  return (
    <div
      className={`bg-white border border-black/[0.08] flex items-center justify-center shrink-0 overflow-hidden shadow-xs ${box} ${className}`}
    >
      <img
        src="/assets/branding/xos-logo.png"
        alt={alt}
        width={px}
        height={px}
        loading={priority ? 'eager' : undefined}
        fetchPriority={priority ? 'high' : undefined}
        decoding="async"
        draggable={false}
        className="w-full h-full object-contain select-none"
      />
    </div>
  );
};
