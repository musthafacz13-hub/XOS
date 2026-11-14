/**
 * XOS Authentication, Validation, Error Mapping, Viewport & Global Zoom Regression Suite
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeAuthEmail,
  validateEmailAddress,
  validateLoginInputs,
  validateSignUpInputs,
  sanitizeAuthErrorMessage,
  clearAuthUrlParams
} from '../utils/authValidation';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runTests() {
  console.log('--- Running XOS Auth, Welcome & Global Zoom Regression Suite ---');

  // ==========================================
  // TEST 1: Email & Auth Form Validation
  // ==========================================
  console.log('Test 1: Email normalization & login/signup input validation...');

  assert(
    normalizeAuthEmail('  Jordan.Miller+xos@Example.COM  ') === 'jordan.miller+xos@example.com',
    'normalizeAuthEmail trims whitespace and lowercases'
  );

  assert(validateEmailAddress('') !== null, 'Empty email fails validation');
  assert(validateEmailAddress('user@localhost') !== null, 'Email without valid TLD fails validation');
  assert(validateEmailAddress('invalid.email.com') !== null, 'Email without @ fails validation');
  assert(validateEmailAddress('user name@example.com') !== null, 'Email with space fails validation');
  assert(validateEmailAddress('user@example.com') === null, 'Standard email passes validation');
  assert(validateEmailAddress('user+tag@sub.domain.co') === null, 'Subdomain + tag email passes validation');

  assert(validateLoginInputs('', 'secret123') !== null, 'Login rejects blank email');
  assert(validateLoginInputs('user@example.com', '') !== null, 'Login rejects blank password');
  assert(validateLoginInputs('user@example.com', 'p') === null, 'Login accepts non-empty password with valid email');

  assert(validateSignUpInputs('   ', 'user@example.com', 'Password123', 'Password123') !== null, 'Signup requires full name');
  assert(validateSignUpInputs('Jordan', 'bad-email', 'Password123', 'Password123') !== null, 'Signup rejects invalid email');
  assert(validateSignUpInputs('Jordan', 'user@example.com', 'short7', 'short7') !== null, 'Signup enforces 8+ char password');
  assert(validateSignUpInputs('Jordan', 'user@example.com', 'Password123', 'Different123') !== null, 'Signup detects password mismatch');
  assert(validateSignUpInputs('Jordan Miller', 'user@example.com', 'Password123', 'Password123') === null, 'Signup accepts valid registration fields');

  // ==========================================
  // TEST 2: Supabase Error Sanitization
  // ==========================================
  console.log('Test 2: Error message sanitization...');

  assert(
    sanitizeAuthErrorMessage({ message: 'Invalid login credentials' }).includes('Incorrect email or password'),
    'Maps invalid login credentials cleanly'
  );
  assert(
    sanitizeAuthErrorMessage({ message: 'Email not confirmed' }).includes('verify your email'),
    'Maps unconfirmed email cleanly'
  );
  assert(
    sanitizeAuthErrorMessage({ message: 'User already registered' }).includes('already exists'),
    'Maps duplicate user cleanly'
  );
  assert(
    sanitizeAuthErrorMessage({ message: 'New password should be different from the old password' }).includes('different'),
    'Maps same_password error cleanly'
  );
  assert(
    sanitizeAuthErrorMessage({ message: 'Token has expired or is invalid' }).includes('expired'),
    'Maps expired token cleanly'
  );
  assert(
    sanitizeAuthErrorMessage({ message: 'over_email_send_rate_limit' }).includes('Too many attempts'),
    'Maps rate limit cleanly'
  );
  const timeoutErr = new Error('Signal timed out');
  timeoutErr.name = 'TimeoutError';
  assert(sanitizeAuthErrorMessage(timeoutErr).includes('timed out'), 'Maps TimeoutError cleanly');

  const abortErr = new Error('Fetch is aborted');
  abortErr.name = 'AbortError';
  assert(sanitizeAuthErrorMessage(abortErr).includes('interrupted'), 'Maps AbortError cleanly');

  assert(
    sanitizeAuthErrorMessage(new Error('Failed to fetch')).includes('Network connection unavailable'),
    'Maps network fetch failure cleanly'
  );

  // ==========================================
  // TEST 3: Auth Callback URL & Fragment Cleanup
  // ==========================================
  console.log('Test 3: Auth callback URL & hash cleanup...');

  const originalWindow = (globalThis as { window?: unknown }).window;
  let lastReplacedUrl = '';

  (globalThis as { window: unknown }).window = {
    location: { href: 'https://xos.app/auth/callback?code=pkce_123&type=recovery&tab=work#access_token=abc&type=recovery' },
    history: {
      replaceState: (_state: unknown, _title: string, url: string) => {
        lastReplacedUrl = url;
      }
    }
  };

  clearAuthUrlParams();
  assert(
    lastReplacedUrl === '/?tab=work',
    `clearAuthUrlParams cleans /auth/callback, PKCE params, and token hash while preserving non-auth query params (got: ${lastReplacedUrl})`
  );

  lastReplacedUrl = '';
  ((globalThis as { window: { location: { href: string } } }).window).location.href = 'https://xos.app/#login';
  clearAuthUrlParams();
  assert(lastReplacedUrl === '/', `clearAuthUrlParams strips #login hash (got: ${lastReplacedUrl})`);

  lastReplacedUrl = 'unchanged';
  ((globalThis as { window: { location: { href: string } } }).window).location.href = 'https://xos.app/?view=reports';
  clearAuthUrlParams();
  assert(lastReplacedUrl === 'unchanged', 'clearAuthUrlParams is a no-op for clean workspace URLs');

  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window: unknown }).window = originalWindow;
  }

  // ==========================================
  // TEST 4: Viewport, iOS Zoom CSS Cascade & Layout Guards
  // ==========================================
  console.log('Test 4: Viewport accessibility zoom, CSS cascade & overflow safeguards...');

  const rootDir = process.cwd();
  const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const indexCss = fs.readFileSync(path.join(rootDir, 'src/index.css'), 'utf8');
  const authContextSrc = fs.readFileSync(path.join(rootDir, 'src/context/AuthContext.tsx'), 'utf8');
  const authLayoutSrc = fs.readFileSync(path.join(rootDir, 'src/components/auth/AuthLayout.tsx'), 'utf8');
  const mobileOnboardingSrc = fs.readFileSync(path.join(rootDir, 'src/components/welcome/MobileOnboarding.tsx'), 'utf8');
  const scrollRevealSrc = fs.readFileSync(path.join(rootDir, 'src/components/welcome/useWelcomeScrollReveal.ts'), 'utf8');
  const offlineBannerSrc = fs.readFileSync(path.join(rootDir, 'src/components/common/OfflineIndicator.tsx'), 'utf8');
  const loginViewSrc = fs.readFileSync(path.join(rootDir, 'src/components/auth/LoginView.tsx'), 'utf8');
  const signUpViewSrc = fs.readFileSync(path.join(rootDir, 'src/components/auth/SignUpView.tsx'), 'utf8');

  assert(indexHtml.includes('width=device-width, initial-scale=1.0, viewport-fit=cover'), 'Viewport meta enables responsive scaling + iOS safe-area cover');
  assert(!indexHtml.includes('user-scalable=no') && !indexHtml.includes('maximum-scale=1'), 'Viewport meta preserves accessibility pinch-zoom');

  const layerBaseStart = indexCss.indexOf('@layer base {');
  const baseFontRuleIdx = indexCss.indexOf('font-size: 16px;');
  const mediaTouchRuleIdx = indexCss.indexOf('@media (max-width: 767px), (hover: none) and (pointer: coarse)');
  assert(layerBaseStart !== -1 && mediaTouchRuleIdx > layerBaseStart, 'Touch/mobile 16px rule appears after @layer base');
  assert(baseFontRuleIdx > mediaTouchRuleIdx, '16px input rule lives outside @layer base so Tailwind utilities cannot re-trigger iOS auto-zoom');
  assert(indexCss.includes('overflow-x: clip'), 'Root html/body use overflow-x: clip without breaking sticky positioning');

  assert(!authLayoutSrc.includes('select-none'), 'AuthLayout does not disable text selection on forms');
  assert(!loginViewSrc.includes('autoFocus') && !signUpViewSrc.includes('autoFocus'), 'Auth forms avoid autoFocus viewport jump on mobile');
  assert(loginViewSrc.includes('isSubmittingRef') && signUpViewSrc.includes('isSubmittingRef'), 'Auth forms guard against rapid duplicate submissions synchronously');
  assert(loginViewSrc.includes('aria-pressed={showPassword}') && signUpViewSrc.includes('aria-pressed={showPassword}'), 'Password toggle buttons expose aria-pressed state');
  assert(authContextSrc.includes('identities.length === 0'), 'AuthContext detects Supabase v2 duplicate-email empty identities signup');
  assert(authContextSrc.includes('isDemoUserRef'), 'AuthContext keeps session init stable without tearing down on demo toggle');
  assert(!offlineBannerSrc.includes('whitespace-nowrap'), 'OfflineIndicator wraps cleanly on narrow mobile viewports');
  assert(scrollRevealSrc.includes('rect.width === 0 && rect.height === 0'), 'Welcome scroll reveal ignores hidden responsive branch elements');
  assert(!mobileOnboardingSrc.includes('touchAction: \'pan-y\'\n      onTouchStart'), 'MobileOnboarding does not force touchAction: pan-y across the entire root viewport');

  console.log('ALL AUTH, WELCOME & GLOBAL ZOOM REGRESSION TESTS PASSED!');
}

runTests();
