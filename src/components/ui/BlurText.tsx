/**
 * BlurText — Apple-inspired Blur-to-Sharp Text Reveal
 * Selectively applied to hero headings, page titles, section headers, and key descriptions.
 * Never obscures table cells, numbers, inputs, or navigation labels; respects reduced motion.
 */
import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { MOTION_EASINGS, MOTION_TIMINGS } from '../../utils/motion';

type RevealTag = 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'span' | 'div';

interface BlurTextProps {
  as?: RevealTag;
  children: React.ReactNode;
  className?: string;
  delay?: number;
  mode?: 'mount' | 'scroll';
  distance?: number;
  blurPx?: number;
}

const MOTION_TAGS = {
  h1: motion.h1,
  h2: motion.h2,
  h3: motion.h3,
  h4: motion.h4,
  p: motion.p,
  span: motion.span,
  div: motion.div
} as const;

export const BlurText: React.FC<BlurTextProps> = ({
  as = 'div',
  children,
  className = '',
  delay = 0,
  mode = 'mount',
  distance = 10,
  blurPx = 8
}) => {
  const prefersReducedMotion = useReducedMotion();
  const Component = MOTION_TAGS[as];

  if (prefersReducedMotion) {
    const StaticTag = as;
    return <StaticTag className={className}>{children}</StaticTag>;
  }

  const initial = {
    opacity: 0,
    y: distance,
    filter: `blur(${blurPx}px)`
  };

  const visible = {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)'
  };

  const transition = {
    duration: MOTION_TIMINGS.reveal,
    delay,
    ease: MOTION_EASINGS.soft
  };

  if (mode === 'scroll') {
    return (
      <Component
        initial={initial}
        whileInView={visible}
        viewport={{ once: true, amount: 0.15 }}
        transition={transition}
        className={className}
      >
        {children}
      </Component>
    );
  }

  return (
    <Component
      initial={initial}
      animate={visible}
      transition={transition}
      className={className}
    >
      {children}
    </Component>
  );
};
