import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  ExternalLink,
  Mail,
  PiggyBank,
  Target,
  Wallet
} from 'lucide-react';
import { XOSLogo } from '../common/XOSLogo';
import { PWAInstallButton } from '../common/PWAInstallButton';

interface MobileOnboardingProps {
  onNavigate: (view: 'login' | 'signup' | 'magic-link') => void;
}

const ONBOARDING_SLIDES = [
  {
    id: 'finances',
    title: 'Finances & Cash Flow',
    description:
      'Track your daily spending, log incoming payments, and keep an eye on money you are owed.',
    icon: Wallet
  },
  {
    id: 'work',
    title: 'Work & Attendance',
    description:
      'Record daily check-ins, track working hours, and understand your earned salary.',
    icon: CalendarCheck
  },
  {
    id: 'savings',
    title: 'Savings & Reserves',
    description:
      'Set money aside for emergencies and important future plans.',
    icon: PiggyBank
  },
  {
    id: 'goals',
    title: 'Goals & Ambitions',
    description:
      'Set meaningful targets, organize milestones, and follow your progress.',
    icon: Target
  }
] as const;

const SLIDE_EASE = [0.16, 1, 0.3, 1] as const;

export const MobileOnboarding: React.FC<MobileOnboardingProps> = ({ onNavigate }) => {
  const [step, setStep] = useState<number>(0); // 0..3 = slides, 4 = final mobile welcome
  const [direction, setDirection] = useState<1 | -1>(1);
  const transitionLockRef = useRef<boolean>(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const totalSlides = ONBOARDING_SLIDES.length;
  const isFinalWelcome = step >= totalSlides;

  const lockNavigation = () => {
    transitionLockRef.current = true;
    setTimeout(() => {
      transitionLockRef.current = false;
    }, 320);
  };

  const goToStep = (nextStep: number, navDirection: 1 | -1) => {
    if (transitionLockRef.current) return;
    if (nextStep < 0 || nextStep > totalSlides || nextStep === step) return;
    lockNavigation();
    setDirection(navDirection);
    setStep(nextStep);
  };

  const handleNext = () => {
    goToStep(step + 1, 1);
  };

  const handleBack = () => {
    if (step > 0) {
      goToStep(step - 1, -1);
    }
  };

  const handleSkip = () => {
    goToStep(totalSlides, 1);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) {
      touchStartRef.current = null;
      return;
    }
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY
    };
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!touchStartRef.current || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
    touchStartRef.current = null;

    if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy) * 1.4) {
      return;
    }

    if (dx < 0 && step < totalSlides) {
      goToStep(step + 1, 1);
    } else if (dx > 0 && step > 0) {
      goToStep(step - 1, -1);
    }
  };

  const currentSlide = !isFinalWelcome ? ONBOARDING_SLIDES[step] : null;
  const SlideIcon = currentSlide?.icon;

  return (
    <div
      className="min-h-screen min-h-[100dvh] bg-white text-[#111318] flex flex-col justify-between px-5 pt-[max(0.75rem,env(safe-area-inset-top,0px))] pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] overflow-x-clip select-none"
      style={{ touchAction: 'pan-y' }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Top Bar */}
      <header className="w-full h-12 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <XOSLogo size="sm" />
          <span className="text-base font-bold tracking-tight text-[#111318]">XOS</span>
        </div>

        {!isFinalWelcome ? (
          <button
            type="button"
            onClick={handleSkip}
            className="min-h-[44px] px-3 -mr-2 inline-flex items-center justify-center text-xs font-semibold text-[#687482] hover:text-[#111318] transition-colors cursor-pointer rounded-xl"
          >
            Skip
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onNavigate('login')}
            className="min-h-[44px] px-3 -mr-2 inline-flex items-center justify-center text-xs font-semibold text-[#111318] hover:bg-neutral-100 transition-colors cursor-pointer rounded-xl"
          >
            Sign In
          </button>
        )}
      </header>

      {/* Center Single-Panel Stage */}
      <main className="flex-1 flex flex-col justify-center py-6 max-w-sm w-full mx-auto">
        <AnimatePresence mode="wait" initial={false}>
          {!isFinalWelcome && currentSlide && SlideIcon ? (
            <motion.section
              key={currentSlide.id}
              initial={{ opacity: 0, x: direction > 0 ? 22 : -22 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction > 0 ? -22 : 22 }}
              transition={{ duration: 0.22, ease: SLIDE_EASE }}
              aria-labelledby={`onboarding-title-${currentSlide.id}`}
              className="w-full min-h-[276px] bg-white border border-neutral-200/90 rounded-3xl px-6 py-7 sm:p-7 shadow-sm flex flex-col items-center justify-center text-center space-y-5"
            >
              <div className="w-16 h-16 rounded-2xl bg-[#EAF6FF] border border-[#8ECFFF]/60 flex items-center justify-center">
                <SlideIcon className="w-7 h-7 text-[#111318]" strokeWidth={1.9} />
              </div>

              <div className="space-y-2.5">
                <span className="text-[11px] font-semibold text-[#687482] tracking-wide block">
                  {step + 1} of {totalSlides}
                </span>
                <h1
                  id={`onboarding-title-${currentSlide.id}`}
                  className="text-2xl font-bold tracking-tight text-[#111318] leading-tight"
                >
                  {currentSlide.title}
                </h1>
                <p className="text-sm text-[#687482] leading-relaxed font-normal">
                  {currentSlide.description}
                </p>
              </div>
            </motion.section>
          ) : (
            <motion.section
              key="mobile-welcome-final"
              initial={{ opacity: 0, x: direction > 0 ? 22 : -22 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction > 0 ? -22 : 22 }}
              transition={{ duration: 0.22, ease: SLIDE_EASE }}
              aria-labelledby="mobile-welcome-heading"
              className="w-full flex flex-col items-center text-center space-y-6"
            >
              <XOSLogo size="lg" className="border-neutral-200/80 shadow-xs" />

              <div className="space-y-2.5">
                <h1
                  id="mobile-welcome-heading"
                  className="text-[1.875rem] font-extrabold tracking-tight text-[#111318] leading-[1.12]"
                  style={{ textWrap: 'balance' }}
                >
                  Order your life. Master your time.
                </h1>
                <p className="text-sm text-[#687482] leading-relaxed font-normal max-w-xs mx-auto">
                  Your private workspace for daily spending, attendance, earnings, savings, and personal goals.
                </p>
              </div>

              <div className="w-full space-y-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => onNavigate('signup')}
                  className="w-full min-h-[48px] px-5 py-3 bg-[#111318] hover:bg-black text-white text-sm font-semibold rounded-2xl transition-colors flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                >
                  <span>Get Started</span>
                  <ArrowRight className="w-4 h-4 text-[#8ECFFF]" />
                </button>

                <button
                  type="button"
                  onClick={() => onNavigate('login')}
                  className="w-full min-h-[48px] px-5 py-3 bg-white hover:bg-neutral-50 border border-neutral-200 text-[#111318] text-sm font-semibold rounded-2xl transition-colors flex items-center justify-center cursor-pointer"
                >
                  Sign In
                </button>

                <button
                  type="button"
                  onClick={() => onNavigate('magic-link')}
                  className="w-full min-h-[44px] px-4 py-2.5 bg-neutral-50 hover:bg-neutral-100 border border-neutral-200/80 text-[#111318] text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Mail className="w-3.5 h-3.5 text-[#687482]" />
                  <span>Continue with Magic Link</span>
                </button>
              </div>

              <div className="pt-1 flex justify-center">
                <PWAInstallButton variant="compact" />
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      {/* Bottom Controls / Minimal Footer */}
      {!isFinalWelcome ? (
        <footer className="max-w-sm w-full mx-auto space-y-4 shrink-0">
          {/* Progress Indicator Bars */}
          <div className="flex items-center justify-center gap-2" role="group" aria-label="Onboarding steps">
            {ONBOARDING_SLIDES.map((slide, idx) => {
              const active = idx === step;
              return (
                <button
                  key={slide.id}
                  type="button"
                  onClick={() => goToStep(idx, idx > step ? 1 : -1)}
                  aria-label={`Go to ${slide.title}`}
                  aria-current={active ? 'step' : undefined}
                  className="py-2 px-0.5 cursor-pointer flex items-center justify-center"
                >
                  <span
                    className={`block h-1.5 rounded-full transition-all duration-200 ${
                      active
                        ? 'w-7 bg-[#111318]'
                        : idx < step
                        ? 'w-3 bg-[#8ECFFF]'
                        : 'w-2 bg-neutral-200'
                    }`}
                  />
                </button>
              );
            })}
          </div>

          {/* Primary Navigation Row */}
          <div className="flex items-center gap-2.5">
            {step > 0 && (
              <button
                type="button"
                onClick={handleBack}
                className="min-h-[48px] px-4 rounded-2xl bg-white hover:bg-neutral-50 border border-neutral-200 text-[#111318] text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer shrink-0"
                aria-label="Previous slide"
              >
                <ArrowLeft className="w-4 h-4 text-[#687482]" />
                <span>Back</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleNext}
              className="flex-1 min-h-[48px] px-5 rounded-2xl bg-[#111318] hover:bg-black text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors shadow-xs cursor-pointer"
            >
              <span>{step === totalSlides - 1 ? 'Get Started' : 'Next'}</span>
              <ArrowRight className="w-4 h-4 text-[#8ECFFF]" />
            </button>
          </div>
        </footer>
      ) : (
        <footer className="max-w-sm w-full mx-auto pt-4 border-t border-neutral-200/80 flex items-center justify-between gap-3 text-xs text-[#687482] shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleBack}
              className="min-h-[44px] px-2.5 -ml-2 rounded-xl hover:bg-neutral-100 text-xs font-medium text-[#687482] hover:text-[#111318] transition-colors inline-flex items-center gap-1 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Overview</span>
            </button>
          </div>

          <span className="text-[11px] text-[#687482]">
            © {new Date().getFullYear()} <span className="font-semibold text-[#111318]">XOS</span>
          </span>

          <a
            href="https://github.com/musthafacz13-hub/XOS"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View XOS on GitHub"
            className="min-h-[44px] inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-neutral-50 border border-neutral-200 text-xs font-medium text-[#111318] transition-colors"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="w-3.5 h-3.5 fill-current shrink-0"
            >
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
            <ExternalLink className="w-3 h-3 text-[#687482]" />
          </a>
        </footer>
      )}
    </div>
  );
};
