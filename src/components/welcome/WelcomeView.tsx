/**
 * XOS Welcome View
 * Apple-inspired editorial product showcase featuring a strict 3-zone header,
 * accessible mobile section menu, honest product copy aligned with current XOS
 * capabilities, and a structured responsive footer.
 */
import React, { useEffect, useState } from 'react';
import { ArrowRight, Check, Menu, X } from 'lucide-react';
import { XOSLogo } from '../common/XOSLogo';
import { PWAInstallButton } from '../common/PWAInstallButton';
import { BlurText } from '../ui/BlurText';
import { XOSModuleIcon } from '../icons/XOSIcons';

interface WelcomeViewProps {
  onNavigate: (view: 'login' | 'signup') => void;
}

const SECTION_LINKS = [
  { href: '#overview', label: 'Overview' },
  { href: '#features', label: 'Features' },
  { href: '#jarvis', label: 'Jarvis AI' },
  { href: '#privacy', label: 'Privacy' }
] as const;

export const WelcomeView: React.FC<WelcomeViewProps> = ({ onNavigate }) => {
  const [hoveredModule, setHoveredModule] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen]);

  const handleLinkNav = (
    e: React.MouseEvent<HTMLAnchorElement>,
    view: 'login' | 'signup'
  ) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    e.preventDefault();
    setMobileMenuOpen(false);
    onNavigate(view);
  };

  return (
    <div className="min-h-screen min-h-[100dvh] bg-white text-[#1d1d1f] flex flex-col justify-between selection:bg-[#0071e3]/15 selection:text-[#1d1d1f]">
      {/* Strict 3-Zone Apple-style Navigation Header */}
      <header className="sticky top-0 z-30 w-full liquid-glass border-b border-black/[0.06] pt-[env(safe-area-inset-top,0px)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-4 sm:gap-8">
          <a
            href="/"
            className="inline-flex items-center gap-2.5 shrink-0 whitespace-nowrap rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]"
          >
            <XOSLogo size="sm" alt="XOS logo" priority />
            <span className="text-[17px] font-semibold tracking-[-0.02em] text-[#1d1d1f]">
              XOS
            </span>
          </a>

          <nav aria-label="Page sections" className="hidden md:flex items-center gap-8 text-[13px] font-medium text-[#6e6e73]">
            {SECTION_LINKS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="hover:text-[#1d1d1f] transition-colors whitespace-nowrap shrink-0 py-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-expanded={mobileMenuOpen}
              aria-controls="welcome-mobile-menu"
              aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              className="md:hidden min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full text-[#1d1d1f] hover:bg-black/[0.04] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            <a
              href="/login"
              onClick={(e) => handleLinkNav(e, 'login')}
              className="min-h-[40px] sm:min-h-[36px] px-4 sm:px-4.5 py-1.5 inline-flex items-center justify-center bg-[#0071e3] hover:bg-[#0077ed] text-white text-[13px] font-medium rounded-full transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]"
            >
              Sign in
            </a>
          </div>
        </div>

        {mobileMenuOpen && (
          <nav
            id="welcome-mobile-menu"
            aria-label="Mobile page navigation"
            className="md:hidden border-t border-black/[0.06] bg-white/95 backdrop-blur-xl px-4 py-3"
          >
            <div className="max-w-6xl mx-auto flex flex-col gap-1">
              {SECTION_LINKS.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="min-h-[44px] px-3 rounded-xl flex items-center justify-between text-[15px] font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]"
                >
                  <span>{item.label}</span>
                </a>
              ))}
              <div className="pt-2 mt-1 border-t border-black/[0.06]">
                <a
                  href="/signup"
                  onClick={(e) => handleLinkNav(e, 'signup')}
                  className="min-h-[44px] px-4 rounded-xl bg-[#f5f5f7] hover:bg-[#ebebf0] flex items-center justify-between text-[15px] font-medium text-[#1d1d1f] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]"
                >
                  <span>Create account</span>
                  <ArrowRight className="w-4 h-4 text-[#6e6e73]" />
                </a>
              </div>
            </div>
          </nav>
        )}
      </header>

      <main className="flex-1">
        {/* Editorial Hero */}
        <section
          id="overview"
          className="scroll-mt-16 sm:scroll-mt-20 max-w-6xl mx-auto px-5 sm:px-6 lg:px-8 pt-14 sm:pt-24 lg:pt-28 pb-16 sm:pb-24 text-center"
        >
          <p className="text-[13px] font-semibold tracking-[-0.01em] text-[#0071e3] mb-3.5">
            XOS
          </p>

          <h1 className="text-[clamp(2.25rem,5vw,4rem)] font-semibold tracking-[-0.032em] text-[#1d1d1f] leading-[1.06] [text-wrap:balance] max-w-3xl mx-auto">
            <BlurText as="span" blurPx={8} distance={10} className="inline-block">
              Your finances. Your work. One clear picture.
            </BlurText>
          </h1>

          <BlurText
            as="p"
            delay={0.08}
            blurPx={6}
            distance={8}
            className="mt-5 text-base sm:text-[19px] text-[#6e6e73] font-normal leading-relaxed max-w-2xl mx-auto"
          >
            Track expenses, income, debt, work attendance, daily salary, goals, savings, personal notes, and Jarvis AI in one personal workspace.
          </BlurText>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3.5">
            <a
              href="/signup"
              onClick={(e) => handleLinkNav(e, 'signup')}
              className="min-h-[48px] px-7 py-3 bg-[#0071e3] hover:bg-[#0077ed] text-white text-[15px] font-medium rounded-full transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]"
            >
              <span>Create account</span>
              <ArrowRight className="w-4 h-4" />
            </a>

            <a
              href="/login"
              onClick={(e) => handleLinkNav(e, 'login')}
              className="min-h-[48px] px-7 py-3 bg-[#f5f5f7] hover:bg-[#ebebf0] text-[#1d1d1f] text-[15px] font-medium rounded-full transition-colors inline-flex items-center justify-center whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]"
            >
              Sign in
            </a>
          </div>
        </section>

        {/* Product Features — Four Focused Areas */}
        <section id="features" className="scroll-mt-16 sm:scroll-mt-20 bg-[#fbfbfd] border-t border-black/[0.06]">
          <div className="max-w-6xl mx-auto px-5 sm:px-6 lg:px-8 py-16 sm:py-24">
            <div className="max-w-2xl mb-12 sm:mb-14">
              <h2 className="text-2xl sm:text-[40px] font-semibold tracking-[-0.028em] text-[#1d1d1f] leading-[1.1] [text-wrap:balance]">
                Designed around how you manage money and work.
              </h2>
              <p className="mt-3.5 text-base sm:text-[17px] text-[#6e6e73] leading-relaxed">
                Four focused parts of XOS built for daily clarity without visual clutter.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 lg:gap-6">
              {/* 1. Money */}
              <article
                onMouseEnter={() => setHoveredModule('money')}
                onMouseLeave={() => setHoveredModule(null)}
                className="md:col-span-7 rounded-3xl bg-[#f5f5f7] p-7 sm:p-9 flex flex-col justify-between gap-7 transition-colors hover:bg-[#efeff4]"
              >
                <div className="space-y-3 max-w-lg">
                  <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#0071e3]">
                    <XOSModuleIcon name="expenses" isActive isHovered={hoveredModule === 'money'} size={17} />
                    <span>Money</span>
                  </div>
                  <h3 className="text-xl sm:text-[26px] font-semibold tracking-[-0.02em] text-[#1d1d1f] leading-snug">
                    Expenses, income, and debt in clear view.
                  </h3>
                  <p className="text-sm text-[#6e6e73] leading-relaxed">
                    Log daily spending and income by category and payment method, and track money owed or receivable with remaining balances.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-5 border-t border-black/[0.06]">
                  <div>
                    <p className="text-xs text-[#6e6e73]">Expenses</p>
                    <p className="mt-0.5 text-sm font-semibold text-[#1d1d1f]">Daily &amp; recurring</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#6e6e73]">Income</p>
                    <p className="mt-0.5 text-sm font-semibold text-[#1d1d1f]">Categorized entries</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#6e6e73]">Debt</p>
                    <p className="mt-0.5 text-sm font-semibold text-[#1d1d1f]">Payable &amp; receivable</p>
                  </div>
                </div>
              </article>

              {/* 2. Work */}
              <article
                onMouseEnter={() => setHoveredModule('work')}
                onMouseLeave={() => setHoveredModule(null)}
                className="md:col-span-5 rounded-3xl bg-[#f5f5f7] p-7 sm:p-9 flex flex-col justify-between gap-7 transition-colors hover:bg-[#efeff4]"
              >
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#0071e3]">
                    <XOSModuleIcon name="attendance" isActive isHovered={hoveredModule === 'work'} size={17} />
                    <span>Work</span>
                  </div>
                  <h3 className="text-xl sm:text-[26px] font-semibold tracking-[-0.02em] text-[#1d1d1f] leading-snug">
                    Attendance and salary, aligned day by day.
                  </h3>
                  <p className="text-sm text-[#6e6e73] leading-relaxed">
                    Mark each day as Present (Full Day or Half Day), Absent, or Holiday, and calculate monthly earnings from your configured Daily Salary.
                  </p>
                </div>
                <div className="pt-5 border-t border-black/[0.06] flex flex-wrap items-center justify-between gap-2 text-xs text-[#6e6e73]">
                  <span>Present · Absent · Holiday</span>
                  <span className="font-semibold text-[#1d1d1f]">Daily Salary</span>
                </div>
              </article>

              {/* 3. Goals */}
              <article
                onMouseEnter={() => setHoveredModule('goals')}
                onMouseLeave={() => setHoveredModule(null)}
                className="md:col-span-5 rounded-3xl bg-[#f5f5f7] p-7 sm:p-9 flex flex-col justify-between gap-7 transition-colors hover:bg-[#efeff4]"
              >
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#0071e3]">
                    <XOSModuleIcon name="goals" isActive isHovered={hoveredModule === 'goals'} size={17} />
                    <span>Goals</span>
                  </div>
                  <h3 className="text-xl sm:text-[26px] font-semibold tracking-[-0.02em] text-[#1d1d1f] leading-snug">
                    Savings reserves, goals, and notes.
                  </h3>
                  <p className="text-sm text-[#6e6e73] leading-relaxed">
                    Keep dedicated savings deposits separate from everyday spending, follow goal milestones, and organize searchable personal notes.
                  </p>
                </div>
                <div className="pt-5 border-t border-black/[0.06] flex flex-wrap items-center justify-between gap-2 text-xs text-[#6e6e73]">
                  <span>Savings &amp; milestones</span>
                  <span className="font-semibold text-[#1d1d1f]">Searchable notes</span>
                </div>
              </article>

              {/* 4. Jarvis AI */}
              <article
                id="jarvis"
                onMouseEnter={() => setHoveredModule('ai-agent')}
                onMouseLeave={() => setHoveredModule(null)}
                className="scroll-mt-16 sm:scroll-mt-20 md:col-span-7 rounded-3xl bg-[#1d1d1f] text-white p-7 sm:p-9 flex flex-col justify-between gap-7"
              >
                <div className="space-y-3 max-w-lg">
                  <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#2997ff]">
                    <XOSModuleIcon name="ai-agent" isActive isHovered={hoveredModule === 'ai-agent'} size={17} />
                    <span>Jarvis AI</span>
                  </div>
                  <h3 className="text-xl sm:text-[26px] font-semibold tracking-[-0.02em] text-white leading-snug">
                    Voice-assisted insights with draft confirmation.
                  </h3>
                  <p className="text-sm text-white/75 leading-relaxed">
                    Ask questions or dictate entries in English or Malayalam. Jarvis prepares a preview card first so nothing is saved until you confirm.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-5 border-t border-white/10">
                  <div>
                    <p className="text-xs text-white/60">Languages</p>
                    <p className="mt-0.5 text-sm font-semibold text-white">English &amp; Malayalam</p>
                  </div>
                  <div>
                    <p className="text-xs text-white/60">Control</p>
                    <p className="mt-0.5 text-sm font-semibold text-white">Preview before saving</p>
                  </div>
                  <div>
                    <p className="text-xs text-white/60">History</p>
                    <p className="mt-0.5 text-sm font-semibold text-white">Saved conversations</p>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* Privacy & Data Controls */}
        <section id="privacy" className="scroll-mt-16 sm:scroll-mt-20 max-w-6xl mx-auto px-5 sm:px-6 lg:px-8 py-16 sm:py-24 border-t border-black/[0.06]">
          <div className="max-w-xl mb-12">
            <h2 className="text-2xl sm:text-4xl font-semibold tracking-[-0.025em] text-[#1d1d1f] [text-wrap:balance]">
              Your data stays scoped to your account.
            </h2>
            <p className="mt-3 text-sm sm:text-base text-[#6e6e73] leading-relaxed">
              Built with authenticated access controls, preview-first AI actions, and portable exports.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-10">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-[#1d1d1f]">01. Row-level database isolation</p>
              <p className="text-sm text-[#6e6e73] leading-relaxed">
                Supabase authentication and PostgreSQL row-level security restrict table queries and writes to your signed-in user ID.
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-[#1d1d1f]">02. Confirmation before AI writes</p>
              <p className="text-sm text-[#6e6e73] leading-relaxed">
                Jarvis AI renders an editable draft preview before saving any expense, income, or attendance entry.
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-[#1d1d1f]">03. Local PDF &amp; JSON exports</p>
              <p className="text-sm text-[#6e6e73] leading-relaxed">
                Generate printable PDF reports locally and export a portable JSON backup of your workspace data.
              </p>
            </div>
          </div>

          {/* Final CTA */}
          <div className="mt-14 pt-8 border-t border-black/[0.06] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-2.5 text-sm text-[#6e6e73]">
              <Check className="w-4 h-4 text-[#0071e3] shrink-0 mt-0.5 sm:mt-0" />
              <span>Start organizing your expenses, attendance, and goals in one place.</span>
            </div>
            <div className="shrink-0">
              <a
                href="/signup"
                onClick={(e) => handleLinkNav(e, 'signup')}
                className="min-h-[48px] px-7 py-3 bg-[#0071e3] hover:bg-[#0077ed] text-white text-sm font-medium rounded-full transition-colors inline-flex items-center gap-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]"
              >
                <span>Create account</span>
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* Structured Apple-style Footer */}
      <footer className="bg-[#fbfbfd] border-t border-black/[0.06] pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 lg:px-8 py-10 sm:py-12">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 lg:gap-10">
            <div className="md:col-span-5 space-y-3">
              <a
                href="/"
                className="inline-flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]"
              >
                <XOSLogo size="xs" alt="XOS logo" />
                <span className="text-sm font-semibold text-[#1d1d1f]">XOS</span>
              </a>
              <p className="text-xs text-[#6e6e73] max-w-xs leading-relaxed">
                Personal finance, attendance, and goal tracking in one focused workspace.
              </p>
              <div className="pt-1">
                <PWAInstallButton variant="compact" />
              </div>
            </div>

            <div className="md:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-6 text-xs">
              <div className="space-y-2">
                <p className="font-semibold text-[#1d1d1f]">Product</p>
                <ul className="space-y-1 text-[#6e6e73]">
                  {SECTION_LINKS.map((item) => (
                    <li key={item.href}>
                      <a
                        href={item.href}
                        className="inline-flex items-center min-h-[44px] sm:min-h-[32px] hover:text-[#1d1d1f] transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]"
                      >
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <p className="font-semibold text-[#1d1d1f]">Account</p>
                <ul className="space-y-1 text-[#6e6e73]">
                  <li>
                    <a
                      href="/login"
                      onClick={(e) => handleLinkNav(e, 'login')}
                      className="inline-flex items-center min-h-[44px] sm:min-h-[32px] hover:text-[#1d1d1f] transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]"
                    >
                      Sign in
                    </a>
                  </li>
                  <li>
                    <a
                      href="/signup"
                      onClick={(e) => handleLinkNav(e, 'signup')}
                      className="inline-flex items-center min-h-[44px] sm:min-h-[32px] hover:text-[#1d1d1f] transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]"
                    >
                      Create account
                    </a>
                  </li>
                </ul>
              </div>

              <div className="space-y-2 col-span-2 sm:col-span-1">
                <p className="font-semibold text-[#1d1d1f]">Resources</p>
                <ul className="space-y-1 text-[#6e6e73]">
                  <li>
                    <a
                      href="https://github.com/musthafacz13-hub/XOS"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center min-h-[44px] sm:min-h-[32px] hover:text-[#1d1d1f] transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]"
                    >
                      GitHub
                    </a>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-black/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[#6e6e73]">
            <span>© {new Date().getFullYear()} XOS. All rights reserved.</span>
            <span>Personal Finance &amp; Work Workspace</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
