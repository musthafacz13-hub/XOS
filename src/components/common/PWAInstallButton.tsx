import React, { useState, useEffect } from 'react';
import { Download, Share, PlusSquare, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'compact' | 'row';
  className?: string;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'compact',
  className = ''
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  useEffect(() => {
    if (!showIOSGuide) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowIOSGuide(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showIOSGuide]);

  if (isInstalled) {
    return null;
  }

  if (!isInstallable && !isIOS) {
    return null;
  }

  const handleAction = async () => {
    if (isInstallable) {
      await install();
    } else if (isIOS) {
      setShowIOSGuide(true);
    }
  };

  return (
    <>
      {variant === 'row' ? (
        <button
          type="button"
          onClick={handleAction}
          className={`inline-flex items-center justify-center gap-2 h-10 px-4 text-xs sm:text-sm font-medium text-[#111318] bg-white hover:bg-neutral-50 border border-neutral-200 hover:border-neutral-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF] ${className}`}
        >
          <Smartphone className="w-4 h-4 text-[#111318]" />
          <span>{isInstallable ? 'Install XOS App' : 'Add to iPhone Home Screen'}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleAction}
          className={`inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2.5 rounded-xl bg-[#EAF6FF] hover:bg-[#dceeff] border border-[#8ECFFF]/60 text-[#111318] text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF] ${className}`}
        >
          <Download className="w-3.5 h-3.5 text-[#111318] shrink-0" />
          <span>{isInstallable ? 'Install App' : 'Add to Home Screen'}</span>
        </button>
      )}

      {showIOSGuide && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setShowIOSGuide(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ios-install-title"
        >
          <div
            className="w-full sm:max-w-sm bg-white border-t sm:border border-neutral-200 rounded-t-2xl sm:rounded-2xl p-6 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] shadow-xl space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1 text-left">
                <h3 id="ios-install-title" className="text-base font-bold text-[#111318]">
                  Install XOS on iPhone
                </h3>
                <p className="text-xs text-[#687482] leading-relaxed">
                  Add XOS to your Home Screen for a full-screen standalone app experience.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="min-w-[44px] min-h-[44px] -mt-2 -mr-2 flex items-center justify-center rounded-xl text-neutral-500 hover:text-[#111318] hover:bg-neutral-100 transition-colors cursor-pointer"
                aria-label="Close installation guide"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <ol className="space-y-3 text-left text-xs text-[#111318]">
              <li className="flex items-start gap-3 p-3 rounded-xl bg-neutral-50 border border-neutral-200/80">
                <div className="w-7 h-7 rounded-lg bg-[#EAF6FF] border border-[#8ECFFF]/50 flex items-center justify-center shrink-0">
                  <Share className="w-3.5 h-3.5 text-[#111318]" />
                </div>
                <div className="space-y-0.5 pt-0.5">
                  <span className="font-semibold block">1. Tap Share in Safari</span>
                  <span className="text-[#687482] block">Open the Share menu in Safari&apos;s toolbar.</span>
                </div>
              </li>

              <li className="flex items-start gap-3 p-3 rounded-xl bg-neutral-50 border border-neutral-200/80">
                <div className="w-7 h-7 rounded-lg bg-[#EAF6FF] border border-[#8ECFFF]/50 flex items-center justify-center shrink-0">
                  <PlusSquare className="w-3.5 h-3.5 text-[#111318]" />
                </div>
                <div className="space-y-0.5 pt-0.5">
                  <span className="font-semibold block">2. Tap Add to Home Screen</span>
                  <span className="text-[#687482] block">Scroll down the share sheet and select &ldquo;Add to Home Screen&rdquo;.</span>
                </div>
              </li>

              <li className="flex items-start gap-3 p-3 rounded-xl bg-neutral-50 border border-neutral-200/80">
                <div className="w-7 h-7 rounded-lg bg-[#EAF6FF] border border-[#8ECFFF]/50 flex items-center justify-center shrink-0 font-bold text-[11px]">
                  3
                </div>
                <div className="space-y-0.5 pt-0.5">
                  <span className="font-semibold block">3. Tap Add</span>
                  <span className="text-[#687482] block">Launch XOS directly from your iPhone Home Screen anytime.</span>
                </div>
              </li>
            </ol>

            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="w-full min-h-[44px] py-2.5 rounded-xl bg-[#111318] hover:bg-black text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
};
