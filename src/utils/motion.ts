/**
 * XOS Centralized Motion System & Animation Tokens
 * Fluid, natural, water-inspired physics and micro-interactions
 */
import type { Transition, Variants } from 'motion/react';

export const MOTION_TIMINGS = {
  instant: 0.12,
  quick: 0.18,
  base: 0.24,
  smooth: 0.32,
  gentle: 0.4
} as const;

export const MOTION_EASINGS = {
  // Fluid, water-like natural deceleration curve
  fluid: [0.16, 1, 0.3, 1] as const,
  soft: [0.22, 1, 0.36, 1] as const,
  anticipate: [0.38, 0.005, 0.215, 1] as const,
  standard: [0.4, 0, 0.2, 1] as const,
  easeIn: [0.4, 0, 1, 1] as const,
  easeOut: [0, 0, 0.2, 1] as const
};

export const MOTION_SPRINGS: Record<string, Transition> = {
  tactile: { type: 'spring', damping: 24, stiffness: 380, mass: 0.8 },
  snappy: { type: 'spring', damping: 22, stiffness: 320, mass: 0.7 },
  gentle: { type: 'spring', damping: 28, stiffness: 240, mass: 1 },
  bouncy: { type: 'spring', damping: 18, stiffness: 280, mass: 0.8 }
};

// Route / Screen Page Transitions
export const pageVariants: Variants = {
  initial: { 
    opacity: 0, 
    y: 6
  },
  animate: { 
    opacity: 1, 
    y: 0,
    transition: {
      duration: MOTION_TIMINGS.base,
      ease: MOTION_EASINGS.fluid
    }
  },
  exit: { 
    opacity: 0, 
    y: -4,
    transition: {
      duration: MOTION_TIMINGS.instant,
      ease: MOTION_EASINGS.standard
    }
  }
};

// Modal Dialog Variants
export const modalBackdropVariants: Variants = {
  initial: { opacity: 0 },
  animate: { 
    opacity: 1, 
    transition: { duration: MOTION_TIMINGS.quick, ease: MOTION_EASINGS.easeOut }
  },
  exit: { 
    opacity: 0, 
    transition: { duration: MOTION_TIMINGS.instant, ease: MOTION_EASINGS.easeIn }
  }
};

export const modalContentVariants: Variants = {
  initial: { 
    opacity: 0, 
    scale: 0.96, 
    y: 10 
  },
  animate: { 
    opacity: 1, 
    scale: 1, 
    y: 0,
    transition: { 
      duration: MOTION_TIMINGS.base, 
      ease: MOTION_EASINGS.fluid 
    }
  },
  exit: { 
    opacity: 0, 
    scale: 0.97, 
    y: 6,
    transition: { 
      duration: MOTION_TIMINGS.instant, 
      ease: MOTION_EASINGS.easeIn
    }
  }
};

// Bottom Sheet Variants (for Mobile Navigation and Submenus)
export const sheetBackdropVariants: Variants = {
  initial: { opacity: 0 },
  animate: { 
    opacity: 1, 
    transition: { duration: MOTION_TIMINGS.quick }
  },
  exit: { 
    opacity: 0, 
    transition: { duration: MOTION_TIMINGS.instant }
  }
};

export const sheetContentVariants: Variants = {
  initial: { 
    y: '100%',
    opacity: 0.6
  },
  animate: { 
    y: 0,
    opacity: 1,
    transition: { 
      type: 'spring',
      damping: 26,
      stiffness: 320,
      mass: 0.8
    }
  },
  exit: { 
    y: '100%',
    opacity: 0,
    transition: { 
      duration: MOTION_TIMINGS.quick,
      ease: MOTION_EASINGS.easeIn
    }
  }
};

// Staggered Submenu Grid Items (e.g. Money Financial Records)
export const submenuContainerVariants: Variants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.045,
      delayChildren: 0.03
    }
  },
  exit: {
    transition: {
      staggerChildren: 0.02,
      staggerDirection: -1
    }
  }
};

export const submenuItemVariants: Variants = {
  initial: { 
    opacity: 0, 
    y: 12,
    scale: 0.95
  },
  animate: { 
    opacity: 1, 
    y: 0, 
    scale: 1,
    transition: { 
      duration: MOTION_TIMINGS.base,
      ease: MOTION_EASINGS.fluid
    }
  },
  exit: { 
    opacity: 0, 
    scale: 0.96,
    transition: { duration: MOTION_TIMINGS.instant }
  }
};

// Tactile Press Micro-interactions for interactive elements
export const tapScale = {
  button: { scale: 0.97, transition: { duration: 0.1 } },
  subtle: { scale: 0.985, transition: { duration: 0.1 } },
  card: { scale: 0.99, transition: { duration: 0.1 } },
  icon: { scale: 0.92, transition: { duration: 0.1 } }
};
