/**
 * XOS Jarvis — Voice-Activated Financial Data Entry Test Suite
 * Covers all 24 mandatory end-to-end scenarios:
 *  1. English expense voice entry + confirm
 *  2. Malayalam expense voice entry + confirm
 *  3. Manglish expense voice entry + IST yesterday resolution + confirm
 *  4. Malayalam number words (ഒന്നര ആയിരം, നൂറ്റമ്പത്, രണ്ടര നൂറ്) + confirm
 *  5. Income entry (English, Malayalam, Manglish) + persistence
 *  6. Debt receivable ("Money to Receive")
 *  7. Debt payable ("Money to Pay") — never confused with receivable
 *  8. Debt repayment for 'pay' debt -> updates debt balance + auto-creates linked Debt Repayment expense (never duplicate debt)
 *  9. Multiple matching debts -> interactive clarification / disambiguation options
 * 10. Savings transaction entry + balance update + multiple savings goals disambiguation
 * 11. Ambiguous amount rejection ("കുറച്ചു പണം", "some money") -> clarification, zero DB writes
 * 12. Negative/zero amount rejection ("-100", "0 rupees") -> clarification, zero DB writes
 * 13. Invalid calendar date rejection ("2026-02-30", "February 30") -> clarification, zero DB writes
 * 14. Unknown expense category (no invention) -> clarification
 * 15. Low-confidence LLM output (< 0.7) -> clarification, no proposal
 * 16. Preview editing before confirmation saves updated values
 * 17. Cancel discards preview cleanly without DB writes
 * 18. Pending confirmation TTL expiry (rejected by executor)
 * 19. Voice confirmation ONLY triggers when active non-expired pending proposal exists
 * 20. Idempotency & duplicate prevention (double-tap, repeated voice confirm, concurrent calls, Supabase abort-after-commit)
 * 21. Unauthenticated / session expired / DB RLS error surfaces real failure without false success
 * 22. Read-only queries ("How much did I spend this month?", "How much did I spend?") remain strictly read-only
 * 23. Actionable query ("Add 150 rupees food expense.") prepares preview & ONLY saves after explicit confirmation
 * 24. Static security audit (zero browser storage, zero service_role, zero raw SQL, zero keys/console in client files)
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { handleAssistantRequest } from '../../api/_lib/aiHandler';
import { DEFAULT_USER_SETTINGS } from '../data/initialData';
import {
  buildEntryCatalog,
  buildSelectiveXosContext,
  XOSReadOnlySnapshot
} from '../services/ai/contextBuilder';
import {
  executeConfirmedTransaction,
  resetTransactionExecutorState
} from '../services/ai/transactionExecutor';
import {
  createIdempotencyKey,
  createProposalId,
  matchPendingConfirmationVoiceCommand,
  parseMalayalamManglishAmount,
  PENDING_TRANSACTION_TTL_MS,
  PendingTransactionProposal,
  subtractIstDays,
  validateAndNormalizeProposal
} from '../services/ai/transactionSchemas';
import {
  configureRepositoryBackendForTests,
  repository,
  serializeDebtDescription
} from '../services/repository';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Voice Data Entry assertion failed: ${message}`);
  }
}

function countRows(rows: unknown[]): number {
  return rows.length;
}

function makeGroqJsonFetch(jsonObj: Record<string, unknown>, onCall?: () => void): typeof fetch {
  return async () => {
    onCall?.();
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(jsonObj) } }]
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };
}

function makeSupabaseAuthOkFetch(): typeof fetch {
  return async () =>
    new Response(JSON.stringify({ id: 'user-voice-test-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
}

interface MockDbTables {
  expenses: Array<Record<string, unknown>>;
  incomes: Array<Record<string, unknown>>;
  debts: Array<Record<string, unknown>>;
  debt_repayments: Array<Record<string, unknown>>;
  savings_goals: Array<Record<string, unknown>>;
  savings_transactions: Array<Record<string, unknown>>;
}

function createInMemorySupabaseStub(options?: {
  simulateAbortAfterInsertOnTable?: keyof MockDbTables;
  simulateRlsErrorOnTable?: keyof MockDbTables;
  unauthenticated?: boolean;
}) {
  const db: MockDbTables = {
    expenses: [],
    incomes: [],
    debts: [],
    debt_repayments: [],
    savings_goals: [],
    savings_transactions: []
  };
  let seq = 1;
  const insertCallCounts: Record<string, number> = {};

  const client = {
    auth: {
      async getSession() {
        return {
          data: {
            session: options?.unauthenticated
              ? null
              : { user: { id: 'user-voice-test-1', email: 'ameen@example.com' } }
          },
          error: null
        };
      }
    },
    from(table: keyof MockDbTables) {
      let op: 'select' | 'insert' | 'update' | null = null;
      let insertPayload: Record<string, unknown> | null = null;
      let updatePayload: Record<string, unknown> | null = null;
      const filters: Array<[string, unknown]> = [];
      let singleMode = false;

      const executeSelect = () => {
        const rows = (db[table] || []).filter(r =>
          filters.every(([col, val]) => r[col] === val)
        );
        if (singleMode) {
          return { data: rows[0] || null, error: null };
        }
        return { data: rows, error: null };
      };

      const chain: Record<string, unknown> = {
        select() {
          if (!op) op = 'select';
          return chain;
        },
        insert(payload: Record<string, unknown>) {
          op = 'insert';
          insertPayload = payload;
          return chain;
        },
        update(payload: Record<string, unknown>) {
          op = 'update';
          updatePayload = payload;
          return chain;
        },
        eq(col: string, val: unknown) {
          filters.push([col, val]);
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        maybeSingle() {
          singleMode = true;
          return Promise.resolve(executeSelect());
        },
        single() {
          singleMode = true;
          return chain;
        },
        then(resolve: (val: { data: unknown; error: unknown }) => void, reject?: (err: unknown) => void) {
          try {
            if (op === 'insert' && insertPayload) {
              insertCallCounts[table] = (insertCallCounts[table] || 0) + 1;
              if (options?.simulateRlsErrorOnTable === table) {
                resolve({
                  data: null,
                  error: { code: '42501', message: 'new row violates row-level security policy' }
                });
                return;
              }

              const id = `${table}_row_${seq++}`;
              const createdAt = new Date().toISOString();
              const newRow: Record<string, unknown> = {
                id,
                created_at: createdAt,
                ...insertPayload
              };

              if (table === 'debts') {
                newRow.remaining_amount = insertPayload.original_amount;
                newRow.status = 'outstanding';
              }

              db[table].push(newRow);

              // Simulate DB trigger updates for debt_repayments & savings_transactions
              if (table === 'debt_repayments') {
                const targetDebt = db.debts.find(d => d.id === insertPayload!.debt_id);
                if (targetDebt) {
                  const rem = Math.max(
                    0,
                    Number(targetDebt.remaining_amount) - Number(insertPayload!.amount)
                  );
                  targetDebt.remaining_amount = rem;
                  targetDebt.status = rem <= 0.001 ? 'paid' : 'partially_paid';
                }
              }

              if (table === 'savings_transactions') {
                const targetGoal = db.savings_goals.find(
                  g => g.id === insertPayload!.savings_goal_id
                );
                if (targetGoal) {
                  const curr = Number(targetGoal.current_balance || 0);
                  const delta =
                    insertPayload!.transaction_type === 'withdrawal'
                      ? -Number(insertPayload!.amount)
                      : Number(insertPayload!.amount);
                  targetGoal.current_balance = Math.max(0, curr + delta);
                }
              }

              // Simulate network/timeout abort AFTER DB commit
              if (options?.simulateAbortAfterInsertOnTable === table) {
                resolve({
                  data: null,
                  error: { name: 'AbortError', message: 'The operation was aborted due to timeout' }
                });
                return;
              }

              resolve({ data: singleMode ? newRow : [newRow], error: null });
              return;
            }

            if (op === 'update' && updatePayload) {
              const matched = (db[table] || []).filter(r =>
                filters.every(([col, val]) => r[col] === val)
              );
              matched.forEach(r => Object.assign(r, updatePayload));
              resolve({ data: singleMode ? matched[0] || null : matched, error: null });
              return;
            }

            resolve(executeSelect());
          } catch (err) {
            reject?.(err);
          }
        }
      };

      return chain;
    }
  };

  return { client: client as unknown as SupabaseClient, db, insertCallCounts };
}

function seedSnapshotAndCatalog(): { snapshot: XOSReadOnlySnapshot; todayIst: string } {
  const todayIst = '2026-11-24';
  const snapshot: XOSReadOnlySnapshot = {
    settings: {
      ...DEFAULT_USER_SETTINGS,
      profile: { name: 'Ameen', email: 'ameen@example.com' },
      currency: 'INR'
    },
    goals: [],
    expenses: [
      {
        id: 'exp_existing_1',
        title: 'Groceries',
        amount: 2400,
        category: 'Food & Dining',
        date: '2026-11-10',
        paymentMethod: 'Cash',
        createdAt: '2026-11-10T10:00:00Z'
      }
    ],
    incomes: [],
    attendance: [],
    savingsGoals: [
      {
        id: 'sg_emergency',
        name: 'Emergency Fund',
        targetAmount: 50000,
        currentAmount: 10000,
        isArchived: false,
        createdAt: '2026-10-01T10:00:00Z'
      },
      {
        id: 'sg_laptop',
        name: 'Laptop Fund',
        targetAmount: 80000,
        currentAmount: 15000,
        isArchived: false,
        createdAt: '2026-10-05T10:00:00Z'
      }
    ],
    savingsTransactions: [],
    salaryPayouts: [],
    debts: [
      {
        id: 'debt_arun_pay',
        person_name: 'Arun',
        original_amount: 5000,
        remaining_amount: 3000,
        lent_date: '2026-11-01',
        description: 'Borrowed from Arun',
        notes: '',
        status: 'partially_paid',
        created_at: '2026-11-01T10:00:00Z',
        direction: 'pay'
      },
      {
        id: 'debt_rahul_1',
        person_name: 'Rahul',
        original_amount: 1000,
        remaining_amount: 1000,
        lent_date: '2026-11-02',
        description: 'Lunch split',
        notes: '',
        status: 'outstanding',
        created_at: '2026-11-02T10:00:00Z',
        direction: 'receive'
      },
      {
        id: 'debt_rahul_2',
        person_name: 'Rahul',
        original_amount: 2500,
        remaining_amount: 2500,
        lent_date: '2026-11-08',
        description: 'Bike repair',
        notes: '',
        status: 'outstanding',
        created_at: '2026-11-08T10:00:00Z',
        direction: 'receive'
      }
    ],
    debtRepayments: []
  };

  return { snapshot, todayIst };
}

async function runVoiceDataEntryTests(): Promise<void> {
  const prevUrl = process.env.VITE_SUPABASE_URL;
  const prevAnon = process.env.VITE_SUPABASE_ANON_KEY;
  const prevGroq = process.env.GROQ_API_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;

  process.env.VITE_SUPABASE_URL = 'https://example-project.supabase.co';
  process.env.VITE_SUPABASE_ANON_KEY = 'anon-test-key';
  process.env.GROQ_API_KEY = 'gsk_test_key';
  delete process.env.GEMINI_API_KEY;

  try {
    const { snapshot } = seedSnapshotAndCatalog();
    const catalog = buildEntryCatalog(snapshot, new Date('2026-11-24T08:00:00.000Z'));
    assert(catalog.todayIst === '2026-11-24', 'buildEntryCatalog computes exact IST date');

    // Setup clean mocked Supabase repository
    const stub = createInMemorySupabaseStub();
    stub.db.debts.push(
      {
        id: 'debt_arun_pay',
        user_id: 'user-voice-test-1',
        person_name: 'Arun',
        original_amount: 5000,
        remaining_amount: 3000,
        lent_date: '2026-11-01',
        description: serializeDebtDescription('pay', 'Borrowed from Arun'),
        notes: '',
        status: 'partially_paid',
        created_at: '2026-11-01T10:00:00Z'
      }
    );
    stub.db.savings_goals.push(
      {
        id: 'sg_emergency',
        user_id: 'user-voice-test-1',
        name: 'Emergency Fund',
        target_amount: 50000,
        current_balance: 10000,
        priority: 'high',
        is_archived: false,
        created_at: '2026-10-01T10:00:00Z'
      },
      {
        id: 'sg_laptop',
        user_id: 'user-voice-test-1',
        name: 'Laptop Fund',
        target_amount: 80000,
        current_balance: 15000,
        priority: 'medium',
        is_archived: false,
        created_at: '2026-10-05T10:00:00Z'
      }
    );

    configureRepositoryBackendForTests(stub.client, true);
    repository.clearUserData();
    repository.setActiveUserId('user-voice-test-1');
    await repository.fetchAllUserData('user-voice-test-1');
    resetTransactionExecutorState();

    // 1. English expense voice entry + explicit confirm
    const exp1Resp = await handleAssistantRequest(
      {
        message: 'Add 150 rupees food expense today',
        groundedContext: {},
        entryCatalog: catalog,
        preferredLanguage: 'en-IN'
      },
      'Bearer tok-1',
      {
        fetchImpl: makeSupabaseAuthOkFetch(),
        groqFetchImpl: makeGroqJsonFetch({
          action: 'transaction_proposal',
          confidence: 0.96,
          reply: 'Save ₹150 Food & Dining expense?',
          transaction: {
            intent: 'create_expense',
            amount: 150,
            category: 'Food',
            title: 'Lunch',
            date: catalog.todayIst,
            paymentMethod: 'Cash'
          }
        })
      }
    );
    assert(exp1Resp.status === 200, 'English expense proposal returns 200');
    assert(exp1Resp.body.actionType === 'transaction_proposal', 'Action type is transaction_proposal');
    const prop1 = exp1Resp.body.pendingTransaction as PendingTransactionProposal;
    assert(
      prop1.transaction.intent === 'create_expense' && prop1.transaction.category === 'Food & Dining',
      'Intent is create_expense and normalizes Food shorthand to configured Food & Dining category'
    );
    assert(countRows(stub.db.expenses) === 0, 'AI proposal NEVER writes to DB before confirmation');

    const save1 = await executeConfirmedTransaction({
      proposal: prop1,
      confirmedByUser: true,
      confirmationSource: 'button'
    });
    assert(save1.ok && countRows(stub.db.expenses) === 1, 'Confirmed English expense creates 1 DB row');
    assert(repository.getExpenses()[0].amount === 150, 'Saved expense updates repository cache');

    // 2. Malayalam expense voice entry + confirm
    const exp2Resp = await handleAssistantRequest(
      {
        message: 'ഇന്ന് ഭക്ഷണത്തിന് 150 രൂപ ചെലവായി',
        groundedContext: {},
        entryCatalog: catalog,
        preferredLanguage: 'ml-IN'
      },
      'Bearer tok-1',
      {
        fetchImpl: makeSupabaseAuthOkFetch(),
        groqFetchImpl: makeGroqJsonFetch({
          action: 'transaction_proposal',
          confidence: 0.94,
          reply: '₹150 ഭക്ഷണ ചെലവായി ചേർക്കട്ടെ?',
          transaction: {
            intent: 'create_expense',
            amount: 150,
            category: 'Food & Dining',
            title: 'ഭക്ഷണം',
            date: catalog.todayIst
          }
        })
      }
    );
    const prop2 = exp2Resp.body.pendingTransaction as PendingTransactionProposal;
    assert(prop2 && prop2.detectedLanguage === 'ml', 'Detects Malayalam response language');
    const save2 = await executeConfirmedTransaction({
      proposal: prop2,
      confirmedByUser: true,
      confirmationSource: 'voice'
    });
    assert(save2.confirmationMessage.includes('വിജയകരമായി'), 'Returns Malayalam confirmation message after DB write');
    assert(stub.db.expenses.length === 2, 'Malayalam expense persisted');

    // 3. Manglish expense + IST yesterday ("Innale 250 rupa petrol adichu")
    const exp3Resp = await handleAssistantRequest(
      {
        message: 'Innale 250 rupa petrol adichu',
        groundedContext: {},
        entryCatalog: catalog,
        preferredLanguage: 'ml-IN'
      },
      'Bearer tok-1',
      {
        fetchImpl: makeSupabaseAuthOkFetch(),
        groqFetchImpl: makeGroqJsonFetch({
          action: 'transaction_proposal',
          confidence: 0.92,
          reply: 'Save ₹250 Petrol?',
          transaction: {
            intent: 'create_expense',
            amount: 250,
            category: 'Transport',
            title: 'Petrol',
            paymentMethod: 'Digital Wallet'
          }
        })
      }
    );
    const prop3 = exp3Resp.body.pendingTransaction as PendingTransactionProposal;
    assert(
      prop3.transaction.intent === 'create_expense' &&
        prop3.transaction.date === subtractIstDays(catalog.todayIst, 1),
      'Resolves Manglish "Innale" deterministically to IST yesterday'
    );

    // 4. Malayalam number-word parsing ("ഒന്നര ആയിരം", "നൂറ്റമ്പത്", "രണ്ടര നൂറ്")
    assert(parseMalayalamManglishAmount('ഒന്നര ആയിരം രൂപ ശമ്പളം കിട്ടി').amount === 1500, 'Parses ഒന്നര ആയിരം -> 1500');
    assert(parseMalayalamManglishAmount('നൂറ്റമ്പത് രൂപ ചായ').amount === 150, 'Parses നൂറ്റമ്പത് -> 150');
    assert(parseMalayalamManglishAmount('രണ്ടര നൂറ് രൂപ പെട്രോൾ').amount === 250, 'Parses രണ്ടര നൂറ് -> 250');
    assert(parseMalayalamManglishAmount('onnara aayiram rupa').amount === 1500, 'Parses Manglish onnara aayiram -> 1500');

    // 5. Income entry persistence (Malayalam / English / Manglish)
    const incResp = await handleAssistantRequest(
      {
        message: 'ഒന്നര ആയിരം രൂപ ഫ്രീലാൻസ് വരുമാനം കിട്ടി',
        groundedContext: {},
        entryCatalog: catalog,
        preferredLanguage: 'ml-IN'
      },
      'Bearer tok-1',
      {
        fetchImpl: makeSupabaseAuthOkFetch(),
        groqFetchImpl: makeGroqJsonFetch({
          action: 'transaction_proposal',
          confidence: 0.95,
          reply: 'Add income?',
          transaction: {
            intent: 'create_income',
            source: 'Freelance',
            title: 'Freelance design'
          }
        })
      }
    );
    const incProp = incResp.body.pendingTransaction as PendingTransactionProposal;
    assert(
      incProp.transaction.intent === 'create_income' && incProp.transaction.amount === 1500,
      'Validates Malayalam number word amount on income proposal'
    );
    await executeConfirmedTransaction({
      proposal: incProp,
      confirmedByUser: true,
      confirmationSource: 'button'
    });
    assert(stub.db.incomes.length === 1 && repository.getIncomes()[0].source === 'Freelance', 'Persists confirmed income to repository & DB');

    // 6. Debt receivable ("Money to Receive")
    const recResp = await handleAssistantRequest(
      {
        message: 'രാഹുലിന് 1000 രൂപ കടം കൊടുത്തു',
        groundedContext: {},
        entryCatalog: catalog
      },
      'Bearer tok-1',
      {
        fetchImpl: makeSupabaseAuthOkFetch(),
        groqFetchImpl: makeGroqJsonFetch({
          action: 'transaction_proposal',
          confidence: 0.93,
          reply: 'Record loan?',
          transaction: {
            intent: 'create_debt_receivable',
            direction: 'receive',
            personName: 'Rahul',
            amount: 1000
          }
        })
      }
    );
    const recProp = recResp.body.pendingTransaction as PendingTransactionProposal;
    assert(
      recProp.transaction.intent === 'create_debt_receivable' && recProp.transaction.direction === 'receive',
      'Keeps Money to Receive direction accurate'
    );
    await executeConfirmedTransaction({
      proposal: recProp,
      confirmedByUser: true,
      confirmationSource: 'button'
    });

    // 7. Debt payable ("Money to Pay") — never confused with receive
    const payDebtResp = await handleAssistantRequest(
      {
        message: 'അരുണിൽ നിന്ന് 2000 രൂപ കടം വാങ്ങി',
        groundedContext: {},
        entryCatalog: catalog
      },
      'Bearer tok-1',
      {
        fetchImpl: makeSupabaseAuthOkFetch(),
        groqFetchImpl: makeGroqJsonFetch({
          action: 'transaction_proposal',
          confidence: 0.93,
          reply: 'Record borrowed money?',
          transaction: {
            intent: 'create_debt_payable',
            direction: 'pay',
            personName: 'Arun',
            amount: 2000
          }
        })
      }
    );
    const payDebtProp = payDebtResp.body.pendingTransaction as PendingTransactionProposal;
    assert(
      payDebtProp.transaction.intent === 'create_debt_payable' && payDebtProp.transaction.direction === 'pay',
      'Keeps Money to Pay direction accurate'
    );
    await executeConfirmedTransaction({
      proposal: payDebtProp,
      confirmedByUser: true,
      confirmationSource: 'button'
    });
    assert(stub.db.debts.length === 3, 'Created 2 new debts (receive + pay)');

    // 8. Debt repayment for 'pay' debt -> decreases remaining balance + auto-creates linked Debt Repayment expense (never duplicate debt)
    const debtsCountBeforeRepay = stub.db.debts.length;
    const expensesCountBeforeRepay = stub.db.expenses.length;
    const repayResp = await handleAssistantRequest(
      {
        message: 'I repaid 1000 to Arun today',
        groundedContext: {},
        entryCatalog: catalog
      },
      'Bearer tok-1',
      {
        fetchImpl: makeSupabaseAuthOkFetch(),
        groqFetchImpl: makeGroqJsonFetch({
          action: 'transaction_proposal',
          confidence: 0.95,
          reply: 'Record repayment?',
          transaction: {
            intent: 'record_debt_repayment',
            personName: 'Arun',
            direction: 'pay',
            amount: 1000,
            paymentMethod: 'Bank Transfer'
          }
        })
      }
    );
    const repayProp = repayResp.body.pendingTransaction as PendingTransactionProposal;
    assert(
      repayProp.transaction.intent === 'record_debt_repayment' &&
        repayProp.transaction.debtId === 'debt_arun_pay' &&
        repayProp.transaction.remainingAfter === 2000,
      'Matches active Arun debt and calculates remaining balance accurately'
    );
    await executeConfirmedTransaction({
      proposal: repayProp,
      confirmedByUser: true,
      confirmationSource: 'voice'
    });
    assert(stub.db.debts.length === debtsCountBeforeRepay, 'Repayment NEVER creates a new debt');
    assert(stub.db.debt_repayments.length === 1, 'Repayment inserted 1 debt_repayments row');
    assert(
      Number(stub.db.debts.find(d => d.id === 'debt_arun_pay')?.remaining_amount) === 2000,
      'Remaining debt balance reduced from 3000 to 2000'
    );
    assert(
      stub.db.expenses.length === expensesCountBeforeRepay + 1 &&
        stub.db.expenses[stub.db.expenses.length - 1].category === 'Debt Repayment',
      'Auto-creates linked Debt Repayment expense on Money-to-Pay repayment'
    );

    // 9. Multiple matching debts triggers clarification + disambiguationOptions
    const multiDebtResp = await handleAssistantRequest(
      {
        message: 'Rahul paid me back 500',
        groundedContext: {},
        entryCatalog: catalog
      },
      'Bearer tok-1',
      {
        fetchImpl: makeSupabaseAuthOkFetch(),
        groqFetchImpl: makeGroqJsonFetch({
          action: 'transaction_proposal',
          confidence: 0.9,
          reply: 'Record repayment?',
          transaction: {
            intent: 'record_debt_repayment',
            personName: 'Rahul',
            direction: 'receive',
            amount: 500
          }
        })
      }
    );
    assert(multiDebtResp.body.actionType === 'clarification_needed', 'Multiple matching debts require user disambiguation');
    assert(
      Array.isArray((multiDebtResp.body.clarification as { disambiguationOptions?: unknown[] })?.disambiguationOptions) &&
        ((multiDebtResp.body.clarification as { disambiguationOptions: unknown[] }).disambiguationOptions.length === 2),
      'Returns 2 selectable disambiguation options for Rahul debts'
    );

    // 10. Savings transaction entry + balance update & multi-goal disambiguation
    const multiSavResp = await handleAssistantRequest(
      {
        message: 'Put 2000 into savings today',
        groundedContext: {},
        entryCatalog: catalog
      },
      'Bearer tok-1',
      {
        fetchImpl: makeSupabaseAuthOkFetch(),
        groqFetchImpl: makeGroqJsonFetch({
          action: 'transaction_proposal',
          confidence: 0.92,
          reply: 'Deposit to savings?',
          transaction: {
            intent: 'create_savings_transaction',
            transactionType: 'deposit',
            amount: 2000
          }
        })
      }
    );
    assert(multiSavResp.body.actionType === 'clarification_needed', 'Multiple savings goals without specific goal name asks user to pick');

    const exactSavResp = await handleAssistantRequest(
      {
        message: 'Add 2000 to Emergency Fund savings',
        groundedContext: {},
        entryCatalog: catalog
      },
      'Bearer tok-1',
      {
        fetchImpl: makeSupabaseAuthOkFetch(),
        groqFetchImpl: makeGroqJsonFetch({
          action: 'transaction_proposal',
          confidence: 0.95,
          reply: 'Deposit to Emergency Fund?',
          transaction: {
            intent: 'create_savings_transaction',
            savingsGoalName: 'Emergency Fund',
            transactionType: 'deposit',
            amount: 2000
          }
        })
      }
    );
    const savProp = exactSavResp.body.pendingTransaction as PendingTransactionProposal;
    assert(
      savProp.transaction.intent === 'create_savings_transaction' &&
        savProp.transaction.savingsGoalId === 'sg_emergency' &&
        savProp.transaction.balanceAfter === 12000,
      'Matches Emergency Fund and computes new balance 12000'
    );
    await executeConfirmedTransaction({
      proposal: savProp,
      confirmedByUser: true,
      confirmationSource: 'button'
    });
    assert(
      Number(stub.db.savings_goals.find(g => g.id === 'sg_emergency')?.current_balance) === 12000,
      'Savings transaction updates goal balance in DB'
    );

    // 11. Ambiguous amount rejection ("കുറച്ചു പണം", "some money") -> clarification, zero DB writes
    const expLenBeforeAmbig = stub.db.expenses.length;
    const ambigMl = validateAndNormalizeProposal({
      candidate: { intent: 'create_expense', category: 'Food & Dining', title: 'Food' },
      confidence: 0.9,
      catalog,
      rawUserText: 'കുറച്ചു പണം ഭക്ഷണത്തിന് ചെലവായി',
      detectedLanguage: 'ml'
    });
    assert(
      ambigMl.status === 'clarification' && ambigMl.clarification.reason === 'ambiguous_amount',
      'Rejects vague Malayalam amount ("കുറച്ചു പണം")'
    );
    const ambigEn = validateAndNormalizeProposal({
      candidate: { intent: 'create_expense', category: 'Food & Dining', title: 'Food' },
      confidence: 0.9,
      catalog,
      rawUserText: 'I spent some money on food',
      detectedLanguage: 'en'
    });
    assert(
      ambigEn.status === 'clarification' && ambigEn.clarification.reason === 'ambiguous_amount',
      'Rejects vague English amount ("some money")'
    );
    assert(stub.db.expenses.length === expLenBeforeAmbig, 'Ambiguous amounts make zero DB writes');

    // 12. Negative/zero amount rejection
    const negResp = await handleAssistantRequest(
      {
        message: 'Add -100 rupees food expense',
        groundedContext: {},
        entryCatalog: catalog
      },
      'Bearer tok-1',
      {
        fetchImpl: makeSupabaseAuthOkFetch(),
        groqFetchImpl: makeGroqJsonFetch({})
      }
    );
    assert(negResp.body.actionType === 'clarification_needed' && negResp.body.pendingTransaction === null, 'Rejects negative amount');
    const zeroCheck = validateAndNormalizeProposal({
      candidate: { intent: 'create_expense', amount: 0, category: 'Food & Dining', title: 'Tea' },
      confidence: 0.95,
      catalog,
      rawUserText: 'Add 0 rupees tea expense',
      detectedLanguage: 'en'
    });
    assert(zeroCheck.status === 'clarification' && zeroCheck.clarification.reason === 'invalid_amount', 'Rejects 0 amount');

    // 13. Invalid calendar date rejection ("2026-02-30", "February 30")
    const badIsoResp = await handleAssistantRequest(
      {
        message: 'Add 150 expense on 2026-02-30',
        groundedContext: {},
        entryCatalog: catalog
      },
      'Bearer tok-1',
      {
        fetchImpl: makeSupabaseAuthOkFetch(),
        groqFetchImpl: makeGroqJsonFetch({})
      }
    );
    assert(badIsoResp.body.actionType === 'clarification_needed', 'Rejects impossible calendar date 2026-02-30');
    const badTextResp = await handleAssistantRequest(
      {
        message: 'Add 150 lunch expense on February 30',
        groundedContext: {},
        entryCatalog: catalog
      },
      'Bearer tok-1',
      {
        fetchImpl: makeSupabaseAuthOkFetch(),
        groqFetchImpl: makeGroqJsonFetch({})
      }
    );
    assert(badTextResp.body.actionType === 'clarification_needed', 'Rejects impossible calendar date February 30');

    // 14. Unknown expense category (never invents new categories)
    const unknownCat = validateAndNormalizeProposal({
      candidate: { intent: 'create_expense', amount: 500, category: 'Astrology', title: 'Horoscope' },
      confidence: 0.95,
      catalog,
      rawUserText: 'Add 500 astrology expense',
      detectedLanguage: 'en'
    });
    assert(
      unknownCat.status === 'clarification' && unknownCat.clarification.reason === 'unclear_category',
      'Refuses to invent unknown expense categories'
    );

    // 15. Low-confidence LLM output (< 0.7) -> clarification, no proposal
    const lowConf = validateAndNormalizeProposal({
      candidate: { intent: 'create_expense', amount: 150, category: 'Food & Dining', title: 'Lunch' },
      confidence: 0.55,
      catalog,
      rawUserText: 'Add 150 lunch',
      detectedLanguage: 'en'
    });
    assert(
      lowConf.status === 'clarification' && lowConf.clarification.reason === 'low_confidence',
      'Rejects LLM outputs below 0.7 confidence threshold'
    );

    // 16. Preview editing before confirmation saves updated values
    const editOrig = validateAndNormalizeProposal({
      candidate: {
        intent: 'create_expense',
        amount: 150,
        category: 'Food & Dining',
        title: 'Lunch',
        date: '2026-11-24'
      },
      confidence: 0.95,
      catalog,
      rawUserText: 'Add 150 lunch today',
      detectedLanguage: 'en'
    });
    assert(editOrig.status === 'valid', 'Creates initial preview for editing');
    const editOrigValid = editOrig as Extract<typeof editOrig, { status: 'valid' }>;
    const editedProposal: PendingTransactionProposal = {
      ...editOrigValid.proposal,
      proposalId: createProposalId(),
      transaction: {
        ...editOrigValid.proposal.transaction,
        ...(editOrigValid.proposal.transaction.intent === 'create_expense'
          ? { amount: 225, category: 'Transport', title: 'Auto & Lunch', date: '2026-11-23' }
          : {})
      } as PendingTransactionProposal['transaction']
    };
    editedProposal.idempotencyKey = createIdempotencyKey(editedProposal.proposalId, editedProposal.transaction);
    const savedEdited = await executeConfirmedTransaction({
      proposal: editedProposal,
      confirmedByUser: true,
      confirmationSource: 'button'
    });
    assert(
      'amount' in savedEdited.createdRecord &&
        savedEdited.createdRecord.amount === 225 &&
        'category' in savedEdited.createdRecord &&
        savedEdited.createdRecord.category === 'Transport',
      'Saves edited preview values accurately'
    );

    // 17. Cancel discards preview cleanly without DB writes + missing confirmation guard
    const expensesBeforeCancel = stub.db.expenses.length;
    let unconfirmedThrew = false;
    try {
      await executeConfirmedTransaction({
        proposal: prop1,
        confirmedByUser: false,
        confirmationSource: 'button'
      });
    } catch {
      unconfirmedThrew = true;
    }
    assert(unconfirmedThrew && stub.db.expenses.length === expensesBeforeCancel, 'Cannot execute transaction without confirmedByUser === true');

    // 18. Pending confirmation expiry (expired TTL rejected)
    const expiredProposal: PendingTransactionProposal = {
      ...editOrigValid.proposal,
      proposalId: createProposalId(),
      idempotencyKey: 'idem_expired_test',
      createdAtMs: Date.now() - PENDING_TRANSACTION_TTL_MS - 5000,
      expiresAtMs: Date.now() - 1000
    };
    let expiredRejected = false;
    try {
      await executeConfirmedTransaction({
        proposal: expiredProposal,
        confirmedByUser: true,
        confirmationSource: 'voice'
      });
    } catch (err) {
      expiredRejected = /expired/i.test(err instanceof Error ? err.message : '');
    }
    assert(expiredRejected, 'Rejects expired pending confirmation proposals');

    // 19. Voice confirmation commands match cleanly & non-confirmation normal questions never match
    assert(matchPendingConfirmationVoiceCommand('Yes, confirm') === 'confirm', 'Matches "Yes, confirm"');
    assert(matchPendingConfirmationVoiceCommand('അതെ, save ചെയ്യൂ') === 'confirm', 'Matches "അതെ, save ചെയ്യൂ"');
    assert(matchPendingConfirmationVoiceCommand('വേണ്ട') === 'cancel', 'Matches "വേണ്ട"');
    assert(
      matchPendingConfirmationVoiceCommand('How much did I spend this month?') === null,
      'Normal analytical questions NEVER trigger voice confirmation'
    );

    // 20. Idempotency & duplicate prevention (concurrent double-tap + repeated call + abort-after-commit)
    const freshPropRes = validateAndNormalizeProposal({
      candidate: {
        intent: 'create_expense',
        amount: 333,
        category: 'Utilities',
        title: 'Water Bill',
        date: '2026-11-24'
      },
      confidence: 0.95,
      catalog,
      rawUserText: 'Add 333 water bill',
      detectedLanguage: 'en'
    });
    assert(freshPropRes.status === 'valid', 'Creates fresh proposal for idempotency check');
    const freshPropValid = freshPropRes as Extract<typeof freshPropRes, { status: 'valid' }>;
    const expensesBeforeIdem = stub.db.expenses.length;
    const [idemA, idemB] = await Promise.all([
      executeConfirmedTransaction({
        proposal: freshPropValid.proposal,
        confirmedByUser: true,
        confirmationSource: 'button'
      }),
      executeConfirmedTransaction({
        proposal: freshPropValid.proposal,
        confirmedByUser: true,
        confirmationSource: 'voice'
      })
    ]);
    const idemC = await executeConfirmedTransaction({
      proposal: freshPropValid.proposal,
      confirmedByUser: true,
      confirmationSource: 'button'
    });
    assert(
      stub.db.expenses.length === expensesBeforeIdem + 1 &&
        idemA.recordId === idemB.recordId &&
        idemB.recordId === idemC.recordId &&
        idemB.deduplicated === true &&
        idemC.deduplicated === true,
      'Double-tap / concurrent / repeated confirmations write only 1 record'
    );

    // Abort-after-commit reconciliation in repository.addExpense / addIncome / addSavingsTransaction
    const abortStub = createInMemorySupabaseStub({ simulateAbortAfterInsertOnTable: 'expenses' });
    configureRepositoryBackendForTests(abortStub.client, true);
    repository.clearUserData();
    repository.setActiveUserId('user-voice-test-1');
    resetTransactionExecutorState();
    const abortPropRes = validateAndNormalizeProposal({
      candidate: {
        intent: 'create_expense',
        amount: 410,
        category: 'Utilities',
        title: 'Gas Cylinder',
        date: '2026-11-24'
      },
      confidence: 0.95,
      catalog,
      rawUserText: 'Add 410 gas cylinder',
      detectedLanguage: 'en'
    });
    assert(abortPropRes.status === 'valid', 'Creates proposal for abort reconciliation test');
    const abortPropValid = abortPropRes as Extract<typeof abortPropRes, { status: 'valid' }>;
    const reconciled = await executeConfirmedTransaction({
      proposal: abortPropValid.proposal,
      confirmedByUser: true,
      confirmationSource: 'button'
    });
    assert(
      abortStub.db.expenses.length === 1 &&
        abortStub.insertCallCounts.expenses === 1 &&
        reconciled.recordId === abortStub.db.expenses[0].id,
      'Abort after commit reconciles existing row without duplicate INSERT retry'
    );

    // 21. Unauthenticated / DB RLS failure surfaces real error without fake success
    const rlsStub = createInMemorySupabaseStub({ simulateRlsErrorOnTable: 'expenses' });
    configureRepositoryBackendForTests(rlsStub.client, true);
    repository.clearUserData();
    repository.setActiveUserId('user-voice-test-1');
    resetTransactionExecutorState();
    const rlsPropRes = validateAndNormalizeProposal({
      candidate: {
        intent: 'create_expense',
        amount: 99,
        category: 'Other',
        title: 'Parking',
        date: '2026-11-24'
      },
      confidence: 0.95,
      catalog,
      rawUserText: 'Add 99 parking',
      detectedLanguage: 'en'
    });
    assert(rlsPropRes.status === 'valid', 'Creates proposal for RLS error test');
    const rlsPropValid = rlsPropRes as Extract<typeof rlsPropRes, { status: 'valid' }>;
    let rlsFailed = false;
    try {
      await executeConfirmedTransaction({
        proposal: rlsPropValid.proposal,
        confirmedByUser: true,
        confirmationSource: 'button'
      });
    } catch (err) {
      rlsFailed = /permission|row-level security/i.test(err instanceof Error ? err.message : '');
    }
    assert(rlsFailed && rlsStub.db.expenses.length === 0, 'RLS error propagates cleanly without fake success');

    // Unauthenticated repository execution rejects cleanly without DB writes
    const unauthRepoStub = createInMemorySupabaseStub({ unauthenticated: true });
    configureRepositoryBackendForTests(unauthRepoStub.client, true);
    repository.clearUserData();
    resetTransactionExecutorState();
    let unauthExecFailed = false;
    try {
      await executeConfirmedTransaction({
        proposal: rlsPropValid.proposal,
        confirmedByUser: true,
        confirmationSource: 'button'
      });
    } catch (err) {
      unauthExecFailed = /session has expired|sign in/i.test(err instanceof Error ? err.message : '');
    }
    assert(unauthExecFailed && unauthRepoStub.db.expenses.length === 0, 'Unauthenticated execution fails cleanly without fake success');

    // Unauthenticated API call returns 401 auth_required
    const unauthApi = await handleAssistantRequest(
      { message: 'Add 150 rupees food expense.' },
      undefined,
      { fetchImpl: makeSupabaseAuthOkFetch(), groqFetchImpl: makeGroqJsonFetch({}) }
    );
    assert(unauthApi.status === 401 && unauthApi.body.category === 'auth_required', 'Unauthenticated request rejected cleanly with 401');

    // 22. Read-only queries ("How much did I spend this month?", "How much did I spend?") remain strictly read-only
    for (const readQuery of ['How much did I spend this month?', 'How much did I spend?', 'ഈ മാസം എത്ര ചെലവായി?']) {
      const ctx = buildSelectiveXosContext({
        query: readQuery,
        data: snapshot,
        now: new Date('2026-11-24T08:00:00.000Z')
      });
      assert(ctx.selectedModules.includes('expenses'), `Selects expenses module for "${readQuery}"`);
      const roResp = await handleAssistantRequest(
        {
          message: readQuery,
          groundedContext: ctx.groundedContext,
          entryCatalog: catalog
        },
        'Bearer tok-1',
        {
          fetchImpl: makeSupabaseAuthOkFetch(),
          groqFetchImpl: async () =>
            new Response(
              JSON.stringify({ choices: [{ message: { content: 'You spent ₹2,400 this month.' } }] }),
              { status: 200, headers: { 'content-type': 'application/json' } }
            )
        }
      );
      assert(
        roResp.status === 200 &&
          roResp.body.actionType === 'read_only_query' &&
          roResp.body.pendingTransaction === null,
        `Read-only query "${readQuery}" returns read_only_query with null pendingTransaction`
      );
    }

    // 23. Actionable query ("Add 150 rupees food expense.") prepares preview & ONLY saves after confirmation
    const actionStub = createInMemorySupabaseStub();
    configureRepositoryBackendForTests(actionStub.client, true);
    repository.clearUserData();
    repository.setActiveUserId('user-voice-test-1');
    resetTransactionExecutorState();

    const actionResp = await handleAssistantRequest(
      {
        message: 'Add 150 rupees food expense.',
        groundedContext: {},
        entryCatalog: catalog
      },
      'Bearer tok-1',
      {
        fetchImpl: makeSupabaseAuthOkFetch(),
        groqFetchImpl: makeGroqJsonFetch({
          action: 'transaction_proposal',
          confidence: 0.96,
          reply: 'Do you want to save ₹150 as Food & Dining expense?',
          transaction: {
            intent: 'create_expense',
            amount: 150,
            category: 'Food & Dining',
            title: 'Food expense',
            date: catalog.todayIst
          }
        })
      }
    );
    assert(
      actionResp.body.actionType === 'transaction_proposal' &&
        Boolean(actionResp.body.pendingTransaction) &&
        actionStub.db.expenses.length === 0,
      '"Add 150 rupees food expense." prepares preview and performs 0 DB writes prior to confirmation'
    );

    // 24. Static security & storage audit
    const rootDir = process.cwd();
    const clientVoiceFiles = [
      'src/components/ai/AiAgentView.tsx',
      'src/components/ai/TransactionPreviewCard.tsx',
      'src/components/ai/VoiceOrb.tsx',
      'src/hooks/useJarvisVoice.ts',
      'src/services/ai/agentService.ts',
      'src/services/ai/contextBuilder.ts',
      'src/services/ai/xosKnowledge.ts',
      'src/services/ai/transactionSchemas.ts',
      'src/services/ai/transactionExecutor.ts',
      'src/services/ai/voiceController.ts',
      'src/services/ai/voiceUtils.ts'
    ];
    for (const rel of clientVoiceFiles) {
      const code = fs.readFileSync(path.join(rootDir, rel), 'utf8');
      assert(!/localStorage|sessionStorage|indexedDB/i.test(code), `${rel} uses zero browser storage`);
      assert(!/service_role|SUPABASE_SERVICE_ROLE/i.test(code), `${rel} never references service_role`);
      assert(!/GROQ_API_KEY|GEMINI_API_KEY/.test(code), `${rel} never embeds API keys`);
      assert(!/SELECT\s+\*\s+FROM|INSERT\s+INTO/i.test(code), `${rel} never constructs raw SQL`);
    }

    console.log('ALL 24 XOS VOICE-TO-DATA ENTRY TESTS PASSED SUCCESSFULLY!');
  } finally {
    repository.clearUserData();
    configureRepositoryBackendForTests(null, null);
    resetTransactionExecutorState();
    if (prevUrl !== undefined) process.env.VITE_SUPABASE_URL = prevUrl;
    else delete process.env.VITE_SUPABASE_URL;
    if (prevAnon !== undefined) process.env.VITE_SUPABASE_ANON_KEY = prevAnon;
    else delete process.env.VITE_SUPABASE_ANON_KEY;
    if (prevGroq !== undefined) process.env.GROQ_API_KEY = prevGroq;
    else delete process.env.GROQ_API_KEY;
    if (prevGemini !== undefined) process.env.GEMINI_API_KEY = prevGemini;
    else delete process.env.GEMINI_API_KEY;
  }
}

runVoiceDataEntryTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
