import React, { useEffect, useState } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { XOSLogo } from './XOSLogo';

interface SplashScreenProps {
  error?: string | null;
  onRetry?: () => void;
  onContinue?: () => void;
}

const LOADING_MESSAGES = [
  'Initializing your workspace…',
  'Preparing your personal dashboard…',
  'Securing your experience…',
  'Everything is ready.'
] as const;

export const SplashScreen: React.FC<SplashScreenProps> = ({
  error = null,
  onRetry,
  onContinue
}) => {
  const [messageIndex, setMessageIndex] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = () => setReducedMotion(mq.matches);
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);

  useEffect(() => {
    if (error) return;
    if (reducedMotion) {
      setCharCount(LOADING_MESSAGES[messageIndex].length);
      return;
    }

    const currentText = LOADING_MESSAGES[messageIndex];
    if (charCount < currentText.length) {
      const timer = setTimeout(() => {
        setCharCount(prev => prev + 1);
      }, 28);
      return () => clearTimeout(timer);
    }

    const pauseTimer = setTimeout(() => {
      setMessageIndex(prev => (prev + 1) % LOADING_MESSAGES.length);
      setCharCount(0);
    }, 950);
    return () => clearTimeout(pauseTimer);
  }, [charCount, messageIndex, reducedMotion, error]);

  const displayedText = reducedMotion
    ? LOADING_MESSAGES[0]
    : LOADING_MESSAGES[messageIndex].slice(0, charCount);

  return (
    <div
      className="min-h-screen min-h-[100dvh] bg-white text-[#111318] flex flex-col items-center justify-center px-6 pt-[max(1.5rem,env(safe-area-inset-top,0px))] pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]"
      role={error ? 'alert' : 'status'}
      aria-live="polite"
    >
      <div className="w-full max-w-xs flex flex-col items-center text-center space-y-5">
        <XOSLogo size="lg" className="border-neutral-200/80 shadow-xs" />

        <div className="space-y-2 w-full">
          <span className="block text-base font-bold tracking-tight text-[#111318]">
            XOS
          </span>

          {error ? (
            <div className="pt-2 space-y-4">
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs leading-relaxed flex items-start gap-2.5 text-left">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>

              <div className="flex flex-col gap-2">
                {onRetry && (
                  <button
                    type="button"
                    onClick={onRetry}
                    className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#111318] hover:bg-black text-white text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-[#8ECFFF]" />
                    <span>Try Again</span>
                  </button>
                )}
                {onContinue && (
                  <button
                    type="button"
                    onClick={onContinue}
                    className="w-full min-h-[44px] inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-white hover:bg-neutral-50 border border-neutral-200 text-[#111318] text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Continue to Welcome
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="min-h-[20px] flex items-center justify-center">
                <p className="text-xs text-[#687482] font-medium tracking-normal">
                  <span>{displayedText}</span>
                  {!reducedMotion && (
                    <span
                      aria-hidden="true"
                      className="inline-block w-[1.5px] h-3.5 bg-[#8ECFFF] align-middle ml-0.5 animate-pulse"
                    />
                  )}
                </p>
              </div>

              <div className="w-28 h-1 mx-auto rounded-full bg-[#EAF6FF] overflow-hidden mt-3">
                <div className="h-full w-1/2 rounded-full bg-[#8ECFFF] animate-[pulse_1.4s_ease-in-out_infinite]" />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
