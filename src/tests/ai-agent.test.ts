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
  serializeGroundedContextSafely,
  verifySupabaseSessionToken
} from '../../api/_lib/aiHandler';
import {
  configureRepositoryBackendForTests,
  repository
} from '../services/repository';

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

  // Empty current month fallback (e.g., asking in Dec when records are in Nov/Oct)
  const decNow = new Date('2026-12-10T10:00:00+05:30');
  const emptyMonthExpCtx = buildSelectiveXosContext({
    query: 'What are my expenses?',
    data: snapshot,
    now: decNow
  });
  const decExp = emptyMonthExpCtx.groundedContext.expenses as {
    total: number;
    allTime: { total: number; transactionCount: number };
    recentAllTimeTransactions?: unknown[];
  };
  assert(decExp.total === 0, 'Target month expense total is honestly 0 in empty month');
  assert(decExp.allTime.total === 7900 && decExp.allTime.transactionCount === 3, 'Includes allTime expense totals when current month is empty');
  assert(Array.isArray(decExp.recentAllTimeTransactions) && decExp.recentAllTimeTransactions.length === 3, 'Provides recentAllTimeTransactions fallback');

  // Complete 23-query bilingual audit regression suite (10 English, 8 Malayalam, 5 Manglish)
  const auditCases: Array<{
    query: string;
    expectedModule: string;
    expectedLang: 'en' | 'ml' | 'mixed';
    forbiddenModules?: string[];
  }> = [
    // 10 English
    { query: 'How much did I spend this month?', expectedModule: 'expenses', expectedLang: 'en' },
    { query: 'What are my expenses?', expectedModule: 'expenses', expectedLang: 'en' },
    { query: 'How much income did I receive?', expectedModule: 'income', expectedLang: 'en' },
    { query: 'How much debt do I have?', expectedModule: 'debt', expectedLang: 'en' },
    { query: 'How much money do I have in savings?', expectedModule: 'savings', expectedLang: 'en' },
    { query: 'What is my total savings?', expectedModule: 'savings', expectedLang: 'en', forbiddenModules: ['attendance', 'overview'] },
    { query: 'What is my salary?', expectedModule: 'salary', expectedLang: 'en' },
    { query: 'How many days did I work this month?', expectedModule: 'attendance', expectedLang: 'en' },
    { query: 'What are my financial goals?', expectedModule: 'goals', expectedLang: 'en' },
    { query: 'What is my available balance?', expectedModule: 'overview', expectedLang: 'en' },
    // 8 Malayalam
    { query: 'ഈ മാസം എന്റെ ചെലവുകൾ എങ്ങനെയുണ്ട്?', expectedModule: 'expenses', expectedLang: 'ml' },
    { query: 'ഈ മാസം എത്ര വരവ് ഉണ്ടായി?', expectedModule: 'income', expectedLang: 'ml' },
    { query: 'എനിക്ക് എത്ര കടമുണ്ട്?', expectedModule: 'debt', expectedLang: 'ml', forbiddenModules: ['overview'] },
    { query: 'എനിക്ക് എത്ര പണം കിട്ടാനുണ്ട്?', expectedModule: 'debt', expectedLang: 'ml', forbiddenModules: ['overview', 'salary'] },
    { query: 'എന്റെ സേവിങ്സ് എത്രയാണ്?', expectedModule: 'savings', expectedLang: 'ml' },
    { query: 'ഈ മാസം എന്റെ ശമ്പളം എത്രയാണ്?', expectedModule: 'salary', expectedLang: 'ml' },
    { query: 'ഈ മാസം എത്ര ദിവസം ജോലി ചെയ്തു?', expectedModule: 'attendance', expectedLang: 'ml' },
    { query: 'എന്റെ ലക്ഷ്യങ്ങൾ എന്തൊക്കെയാണ്?', expectedModule: 'goals', expectedLang: 'ml' },
    // 5 Manglish
    { query: 'Ee month ethra expense aayi?', expectedModule: 'expenses', expectedLang: 'mixed' },
    { query: 'Ente income ethra aanu?', expectedModule: 'income', expectedLang: 'mixed' },
    { query: 'Enikku aarkkokke kadam kodukkan undu?', expectedModule: 'debt', expectedLang: 'mixed' },
    { query: 'Ente savings ethra aanu?', expectedModule: 'savings', expectedLang: 'mixed' },
    { query: 'Ee month ethra days work cheythu?', expectedModule: 'attendance', expectedLang: 'mixed' }
  ];

  for (const tc of auditCases) {
    const built = buildSelectiveXosContext({ query: tc.query, data: snapshot, now: fixedNow });
    assert(
      built.selectedModules.includes(tc.expectedModule as never),
      `Query "${tc.query}" routes to ${tc.expectedModule} (got ${built.selectedModules.join(',')})`
    );
    assert(
      built.intent.detectedLanguage === tc.expectedLang,
      `Query "${tc.query}" detects language=${tc.expectedLang} (got ${built.intent.detectedLanguage})`
    );
    for (const forbidden of tc.forbiddenModules || []) {
      assert(
        !built.selectedModules.includes(forbidden as never),
        `Query "${tc.query}" does not falsely include ${forbidden}`
      );
    }
    const ctxKey = tc.expectedModule === 'app_help' ? 'workspace' : tc.expectedModule;
    assert(
      ctxKey in built.groundedContext,
      `Query "${tc.query}" populates groundedContext.${ctxKey}`
    );
  }

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
    assert(!content.includes('GROQ_API_KEY'), `No GROQ_API_KEY exposure in ${relPath}`);
    assert(!content.includes('api.groq.com'), `No direct Groq API endpoint reference in ${relPath}`);
    assert(
      !/repository\.(add|update|delete|upsert|persist|save|clear|reset|import|recordSalaryPayout)/.test(content),
      `No repository write/reset calls in ${relPath}`
    );
  }
  const groqServerSrc = fs.readFileSync(path.join(rootDir, 'api/_lib/groq.ts'), 'utf8');
  assert(!groqServerSrc.includes('@google/genai'), 'api/_lib/groq.ts does not import @google/genai');
  assert(!/service_role|SUPABASE_SERVICE_ROLE/i.test(groqServerSrc), 'api/_lib/groq.ts has no Supabase service-role references');

  // ==========================================
  // TEST 5: Server-Side Auth, Validation & Deployment Config
  // ==========================================
  console.log('Test 5: Verifying server JWT verification, error handling, Vercel headers & PWA denylist...');
  const prevUrl = process.env.VITE_SUPABASE_URL;
  const prevAnon = process.env.VITE_SUPABASE_ANON_KEY;
  const prevGroq = process.env.GROQ_API_KEY;
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

    // Unconfigured Supabase + missing BOTH keys returns honest 503 unavailable
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.VITE_SUPABASE_ANON_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const unavailNoKeysResp = await handleAssistantRequest({ message: 'Hi' }, undefined);
    assert(unavailNoKeysResp.status === 503, `Returns honest 503 when both keys are absent (got ${unavailNoKeysResp.status})`);

    // When GROQ_API_KEY is absent but GEMINI_API_KEY is configured, assistant seamlessly runs Gemini
    process.env.GEMINI_API_KEY = 'test-gemini-key-present';
    const geminiOnlyResp = await handleAssistantRequest(
      { message: 'Hi' },
      undefined,
      {
        createClient: () => ({
          models: {
            generateContent: async () => ({ text: 'Gemini primary fallback reply.' })
          }
        })
      }
    );
    assert(
      geminiOnlyResp.status === 200 &&
        geminiOnlyResp.body.provider === 'gemini' &&
        geminiOnlyResp.body.fallbackUsed === true &&
        geminiOnlyResp.body.model === 'gemini-4-hydrogen' &&
        geminiOnlyResp.body.reply === 'Gemini primary fallback reply.',
      `Uses Gemini directly when GROQ_API_KEY is absent and GEMINI_API_KEY is configured (got status=${geminiOnlyResp.status})`
    );

    process.env.GROQ_API_KEY = 'test-groq-key-present';
    const emptyMsgResp = await handleAssistantRequest({ message: '   ' }, undefined);
    assert(emptyMsgResp.status === 400, 'Rejects blank message with 400');
    assert(Boolean(emptyMsgResp.body.requestId), 'Includes diagnostic requestId in error responses');

    // ==========================================
    // TEST 6: Groq Primary Provider, Strict Deadlines, Fallback Rules & Error Classification
    // ==========================================
    console.log('Test 6: Verifying Groq openai/gpt-oss-20b primary flow, AbortSignal timeouts, strict non-fallback rules, and optional Gemini fallback...');

    // 6a. Successful Groq primary response & strict request verification
    let capturedGroqUrl = '';
    let capturedGroqAuth = '';
    let capturedGroqBody: Record<string, unknown> | null = null;
    let geminiCalledWhenGroqOk = false;
    const okResp = await handleAssistantRequest(
      { message: 'How are my expenses?', groundedContext: { expenses: { total: 6400 } } },
      undefined,
      {
        groqFetchImpl: async (url, init) => {
          capturedGroqUrl = String(url);
          const hdrs = (init?.headers || {}) as Record<string, string>;
          capturedGroqAuth = hdrs.Authorization || hdrs.authorization || '';
          capturedGroqBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: 'Your expenses total ₹6,400 this month.' }, finish_reason: 'stop' }]
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        },
        createClient: () => ({
          models: {
            generateContent: async () => {
              geminiCalledWhenGroqOk = true;
              return { text: 'Should not call Gemini' };
            }
          }
        })
      }
    );
    assert(!geminiCalledWhenGroqOk, 'Does not call Gemini fallback when Groq succeeds');
    assert(
      okResp.status === 200 &&
        okResp.body.reply === 'Your expenses total ₹6,400 this month.' &&
        okResp.body.provider === 'groq' &&
        okResp.body.fallbackUsed === false &&
        okResp.body.model === 'openai/gpt-oss-20b',
      'Returns successful Groq primary response with provider/model metadata'
    );
    assert(Boolean(okResp.body.requestId), 'Successful response includes requestId');
    assert(capturedGroqUrl === 'https://api.groq.com/openai/v1/chat/completions', 'Calls official Groq OpenAI-compatible chat completions endpoint');
    assert(capturedGroqAuth === 'Bearer test-groq-key-present', 'Sends GROQ_API_KEY via server-side Bearer header');
    const groqBody = capturedGroqBody as Record<string, unknown> | null;
    assert(groqBody !== null && groqBody.model === 'openai/gpt-oss-20b', 'Uses openai/gpt-oss-20b primary model');
    assert(groqBody?.reasoning_effort === 'low', 'Configures reasoning_effort=low');
    assert(groqBody?.max_completion_tokens === 1536, 'Uses bounded max_completion_tokens=1536 sufficient for reasoning and Malayalam');
    assert(groqBody?.temperature === 0.2, 'Uses low temperature=0.2');
    assert(groqBody?.stream === false, 'Disables streaming for reliable serverless JSON response');
    const capturedMessages = (groqBody?.messages || []) as Array<{ role: string; content: string }>;
    const finalUserText = capturedMessages[capturedMessages.length - 1]?.content || '';
    assert(
      capturedMessages[0]?.role === 'system' &&
        finalUserText.includes('How are my expenses?') &&
        finalUserText.includes('XOS GROUNDED DATA CONTEXT (READ-ONLY JSON):') &&
        finalUserText.includes('"total":6400'),
      'Embeds valid grounded JSON directly alongside final user question'
    );

    // 6a-2. Oversized context compacts cleanly without corrupting JSON
    const hugeContext = {
      workspace: { currency: 'INR', selectedModules: ['expenses'] },
      expenses: {
        total: 95000,
        recentTransactions: Array.from({ length: 120 }, (_, i) => ({
          title: `Detailed Merchant Purchase Item Number ${i} with Extra Descriptive Padding Text`,
          amount: 790 + i,
          category: 'Shopping',
          date: '2026-11-10',
          paymentMethod: 'Bank Transfer'
        }))
      }
    };
    const compacted = serializeGroundedContextSafely(hugeContext, 4000);
    assert(compacted.compacted === true, 'Marks oversized grounded context as compacted');
    assert(compacted.json.length <= 4000, `Compacted JSON stays within budget (${compacted.json.length} <= 4000)`);
    const parsedCompacted = JSON.parse(compacted.json) as {
      workspace?: { contextCompacted?: boolean };
      expenses?: { total?: number };
    };
    assert(
      parsedCompacted.workspace?.contextCompacted === true && parsedCompacted.expenses?.total === 95000,
      'Compacted context remains valid JSON and preserves authoritative module totals'
    );

    // 6b. Server-side Groq timeout aborts underlying signal, does NOT fallback, & returns 504 timeoutStage=groq
    const timeoutState = { signalAborted: false, geminiCalled: false };
    const timeoutResp = await handleAssistantRequest(
      { message: 'Slow query' },
      undefined,
      {
        assistantTimeoutMs: 40,
        groqFetchImpl: (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              timeoutState.signalAborted = true;
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }),
        createClient: () => ({
          models: {
            generateContent: async () => {
              timeoutState.geminiCalled = true;
              return { text: 'Should not run after timeout' };
            }
          }
        })
      }
    );
    assert(timeoutState.signalAborted, 'Server deadline actually aborts Groq fetch via AbortSignal');
    assert(!timeoutState.geminiCalled, 'Never invokes Gemini fallback after request deadline expires');
    assert(timeoutResp.status === 504 && timeoutResp.body.category === 'timeout', 'Returns 504 with category=timeout');
    assert(timeoutResp.body.timeoutStage === 'groq', 'Records timeoutStage=groq');

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

    // 6d. Invalid Groq API key (401) -> invalid_api_key (NO Gemini fallback)
    let fallbackCalledOnBadKey = false;
    const badKeyResp = await handleAssistantRequest(
      { message: 'Hi' },
      undefined,
      {
        groqFetchImpl: async () =>
          new Response(JSON.stringify({ error: { message: 'Invalid API Key', type: 'invalid_request_error', code: 'invalid_api_key' } }), {
            status: 401,
            headers: { 'content-type': 'application/json' }
          }),
        createClient: () => ({
          models: {
            generateContent: async () => {
              fallbackCalledOnBadKey = true;
              return { text: 'Should not run' };
            }
          }
        })
      }
    );
    assert(!fallbackCalledOnBadKey, 'Never falls back to Gemini on invalid Groq API key');
    assert(badKeyResp.status === 502 && badKeyResp.body.category === 'invalid_api_key', 'Maps Groq 401/invalid key to invalid_api_key');

    // 6e. Rate limit (429), Quota (429), and 413 payload/context errors without vs with Gemini fallback; 400 NEVER falls back
    delete process.env.GEMINI_API_KEY;
    const rateNoFallbackResp = await handleAssistantRequest(
      { message: 'Hi' },
      undefined,
      {
        groqFetchImpl: async () =>
          new Response(JSON.stringify({ error: { message: 'Too many requests', code: 'rate_limit_exceeded' } }), { status: 429 })
      }
    );
    assert(rateNoFallbackResp.status === 429 && rateNoFallbackResp.body.category === 'rate_limited', 'Maps transient Groq 429 to rate_limited when Gemini is unconfigured');

    const quotaNoFallbackResp = await handleAssistantRequest(
      { message: 'Hi' },
      undefined,
      {
        groqFetchImpl: async () =>
          new Response(JSON.stringify({ error: { message: 'You exceeded your current quota, please check billing' } }), { status: 429 })
      }
    );
    assert(quotaNoFallbackResp.status === 429 && quotaNoFallbackResp.body.category === 'quota_exceeded', 'Distinguishes Groq quota exhaustion from transient rate limit');

    process.env.GEMINI_API_KEY = 'test-gemini-key-present';
    const rateWithFallbackResp = await handleAssistantRequest(
      { message: 'How much did I spend?' },
      undefined,
      {
        groqFetchImpl: async () =>
          new Response(JSON.stringify({ error: { message: 'Too many requests', code: 'rate_limit_exceeded' } }), { status: 429 }),
        createClient: () => ({
          models: {
            generateContent: async () => ({ text: 'Recovered via Gemini after Groq 429.' })
          }
        })
      }
    );
    assert(
      rateWithFallbackResp.status === 200 &&
        rateWithFallbackResp.body.provider === 'gemini' &&
        rateWithFallbackResp.body.fallbackUsed === true,
      'Recovers via Gemini fallback on Groq 429 when GEMINI_API_KEY is configured'
    );

    const payload413FallbackResp = await handleAssistantRequest(
      { message: 'Hi' },
      undefined,
      {
        groqFetchImpl: async () =>
          new Response(JSON.stringify({ error: { message: 'Request too large for model', type: 'invalid_request_error' } }), { status: 413 }),
        createClient: () => ({
          models: {
            generateContent: async () => ({ text: 'Recovered via Gemini after Groq 413.' })
          }
        })
      }
    );
    assert(
      payload413FallbackResp.status === 200 &&
        payload413FallbackResp.body.provider === 'gemini' &&
        payload413FallbackResp.body.fallbackUsed === true,
      'Recovers via Gemini fallback on Groq 413 context-too-large'
    );

    let fallbackCalledOn400 = false;
    const badReqResp = await handleAssistantRequest(
      { message: 'Hi' },
      undefined,
      {
        groqFetchImpl: async () =>
          new Response(JSON.stringify({ error: { message: 'Malformed request', type: 'invalid_request_error' } }), { status: 400 }),
        createClient: () => ({
          models: {
            generateContent: async () => {
              fallbackCalledOn400 = true;
              return { text: 'Should not run' };
            }
          }
        })
      }
    );
    assert(!fallbackCalledOn400, 'Never falls back to Gemini on 400 invalid user input');
    assert(badReqResp.status === 400 && badReqResp.body.category === 'invalid_request', 'Maps Groq 400 to invalid_request');

    // 6f. Groq temporary unavailability (503) falls back ONCE to Gemini when GEMINI_API_KEY is configured, or errors cleanly without it
    const geminiFallbackOk = await handleAssistantRequest(
      { message: 'Hi' },
      undefined,
      {
        groqFetchImpl: async () =>
          new Response(JSON.stringify({ error: { message: 'Service temporarily unavailable' } }), { status: 503 }),
        createClient: () => ({
          models: {
            generateContent: async () => ({ text: 'Fallback Gemini reply.' })
          }
        })
      }
    );
    assert(
      geminiFallbackOk.status === 200 &&
        geminiFallbackOk.body.reply === 'Fallback Gemini reply.' &&
        geminiFallbackOk.body.provider === 'gemini' &&
        geminiFallbackOk.body.fallbackUsed === true,
      'Falls back once to Gemini when Groq returns 503 and GEMINI_API_KEY is configured'
    );

    const attemptedGeminiModels: string[] = [];
    const modelMissingResp = await handleAssistantRequest(
      { message: 'Hi' },
      undefined,
      {
        groqFetchImpl: async () => new Response(JSON.stringify({ error: { message: 'Upstream 503' } }), { status: 503 }),
        createClient: () => ({
          models: {
            generateContent: async (params) => {
              attemptedGeminiModels.push(String(params.model));
              const err = new Error('Model not found') as Error & { status?: number };
              err.status = 404;
              throw err;
            }
          }
        })
      }
    );
    assert(
      attemptedGeminiModels.length === 2 &&
        attemptedGeminiModels[0] === 'gemini-4-hydrogen' &&
        attemptedGeminiModels[1] === 'gemini-3.1-flash-lite',
      'Gemini fallback chain steps from gemini-4-hydrogen to gemini-3.1-flash-lite on 404'
    );
    assert(modelMissingResp.status === 502 && modelMissingResp.body.category === 'model_unavailable', 'Reports model_unavailable when fallback Gemini models are unavailable');

    delete process.env.GEMINI_API_KEY;
    const groqOnly503 = await handleAssistantRequest(
      { message: 'Hi' },
      undefined,
      {
        groqFetchImpl: async () => new Response(JSON.stringify({ error: { message: 'Service temporarily unavailable' } }), { status: 503 })
      }
    );
    assert(groqOnly503.status === 503 && groqOnly503.body.category === 'server_error', 'Returns clean 503 server_error when Groq is down and Gemini fallback is unconfigured');
    process.env.GEMINI_API_KEY = 'test-gemini-key-present';

    // 6g. Empty Groq response -> 502 invalid_response; reasoning-token length truncation recovers via Gemini fallback
    const emptyReplyResp = await handleAssistantRequest(
      { message: 'Hi' },
      undefined,
      {
        groqFetchImpl: async () =>
          new Response(JSON.stringify({ choices: [{ message: { content: '   ' } }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
      }
    );
    assert(emptyReplyResp.status === 502 && emptyReplyResp.body.category === 'invalid_response', 'Rejects empty Groq response with 502 invalid_response');

    const lengthTruncatedRecovered = await handleAssistantRequest(
      { message: 'Summarize my spending' },
      undefined,
      {
        groqFetchImpl: async () =>
          new Response(JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }),
        createClient: () => ({
          models: {
            generateContent: async () => ({
              candidates: [{ content: { parts: [{ thought: true, text: 'internal' }, { text: 'Recovered summary from Gemini.' }] } }]
            })
          }
        })
      }
    );
    assert(
      lengthTruncatedRecovered.status === 200 &&
        lengthTruncatedRecovered.body.reply === 'Recovered summary from Gemini.' &&
        lengthTruncatedRecovered.body.provider === 'gemini' &&
        lengthTruncatedRecovered.body.fallbackUsed === true,
      'Recovers via Gemini when reasoning-token exhaustion produces finish_reason=length empty content, extracting non-thought Gemini parts cleanly'
    );

    const bothFailResp = await handleAssistantRequest(
      { message: 'Hi' },
      undefined,
      {
        groqFetchImpl: async () => new Response(JSON.stringify({ error: { message: 'Groq 503' } }), { status: 503 }),
        createClient: () => ({
          models: {
            generateContent: async () => {
              const err = new Error('Gemini upstream 503') as Error & { status?: number };
              err.status = 503;
              throw err;
            }
          }
        })
      }
    );
    assert(bothFailResp.status === 503 && bothFailResp.body.provider === 'gemini', 'Surfaces clean structured error when both Groq and Gemini fail');

    // 6h. Transcribe (Groq whisper-large-v3-turbo primary + optional Gemini fallback) & Speak (Gemini TTS)
    const sampleAudioB64 = Buffer.alloc(128, 3).toString('base64');
    let capturedSttUrl = '';
    let capturedSttModel: FormDataEntryValue | null = null;
    let capturedSttLang: FormDataEntryValue | null = null;
    const transcribeOkResp = await handleTranscribeRequest(
      { audioBase64: sampleAudioB64, mimeType: 'audio/webm', preferredLanguage: 'ml-IN' },
      undefined,
      {
        groqFetchImpl: async (url, init) => {
          capturedSttUrl = String(url);
          const form = init?.body as FormData;
          capturedSttModel = form.get('model');
          capturedSttLang = form.get('language');
          return new Response(JSON.stringify({ text: 'ഈ മാസം എത്ര ചെലവായി?' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        }
      }
    );
    assert(
      transcribeOkResp.status === 200 &&
        transcribeOkResp.body.transcript === 'ഈ മാസം എത്ര ചെലവായി?' &&
        transcribeOkResp.body.provider === 'groq' &&
        transcribeOkResp.body.model === 'whisper-large-v3-turbo' &&
        capturedSttUrl === 'https://api.groq.com/openai/v1/audio/transcriptions' &&
        capturedSttModel === 'whisper-large-v3-turbo' &&
        capturedSttLang === 'ml',
      'Transcribe routes primarily to Groq whisper-large-v3-turbo with Malayalam language hint'
    );

    const transcribeTimeoutResp = await handleTranscribeRequest(
      { audioBase64: sampleAudioB64, mimeType: 'audio/webm' },
      undefined,
      {
        transcribeTimeoutMs: 30,
        groqFetchImpl: (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const err = new Error('Aborted');
              err.name = 'AbortError';
              reject(err);
            });
          })
      }
    );
    assert(
      transcribeTimeoutResp.status === 504 &&
        transcribeTimeoutResp.body.category === 'timeout' &&
        transcribeTimeoutResp.body.timeoutStage === 'groq',
      'Transcribe handler respects server AbortSignal timeout on Groq'
    );

    const transcribeFallbackOk = await handleTranscribeRequest(
      { audioBase64: sampleAudioB64, mimeType: 'audio/webm' },
      undefined,
      {
        groqFetchImpl: async () => new Response(JSON.stringify({ error: { message: 'Upstream 503' } }), { status: 503 }),
        createClient: () => ({
          models: {
            generateContent: async () => ({ text: 'Fallback transcript' })
          }
        })
      }
    );
    assert(
      transcribeFallbackOk.status === 200 &&
        transcribeFallbackOk.body.transcript === 'Fallback transcript' &&
        transcribeFallbackOk.body.provider === 'gemini' &&
        transcribeFallbackOk.body.fallbackUsed === true,
      'Transcribe falls back to Gemini only when Groq returns temporary unavailability and GEMINI_API_KEY is configured'
    );

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

    const speakEmptyResp = await handleSpeakRequest(
      { text: 'Hello Ameen' },
      undefined,
      {
        createClient: () => ({
          models: {
            generateContent: async () => ({ candidates: [] })
          }
        })
      }
    );
    assert(speakEmptyResp.status === 502 && speakEmptyResp.body.category === 'invalid_response', 'Speak handler rejects empty TTS audio with 502 invalid_response');

    // ==========================================
    // TEST 7: Frontend Service Timeouts, Non-JSON Gateway Errors, Cancel vs Timeout & Duplicate Prevention
    // ==========================================
    console.log('Test 7: Verifying frontend timeout, cancel, HTML/non-JSON invalid_response, Vercel 504, and duplicate-request protection...');

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

    // 7a-2. External abort signal -> cancelled (not timeout)
    const externalCtrl = new AbortController();
    let cancelledCaught: AiServiceError | null = null;
    try {
      setTimeout(() => externalCtrl.abort(), 15);
      await agentService.sendMessage({
        message: 'Test user cancel',
        history: [],
        groundedContext: {},
        preferredLanguage: 'auto',
        signal: externalCtrl.signal,
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
      cancelledCaught = e as AiServiceError;
    }
    assert(
      cancelledCaught instanceof AiServiceError &&
        cancelledCaught.category === 'cancelled' &&
        cancelledCaught.code === 'cancelled',
      'External AbortSignal classifies as cancelled rather than timeout'
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

    // 7b-2. HTML SPA fallback 200 or gateway HTML 500 -> invalid_response
    let html200Caught: AiServiceError | null = null;
    try {
      await agentService.sendMessage({
        message: 'Test html 200',
        history: [],
        groundedContext: {},
        preferredLanguage: 'auto',
        fetchImpl: async () => new Response('<!doctype html><html><body>XOS</body></html>', { status: 200, headers: { 'content-type': 'text/html' } })
      });
    } catch (e) {
      html200Caught = e as AiServiceError;
    }
    assert(
      html200Caught instanceof AiServiceError && html200Caught.category === 'invalid_response',
      'Classifies HTML SPA fallback 200 response as invalid_response'
    );

    let html500Caught: AiServiceError | null = null;
    try {
      await agentService.sendMessage({
        message: 'Test html 500',
        history: [],
        groundedContext: {},
        preferredLanguage: 'auto',
        fetchImpl: async () => new Response('<html>500 Error</html>', { status: 500, headers: { 'content-type': 'text/html' } })
      });
    } catch (e) {
      html500Caught = e as AiServiceError;
    }
    assert(
      html500Caught instanceof AiServiceError && html500Caught.category === 'invalid_response',
      'Classifies non-JSON HTML 500 gateway error as invalid_response'
    );

    // 7c. Network error does not falsely blame user internet when navigator.onLine !== false
    let networkErrCaught: AiServiceError | null = null;
    try {
      await agentService.sendMessage({
        message: 'Test connection drop',
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
      networkErrCaught instanceof AiServiceError &&
        networkErrCaught.category === 'network_error' &&
        !networkErrCaught.message.includes('Check your internet connection'),
      'Classifies fetch connection drop as network_error without misleading internet blame'
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
    assert(networkCallCount === 1 && r1.reply === 'Coalesced OK' && r2.reply === 'Coalesced OK', 'Prevents duplicate concurrent identical assistant requests');

    // Different concurrent queries must NOT be coalesced together
    let seqCount = 0;
    const perQueryFetch: typeof fetch = async (_url, init) => {
      seqCount += 1;
      const body = JSON.parse(String(init?.body || '{}')) as { message?: string };
      await new Promise(r => setTimeout(r, 20));
      return new Response(
        JSON.stringify({ reply: `Answer for ${body.message}`, detectedLanguage: 'en', requestId: `req_${seqCount}` }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };
    const [d1, d2] = await Promise.all([
      agentService.sendMessage({
        message: 'Query A',
        history: [],
        groundedContext: {},
        preferredLanguage: 'auto',
        fetchImpl: perQueryFetch
      }),
      agentService.sendMessage({
        message: 'Query B',
        history: [],
        groundedContext: {},
        preferredLanguage: 'auto',
        fetchImpl: perQueryFetch
      })
    ]);
    assert(
      seqCount === 2 && d1.reply === 'Answer for Query A' && d2.reply === 'Answer for Query B',
      'Does not coalesce distinct concurrent assistant queries'
    );

    // 7e. Repository hydration state tracking
    const makeTableStub = () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: async () => ({ data: [], error: null }),
        maybeSingle: async () => ({ data: null, error: null })
      };
      return chain;
    };
    try {
      configureRepositoryBackendForTests(
        { from: () => makeTableStub() } as never,
        true
      );
      repository.clearUserData();
      repository.setActiveUserId('user-hyd-1');
      assert(repository.getHydrationState().hasHydrated === false, 'Initial user hydration is false before fetchAllUserData');
      await repository.fetchAllUserData('user-hyd-1');
      assert(
        repository.getHydrationState().hasHydrated === true &&
          repository.getHydrationState().hydratedUserId === 'user-hyd-1',
        'Marks user hydrated after fetchAllUserData completes'
      );
      repository.clearUserData();
      assert(repository.getHydrationState().hasHydrated === false, 'Resets hydration flag on clearUserData');
    } finally {
      repository.clearUserData();
      configureRepositoryBackendForTests(null, null);
    }
  } finally {
    if (prevUrl !== undefined) process.env.VITE_SUPABASE_URL = prevUrl;
    else delete process.env.VITE_SUPABASE_URL;
    if (prevAnon !== undefined) process.env.VITE_SUPABASE_ANON_KEY = prevAnon;
    else delete process.env.VITE_SUPABASE_ANON_KEY;
    if (prevGroq !== undefined) process.env.GROQ_API_KEY = prevGroq;
    else delete process.env.GROQ_API_KEY;
    if (prevGemini !== undefined) process.env.GEMINI_API_KEY = prevGemini;
    else delete process.env.GEMINI_API_KEY;
  }

  // ESM .js relative import specifiers check for Vercel Node ESM runtime
  const serverEsmFiles = [
    'api/ai/assistant.ts',
    'api/ai/transcribe.ts',
    'api/ai/speak.ts',
    'api/_lib/aiHandler.ts',
    'api/_lib/groq.ts',
    'api/_lib/gemini.ts',
    'server.ts'
  ];
  for (const relPath of serverEsmFiles) {
    const content = fs.readFileSync(path.join(rootDir, relPath), 'utf8');
    assert(!/from\s+['"]\.\.?\/[^'"]+\.ts['"]/.test(content), `Uses Node ESM .js specifier rather than .ts in ${relPath}`);
  }

  // Minimalist UI contract verification
  const aiViewSrc = fs.readFileSync(path.join(rootDir, 'src/components/ai/AiAgentView.tsx'), 'utf8');
  for (const requiredToken of [
    'Read-only',
    'Auto',
    'English',
    'മലയാളം',
    'Monthly spending',
    'ഈ മാസം എന്റെ ചെലവുകൾ',
    'Salary and attendance',
    'Debt and savings',
    'Retry',
    'Message Jarvis AI'
  ]) {
    assert(aiViewSrc.includes(requiredToken), `AiAgentView includes required minimalist UI element: ${requiredToken}`);
  }
  assert(!aiViewSrc.includes('Voice On') && !aiViewSrc.includes('Voice Muted') && !aiViewSrc.includes('Diagnostic Stage'), 'AiAgentView removes oversized telemetry badges and debug boxes');

  const headerSrc = fs.readFileSync(path.join(rootDir, 'src/components/layout/Header.tsx'), 'utf8');
  assert(
    headerSrc.includes("activeTab === 'ai-agent'") &&
      headerSrc.includes("'Jarvis AI'") &&
      headerSrc.includes('<JarvisLogo') &&
      headerSrc.includes('{!isJarvisAi &&'),
    'Header renders Jarvis AI title + JarvisLogo exclusively in Jarvis AI section and omits + Log button'
  );

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
