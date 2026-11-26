import React from 'react';
import { Mic, Square } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { JarvisVoiceState } from '../../hooks/useJarvisVoice';

interface VoiceOrbProps {
  state: JarvisVoiceState;
  audioLevel: number;
  onPress: () => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

const HARMONIC_BARS = [
  { delay: 0, baseHeight: 0.45 },
  { delay: 0.12, baseHeight: 0.85 },
  { delay: 0.22, baseHeight: 1.0 },
  { delay: 0.14, baseHeight: 0.75 },
  { delay: 0.06, baseHeight: 0.45 }
];

export const VoiceOrb: React.FC<VoiceOrbProps> = React.memo(({
  state,
  audioLevel,
  onPress,
  disabled = false,
  size = 'md'
}) => {
  const prefersReducedMotion = useReducedMotion();
  const isCompact = size === 'sm';

  const ariaLabel =
    state === 'listening'
      ? 'Stop listening and send voice input'
      : state === 'speaking'
        ? 'Stop speaking and start listening'
        : state === 'thinking'
          ? 'Processing request'
          : state === 'error'
            ? 'Retry voice input'
            : 'Tap to speak';

  const dynamicScale =
    state === 'listening' && !prefersReducedMotion
      ? 1 + Math.min(0.12, audioLevel * 0.12)
      : 1;

  const wrapperClass = isCompact ? 'w-12 h-12' : 'w-20 h-20';
  const buttonSizeClass = isCompact ? 'w-11 h-11' : 'w-16 h-16';
  const iconSizeClass = isCompact ? 'w-4 h-4' : 'w-6 h-6';

  return (
    <div className={`relative flex items-center justify-center shrink-0 select-none ${wrapperClass}`}>
      {/* Subtle active ring only when listening or speaking */}
      {(state === 'listening' || state === 'speaking') && !prefersReducedMotion && (
        <motion.span
          aria-hidden="true"
          initial={{ scale: 0.92, opacity: 0.5 }}
          animate={{ scale: 1.18, opacity: 0 }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
          className="absolute inset-0 rounded-full border border-[#0071e3]/50 pointer-events-none"
        />
      )}

      {/* Subtle processing spinner ring */}
      {state === 'thinking' && (
        <motion.span
          aria-hidden="true"
          animate={prefersReducedMotion ? undefined : { rotate: 360 }}
          transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}
          className="absolute inset-0.5 rounded-full border-2 border-black/[0.06] border-t-[#0071e3] pointer-events-none"
        />
      )}

      <motion.div
        animate={{ scale: dynamicScale }}
        transition={{ duration: 0.1, ease: 'easeOut' }}
        className="relative flex items-center justify-center"
      >
        <button
          type="button"
          onClick={onPress}
          disabled={disabled || state === 'thinking'}
          aria-label={ariaLabel}
          className={`relative rounded-full flex items-center justify-center transition-colors duration-150 cursor-pointer disabled:cursor-wait focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3] focus-visible:ring-offset-2 active:scale-95 ${buttonSizeClass} ${
            state === 'listening'
              ? 'bg-[#0071e3] text-white'
              : state === 'error'
                ? 'bg-[#1d1d1f] text-white ring-2 ring-[#c92a2a]/60'
                : 'bg-[#1d1d1f] text-white hover:bg-black'
          }`}
        >
          {state === 'speaking' ? (
            <div className={`flex items-center justify-center gap-0.5 ${isCompact ? 'h-4' : 'h-6'}`} aria-hidden="true">
              {HARMONIC_BARS.map((bar, idx) => (
                <motion.span
                  key={idx}
                  animate={
                    prefersReducedMotion
                      ? { scaleY: bar.baseHeight }
                      : {
                          scaleY: [bar.baseHeight * 0.4, bar.baseHeight, bar.baseHeight * 0.5, bar.baseHeight * 0.9, bar.baseHeight * 0.4]
                        }
                  }
                  transition={{
                    duration: 0.85,
                    delay: bar.delay,
                    repeat: Infinity,
                    ease: 'easeInOut'
                  }}
                  className={`w-0.5 rounded-full bg-[#2997ff] origin-center ${isCompact ? 'h-3.5' : 'h-5'}`}
                />
              ))}
            </div>
          ) : state === 'thinking' ? (
            <div className="flex items-center justify-center gap-1" aria-hidden="true">
              {[0, 0.16, 0.32].map((delay, idx) => (
                <motion.span
                  key={idx}
                  animate={
                    prefersReducedMotion
                      ? { opacity: 0.7 }
                      : { opacity: [0.3, 1, 0.3] }
                  }
                  transition={{ duration: 0.85, delay, repeat: Infinity, ease: 'easeInOut' }}
                  className="w-1 h-1 rounded-full bg-[#2997ff]"
                />
              ))}
            </div>
          ) : state === 'listening' ? (
            <Square className={`${isCompact ? 'w-3.5 h-3.5' : 'w-5 h-5'} text-white fill-white`} />
          ) : (
            <Mic className={`${iconSizeClass} ${state === 'error' ? 'text-[#fca5a5]' : 'text-[#2997ff]'}`} />
          )}
        </button>
      </motion.div>
    </div>
  );
});
