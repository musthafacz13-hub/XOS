/**
 * XOS Magic Link View
 * Frictionless passwordless authentication using Supabase email OTP.
 */
import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Mail, Loader2, ArrowRight, CheckCircle2, RotateCcw } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { useAuth } from '../../context/AuthContext';
import { tapScale } from '../../utils/motion';
import { validateEmailAddress, normalizeAuthEmail } from '../../utils/authValidation';

interface MagicLinkViewProps {
  onNavigate: (view: 'login' | 'signup' | 'welcome') => void;
}

export const MagicLinkView: React.FC<MagicLinkViewProps> = ({ onNavigate }) => {
  const { loginWithMagicLink, isConfigured } = useAuth();

  const [email, setEmail] = useState('');
  const [sentEmail, setSentEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sentSuccess, setSentSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  const mountedRef = useRef(true);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Rate-limit resend countdown
  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const interval = setInterval(() => {
      setCooldownSeconds(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldownSeconds]);

  const handleSendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || loading || cooldownSeconds > 0) return;

    setErrorMessage(null);

    const validationError = validateEmailAddress(email);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    const cleanEmail = normalizeAuthEmail(email);
    isSubmittingRef.current = true;
    setLoading(true);

    try {
      const { error } = await loginWithMagicLink(cleanEmail);
      if (!mountedRef.current) return;

      if (error) {
        setErrorMessage(error);
      } else {
        setSentEmail(cleanEmail);
        setSentSuccess(true);
        setCooldownSeconds(60);
      }
    } finally {
      isSubmittingRef.current = false;
      if (mountedRef.current) {
        setLoading(false);
      }
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
        <div className="space-y-5 text-center py-2">
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
            <p className="text-xs font-mono font-semibold text-[#111111] bg-neutral-50 py-1.5 px-3 rounded-lg border border-neutral-200 inline-block break-all max-w-full">
              {sentEmail}
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
              className="w-full min-h-[44px] flex items-center justify-center gap-2 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-semibold rounded-xl border border-neutral-200 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>
                {cooldownSeconds > 0 ? `Resend link in ${cooldownSeconds}s` : 'Resend Magic Link'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('login')}
              className="min-h-[44px] text-xs text-neutral-500 hover:text-black transition-colors font-medium cursor-pointer flex items-center justify-center w-full py-2 rounded-xl"
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
              className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-start gap-2"
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
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              autoComplete="email"
              disabled={loading}
              placeholder="name@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              className="w-full min-h-[44px] px-3.5 py-2.5 text-base md:text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF] transition-all disabled:opacity-60"
            />
          </div>

          <motion.button
            whileTap={tapScale.button}
            type="submit"
            disabled={loading}
            className="w-full min-h-[48px] flex items-center justify-center gap-2 py-3 bg-[#111318] text-white text-sm font-semibold rounded-xl hover:bg-black transition-colors shadow-sm disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF]"
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
              disabled={loading}
              onClick={() => onNavigate('login')}
              className="font-semibold text-[#111111] hover:underline cursor-pointer disabled:opacity-50"
            >
              Sign In with Password
            </button>
          </div>
        </form>
      )}
    </AuthLayout>
  );
};
