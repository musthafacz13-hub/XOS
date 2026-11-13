/**
 * XOS Mocked-Supabase Persistence, Verified Live Schema, Auth Isolation & Calculation Test Suite
 *
 * Covers:
 *  1. Failed inserts across tables reject cleanly & never mutate state or emit fake IDs
 *  2. Failed updates across tables reject cleanly & preserve original state
 *  3. Failed deletes (DB errors and 0 affected rows) reject cleanly & retain records
 *  4. RPC salary payouts (xos_record_salary_payout & xos_delete_salary_payout), duplicate guard, & replace
 *  5. Receivables over-repayment guard & DB trigger remaining_amount + status reconciliation ('outstanding' | 'partially_paid' | 'paid')
 *  6. Savings over-withdrawal guard, trigger current_balance read/delete reconciliation, & initial deposit rollback
 *  7. Partial failure resilience in fetchAllUserData preserving valid state + recording errors
 *  8. User switching & stale response discard (User A in-flight discarded after User B enters)
 *  9. Sequence / clearAllData race guards canceling in-flight hydration
 * 10. Sign-out full state clearing across all collections + activeUserId
 * 11. Calendar date parsing (YYYY-MM-DD, leap day, invalid calendar dates) without UTC shift
 * 12. Month boundary filtering (1st, last day, Dec->Jan transition, leap day)
 * 13. INR default currency behavior & non-overwriting preservation of saved USD/EUR
 * 14. Exact live schema column enforcement across salary_configs, user_settings, profiles, goals, expenses, incomes, attendance_records
 * 15. persistSettingsBundle multi-table persistence (including non-fatal missing profile row)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { repository, configureRepositoryBackendForTests } from '../services/repository';
import { parseCalendarDate, formatDate, formatHumanDate } from '../utils/formatters';
import { filterRecordsByDateRange } from '../utils/calculations';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

type OpType = 'select' | 'insert' | 'update' | 'delete' | 'upsert';

interface QueryContext {
  table: string;
  op: OpType;
  selectColumns?: string;
  payload?: any;
  filters: Array<{ col: string; val: any }>;
  singleMode: 'none' | 'single' | 'maybeSingle';
  upsertOptions?: any;
}

type TableHandler = (ctx: QueryContext) => Promise<{ data: any; error: any }> | { data: any; error: any };
type RpcHandler = (fn: string, args: Record<string, any>) => Promise<{ data: any; error: any }> | { data: any; error: any };

function createMockSupabase(
  sessionUserId: string | null,
  handlers: Record<string, TableHandler>,
  rpcHandler?: RpcHandler
): SupabaseClient {
  let currentUserId = sessionUserId;

  const client: any = {
    __setSessionUserId(uid: string | null) {
      currentUserId = uid;
    },
    auth: {
      async getSession() {
        return {
          data: {
            session: currentUserId ? { user: { id: currentUserId, email: `${currentUserId}@test.local` } } : null
          },
          error: null
        };
      }
    },
    async rpc(fn: string, args: Record<string, any> = {}) {
      if (!rpcHandler) {
        return { data: null, error: { message: `Unhandled RPC ${fn}` } };
      }
      return await rpcHandler(fn, args);
    },
    from(table: string) {
      const ctx: QueryContext = {
        table,
        op: 'select',
        filters: [],
        singleMode: 'none'
      };

      const execute = async () => {
        const handler = handlers[table];
        if (!handler) {
          return { data: ctx.singleMode === 'none' ? [] : null, error: null };
        }
        return await handler(ctx);
      };

      const builder: any = {
        select(cols?: string) {
          if (cols !== undefined) ctx.selectColumns = cols;
          return builder;
        },
        insert(payload: any) {
          ctx.op = 'insert';
          ctx.payload = payload;
          return builder;
        },
        update(payload: any) {
          ctx.op = 'update';
          ctx.payload = payload;
          return builder;
        },
        delete() {
          ctx.op = 'delete';
          return builder;
        },
        upsert(payload: any, opts?: any) {
          ctx.op = 'upsert';
          ctx.payload = payload;
          ctx.upsertOptions = opts;
          return builder;
        },
        eq(col: string, val: any) {
          ctx.filters.push({ col, val });
          return builder;
        },
        order() {
          return builder;
        },
        single() {
          ctx.singleMode = 'single';
          return builder;
        },
        maybeSingle() {
          ctx.singleMode = 'maybeSingle';
          return builder;
        },
        then(onFulfilled: any, onRejected: any) {
          return execute().then(onFulfilled, onRejected);
        }
      };

      return builder;
    }
  };

  return client as SupabaseClient;
}

const UUID_1 = '11111111-1111-4111-8111-111111111111';
const UUID_2 = '22222222-2222-4222-8222-222222222222';
const UUID_3 = '33333333-3333-4333-8333-333333333333';
const UUID_4 = '44444444-4444-4444-8444-444444444444';
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function runPersistenceTests() {
  console.log('--- Running XOS Mocked-Supabase Persistence & Live Schema Test Suite ---');

  try {
    // =========================================================================
    // TEST 1: Failed Insert — rejects, keeps state clean, never uses fake IDs
    // =========================================================================
    console.log('Test 1: Failed inserts across tables reject cleanly...');
    {
      const failAllClient = createMockSupabase(USER_A, {
        expenses: () => ({ data: null, error: { message: 'RLS denied insert on expenses' } }),
        debts: () => ({ data: null, error: { message: 'RLS denied insert on debts' } }),
        savings_goals: () => ({ data: null, error: { message: 'DB timeout on savings_goals' } }),
        attendance_records: () => ({ data: null, error: { message: 'Constraint violation on attendance' } }),
        goals: () => ({ data: null, error: { message: 'Insert rejected on goals' } })
      });

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(failAllClient, true);

      const cases: Array<() => Promise<any>> = [
        () => repository.addExpense({ title: 'Coffee', amount: 150, category: 'Food', date: '2026-05-01', paymentMethod: 'Cash' }),
        () => repository.addDebt({ person_name: 'Sam', original_amount: 1000, lent_date: '2026-05-01' }),
        () => repository.addSavingsGoal({ name: 'Trip', targetAmount: 50000, initialDeposit: 0, initialDepositDate: '2026-05-01' }),
        () => repository.upsertAttendanceRecord({ date: '2026-05-01', status: 'Present', calculatedHours: 8 }),
        () => repository.addGoal({ title: 'Save', description: '', category: 'Financial', progressPercentage: 10, priority: 'High', status: 'In Progress' })
      ];

      for (const fn of cases) {
        let threw = false;
        try {
          await fn();
        } catch {
          threw = true;
        }
        assert(threw, 'Insert failure must throw an error instead of falling back locally');
      }

      assert(repository.getExpenses().length === 0, 'Expenses state must remain empty after failed insert');
      assert(repository.getDebts().length === 0, 'Debts state must remain empty after failed insert');
      assert(repository.getSavingsGoals().length === 0, 'Savings goals state must remain empty after failed insert');
      assert(repository.getAttendance().length === 0, 'Attendance state must remain empty after failed insert');
      assert(repository.getGoals().length === 0, 'Goals state must remain empty after failed insert');
    }
    console.log('✓ Test 1 passed.');

    // =========================================================================
    // TEST 2: Failed Update & Exact Live Columns for expenses & incomes
    // =========================================================================
    console.log('Test 2: Exact live columns on expenses/incomes & failed updates preserve state...');
    {
      let capturedExpensePayload: any = null;
      let capturedIncomePayload: any = null;

      const failUpdateClient = createMockSupabase(USER_A, {
        expenses: (ctx) => {
          if (ctx.op === 'insert') {
            capturedExpensePayload = ctx.payload;
            assert('expense_date' in ctx.payload && !('date' in ctx.payload), 'expenses MUST write expense_date, never legacy date');
            assert('recurrence_frequency' in ctx.payload && !('recurring_frequency' in ctx.payload), 'expenses MUST write recurrence_frequency');
            return {
              data: { id: UUID_1, ...ctx.payload, created_at: '2026-05-01T00:00:00Z' },
              error: null
            };
          }
          return { data: null, error: { message: 'Update denied by RLS' } };
        },
        incomes: (ctx) => {
          if (ctx.op === 'insert') {
            capturedIncomePayload = ctx.payload;
            assert('income_date' in ctx.payload && !('date' in ctx.payload), 'incomes MUST write income_date, never legacy date');
            return {
              data: { id: UUID_2, ...ctx.payload, created_at: '2026-05-01T00:00:00Z' },
              error: null
            };
          }
          return { data: null, error: { message: 'Update failed on incomes' } };
        }
      });

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(failUpdateClient, true);

      const exp = await repository.addExpense({ title: 'Rent', amount: 12000, category: 'Housing', date: '2026-05-01', time: '09:30', paymentMethod: 'Bank Transfer' });
      const inc = await repository.addIncome({ title: 'Bonus', amount: 5000, source: 'Salary', date: '2026-05-01', time: '14:15' });

      assert(exp.id === UUID_1 && capturedExpensePayload.expense_date === '2026-05-01', 'Expense uses PostgreSQL UUID & expense_date');
      assert(capturedExpensePayload.expense_time === '09:30:00', 'Expense normalizes HH:mm time for Postgres time column');
      assert(inc.id === UUID_2 && capturedIncomePayload.income_date === '2026-05-01', 'Income uses PostgreSQL UUID & income_date');
      assert(capturedIncomePayload.income_time === '14:15:00', 'Income normalizes HH:mm time for Postgres time column');

      let expUpdateFailed = false;
      try {
        await repository.updateExpense(UUID_1, { amount: 99999 });
      } catch {
        expUpdateFailed = true;
      }
      assert(expUpdateFailed, 'Expense update error must reject');
      assert(repository.getExpenses()[0].amount === 12000, 'Expense amount must remain untouched after failed update');

      let incUpdateFailed = false;
      try {
        await repository.updateIncome(UUID_2, { title: 'Tampered' });
      } catch {
        incUpdateFailed = true;
      }
      assert(incUpdateFailed, 'Income update error must reject');
      assert(repository.getIncomes()[0].title === 'Bonus', 'Income title must remain untouched after failed update');
    }
    console.log('✓ Test 2 passed.');

    // =========================================================================
    // TEST 3: Failed Delete (error AND 0 affected rows) + Live goals columns
    // =========================================================================
    console.log('Test 3: Failed deletes retain record & goals omits unsupported columns...');
    {
      let deleteMode: 'error' | 'empty' = 'error';
      const delClient = createMockSupabase(USER_A, {
        goals: (ctx) => {
          if (ctx.op === 'insert') {
            assert(!('current_amount' in ctx.payload), 'goals insert MUST NOT send unsupported current_amount');
            assert(!('type' in ctx.payload), 'goals insert MUST NOT send unsupported type');
            assert(!('cover_image' in ctx.payload), 'goals insert MUST NOT send unsupported cover_image');
            assert('progress_percentage' in ctx.payload, 'goals insert MUST send progress_percentage');
            return {
              data: { id: UUID_1, ...ctx.payload, created_at: '2026-05-01T00:00:00Z' },
              error: null
            };
          }
          if (ctx.op === 'delete') {
            if (deleteMode === 'error') return { data: null, error: { message: 'Delete forbidden' } };
            return { data: [], error: null }; // 0 rows affected!
          }
          return { data: null, error: null };
        }
      });

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(delClient, true);

      const added = await repository.addGoal({ title: 'Learn Rust', description: '', category: 'Learning', progressPercentage: 25, priority: 'Medium', status: 'In Progress' });
      assert(repository.getGoals().length === 1 && added.progressPercentage === 25, 'Goal added with progressPercentage');

      let errDeleteThrew = false;
      try {
        await repository.deleteGoal(UUID_1);
      } catch {
        errDeleteThrew = true;
      }
      assert(errDeleteThrew, 'Delete returning DB error must throw');
      assert(repository.getGoals().length === 1, 'Goal must stay in state on delete DB error');

      deleteMode = 'empty';
      let emptyDeleteThrew = false;
      try {
        await repository.deleteGoal(UUID_1);
      } catch {
        emptyDeleteThrew = true;
      }
      assert(emptyDeleteThrew, 'Delete affecting 0 rows must throw');
      assert(repository.getGoals().length === 1, 'Goal must stay in state when 0 DB rows deleted');
    }
    console.log('✓ Test 3 passed.');

    // =========================================================================
    // TEST 4: Salary Payout RPCs (xos_record_salary_payout & xos_delete_salary_payout)
    // =========================================================================
    console.log('Test 4: RPC salary payouts, duplicate guard, replace_existing & atomic delete...');
    {
      let payoutsTable: any[] = [];
      let incomesTable: any[] = [];
      let rpcFailNext = false;
      let nextPayoutId = UUID_1;
      const rpcLog: string[] = [];

      const salaryClient = createMockSupabase(
        USER_A,
        {},
        (fn, args) => {
          rpcLog.push(fn);
          if (fn === 'xos_record_salary_payout') {
            assert('p_period_start' in args && 'p_period_end' in args && 'p_amount_paid' in args && 'p_paid_at' in args, 'RPC payload uses exact period/amount parameters');
            assert(!('p_period_month' in args), 'RPC payload MUST NOT use legacy p_period_month');
            if (rpcFailNext) {
              return { data: null, error: { message: 'RPC simulated failure: transaction rolled back' } };
            }

            const existing = payoutsTable.find(
              p => p.period_start === args.p_period_start && p.period_end === args.p_period_end
            );
            if (existing && !args.p_replace_existing) {
              return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
            }
            if (existing && args.p_replace_existing) {
              incomesTable = incomesTable.filter(i => i.salary_payout_id !== existing.id);
              payoutsTable = payoutsTable.filter(p => p.id !== existing.id);
            }

            const newPayout = {
              id: nextPayoutId,
              period_start: args.p_period_start,
              period_end: args.p_period_end,
              amount_paid: args.p_amount_paid,
              paid_at: args.p_paid_at,
              notes: args.p_notes,
              created_at: '2026-05-31T00:00:00Z',
              updated_at: '2026-05-31T00:00:00Z'
            };
            payoutsTable.push(newPayout);

            let newIncome = null;
            if (args.p_sync_to_income) {
              newIncome = {
                id: UUID_2,
                title: args.p_income_title,
                amount: args.p_amount_paid,
                source: 'Salary',
                income_date: args.p_income_date,
                income_time: args.p_income_time,
                notes: args.p_income_notes,
                salary_payout_id: newPayout.id,
                created_at: '2026-05-31T00:00:00Z'
              };
              incomesTable.push(newIncome);
            }
            return { data: { payout: newPayout, income: newIncome }, error: null };
          }

          if (fn === 'xos_delete_salary_payout') {
            incomesTable = incomesTable.filter(i => i.salary_payout_id !== args.p_payout_id);
            payoutsTable = payoutsTable.filter(p => p.id !== args.p_payout_id);
            return { data: true, error: null };
          }

          return { data: null, error: { message: `Unexpected RPC ${fn}` } };
        }
      );

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(salaryClient, true);

      const basePayout = {
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
        amountPaid: 11000,
        paidAt: '2026-05-31',
        notes: 'May Payout'
      };

      // Step 4a: RPC failure leaves state clean
      rpcFailNext = true;
      let rpcThrew = false;
      try {
        await repository.recordSalaryPayout(basePayout, true, false);
      } catch {
        rpcThrew = true;
      }
      assert(rpcThrew, 'RPC failure must throw cleanly');
      assert(payoutsTable.length === 0 && repository.getSalaryPayouts().length === 0, 'State remains clean when RPC fails');

      // Step 4b: Happy path RPC records payout + synced income via salary_payout_id FK
      rpcFailNext = false;
      rpcLog.length = 0;
      const savedPayout = await repository.recordSalaryPayout(basePayout, true, false);
      assert(savedPayout.id === UUID_1 && savedPayout.amountPaid === 11000, 'Payout uses DB UUID and amountPaid');
      assert(rpcLog[0] === 'xos_record_salary_payout', 'Called xos_record_salary_payout RPC');
      assert(repository.getIncomes()[0].salaryPayoutId === UUID_1, 'Income salaryPayoutId links to payout UUID');
      assert(incomesTable[0].salary_payout_id === UUID_1, 'DB income stores salary_payout_id = payout UUID');

      let dupRejected = false;
      try {
        await repository.recordSalaryPayout(basePayout, true, false);
      } catch {
        dupRejected = true;
      }
      assert(dupRejected, 'Duplicate period payout with allowReplace=false must be rejected');

      // Step 4c: Safe replace via p_replace_existing=true
      rpcLog.length = 0;
      nextPayoutId = UUID_3;
      const replaced = await repository.recordSalaryPayout({ ...basePayout, amountPaid: 11500 }, true, true);
      assert(replaced.id === UUID_3 && replaced.amountPaid === 11500, 'Replacement payout uses fresh DB UUID and updated amountPaid');
      assert(repository.getSalaryPayouts().length === 1, 'Exactly 1 payout after replace');
      assert(repository.getIncomes().length === 1 && repository.getIncomes()[0].salaryPayoutId === UUID_3, 'Exactly 1 linked income pointing to replacement payout');

      // Step 4d: deleteSalaryPayout invokes xos_delete_salary_payout RPC and clears state
      rpcLog.length = 0;
      await repository.deleteSalaryPayout(UUID_3);
      assert(rpcLog[0] === 'xos_delete_salary_payout', 'deleteSalaryPayout called xos_delete_salary_payout RPC');
      assert(incomesTable.length === 0 && payoutsTable.length === 0, 'Both linked income and payout deleted cleanly from DB');
      assert(repository.getIncomes().length === 0 && repository.getSalaryPayouts().length === 0, 'Both cleared from state');
    }
    console.log('✓ Test 4 passed.');

    // =========================================================================
    // TEST 5: Receivables Over-Repayment & DB Trigger Reconciliation
    // =========================================================================
    console.log('Test 5: Receivables lent_date, over-repayment guard & trigger status reconciliation...');
    {
      let debtRow: any = {
        id: UUID_1,
        person_name: 'Vikram',
        original_amount: 1000,
        remaining_amount: 1000,
        lent_date: '2026-05-01',
        status: 'outstanding',
        created_at: '2026-05-01T00:00:00Z',
        updated_at: '2026-05-01T00:00:00Z'
      };

      const debtClient = createMockSupabase(USER_A, {
        debts: (ctx) => {
          if (ctx.op === 'insert') {
            assert('lent_date' in ctx.payload && !('transaction_date' in ctx.payload), 'debts insert MUST write lent_date');
            assert(!('type' in ctx.payload), 'debts insert MUST NOT write unsupported type column');
            assert(!('remaining_amount' in ctx.payload) && !('status' in ctx.payload), 'debts insert lets DB triggers initialize remaining_amount/status');
            return { data: debtRow, error: null };
          }
          if (ctx.op === 'update') {
            assert(!('remaining_amount' in ctx.payload) && !('status' in ctx.payload) && !('type' in ctx.payload), 'debts update MUST NOT write trigger/unsupported columns');
          }
          return { data: debtRow, error: null };
        },
        debt_repayments: (ctx) => {
          if (ctx.op === 'insert') {
            // Simulate PostgreSQL trigger updating remaining_amount + status
            debtRow = { ...debtRow, remaining_amount: 600, status: 'partially_paid' };
            return {
              data: { id: UUID_2, debt_id: UUID_1, amount: ctx.payload.amount, repayment_date: ctx.payload.repayment_date, notes: '', created_at: '2026-05-02T00:00:00Z' },
              error: null
            };
          }
          if (ctx.op === 'delete') {
            debtRow = { ...debtRow, remaining_amount: 1000, status: 'outstanding' };
            return { data: [{ id: UUID_2 }], error: null };
          }
          return { data: [], error: null };
        }
      });

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(debtClient, true);

      await repository.addDebt({ person_name: 'Vikram', original_amount: 1000, lent_date: '2026-05-01' });

      let overRepayRejected = false;
      try {
        await repository.addDebtRepayment({ debt_id: UUID_1, amount: 1500, repayment_date: '2026-05-02' });
      } catch {
        overRepayRejected = true;
      }
      assert(overRepayRejected, 'Over-repayment must be rejected');

      await repository.addDebtRepayment({ debt_id: UUID_1, amount: 400, repayment_date: '2026-05-02' });
      assert(repository.getDebts()[0].status === 'partially_paid', 'Debt status reconciled to partially_paid');
      assert(repository.getDebts()[0].remaining_amount === 600, 'Debt remaining_amount reconciled to 600');

      await repository.deleteDebtRepayment(UUID_2);
      assert(repository.getDebts()[0].status === 'outstanding', 'Debt status reconciled back to outstanding after repayment deletion');
      assert(repository.getDebts()[0].remaining_amount === 1000, 'Debt remaining_amount reconciled back to 1000');
    }
    console.log('✓ Test 5 passed.');

    // =========================================================================
    // TEST 6: Savings Over-Withdrawal, current_balance Trigger Read/Delete & Rollback
    // =========================================================================
    console.log('Test 6: Savings over-withdrawal, current_balance trigger read/delete, & initial deposit rollback...');
    {
      let savingsGoalsTable: any[] = [];
      let savingsTxTable: any[] = [];
      let failInitialTx = true;

      const savingsClient = createMockSupabase(USER_A, {
        savings_goals: (ctx) => {
          if (ctx.op === 'insert') {
            assert(!('current_amount' in ctx.payload), 'savings_goals insert MUST NOT write unsupported current_amount');
            assert(!('current_balance' in ctx.payload), 'savings_goals insert MUST NOT overwrite trigger-maintained current_balance');
            assert(!('start_date' in ctx.payload), 'savings_goals insert MUST NOT write unsupported start_date');
            assert(!('description' in ctx.payload), 'savings_goals insert MUST NOT write unsupported description (maps to notes)');
            const row = { id: UUID_1, ...ctx.payload, current_balance: 0, created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z' };
            savingsGoalsTable.push(row);
            return { data: row, error: null };
          }
          if (ctx.op === 'update') {
            assert(!('current_amount' in ctx.payload) && !('current_balance' in ctx.payload), 'savings_goals update MUST NOT overwrite current_balance');
            assert(!('start_date' in ctx.payload) && !('description' in ctx.payload), 'savings_goals update MUST NOT write start_date/description');
            const idFilter = ctx.filters.find(f => f.col === 'id')?.val;
            savingsGoalsTable = savingsGoalsTable.map(g =>
              g.id === idFilter ? { ...g, ...ctx.payload } : g
            );
            return { data: savingsGoalsTable.find(g => g.id === idFilter) || null, error: null };
          }
          if (ctx.op === 'delete') {
            savingsGoalsTable = savingsGoalsTable.filter(g => g.id !== UUID_1);
            return { data: [{ id: UUID_1 }], error: null };
          }
          return { data: savingsGoalsTable[0] || null, error: null };
        },
        savings_transactions: (ctx) => {
          if (ctx.op === 'insert') {
            assert('transaction_type' in ctx.payload && !('type' in ctx.payload), 'savings_transactions MUST write transaction_type');
            assert('transaction_date' in ctx.payload && !('date' in ctx.payload), 'savings_transactions MUST write transaction_date');
            assert('notes' in ctx.payload && !('note' in ctx.payload), 'savings_transactions MUST write notes');
            if (failInitialTx) {
              return { data: null, error: { message: 'Initial deposit insert failed' } };
            }
            if (savingsGoalsTable[0]) {
              const delta = ctx.payload.transaction_type === 'deposit' ? ctx.payload.amount : -ctx.payload.amount;
              savingsGoalsTable[0] = {
                ...savingsGoalsTable[0],
                current_balance: savingsGoalsTable[0].current_balance + delta
              };
            }
            const txRow = { id: UUID_2, ...ctx.payload, created_at: '2026-05-01T00:00:00Z' };
            savingsTxTable.push(txRow);
            return { data: txRow, error: null };
          }
          if (ctx.op === 'delete') {
            const idFilter = ctx.filters.find(f => f.col === 'id')?.val;
            const deleted = savingsTxTable.find(t => t.id === idFilter);
            savingsTxTable = savingsTxTable.filter(t => t.id !== idFilter);
            if (deleted && savingsGoalsTable[0]) {
              const revDelta = deleted.transaction_type === 'deposit' ? -deleted.amount : deleted.amount;
              savingsGoalsTable[0] = {
                ...savingsGoalsTable[0],
                current_balance: Math.max(0, savingsGoalsTable[0].current_balance + revDelta)
              };
            }
            return { data: deleted ? [{ id: deleted.id }] : [], error: null };
          }
          return { data: savingsTxTable, error: null };
        }
      });

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(savingsClient, true);

      let goalRolledBack = false;
      try {
        await repository.addSavingsGoal({ name: 'Laptop', targetAmount: 80000, initialDeposit: 10000, initialDepositDate: '2026-05-01', description: 'Workstation reserve' });
      } catch {
        goalRolledBack = true;
      }
      assert(goalRolledBack, 'Failed initial deposit must throw');
      assert(savingsGoalsTable.length === 0, 'Parent savings_goal must be rolled back when initial deposit fails');

      failInitialTx = false;
      const sg = await repository.addSavingsGoal({ name: 'Laptop', targetAmount: 80000, initialDeposit: 10000, initialDepositDate: '2026-05-01', description: 'Workstation reserve' });
      assert(sg.currentAmount === 10000, 'Reconciled currentAmount from trigger-maintained current_balance after initial deposit');
      assert(sg.description === 'Workstation reserve', 'Mapped DB notes column back to SavingsGoal.description');
      assert(savingsGoalsTable[0].notes === 'Workstation reserve', 'DB insert stored description in notes column');

      await repository.updateSavingsGoal(sg.id, {
        name: 'MacBook Pro',
        targetAmount: 95000,
        description: 'Upgraded workstation fund'
      });
      assert(savingsGoalsTable[0].notes === 'Upgraded workstation fund', 'updateSavingsGoal persisted description into notes column');
      assert(savingsGoalsTable[0].current_balance === 10000, 'Trigger-maintained current_balance remained untouched by updateSavingsGoal');
      assert(repository.getSavingsGoals()[0].description === 'Upgraded workstation fund', 'Updated description reflected in memoryState');
      assert(repository.getSavingsGoals()[0].currentAmount === 10000, 'Current balance preserved after metadata update');

      let overWithdrawBlocked = false;
      try {
        await repository.addSavingsTransaction({ savingsGoalId: sg.id, amount: 15000, type: 'withdrawal', date: '2026-05-02' });
      } catch {
        overWithdrawBlocked = true;
      }
      assert(overWithdrawBlocked, 'Savings withdrawal exceeding balance must reject');

      // Delete initial deposit transaction -> reconciles currentAmount back to 0 from DB trigger
      await repository.deleteSavingsTransaction(UUID_2);
      assert(repository.getSavingsTransactions().length === 0, 'Deleted transaction removed from state');
      assert(repository.getSavingsGoals()[0].currentAmount === 0, 'Savings goal currentAmount reconciled from DB trigger after transaction delete');
    }
    console.log('✓ Test 6 passed.');

    // =========================================================================
    // TEST 7: Partial Failure Resilience in fetchAllUserData
    // =========================================================================
    console.log('Test 7: Partial fetch errors preserve valid data and populate fetchErrors...');
    {
      let incomesShouldFail = false;
      const partialClient = createMockSupabase(USER_A, {
        expenses: () => ({
          data: [{ id: UUID_1, title: 'Internet', amount: 999, category: 'Utilities', expense_date: '2026-05-01', payment_method: 'Bank Transfer', is_recurring: false, recurrence_frequency: 'None', created_at: '2026-05-01' }],
          error: null
        }),
        incomes: () => incomesShouldFail
          ? { data: null, error: { message: 'Temporary timeout on incomes' } }
          : { data: [{ id: UUID_2, title: 'Paycheck', amount: 50000, source: 'Salary', income_date: '2026-05-01', created_at: '2026-05-01' }], error: null }
      });

      repository.clearUserData();
      configureRepositoryBackendForTests(partialClient, true);

      const firstFetch = await repository.fetchAllUserData(USER_A);
      assert(firstFetch.partialErrors.length === 0, 'Initial full fetch succeeds');
      assert(repository.getIncomes().length === 1, 'Incomes populated');

      incomesShouldFail = true;
      const secondFetch = await repository.fetchAllUserData(USER_A);
      assert(secondFetch.partialErrors.length === 1, 'One partial error reported');
      assert(secondFetch.partialErrors[0].table === 'incomes', 'Failed table identified');
      assert(repository.getFetchErrors().length === 1, 'getFetchErrors exposes partial errors');
      assert(repository.getIncomes().length === 1, 'Prior valid incomes MUST NOT be wiped out by partial error');
      assert(repository.getExpenses().length === 1, 'Healthy expenses table updated cleanly');
    }
    console.log('✓ Test 7 passed.');

    // =========================================================================
    // TEST 8 & 9: User Switching + Clear/Sequence Stale Response Discard
    // =========================================================================
    console.log('Tests 8 & 9: User switching & stale fetch discard...');
    {
      let resolveUserAFetch!: (val: { data: any; error: any }) => void;
      const slowClient = createMockSupabase(USER_A, {
        expenses: (ctx) => {
          const uid = ctx.filters.find(f => f.col === 'user_id')?.val;
          if (uid === USER_A) {
            return new Promise(res => {
              resolveUserAFetch = res;
            });
          }
          return {
            data: [{ id: UUID_4, title: 'User B Expense', amount: 250, category: 'Food', expense_date: '2026-05-03', payment_method: 'Cash', is_recurring: false, recurrence_frequency: 'None', created_at: '2026-05-03' }],
            error: null
          };
        }
      });

      repository.clearUserData();
      configureRepositoryBackendForTests(slowClient, true);

      const userAPromise = repository.fetchAllUserData(USER_A);

      (slowClient as any).__setSessionUserId(USER_B);
      repository.clearUserData();
      const userBResult = await repository.fetchAllUserData(USER_B);
      assert(userBResult.stale === false, 'User B fetch completes actively');
      assert(repository.getExpenses().length === 1 && repository.getExpenses()[0].id === UUID_4, 'User B expenses active');

      resolveUserAFetch({
        data: [{ id: UUID_3, title: 'User A Stale Expense', amount: 9999, category: 'Other', expense_date: '2026-05-01', payment_method: 'Cash', is_recurring: false, recurrence_frequency: 'None', created_at: '2026-05-01' }],
        error: null
      });

      const userAResult = await userAPromise;
      assert(userAResult.stale === true, 'User A slow response marked stale and discarded');
      assert(repository.getExpenses().length === 1 && repository.getExpenses()[0].id === UUID_4, 'User B state untouched by stale User A response');
      assert(repository.getActiveUserId() === USER_B, 'Active user remains User B');
    }
    console.log('✓ Tests 8 & 9 passed.');

    // =========================================================================
    // TEST 10: Sign-Out Data Clearing
    // =========================================================================
    console.log('Test 10: Sign-out clears every state collection and activeUserId...');
    {
      repository.clearUserData();
      assert(repository.getActiveUserId() === null, 'activeUserId cleared');
      assert(repository.getExpenses().length === 0, 'expenses cleared');
      assert(repository.getIncomes().length === 0, 'incomes cleared');
      assert(repository.getAttendance().length === 0, 'attendance cleared');
      assert(repository.getDebts().length === 0, 'debts cleared');
      assert(repository.getDebtRepayments().length === 0, 'debtRepayments cleared');
      assert(repository.getSavingsGoals().length === 0, 'savingsGoals cleared');
      assert(repository.getSavingsTransactions().length === 0, 'savingsTransactions cleared');
      assert(repository.getSalaryPayouts().length === 0, 'salaryPayouts cleared');
      assert(repository.getGoals().length === 0, 'goals cleared');
      assert(repository.getFetchErrors().length === 0, 'fetchErrors cleared');
    }
    console.log('✓ Test 10 passed.');

    // =========================================================================
    // TEST 11: Date-Only Parsing (Local Timezone Safety, Leap Day, Formats)
    // =========================================================================
    console.log('Test 11: Calendar date parsing & formatting without UTC midnight shift...');
    {
      const may1 = parseCalendarDate('2026-05-01');
      assert(may1.getFullYear() === 2026 && may1.getMonth() === 4 && may1.getDate() === 1, '2026-05-01 parses to local May 1');

      const leap = parseCalendarDate('2024-02-29');
      assert(leap.getFullYear() === 2024 && leap.getMonth() === 1 && leap.getDate() === 29, 'Leap day 2024-02-29 parses cleanly');

      const invalidCalendar = parseCalendarDate('2026-02-30');
      assert(isNaN(invalidCalendar.getTime()), 'Invalid calendar date 2026-02-30 must produce Invalid Date rather than overflowing to March');

      assert(formatDate('2026-05-01', 'YYYY-MM-DD') === '2026-05-01', 'YYYY-MM-DD preserves exact date');
      assert(formatDate('2026-05-01', 'DD/MM/YYYY') === '01/05/2026', 'DD/MM/YYYY preserves exact date');
      assert(formatDate('2026-05-01', 'MM/DD/YYYY') === '05/01/2026', 'MM/DD/YYYY preserves exact date');
      assert(formatHumanDate('2026-01-01').includes('Jan') && formatHumanDate('2026-01-01').includes('2026'), 'Jan 1 human format preserves year/month');
    }
    console.log('✓ Test 11 passed.');

    // =========================================================================
    // TEST 12: Month Boundary Filtering (1st, Last Day, Dec->Jan, Leap Day)
    // =========================================================================
    console.log('Test 12: Month boundary filtering accuracy...');
    {
      const sampleRecords = [
        { id: 'r1', date: '2025-12-31' },
        { id: 'r2', date: '2026-01-01' },
        { id: 'r3', date: '2026-01-31' },
        { id: 'r4', date: '2024-02-29' },
        { id: 'r5', date: '2026-02-01' }
      ];

      const janFiltered = filterRecordsByDateRange(sampleRecords, 'this_month', undefined, undefined, new Date(2026, 0, 15));
      assert(janFiltered.map(r => r.id).join(',') === 'r2,r3', `Jan this_month got ${janFiltered.map(r => r.id).join(',')}`);

      const decFiltered = filterRecordsByDateRange(sampleRecords, 'last_month', undefined, undefined, new Date(2026, 0, 10));
      assert(decFiltered.map(r => r.id).join(',') === 'r1', `Dec last_month across year boundary got ${decFiltered.map(r => r.id).join(',')}`);

      const leapFiltered = filterRecordsByDateRange(sampleRecords, 'this_month', undefined, undefined, new Date(2024, 1, 29));
      assert(leapFiltered.map(r => r.id).join(',') === 'r4', 'Leap day included in Feb 2024 month filter');

      const customFiltered = filterRecordsByDateRange(sampleRecords, 'custom', '2026-01-01', '2026-02-01');
      assert(customFiltered.map(r => r.id).join(',') === 'r2,r3,r5', 'Custom boundary inclusive on both endpoints');
    }
    console.log('✓ Test 12 passed.');

    // =========================================================================
    // TEST 13: INR Default Currency & Preserving Saved User currency_code + Live Column Reads
    // =========================================================================
    console.log('Test 13: INR default vs saved USD/EUR currency_code & live user_settings column reads...');
    {
      let settingsRow: any = null;
      let salaryConfigRow: any = null;
      const currencyClient = createMockSupabase(USER_A, {
        user_settings: () => ({ data: settingsRow, error: null }),
        salary_configs: () => ({ data: salaryConfigRow, error: null })
      });
      configureRepositoryBackendForTests(currencyClient, true);

      // Missing user_settings -> INR
      repository.clearUserData();
      await repository.fetchAllUserData(USER_A);
      assert(repository.getSettings().currency === 'INR', 'Missing user_settings row defaults to INR');

      // Saved null currency_code -> INR
      settingsRow = {
        user_id: USER_A,
        currency_code: null,
        date_format: 'YYYY-MM-DD',
        week_starts_on: 'Monday',
        expense_categories: ['Food', 'Other'],
        income_sources: ['Salary', 'Other']
      };
      await repository.fetchAllUserData(USER_A);
      assert(repository.getSettings().currency === 'INR', 'Null currency_code column defaults to INR');

      // Existing saved USD -> preserved!
      settingsRow = {
        user_id: USER_A,
        currency_code: 'USD',
        date_format: 'MM/DD/YYYY',
        week_starts_on: 'Sunday',
        expense_categories: ['Housing', 'Other'],
        income_sources: ['Freelance', 'Other']
      };
      salaryConfigRow = { user_id: USER_A, currency_code: 'USD', daily_base_salary: 200, standard_hours: 7, extra_hour_rate: 45 };
      await repository.fetchAllUserData(USER_A);
      assert(repository.getSettings().currency === 'USD', 'Saved USD currency_code preference MUST be preserved');
      assert(repository.getSettings().salaryConfig.currency === 'USD', 'salary_configs currency_code USD mapped');
      assert(repository.getSettings().salaryConfig.standardWorkingHours === 7, 'salary_configs standard_hours mapped');
      assert(repository.getSettings().dateFormat === 'MM/DD/YYYY', 'Saved date format preserved');
      assert(repository.getSettings().weekStartDay === 'Sunday', 'Saved week_starts_on preserved');
      assert(repository.getSettings().customExpenseCategories.join(',') === 'Housing,Other', 'Saved expense_categories preserved');

      // Existing saved EUR -> preserved!
      settingsRow = { user_id: USER_A, currency_code: 'EUR', date_format: 'DD/MM/YYYY', week_starts_on: 'Monday' };
      salaryConfigRow = { user_id: USER_A, currency_code: 'EUR', daily_base_salary: 180, standard_hours: 8, extra_hour_rate: 30 };
      await repository.fetchAllUserData(USER_A);
      assert(repository.getSettings().currency === 'EUR', 'Saved EUR currency_code preference MUST be preserved');
      assert(repository.getSettings().salaryConfig.currency === 'EUR', 'salary_configs currency_code EUR mapped');
    }
    console.log('✓ Test 13 passed.');

    // =========================================================================
    // TEST 14: Live Columns on salary_configs, goals, and attendance_records
    // =========================================================================
    console.log('Test 14: salary_configs, goals & attendance_records exact live column payloads...');
    {
      let capturedSalaryPayload: any = null;
      let capturedGoalUpdatePayload: any = null;
      let capturedAttendancePayload: any = null;

      const configClient = createMockSupabase(USER_A, {
        salary_configs: (ctx) => {
          assert(!('currency' in ctx.payload), 'salary_configs MUST NOT write legacy currency');
          assert(!('standard_working_hours' in ctx.payload), 'salary_configs MUST NOT write legacy standard_working_hours');
          assert(!('salary_type' in ctx.payload), 'salary_configs MUST NOT write unsupported salary_type');
          capturedSalaryPayload = ctx.payload;
          return { data: ctx.payload, error: null };
        },
        goals: (ctx) => {
          if (ctx.op === 'insert') {
            assert(!('current_amount' in ctx.payload) && !('type' in ctx.payload), 'goals insert omits legacy columns');
            return {
              data: { id: UUID_1, ...ctx.payload, created_at: '2026-05-01' },
              error: null
            };
          }
          if (ctx.op === 'update') {
            assert(!('current_amount' in ctx.payload) && !('type' in ctx.payload), 'goals update omits legacy columns');
            capturedGoalUpdatePayload = ctx.payload;
            return {
              data: { id: UUID_1, title: 'My Dream', description: '', category: 'Personal', progress_percentage: ctx.payload.progress_percentage, priority: 'High', status: 'In Progress', created_at: '2026-05-01' },
              error: null
            };
          }
          return { data: [], error: null };
        },
        attendance_records: (ctx) => {
          if (ctx.op === 'upsert') {
            assert('attendance_date' in ctx.payload && !('date' in ctx.payload), 'attendance_records MUST write attendance_date');
            assert('check_in' in ctx.payload && !('check_in_time' in ctx.payload), 'attendance_records MUST write check_in');
            assert('check_out' in ctx.payload && !('check_out_time' in ctx.payload), 'attendance_records MUST write check_out');
            assert('break_minutes' in ctx.payload && !('break_duration_minutes' in ctx.payload), 'attendance_records MUST write break_minutes');
            assert('hours_worked' in ctx.payload && !('calculated_hours' in ctx.payload), 'attendance_records MUST write hours_worked');
            assert('daily_base_salary' in ctx.payload && 'extra_hour_rate' in ctx.payload && 'calculated_salary' in ctx.payload, 'attendance_records writes snapshot salary columns');
            capturedAttendancePayload = ctx.payload;
            return { data: { id: UUID_2, ...ctx.payload, created_at: '2026-05-01' }, error: null };
          }
          return { data: [], error: null };
        }
      });

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(configClient, true);

      await repository.persistSalaryConfig({
        currency: 'USD',
        dailyBaseSalary: 1200,
        standardWorkingHours: 9,
        extraHourRate: 200
      });

      assert(capturedSalaryPayload?.currency_code === 'USD', 'salary_configs upsert sends currency_code');
      assert(capturedSalaryPayload?.daily_base_salary === 1200, 'salary_configs upsert sends daily_base_salary');
      assert(capturedSalaryPayload?.standard_hours === 9, 'salary_configs upsert sends standard_hours');
      assert(capturedSalaryPayload?.extra_hour_rate === 200, 'salary_configs upsert sends extra_hour_rate');

      await repository.addGoal({ title: 'My Goal', description: '', category: 'Personal', progressPercentage: 20, priority: 'Medium', status: 'In Progress' });
      await repository.updateGoal(UUID_1, { title: 'My Dream', progressPercentage: 85, priority: 'High' });
      assert(capturedGoalUpdatePayload?.progress_percentage === 85, 'updateGoal writes progress_percentage');
      assert(repository.getGoals()[0].progressPercentage === 85, 'Goal progressPercentage updated cleanly in state');

      const att = await repository.upsertAttendanceRecord({
        date: '2026-05-01',
        status: 'Present',
        checkInTime: '09:00',
        checkOutTime: '20:00',
        breakDurationMinutes: 60,
        calculatedHours: 10,
        notes: 'Extra hour shift'
      });
      assert(capturedAttendancePayload.attendance_date === '2026-05-01', 'attendance_records writes attendance_date');
      assert(capturedAttendancePayload.check_in === '09:00:00', 'attendance_records normalizes check_in');
      assert(capturedAttendancePayload.extra_hours === 1, '10h with 9h standard -> 1 extra hour');
      assert(capturedAttendancePayload.calculated_salary === 1400, '1200 + 1*200 = 1400 snapshot calculated_salary');
      assert(att.dailyEarnedSalary === 1400, 'Mapped dailyEarnedSalary from calculated_salary');
    }
    console.log('✓ Test 14 passed.');

    // =========================================================================
    // TEST 15: persistSettingsBundle Live Columns & Missing Profile Row Tolerance
    // =========================================================================
    console.log('Test 15: persistSettingsBundle exact live columns & non-fatal missing profile row...');
    {
      let capturedUserSettings: any = null;
      let capturedSalaryCfg: any = null;

      const bundleClient = createMockSupabase(USER_A, {
        profiles: () => ({ data: null, error: null }), // Simulate missing profile row
        user_settings: (ctx) => {
          assert('week_starts_on' in ctx.payload && !('week_start_day' in ctx.payload), 'user_settings MUST write week_starts_on');
          assert('expense_categories' in ctx.payload && !('custom_expense_categories' in ctx.payload), 'user_settings MUST write expense_categories');
          assert('income_sources' in ctx.payload && !('custom_income_sources' in ctx.payload), 'user_settings MUST write income_sources');
          assert('dashboard_widgets' in ctx.payload, 'user_settings MUST write dashboard_widgets');
          assert('currency_code' in ctx.payload && !('currency' in ctx.payload), 'user_settings MUST write currency_code');
          capturedUserSettings = ctx.payload;
          return { data: ctx.payload, error: null };
        },
        salary_configs: (ctx) => {
          capturedSalaryCfg = ctx.payload;
          return { data: ctx.payload, error: null };
        }
      });

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(bundleClient, true);

      await repository.persistSettingsBundle({
        displayName: 'Musthafa',
        currency: 'EUR',
        dateFormat: 'DD/MM/YYYY',
        weekStartDay: 'Monday',
        customExpenseCategories: ['Food', 'Other'],
        customIncomeSources: ['Salary', 'Other'],
        widgets: [{ id: 'w1', name: 'Income', visible: true, order: 1 }],
        salaryConfig: {
          dailyBaseSalary: 600,
          standardWorkingHours: 8,
          extraHourRate: 120,
          currency: 'EUR'
        }
      });

      assert(capturedUserSettings.currency_code === 'EUR', 'user_settings persisted currency_code EUR');
      assert(capturedUserSettings.week_starts_on === 'Monday', 'user_settings persisted week_starts_on');
      assert(capturedSalaryCfg.currency_code === 'EUR' && capturedSalaryCfg.standard_hours === 8, 'salary_configs persisted currency_code & standard_hours');
      assert(repository.getSettings().currency === 'EUR', 'memoryState updated to EUR');
    }
    console.log('✓ Test 15 passed.');

    console.log('\n======================================================');
    console.log('--- ALL 15 PERSISTENCE & LIVE SCHEMA TESTS PASSED! ---');
    console.log('======================================================');
  } finally {
    configureRepositoryBackendForTests(null, null);
    repository.clearUserData();
  }
}

runPersistenceTests().catch(err => {
  console.error('Persistence Test Suite Failed:', err);
  process.exit(1);
});
