/**
 * XOS Welcome View
 * Apple-inspired editorial product showcase following strict 3-zone top bar,
 * selective blur-to-sharp typography reveals, custom XOS iconography,
 * asymmetric product bento, and accessible CTAs.
 */
import React, { useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { XOSLogo } from '../common/XOSLogo';
import { PWAInstallButton } from '../common/PWAInstallButton';
import { BlurText } from '../ui/BlurText';
import { XOSModuleIcon } from '../icons/XOSIcons';

interface WelcomeViewProps {
  onNavigate: (view: 'login' | 'signup') => void;
}

export const WelcomeView: React.FC<WelcomeViewProps> = ({ onNavigate }) => {
  const [hoveredModule, setHoveredModule] = useState<string | null>(null);

  const handleLinkNav = (
    e: React.MouseEvent<HTMLAnchorElement>,
    view: 'login' | 'signup'
  ) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    e.preventDefault();
    onNavigate(view);
  };

  return (
    <div className="min-h-screen min-h-[100dvh] bg-white text-[#1d1d1f] flex flex-col justify-between selection:bg-[#0071e3]/15 selection:text-[#1d1d1f]">
      {/* Strict 3-Zone Apple-style Navigation Header */}
      <header className="sticky top-0 z-30 w-full liquid-glass border-b border-black/[0.06] pt-[env(safe-area-inset-top,0px)]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-8">
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
            <a href="#overview" className="hover:text-[#1d1d1f] transition-colors whitespace-nowrap shrink-0">
              Overview
            </a>
            <a href="#modules" className="hover:text-[#1d1d1f] transition-colors whitespace-nowrap shrink-0">
              Modules
            </a>
            <a href="#jarvis" className="hover:text-[#1d1d1f] transition-colors whitespace-nowrap shrink-0">
              Jarvis AI
            </a>
            <a href="#privacy" className="hover:text-[#1d1d1f] transition-colors whitespace-nowrap shrink-0">
              Privacy
            </a>
          </nav>

          <div className="flex items-center shrink-0">
            <a
              href="/login"
              onClick={(e) => handleLinkNav(e, 'login')}
              className="min-h-[40px] sm:min-h-[36px] px-4.5 py-1.5 inline-flex items-center justify-center bg-[#0071e3] hover:bg-[#0077ed] text-white text-[13px] font-medium rounded-full transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]"
            >
              Sign in
            </a>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Showcase */}
        <section
          id="overview"
          className="max-w-6xl mx-auto px-5 sm:px-6 lg:px-8 pt-14 sm:pt-24 pb-16 sm:pb-24 text-center"
        >
          <p className="text-[13px] font-semibold tracking-[-0.01em] text-[#0071e3] mb-3.5">
            Personal Life Operating System
          </p>

          <h1 className="text-[clamp(2.35rem,5.4vw,4.25rem)] font-semibold tracking-[-0.032em] text-[#1d1d1f] leading-[1.05] [text-wrap:balance] max-w-3xl mx-auto">
            <BlurText as="span" blurPx={8} distance={12} className="inline-block">
              Order your life. Master your time.
            </BlurText>
          </h1>

          <BlurText
            as="p"
            delay={0.08}
            blurPx={6}
            distance={8}
            className="mt-5 text-base sm:text-[19px] text-[#6e6e73] font-normal leading-relaxed max-w-2xl mx-auto"
          >
            Track daily expenses, income, debt, work attendance, salary calculations, savings, notes, and voice-powered Jarvis AI in one calm, private workspace.
          </BlurText>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3.5">
            <a
              href="/signup"
              onClick={(e) => handleLinkNav(e, 'signup')}
              className="min-h-[48px] px-7 py-3 bg-[#0071e3] hover:bg-[#0077ed] text-white text-[15px] font-medium rounded-full transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]"
            >
              <span>Create Free Account</span>
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

          {/* Architectural Product Workspace Stage */}
          <div className="mt-14 sm:mt-20 rounded-3xl bg-[#f5f5f7] p-4 sm:p-8 lg:p-10 text-left">
            <div className="rounded-2xl bg-white border border-black/[0.06] shadow-[0_12px_40px_rgba(0,0,0,0.04)] overflow-hidden">
              <div className="px-5 sm:px-7 py-4 border-b border-black/[0.06] flex items-center justify-between gap-4 bg-[#fbfbfd]">
                <div className="flex items-center gap-3 min-w-0">
                  <XOSLogo size="xs" alt="XOS workspace icon" />
                  <span className="text-sm font-semibold text-[#1d1d1f] tracking-[-0.01em] truncate">
                    Workspace Overview
                  </span>
                </div>
                <span className="text-xs font-medium text-[#86868b] whitespace-nowrap">
                  Live Architecture
                </span>
              </div>

              <div className="p-6 sm:p-8 grid grid-cols-1 md:grid-cols-3 gap-7">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[#0071e3]">
                    <XOSModuleIcon name="dashboard" isActive size={17} />
                    <p className="text-xs font-medium text-[#6e6e73]">Net Cash Balance</p>
                  </div>
                  <p className="text-2xl sm:text-[30px] font-semibold font-mono tabular-nums tracking-[-0.025em] text-[#1d1d1f]">
                    Unified Ledger
                  </p>
                  <p className="text-xs text-[#86868b] leading-relaxed">
                    Income, expenses, savings reserves, and debt repayments balanced continuously.
                  </p>
                </div>

                <div className="space-y-2 md:border-l md:border-black/[0.06] md:pl-7">
                  <div className="flex items-center gap-2 text-[#0071e3]">
                    <XOSModuleIcon name="salary" isActive size={17} />
                    <p className="text-xs font-medium text-[#6e6e73]">Work &amp; Salary Engine</p>
                  </div>
                  <p className="text-2xl sm:text-[30px] font-semibold font-mono tabular-nums tracking-[-0.025em] text-[#1d1d1f]">
                    IST Precision
                  </p>
                  <p className="text-xs text-[#0071e3] font-medium">
                    Attendance &amp; overtime reflected in real time
                  </p>
                </div>

                <div className="space-y-2 md:border-l md:border-black/[0.06] md:pl-7">
                  <div className="flex items-center gap-2 text-[#0071e3]">
                    <XOSModuleIcon name="ai-agent" isActive size={17} />
                    <p className="text-xs font-medium text-[#6e6e73]">Jarvis AI Voice Entry</p>
                  </div>
                  <p className="text-sm font-medium text-[#1d1d1f] leading-snug pt-0.5">
                    “Log groceries via UPI today”
                  </p>
                  <p className="text-xs text-[#86868b] leading-relaxed">
                    Draft preview generated first — saved only upon your confirmation.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Bento Product Showcase */}
        <section id="modules" className="bg-[#fbfbfd] border-t border-black/[0.06]">
          <div className="max-w-6xl mx-auto px-5 sm:px-6 lg:px-8 py-16 sm:py-24">
            <div className="max-w-2xl mb-12 sm:mb-14">
              <BlurText
                as="h2"
                mode="scroll"
                blurPx={7}
                className="text-2xl sm:text-[40px] font-semibold tracking-[-0.028em] text-[#1d1d1f] leading-[1.1] [text-wrap:balance]"
              >
                Personal finance, attendance, and planning working as one.
              </BlurText>
              <p className="mt-3.5 text-base sm:text-[17px] text-[#6e6e73] leading-relaxed">
                Every module shares a single verified ledger so cash flow, savings reserves, and earned wages stay aligned automatically.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
              <article
                onMouseEnter={() => setHoveredModule('expenses')}
                onMouseLeave={() => setHoveredModule(null)}
                className="md:col-span-7 rounded-3xl bg-[#f5f5f7] p-7 sm:p-9 flex flex-col justify-between gap-7 transition-colors hover:bg-[#efeff4]"
              >
                <div className="space-y-3 max-w-lg">
                  <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#0071e3]">
                    <XOSModuleIcon name="expenses" isActive isHovered={hoveredModule === 'expenses'} size={17} />
                    <span>Cash Flow &amp; Debt Ledger</span>
                  </div>
                  <h3 className="text-xl sm:text-[26px] font-semibold tracking-[-0.02em] text-[#1d1d1f] leading-snug">
                    Expenses, income, and repayments in clear balance.
                  </h3>
                  <p className="text-sm text-[#6e6e73] leading-relaxed">
                    Categorize daily spending, record payment methods, manage money owed or receivable, and automatically link payable debt repayments to your expense ledger.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-4 pt-5 border-t border-black/[0.06]">
                  <div>
                    <p className="text-xs text-[#86868b]">Expenses</p>
                    <p className="mt-0.5 text-sm font-semibold text-[#1d1d1f]">Daily &amp; Recurring</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#86868b]">Income</p>
                    <p className="mt-0.5 text-sm font-semibold text-[#1d1d1f]">Source Breakdown</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#86868b]">Debts</p>
                    <p className="mt-0.5 text-sm font-semibold text-[#1d1d1f]">Atomic Repayments</p>
                  </div>
                </div>
              </article>

              <article
                onMouseEnter={() => setHoveredModule('attendance')}
                onMouseLeave={() => setHoveredModule(null)}
                className="md:col-span-5 rounded-3xl bg-[#f5f5f7] p-7 sm:p-9 flex flex-col justify-between gap-7 transition-colors hover:bg-[#efeff4]"
              >
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#0071e3]">
                    <XOSModuleIcon name="attendance" isActive isHovered={hoveredModule === 'attendance'} size={17} />
                    <span>Work &amp; Salary Engine</span>
                  </div>
                  <h3 className="text-xl sm:text-[26px] font-semibold tracking-[-0.02em] text-[#1d1d1f] leading-snug">
                    Attendance to payroll, calculated automatically.
                  </h3>
                  <p className="text-sm text-[#6e6e73] leading-relaxed">
                    Mark present, half-day, or leave status in one tap with optional overtime hours and transparent monthly payout tracking.
                  </p>
                </div>
                <div className="pt-5 border-t border-black/[0.06] flex items-center justify-between text-xs text-[#6e6e73]">
                  <span>IST Calendar &amp; Rules</span>
                  <span className="font-mono tabular-nums text-[#1d1d1f] font-semibold">Payout Ready</span>
                </div>
              </article>

              <article
                onMouseEnter={() => setHoveredModule('goals')}
                onMouseLeave={() => setHoveredModule(null)}
                className="md:col-span-5 rounded-3xl bg-[#f5f5f7] p-7 sm:p-9 flex flex-col justify-between gap-7 transition-colors hover:bg-[#efeff4]"
              >
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#0071e3]">
                    <XOSModuleIcon name="goals" isActive isHovered={hoveredModule === 'goals'} size={17} />
                    <span>Goals, Reserves &amp; Notes</span>
                  </div>
                  <h3 className="text-xl sm:text-[26px] font-semibold tracking-[-0.02em] text-[#1d1d1f] leading-snug">
                    Dedicated reserves and personal clarity.
                  </h3>
                  <p className="text-sm text-[#6e6e73] leading-relaxed">
                    Keep emergency funds separate from spending, track milestone completion, and capture structured work or finance notes.
                  </p>
                </div>
                <div className="pt-5 border-t border-black/[0.06] flex items-center justify-between text-xs text-[#6e6e73]">
                  <span>Milestones &amp; Quick Notes</span>
                  <span className="font-semibold text-[#1d1d1f]">Instant Search</span>
                </div>
              </article>

              <article
                id="jarvis"
                onMouseEnter={() => setHoveredModule('ai-agent')}
                onMouseLeave={() => setHoveredModule(null)}
                className="md:col-span-7 rounded-3xl bg-[#1d1d1f] text-white p-7 sm:p-9 flex flex-col justify-between gap-7"
              >
                <div className="space-y-3 max-w-lg">
                  <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#2997ff]">
                    <XOSModuleIcon name="ai-agent" isActive isHovered={hoveredModule === 'ai-agent'} size={17} />
                    <span>Jarvis AI</span>
                  </div>
                  <h3 className="text-xl sm:text-[26px] font-semibold tracking-[-0.02em] text-white leading-snug">
                    Bilingual voice and financial intelligence with human control.
                  </h3>
                  <p className="text-sm text-white/75 leading-relaxed">
                    Speak or type in English or Malayalam to analyze spending, review attendance, or draft a transaction. Nothing is ever saved until you inspect and confirm.
                  </p>
                </div>
                <div className="pt-5 border-t border-white/10 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-white/75">
                  <span>English &amp; Malayalam</span>
                  <span aria-hidden="true">·</span>
                  <span>Read-only until confirmed</span>
                  <span aria-hidden="true">·</span>
                  <span>Saved chat history</span>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* Architecture & Privacy Section */}
        <section id="privacy" className="max-w-6xl mx-auto px-5 sm:px-6 lg:px-8 py-16 sm:py-24 border-t border-black/[0.06]">
          <div className="max-w-xl mb-12">
            <BlurText
              as="h2"
              mode="scroll"
              blurPx={7}
              className="text-2xl sm:text-4xl font-semibold tracking-[-0.025em] text-[#1d1d1f]"
            >
              Private by architecture.
            </BlurText>
            <p className="mt-3 text-sm sm:text-base text-[#6e6e73] leading-relaxed">
              Built with verified session isolation, explicit confirmation workflows, and portable exports.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-9">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-[#1d1d1f]">01. Row-level isolation</p>
              <p className="text-sm text-[#6e6e73] leading-relaxed">
                Database queries and storage policies strictly isolate every entry to your authenticated user identity.
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-[#1d1d1f]">02. Confirmation before writes</p>
              <p className="text-sm text-[#6e6e73] leading-relaxed">
                Voice and AI transaction drafts always render an editable preview card requiring your explicit approval.
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-[#1d1d1f]">03. Reports &amp; JSON backups</p>
              <p className="text-sm text-[#6e6e73] leading-relaxed">
                Download printable PDF financial statements or complete JSON workspace archives whenever you choose.
              </p>
            </div>
          </div>

          <div className="mt-14 pt-8 border-t border-black/[0.06] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 text-sm text-[#6e6e73]">
              <Check className="w-4 h-4 text-[#0071e3] shrink-0" />
              <span>Ready to organize your personal operating system?</span>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="/signup"
                onClick={(e) => handleLinkNav(e, 'signup')}
                className="min-h-[44px] px-6 py-2.5 bg-[#0071e3] hover:bg-[#0077ed] text-white text-sm font-medium rounded-full transition-colors inline-flex items-center gap-1.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]"
              >
                <span>Create Free Account</span>
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Apple-style Footer */}
      <footer className="bg-[#fbfbfd] border-t border-black/[0.06] pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 lg:px-8 py-7 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#6e6e73]">
          <div className="flex items-center gap-3">
            <span>© {new Date().getFullYear()} XOS. All rights reserved.</span>
            <PWAInstallButton variant="compact" className="hidden sm:inline-flex" />
          </div>
          <div className="flex items-center gap-5">
            <a href="/login" onClick={(e) => handleLinkNav(e, 'login')} className="hover:text-[#1d1d1f] transition-colors">
              Sign in
            </a>
            <a href="/signup" onClick={(e) => handleLinkNav(e, 'signup')} className="hover:text-[#1d1d1f] transition-colors">
              Create account
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};
