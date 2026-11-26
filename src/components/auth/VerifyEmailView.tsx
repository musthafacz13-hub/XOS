/**
 * XOS Verify Email Confirmation Screen
 * Rendered after user registration to guide the user through inbox confirmation.
 */
import React, { useState, useEffect, useRef } from 'react';
import { Mail, CheckCircle, RotateCcw, ArrowRight } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { useAuth } from '../../context/AuthContext';
import { ACCENT_BUTTON_CLASS, SUBTLE_BUTTON_CLASS } from '../ui/FormControls';

interface VerifyEmailViewProps {
  email: string;
  onNavigateLogin: () => void;
}

export const VerifyEmailView: React.FC<VerifyEmailViewProps> = ({
  email,
  onNavigateLogin
}) => {
  const { resendVerificationEmail } = useAuth();
  const [cooldownSeconds, setCooldownSeconds] = useState(60);
  const [resending, setResending] = useState(false);
  const [resendNotice, setResendNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const mountedRef = useRef(true);
  const isResendingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setCooldownSeconds(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  const handleResend = async () => {
    if (cooldownSeconds > 0 || isResendingRef.current || resending || !email) return;

    isResendingRef.current = true;
    setResending(true);
    setResendNotice(null);

    try {
      const { error } = await resendVerificationEmail(email);
      if (!mountedRef.current) return;

      if (error) {
        setResendNotice({ type: 'error', text: error });
      } else {
        setResendNotice({
          type: 'success',
          text: 'If this address has a pending verification, a fresh link has been sent.'
        });
        setCooldownSeconds(60);
      }
    } finally {
      isResendingRef.current = false;
      if (mountedRef.current) {
        setResending(false);
      }
    }
  };

  return (
    <AuthLayout
      title="Verify your email"
      subtitle="Almost ready. Confirm your email address to activate your personal workspace."
      onBack={onNavigateLogin}
      backLabel="Back to Login"
    >
      <div className="space-y-5 text-center py-2">
        {/* Email Icon */}
        <div className="w-14 h-14 rounded-2xl bg-[#e8f2ff] text-[#0071e3] flex items-center justify-center mx-auto">
          <Mail className="w-7 h-7" />
        </div>

        {/* Messaging */}
        <div className="space-y-2">
          <h3 className="font-semibold text-base text-[#1d1d1f]">
            Check your inbox
          </h3>
          <p className="text-xs text-[#6e6e73] leading-relaxed font-normal">
            If this email is eligible for a new account, we've sent a confirmation link to:
          </p>
          <div className="text-xs font-mono font-semibold text-[#1d1d1f] bg-[#f5f5f7] py-1.5 px-3 rounded-lg inline-block break-all max-w-full">
            {email || 'your email address'}
          </div>
        </div>

        {/* Step Guide */}
        <div className="p-4 bg-[#f5f5f7] rounded-2xl text-left text-xs text-[#6e6e73] space-y-2">
          <span className="font-semibold text-[#1d1d1f] block text-xs">
            Verification Steps
          </span>
          <div className="flex items-start gap-2">
            <CheckCircle className="w-3.5 h-3.5 text-[#1f7a4c] mt-0.5 shrink-0" />
            <span>Open the message from Supabase / XOS in your inbox.</span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle className="w-3.5 h-3.5 text-[#1f7a4c] mt-0.5 shrink-0" />
            <span>Click the confirmation link to securely authenticate your session.</span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle className="w-3.5 h-3.5 text-[#1f7a4c] mt-0.5 shrink-0" />
            <span>Already have an account? Return to Log In or reset your password if needed.</span>
          </div>
        </div>

        {/* Resend Notice */}
        {resendNotice && (
          <div
            role={resendNotice.type === 'error' ? 'alert' : 'status'}
            className={`p-3 border text-xs rounded-xl ${
              resendNotice.type === 'error'
                ? 'bg-[#fef2f2] border-[#c92a2a]/20 text-[#991b1b]'
                : 'bg-[#f0fdf4] border-[#1f7a4c]/20 text-[#166534]'
            }`}
          >
            {resendNotice.text}
          </div>
        )}

        {/* Actions */}
        <div className="pt-2 space-y-2.5">
          <button
            type="button"
            disabled={cooldownSeconds > 0 || resending || !email}
            onClick={handleResend}
            className={`${SUBTLE_BUTTON_CLASS} w-full min-h-[44px] text-xs`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>
              {cooldownSeconds > 0
                ? `Resend verification link in ${cooldownSeconds}s`
                : resending
                ? 'Sending...'
                : 'Resend Verification Email'}
            </span>
          </button>

          <button
            type="button"
            onClick={onNavigateLogin}
            className={`${ACCENT_BUTTON_CLASS} w-full min-h-[48px] text-sm font-semibold`}
          >
            <span>Back to Log In</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </AuthLayout>
  );
};
