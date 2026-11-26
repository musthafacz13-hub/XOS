import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { XOSLogo } from './XOSLogo';
import { BlurText } from '../ui/BlurText';

interface NotFoundViewProps {
  onNavigateHome: () => void;
  onNavigateLogin: () => void;
}

export const NotFoundView: React.FC<NotFoundViewProps> = ({
  onNavigateHome,
  onNavigateLogin
}) => {
  return (
    <div className="min-h-screen min-h-[100dvh] bg-white text-[#1d1d1f] flex flex-col justify-between px-5 sm:px-8 py-6">
      <header className="w-full max-w-5xl mx-auto flex items-center justify-between">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            onNavigateHome();
          }}
          className="flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3] rounded-xl"
        >
          <XOSLogo size="md" alt="XOS logo" />
          <span className="text-base font-semibold tracking-tight text-[#1d1d1f]">XOS</span>
        </a>

        <a
          href="/login"
          onClick={(e) => {
            e.preventDefault();
            onNavigateLogin();
          }}
          className="min-h-[44px] sm:min-h-[40px] px-4 py-2 text-[13px] font-medium text-[#6e6e73] hover:text-[#1d1d1f] hover:bg-[#f5f5f7] rounded-xl transition-colors inline-flex items-center"
        >
          Sign in
        </a>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center text-center max-w-md mx-auto py-12 space-y-4">
        <span className="text-xs font-mono font-medium tracking-wider text-[#86868b]">
          Error 404
        </span>
        <BlurText
          as="h1"
          mode="mount"
          className="xos-page-title text-3xl sm:text-4xl font-semibold text-[#1d1d1f]"
        >
          The page you’re looking for can’t be found.
        </BlurText>
        <BlurText
          as="p"
          mode="mount"
          delay={0.08}
          blurPx={5}
          distance={6}
          className="text-sm text-[#6e6e73] leading-relaxed"
        >
          Return to XOS to manage your finances, work attendance, salary calculations, savings, and goals.
        </BlurText>
        <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              onNavigateHome();
            }}
            className="min-h-[44px] inline-flex items-center gap-2 px-5 py-2.5 bg-[#0071e3] hover:bg-[#0077ed] text-white text-sm font-medium rounded-full transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Home</span>
          </a>
        </div>
      </main>

      <footer className="w-full max-w-5xl mx-auto text-center text-xs text-[#86868b]">
        <span>© {new Date().getFullYear()} XOS</span>
      </footer>
    </div>
  );
};
