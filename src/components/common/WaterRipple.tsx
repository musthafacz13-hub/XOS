import React, { useEffect, useRef, useState } from 'react';

export interface Ripple {
  x: number;
  y: number;
  size: number;
  id: number;
}

interface WaterRippleContainerProps {
  children: React.ReactNode;
  className?: string;
  rippleColor?: string;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  disabled?: boolean;
}

export const WaterRippleContainer: React.FC<WaterRippleContainerProps> = ({
  children,
  className = '',
  rippleColor = 'rgba(135, 206, 235, 0.25)', // Sky blue soft liquid tint
  onClick,
  disabled = false
}) => {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timerId) => clearTimeout(timerId));
      timers.clear();
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const size = Math.max(rect.width, rect.height) * 1.5;
    const newRipple: Ripple = {
      x,
      y,
      size,
      id: Date.now() + Math.random()
    };

    setRipples(prev => [...prev.slice(-3), newRipple]);

    const timerId = setTimeout(() => {
      timersRef.current.delete(timerId);
      setRipples(prev => prev.filter(r => r.id !== newRipple.id));
    }, 450);
    timersRef.current.add(timerId);
  };

  return (
    <div
      onPointerDown={handlePointerDown}
      onClick={onClick}
      className={`relative overflow-hidden ${className}`}
    >
      {children}
      {ripples.map(ripple => (
        <span
          key={ripple.id}
          style={{
            top: ripple.y - ripple.size / 2,
            left: ripple.x - ripple.size / 2,
            width: ripple.size,
            height: ripple.size,
            backgroundColor: rippleColor
          }}
          className="pointer-events-none absolute rounded-full animate-water-ripple"
        />
      ))}
    </div>
  );
};
