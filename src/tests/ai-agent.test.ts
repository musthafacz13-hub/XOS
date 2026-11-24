import test from 'node:test';
import assert from 'node:assert';
import { verifySupabaseSessionToken } from '../../api/_lib/aiHandler.js';
import { validateEmailAddress, validateSignUpInputs, sanitizeAuthErrorMessage, normalizeAuthEmail } from '../utils/authValidation.js';

test('XOS AI Agent Fail-Closed Authentication', async (t) => {
  const originalEnv = process.env;

  t.beforeEach(() => {
    process.env = { ...originalEnv };
  });

  t.afterEach(() => {
    process.env = originalEnv;
  });

  await t.test('1. Returns status 503 when Supabase configuration is missing in production', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.VITE_SUPABASE_ANON_KEY;

    const result = await verifySupabaseSessionToken('Bearer valid-token', async () => new Response('{}', { status: 200 }));
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.status, 503);
    assert.ok(result.reason?.includes('Supabase configuration is missing'));
  });

  await t.test('2. Returns status 401 when Bearer token is missing', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';

    const result = await verifySupabaseSessionToken(undefined, async () => new Response('{}', { status: 200 }));
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.status, 401);
    assert.ok(result.reason?.includes('session has expired'));
  });

  await t.test('3. Returns status 401 when JWT token is invalid/rejected by Supabase', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';

    const mockFetch = async () => new Response(JSON.stringify({ error: 'invalid jwt' }), { status: 401 });
    const result = await verifySupabaseSessionToken('Bearer invalid-token', mockFetch);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.status, 401);
  });

  await t.test('4. Returns valid true and userId when JWT token is valid', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';

    const mockFetch = async () => new Response(JSON.stringify({ id: 'user-uuid-123' }), { status: 200 });
    const result = await verifySupabaseSessionToken('Bearer valid-jwt-token', mockFetch);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.userId, 'user-uuid-123');
  });

  await t.test('5. Allows local development bypass when NODE_ENV is not production and no AI keys are configured', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.VITE_GEMINI_API_KEY;

    const result = await verifySupabaseSessionToken(undefined, async () => new Response('{}', { status: 200 }));
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.userId, 'local-workspace');
  });
});

test('XOS Authentication Validation & Sanitization Helpers', async (t) => {
  await t.test('Normalize email', () => {
    assert.strictEqual(normalizeAuthEmail('  TEST@Example.com '), 'test@example.com');
  });

  await t.test('Validate email address', () => {
    assert.strictEqual(validateEmailAddress('invalid-email'), 'Please enter a valid email address.');
    assert.strictEqual(validateEmailAddress('user@example.com'), null);
  });

  await t.test('Validate signup inputs', () => {
    assert.strictEqual(validateSignUpInputs('', 'user@example.com', 'password123', 'password123'), 'Please enter your full name.');
    assert.strictEqual(validateSignUpInputs('John', 'user@example.com', 'short', 'short'), 'Password must be at least 8 characters long.');
    assert.strictEqual(validateSignUpInputs('John', 'user@example.com', 'password123', 'different'), 'Passwords do not match. Please re-enter carefully.');
    assert.strictEqual(validateSignUpInputs('John', 'user@example.com', 'password123', 'password123'), null);
  });

  await t.test('Sanitize auth error messages', () => {
    assert.strictEqual(sanitizeAuthErrorMessage('Invalid login credentials'), 'Incorrect email or password. Please verify and try again.');
    assert.strictEqual(sanitizeAuthErrorMessage('Email not confirmed'), 'Please verify your email address before logging in. Check your inbox for the confirmation link.');
    assert.strictEqual(sanitizeAuthErrorMessage('Token has expired'), 'This verification or reset link has expired. Please request a new one.');
  });
});
