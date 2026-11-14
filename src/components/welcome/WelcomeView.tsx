/**
 * XOS Welcome Page
 * Clean, minimal landing experience with CSS-only entrance and
 * bidirectional IntersectionObserver scroll reveals.
 */
import React from 'react';
import {
  ArrowRight,
  Wallet,
  CalendarCheck,
  PiggyBank,
  Target,
  ExternalLink
} from 'lucide-react';
import { XOSLogo } from '../common/XOSLogo';
import { PWAInstallButton } from '../common/PWAInstallButton';
import { MobileOnboarding } from './MobileOnboarding';
import { useWelcomeScrollReveal } from './useWelcomeScrollReveal';

interface WelcomeViewProps {
  onNavigate: (view: 'login' | 'signup' | 'magic-link') => void;
}

const FEATURE_PILLARS = [
  {
    title: 'Finances & Cash Flow',
    description:
      'Track your daily spending, log incoming payments, and keep an eye on money you are owed.',
    icon: Wallet,
    iconColor: 'text-[#111111]'
  },
  {
    title: 'Work & Attendance',
    description:
      'Record daily check-ins, keep track of hours worked, and see your earned salary in real time.',
    icon: CalendarCheck,
    iconColor: 'text-[#0ea5e9]'
  },
  {
    title: 'Savings & Reserves',
    description:
      'Put money aside for emergencies and special plans, kept separate from everyday spending.',
    icon: PiggyBank,
    iconColor: 'text-emerald-600'
  },
  {
    title: 'Goals & Ambitions',
    description:
      'Set clear targets, break them down into milestones, and follow your progress step by step.',
    icon: Target,
    iconColor: 'text-[#111111]'
  }
] as const;

export const WelcomeView: React.FC<WelcomeViewProps> = ({ onNavigate }) => {
  const registerReveal = useWelcomeScrollReveal();

  return (
    <>
      {/* Mobile App Onboarding & Welcome (< 768px) */}
      <div className="md:hidden">
        <MobileOnboarding onNavigate={onNavigate} />
      </div>

      {/* Desktop Responsive Website (>= 768px) */}
      <div className="hidden md:flex min-h-screen min-h-[100dvh] bg-white text-[#111111] flex-col overflow-x-clip select-none">
        {/* 1. Top Navigation Bar */}
        <header className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 shrink-0">
            <XOSLogo size="md" />
            <span className="text-base font-bold text-[#111111] tracking-tight">XOS</span>
          </div>

          <nav aria-label="Welcome actions" className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            <PWAInstallButton variant="compact" className="hidden lg:inline-flex min-h-[36px] py-1.5 px-3" />
            <button
              onClick={() => onNavigate('login')}
              type="button"
              className="px-3 py-1.5 sm:px-4 sm:py-2 text-xs font-semibold text-neutral-700 hover:text-[#111111] hover:bg-neutral-100 rounded-xl transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
            >
              Log In
            </button>
            <button
              onClick={() => onNavigate('signup')}
              type="button"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 sm:px-4 sm:py-2 bg-[#111111] text-white text-xs font-semibold rounded-xl hover:bg-black active:scale-[0.98] transition-all shadow-xs cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
            >
              <span>Get Started</span>
              <ArrowRight className="w-3.5 h-3.5 text-[#87CEEB]" />
            </button>
          </nav>
        </header>

        {/* 2. Hero & Feature Pillars */}
        <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-16 sm:pt-20 sm:pb-24 flex flex-col items-center">
          {/* Hero Block (independent mount entrance, never interrupted by scroll) */}
          <section aria-labelledby="welcome-hero-heading" className="w-full max-w-2xl text-center flex flex-col items-center">
            <h1
              id="welcome-hero-heading"
              className="welcome-hero-enter text-[2.125rem] sm:text-5xl md:text-6xl font-extrabold tracking-tight text-[#111111] leading-[1.08]"
              style={{ textWrap: 'balance' }}
            >
              Order your life. Master your time.
            </h1>

            <p
              className="welcome-hero-enter-delay-1 text-sm sm:text-base md:text-lg text-neutral-600 font-normal max-w-xl mt-5 sm:mt-6 leading-relaxed"
              style={{ textWrap: 'balance' }}
            >
              Track your spending, log your daily work and earnings, build your savings, and stay on top of your goals—all in one simple, private workspace.
            </p>

            <div className="welcome-hero-enter-delay-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-3.5 mt-8 sm:mt-10 w-full sm:w-auto">
              <button
                onClick={() => onNavigate('signup')}
                type="button"
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 bg-[#111111] text-white text-sm font-semibold rounded-2xl hover:bg-black active:scale-[0.98] transition-all shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
              >
                <span>Get Started</span>
                <ArrowRight className="w-4 h-4 text-[#87CEEB]" />
              </button>

              <button
                onClick={() => onNavigate('login')}
                type="button"
                className="w-full sm:w-auto px-6 py-3.5 bg-white hover:bg-neutral-50 active:scale-[0.98] text-neutral-800 text-sm font-semibold rounded-2xl border border-neutral-200 hover:border-neutral-300 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
              >
                Sign In with Password
              </button>
            </div>
          </section>

          {/* Feature Pillars (bidirectional scroll-triggered CSS reveal) */}
          <section
            aria-label="Core capabilities"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4 mt-14 sm:mt-20 w-full text-left"
          >
            {FEATURE_PILLARS.map((pillar, index) => {
              const Icon = pillar.icon;
              return (
                <article
                  key={pillar.title}
                  ref={registerReveal}
                  style={{ '--welcome-stagger': `${index * 60}ms` } as React.CSSProperties}
                  className="p-5 rounded-2xl bg-white border border-neutral-200/80 hover:border-neutral-300 transition-colors space-y-2.5 shadow-xs"
                >
                  <div className="w-8 h-8 rounded-xl bg-neutral-100 flex items-center justify-center">
                    <Icon className={`w-4 h-4 ${pillar.iconColor}`} />
                  </div>
                  <h2 className="font-bold text-sm text-[#111111] tracking-tight">
                    {pillar.title}
                  </h2>
                  <p className="text-xs text-neutral-500 leading-relaxed font-normal">
                    {pillar.description}
                  </p>
                </article>
              );
            })}
          </section>
        </main>

        {/* 3. Clean Minimal Footer */}
        <footer
          ref={registerReveal}
          className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 border-t border-neutral-200/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-neutral-500"
        >
          <div className="flex items-center gap-2.5">
            <XOSLogo size="xs" />
            <span className="text-neutral-500">
              © {new Date().getFullYear()} <span className="font-semibold text-[#111111]">XOS</span>. All rights reserved.
            </span>
          </div>

          <a
            href="https://github.com/musthafacz13-hub/XOS"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View XOS on GitHub (opens in new tab)"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white hover:bg-neutral-50 border border-neutral-200 hover:border-neutral-300 text-xs font-medium text-neutral-700 hover:text-[#111111] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="w-4 h-4 fill-current shrink-0"
            >
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
            <span>GitHub</span>
            <ExternalLink className="w-3 h-3 text-neutral-400 shrink-0" />
          </a>
        </footer>
      </div>
    </>
  );
};
