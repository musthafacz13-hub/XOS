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
  'Loading your account session…'
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
      }, 24);
      return () => clearTimeout(timer);
    }

    if (messageIndex >= LOADING_MESSAGES.length - 1) {
      return;
    }

    const pauseTimer = setTimeout(() => {
      setMessageIndex(prev => Math.min(prev + 1, LOADING_MESSAGES.length - 1));
      setCharCount(0);
    }, 900);
    return () => clearTimeout(pauseTimer);
  }, [charCount, messageIndex, reducedMotion, error]);

  const displayedText = reducedMotion
    ? LOADING_MESSAGES[0]
    : LOADING_MESSAGES[messageIndex].slice(0, charCount);

  return (
    <div
      className="min-h-screen min-h-[100dvh] bg-white text-[#1d1d1f] flex flex-col items-center justify-center px-6 pt-[max(1.5rem,env(safe-area-inset-top,0px))] pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]"
      role={error ? 'alert' : 'status'}
      aria-live="polite"
    >
      <div className="w-full max-w-xs flex flex-col items-center text-center space-y-5">
        <XOSLogo size="lg" className="border-black/[0.08]" />

        <div className="space-y-2 w-full">
          <span className="block text-base font-semibold tracking-tight text-[#1d1d1f]">
            XOS
          </span>

          {error ? (
            <div className="pt-2 space-y-4">
              <div className="p-3.5 rounded-xl bg-[#c92a2a]/8 border border-[#c92a2a]/20 text-[#c92a2a] text-xs leading-relaxed flex items-start gap-2.5 text-left">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>

              <div className="flex flex-col gap-2">
                {onRetry && (
                  <button
                    type="button"
                    onClick={onRetry}
                    className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#0071e3] hover:bg-[#0077ed] text-white text-[13px] font-medium transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Try Again</span>
                  </button>
                )}
                {onContinue && (
                  <button
                    type="button"
                    onClick={onContinue}
                    className="w-full min-h-[44px] inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-[#f5f5f7] hover:bg-[#e8e8ed] text-[#1d1d1f] text-[13px] font-medium transition-colors cursor-pointer"
                  >
                    Continue to Welcome
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="min-h-[20px] flex items-center justify-center">
                <p className="text-xs text-[#6e6e73] font-medium tracking-normal">
                  <span>{displayedText}</span>
                </p>
              </div>

              <div className="w-24 h-1 mx-auto rounded-full bg-[#f5f5f7] overflow-hidden mt-3">
                <div className="h-full w-1/2 rounded-full bg-[#0071e3] animate-[pulse_1.4s_ease-in-out_infinite]" />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
