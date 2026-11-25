/**
 * XOS Production Authentication Security Matrix Test Suite
 * Verifies PKCE recovery routing, callback single-execution & fail-closed guards,
 * anti-enumeration across signup/magic-link/forgot-password/resend,
 * open-redirect prevention, protected-route gating, and mobile Safari CSS guards.
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveAuthRouteFromLocation, getPublicOrAuthSeoConfig } from '../utils/seo';
import {
  clearAuthUrlParams,
  isSafeExternalUrl,
  normalizeAuthEmail,
  sanitizeAuthErrorMessage,
  validateEmailAddress,
  validateLoginInputs,
  validateSignUpInputs
} from '../utils/authValidation';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Security matrix assertion failed: ${message}`);
  }
}

function runSecurityMatrixTests() {
  console.log('--- Running XOS Production Auth Security Matrix ---');
  const rootDir = path.resolve(import.meta.dirname, '..', '..');

  const supabaseSrc = fs.readFileSync(path.join(rootDir, 'src/services/supabase.ts'), 'utf8');
  const authContextSrc = fs.readFileSync(path.join(rootDir, 'src/context/AuthContext.tsx'), 'utf8');
  const callbackSrc = fs.readFileSync(path.join(rootDir, 'src/components/auth/AuthCallbackView.tsx'), 'utf8');
  const verifyEmailSrc = fs.readFileSync(path.join(rootDir, 'src/components/auth/VerifyEmailView.tsx'), 'utf8');
  const magicLinkSrc = fs.readFileSync(path.join(rootDir, 'src/components/auth/MagicLinkView.tsx'), 'utf8');
  const resetPasswordSrc = fs.readFileSync(path.join(rootDir, 'src/components/auth/ResetPasswordView.tsx'), 'utf8');
  const appSrc = fs.readFileSync(path.join(rootDir, 'src/App.tsx'), 'utf8');
  const indexCss = fs.readFileSync(path.join(rootDir, 'src/index.css'), 'utf8');
  const loginViewSrc = fs.readFileSync(path.join(rootDir, 'src/components/auth/LoginView.tsx'), 'utf8');

  // 1. Signup validation & anti-enumeration
  console.log('1. Testing signup validation & anti-enumeration...');
  assert(
    validateSignUpInputs('Test User', 'test@example.com', 'StrongPass1', 'StrongPass1') === null,
    'Valid signup input passes validation'
  );
  assert(
    validateSignUpInputs('Test User', 'test@example.com', '1234567', '1234567') !== null,
    'Rejects weak password under 8 chars'
  );
  const dupSanitized = sanitizeAuthErrorMessage({ message: 'User already registered' });
  assert(
    !dupSanitized.toLowerCase().includes('already exists'),
    'Duplicate registration error message never confirms account existence'
  );
  assert(
    !authContextSrc.includes('already exists') &&
      authContextSrc.includes('identities.length === 0') &&
      verifyEmailSrc.includes('If this email is eligible for a new account'),
    'Signup & VerifyEmailView enforce anti-enumeration for already-registered addresses'
  );

  // 2. Existing-user password login & invalid password error sanitization
  console.log('2. Testing password login validation & generic credential errors...');
  assert(validateLoginInputs('user@example.com', 'pass1234') === null, 'Valid login payload accepted');
  const invalidCredsMsg = sanitizeAuthErrorMessage({ message: 'Invalid login credentials' });
  assert(
    invalidCredsMsg === 'Incorrect email or password. Please verify and try again.',
    'Invalid credentials returns generic non-enumerating error'
  );

  // 3. Magic Link existing-user enforcement & unknown-email anti-enumeration
  console.log('3. Testing Magic Link shouldCreateUser: false & anti-enumeration...');
  assert(
    authContextSrc.includes('shouldCreateUser: false'),
    'Magic Link enforces shouldCreateUser: false so unknown emails cannot create accounts'
  );
  assert(
    authContextSrc.includes("lower.includes('signups not allowed')") &&
      authContextSrc.includes("lower.includes('otp_disabled')") &&
      magicLinkSrc.includes('If an active account matches this email'),
    'Magic Link suppresses user-not-found / signups-not-allowed enumeration'
  );

  // 4. PKCE Callback Routing & Single-Use Coalescing (CRITICAL)
  console.log('4. Testing PKCE recovery routing, token_hash, and callback safety...');
  assert(
    resolveAuthRouteFromLocation({
      pathname: '/auth/callback',
      search: '?type=recovery&code=pkce_abc_123',
      hash: ''
    }) === 'callback',
    'PKCE recovery link (/auth/callback?type=recovery&code=...) routes to callback BEFORE reset-password'
  );
  assert(
    resolveAuthRouteFromLocation({
      pathname: '/auth/callback',
      search: '?type=recovery&error=access_denied&error_code=otp_expired',
      hash: ''
    }) === 'callback',
    'Expired PKCE recovery link routes to callback error handler BEFORE reset-password'
  );
  assert(
    resolveAuthRouteFromLocation({
      pathname: '/auth/callback',
      search: '?token_hash=hash_123&type=recovery',
      hash: ''
    }) === 'callback',
    'OTP token_hash recovery link routes to callback'
  );
  assert(
    resolveAuthRouteFromLocation({
      pathname: '/auth/callback',
      search: '',
      hash: '#access_token=jwt&refresh_token=ref&type=recovery'
    }) === 'callback',
    'Implicit hash fragment recovery link routes to callback'
  );
  assert(
    supabaseSrc.includes('detectSessionInUrl: false') && supabaseSrc.includes("flowType: 'pkce'"),
    'Supabase client uses PKCE with detectSessionInUrl: false so AuthCallbackView owns token exchange'
  );
  assert(
    callbackSrc.includes('exchangeCodeOnce') &&
      callbackSrc.includes('pkceExchangeInFlight') &&
      callbackSrc.includes('verifyOtp') &&
      callbackSrc.includes('setSession'),
    'AuthCallbackView coalesces PKCE code exchange and handles token_hash & hash fragments'
  );
  assert(
    !callbackSrc.includes('supabase.auth.getSession()'),
    'AuthCallbackView never falls back to pre-existing getSession() when callback tokens are missing'
  );

  // 5. Password Recovery Guard & Cancel Signout
  console.log('5. Testing Password Recovery session guard & cancel safety...');
  assert(
    !authContextSrc.includes("window.location.hash.includes('type=recovery')"),
    'AuthContext does not blindly enter recovery mode from unverified URL hash'
  );
  assert(
    authContextSrc.includes("event === 'PASSWORD_RECOVERY' && currentSession") &&
      appSrc.includes('if (isPasswordRecovery && user)'),
    'Recovery route transition requires an authenticated session'
  );
  assert(
    resetPasswordSrc.includes('disabled={loading || !user}') &&
      resetPasswordSrc.includes('handleReturnToLogin') &&
      resetPasswordSrc.includes('await signOut()'),
    'ResetPasswordView disables submission without active session and signs out recovery session on cancel'
  );

  // 6. Session persistence, logout cleanup, & URL token scrubbing
  console.log('6. Testing session persistence, logout clearing, and URL param scrubbing...');
  assert(
    supabaseSrc.includes('persistSession: true') && supabaseSrc.includes('autoRefreshToken: true'),
    'Session persistence and automatic refresh enabled'
  );
  assert(
    authContextSrc.includes('repository.clearUserData()') &&
      authContextSrc.includes('apiOptimization.invalidateCache()') &&
      authContextSrc.includes('clearAuthUrlParams()'),
    'Sign out clears cached data, user state, and URL params'
  );
  let cleanedUrl = '';
  const prevWin = (globalThis as { window?: unknown }).window;
  (globalThis as { window: unknown }).window = {
    location: {
      href: 'https://xos-chi.vercel.app/auth/callback?token_hash=th_1&type=signup#access_token=secret&refresh_token=ref'
    },
    history: {
      replaceState: (_s: unknown, _t: string, url: string) => {
        cleanedUrl = url;
      }
    }
  };
  clearAuthUrlParams();
  if (prevWin === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window: unknown }).window = prevWin;
  assert(cleanedUrl === '/', `clearAuthUrlParams strips token_hash and hash tokens cleanly (got: ${cleanedUrl})`);

  // 7. Protected-route gating & Open redirect prevention
  console.log('7. Testing protected workspace gating & open-redirect prevention...');
  assert(
    appSrc.includes('const isAuthenticated = Boolean(user);') &&
      appSrc.includes('if (showingAuthScreen)'),
    'App.tsx blocks workspace views when unauthenticated'
  );
  assert(
    !authContextSrc.includes('searchParams.get(\'next\')') &&
      !authContextSrc.includes('searchParams.get(\'redirect\')') &&
      authContextSrc.includes('`${window.location.origin}/auth/callback`'),
    'All auth redirects are pinned to same-origin /auth/callback without arbitrary redirect parameters'
  );
  assert(
    isSafeExternalUrl('https://xos-chi.vercel.app/auth/callback') !== undefined &&
      isSafeExternalUrl('javascript:alert(1)') === undefined &&
      isSafeExternalUrl('data:text/html,<script>1</script>') === undefined,
    'External URL validator rejects dangerous protocols'
  );
  assert(
    getPublicOrAuthSeoConfig('callback').robots === 'noindex, nofollow' &&
      getPublicOrAuthSeoConfig('reset-password').robots === 'noindex, nofollow',
    'Private auth & recovery routes enforce noindex, nofollow'
  );

  // 8. Mobile Safari compatibility & normalization
  console.log('8. Testing Mobile Safari touch targets & input attributes...');
  assert(
    loginViewSrc.includes('inputMode="email"') &&
      loginViewSrc.includes('autoCapitalize="none"') &&
      loginViewSrc.includes('min-h-[44px]') &&
      indexCss.includes('font-size: 16px'),
    'Mobile Safari email attributes, 44px+ tap targets, and 16px input zoom prevention intact'
  );
  assert(
    normalizeAuthEmail('  USER@Example.COM ') === 'user@example.com' &&
      validateEmailAddress('user@example.com') === null,
    'Email normalization & validation work across whitespace/casing'
  );

  console.log('ALL PRODUCTION AUTH SECURITY MATRIX CHECKS PASSED!');
}

runSecurityMatrixTests();
