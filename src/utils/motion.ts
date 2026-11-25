/**
 * XOS Centralized Motion System & Animation Tokens
 * Calm, restrained Apple-style deceleration curves without playful overshoot.
 */
import type { Transition, Variants } from 'motion/react';

export const MOTION_TIMINGS = {
  instant: 0.12,
  quick: 0.16,
  base: 0.2,
  smooth: 0.26,
  gentle: 0.32
} as const;

export const MOTION_EASINGS = {
  fluid: [0.16, 1, 0.3, 1] as const,
  soft: [0.22, 1, 0.36, 1] as const,
  anticipate: [0.25, 0.1, 0.25, 1] as const,
  standard: [0.25, 0.1, 0.25, 1] as const,
  easeIn: [0.4, 0, 1, 1] as const,
  easeOut: [0, 0, 0.2, 1] as const
};

export const MOTION_SPRINGS: Record<string, Transition> = {
  tactile: { duration: 0.18, ease: [0.16, 1, 0.3, 1] },
  snappy: { duration: 0.16, ease: [0.16, 1, 0.3, 1] },
  gentle: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
  bouncy: { duration: 0.2, ease: [0.16, 1, 0.3, 1] }
};

export const pageVariants: Variants = {
  initial: {
    opacity: 0,
    y: 4
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
    transition: {
      duration: MOTION_TIMINGS.instant,
      ease: MOTION_EASINGS.standard
    }
  }
};

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
    scale: 0.98,
    y: 6
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
    scale: 0.98,
    y: 4,
    transition: {
      duration: MOTION_TIMINGS.instant,
      ease: MOTION_EASINGS.easeIn
    }
  }
};

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
    opacity: 0.85
  },
  animate: {
    y: 0,
    opacity: 1,
    transition: {
      duration: MOTION_TIMINGS.smooth,
      ease: MOTION_EASINGS.fluid
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

export const submenuContainerVariants: Variants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.025,
      delayChildren: 0.01
    }
  },
  exit: {
    transition: {
      staggerChildren: 0.015,
      staggerDirection: -1
    }
  }
};

export const submenuItemVariants: Variants = {
  initial: {
    opacity: 0,
    y: 6
  },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      duration: MOTION_TIMINGS.quick,
      ease: MOTION_EASINGS.fluid
    }
  },
  exit: {
    opacity: 0,
    transition: { duration: MOTION_TIMINGS.instant }
  }
};

export const tapScale = {
  button: { scale: 0.985, transition: { duration: 0.1 } },
  subtle: { scale: 0.99, transition: { duration: 0.1 } },
  card: { scale: 0.995, transition: { duration: 0.1 } },
  icon: { scale: 0.94, transition: { duration: 0.1 } }
};
