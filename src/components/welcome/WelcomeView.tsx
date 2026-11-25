/**
 * XOS Welcome View
 * Apple-inspired editorial product showcase following strict 3-zone top bar,
 * clean typographic hierarchy, asymmetric product bento, and accessible CTAs.
 */
import React from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { XOSLogo } from '../common/XOSLogo';
import { PWAInstallButton } from '../common/PWAInstallButton';

interface WelcomeViewProps {
  onNavigate: (view: 'login' | 'signup') => void;
}

export const WelcomeView: React.FC<WelcomeViewProps> = ({ onNavigate }) => {
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
    <div className="min-h-screen min-h-[100dvh] bg-white text-[#1d1d1f] flex flex-col justify-between selection:bg-[#0284c7]/15 selection:text-[#1d1d1f]">
      {/* Zone-3 Top Navigation Bar */}
      <header className="sticky top-0 z-30 w-full liquid-glass border-b border-black/[0.06] pt-[env(safe-area-inset-top,0px)]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-8">
          <a
            href="/"
            className="inline-flex items-center gap-2.5 shrink-0 whitespace-nowrap rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0284c7]"
          >
            <XOSLogo size="sm" alt="XOS logo" priority />
            <span className="text-[17px] font-semibold tracking-[-0.02em] text-[#1d1d1f]">
              XOS
            </span>
          </a>

          <nav aria-label="Page sections" className="hidden md:flex items-center gap-7 text-[13px] font-medium text-[#6e6e73]">
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
              className="min-h-[40px] sm:min-h-[36px] px-4 py-1.5 inline-flex items-center justify-center bg-[#0284c7] hover:bg-[#0369a1] text-white text-[13px] font-medium rounded-full transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0284c7]"
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
          className="max-w-6xl mx-auto px-5 sm:px-6 lg:px-8 pt-14 sm:pt-20 pb-16 sm:pb-24 text-center"
        >
          <p className="text-sm font-medium text-[#0284c7] mb-3">
            Personal Life Operating System
          </p>

          <h1 className="text-[clamp(2.25rem,5.2vw,4rem)] font-semibold tracking-[-0.03em] text-[#1d1d1f] leading-[1.06] [text-wrap:balance] max-w-3xl mx-auto">
            Order your life. Master your time.
          </h1>

          <p className="mt-5 text-base sm:text-xl text-[#6e6e73] font-normal leading-relaxed max-w-2xl mx-auto">
            Track daily expenses, income, debt, work attendance, salary calculations, savings, notes, and voice-powered Jarvis AI in one private workspace.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3.5">
            <a
              href="/signup"
              onClick={(e) => handleLinkNav(e, 'signup')}
              className="min-h-[48px] px-7 py-3 bg-[#0284c7] hover:bg-[#0369a1] text-white text-[15px] font-medium rounded-full transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0284c7]"
            >
              <span>Create Free Account</span>
              <ArrowRight className="w-4 h-4" />
            </a>

            <a
              href="/login"
              onClick={(e) => handleLinkNav(e, 'login')}
              className="min-h-[48px] px-7 py-3 bg-white hover:bg-[#f5f5f7] text-[#1d1d1f] text-[15px] font-medium rounded-full border border-black/[0.12] transition-colors inline-flex items-center justify-center whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0284c7]"
            >
              Sign in
            </a>
          </div>

          {/* Architectural Product Workspace Stage */}
          <div className="mt-14 sm:mt-16 rounded-3xl bg-[#f5f5f7] p-5 sm:p-8 lg:p-10 text-left">
            <div className="rounded-2xl bg-white border border-black/[0.06] shadow-xs overflow-hidden">
              <div className="px-5 sm:px-6 py-4 border-b border-black/[0.06] flex items-center justify-between gap-4">
                <div className="flex items-center gap-2.5 min-w-0">
                  <XOSLogo size="xs" alt="XOS workspace icon" />
                  <span className="text-sm font-semibold text-[#1d1d1f] truncate">Workspace Overview</span>
                </div>
                <span className="text-xs text-[#86868b] whitespace-nowrap">This Month</span>
              </div>

              <div className="p-5 sm:p-7 grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-[#6e6e73]">Net Cash Balance</p>
                  <p className="text-2xl sm:text-3xl font-semibold font-mono tabular-nums tracking-[-0.02em] text-[#1d1d1f]">
                    ₹84,250
                  </p>
                  <p className="text-xs text-[#86868b]">Income minus expenses and debt repayments</p>
                </div>

                <div className="space-y-1.5 md:border-l md:border-black/[0.06] md:pl-6">
                  <p className="text-xs font-medium text-[#6e6e73]">Work &amp; Salary Accrued</p>
                  <p className="text-2xl sm:text-3xl font-semibold font-mono tabular-nums tracking-[-0.02em] text-[#1d1d1f]">
                    22 days
                  </p>
                  <p className="text-xs text-[#0284c7] font-mono tabular-nums">
                    ₹48,400 earned · overtime included
                  </p>
                </div>

                <div className="space-y-1.5 md:border-l md:border-black/[0.06] md:pl-6">
                  <p className="text-xs font-medium text-[#6e6e73]">Jarvis AI Voice Entry</p>
                  <p className="text-sm font-medium text-[#1d1d1f] leading-snug">
                    “Log ₹420 groceries via UPI today”
                  </p>
                  <p className="text-xs text-[#86868b]">Preview generated · awaiting your confirmation</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Bento Product Showcase */}
        <section id="modules" className="max-w-6xl mx-auto px-5 sm:px-6 lg:px-8 py-14 sm:py-20 border-t border-black/[0.06]">
          <div className="max-w-2xl mb-10 sm:mb-12">
            <h2 className="text-2xl sm:text-4xl font-semibold tracking-[-0.025em] text-[#1d1d1f] [text-wrap:balance]">
              Personal finance, attendance, and planning working as one.
            </h2>
            <p className="mt-3 text-base text-[#6e6e73] leading-relaxed">
              Every module shares a single verified ledger so cash flow, savings reserves, and earned wages stay aligned automatically.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
            <article className="md:col-span-7 rounded-3xl bg-[#f5f5f7] p-7 sm:p-9 flex flex-col justify-between gap-6">
              <div className="space-y-2.5 max-w-lg">
                <p className="text-xs font-medium text-[#0284c7]">Cash Flow &amp; Debt Ledger</p>
                <h3 className="text-xl sm:text-2xl font-semibold tracking-[-0.02em] text-[#1d1d1f]">
                  Expenses, income, and repayments in clear balance.
                </h3>
                <p className="text-sm text-[#6e6e73] leading-relaxed">
                  Categorize daily spending, record payment methods, manage money owed or receivable, and automatically link payable debt repayments to your expense ledger.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-4 pt-4 border-t border-black/[0.06]">
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

            <article className="md:col-span-5 rounded-3xl bg-[#f5f5f7] p-7 sm:p-9 flex flex-col justify-between gap-6">
              <div className="space-y-2.5">
                <p className="text-xs font-medium text-[#0284c7]">Work &amp; Salary Engine</p>
                <h3 className="text-xl sm:text-2xl font-semibold tracking-[-0.02em] text-[#1d1d1f]">
                  Attendance to payroll, calculated automatically.
                </h3>
                <p className="text-sm text-[#6e6e73] leading-relaxed">
                  Mark present, half-day, or leave status in one tap with optional overtime hours and transparent monthly payout tracking.
                </p>
              </div>
              <div className="pt-4 border-t border-black/[0.06] flex items-center justify-between text-xs text-[#6e6e73]">
                <span>IST Calendar &amp; Rules</span>
                <span className="font-mono tabular-nums text-[#1d1d1f] font-medium">Payout Ready</span>
              </div>
            </article>

            <article className="md:col-span-5 rounded-3xl bg-[#f5f5f7] p-7 sm:p-9 flex flex-col justify-between gap-6">
              <div className="space-y-2.5">
                <p className="text-xs font-medium text-[#0284c7]">Goals, Reserves &amp; Notes</p>
                <h3 className="text-xl sm:text-2xl font-semibold tracking-[-0.02em] text-[#1d1d1f]">
                  Dedicated reserves and personal clarity.
                </h3>
                <p className="text-sm text-[#6e6e73] leading-relaxed">
                  Keep emergency funds separate from spending, track milestone completion, and capture structured work or finance notes.
                </p>
              </div>
              <div className="pt-4 border-t border-black/[0.06] flex items-center justify-between text-xs text-[#6e6e73]">
                <span>Milestones &amp; Quick Notes</span>
                <span className="font-medium text-[#1d1d1f]">Instant Search</span>
              </div>
            </article>

            <article id="jarvis" className="md:col-span-7 rounded-3xl bg-[#1d1d1f] text-white p-7 sm:p-9 flex flex-col justify-between gap-6">
              <div className="space-y-2.5 max-w-lg">
                <p className="text-xs font-medium text-[#38bdf8]">Jarvis AI</p>
                <h3 className="text-xl sm:text-2xl font-semibold tracking-[-0.02em] text-white">
                  Bilingual voice and financial intelligence with human control.
                </h3>
                <p className="text-sm text-white/75 leading-relaxed">
                  Speak or type in English or Malayalam to analyze spending, review attendance, or draft a transaction. Nothing is ever saved until you inspect and confirm.
                </p>
              </div>
              <div className="pt-4 border-t border-white/10 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-white/75">
                <span>English &amp; Malayalam</span>
                <span aria-hidden="true">·</span>
                <span>Read-only until confirmed</span>
                <span aria-hidden="true">·</span>
                <span>Saved chat history</span>
              </div>
            </article>
          </div>
        </section>

        {/* Architecture & Privacy Section */}
        <section id="privacy" className="max-w-6xl mx-auto px-5 sm:px-6 lg:px-8 py-14 sm:py-20 border-t border-black/[0.06]">
          <div className="max-w-xl mb-10">
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-[-0.02em] text-[#1d1d1f]">
              Private by architecture.
            </h2>
            <p className="mt-2.5 text-sm sm:text-base text-[#6e6e73] leading-relaxed">
              Built with verified session isolation, explicit confirmation workflows, and portable exports.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
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

          <div className="mt-12 pt-8 border-t border-black/[0.06] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-[#6e6e73]">
              <Check className="w-4 h-4 text-[#0284c7] shrink-0" />
              <span>Ready to organize your personal operating system?</span>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="/signup"
                onClick={(e) => handleLinkNav(e, 'signup')}
                className="min-h-[44px] px-6 py-2.5 bg-[#0284c7] hover:bg-[#0369a1] text-white text-sm font-medium rounded-full transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
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
