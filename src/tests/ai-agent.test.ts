/**
 * XOS — Jarvis Personal AI Agent Verification Suite
 * Covers: More Modules navigation, bilingual selective retrieval (Malayalam/English/Manglish),
 * follow-up session inheritance, exact calculation grounding, read-only & no-storage invariants,
 * server-side JWT verification, and voice/PWA/CSP configuration.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_USER_SETTINGS } from '../data/initialData';
import {
  buildSelectiveXosContext,
  detectQueryIntent,
  XOSReadOnlySnapshot
} from '../services/ai/contextBuilder';
import {
  agentService,
  AiServiceError,
  FRONTEND_ASSISTANT_TIMEOUT_MS,
  FRONTEND_SPEAK_TIMEOUT_MS
} from '../services/ai/agentService';
import {
  handleAssistantRequest,
  handleSpeakRequest,
  handleTranscribeRequest,
  verifySupabaseSessionToken
} from '../../api/_lib/aiHandler';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`AI Agent assertion failed: ${message}`);
  }
}

function createSampleSnapshot(): XOSReadOnlySnapshot {
  return {
    settings: {
      ...DEFAULT_USER_SETTINGS,
      profile: { name: 'Ameen', email: 'ameen@example.com' },
      currency: 'INR',
      salaryConfig: {
        dailyBaseSalary: 1200,
        addonSalary: 200,
        addonEnabled: true,
        standardWorkingHours: 8,
        extraHourRate: 250,
        overtimeEnabled: true,
        isConfigured: true,
        currency: 'INR'
      }
    },
    expenses: [
      {
        id: 'e1',
        title: 'Groceries',
        amount: 2400,
        category: 'Food & Dining',
        date: '2026-11-10',
        paymentMethod: 'Digital Wallet',
        createdAt: '2026-11-10T10:00:00Z'
      },
      {
        id: 'e2',
        title: 'Debt Repayment — Rahul',
        amount: 4000,
        category: 'Debt Repayment',
        date: '2026-11-12',
        paymentMethod: 'Bank Transfer',
        debtRepaymentId: 'rep-1',
        createdAt: '2026-11-12T10:00:00Z'
      },
      {
        id: 'e3',
        title: 'Electricity Bill',
        amount: 1500,
        category: 'Utilities',
        date: '2026-10-15',
        paymentMethod: 'Bank Transfer',
        createdAt: '2026-10-15T10:00:00Z'
      }
    ],
    incomes: [
      {
        id: 'i1',
        title: 'November Salary Advance',
        amount: 15000,
        source: 'Salary',
        date: '2026-11-05',
        createdAt: '2026-11-05T09:00:00Z'
      }
    ],
    debts: [
      {
        id: 'd1',
        person_name: 'Rahul',
        original_amount: 10000,
        remaining_amount: 6000,
        lent_date: '2026-11-01',
        status: 'partially_paid',
        direction: 'pay',
        created_at: '2026-11-01T08:00:00Z'
      },
      {
        id: 'd2',
        person_name: 'Nikhil',
        original_amount: 5000,
        remaining_amount: 5000,
        lent_date: '2026-11-02',
        status: 'outstanding',
        direction: 'receive',
        created_at: '2026-11-02T08:00:00Z'
      }
    ],
    debtRepayments: [
      {
        id: 'rep-1',
        debt_id: 'd1',
        amount: 4000,
        repayment_date: '2026-11-12',
        payment_method: 'Bank Transfer',
        created_at: '2026-11-12T10:00:00Z'
      }
    ],
    attendance: [
      {
        id: 'a1',
        date: '2026-11-10',
        status: 'Present',
        calculatedHours: 10,
        extraHours: 2,
        dailyBaseSalary: 1200,
        addonSalary: 200,
        addonEnabled: true,
        extraHourRate: 250,
        overtimeEnabled: true,
        dailyEarnedSalary: 1900
      },
      {
        id: 'a2',
        date: '2026-11-11',
        status: 'Leave'
      }
    ],
    salaryPayouts: [
      {
        id: 'p1',
        periodStart: '2026-11-01',
        periodEnd: '2026-11-30',
        amountPaid: 1000,
        paidAt: '2026-11-15T12:00:00Z'
      }
    ],
    savingsGoals: [
      {
        id: 'sg-active',
        name: 'Emergency Fund',
        targetAmount: 50000,
        currentAmount: 12000,
        createdAt: '2026-11-01T00:00:00Z'
      },
      {
        id: 'sg-archived',
        name: 'Old Archived Goal Reserve',
        targetAmount: 10000,
        currentAmount: 9000,
        isArchived: true,
        createdAt: '2026-10-01T00:00:00Z'
      }
    ],
    savingsTransactions: [
      {
        id: 'st1',
        savingsGoalId: 'sg-active',
        amount: 12000,
        type: 'deposit',
        date: '2026-11-06',
        createdAt: '2026-11-06T00:00:00Z'
      }
    ],
    goals: [
      {
        id: 'g1',
        title: 'Emergency Fund',
        description: '',
        category: 'Financial',
        targetAmount: 50000,
        progressPercentage: 24,
        priority: 'High',
        status: 'In Progress',
        createdAt: '2026-11-01T00:00:00Z',
        savingsGoalId: 'sg-active'
      },
      {
        id: 'g2',
        title: 'Old Archived Goal Reserve',
        description: '',
        category: 'Personal',
        targetAmount: 10000,
        progressPercentage: 90,
        priority: 'Low',
        status: 'Archived',
        createdAt: '2026-10-01T00:00:00Z',
        savingsGoalId: 'sg-archived'
      }
    ]
  };
}

async function runAiAgentTests() {
  console.log('--- Running XOS Jarvis Personal AI Agent Test Suite ---');
  const rootDir = path.resolve(import.meta.dirname, '..', '..');

  // ==========================================
  // TEST 1: Navigation & UI Registration
  // ==========================================
  console.log('Test 1: Verifying More Modules -> AI Agent navigation & App routing...');
  const sidebarSrc = fs.readFileSync(path.join(rootDir, 'src/components/layout/Sidebar.tsx'), 'utf8');
  const mobileNavSrc = fs.readFileSync(path.join(rootDir, 'src/components/layout/MobileBottomNav.tsx'), 'utf8');
  const appSrc = fs.readFileSync(path.join(rootDir, 'src/App.tsx'), 'utf8');

  assert(sidebarSrc.includes("'ai-agent'") && sidebarSrc.includes("label: 'AI Agent'"), 'Sidebar registers AI Agent tab');
  assert(
    mobileNavSrc.includes('More Modules') &&
      mobileNavSrc.includes("handleSelectTab('ai-agent')") &&
      mobileNavSrc.includes('AI Agent'),
    'MobileBottomNav includes AI Agent inside More Modules sheet'
  );
  assert(
    appSrc.includes('AiAgentView') && appSrc.includes("activeTab === 'ai-agent'"),
    'App.tsx lazy-loads and renders AiAgentView'
  );

  // ==========================================
  // TEST 2: Selective Bilingual Intent & Follow-up Preservation
  // ==========================================
  console.log('Test 2: Verifying Malayalam, English, and Manglish selective retrieval...');
  const fixedNow = new Date('2026-11-22T10:00:00+05:30');
  const snapshot = createSampleSnapshot();

  const mlExpenseCtx = buildSelectiveXosContext({
    query: 'ഈ മാസം എന്റെ ചെലവുകൾ എങ്ങനെയുണ്ട്?',
    data: snapshot,
    now: fixedNow
  });
  assert(mlExpenseCtx.selectedModules.includes('expenses'), 'Malayalam expense query selects expenses module');
  assert(!('debt' in mlExpenseCtx.groundedContext), 'Expense-only query omits debt payload');
  assert(!('salary' in mlExpenseCtx.groundedContext), 'Expense-only query omits salary payload');
  assert(mlExpenseCtx.intent.detectedLanguage === 'ml', 'Detects Malayalam script language');

  const expData = mlExpenseCtx.groundedContext.expenses as {
    total: number;
    debtRepaymentIncludedTotal: number;
    monthComparison: { currentMonthTotal: number; lastMonthTotal: number };
  };
  assert(expData.total === 6400, `Includes Groceries (2400) + Debt Repayment (4000) = 6400 (got ${expData.total})`);
  assert(expData.debtRepaymentIncludedTotal === 4000, 'Tracks included Debt Repayment expense subtotal accurately');
  assert(expData.monthComparison.lastMonthTotal === 1500, 'Computes prior month comparison accurately');

  const followUpCtx = buildSelectiveXosContext({
    query: 'കഴിഞ്ഞ മാസവുമായി താരതമ്യം ചെയ്യാമോ?',
    data: snapshot,
    recentTurns: [{ role: 'user', text: 'ഈ മാസം എന്റെ ചെലവുകൾ എങ്ങനെയുണ്ട്?', modules: ['expenses'] }],
    now: fixedNow
  });
  assert(
    followUpCtx.selectedModules.includes('expenses') && followUpCtx.intent.wantsComparison,
    'Follow-up Malayalam comparison preserves expenses module context'
  );

  const manglishDebtIntent = detectQueryIntent('Enikku aarkkokke kadam kodukkan undu?');
  assert(manglishDebtIntent.modules.includes('debt'), 'Manglish debt query selects debt module');
  assert(manglishDebtIntent.detectedLanguage === 'mixed', 'Detects Manglish as mixed language');

  const debtCtx = buildSelectiveXosContext({
    query: 'What is my debt status?',
    data: snapshot,
    now: fixedNow
  });
  const debtPayload = debtCtx.groundedContext.debt as { totalToPay: number; totalToReceive: number };
  assert(debtPayload.totalToPay === 6000, 'Computes Money to Pay remaining balance accurately');
  assert(debtPayload.totalToReceive === 5000, 'Computes Money Owed to Me remaining balance accurately');

  // ==========================================
  // TEST 3: Salary, Unconfigured Guard & Archived Goal Exclusion
  // ==========================================
  console.log('Test 3: Verifying salary calculation, unconfigured state, and archived exclusion...');
  const salaryCtx = buildSelectiveXosContext({
    query: 'What is my earned and remaining salary this month?',
    data: snapshot,
    now: fixedNow
  });
  const salaryPayload = salaryCtx.groundedContext.salary as {
    isConfigured: boolean;
    summary: { earnedSalary: number; salaryReceived: number; remainingSalary: number };
  };
  assert(salaryPayload.isConfigured === true, 'Reports configured salary accurately');
  assert(salaryPayload.summary.earnedSalary === 1900, 'Uses real earned salary calculation (1900)');
  assert(salaryPayload.summary.remainingSalary === 900, 'Subtracts payout (1000) to get remaining 900');

  const unconfiguredSnapshot: XOSReadOnlySnapshot = {
    ...snapshot,
    attendance: [],
    salaryPayouts: [],
    settings: {
      ...snapshot.settings,
      salaryConfig: {
        ...DEFAULT_USER_SETTINGS.salaryConfig,
        isConfigured: false
      }
    }
  };
  const unconfiguredSalaryCtx = buildSelectiveXosContext({
    query: 'My salary summary please',
    data: unconfiguredSnapshot,
    now: fixedNow
  });
  const unconfiguredSalary = unconfiguredSalaryCtx.groundedContext.salary as {
    isConfigured: boolean;
    configuredRates: unknown;
    summary: { earnedSalary: number };
  };
  assert(unconfiguredSalary.isConfigured === false && unconfiguredSalary.configuredRates === null, 'Detects unconfigured salary honestly');
  assert(unconfiguredSalary.summary.earnedSalary === 0, 'Zero earned salary when unconfigured with no attendance');

  const goalsCtx = buildSelectiveXosContext({
    query: 'How are my goals and savings?',
    data: snapshot,
    now: fixedNow
  });
  const goalsPayload = goalsCtx.groundedContext.goals as { totals: { totalCount: number; totalSavedAmount: number } };
  const savingsPayload = goalsCtx.groundedContext.savings as { totalActiveReserves: number };
  assert(goalsPayload.totals.totalCount === 1, 'Excludes Archived goal from active goals count');
  assert(goalsPayload.totals.totalSavedAmount === 12000, 'Uses linked active savings balance');
  assert(savingsPayload.totalActiveReserves === 12000, 'Excludes archived reserve from totalActiveReserves');

  // Mutation request detection
  const mutationIntent = detectQueryIntent('Add 500 expense for lunch today');
  assert(mutationIntent.readOnlyMutationRequested === true, 'Flags mutation request for read-only polite refusal');

  // ==========================================
  // TEST 4: Security, Zero Storage & Read-Only Invariants
  // ==========================================
  console.log('Test 4: Verifying zero browser storage, zero client API key exposure, and read-only compliance...');
  const aiClientFiles = [
    'src/services/ai/xosKnowledge.ts',
    'src/services/ai/contextBuilder.ts',
    'src/services/ai/agentService.ts',
    'src/hooks/useJarvisVoice.ts',
    'src/components/ai/VoiceOrb.tsx',
    'src/components/ai/AiAgentView.tsx'
  ];

  for (const relPath of aiClientFiles) {
    const content = fs.readFileSync(path.join(rootDir, relPath), 'utf8');
    assert(!content.includes('localStorage'), `No localStorage in ${relPath}`);
    assert(!content.includes('sessionStorage'), `No sessionStorage in ${relPath}`);
    assert(!content.includes('indexedDB'), `No indexedDB in ${relPath}`);
    assert(!content.includes('@google/genai'), `No client @google/genai import in ${relPath}`);
    assert(!content.includes('GEMINI_API_KEY'), `No GEMINI_API_KEY exposure in ${relPath}`);
    assert(
      !/repository\.(add|update|delete|upsert|persist|save|clear|reset|import|recordSalaryPayout)/.test(content),
      `No repository write/reset calls in ${relPath}`
    );
  }

  // ==========================================
  // TEST 5: Server-Side Auth, Validation & Deployment Config
  // ==========================================
  console.log('Test 5: Verifying server JWT verification, error handling, Vercel headers & PWA denylist...');
  const prevUrl = process.env.VITE_SUPABASE_URL;
  const prevAnon = process.env.VITE_SUPABASE_ANON_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;

  try {
    process.env.VITE_SUPABASE_URL = 'https://demo-project.supabase.co';
    process.env.VITE_SUPABASE_ANON_KEY = 'anon-public-test-key';

    const missingAuth = await verifySupabaseSessionToken(undefined);
    assert(missingAuth.valid === false, 'Rejects missing Authorization Bearer header when Supabase is configured');

    const rejectedAuth = await verifySupabaseSessionToken('Bearer invalid_token', async () => {
      return new Response(JSON.stringify({ message: 'Invalid JWT' }), { status: 401 });
    });
    assert(rejectedAuth.valid === false, 'Rejects invalid Supabase JWT');

    const validAuth = await verifySupabaseSessionToken('Bearer valid_token', async () => {
      return new Response(JSON.stringify({ id: 'user-123' }), { status: 200 });
    });
    assert(validAuth.valid === true && validAuth.userId === 'user-123', 'Accepts verified Supabase user session');

    const unauthResp = await handleAssistantRequest({ message: 'Hi' }, undefined);
    assert(unauthResp.status === 401, `Assistant endpoint rejects unauthenticated call with 401 (got ${unauthResp.status})`);

    // Unconfigured Supabase + missing GEMINI_API_KEY returns honest 503 unavailable
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.VITE_SUPABASE_ANON_KEY;
    delete process.env.GEMINI_API_KEY;
    const unavailResp = await handleAssistantRequest({ message: 'Hi' }, undefined);
    assert(unavailResp.status === 503, `Returns honest 503 when GEMINI_API_KEY is absent (got ${unavailResp.status})`);

    process.env.GEMINI_API_KEY = 'test-key-present-for-validation';
    const emptyMsgResp = await handleAssistantRequest({ message: '   ' }, undefined);
    assert(emptyMsgResp.status === 400, 'Rejects blank message with 400');
    assert(Boolean(emptyMsgResp.body.requestId), 'Includes diagnostic requestId in error responses');

    // ==========================================
    // TEST 6: Deterministic Backend Deadlines, Model Fallback & Error Classification
    // ==========================================
    console.log('Test 6: Verifying server deadlines, AbortSignal propagation, error categories, and model config...');

    // 6a. Successful AI response & strict Gemini 4 config verification
    let capturedParams: Record<string, unknown> | null = null;
    const okResp = await handleAssistantRequest(
      { message: 'How are my expenses?', groundedContext: { expenses: { total: 6400 } } },
      undefined,
      {
        createClient: () => ({
          models: {
            generateContent: async (params) => {
              capturedParams = params;
              return { text: 'Your expenses total ₹6,400 this month.' };
            }
          }
        })
      }
    );
    assert(okResp.status === 200 && okResp.body.reply === 'Your expenses total ₹6,400 this month.', 'Returns successful Gemini response');
    assert(Boolean(okResp.body.requestId), 'Successful response includes requestId');
    assert(capturedParams !== null && (capturedParams as Record<string, unknown>).model === 'gemini-4-hydrogen', 'Uses gemini-4-hydrogen primary model');
    const capturedConfig = (capturedParams as unknown as { config: Record<string, unknown> }).config;
    assert(!('temperature' in capturedConfig), 'Does not pass deprecated temperature to gemini-4-hydrogen');
    assert(!('maxOutputTokens' in capturedConfig), 'Does not pass maxOutputTokens to gemini-4-hydrogen');
    assert(capturedConfig.abortSignal instanceof AbortSignal, 'Passes real AbortSignal via config.abortSignal');

    // 6b. Server-side Gemini timeout aborts underlying signal & returns 504 timeout
    const timeoutState = { signalAborted: false };
    const timeoutResp = await handleAssistantRequest(
      { message: 'Slow query' },
      undefined,
      {
        assistantTimeoutMs: 40,
        createClient: () => ({
          models: {
            generateContent: (params) =>
              new Promise((_resolve, reject) => {
                const sig = (params as { config?: { abortSignal?: AbortSignal } }).config?.abortSignal;
                sig?.addEventListener('abort', () => {
                  timeoutState.signalAborted = true;
                  const err = new Error('The operation was aborted');
                  err.name = 'AbortError';
                  reject(err);
                });
              })
          }
        })
      }
    );
    assert(timeoutState.signalAborted, 'Server deadline actually aborts Gemini request via config.abortSignal');
    assert(timeoutResp.status === 504 && timeoutResp.body.category === 'timeout', 'Returns 504 with category=timeout');
    assert(timeoutResp.body.timeoutStage === 'gemini', 'Records timeoutStage=gemini');

    // 6c. Auth verification timeout returns 504 with timeoutStage=auth
    process.env.VITE_SUPABASE_URL = 'https://demo-project.supabase.co';
    process.env.VITE_SUPABASE_ANON_KEY = 'anon-public-test-key';
    const authTimeoutResp = await handleAssistantRequest(
      { message: 'Hi' },
      'Bearer valid-looking-token',
      {
        authTimeoutMs: 30,
        fetchImpl: (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const err = new Error('Aborted');
              err.name = 'AbortError';
              reject(err);
            });
          })
      }
    );
    assert(authTimeoutResp.status === 504 && authTimeoutResp.body.timeoutStage === 'auth', 'Returns 504 timeoutStage=auth when Supabase auth hangs');
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.VITE_SUPABASE_ANON_KEY;

    // 6d. Invalid API key (403) -> invalid_api_key
    const badKeyResp = await handleAssistantRequest(
      { message: 'Hi' },
      undefined,
      {
        createClient: () => ({
          models: {
            generateContent: async () => {
              const err = new Error('API_KEY_INVALID') as Error & { status?: number };
              err.status = 403;
              throw err;
            }
          }
        })
      }
    );
    assert(badKeyResp.status === 502 && badKeyResp.body.category === 'invalid_api_key', 'Maps 403/invalid key to invalid_api_key');

    // 6e. Rate limit (429) vs Quota exhaustion (429)
    const rateResp = await handleAssistantRequest(
      { message: 'Hi' },
      undefined,
      {
        createClient: () => ({
          models: {
            generateContent: async () => {
              const err = new Error('Too many requests') as Error & { status?: number };
              err.status = 429;
              throw err;
            }
          }
        })
      }
    );
    assert(rateResp.status === 429 && rateResp.body.category === 'rate_limited', 'Maps transient 429 to rate_limited');

    const quotaResp = await handleAssistantRequest(
      { message: 'Hi' },
      undefined,
      {
        createClient: () => ({
          models: {
            generateContent: async () => {
              const err = new Error('You exceeded your current quota, please check billing') as Error & { status?: number };
              err.status = 429;
              throw err;
            }
          }
        })
      }
    );
    assert(quotaResp.status === 429 && quotaResp.body.category === 'quota_exceeded', 'Distinguishes quota exhaustion from transient rate limit');

    // 6f. Model unavailable (404) triggers fallback and reports model_unavailable if both fail
    const attemptedModels: string[] = [];
    const modelMissingResp = await handleAssistantRequest(
      { message: 'Hi' },
      undefined,
      {
        createClient: () => ({
          models: {
            generateContent: async (params) => {
              attemptedModels.push(String(params.model));
              const err = new Error('Model not found') as Error & { status?: number };
              err.status = 404;
              throw err;
            }
          }
        })
      }
    );
    assert(
      attemptedModels.length === 2 &&
        attemptedModels[0] === 'gemini-4-hydrogen' &&
        attemptedModels[1] === 'gemini-3.1-flash-lite',
      'Falls back to gemini-3.1-flash-lite on 404 model_unavailable'
    );
    assert(modelMissingResp.status === 502 && modelMissingResp.body.category === 'model_unavailable', 'Reports model_unavailable when models are unavailable');

    // 6g. Empty AI response -> 502 server_error
    const emptyReplyResp = await handleAssistantRequest(
      { message: 'Hi' },
      undefined,
      {
        createClient: () => ({
          models: {
            generateContent: async () => ({ text: '   ' })
          }
        })
      }
    );
    assert(emptyReplyResp.status === 502 && emptyReplyResp.body.category === 'server_error', 'Rejects empty AI response with 502 server_error');

    // 6h. Transcribe & Speak timeout/success tests
    const transcribeTimeoutResp = await handleTranscribeRequest(
      { audioBase64: 'dGVzdA==', mimeType: 'audio/webm' },
      undefined,
      {
        transcribeTimeoutMs: 30,
        createClient: () => ({
          models: {
            generateContent: (params) =>
              new Promise((_resolve, reject) => {
                const sig = (params as { config?: { abortSignal?: AbortSignal } }).config?.abortSignal;
                sig?.addEventListener('abort', () => {
                  const err = new Error('Aborted');
                  err.name = 'AbortError';
                  reject(err);
                });
              })
          }
        })
      }
    );
    assert(transcribeTimeoutResp.status === 504 && transcribeTimeoutResp.body.category === 'timeout', 'Transcribe handler respects server AbortSignal timeout');

    const speakOkResp = await handleSpeakRequest(
      { text: 'Hello Ameen' },
      undefined,
      {
        createClient: () => ({
          models: {
            generateContent: async () => ({
              candidates: [{ content: { parts: [{ inlineData: { data: 'UklGRg==', mimeType: 'audio/wav' } }] } }]
            })
          }
        })
      }
    );
    assert(speakOkResp.status === 200 && speakOkResp.body.mimeType === 'audio/wav', 'Speak handler returns audioBase64 and mimeType');

    // ==========================================
    // TEST 7: Frontend Service Timeouts, Non-JSON Gateway Errors & Duplicate Prevention
    // ==========================================
    console.log('Test 7: Verifying frontend timeout, network failure, Vercel 504, and duplicate-request protection...');

    // 7a. Frontend timeout
    let frontendTimeoutCaught: AiServiceError | null = null;
    try {
      await agentService.sendMessage({
        message: 'Test timeout',
        history: [],
        groundedContext: {},
        preferredLanguage: 'auto',
        timeoutMs: 35,
        fetchImpl: (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const err = new Error('Aborted');
              err.name = 'AbortError';
              reject(err);
            });
          })
      });
    } catch (e) {
      frontendTimeoutCaught = e as AiServiceError;
    }
    assert(
      frontendTimeoutCaught instanceof AiServiceError &&
        frontendTimeoutCaught.category === 'timeout' &&
        frontendTimeoutCaught.stage === 'network',
      'Frontend AbortController cleanly classifies client timeout without generic masking'
    );

    // 7b. Vercel non-JSON 504 Gateway Timeout
    let vercel504Caught: AiServiceError | null = null;
    try {
      await agentService.sendMessage({
        message: 'Test vercel 504',
        history: [],
        groundedContext: {},
        preferredLanguage: 'auto',
        fetchImpl: async () => new Response('FUNCTION_INVOCATION_TIMEOUT', { status: 504, headers: { 'content-type': 'text/plain' } })
      });
    } catch (e) {
      vercel504Caught = e as AiServiceError;
    }
    assert(
      vercel504Caught instanceof AiServiceError &&
        vercel504Caught.category === 'timeout' &&
        vercel504Caught.stage === 'vercel',
      'Distinguishes Vercel 504 plain-text gateway timeout'
    );

    // 7c. Network error
    let networkErrCaught: AiServiceError | null = null;
    try {
      await agentService.sendMessage({
        message: 'Test offline',
        history: [],
        groundedContext: {},
        preferredLanguage: 'auto',
        fetchImpl: async () => {
          throw new TypeError('Failed to fetch');
        }
      });
    } catch (e) {
      networkErrCaught = e as AiServiceError;
    }
    assert(
      networkErrCaught instanceof AiServiceError && networkErrCaught.category === 'network_error',
      'Classifies fetch connection drop as network_error'
    );

    // 7d. Duplicate in-flight assistant request coalescing
    let networkCallCount = 0;
    const delayedOkFetch: typeof fetch = async () => {
      networkCallCount += 1;
      await new Promise(r => setTimeout(r, 30));
      return new Response(
        JSON.stringify({ reply: 'Coalesced OK', detectedLanguage: 'en', requestId: 'req_dup_1' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };
    const [r1, r2] = await Promise.all([
      agentService.sendMessage({
        message: 'Hello',
        history: [],
        groundedContext: {},
        preferredLanguage: 'auto',
        fetchImpl: delayedOkFetch
      }),
      agentService.sendMessage({
        message: 'Hello',
        history: [],
        groundedContext: {},
        preferredLanguage: 'auto',
        fetchImpl: delayedOkFetch
      })
    ]);
    assert(networkCallCount === 1 && r1.reply === 'Coalesced OK' && r2.reply === 'Coalesced OK', 'Prevents duplicate concurrent assistant requests');
  } finally {
    if (prevUrl !== undefined) process.env.VITE_SUPABASE_URL = prevUrl;
    else delete process.env.VITE_SUPABASE_URL;
    if (prevAnon !== undefined) process.env.VITE_SUPABASE_ANON_KEY = prevAnon;
    else delete process.env.VITE_SUPABASE_ANON_KEY;
    if (prevGemini !== undefined) process.env.GEMINI_API_KEY = prevGemini;
    else delete process.env.GEMINI_API_KEY;
  }

  const vercelRaw = fs.readFileSync(path.join(rootDir, 'vercel.json'), 'utf8');
  assert(vercelRaw.includes('microphone=(self)'), 'vercel.json enables same-origin microphone permission');
  assert(vercelRaw.includes("media-src 'self' blob: data:"), 'vercel.json permits blob/data WAV media playback in CSP');
  assert(vercelRaw.includes('maxDuration') && vercelRaw.includes('api/ai/*.ts'), 'vercel.json configures 60s maxDuration for AI functions');

  assert(FRONTEND_ASSISTANT_TIMEOUT_MS === 52000, 'Frontend assistant timeout aligns at 52s (> 42s server deadline)');
  assert(FRONTEND_SPEAK_TIMEOUT_MS === 42000, 'Frontend speak timeout aligns at 42s (> 32s server deadline)');

  const viteCfgRaw = fs.readFileSync(path.join(rootDir, 'vite.config.ts'), 'utf8');
  assert(viteCfgRaw.includes('/^\\/api\\//'), 'vite.config.ts excludes /api/ routes from PWA navigateFallback');

  console.log('ALL XOS JARVIS AI AGENT TESTS PASSED SUCCESSFULLY!');
}

runAiAgentTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
