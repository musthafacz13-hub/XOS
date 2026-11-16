import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { XOSLogo } from './XOSLogo';

interface NotFoundViewProps {
  onNavigateHome: () => void;
  onNavigateLogin: () => void;
}

export const NotFoundView: React.FC<NotFoundViewProps> = ({
  onNavigateHome,
  onNavigateLogin
}) => {
  return (
    <div className="min-h-screen min-h-[100dvh] bg-white text-[#111318] flex flex-col justify-between px-4 sm:px-8 py-6">
      <header className="w-full max-w-5xl mx-auto flex items-center justify-between">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            onNavigateHome();
          }}
          className="flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF] rounded-xl"
        >
          <XOSLogo size="md" alt="XOS logo" />
          <span className="text-base font-bold tracking-tight text-[#111318]">XOS</span>
        </a>

        <a
          href="/login"
          onClick={(e) => {
            e.preventDefault();
            onNavigateLogin();
          }}
          className="min-h-[40px] px-4 py-2 text-xs font-semibold text-neutral-700 hover:text-[#111318] hover:bg-neutral-100 rounded-xl transition-colors inline-flex items-center"
        >
          Log In
        </a>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center text-center max-w-md mx-auto py-12 space-y-4">
        <span className="text-xs font-mono font-semibold uppercase tracking-widest text-[#687482]">
          Error 404
        </span>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#111318]">
          Page not found
        </h1>
        <p className="text-sm text-[#687482] leading-relaxed">
          The page you requested does not exist or may have moved. Return to XOS to manage your finances, work attendance, salary calculations, savings, and goals.
        </p>
        <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              onNavigateHome();
            }}
            className="min-h-[44px] inline-flex items-center gap-2 px-5 py-2.5 bg-[#111318] hover:bg-black text-white text-sm font-semibold rounded-2xl transition-colors shadow-xs"
          >
            <ArrowLeft className="w-4 h-4 text-[#8ECFFF]" />
            <span>Back to Home</span>
          </a>
        </div>
      </main>

      <footer className="w-full max-w-5xl mx-auto text-center text-xs text-[#687482]">
        <span>© {new Date().getFullYear()} XOS</span>
      </footer>
    </div>
  );
};
