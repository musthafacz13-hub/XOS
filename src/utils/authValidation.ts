/**
 * XOS Authentication Validation, Error Mapping & URL Cleanup Helpers
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeAuthEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateEmailAddress(email: string): string | null {
  const cleaned = email.trim();
  if (!cleaned) {
    return 'Please enter your email address.';
  }
  if (!EMAIL_PATTERN.test(cleaned)) {
    return 'Please enter a valid email address.';
  }
  return null;
}

export function validateLoginInputs(email: string, password: string): string | null {
  const emailError = validateEmailAddress(email);
  if (emailError) return emailError;

  if (!password) {
    return 'Please enter your password.';
  }
  return null;
}

export function validateSignUpInputs(
  fullName: string,
  email: string,
  password: string,
  confirmPassword: string
): string | null {
  if (!fullName.trim()) {
    return 'Please enter your full name.';
  }

  const emailError = validateEmailAddress(email);
  if (emailError) return emailError;

  if (password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }

  if (password !== confirmPassword) {
    return 'Passwords do not match. Please re-enter carefully.';
  }

  return null;
}

const INTERNAL_ERROR_LEAK_PATTERN =
  /(?:pg_|sqlstate|pgrst\d*|postgrest|violates row-level security|row-level security policy|permission denied for (?:table|relation|schema|function)|relation\s+"[^"]+"|column\s+"[^"]+"|schema\s+"[^"]+"|constraint\s+"[^"]+"|function\s+public\.|could not find the function|syntax error at or near|postgres(?:ql)?:\/\/|https?:\/\/\S+|econnrefused|enotfound|\n\s+at\s+)/i;

export function isSafeExternalUrl(rawUrl: unknown): string | undefined {
  if (typeof rawUrl !== 'string') return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function sanitizeDatabaseErrorMessage(
  err: unknown,
  fallbackMessage: string = 'An unexpected error occurred. Please try again.'
): string {
  if (!err) return fallbackMessage;

  const name = err instanceof Error ? err.name : '';
  const msg =
    typeof err === 'string'
      ? err.trim()
      : err instanceof Error
        ? err.message.trim()
        : typeof (err as { message?: unknown })?.message === 'string'
          ? String((err as { message: string }).message).trim()
          : '';

  if (!msg) return fallbackMessage;

  const lower = msg.toLowerCase();

  if (name === 'TimeoutError' || lower.includes('timed out')) {
    return 'The request timed out. Please check your connection and try again.';
  }
  if (name === 'AbortError' || lower.includes('fetch is aborted')) {
    return msg;
  }
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network request failed')) {
    return 'Network connection unavailable. Check your internet connection and try again.';
  }
  if (lower.includes('violates row-level security') || lower.includes('permission denied for')) {
    return 'You do not have permission to perform this action.';
  }
  if (lower.includes('duplicate key value')) {
    return 'A matching record already exists.';
  }
  if (lower.includes('violates foreign key constraint')) {
    return 'This record is linked to another item and cannot be modified or removed directly.';
  }
  if (INTERNAL_ERROR_LEAK_PATTERN.test(msg) || msg.length > 260) {
    return fallbackMessage;
  }

  return msg;
}

export function sanitizeAuthErrorMessage(err: unknown): string {
  if (!err) return '';

  const name = err instanceof Error ? err.name : '';
  const msg =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? err.message
        : typeof (err as { message?: unknown })?.message === 'string'
          ? String((err as { message: string }).message)
          : '';
  const lower = msg.toLowerCase();

  if (name === 'TimeoutError' || lower.includes('timed out')) {
    return 'The authentication request timed out. Please check your connection and try again.';
  }
  if (name === 'AbortError' || lower.includes('fetch is aborted') || lower.includes('aborted')) {
    return 'The connection was interrupted before completing. Please try again.';
  }
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network request failed')) {
    return 'Network connection unavailable. Check your internet connection and try again.';
  }
  if (lower.includes('invalid login credentials') || lower.includes('invalid_grant')) {
    return 'Incorrect email or password. Please verify and try again.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Please verify your email address before logging in. Check your inbox for the confirmation link.';
  }
  if (lower.includes('user already registered') || lower.includes('already been registered')) {
    return 'Unable to complete sign up with this email. If you already have an account, please log in or reset your password.';
  }
  if (lower.includes('password should be at least') || lower.includes('weak_password')) {
    return 'Password must be at least 8 characters long.';
  }
  if (lower.includes('same_password') || lower.includes('different from the old password')) {
    return 'Your new password must be different from your current password.';
  }
  if (lower.includes('otp_expired') || lower.includes('token has expired') || lower.includes('invalid or has expired')) {
    return 'This verification or reset link has expired. Please request a new one.';
  }
  if (
    lower.includes('access_denied') ||
    lower.includes('user denied') ||
    lower.includes('consent_required') ||
    lower.includes('cancelled') ||
    lower.includes('canceled')
  ) {
    return 'Google sign-in was cancelled. You can try again or use another sign-in method.';
  }
  if (
    lower.includes('unsupported provider') ||
    lower.includes('provider is not enabled') ||
    lower.includes('provider_disabled')
  ) {
    return 'Google sign-in is not currently enabled. Please sign in with your email and password or Magic Link.';
  }
  if (
    lower.includes('bad_oauth_state') ||
    lower.includes('invalid_oauth_state') ||
    lower.includes('oauth_state') ||
    lower.includes('flow_state_not_found') ||
    lower.includes('flow_state_expired') ||
    lower.includes('code verifier') ||
    lower.includes('code_verifier') ||
    lower.includes('both auth code and code verifier')
  ) {
    return 'Your Google sign-in session expired or could not be verified. Please start Google sign-in again.';
  }
  if (lower.includes('bad_oauth_callback') || lower.includes('oauth_callback')) {
    return 'Google authentication could not be completed. Please try again.';
  }
  if (lower.includes('identity_already_exists') || lower.includes('manual_linking')) {
    return 'Unable to complete Google sign-in with this account automatically. Please sign in with your existing method or link Google in account settings.';
  }
  if (lower.includes('rate limit') || lower.includes('over_email_send_rate_limit') || lower.includes('over_request_rate_limit')) {
    return 'Too many attempts. Please wait a moment before trying again.';
  }

  if (!msg || INTERNAL_ERROR_LEAK_PATTERN.test(msg) || msg.length > 220) {
    return 'An unexpected authentication error occurred. Please try again.';
  }

  return msg;
}

export const PRODUCTION_OAUTH_ORIGIN = 'https://xos-chi.vercel.app';
export const PRODUCTION_OAUTH_CALLBACK_URL = `${PRODUCTION_OAUTH_ORIGIN}/auth/callback`;

/**
 * Resolves a strict, allowlisted /auth/callback redirect URL for Supabase Auth.
 * Defaults to https://xos-chi.vercel.app/auth/callback in production and rejects
 * untrusted origins or user-controlled redirect query parameters.
 */
