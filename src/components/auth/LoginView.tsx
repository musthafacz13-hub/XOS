/**
 * XOS Login View
 * Supports password authentication, magic link redirection, forgot password routing,
 * and account creation transitions.
 */
import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { Eye, EyeOff, Loader2, ArrowRight, Mail, CheckCircle2 } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { useAuth } from '../../context/AuthContext';
import { tapScale } from '../../utils/motion';
import { validateLoginInputs, normalizeAuthEmail } from '../../utils/authValidation';

interface LoginViewProps {
  onNavigate: (view: 'welcome' | 'signup' | 'magic-link' | 'forgot-password') => void;
  onSuccess: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onNavigate, onSuccess }) => {
  const { loginWithPassword, isConfigured } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || loading) return;

    setErrorMessage(null);
    setSuccessMessage(null);

    const validationError = validateLoginInputs(email, password);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    const cleanEmail = normalizeAuthEmail(email);
    isSubmittingRef.current = true;
    setLoading(true);

    try {
      const { error } = await loginWithPassword(cleanEmail, password);
      if (!mountedRef.current) return;

      if (error) {
        setErrorMessage(error);
      } else {
        setSuccessMessage('Signed in successfully. Opening your workspace...');
        onSuccess();
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
      title="Welcome back"
      subtitle="Sign in to resume access to your personal finances, attendance, and goals."
      onBack={() => onNavigate('welcome')}
      backLabel="Back to Overview"
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Error Alert Box */}
        {errorMessage && (
          <div
            role="alert"
            className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-start gap-2"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" />
            <span className="leading-relaxed">{errorMessage}</span>
          </div>
        )}

        {/* Success Notice */}
        {successMessage && (
          <div
            role="status"
            className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="leading-relaxed">{successMessage}</span>
          </div>
        )}

        {/* Supabase Not Configured Notice (if applicable) */}
        {!isConfigured && (
          <div className="p-3 bg-neutral-100 rounded-xl border border-neutral-200 text-xs text-neutral-600 space-y-1">
            <span className="font-semibold text-neutral-900 block">Supabase Connection Pending</span>
            <p className="text-[11px] leading-relaxed">
              Environment variables for Supabase are not yet configured. Please supply VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable authentication.
            </p>
          </div>
        )}

        {/* Email Field */}
        <div className="space-y-1.5 text-left">
          <label htmlFor="login-email" className="block text-xs font-semibold text-neutral-700">
            Email address
          </label>
          <input
            id="login-email"
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

        {/* Password Field */}
        <div className="space-y-1.5 text-left">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="login-password" className="block text-xs font-semibold text-neutral-700">
              Password
            </label>
            <button
              type="button"
              disabled={loading}
              onClick={() => onNavigate('forgot-password')}
              className="text-xs text-neutral-500 hover:text-black transition-colors font-medium cursor-pointer disabled:opacity-50 py-0.5"
            >
              Forgot password?
            </button>
          </div>
          <div className="relative">
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="current-password"
              disabled={loading}
              placeholder="••••••••"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              className="w-full min-h-[44px] pl-3.5 pr-12 py-2.5 text-base md:text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF] transition-all disabled:opacity-60"
            />
            <button
              type="button"
              disabled={loading}
              onClick={() => setShowPassword(prev => !prev)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100/80 transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF]"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Submit Button */}
        <motion.button
          whileTap={tapScale.button}
          type="submit"
          disabled={loading}
          className="w-full min-h-[48px] flex items-center justify-center gap-2 py-3 bg-[#111318] text-white text-sm font-semibold rounded-xl hover:bg-black transition-colors shadow-sm disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF]"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-[#8ECFFF]" />
              <span>Authenticating...</span>
            </>
          ) : (
            <>
              <span>Log In</span>
              <ArrowRight className="w-4 h-4 text-[#8ECFFF]" />
            </>
          )}
        </motion.button>

        {/* Alternative Actions Divider */}
        <div className="relative my-4 flex items-center justify-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-black/[0.06]" />
          </div>
          <span className="relative px-3 bg-white text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
            Or continue with
          </span>
        </div>

        {/* Magic Link Alternative Button */}
        <button
          type="button"
          disabled={loading}
          onClick={() => onNavigate('magic-link')}
          className="w-full min-h-[44px] flex items-center justify-center gap-2 py-2.5 bg-neutral-50 hover:bg-neutral-100 text-neutral-700 text-xs font-semibold rounded-xl border border-neutral-200 transition-colors cursor-pointer disabled:opacity-50"
        >
          <Mail className="w-3.5 h-3.5 text-[#8ECFFF]" />
          <span>Passwordless Magic Link</span>
        </button>

        {/* Route to Sign Up */}
        <div className="pt-2 text-center text-xs text-neutral-500 border-t border-black/[0.04]">
          <span>Don't have an account yet? </span>
          <button
            type="button"
            disabled={loading}
            onClick={() => onNavigate('signup')}
            className="font-semibold text-[#111111] hover:underline cursor-pointer disabled:opacity-50"
          >
            Create an Account
          </button>
        </div>
      </form>
    </AuthLayout>
  );
};
