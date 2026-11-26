/**
 * Custom XOS SVG Icon Family
 * Original geometric 20x20 vector icons crafted specifically for XOS modules.
 * Dual optical states (clean stroke in default, subtle tinted interior + crisp line in active)
 * with restrained Motion micro-animations triggered strictly on selection or hover/focus.
 */
import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { MOTION_EASINGS } from '../../utils/motion';

export type XOSIconName =
  | 'dashboard'
  | 'goals'
  | 'expenses'
  | 'income'
  | 'debt'
  | 'attendance'
  | 'salary'
  | 'savings'
  | 'reports'
  | 'notes'
  | 'ai-agent'
  | 'settings'
  | 'money';

export interface XOSIconProps {
  name: XOSIconName;
  isActive?: boolean;
  isHovered?: boolean;
  size?: number;
  className?: string;
}

const STROKE_WIDTH = 1.55;

export const XOSModuleIcon: React.FC<XOSIconProps> = React.memo(({
  name,
  isActive = false,
  isHovered = false,
  size = 18,
  className = ''
}) => {
  const reduced = useReducedMotion();
  const engaged = isActive || isHovered;
  const fillOpacity = isActive ? 0.16 : 0;
  const transition = { duration: reduced ? 0 : 0.24, ease: MOTION_EASINGS.fluid };

  const sharedSvgProps = {
    width: size,
    height: size,
    viewBox: '0 0 20 20',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    'aria-hidden': true as const,
    className: `shrink-0 ${className}`
  };

  switch (name) {
    case 'dashboard':
      return (
        <svg {...sharedSvgProps}>
          <motion.rect
            x="2.75"
            y="2.75"
            width="6.25"
            height="7.75"
            rx="2"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            fill="currentColor"
            animate={{
              fillOpacity,
              y: engaged && !reduced ? -0.5 : 0
            }}
            transition={transition}
          />
          <motion.rect
            x="11"
            y="2.75"
            width="6.25"
            height="5.25"
            rx="1.8"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            fill="currentColor"
            animate={{
              fillOpacity: isActive ? 0.1 : 0,
              x: engaged && !reduced ? 0.4 : 0
            }}
            transition={transition}
          />
          <motion.rect
            x="2.75"
            y="12.5"
            width="6.25"
            height="4.75"
            rx="1.8"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            fill="currentColor"
            animate={{
              fillOpacity: isActive ? 0.1 : 0,
              x: engaged && !reduced ? -0.4 : 0
            }}
            transition={transition}
          />
          <motion.rect
            x="11"
            y="10"
            width="6.25"
            height="7.25"
            rx="2"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            fill="currentColor"
            animate={{
              fillOpacity,
              y: engaged && !reduced ? 0.5 : 0
            }}
            transition={transition}
          />
        </svg>
      );

    case 'goals':
    case 'savings':
      return (
        <svg {...sharedSvgProps}>
          <circle
            cx="10"
            cy="10"
            r="7.25"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            fill="currentColor"
            fillOpacity={isActive ? 0.08 : 0}
          />
          <motion.circle
            cx="10"
            cy="10"
            r="4.25"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            animate={
              reduced
                ? undefined
                : { scale: engaged ? 1.06 : 1, opacity: engaged ? 1 : 0.88 }
            }
            style={{ originX: '10px', originY: '10px' }}
            transition={transition}
          />
          <motion.circle
            cx="10"
            cy="10"
            r="1.5"
            fill="currentColor"
            animate={reduced ? undefined : { scale: isActive ? 1.18 : 1 }}
            style={{ originX: '10px', originY: '10px' }}
            transition={transition}
          />
        </svg>
      );

    case 'expenses':
      return (
        <svg {...sharedSvgProps}>
          <rect
            x="2.5"
            y="4"
            width="15"
            height="12"
            rx="2.75"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            fill="currentColor"
            fillOpacity={fillOpacity}
          />
          <path
            d="M3 8.25H17"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
          />
          <motion.g
            animate={reduced ? undefined : { y: engaged ? 1.2 : 0 }}
            transition={transition}
          >
            <path
              d="M12.5 11.25V14.25M12.5 14.25L10.75 12.6M12.5 14.25L14.25 12.6"
              stroke="currentColor"
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </motion.g>
          <path
            d="M6 12.75H8.5"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
          />
        </svg>
      );

    case 'income':
      return (
        <svg {...sharedSvgProps}>
          <rect
            x="2.5"
            y="3.25"
            width="15"
            height="13.5"
            rx="3"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            fill="currentColor"
            fillOpacity={isActive ? 0.08 : 0}
          />
          <motion.g
            animate={reduced ? undefined : { y: engaged ? -1.1 : 0 }}
            transition={transition}
          >
            <path
              d="M6.25 12.75L9.25 9.75L11.5 11.5L14.25 7.5"
              stroke="currentColor"
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M11.75 7.25H14.5V10"
              stroke="currentColor"
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </motion.g>
        </svg>
      );

    case 'debt':
    case 'money':
      return (
        <svg {...sharedSvgProps}>
          <circle
            cx="10"
            cy="10"
            r="7.25"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            fill="currentColor"
            fillOpacity={isActive ? 0.1 : 0}
          />
          <motion.g
            animate={reduced ? undefined : { x: engaged ? 1.1 : 0 }}
            transition={transition}
          >
            <path
              d="M6.5 8H13.5M13.5 8L11.5 6"
              stroke="currentColor"
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </motion.g>
          <motion.g
            animate={reduced ? undefined : { x: engaged ? -1.1 : 0 }}
            transition={transition}
          >
            <path
              d="M13.5 12H6.5M6.5 12L8.5 14"
              stroke="currentColor"
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </motion.g>
        </svg>
      );

    case 'attendance':
      return (
        <svg {...sharedSvgProps}>
          <rect
            x="2.75"
            y="4"
            width="14.5"
            height="13.25"
            rx="2.75"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            fill="currentColor"
            fillOpacity={isActive ? 0.1 : 0}
          />
          <path
            d="M6.5 2.5V5.25M13.5 2.5V5.25M3.25 7.75H16.75"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
          />
          <motion.path
            d="M7.25 12.25L9.15 14L13 10.25"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={false}
            animate={
              reduced
                ? { pathLength: 1 }
                : { pathLength: engaged ? 1 : 0.92, scale: engaged ? 1.04 : 1 }
            }
            style={{ originX: '10px', originY: '12px' }}
            transition={transition}
          />
        </svg>
      );

    case 'salary':
      return (
        <svg {...sharedSvgProps}>
          <path
            d="M5 3.25H12.5L15.75 6.5V16.75C15.75 17.16 15.41 17.5 15 17.5H5C4.59 17.5 4.25 17.16 4.25 16.75V4C4.25 3.59 4.59 3.25 5 3.25Z"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            strokeLinejoin="round"
            fill="currentColor"
            fillOpacity={isActive ? 0.1 : 0}
          />
          <path
            d="M12.25 3.5V6.75H15.5"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            strokeLinejoin="round"
          />
          <motion.g
            animate={reduced ? undefined : { y: engaged ? -0.6 : 0 }}
            transition={transition}
          >
            <path
              d="M7.25 10.25H12.75M7.25 13.5H11"
              stroke="currentColor"
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
            />
          </motion.g>
        </svg>
      );

    case 'reports':
      return (
        <svg {...sharedSvgProps}>
          <path
            d="M3.25 3.5V16.25H16.75"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <motion.path
            d="M5.75 13.25L8.75 9.5L11.75 11.5L15.5 6.5"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={false}
            animate={reduced ? { pathLength: 1 } : { pathLength: engaged ? 1 : 0.92 }}
            transition={transition}
          />
          <motion.circle
            cx="15.5"
            cy="6.5"
            r="1.25"
            fill="currentColor"
            animate={reduced ? undefined : { scale: engaged ? 1.25 : 1 }}
            style={{ originX: '15.5px', originY: '6.5px' }}
            transition={transition}
          />
        </svg>
      );

    case 'notes':
      return (
        <svg {...sharedSvgProps}>
          <rect
            x="3.25"
            y="2.75"
            width="13.5"
            height="14.5"
            rx="2.75"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            fill="currentColor"
            fillOpacity={isActive ? 0.1 : 0}
          />
          <path
            d="M6.5 7.25H13.5M6.5 10.25H13.5"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
          />
          <motion.path
            d="M6.5 13.25H10.5"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            animate={reduced ? undefined : { pathLength: engaged ? 1 : 0.78 }}
            transition={transition}
          />
        </svg>
      );

    case 'ai-agent':
      return (
        <svg {...sharedSvgProps}>
          <motion.path
            d="M3.5 8.5V11.5"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            animate={reduced ? undefined : { scaleY: engaged ? 1.3 : 1 }}
            style={{ originX: '3.5px', originY: '10px' }}
            transition={transition}
          />
          <motion.path
            d="M6.75 6V14"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            animate={reduced ? undefined : { scaleY: engaged ? 0.82 : 1 }}
            style={{ originX: '6.75px', originY: '10px' }}
            transition={transition}
          />
          <motion.path
            d="M10 3.75V16.25"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            animate={reduced ? undefined : { scaleY: engaged ? 1.08 : 1 }}
            style={{ originX: '10px', originY: '10px' }}
            transition={transition}
          />
          <motion.path
            d="M13.25 6V14"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            animate={reduced ? undefined : { scaleY: engaged ? 0.82 : 1 }}
            style={{ originX: '13.25px', originY: '10px' }}
            transition={transition}
          />
          <motion.path
            d="M16.5 8.5V11.5"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            animate={reduced ? undefined : { scaleY: engaged ? 1.3 : 1 }}
            style={{ originX: '16.5px', originY: '10px' }}
            transition={transition}
          />
        </svg>
      );

    case 'settings':
      return (
        <motion.svg
          {...sharedSvgProps}
          animate={reduced ? undefined : { rotate: isActive ? 45 : isHovered ? 22 : 0 }}
          transition={{ duration: reduced ? 0 : 0.34, ease: MOTION_EASINGS.soft }}
        >
          <path
            d="M8.75 2.75H11.25L11.75 4.4C12.22 4.55 12.67 4.74 13.09 4.97L14.65 4.2L16.4 5.95L15.63 7.51C15.86 7.93 16.05 8.38 16.2 8.85L17.85 9.35V11.85L16.2 12.35C16.05 12.82 15.86 13.27 15.63 13.69L16.4 15.25L14.65 17L13.09 16.23C12.67 16.46 12.22 16.65 11.75 16.8L11.25 18.45H8.75L8.25 16.8C7.78 16.65 7.33 16.46 6.91 16.23L5.35 17L3.6 15.25L4.37 13.69C4.14 13.27 3.95 12.82 3.8 12.35L2.15 11.85V9.35L3.8 8.85C3.95 8.38 4.14 7.93 4.37 7.51L3.6 5.95L5.35 4.2L6.91 4.97C7.33 4.74 7.78 4.55 8.25 4.4L8.75 2.75Z"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
            strokeLinejoin="round"
            fill="currentColor"
            fillOpacity={isActive ? 0.1 : 0}
          />
          <circle
            cx="10"
            cy="10.6"
            r="2.4"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH}
          />
        </motion.svg>
      );
  }
});
