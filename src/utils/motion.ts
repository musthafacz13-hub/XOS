/**
 * XOS Centralized Motion System & Animation Tokens
 * Precision Apple-inspired deceleration curves, blur-to-sharp text reveals,
 * navigation indicator springs, and restrained interactive feedback.
 */
import type { Transition, Variants } from 'motion/react';

export const MOTION_TIMINGS = {
  instant: 0.12,
  quick: 0.16,
  base: 0.22,
  smooth: 0.28,
  gentle: 0.36,
  reveal: 0.56,
  revealSlow: 0.68
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
  gentle: { duration: 0.26, ease: [0.22, 1, 0.36, 1] },
  navIndicator: { type: 'spring', stiffness: 440, damping: 36, mass: 0.9 },
  bouncy: { duration: 0.22, ease: [0.16, 1, 0.3, 1] }
};

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
    transition: {
      duration: MOTION_TIMINGS.instant,
      ease: MOTION_EASINGS.standard
    }
  }
};

export const blurRevealVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 10,
    filter: 'blur(8px)'
  },
  visible: (delay = 0) => ({
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: {
      duration: MOTION_TIMINGS.reveal,
      delay,
      ease: MOTION_EASINGS.soft
    }
  })
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
    y: 8
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
    scale: 0.985,
    y: 4,
    transition: {
      duration: MOTION_TIMINGS.instant,
      ease: MOTION_EASINGS.easeIn
    }
  }
};

export const dropdownVariants: Variants = {
  initial: {
    opacity: 0,
    scale: 0.97,
    y: -4
  },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      duration: MOTION_TIMINGS.quick,
      ease: MOTION_EASINGS.fluid
    }
  },
  exit: {
    opacity: 0,
    scale: 0.97,
    y: -2,
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
    opacity: 0.9
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
