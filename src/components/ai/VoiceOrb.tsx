import React from 'react';
import { Mic, Square } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { JarvisVoiceState } from '../../hooks/useJarvisVoice';

interface VoiceOrbProps {
  state: JarvisVoiceState;
  audioLevel: number;
  onPress: () => void;
  disabled?: boolean;
}

const HARMONIC_BARS = [
  { delay: 0, baseHeight: 0.42 },
  { delay: 0.12, baseHeight: 0.78 },
  { delay: 0.24, baseHeight: 1.0 },
  { delay: 0.16, baseHeight: 0.72 },
  { delay: 0.08, baseHeight: 0.45 }
];

export const VoiceOrb: React.FC<VoiceOrbProps> = React.memo(({
  state,
  audioLevel,
  onPress,
  disabled = false
}) => {
  const prefersReducedMotion = useReducedMotion();

  const ariaLabel =
    state === 'listening'
      ? 'Stop listening and process voice input'
      : state === 'speaking'
        ? 'Stop speaking and start listening'
        : state === 'thinking'
          ? 'Processing your request'
          : 'Activate voice assistant microphone';

  const dynamicMicScale =
    state === 'listening' && !prefersReducedMotion
      ? 1 + Math.min(0.22, audioLevel * 0.22)
      : 1;

  return (
    <div className="relative flex items-center justify-center w-44 h-44 sm:w-48 sm:h-48 select-none">
      {/* Outer Ambient Halo Ring */}
      <motion.div
        aria-hidden="true"
        animate={
          prefersReducedMotion
            ? { scale: 1, opacity: state === 'idle' ? 0.35 : 0.75 }
            : state === 'listening'
              ? {
                  scale: [1, 1.14, 1],
                  opacity: [0.45, 0.85, 0.45]
                }
              : state === 'speaking'
                ? {
                    scale: [1, 1.09, 1],
                    opacity: [0.5, 0.88, 0.5]
                  }
                : state === 'thinking'
                  ? {
                      scale: 1.04,
                      opacity: 0.65
                    }
                  : {
                      scale: 1,
                      opacity: 0.32
                    }
        }
        transition={
          state === 'listening' || state === 'speaking'
            ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut' }
            : { duration: 0.35, ease: [0.16, 1, 0.3, 1] }
        }
        className="absolute inset-2 rounded-full border border-[#87CEEB]/60 pointer-events-none"
      />

      {/* Secondary Ripple Ring (Listening / Speaking) */}
      {(state === 'listening' || state === 'speaking') && !prefersReducedMotion && (
        <motion.div
          aria-hidden="true"
          initial={{ scale: 0.88, opacity: 0.55 }}
          animate={{ scale: 1.24, opacity: 0 }}
          transition={{ duration: 1.7, repeat: Infinity, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-4 rounded-full border border-[#87CEEB]/50 pointer-events-none"
        />
      )}

      {/* Thinking Orbital Arc */}
      {state === 'thinking' && (
        <motion.div
          aria-hidden="true"
          animate={prefersReducedMotion ? undefined : { rotate: 360 }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
          className="absolute inset-4 rounded-full border-2 border-transparent border-t-[#87CEEB] border-r-[#111111]/40 pointer-events-none"
        />
      )}

      {/* Live Audio Amplitude Scale Wrapper */}
      <motion.div
        animate={{ scale: dynamicMicScale }}
        transition={{ duration: 0.1, ease: 'easeOut' }}
        className="relative flex items-center justify-center"
      >
        <motion.button
          type="button"
          onClick={onPress}
          disabled={disabled || state === 'thinking'}
          whileHover={disabled || state === 'thinking' ? undefined : { scale: 1.03 }}
          whileTap={disabled || state === 'thinking' ? undefined : { scale: 0.96 }}
          aria-label={ariaLabel}
          className={`relative w-28 h-28 sm:w-32 sm:h-32 rounded-full flex flex-col items-center justify-center transition-colors duration-200 cursor-pointer disabled:cursor-wait focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB] focus-visible:ring-offset-4 ${
            state === 'listening'
              ? 'bg-[#111111] text-white border-2 border-[#87CEEB] shadow-[0_14px_38px_rgba(135,206,235,0.28)]'
              : state === 'speaking'
                ? 'bg-[#111111] text-white border border-[#87CEEB]/80 shadow-[0_14px_36px_rgba(17,17,17,0.16)]'
                : state === 'thinking'
                  ? 'bg-[#111111] text-white border border-neutral-700 shadow-[0_12px_32px_rgba(17,17,17,0.14)]'
                  : 'bg-[#111111] text-white border border-black/10 hover:bg-black shadow-[0_12px_30px_rgba(17,17,17,0.12)]'
          }`}
        >
          {/* Subtle Inner Hairline Ring */}
          <span
            aria-hidden="true"
            className="absolute inset-2 rounded-full border border-white/10 pointer-events-none"
          />

          {state === 'speaking' ? (
            <div className="flex items-center justify-center gap-1.5 h-8" aria-hidden="true">
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
                    duration: 0.95,
                    delay: bar.delay,
                    repeat: Infinity,
                    ease: 'easeInOut'
                  }}
                  className="w-1 h-7 rounded-full bg-[#87CEEB] origin-center"
                />
              ))}
            </div>
          ) : state === 'thinking' ? (
            <div className="flex items-center justify-center gap-1.5 h-8" aria-hidden="true">
              {[0, 0.18, 0.36].map((delay, idx) => (
                <motion.span
                  key={idx}
                  animate={
                    prefersReducedMotion
                      ? { opacity: 0.7 }
                      : { opacity: [0.35, 1, 0.35], y: [0, -3, 0] }
                  }
                  transition={{ duration: 0.9, delay, repeat: Infinity, ease: 'easeInOut' }}
                  className="w-1.5 h-1.5 rounded-full bg-[#87CEEB]"
                />
              ))}
            </div>
          ) : state === 'listening' ? (
            <div className="flex flex-col items-center gap-1.5">
              <Square className="w-6 h-6 text-[#87CEEB] fill-[#87CEEB]" />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <Mic className="w-7 h-7 text-[#87CEEB]" />
            </div>
          )}
        </motion.button>
      </motion.div>
    </div>
  );
});
