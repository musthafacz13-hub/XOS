/**
 * XOS Welcome View
 * Premium, minimal professional entry experience.
 */
import React from 'react';
import { ArrowRight } from 'lucide-react';
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
    <div className="min-h-screen min-h-[100dvh] bg-white text-[#111111] flex flex-col justify-between selection:bg-[#8ECFFF]/30 selection:text-black">
      {/* Top Header */}
      <header className="w-full max-w-5xl mx-auto px-6 lg:px-8 pt-[env(safe-area-inset-top,0px)] h-[calc(4.5rem+env(safe-area-inset-top,0px))] flex items-center justify-between gap-4">
        <a
          href="/"
          className="flex items-center gap-2.5 shrink-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
        >
          <XOSLogo size="md" alt="XOS logo" priority />
          <span className="text-base font-bold text-[#111111] tracking-tight">XOS</span>
        </a>

        <div className="flex items-center gap-2 shrink-0">
          <PWAInstallButton variant="compact" className="hidden sm:inline-flex" />
          <a
            href="/login"
            onClick={(e) => handleLinkNav(e, 'login')}
            className="min-h-[40px] px-4 py-2 inline-flex items-center text-xs font-semibold text-neutral-700 hover:text-[#111111] hover:bg-neutral-100 rounded-xl transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
          >
            Log In
          </a>
        </div>
      </header>

      {/* Center Hero Section */}
      <main className="flex-1 w-full max-w-xl mx-auto px-6 py-12 flex flex-col items-center justify-center text-center space-y-6">
        <div className="space-y-4">
          <XOSLogo size="lg" alt="XOS logo mark" priority className="mx-auto shadow-xs rounded-2xl" />
          
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-[#111111] leading-[1.12]">
            Take control of your everyday life.
          </h1>

          <p className="text-sm sm:text-base text-neutral-600 font-normal leading-relaxed max-w-md mx-auto">
            XOS brings your personal finances, work records, savings and goals together in one private workspace.
          </p>
        </div>

        <div className="w-full max-w-xs space-y-2.5 pt-2">
          <a
            href="/signup"
            onClick={(e) => handleLinkNav(e, 'signup')}
            className="w-full min-h-[48px] px-6 py-3 bg-[#111111] hover:bg-black text-white text-sm font-semibold rounded-2xl transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
          >
            <span>Create Free Account</span>
            <ArrowRight className="w-4 h-4 text-[#87CEEB]" />
          </a>

          <a
            href="/login"
            onClick={(e) => handleLinkNav(e, 'login')}
            className="w-full min-h-[48px] px-6 py-3 bg-white hover:bg-neutral-50 text-neutral-800 text-sm font-semibold rounded-2xl border border-neutral-200 hover:border-neutral-300 transition-all flex items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
          >
            Log In
          </a>
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className="w-full max-w-5xl mx-auto px-6 lg:px-8 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] border-t border-neutral-200/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-neutral-500">
        <div className="flex items-center gap-2">
          <span>© {new Date().getFullYear()} XOS. All rights reserved.</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="/login" onClick={(e) => handleLinkNav(e, 'login')} className="hover:text-[#111111] transition-colors">Sign In</a>
          <a href="/signup" onClick={(e) => handleLinkNav(e, 'signup')} className="hover:text-[#111111] transition-colors">Create Account</a>
        </div>
      </footer>
    </div>
  );
};
