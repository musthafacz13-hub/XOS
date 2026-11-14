/**
 * XOS Reset Password View
 * Allows authenticated recovery sessions to securely update password credentials.
 */
import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { Eye, EyeOff, Loader2, ArrowRight, CheckCircle2, ShieldAlert } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { useAuth } from '../../context/AuthContext';
import { tapScale } from '../../utils/motion';
import { clearAuthUrlParams } from '../../utils/authValidation';

interface ResetPasswordViewProps {
  onSuccess: () => void;
  onNavigateLogin: () => void;
}

export const ResetPasswordView: React.FC<ResetPasswordViewProps> = ({
  onSuccess,
  onNavigateLogin
}) => {
  const { updatePassword, user, clearPasswordRecoveryFlag } = useAuth();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

    if (password.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match. Please verify your entries.');
      return;
    }

    isSubmittingRef.current = true;
    setLoading(true);

    try {
      const { error } = await updatePassword(password);
      if (!mountedRef.current) return;

      if (error) {
        setErrorMessage(error);
      } else {
        setSuccess(true);
        clearAuthUrlParams();
        clearPasswordRecoveryFlag();
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
      title="Set a new password"
      subtitle="Choose a secure password with at least 8 characters for your XOS workspace."
    >
      {success ? (
        <div className="space-y-5 text-center py-2">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-100 shadow-xs">
            <CheckCircle2 className="w-6 h-6" />
          </div>

          <div className="space-y-1.5">
            <h3 className="font-bold text-base text-[#111111]">
              Password updated successfully
            </h3>
            <p className="text-xs text-neutral-600 leading-relaxed font-normal">
              Your new password is now active. You can proceed directly into your personal workspace.
            </p>
          </div>

          <motion.button
            whileTap={tapScale.button}
            onClick={() => {
              clearAuthUrlParams();
              onSuccess();
            }}
            type="button"
            className="w-full min-h-[48px] flex items-center justify-center gap-2 py-3 bg-[#111318] text-white text-xs sm:text-sm font-semibold rounded-xl hover:bg-black transition-colors shadow-sm cursor-pointer"
          >
            <span>Enter Workspace</span>
            <ArrowRight className="w-4 h-4 text-[#8ECFFF]" />
          </motion.button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {errorMessage && (
            <div
              role="alert"
              className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-start gap-2"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" />
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
          )}

          {!user && (
            <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="leading-relaxed">
                No active recovery session was detected. If your recovery link expired, please request a new reset email.
              </p>
            </div>
          )}

          <div className="space-y-1.5 text-left">
            <label htmlFor="new-password" className="block text-xs font-semibold text-neutral-700">
              New password
            </label>
            <div className="relative">
              <input
                id="new-password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="new-password"
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

          <div className="space-y-1.5 text-left">
            <label htmlFor="confirm-new-password" className="block text-xs font-semibold text-neutral-700">
              Confirm new password
            </label>
            <input
              id="confirm-new-password"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              disabled={loading}
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
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
                <span>Updating Password...</span>
              </>
            ) : (
              <>
                <span>Update Password</span>
                <ArrowRight className="w-4 h-4 text-[#87CEEB]" />
              </>
            )}
          </motion.button>

          <div className="pt-2 text-center text-xs text-neutral-500 border-t border-black/[0.04]">
            <button
              type="button"
              disabled={loading}
              onClick={onNavigateLogin}
              className="min-h-[44px] px-4 inline-flex items-center justify-center text-neutral-500 hover:text-black font-medium transition-colors cursor-pointer rounded-xl disabled:opacity-50"
            >
              Return to Login
            </button>
          </div>
        </form>
      )}
    </AuthLayout>
  );
};
