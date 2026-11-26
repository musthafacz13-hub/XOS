/**
 * XOS Magic Link View
 * Frictionless passwordless authentication using Supabase email OTP.
 */
import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, Mail, Loader2, ArrowRight, CheckCircle2, RotateCcw } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { useAuth } from '../../context/AuthContext';
import { tapScale } from '../../utils/motion';
import { validateEmailAddress, normalizeAuthEmail } from '../../utils/authValidation';
import { INPUT_CLASS, LABEL_CLASS, ACCENT_BUTTON_CLASS, SUBTLE_BUTTON_CLASS } from '../ui/FormControls';

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
          <div className="w-12 h-12 rounded-2xl bg-[#f0fdf4] text-[#1f7a4c] flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6" />
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold text-base text-[#1d1d1f]">
              Check your email
            </h3>
            <p className="text-xs text-[#6e6e73] leading-relaxed font-normal">
              If an active account matches this email, we've sent a secure one-click sign-in link to:
            </p>
            <p className="text-xs font-mono font-semibold text-[#1d1d1f] bg-[#f5f5f7] py-1.5 px-3 rounded-lg inline-block break-all max-w-full">
              {sentEmail}
            </p>
          </div>

          <div className="p-3.5 bg-[#f5f5f7] rounded-xl text-left text-xs text-[#6e6e73] leading-relaxed space-y-1">
            <span className="font-semibold text-[#1d1d1f] block">Next Steps:</span>
            <p>1. Open your inbox and look for an email from Supabase / XOS.</p>
            <p>2. Click "Log In" inside the email to establish your session.</p>
            <p>3. The link expires in 15 minutes.</p>
          </div>

          <div className="pt-2 space-y-2">
            <button
              type="button"
              disabled={loading || cooldownSeconds > 0}
              onClick={handleSendLink}
              className={`${SUBTLE_BUTTON_CLASS} w-full min-h-[44px] text-xs`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>
                {cooldownSeconds > 0 ? `Resend link in ${cooldownSeconds}s` : 'Resend Magic Link'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('login')}
              className="min-h-[44px] text-xs text-[#6e6e73] hover:text-[#1d1d1f] transition-colors font-medium cursor-pointer flex items-center justify-center w-full py-2 rounded-xl"
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
              className="p-3 bg-[#fef2f2] border border-[#c92a2a]/20 text-[#991b1b] text-xs rounded-xl flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 text-[#c92a2a] mt-0.5 shrink-0" />
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
          )}

          {!isConfigured && (
            <div className="p-3 bg-[#f5f5f7] rounded-xl text-xs text-[#6e6e73] space-y-1">
              <span className="font-semibold text-[#1d1d1f] block">Supabase Connection Pending</span>
              <p className="text-[11px] leading-relaxed">
                Environment variables for Supabase are not yet configured. Provide credentials to enable live magic links.
              </p>
            </div>
          )}

          <div className="text-left">
            <label htmlFor="magic-email" className={LABEL_CLASS}>
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
              className={`${INPUT_CLASS} min-h-[44px]`}
            />
          </div>

          <motion.button
            whileTap={tapScale.button}
            type="submit"
            disabled={loading}
            className={`${ACCENT_BUTTON_CLASS} w-full min-h-[48px] text-sm font-semibold`}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Sending Magic Link...</span>
              </>
            ) : (
              <>
                <Mail className="w-4 h-4" />
                <span>Send Magic Link</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </motion.button>

          {/* Free Plan Magic Link Notice */}
          <div className="text-[11px] text-[#6e6e73] leading-relaxed space-y-1 px-3.5 py-2.5 bg-[#f5f5f7] rounded-xl text-left">
            <span className="font-semibold text-[#1d1d1f] block">Free Plan Notice</span>
            <p>On the free plan, you can request up to 2 magic links per hour. This limit helps prevent abuse and maintain reliable service.</p>
            <p>Please wait until your hourly limit resets before requesting another magic link.</p>
          </div>

          <div className="pt-3 text-center text-xs text-[#6e6e73] border-t border-black/[0.06]">
            <span>Prefer to use a password? </span>
            <button
              type="button"
              disabled={loading}
              onClick={() => onNavigate('login')}
              className="font-semibold text-[#0071e3] hover:text-[#0077ed] hover:underline cursor-pointer disabled:opacity-50"
            >
              Sign In with Password
            </button>
          </div>
        </form>
      )}
    </AuthLayout>
  );
};
