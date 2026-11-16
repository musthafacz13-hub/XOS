/**
 * XOS Frontend Security Regression Suite
 * Verifies error sanitization, URL protocol filtering, PKCE config, CSP/Vercel headers,
 * callback failover safety, and absence of unsafe DOM/execution sinks.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  isSafeExternalUrl,
  sanitizeAuthErrorMessage,
  sanitizeDatabaseErrorMessage
} from '../utils/authValidation';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Security assertion failed: ${message}`);
  }
}

function collectSourceFiles(dir: string, exts: string[]): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'tests' || entry.name === 'node_modules' || entry.name === 'dist') continue;
      results.push(...collectSourceFiles(full, exts));
    } else if (exts.some(ext => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

function runSecurityTests() {
  console.log('--- Running XOS Frontend Security Regression Suite ---');

  const rootDir = path.resolve(import.meta.dirname, '..', '..');

  // ==========================================
  // TEST 1: Error Sanitization (DB / RPC / Auth)
  // ==========================================
  console.log('Test 1: Database & auth error sanitization...');

  const rlsLeak = new Error('new row violates row-level security policy for table "goals"');
  const sanitizedRls = sanitizeDatabaseErrorMessage(rlsLeak, 'Fallback');
  assert(
    sanitizedRls === 'You do not have permission to perform this action.',
    `Sanitizes RLS policy table leak (got: ${sanitizedRls})`
  );

  const relationLeak = { message: 'ERROR: 42P01: relation "public.salary_payouts" does not exist' };
  assert(
    sanitizeDatabaseErrorMessage(relationLeak, 'Could not load records.') === 'Could not load records.',
    'Scrubs relation/table name leak'
  );

  const pgrstLeak = { message: 'PGRST202: Could not find the function public.xos_secret(p_id) in the schema cache' };
  assert(
    sanitizeDatabaseErrorMessage(pgrstLeak, 'Operation failed.') === 'Operation failed.',
    'Scrubs PGRST / public function signature leak'
  );

  const urlStackLeak = new Error('Request to https://internal.example.com/rest/v1/goals failed\n    at fetchJson (app.js:12:4)');
  assert(
    sanitizeDatabaseErrorMessage(urlStackLeak, 'Network error.') === 'Network error.',
    'Scrubs internal URLs and stack traces'
  );

  const authLeak = { message: 'SQLSTATE 42501 permission denied for schema auth' };
  assert(
    sanitizeAuthErrorMessage(authLeak) === 'An unexpected authentication error occurred. Please try again.',
    'Auth fallback scrubs SQLSTATE/schema leaks'
  );

  // Domain messages required by persistence & user UX MUST remain intact
  assert(
    sanitizeDatabaseErrorMessage({ message: 'Goal not found or already archived' }, 'Fallback') ===
      'Goal not found or already archived',
    'Preserves Goal archive domain error'
  );
  assert(
    sanitizeDatabaseErrorMessage({ message: 'RPC check violation' }, 'Fallback') === 'RPC check violation',
    'Preserves RPC check violation message'
  );
  assert(
    sanitizeDatabaseErrorMessage(
      { message: 'New amount (10) cannot be less than total repayments already recorded (50).' },
      'Fallback'
    ).includes('cannot be less than total repayments'),
    'Preserves debt validation domain error'
  );
  assert(
    sanitizeDatabaseErrorMessage(
      { message: 'Database rejected attendance date 2026-11-16 because the Supabase trigger/constraint enforces UTC CURRENT_DATE while the app uses IST (2026-11-16).' },
      'Fallback'
    ).includes('Database rejected attendance date'),
    'Preserves IST attendance rejection context'
  );

  // ==========================================
  // TEST 2: External URL Validation
  // ==========================================
  console.log('Test 2: External URL protocol filtering...');

  assert(isSafeExternalUrl('javascript:alert(1)') === undefined, 'Rejects javascript: URL');
  assert(isSafeExternalUrl('data:text/html,<script>alert(1)</script>') === undefined, 'Rejects data: URL');
  assert(isSafeExternalUrl('vbscript:msgbox(1)') === undefined, 'Rejects vbscript: URL');
  assert(isSafeExternalUrl('file:///etc/passwd') === undefined, 'Rejects file: URL');
  assert(isSafeExternalUrl('not a url') === undefined, 'Rejects malformed URL');
  assert(isSafeExternalUrl(null) === undefined, 'Rejects non-string');
  assert(
    isSafeExternalUrl('https://cdn.example.com/avatar.png') === 'https://cdn.example.com/avatar.png',
    'Accepts valid https URL'
  );

  // ==========================================
  // TEST 3: Supabase Client PKCE & Env Validation
  // ==========================================
  console.log('Test 3: Supabase client PKCE & URL validation...');

  const supabaseSrc = fs.readFileSync(path.join(rootDir, 'src/services/supabase.ts'), 'utf8');
  assert(supabaseSrc.includes("flowType: 'pkce'"), 'Supabase client enforces PKCE auth flow');
  assert(supabaseSrc.includes('isValidSupabaseUrl'), 'Supabase client validates URL format and HTTPS protocol');
  assert(
    !supabaseSrc.includes('service_role') && !supabaseSrc.includes('SUPABASE_SERVICE_ROLE'),
    'Supabase client never references service-role key'
  );

  // ==========================================
  // TEST 4: AuthCallback Fail-Closed Unconfigured Guard
  // ==========================================
  console.log('Test 4: AuthCallback fail-closed routing...');

  const callbackSrc = fs.readFileSync(path.join(rootDir, 'src/components/auth/AuthCallbackView.tsx'), 'utf8');
  const unconfiguredIdx = callbackSrc.indexOf('if (!isSupabaseConfigured)');
  assert(unconfiguredIdx !== -1, 'AuthCallback checks !isSupabaseConfigured');
  const unconfiguredSlice = callbackSrc.slice(unconfiguredIdx, unconfiguredIdx + 180);
  assert(
    unconfiguredSlice.includes('onNavigateLogin()') &&
      !unconfiguredSlice.includes('onSuccess()') &&
      !unconfiguredSlice.includes('onPasswordRecovery()'),
    'AuthCallback routes unconfigured sessions to login instead of authenticating'
  );

  // ==========================================
  // TEST 5: index.html, vercel.json, vite.config.ts CSP & Build Hardening
  // ==========================================
  console.log('Test 5: CSP headers, HTML handlers, and bundle exclusion...');

  const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  assert(!/\sonload\s*=|\sonerror\s*=|\sonclick\s*=/i.test(indexHtml), 'index.html contains no inline JS event handlers');
  const scriptTags = indexHtml.match(/<script\b[^>]*>/gi) || [];
  for (const tag of scriptTags) {
    const isJsonLd = /type\s*=\s*["']application\/ld\+json["']/i.test(tag);
    const hasSrc = /\ssrc\s*=/i.test(tag);
    assert(isJsonLd || hasSrc, `index.html contains only external module or JSON-LD script tags (found: ${tag})`);
  }

  const vercelRaw = fs.readFileSync(path.join(rootDir, 'vercel.json'), 'utf8');
  const vercelJson = JSON.parse(vercelRaw);
  assert(Array.isArray(vercelJson.headers) && vercelJson.headers.length >= 2, 'vercel.json defines security headers');
  const globalHeaders = vercelJson.headers.find((h: any) => h.source === '/(.*)')?.headers || [];
  const headerMap = new Map<string, string>(globalHeaders.map((h: any) => [h.key, h.value]));
  const csp = headerMap.get('Content-Security-Policy') || '';
  assert(csp.includes("script-src 'self'"), 'CSP restricts script-src to self');
  assert(!csp.includes("'unsafe-eval'"), 'CSP forbids unsafe-eval');
  assert(!/script-src[^;]*'unsafe-inline'/.test(csp), 'CSP script-src forbids unsafe-inline');
  assert(csp.includes("frame-ancestors 'none'"), 'CSP blocks framing via frame-ancestors none');
  assert(headerMap.get('X-Frame-Options') === 'DENY', 'X-Frame-Options set to DENY');
  assert(headerMap.get('X-Content-Type-Options') === 'nosniff', 'X-Content-Type-Options set to nosniff');
  assert((headerMap.get('Strict-Transport-Security') || '').includes('max-age='), 'HSTS configured');

  const authHeaders = vercelJson.headers.find((h: any) => h.source === '/auth/(.*)')?.headers || [];
  const authHeaderMap = new Map<string, string>(authHeaders.map((h: any) => [h.key, h.value]));
  assert((authHeaderMap.get('Cache-Control') || '').includes('no-store'), '/auth/* disables caching');

  const viteSrc = fs.readFileSync(path.join(rootDir, 'vite.config.ts'), 'utf8');
  assert(viteSrc.includes("assets/aistudio/**"), 'VitePWA excludes internal aistudio assets from precache');
  assert(viteSrc.includes('strip-internal-aistudio-assets'), 'Vite build strips dist/assets/aistudio');

  // ==========================================
  // TEST 6: Static Scan of src/ for Unsafe Sinks & Unguarded Logs
  // ==========================================
  console.log('Test 6: Static scan of src/ for unsafe sinks, secrets, and console guards...');

  const srcFiles = collectSourceFiles(path.join(rootDir, 'src'), ['.ts', '.tsx']);
  assert(srcFiles.length > 10, 'Collected application source files');

  for (const filePath of srcFiles) {
    const rel = path.relative(rootDir, filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    assert(!content.includes('dangerouslySetInnerHTML'), `No dangerouslySetInnerHTML in ${rel}`);
    assert(!/\binnerHTML\s*=/.test(content), `No innerHTML assignment in ${rel}`);
    assert(!/\beval\s*\(/.test(content), `No eval() in ${rel}`);
    assert(!/new\s+Function\s*\(/.test(content), `No new Function() in ${rel}`);
    assert(!/document\.write\s*\(/.test(content), `No document.write() in ${rel}`);
    assert(
      !/service_role|SUPABASE_SERVICE_ROLE/i.test(content),
      `No service_role reference in ${rel}`
    );

    if (content.includes('target="_blank"') || content.includes("target='_blank'")) {
      assert(
        content.includes('noopener') && content.includes('noreferrer'),
        `target="_blank" has rel="noopener noreferrer" in ${rel}`
      );
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/\bconsole\.(log|warn|error)\s*\(/.test(lines[i])) {
        const windowContext = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
        assert(
          windowContext.includes('import.meta.env?.DEV') || windowContext.includes('import.meta.env.DEV'),
          `Console log/warn/error is dev-guarded at ${rel}:${i + 1}`
        );
      }
    }
  }

  console.log('All XOS frontend security regression checks passed!');
}

runSecurityTests();
