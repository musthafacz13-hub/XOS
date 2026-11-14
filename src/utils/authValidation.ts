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
    return 'An account with this email address already exists. Please log in instead.';
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
  if (lower.includes('rate limit') || lower.includes('over_email_send_rate_limit') || lower.includes('over_request_rate_limit')) {
    return 'Too many attempts. Please wait a moment before trying again.';
  }

  return msg || 'An unexpected error occurred. Please try again.';
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

    const authQueryKeys = ['code', 'type', 'token_hash', 'error', 'error_code', 'error_description'];
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
      hash.includes('type=recovery') ||
      hash.includes('error=') ||
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
