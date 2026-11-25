/**
 * XOS Authentication Callback Processor
 * Handles incoming Supabase auth redirects (PKCE codes, token_hash OTP, token fragments, password recovery, email verification).
 */
import React, { useEffect, useState, useRef } from 'react';
import type { EmailOtpType } from '@supabase/supabase-js';
import { Loader2, AlertCircle, ArrowRight } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../services/supabase';
import { AuthLayout } from './AuthLayout';
import { clearAuthUrlParams, sanitizeAuthErrorMessage } from '../../utils/authValidation';

interface AuthCallbackViewProps {
  onSuccess: () => void;
  onPasswordRecovery: () => void;
  onNavigateLogin: () => void;
}

const ALLOWED_OTP_TYPES = new Set<EmailOtpType>([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email'
]);

const pkceExchangeInFlight = new Map<
  string,
  Promise<Awaited<ReturnType<typeof supabase.auth.exchangeCodeForSession>>>
>();

function exchangeCodeOnce(code: string) {
  const existing = pkceExchangeInFlight.get(code);
  if (existing) return existing;
  const promise = supabase.auth.exchangeCodeForSession(code).finally(() => {
    pkceExchangeInFlight.delete(code);
  });
  pkceExchangeInFlight.set(code, promise);
  return promise;
}

export const AuthCallbackView: React.FC<AuthCallbackViewProps> = ({
  onSuccess,
  onPasswordRecovery,
  onNavigateLogin
}) => {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasProcessedRef = useRef(false);

  useEffect(() => {
    if (hasProcessedRef.current) return;
    hasProcessedRef.current = true;

    let active = true;

    const processAuthCallback = async () => {
      // 1. Check for explicit error in URL parameters or hash fragments
      const urlParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.substring(1));

      const errorDesc = urlParams.get('error_description') || hashParams.get('error_description');
      const errorCode = urlParams.get('error_code') || hashParams.get('error_code');
      const errorMsg = urlParams.get('error') || hashParams.get('error');

      if (errorDesc || errorCode || errorMsg) {
        clearAuthUrlParams();
        if (active) {
          let decoded = errorDesc || errorCode || errorMsg || 'Authentication callback failed.';
          try {
            decoded = decodeURIComponent(decoded);
          } catch {
            // Keep raw message if already decoded or malformed
          }
          if (errorCode === 'otp_expired' && !decoded.toLowerCase().includes('expired')) {
            decoded = 'otp_expired';
          }
          setErrorMessage(sanitizeAuthErrorMessage(decoded));
        }
        return;
      }

      // 2. Check for password recovery type
      const rawType = urlParams.get('type') || hashParams.get('type');
      const isRecovery = rawType === 'recovery';

      if (!isSupabaseConfigured) {
        clearAuthUrlParams();
        if (active) {
          onNavigateLogin();
        }
        return;
      }

      // 3. Check for PKCE Authorization Code (single-use coalesced exchange)
      const code = urlParams.get('code');
      if (code) {
        try {
          const { data, error } = await exchangeCodeOnce(code);
          clearAuthUrlParams();
          if (!active) return;

          if (error) {
            setErrorMessage(sanitizeAuthErrorMessage(error));
            return;
          }

          if (isRecovery && data.session) {
            onPasswordRecovery();
          } else if (data.session) {
            onSuccess();
          } else {
            setErrorMessage('This authentication link could not be verified. Please request a new link and try again.');
          }
          return;
        } catch (err) {
          clearAuthUrlParams();
          if (active) {
            setErrorMessage(sanitizeAuthErrorMessage(err));
          }
          return;
        }
      }

      // 4. Check for OTP token_hash callback (email confirmation, magic link, recovery)
      const tokenHash = urlParams.get('token_hash');
      if (tokenHash) {
        if (!rawType || !ALLOWED_OTP_TYPES.has(rawType as EmailOtpType)) {
          clearAuthUrlParams();
          if (active) {
            setErrorMessage('This authentication link is invalid or incomplete. Please request a new link.');
          }
          return;
        }
        try {
          const { data, error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: rawType as EmailOtpType
          });
          clearAuthUrlParams();
          if (!active) return;

          if (error) {
            setErrorMessage(sanitizeAuthErrorMessage(error));
            return;
          }

          if (isRecovery && data.session) {
            onPasswordRecovery();
          } else if (data.session) {
            onSuccess();
          } else {
            setErrorMessage('This verification link could not be verified. Please request a new link.');
          }
          return;
        } catch (err) {
          clearAuthUrlParams();
          if (active) {
            setErrorMessage(sanitizeAuthErrorMessage(err));
          }
          return;
        }
      }

      // 5. Check for implicit hash fragment tokens (detectSessionInUrl is intentionally false)
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      if (accessToken) {
        if (!refreshToken) {
          clearAuthUrlParams();
          if (active) {
            setErrorMessage('This authentication link is incomplete or corrupted. Please request a new link.');
          }
          return;
        }
        try {
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          });
          clearAuthUrlParams();
          if (!active) return;

          if (error) {
            setErrorMessage(sanitizeAuthErrorMessage(error));
            return;
          }

          if (isRecovery && data.session) {
            onPasswordRecovery();
          } else if (data.session) {
            onSuccess();
          } else {
            setErrorMessage('This authentication link has expired or could not establish a session.');
          }
          return;
        } catch (err) {
          clearAuthUrlParams();
          if (active) {
            setErrorMessage(sanitizeAuthErrorMessage(err));
          }
          return;
        }
      }

      // 6. Interrupted, stripped, or empty callback URL: fail safely without reusing a pre-existing session
      clearAuthUrlParams();
      if (active) {
        setErrorMessage('This authentication link is incomplete, expired, or has already been used. Please request a new link.');
      }
    };

    processAuthCallback();

    return () => {
      active = false;
    };
  }, [onSuccess, onPasswordRecovery, onNavigateLogin]);

  return (
    <AuthLayout
      title="Securing your session"
      subtitle="Validating authentication tokens and preparing your personal workspace."
    >
      <div className="py-8 text-center space-y-4">
        {errorMessage ? (
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>

            <div className="space-y-1">
              <h3 className="font-semibold text-sm text-[#1d1d1f]">
                Authentication link could not be verified
              </h3>
              <p className="text-xs text-[#6e6e73] leading-relaxed font-normal">
                {errorMessage}
              </p>
            </div>

            <button
              onClick={() => {
                clearAuthUrlParams();
                onNavigateLogin();
              }}
              type="button"
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-5 py-2.5 bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
            >
              <span>Return to Login</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-[#0284c7]" />
            <p className="text-xs text-[#6e6e73] font-medium">
              Authenticating session with Supabase...
            </p>
          </div>
        )}
      </div>
    </AuthLayout>
  );
};
