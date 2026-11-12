/**
 * XOS Premium Welcome Experience
 * Minimalist, Apple-inspired onboarding hero with interactive canvas motion,
 * clear value proposition, and frictionless entry points.
 */
import React from 'react';
import { motion } from 'motion/react';
import { 
  ArrowRight, 
  ShieldCheck, 
  Wallet, 
  CalendarCheck, 
  PiggyBank, 
  Target, 
  Lock
} from 'lucide-react';
import { MotionCanvasBackground } from './MotionCanvasBackground';
import { MOTION_SPRINGS, tapScale } from '../../utils/motion';
import { useAuth } from '../../context/AuthContext';

interface WelcomeViewProps {
  onNavigate: (view: 'login' | 'signup' | 'magic-link') => void;
}

export const WelcomeView: React.FC<WelcomeViewProps> = ({ onNavigate }) => {
  const { isConfigured } = useAuth();

  return (
    <div className="min-h-screen bg-white text-[#111111] flex flex-col justify-between relative overflow-hidden select-none">
      {/* 1. Cinematic Geometric Motion Visual */}
      <MotionCanvasBackground />

      {/* 2. Top Navigation Bar (3-Zone Contract) */}
      <header className="relative z-10 w-full max-w-6xl mx-auto px-4 sm:px-8 h-20 flex items-center justify-between">
        {/* Zone 1: Single Brand Element */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-[#111111] text-white flex items-center justify-center font-bold text-sm tracking-wider relative shadow-xs">
            <span>X</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#87CEEB] absolute top-1.5 right-1.5" />
          </div>
          <span className="text-base font-bold text-[#111111] tracking-tight">XOS</span>
        </div>

        {/* Zone 2: Quiet Center Status / Security Tag */}
        <div className="hidden md:flex items-center gap-2 text-xs text-neutral-500 font-medium">
          <ShieldCheck className="w-3.5 h-3.5 text-[#87CEEB]" />
          <span>Private & Encrypted Personal Workspace</span>
        </div>

        {/* Zone 3: Direct Log In CTA */}
        <div className="flex items-center gap-2 sm:gap-3">
          <motion.button
            whileTap={tapScale.button}
            onClick={() => onNavigate('login')}
            type="button"
            className="px-4 py-2 text-xs font-semibold text-neutral-700 hover:text-black transition-colors rounded-xl hover:bg-black/[0.04] cursor-pointer"
          >
            Log In
          </motion.button>
          <motion.button
            whileTap={tapScale.button}
            onClick={() => onNavigate('signup')}
            type="button"
            className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2 bg-[#111111] text-white text-xs font-semibold rounded-xl hover:bg-black transition-colors shadow-xs cursor-pointer"
          >
            <span>Get Started</span>
            <ArrowRight className="w-3.5 h-3.5 text-[#87CEEB]" />
          </motion.button>
        </div>
      </header>

      {/* 3. Hero Statement & Call to Action */}
      <main className="relative z-10 w-full max-w-4xl mx-auto px-4 sm:px-8 py-10 sm:py-16 flex flex-col items-center text-center">
        {/* Kicker tag */}
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-black/[0.04] border border-black/[0.05] text-[11px] font-semibold text-neutral-600 mb-6"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[#87CEEB]" />
          <span className="tracking-wide uppercase">Personal Life Operating System</span>
        </motion.div>

        {/* Hero Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.05 }}
          className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-[#111111] max-w-2xl leading-[1.08]"
          style={{ textWrap: 'balance' }}
        >
          Order your life. Master your time.
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.12 }}
          className="text-sm sm:text-base md:text-lg text-neutral-600 font-normal max-w-xl mt-4 sm:mt-5 leading-relaxed"
          style={{ textWrap: 'balance' }}
        >
          A single, calm operating system uniting your personal finances, work attendance,
          daily wages, and long-term ambitions into one clear command center.
        </motion.p>

        {/* CTAs Group */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.18 }}
          className="flex flex-col sm:flex-row items-center gap-3 sm:gap-3.5 mt-8 sm:mt-10 w-full sm:w-auto"
        >
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={tapScale.button}
            transition={MOTION_SPRINGS.tactile}
            onClick={() => onNavigate('signup')}
            type="button"
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 bg-[#111111] text-white text-sm font-semibold rounded-2xl hover:bg-black transition-colors shadow-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
          >
            <span>Get Started</span>
            <ArrowRight className="w-4 h-4 text-[#87CEEB]" />
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={tapScale.button}
            transition={MOTION_SPRINGS.tactile}
            onClick={() => onNavigate('login')}
            type="button"
            className="w-full sm:w-auto px-6 py-3.5 bg-white/80 hover:bg-white text-neutral-800 text-sm font-semibold rounded-2xl border border-black/[0.08] hover:border-black/[0.15] transition-all shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
          >
            Sign In with Password
          </motion.button>
        </motion.div>

        {/* 4. Pillar Highlights Strip (Anti-Slop Clean Cards) */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mt-12 sm:mt-16 w-full text-left"
        >
          <div className="p-4 sm:p-5 rounded-2xl bg-white/80 backdrop-blur-xs border border-black/[0.06] space-y-2 shadow-xs">
            <div className="w-8 h-8 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-800">
              <Wallet className="w-4 h-4 text-[#111111]" />
            </div>
            <h3 className="font-bold text-sm text-[#111111] tracking-tight">Finances & Cash Flow</h3>
            <p className="text-xs text-neutral-500 leading-relaxed font-normal">
              Unified expenses, multiple revenue streams, and debt receivables tracking.
            </p>
          </div>

          <div className="p-4 sm:p-5 rounded-2xl bg-white/80 backdrop-blur-xs border border-black/[0.06] space-y-2 shadow-xs">
            <div className="w-8 h-8 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-800">
              <CalendarCheck className="w-4 h-4 text-[#87CEEB]" />
            </div>
            <h3 className="font-bold text-sm text-[#111111] tracking-tight">Work & Attendance</h3>
            <p className="text-xs text-neutral-500 leading-relaxed font-normal">
              Daily check-ins, automatic working-hours logging, and overtime wage calculations.
            </p>
          </div>

          <div className="p-4 sm:p-5 rounded-2xl bg-white/80 backdrop-blur-xs border border-black/[0.06] space-y-2 shadow-xs">
            <div className="w-8 h-8 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-800">
              <PiggyBank className="w-4 h-4 text-emerald-600" />
            </div>
            <h3 className="font-bold text-sm text-[#111111] tracking-tight">Savings & Reserves</h3>
            <p className="text-xs text-neutral-500 leading-relaxed font-normal">
              Isolated emergency buffers and asset funds kept strictly apart from spending.
            </p>
          </div>

          <div className="p-4 sm:p-5 rounded-2xl bg-white/80 backdrop-blur-xs border border-black/[0.06] space-y-2 shadow-xs">
            <div className="w-8 h-8 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-800">
              <Target className="w-4 h-4 text-[#111111]" />
            </div>
            <h3 className="font-bold text-sm text-[#111111] tracking-tight">Goals & Ambitions</h3>
            <p className="text-xs text-neutral-500 leading-relaxed font-normal">
              Progressive milestone tracking for financial targets and bucket-list dreams.
            </p>
          </div>
        </motion.div>
      </main>

      {/* 5. Minimalist Footer */}
      <footer className="relative z-10 w-full max-w-6xl mx-auto px-4 sm:px-8 py-6 border-t border-black/[0.06] flex flex-col sm:flex-row items-center justify-between gap-2.5 text-xs text-neutral-500">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[#111111]">XOS</span>
          <span aria-hidden="true">·</span>
          <span>Personal Life OS</span>
          <span aria-hidden="true">·</span>
          <span>Version 1.0</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-neutral-600">
            <Lock className="w-3 h-3 text-[#87CEEB]" />
            <span>{isConfigured ? 'Supabase Auth Online' : 'Local Workspace Ready'}</span>
          </span>
        </div>
      </footer>
    </div>
  );
};
