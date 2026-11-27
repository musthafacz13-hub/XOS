/**
 * XOS Production Google OAuth Integration & Security Test Suite
 * Verifies Google OAuth redirect allowlisting, PKCE provider invocation,
 * Login/SignUp button labels & duplicate-click guards, OAuth callback routing,
 * error sanitization, non-destructive profile hydration, and zero client secrets.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  PRODUCTION_OAUTH_CALLBACK_URL,
  clearAuthUrlParams,
  getValidatedOAuthRedirectUrl,
  isSafeExternalUrl,
  sanitizeAuthErrorMessage,
  validateLoginInputs,
  validateSignUpInputs
} from '../utils/authValidation';
import { resolveAuthRouteFromLocation } from '../utils/seo';
import { apiOptimization } from '../services/apiClient';
import { repository } from '../services/repository';
import { supabase } from '../services/supabase';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Google OAuth assertion failed: ${message}`);
  }
}

async function runGoogleOAuthTests() {
  console.log('--- Running XOS Production Google OAuth Test Suite ---');
  const rootDir = path.resolve(import.meta.dirname, '..', '..');

  // ==========================================
  // TEST 1: Validated OAuth Callback Redirect URLs
  // ==========================================
  console.log('1. Testing validated OAuth /auth/callback redirect URL allowlist...');

  assert(
    PRODUCTION_OAUTH_CALLBACK_URL === 'https://xos-chi.vercel.app/auth/callback',
    'Production callback URL is https://xos-chi.vercel.app/auth/callback'
  );
  assert(
    getValidatedOAuthRedirectUrl('https://xos-chi.vercel.app') === 'https://xos-chi.vercel.app/auth/callback',
    'Allows canonical production origin'
  );
  assert(
    getValidatedOAuthRedirectUrl('http://localhost:3000') === 'http://localhost:3000/auth/callback',
    'Allows localhost dev origin'
  );
  assert(
    getValidatedOAuthRedirectUrl('http://127.0.0.1:4173') === 'http://127.0.0.1:4173/auth/callback',
    'Allows 127.0.0.1 dev origin'
  );
  assert(
    getValidatedOAuthRedirectUrl('https://xos-preview-123.vercel.app') === 'https://xos-preview-123.vercel.app/auth/callback',
    'Allows HTTPS Vercel preview origins'
  );
  assert(
    getValidatedOAuthRedirectUrl('https://ais-dev-demo.asia-east1.run.app') === 'https://ais-dev-demo.asia-east1.run.app/auth/callback',
    'Allows HTTPS Cloud Run preview origins'
  );
  assert(
    getValidatedOAuthRedirectUrl('https://evil-phishing.example.com') === PRODUCTION_OAUTH_CALLBACK_URL,
    'Rejects arbitrary external domain and falls back to production URL'
  );
  assert(
    getValidatedOAuthRedirectUrl('http://xos-chi.vercel.app') === PRODUCTION_OAUTH_CALLBACK_URL,
    'Rejects insecure HTTP non-local origin'
  );
  assert(
    getValidatedOAuthRedirectUrl('javascript:alert(1)') === PRODUCTION_OAUTH_CALLBACK_URL,
    'Rejects javascript: URI'
  );
  assert(
    getValidatedOAuthRedirectUrl('') === PRODUCTION_OAUTH_CALLBACK_URL,
    'Empty origin defaults safely to production callback URL'
  );

  // ==========================================
  // TEST 2: Supabase Client PKCE & signInWithOAuth Contract
  // ==========================================
  console.log('2. Testing Supabase PKCE signInWithOAuth(google) invocation & coalescing...');

  const supabaseSrc = fs.readFileSync(path.join(rootDir, 'src/services/supabase.ts'), 'utf8');
  const authContextSrc = fs.readFileSync(path.join(rootDir, 'src/context/AuthContext.tsx'), 'utf8');

  assert(
    supabaseSrc.includes("flowType: 'pkce'") && supabaseSrc.includes('detectSessionInUrl: false'),
    'Supabase client enforces PKCE and delegates callback exchange to AuthCallbackView'
  );
  assert(
    authContextSrc.includes("provider: 'google'") &&
      authContextSrc.includes('supabase.auth.signInWithOAuth') &&
      authContextSrc.includes('redirectTo'),
    'AuthContext calls supabase.auth.signInWithOAuth with provider google and validated redirectTo'
  );

  // Exercise live supabase.auth.signInWithOAuth signature and coalescing guard via stub
  const originalSignInWithOAuth = supabase.auth.signInWithOAuth.bind(supabase.auth);
  let oauthCalls = 0;
  let capturedArgs: any = null;

  (supabase.auth as any).signInWithOAuth = async (params: any) => {
    oauthCalls += 1;
    capturedArgs = params;
    await new Promise((r) => setTimeout(r, 15));
    return {
      data: {
        provider: 'google',
        url: `https://ufqoimwporqdmjkzpmbh.supabase.co/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(params?.options?.redirectTo || '')}`
      },
      error: null
    };
  };

  try {
    const [res1, res2] = await Promise.all([
      apiOptimization.coalesce('auth:oauth:google:test', () =>
        supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: getValidatedOAuthRedirectUrl('https://xos-chi.vercel.app') }
        })
      ),
      apiOptimization.coalesce('auth:oauth:google:test', () =>
        supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: getValidatedOAuthRedirectUrl('https://xos-chi.vercel.app') }
        })
      )
    ]);

    assert(oauthCalls === 1, `Duplicate concurrent Google OAuth calls coalesce to 1 request (got: ${oauthCalls})`);
    assert(capturedArgs?.provider === 'google', 'Passes provider: google');
    assert(
      capturedArgs?.options?.redirectTo === 'https://xos-chi.vercel.app/auth/callback',
      'Passes production /auth/callback redirectTo'
    );
    assert(Boolean(res1.data?.url) && Boolean(res2.data?.url), 'Returns Supabase authorize redirect URL');
  } finally {
    (supabase.auth as any).signInWithOAuth = originalSignInWithOAuth;
  }

  // ==========================================
  // TEST 3: UI Components — Exact Labels, Official Google SVG & Dual Button Lock
  // ==========================================
  console.log('3. Testing LoginView, SignUpView, and GoogleAuthButton labels, branding & guards...');

  const googleBtnSrc = fs.readFileSync(path.join(rootDir, 'src/components/auth/GoogleAuthButton.tsx'), 'utf8');
  const loginViewSrc = fs.readFileSync(path.join(rootDir, 'src/components/auth/LoginView.tsx'), 'utf8');
  const signUpViewSrc = fs.readFileSync(path.join(rootDir, 'src/components/auth/SignUpView.tsx'), 'utf8');

  // Official 4-color Google G SVG brand colors (never recolored to XOS blue)
  assert(
    googleBtnSrc.includes('#4285F4') &&
      googleBtnSrc.includes('#34A853') &&
      googleBtnSrc.includes('#FBBC05') &&
      googleBtnSrc.includes('#EA4335'),
    'GoogleBrandLogo preserves all four official Google brand colors'
  );
  assert(
    googleBtnSrc.includes('aria-hidden="true"') &&
      googleBtnSrc.includes('bg-white') &&
      googleBtnSrc.includes('border border-black/[0.12]') &&
      googleBtnSrc.includes('text-[#1d1d1f]'),
    'GoogleAuthButton uses clean white surface, neutral border, dark text, and accessible SVG semantics'
  );

  // LoginView checks
  assert(
    loginViewSrc.includes('label="Continue with Google"') &&
      loginViewSrc.includes('or continue with email'),
    'LoginView renders "Continue with Google" above "or continue with email" divider'
  );
  assert(
    loginViewSrc.indexOf('Continue with Google') < loginViewSrc.indexOf('login-email'),
    'LoginView places Google button above email/password inputs'
  );
  assert(
    loginViewSrc.includes('Forgot password?') &&
      loginViewSrc.includes('Passwordless Magic Link') &&
      loginViewSrc.includes('Create an Account'),
    'LoginView preserves password login, forgot password, Magic Link, and sign-up navigation'
  );
  assert(
    loginViewSrc.includes('const isBusy = loading || googleLoading;') &&
      loginViewSrc.includes('disabled={isBusy}') &&
      loginViewSrc.includes('isSubmittingRef.current || isBusy'),
    'LoginView disables both submit buttons during auth requests and guards duplicate clicks'
  );

  // SignUpView checks
  assert(
    signUpViewSrc.includes('label="Start with Google"') &&
      signUpViewSrc.includes('or sign up with email'),
    'SignUpView renders "Start with Google" above "or sign up with email" divider'
  );
  assert(
    signUpViewSrc.indexOf('Start with Google') < signUpViewSrc.indexOf('signup-name'),
    'SignUpView places Google button above manual registration inputs'
  );
  assert(
    signUpViewSrc.includes('signup-name') &&
      signUpViewSrc.includes('signup-email') &&
      signUpViewSrc.includes('signup-password') &&
      signUpViewSrc.includes('signup-confirm'),
    'SignUpView preserves existing registration fields & validation'
  );
  assert(
    signUpViewSrc.includes('const isBusy = loading || googleLoading;') &&
      signUpViewSrc.includes('disabled={isBusy}') &&
      signUpViewSrc.indexOf('validateSignUpInputs(') > signUpViewSrc.indexOf('handleGoogleSignUp'),
    'SignUpView disables both submit buttons when busy and never requires manual fields for Google signup'
  );

  // ==========================================
  // TEST 4: OAuth Callback Routing, Exchange, Cancellation & Error Sanitization
  // ==========================================
  console.log('4. Testing OAuth callback routing, PKCE exchange, URL scrubbing & error messages...');

  const callbackSrc = fs.readFileSync(path.join(rootDir, 'src/components/auth/AuthCallbackView.tsx'), 'utf8');

  assert(
    resolveAuthRouteFromLocation({
      pathname: '/auth/callback',
      search: '?code=google_pkce_code_123&state=xyz',
      hash: ''
    }) === 'callback',
    'Google OAuth callback with ?code=... routes to AuthCallbackView'
  );
  assert(
    resolveAuthRouteFromLocation({
      pathname: '/auth/callback',
      search: '?error=access_denied&error_description=User+denied+access',
      hash: ''
    }) === 'callback',
    'Cancelled Google OAuth callback routes to AuthCallbackView error state'
  );
  assert(
    callbackSrc.includes('exchangeCodeOnce') &&
      callbackSrc.includes('supabase.auth.exchangeCodeForSession(code)') &&
      callbackSrc.includes('onNavigateLogin'),
    'AuthCallbackView exchanges PKCE code once and offers Return to Login on errors'
  );

  // Test error sanitization mappings
  assert(
    sanitizeAuthErrorMessage({ message: 'access_denied: User denied access' }).includes('cancelled'),
    'Maps OAuth cancellation cleanly'
  );
  assert(
    sanitizeAuthErrorMessage({ message: 'Unsupported provider: provider is not enabled' }).includes('not currently enabled'),
    'Maps disabled provider cleanly'
  );
  assert(
    sanitizeAuthErrorMessage({ message: 'invalid_oauth_state' }).includes('expired or could not be verified'),
    'Maps invalid OAuth state cleanly'
  );
  assert(
    sanitizeAuthErrorMessage({ message: 'flow_state_expired' }).includes('expired or could not be verified'),
    'Maps expired PKCE flow state cleanly'
  );
  assert(
    sanitizeAuthErrorMessage({ message: 'identity_already_exists' }).includes('Unable to complete Google sign-in'),
    'Maps duplicate identity conflict safely without raw internal errors'
  );

  // Test clearAuthUrlParams removes OAuth code & state
  const prevWin = (globalThis as { window?: unknown }).window;
  let cleanedUrl = '';
  (globalThis as { window: unknown }).window = {
    location: { href: 'https://xos-chi.vercel.app/auth/callback?code=pkce_google&state=s123' },
    history: {
      replaceState: (_s: unknown, _t: string, url: string) => {
        cleanedUrl = url;
      }
    }
  };
  clearAuthUrlParams();
  if (prevWin === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window: unknown }).window = prevWin;
  assert(cleanedUrl === '/', `clearAuthUrlParams cleans Google OAuth code & state (got: ${cleanedUrl})`);

  // ==========================================
  // TEST 5: Profile Preservation & Existing Auth Flows
  // ==========================================
  console.log('5. Testing Google profile fallback & existing password/Magic Link validation...');

  assert(
    authContextSrc.includes('currentSettings.profile.name || fallbackName') &&
      authContextSrc.includes('isSafeExternalUrl(meta.avatar_url)') &&
      authContextSrc.includes('isSafeExternalUrl(meta.picture)'),
    'AuthContext uses Google metadata only as fallback without overwriting user-customized names and validates avatar URLs'
  );
  assert(
    isSafeExternalUrl('https://lh3.googleusercontent.com/a/example') !== undefined &&
      isSafeExternalUrl('javascript:alert(1)') === undefined,
    'Avatar URL validator accepts HTTPS Google CDN URLs and rejects unsafe schemes'
  );

  // Preserve existing email/password + magic-link checks
  assert(validateLoginInputs('user@example.com', 'pass1234') === null, 'Existing email/password validation preserved');
  assert(
    validateSignUpInputs('Jordan Miller', 'user@example.com', 'Password123', 'Password123') === null,
    'Existing email signup validation preserved'
  );
  assert(authContextSrc.includes('shouldCreateUser: false'), 'Magic Link existing-user restriction preserved');

  // Verify repository keeps existing user data intact & sets active user on hydration
  repository.clearUserData();
  repository.setActiveUserId('google-user-123');
  assert(repository.getActiveUserId() === 'google-user-123', 'Repository tracks OAuth authenticated user ID');
  repository.clearUserData();

  // ==========================================
  // TEST 6: Zero OAuth Client Secrets in Source & Client Bundle
  // ==========================================
  console.log('6. Scanning src/ and dist/ for Google OAuth secrets...');

  const scanTargets: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'tests' || entry.name === 'node_modules') continue;
        walk(full);
      } else if (/\.(ts|tsx|js|mjs|html|json)$/.test(entry.name)) {
        scanTargets.push(full);
      }
    }
  };
  walk(path.join(rootDir, 'src'));
  const distDir = path.join(rootDir, 'dist');
  if (fs.existsSync(distDir)) {
    walk(distDir);
  }

  for (const filePath of scanTargets) {
    const content = fs.readFileSync(filePath, 'utf8');
    const rel = path.relative(rootDir, filePath);
    assert(!/GOCSPX-[A-Za-z0-9_-]+/.test(content), `No Google OAuth client secret literal in ${rel}`);
    assert(!/GOOGLE_CLIENT_SECRET|VITE_GOOGLE_CLIENT_SECRET/i.test(content), `No Google client secret env var in ${rel}`);
    if (!rel.includes('vendor-supabase')) {
      assert(!/service_role|SUPABASE_SERVICE_ROLE/i.test(content), `No Supabase service_role key in ${rel}`);
    }
  }

  console.log('ALL XOS PRODUCTION GOOGLE OAUTH TESTS PASSED!');
}

runGoogleOAuthTests();
