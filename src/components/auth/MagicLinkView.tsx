/**
 * XOS Magic Link View
 * Frictionless passwordless authentication using Supabase email OTP.
 */
import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Mail, Loader2, ArrowRight, CheckCircle2, RotateCcw } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { useAuth } from '../../context/AuthContext';
import { tapScale } from '../../utils/motion';

interface MagicLinkViewProps {
  onNavigate: (view: 'login' | 'signup' | 'welcome') => void;
}

export const MagicLinkView: React.FC<MagicLinkViewProps> = ({ onNavigate }) => {
  const { loginWithMagicLink, isConfigured } = useAuth();

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sentSuccess, setSentSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  // Rate-limit resend countdown
  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const interval = setInterval(() => {
      setCooldownSeconds(prev => prev - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldownSeconds]);

  const handleSendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || cooldownSeconds > 0) return;

    setErrorMessage(null);

    const cleanEmail = email.trim();
    if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    const { error } = await loginWithMagicLink(cleanEmail);
    setLoading(false);

    if (error) {
      setErrorMessage(error);
    } else {
      setSentSuccess(true);
      setCooldownSeconds(60);
    }
  };

  return (
    <AuthLayout
      title="Magic Link Sign In"
      subtitle="Sign in instantly without remembering a password. We'll send a secure one-click link."
      onBack={() => onNavigate('login')}
      backLabel="Back to Password Login"
    >
      {sentSuccess ? (
        <div className="space-y-5 text-center py-2 animate-in fade-in duration-200">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-100 shadow-xs">
            <CheckCircle2 className="w-6 h-6" />
          </div>

          <div className="space-y-1.5">
            <h3 className="font-bold text-base text-[#111111]">
              Check your email
            </h3>
            <p className="text-xs text-neutral-600 leading-relaxed font-normal">
              We've dispatched a secure one-click sign-in link to:
            </p>
            <p className="text-xs font-mono font-semibold text-[#111111] bg-neutral-50 py-1.5 px-3 rounded-lg border border-neutral-200 inline-block">
              {email}
            </p>
          </div>

          <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200 text-left text-xs text-neutral-500 leading-relaxed space-y-1">
            <span className="font-semibold text-neutral-800 block">Next Steps:</span>
            <p>1. Open your inbox and look for an email from Supabase / XOS.</p>
            <p>2. Click "Log In" inside the email to establish your session.</p>
            <p>3. The link expires in 15 minutes.</p>
          </div>

          <div className="pt-2 space-y-2">
            <button
              type="button"
              disabled={loading || cooldownSeconds > 0}
              onClick={handleSendLink}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-semibold rounded-xl border border-neutral-200 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>
                {cooldownSeconds > 0 ? `Resend link in ${cooldownSeconds}s` : 'Resend Magic Link'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('login')}
              className="text-xs text-neutral-500 hover:text-black transition-colors font-medium cursor-pointer block w-full py-1"
            >
              Back to Password Sign In
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSendLink} className="space-y-4" noValidate>
          {errorMessage && (
            <div 
              role="alert" 
              className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-start gap-2 animate-in fade-in duration-150"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" />
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
          )}

          {!isConfigured && (
            <div className="p-3 bg-neutral-100 rounded-xl border border-neutral-200 text-xs text-neutral-600 space-y-1">
              <span className="font-semibold text-neutral-900 block">Supabase Connection Pending</span>
              <p className="text-[11px] leading-relaxed">
                Environment variables for Supabase are not yet configured. Provide credentials to enable live magic links.
              </p>
            </div>
          )}

          <div className="space-y-1.5 text-left">
            <label htmlFor="magic-email" className="block text-xs font-semibold text-neutral-700">
              Email address
            </label>
            <input
              id="magic-email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              disabled={loading}
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 text-xs sm:text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB] transition-all disabled:opacity-60"
            />
          </div>

          <motion.button
            whileTap={tapScale.button}
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 bg-[#111111] text-white text-xs sm:text-sm font-semibold rounded-xl hover:bg-black transition-colors shadow-sm disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-[#87CEEB]" />
                <span>Sending Magic Link...</span>
              </>
            ) : (
              <>
                <Mail className="w-4 h-4 text-[#87CEEB]" />
                <span>Send Magic Link</span>
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </>
            )}
          </motion.button>

          <div className="pt-2 text-center text-xs text-neutral-500 border-t border-black/[0.04]">
            <span>Prefer to use a password? </span>
            <button
              type="button"
              onClick={() => onNavigate('login')}
              className="font-semibold text-[#111111] hover:underline cursor-pointer"
            >
              Sign In with Password
            </button>
          </div>
        </form>
      )}
    </AuthLayout>
  );
};