export function getValidatedOAuthRedirectUrl(candidateOrigin?: string): string {
  const rawOrigin =
    candidateOrigin ??
    (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null'
      ? window.location.origin
      : '');

  if (!rawOrigin) {
    return PRODUCTION_OAUTH_CALLBACK_URL;
  }

  try {
    const parsed = new URL(rawOrigin);
    if (parsed.username || parsed.password) {
      return PRODUCTION_OAUTH_CALLBACK_URL;
    }

    const hostname = parsed.hostname.toLowerCase();
    const isLocalDev =
      parsed.protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1');

    if (isLocalDev) {
      return `${parsed.origin}/auth/callback`;
    }

    if (parsed.protocol !== 'https:') {
      return PRODUCTION_OAUTH_CALLBACK_URL;
    }

    const configuredSiteUrl =
      (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SITE_URL) ||
      (typeof process !== 'undefined' ? process.env?.VITE_SITE_URL : '') ||
      '';

    let configuredOrigin = '';
    if (configuredSiteUrl) {
      try {
        const siteParsed = new URL(configuredSiteUrl);
        if (siteParsed.protocol === 'https:') {
          configuredOrigin = siteParsed.origin;
        }
      } catch {
        // Ignore invalid configured VITE_SITE_URL
      }
    }

    const isAllowedHttpsOrigin =
      parsed.origin === PRODUCTION_OAUTH_ORIGIN ||
      (Boolean(configuredOrigin) && parsed.origin === configuredOrigin) ||
      hostname.endsWith('.vercel.app') ||
      hostname.endsWith('.run.app');

    if (isAllowedHttpsOrigin) {
      return `${parsed.origin}/auth/callback`;
    }
  } catch {
    // Fall back to canonical production callback URL
  }

  return PRODUCTION_OAUTH_CALLBACK_URL;
}

/**
 * Removes single-use auth callback codes, token fragments, and auth navigation hashes
 * after authentication completes so refreshing the page stays inside the workspace.
 */
export function clearAuthUrlParams(): void {
  if (typeof window === 'undefined' || typeof window.history?.replaceState !== 'function') {
    return;
  }

  try {
    const url = new URL(window.location.href);
    let changed = false;

    if (url.pathname === '/auth/callback') {
      url.pathname = '/';
      changed = true;
    }

    const authQueryKeys = ['code', 'type', 'token_hash', 'state', 'error', 'error_code', 'error_description'];
    for (const key of authQueryKeys) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }

    const hash = url.hash || '';
    if (
      hash.includes('access_token=') ||
      hash.includes('refresh_token=') ||
      hash.includes('expires_in=') ||
      hash.includes('token_type=') ||
      hash.includes('provider_token=') ||
      hash.includes('type=recovery') ||
      hash.includes('error=') ||
      hash.includes('error_code=') ||
      hash === '#login' ||
      hash === '#signup' ||
      hash === '#magic-link' ||
      hash === '#forgot-password'
    ) {
      url.hash = '';
      changed = true;
    }

    if (changed) {
      const nextUrl = `${url.pathname}${url.search}${url.hash}` || '/';
      window.history.replaceState(null, '', nextUrl);
    }
  } catch {
    // Ignore history API restrictions in embedded contexts
  }
}
