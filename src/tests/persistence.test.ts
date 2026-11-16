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
import {
  repository,
  configureRepositoryBackendForTests,
  SettingsBundleSaveError,
  toDbWeekStartDay,
  fromDbWeekStartDay,
  toDbAttendanceStatus,
  fromDbAttendanceStatus,
  toDbGoalStatus,
  fromDbGoalStatus,
  toDbGoalPriority,
  fromDbGoalPriority,
  toDbRecurrenceFrequency,
  fromDbRecurrenceFrequency,
  serializeDebtDescription,
  deserializeDebtDescription
} from '../services/repository';
import { apiOptimization } from '../services/apiClient';
import {
  parseCalendarDate,
  formatDate,
  formatHumanDate,
  localDateInputToUtcIso,
  utcTimestampToLocalDate,
  getIstTodayString,
  isFutureIstDate
} from '../utils/formatters';
import {
  calculateMonthlySalarySummary,
  filterRecordsByDateRange,
  resolveGoalsWithSavings,
  calculateUnifiedGoalTotals,
  calculateGoalStats
} from '../utils/calculations';

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
      const failAllClient = createMockSupabase(
        USER_A,
        {
          expenses: () => ({ data: null, error: { message: 'RLS denied insert on expenses' } }),
          debts: () => ({ data: null, error: { message: 'RLS denied insert on debts' } }),
          savings_goals: () => ({ data: null, error: { message: 'DB timeout on savings_goals' } }),
          attendance_records: () => ({ data: null, error: { message: 'Constraint violation on attendance' } }),
          goals: () => ({ data: null, error: { message: 'Insert rejected on goals' } })
        },
        (fn) => ({ data: null, error: { message: `RPC failed: ${fn}` } })
      );

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(failAllClient, true);

      const cases: Array<() => Promise<any>> = [
        () => repository.addExpense({ title: 'Coffee', amount: 150, category: 'Food', date: '2026-05-01', paymentMethod: 'Cash' }),
        () => repository.addDebt({ person_name: 'Sam', original_amount: 1000, lent_date: '2026-05-01' }),
        () => repository.addSavingsGoal({ name: 'Trip', targetAmount: 50000, initialDeposit: 0, initialDepositDate: '2026-05-01' }),
        () => repository.upsertAttendanceRecord({ date: '2026-05-01', status: 'Present', calculatedHours: 8 }),
        () => repository.addGoal({ title: 'Save', description: '', category: 'Financial', targetAmount: 5000, priority: 'High' })
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
    // TEST 3: RPC Goal + Savings Creation ID Hydration & Failed Archive Delete
    // =========================================================================
    console.log('Test 3: Goal creation hydrates returned Goal & Savings IDs and failed archive retains record...');
    {
      let dbGoalRow: any = null;
      let dbSavingsRow: any = null;

      const goalRpcClient = createMockSupabase(
        USER_A,
        {
          goals: (ctx) => {
            if (ctx.op === 'select') {
              assert(ctx.filters.some(f => f.col === 'id' && f.val === UUID_1), 'Selects created goal by returned goal_id');
              return { data: dbGoalRow, error: null };
            }
            return { data: null, error: { message: 'Direct goals insert/delete disabled' } };
          },
          savings_goals: (ctx) => {
            if (ctx.op === 'select') {
              assert(ctx.filters.some(f => f.col === 'id' && f.val === UUID_2), 'Selects created savings account by returned savings_goal_id');
              return { data: dbSavingsRow, error: null };
            }
            return { data: null, error: null };
          }
        },
        (fn, args) => {
          if (fn === 'xos_create_goal_with_savings') {
            assert(args.p_target_amount === 5000, 'RPC receives positive p_target_amount');
            assert(args.p_priority === 'medium', 'RPC receives lowercase p_priority');
            dbSavingsRow = {
              id: UUID_2,
              name: args.p_title,
              target_amount: args.p_target_amount,
              current_balance: args.p_initial_deposit || 0,
              notes: args.p_description,
              created_at: '2026-05-01T00:00:00Z'
            };
            dbGoalRow = {
              id: UUID_1,
              title: args.p_title,
              description: args.p_description,
              category: args.p_category,
              target_amount: args.p_target_amount,
              progress_percentage: 0,
              priority: args.p_priority,
              status: 'not_started',
              savings_goal_id: UUID_2,
              created_at: '2026-05-01T00:00:00Z'
            };
            return { data: { goal_id: UUID_1, savings_goal_id: UUID_2 }, error: null };
          }
          if (fn === 'xos_archive_goal') {
            assert(args.p_goal_id === UUID_1, 'xos_archive_goal receives p_goal_id');
            return { data: null, error: { message: 'Archive forbidden' } };
          }
          return { data: null, error: { message: `Unexpected RPC ${fn}` } };
        }
      );

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(goalRpcClient, true);

      const added = await repository.addGoal({
        title: 'Learn Rust',
        description: 'Systems book',
        category: 'Learning',
        targetAmount: 5000,
        priority: 'Medium'
      });
      assert(added.id === UUID_1 && added.savingsGoalId === UUID_2, 'Returned Goal & Savings IDs hydrated onto Goal');
      assert(repository.getGoals().length === 1 && repository.getSavingsGoals().length === 1, 'Both Goal and SavingsGoal hydrated into state');
      assert(repository.getSavingsGoals()[0].id === UUID_2, 'SavingsGoal in state matches returned savings_goal_id');

      let errDeleteThrew = false;
      try {
        await repository.deleteGoal(UUID_1);
      } catch {
        errDeleteThrew = true;
      }
      assert(errDeleteThrew, 'Archive RPC returning DB error must throw');
      assert(repository.getGoals().length === 1, 'Goal must stay in state on archive RPC error');
      assert(repository.getSavingsGoals().length === 1, 'Connected SavingsGoal must stay in state on archive RPC error');
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
          data: [{ id: UUID_1, title: 'Internet', amount: 999, category: 'Utilities', expense_date: '2026-05-01', payment_method: 'Bank Transfer', is_recurring: false, recurrence_frequency: null, created_at: '2026-05-01' }],
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
            data: [{ id: UUID_4, title: 'User B Expense', amount: 250, category: 'Food', expense_date: '2026-05-03', payment_method: 'Cash', is_recurring: false, recurrence_frequency: null, created_at: '2026-05-03' }],
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
        data: [{ id: UUID_3, title: 'User A Stale Expense', amount: 9999, category: 'Other', expense_date: '2026-05-01', payment_method: 'Cash', is_recurring: false, recurrence_frequency: null, created_at: '2026-05-01' }],
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
        week_starts_on: 1,
        expense_categories: ['Food', 'Other'],
        income_sources: ['Salary', 'Other']
      };
      await repository.fetchAllUserData(USER_A);
      assert(repository.getSettings().currency === 'INR', 'Null currency_code column defaults to INR');

      // Existing saved USD -> preserved! And SMALLINT week_starts_on 0 -> Sunday!
      settingsRow = {
        user_id: USER_A,
        currency_code: 'USD',
        date_format: 'MM/DD/YYYY',
        week_starts_on: 0,
        expense_categories: ['Housing', 'Other'],
        income_sources: ['Freelance', 'Other']
      };
      salaryConfigRow = { user_id: USER_A, currency_code: 'USD', daily_base_salary: 200, standard_hours: 7, extra_hour_rate: 45 };
      await repository.fetchAllUserData(USER_A);
      assert(repository.getSettings().currency === 'USD', 'Saved USD currency_code preference MUST be preserved');
      assert(repository.getSettings().salaryConfig.currency === 'USD', 'salary_configs currency_code USD mapped');
      assert(repository.getSettings().salaryConfig.standardWorkingHours === 7, 'salary_configs standard_hours mapped');
      assert(repository.getSettings().dateFormat === 'MM/DD/YYYY', 'Saved date format preserved');
      assert(repository.getSettings().weekStartDay === 'Sunday', 'Saved week_starts_on 0 maps to Sunday');
      assert(repository.getSettings().customExpenseCategories.join(',') === 'Housing,Other', 'Saved expense_categories preserved');

      // Existing saved EUR -> preserved! And SMALLINT week_starts_on 1 -> Monday!
      settingsRow = { user_id: USER_A, currency_code: 'EUR', date_format: 'DD/MM/YYYY', week_starts_on: 1 };
      salaryConfigRow = { user_id: USER_A, currency_code: 'EUR', daily_base_salary: 180, standard_hours: 8, extra_hour_rate: 30 };
      await repository.fetchAllUserData(USER_A);
      assert(repository.getSettings().currency === 'EUR', 'Saved EUR currency_code preference MUST be preserved');
      assert(repository.getSettings().weekStartDay === 'Monday', 'Saved week_starts_on 1 maps to Monday');
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
      let goalRow: any = null;
      let sgRow: any = null;

      const configClient = createMockSupabase(
        USER_A,
        {
          salary_configs: (ctx) => {
            assert(!('currency' in ctx.payload), 'salary_configs MUST NOT write legacy currency');
            assert(!('standard_working_hours' in ctx.payload), 'salary_configs MUST NOT write legacy standard_working_hours');
            assert(!('salary_type' in ctx.payload), 'salary_configs MUST NOT write unsupported salary_type');
            capturedSalaryPayload = ctx.payload;
            return { data: ctx.payload, error: null };
          },
          goals: (ctx) => {
            if (ctx.op === 'select') {
              return { data: goalRow, error: null };
            }
            if (ctx.op === 'update') {
              assert(!('current_amount' in ctx.payload) && !('type' in ctx.payload), 'goals update omits legacy columns');
              assert(!('progress_percentage' in ctx.payload), 'goals update MUST NOT directly write progress_percentage');
              assert(!('completed_at' in ctx.payload), 'goals update MUST NOT directly write completed_at');
              assert(!('current_balance' in ctx.payload), 'goals update MUST NOT directly write current_balance');
              assert(!('savings_goal_id' in ctx.payload), 'goals update MUST NOT overwrite savings_goal_id');
              capturedGoalUpdatePayload = ctx.payload;
              goalRow = {
                ...goalRow,
                ...ctx.payload,
                progress_percentage: 20
              };
              return { data: goalRow, error: null };
            }
            return { data: [], error: null };
          },
          savings_goals: () => ({ data: sgRow, error: null }),
          attendance_records: (ctx) => {
            if (ctx.op === 'upsert') {
              assert('attendance_date' in ctx.payload && !('date' in ctx.payload), 'attendance_records MUST write attendance_date');
              assert('check_in' in ctx.payload && !('check_in_time' in ctx.payload), 'attendance_records MUST write check_in');
              assert('check_out' in ctx.payload && !('check_out_time' in ctx.payload), 'attendance_records MUST write check_out');
              assert('break_minutes' in ctx.payload && !('break_duration_minutes' in ctx.payload), 'attendance_records MUST write break_minutes');
              assert('hours_worked' in ctx.payload && !('calculated_hours' in ctx.payload), 'attendance_records MUST write hours_worked');
              assert('daily_base_salary' in ctx.payload && 'extra_hour_rate' in ctx.payload && 'calculated_salary' in ctx.payload, 'attendance_records writes snapshot salary columns');
              assert('addon_salary' in ctx.payload && 'addon_enabled' in ctx.payload && 'overtime_enabled' in ctx.payload, 'attendance_records writes add-on and overtime snapshot columns');
              assert('salary_override_enabled' in ctx.payload && 'salary_override_amount' in ctx.payload, 'attendance_records writes manual salary override columns');
              capturedAttendancePayload = ctx.payload;
              return { data: { id: UUID_2, ...ctx.payload, created_at: '2026-05-01' }, error: null };
            }
            return { data: [], error: null };
          }
        },
        (fn, args) => {
          if (fn === 'xos_create_goal_with_savings') {
            sgRow = {
              id: UUID_3,
              name: args.p_title,
              target_amount: args.p_target_amount,
              current_balance: 0,
              created_at: '2026-05-01'
            };
            goalRow = {
              id: UUID_1,
              title: args.p_title,
              description: args.p_description,
              category: args.p_category,
              target_amount: args.p_target_amount,
              progress_percentage: 0,
              priority: args.p_priority,
              status: 'not_started',
              savings_goal_id: UUID_3,
              created_at: '2026-05-01'
            };
            return { data: { goal_id: UUID_1, savings_goal_id: UUID_3 }, error: null };
          }
          return { data: null, error: null };
        }
      );

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(configClient, true);

      await repository.persistSalaryConfig({
        currency: 'USD',
        dailyBaseSalary: 1200,
        addonSalary: 150,
        addonEnabled: true,
        standardWorkingHours: 9,
        extraHourRate: 200,
        overtimeEnabled: true
      });

      assert(capturedSalaryPayload?.currency_code === 'USD', 'salary_configs upsert sends currency_code');
      assert(capturedSalaryPayload?.daily_base_salary === 1200, 'salary_configs upsert sends daily_base_salary');
      assert(capturedSalaryPayload?.addon_salary === 150, 'salary_configs upsert sends addon_salary');
      assert(capturedSalaryPayload?.addon_enabled === true, 'salary_configs upsert sends addon_enabled');
      assert(capturedSalaryPayload?.standard_hours === 9, 'salary_configs upsert sends standard_hours');
      assert(capturedSalaryPayload?.extra_hour_rate === 200, 'salary_configs upsert sends extra_hour_rate');
      assert(capturedSalaryPayload?.overtime_enabled === true, 'salary_configs upsert sends overtime_enabled');

      await repository.addGoal({ title: 'My Goal', description: '', category: 'Personal', targetAmount: 10000, priority: 'Medium' });
      await repository.updateGoal(UUID_1, { title: 'My Dream', targetAmount: 15000, priority: 'High' });
      assert(capturedGoalUpdatePayload?.title === 'My Dream' && capturedGoalUpdatePayload?.target_amount === 15000 && capturedGoalUpdatePayload?.priority === 'high', 'updateGoal writes editable metadata only');
      assert(!('progress_percentage' in capturedGoalUpdatePayload) && !('completed_at' in capturedGoalUpdatePayload), 'updateGoal never directly writes trigger-maintained fields');
      assert(repository.getGoals()[0].progressPercentage === 20 && repository.getGoals()[0].savingsGoalId === UUID_3, 'Goal state hydrated from DB response preserving savingsGoalId');

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
      assert(capturedAttendancePayload.addon_salary === 150, 'attendance_records snapshots addon_salary=150');
      assert(capturedAttendancePayload.addon_enabled === true, 'attendance_records snapshots addon_enabled=true');
      assert(capturedAttendancePayload.overtime_enabled === true, 'attendance_records snapshots overtime_enabled=true');
      assert(capturedAttendancePayload.salary_override_enabled === false, 'attendance_records defaults salary_override_enabled=false');
      assert(capturedAttendancePayload.salary_override_amount === null, 'attendance_records defaults salary_override_amount=null');
      assert(capturedAttendancePayload.calculated_salary === 1550, '1200 + 150 + 1*200 = 1550 snapshot calculated_salary');
      assert(att.dailyEarnedSalary === 1550, 'Mapped dailyEarnedSalary from calculated_salary');
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
          addonSalary: 50,
          addonEnabled: true,
          standardWorkingHours: 8,
          extraHourRate: 120,
          overtimeEnabled: true,
          currency: 'EUR'
        }
      });

      assert(capturedUserSettings.currency_code === 'EUR', 'user_settings persisted currency_code EUR');
      assert(capturedUserSettings.week_starts_on === 1, 'user_settings persisted numeric SMALLINT week_starts_on = 1 for Monday');
      assert(capturedSalaryCfg.currency_code === 'EUR' && capturedSalaryCfg.standard_hours === 8, 'salary_configs persisted currency_code & standard_hours');
      assert(repository.getSettings().currency === 'EUR', 'memoryState updated to EUR');
      assert(repository.getSettings().weekStartDay === 'Monday', 'memoryState weekStartDay hydrated to Monday');
    }
    console.log('✓ Test 15 passed.');

    // =========================================================================
    // TEST 16: week_starts_on Integer Conversion & Falsy-0 Guard
    // =========================================================================
    console.log('Test 16: week_starts_on SMALLINT (0/1) round-trip & falsy-0 guard...');
    {
      assert(toDbWeekStartDay('Sunday') === 0, 'Sunday -> 0');
      assert(toDbWeekStartDay('Monday') === 1, 'Monday -> 1');
      assert(fromDbWeekStartDay(0, 'Monday') === 'Sunday', 'DB 0 -> Sunday even when fallback is Monday');
      assert(fromDbWeekStartDay(1, 'Sunday') === 'Monday', 'DB 1 -> Monday');

      const writtenWeekStarts: any[] = [];
      let persistedRow: any = null;
      const weekClient = createMockSupabase(USER_A, {
        profiles: () => ({ data: { id: USER_A, display_name: 'Tester' }, error: null }),
        user_settings: (ctx) => {
          if (ctx.op === 'upsert') {
            assert(typeof ctx.payload.week_starts_on === 'number', 'week_starts_on MUST be written as integer');
            writtenWeekStarts.push(ctx.payload.week_starts_on);
            persistedRow = { ...ctx.payload };
            return { data: persistedRow, error: null };
          }
          return { data: persistedRow, error: null };
        },
        salary_configs: (ctx) => ({ data: ctx.payload, error: null })
      });

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(weekClient, true);

      await repository.persistSettingsBundle({
        displayName: 'Tester',
        currency: 'INR',
        dateFormat: 'YYYY-MM-DD',
        weekStartDay: 'Sunday',
        customExpenseCategories: ['Food'],
        customIncomeSources: ['Salary'],
        widgets: [{ id: 'w1', name: 'Balance', visible: true, order: 1 }],
        salaryConfig: { dailyBaseSalary: 500, addonSalary: 0, addonEnabled: false, standardWorkingHours: 8, extraHourRate: 100, overtimeEnabled: true, currency: 'INR' }
      });

      assert(writtenWeekStarts[0] === 0, 'Persisting Sunday writes integer 0');
      assert(repository.getSettings().weekStartDay === 'Sunday', 'memoryState preserves Sunday for week_starts_on = 0');

      await repository.fetchAllUserData(USER_A);
      assert(repository.getSettings().weekStartDay === 'Sunday', 'Re-fetching DB row week_starts_on = 0 hydrates Sunday');

      await repository.persistSettingsBundle({
        currency: 'INR',
        dateFormat: 'YYYY-MM-DD',
        weekStartDay: 'Monday',
        customExpenseCategories: ['Food'],
        customIncomeSources: ['Salary'],
        widgets: [{ id: 'w1', name: 'Balance', visible: true, order: 1 }],
        salaryConfig: { dailyBaseSalary: 500, addonSalary: 0, addonEnabled: false, standardWorkingHours: 8, extraHourRate: 100, overtimeEnabled: true, currency: 'INR' }
      });
      assert(writtenWeekStarts[1] === 1, 'Persisting Monday writes integer 1');
      assert(repository.getSettings().weekStartDay === 'Monday', 'memoryState hydrates Monday for 1');
    }
    console.log('✓ Test 16 passed.');

    // =========================================================================
    // TEST 17: attendance_records.status Lowercase DB Enum & Calculations
    // =========================================================================
    console.log('Test 17: attendance_records lowercase DB enum round-trip & salary calculations...');
    {
      assert(toDbAttendanceStatus('Present') === 'present', 'Present -> present');
      assert(toDbAttendanceStatus('Absent') === 'absent', 'Absent -> absent');
      assert(toDbAttendanceStatus('Leave') === 'leave', 'Leave -> leave');
      assert(toDbAttendanceStatus('Holiday') === 'holiday', 'Holiday -> holiday');
      assert(fromDbAttendanceStatus('present') === 'Present', 'present -> Present');
      assert(fromDbAttendanceStatus('absent') === 'Absent', 'absent -> Absent');
      assert(fromDbAttendanceStatus('leave') === 'Leave', 'leave -> Leave');
      assert(fromDbAttendanceStatus('holiday') === 'Holiday', 'holiday -> Holiday');

      const dbAttendanceRows: any[] = [];
      const writtenStatuses: string[] = [];
      const dbSalaryConfig = {
        user_id: USER_A,
        daily_base_salary: 500,
        addon_salary: 0,
        addon_enabled: false,
        standard_hours: 8,
        extra_hour_rate: 100,
        overtime_enabled: true,
        currency_code: 'INR'
      };
      const attClient = createMockSupabase(USER_A, {
        salary_configs: () => ({ data: dbSalaryConfig, error: null }),
        attendance_records: (ctx) => {
          if (ctx.op === 'upsert') {
            writtenStatuses.push(ctx.payload.status);
            assert(
              ctx.payload.status === ctx.payload.status.toLowerCase(),
              `DB status must be lowercase, got ${ctx.payload.status}`
            );
            const saved = { id: `att_${writtenStatuses.length}`, ...ctx.payload, created_at: '2026-05-01' };
            dbAttendanceRows.push(saved);
            return { data: saved, error: null };
          }
          return { data: dbAttendanceRows, error: null };
        }
      });

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(attClient, true);
      await repository.fetchAllUserData(USER_A);

      await repository.upsertAttendanceRecord({ date: '2026-05-01', status: 'Present', checkInTime: '09:00', checkOutTime: '18:00', breakDurationMinutes: 0 });
      await repository.upsertAttendanceRecord({ date: '2026-05-02', status: 'Absent' });
      await repository.upsertAttendanceRecord({ date: '2026-05-03', status: 'Leave' });
      await repository.upsertAttendanceRecord({ date: '2026-05-04', status: 'Holiday' });

      assert(writtenStatuses.join(',') === 'present,absent,leave,holiday', `Expected lowercase statuses, got ${writtenStatuses.join(',')}`);

      // Reload from DB and verify Title Case hydration + salary calculations
      repository.clearUserData();
      await repository.fetchAllUserData(USER_A);
      const loaded = repository.getAttendance();
      assert(loaded.map(r => r.status).join(',') === 'Present,Absent,Leave,Holiday', 'All 4 statuses hydrate to Title Case');

      const summary = calculateMonthlySalarySummary(loaded, [], repository.getSettings().salaryConfig, '2026-05');
      assert(summary.presentDays === 1 && summary.absentDays === 1 && summary.leaveDays === 1 && summary.holidayDays === 1, 'Monthly stats count all 4 statuses after hydration');
      assert(summary.earnedSalary === 600, `Expected 500 + 1*100 = 600 earned salary, got ${summary.earnedSalary}`);
    }
    console.log('✓ Test 17 passed.');

    // =========================================================================
    // TEST 18: Goals & Savings Validation, Strict Priority Mapping, RPC IDs & Trigger-Only Refresh
    // =========================================================================
    console.log('Test 18: Goals targetAmount > 0 validation, strict priority mapping, RPC IDs & trigger-only refresh...');
    {
      assert(toDbGoalStatus('Not Started') === 'not_started', 'Not Started -> not_started');
      assert(toDbGoalStatus('In Progress') === 'in_progress', 'In Progress -> in_progress');
      assert(toDbGoalStatus('Completed') === 'completed', 'Completed -> completed');
      assert(toDbGoalStatus('Paused') === 'paused', 'Paused -> paused');
      assert(fromDbGoalStatus('cancelled') === 'Archived', 'DB cancelled maps cleanly to Archived');
      assert(fromDbGoalStatus('paused') === 'Paused', 'DB paused maps cleanly to Paused');
      let toDbArchivedRejected = false;
      try {
        toDbGoalStatus('Archived');
      } catch {
        toDbArchivedRejected = true;
      }
      assert(toDbArchivedRejected, 'toDbGoalStatus never emits unsupported DB status archived');
      assert(toDbGoalPriority('Low') === 'low' && toDbGoalPriority('Medium') === 'medium' && toDbGoalPriority('High') === 'high', 'Priorities convert to lowercase');
      assert(fromDbGoalPriority('low') === 'Low' && fromDbGoalPriority('medium') === 'Medium' && fromDbGoalPriority('high') === 'High', 'DB priorities hydrate cleanly');

      const dbGoals: any[] = [];
      const dbSavingsGoals: any[] = [];
      const dbSavingsTx: any[] = [];
      let rpcCallCount = 0;
      let failNextRpc = false;
      let returnMissingIds = false;

      const goalsClient = createMockSupabase(
        USER_A,
        {
          goals: (ctx) => {
            if (ctx.op === 'select') {
              const idFilter = ctx.filters.find(f => f.col === 'id')?.val;
              const sgIdFilter = ctx.filters.find(f => f.col === 'savings_goal_id')?.val;
              if (idFilter) {
                return { data: dbGoals.find(g => g.id === idFilter) || null, error: null };
              }
              if (sgIdFilter) {
                return { data: dbGoals.find(g => g.savings_goal_id === sgIdFilter) || null, error: null };
              }
              return { data: dbGoals, error: null };
            }
            if (ctx.op === 'update') {
              assert(!('progress_percentage' in ctx.payload), 'goals update MUST NOT send progress_percentage');
              assert(!('completed_at' in ctx.payload), 'goals update MUST NOT send completed_at');
              assert(!('current_balance' in ctx.payload), 'goals update MUST NOT send current_balance');
              const idFilter = ctx.filters.find(f => f.col === 'id')?.val;
              const idx = dbGoals.findIndex(g => g.id === idFilter);
              if (idx >= 0) {
                dbGoals[idx] = { ...dbGoals[idx], ...ctx.payload };
                return { data: dbGoals[idx], error: null };
              }
              return { data: null, error: { message: 'Goal not found' } };
            }
            return { data: null, error: { message: 'Direct insert disabled' } };
          },
          savings_goals: (ctx) => {
            if (ctx.op === 'select') {
              const idFilter = ctx.filters.find(f => f.col === 'id')?.val;
              if (idFilter) {
                return { data: dbSavingsGoals.find(sg => sg.id === idFilter) || null, error: null };
              }
              return { data: dbSavingsGoals, error: null };
            }
            return { data: null, error: null };
          },
          savings_transactions: (ctx) => {
            if (ctx.op === 'insert') {
              const txRow = { id: `tx_${dbSavingsTx.length + 1}`, ...ctx.payload, created_at: '2026-05-01T00:00:00Z' };
              dbSavingsTx.push(txRow);
              // Simulate DB trigger recalculating current_balance, progress_percentage, status, completed_at
              const sgIdx = dbSavingsGoals.findIndex(sg => sg.id === ctx.payload.savings_goal_id);
              if (sgIdx >= 0) {
                const delta = ctx.payload.transaction_type === 'deposit' ? ctx.payload.amount : -ctx.payload.amount;
                dbSavingsGoals[sgIdx] = {
                  ...dbSavingsGoals[sgIdx],
                  current_balance: Math.max(0, dbSavingsGoals[sgIdx].current_balance + delta)
                };
                const gIdx = dbGoals.findIndex(g => g.savings_goal_id === dbSavingsGoals[sgIdx].id);
                if (gIdx >= 0) {
                  const target = dbGoals[gIdx].target_amount;
                  const bal = dbSavingsGoals[sgIdx].current_balance;
                  const pct = Math.min(100, Math.round((bal / target) * 100));
                  const completed = bal >= target;
                  dbGoals[gIdx] = {
                    ...dbGoals[gIdx],
                    progress_percentage: pct,
                    status: completed ? 'completed' : bal > 0 ? 'in_progress' : 'not_started',
                    completed_at: completed ? '2026-05-02T00:00:00Z' : null
                  };
                }
              }
              return { data: txRow, error: null };
            }
            if (ctx.op === 'delete') {
              const idFilter = ctx.filters.find(f => f.col === 'id')?.val;
              const txIdx = dbSavingsTx.findIndex(t => t.id === idFilter);
              if (txIdx < 0) return { data: [], error: null };
              const [removed] = dbSavingsTx.splice(txIdx, 1);
              const sgIdx = dbSavingsGoals.findIndex(sg => sg.id === removed.savings_goal_id);
              if (sgIdx >= 0) {
                const revDelta = removed.transaction_type === 'deposit' ? -removed.amount : removed.amount;
                dbSavingsGoals[sgIdx] = {
                  ...dbSavingsGoals[sgIdx],
                  current_balance: Math.max(0, dbSavingsGoals[sgIdx].current_balance + revDelta)
                };
                const gIdx = dbGoals.findIndex(g => g.savings_goal_id === dbSavingsGoals[sgIdx].id);
                if (gIdx >= 0) {
                  const target = dbGoals[gIdx].target_amount;
                  const bal = dbSavingsGoals[sgIdx].current_balance;
                  const pct = Math.min(100, Math.round((bal / target) * 100));
                  dbGoals[gIdx] = {
                    ...dbGoals[gIdx],
                    progress_percentage: pct,
                    status: bal > 0 ? 'in_progress' : 'not_started',
                    completed_at: null
                  };
                }
              }
              return { data: [{ id: removed.id }], error: null };
            }
            return { data: dbSavingsTx, error: null };
          }
        },
        (fn, args) => {
          rpcCallCount += 1;
          if (failNextRpc) {
            return { data: null, error: { message: 'RPC check violation' } };
          }
          if (returnMissingIds) {
            return { data: {}, error: null };
          }
          if (fn === 'xos_create_goal_with_savings') {
            assert(typeof args.p_target_amount === 'number' && args.p_target_amount > 0, 'RPC requires p_target_amount > 0');
            assert(['low', 'medium', 'high'].includes(args.p_priority), `Invalid RPC priority: ${args.p_priority}`);
            const sgId = `sg_rpc_${dbSavingsGoals.length + 1}`;
            const gId = `g_rpc_${dbGoals.length + 1}`;
            dbSavingsGoals.push({
              id: sgId,
              name: args.p_title,
              target_amount: args.p_target_amount,
              current_balance: args.p_initial_deposit || 0,
              created_at: '2026-05-01T00:00:00Z'
            });
            dbGoals.push({
              id: gId,
              title: args.p_title,
              description: args.p_description,
              category: args.p_category,
              target_amount: args.p_target_amount,
              progress_percentage: 0,
              priority: args.p_priority,
              status: 'not_started',
              savings_goal_id: sgId,
              created_at: '2026-05-01T00:00:00Z'
            });
            return { data: { goal_id: gId, savings_goal_id: sgId }, error: null };
          }
          if (fn === 'xos_archive_goal') {
            const gIdx = dbGoals.findIndex(g => g.id === args.p_goal_id);
            if (gIdx >= 0) {
              const [removed] = dbGoals.splice(gIdx, 1);
              const sgIdx = dbSavingsGoals.findIndex(sg => sg.id === removed.savings_goal_id);
              if (sgIdx >= 0) dbSavingsGoals.splice(sgIdx, 1);
            }
            return { data: true, error: null };
          }
          return { data: null, error: null };
        }
      );

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(goalsClient, true);

      // Missing, zero, and negative targetAmount must reject BEFORE hitting RPC
      for (const badTarget of [undefined as any, null as any, 0, -250, Number.NaN]) {
        let rejected = false;
        const callsBefore = rpcCallCount;
        try {
          await repository.addGoal({
            title: 'Invalid Target',
            category: 'Financial',
            targetAmount: badTarget,
            priority: 'Medium'
          });
        } catch {
          rejected = true;
        }
        assert(rejected, `targetAmount=${String(badTarget)} must reject before RPC`);
        assert(rpcCallCount === callsBefore, `Invalid targetAmount=${String(badTarget)} must not invoke RPC`);
      }

      // Invalid priority must reject BEFORE hitting RPC
      {
        let badPriorityRejected = false;
        const callsBefore = rpcCallCount;
        try {
          await repository.addGoal({
            title: 'Bad Priority',
            category: 'Financial',
            targetAmount: 1000,
            priority: 'Urgent' as any
          });
        } catch {
          badPriorityRejected = true;
        }
        assert(badPriorityRejected, 'Unsupported priority must reject before RPC');
        assert(rpcCallCount === callsBefore, 'Unsupported priority must not invoke RPC');
      }

      // RPC error surfacing without updating state
      failNextRpc = true;
      let rpcErrMsg = '';
      try {
        await repository.addGoal({ title: 'Fail RPC', category: 'Career', targetAmount: 1000, priority: 'High' });
      } catch (err) {
        rpcErrMsg = err instanceof Error ? err.message : '';
      }
      assert(rpcErrMsg.includes('RPC check violation'), 'RPC error message surfaced cleanly');
      assert(repository.getGoals().length === 0 && repository.getSavingsGoals().length === 0, 'State unchanged on RPC failure');
      failNextRpc = false;

      // Missing returned IDs must error cleanly
      returnMissingIds = true;
      let missingIdsThrew = false;
      try {
        await repository.addGoal({ title: 'Missing IDs', category: 'Career', targetAmount: 1000, priority: 'High' });
      } catch {
        missingIdsThrew = true;
      }
      assert(missingIdsThrew, 'RPC returning missing goal_id/savings_goal_id must throw');
      returnMissingIds = false;

      // Happy-path create across all 3 priorities + trigger refresh on deposit/withdrawal/delete
      const gLow = await repository.addGoal({ title: 'G1', category: 'Career', targetAmount: 1000, priority: 'Low' });
      const gMed = await repository.addGoal({ title: 'G2', category: 'Health', targetAmount: 2000, priority: 'Medium' });
      const gHigh = await repository.addGoal({ title: 'G3', category: 'Financial', targetAmount: 500, priority: 'High' });

      assert(gLow.savingsGoalId === 'sg_rpc_1' && gMed.savingsGoalId === 'sg_rpc_2' && gHigh.savingsGoalId === 'sg_rpc_3', 'Each created goal hydrated with returned savingsGoalId');
      assert(dbGoals.map(g => g.priority).join(',') === 'low,medium,high', 'All 3 goal priorities written in lowercase');

      // Deposit 500 -> DB trigger sets current_balance=500, progress_percentage=100, status='completed', completed_at
      const depTx = await repository.addSavingsTransaction({
        savingsGoalId: gHigh.savingsGoalId,
        amount: 500,
        type: 'deposit',
        date: '2026-05-02'
      });
      const completedGoal = repository.getGoals().find(g => g.id === gHigh.id)!;
      assert(completedGoal.progressPercentage === 100 && completedGoal.status === 'Completed' && Boolean(completedGoal.completedAt), 'Savings deposit refreshed trigger-maintained progress, status, and completedAt on linked Goal');

      // Delete deposit -> DB trigger clears completed_at and resets progress_percentage=0 & status='not_started'
      await repository.deleteSavingsTransaction(depTx.id);
      const revertedGoal = repository.getGoals().find(g => g.id === gHigh.id)!;
      assert(revertedGoal.progressPercentage === 0 && revertedGoal.status === 'Not Started' && revertedGoal.completedAt === undefined, 'Transaction delete refreshed trigger-cleared completedAt and progressPercentage on linked Goal');

      // updateGoal rejects non-positive targetAmount
      let updateRejected = false;
      try {
        await repository.updateGoal(gLow.id, { targetAmount: 0 });
      } catch {
        updateRejected = true;
      }
      assert(updateRejected, 'updateGoal rejects targetAmount <= 0');

      // Archive removes both goal & linked savings account from state
      await repository.deleteGoal(gLow.id);
      assert(!repository.getGoals().some(g => g.id === gLow.id), 'Archived goal removed from state');
      assert(!repository.getSavingsGoals().some(sg => sg.id === gLow.savingsGoalId), 'Archived goal connected savings account removed from state');

      // Simulate DB rows with paused & cancelled status hydrating cleanly (cancelled stays excluded as Archived; paused hydrates as Paused)
      dbGoals.push(
        { id: 'goal_5', title: 'Cancelled One', description: '', category: 'Life', progress_percentage: 20, priority: 'low', status: 'cancelled', savings_goal_id: 'sg_rpc_2', created_at: '2026-05-01' },
        { id: 'goal_paused', title: 'Paused One', description: '', category: 'Life', progress_percentage: 20, priority: 'low', status: 'paused', savings_goal_id: 'sg_rpc_2', created_at: '2026-05-01' }
      );
      repository.clearUserData();
      await repository.fetchAllUserData(USER_A);
      const hydrated = repository.getGoals();
      assert(!hydrated.some(g => g.id === 'goal_5'), 'DB cancelled status is filtered out as Archived on hydrate');
      assert(hydrated.find(g => g.id === 'goal_paused')?.status === 'Paused', 'DB paused status hydrates to Paused safely');
      assert(hydrated.find(g => g.id === gHigh.id)?.savingsGoalId === 'sg_rpc_3', 'Hydrated Goal preserves required savingsGoalId');
    }
    console.log('✓ Test 18 passed.');

    // =========================================================================
    // TEST 19: expenses.recurrence_frequency NULL & Lowercase Validation
    // =========================================================================
    console.log('Test 19: expenses recurrence_frequency NULL vs lowercase CHECK constraint...');
    {
      assert(toDbRecurrenceFrequency(false, 'Monthly') === null, 'isRecurring=false always yields NULL');
      assert(toDbRecurrenceFrequency(false, 'None') === null, 'None yields NULL');
      assert(toDbRecurrenceFrequency(true, 'Daily') === 'daily', 'Daily -> daily');
      assert(toDbRecurrenceFrequency(true, 'Weekly') === 'weekly', 'Weekly -> weekly');
      assert(toDbRecurrenceFrequency(true, 'Monthly') === 'monthly', 'Monthly -> monthly');
      assert(toDbRecurrenceFrequency(true, 'Yearly') === 'yearly', 'Yearly -> yearly');
      assert(fromDbRecurrenceFrequency(false, null) === 'None', 'NULL -> None on hydrate');
      assert(fromDbRecurrenceFrequency(true, 'monthly') === 'Monthly', 'monthly -> Monthly on hydrate');

      const dbExpenses: any[] = [];
      let expUpdatePayload: any = null;
      const expClient = createMockSupabase(USER_A, {
        expenses: (ctx) => {
          if (ctx.op === 'insert') {
            if (!ctx.payload.is_recurring) {
              assert(ctx.payload.recurrence_frequency === null, 'Non-recurring expense MUST store recurrence_frequency = NULL');
            } else {
              assert(['daily', 'weekly', 'monthly', 'yearly'].includes(ctx.payload.recurrence_frequency), `Recurring frequency must be lowercase allowed enum, got ${ctx.payload.recurrence_frequency}`);
            }
            const row = { id: `exp_${dbExpenses.length + 1}`, ...ctx.payload, created_at: '2026-05-01' };
            dbExpenses.push(row);
            return { data: row, error: null };
          }
          if (ctx.op === 'update') {
            expUpdatePayload = ctx.payload;
            const idFilter = ctx.filters.find(f => f.col === 'id')?.val;
            const idx = dbExpenses.findIndex(e => e.id === idFilter);
            dbExpenses[idx] = { ...dbExpenses[idx], ...ctx.payload };
            return { data: dbExpenses[idx], error: null };
          }
          return { data: dbExpenses, error: null };
        }
      });

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(expClient, true);

      // Non-recurring with 'None' writes NULL
      const nonRec = await repository.addExpense({
        title: 'Lunch', amount: 250, category: 'Food', date: '2026-05-01', paymentMethod: 'Cash', isRecurring: false, recurringFrequency: 'None'
      });
      assert(dbExpenses[0].recurrence_frequency === null && nonRec.recurringFrequency === 'None', 'Non-recurring stores NULL and hydrates as None');

      // Invalid: isRecurring=true with 'None' MUST reject before hitting DB
      let invalidRejected = false;
      try {
        await repository.addExpense({
          title: 'Bad Rec', amount: 100, category: 'Other', date: '2026-05-01', paymentMethod: 'Cash', isRecurring: true, recurringFrequency: 'None'
        });
      } catch {
        invalidRejected = true;
      }
      assert(invalidRejected, 'isRecurring=true with None must reject before DB write');

      // Valid recurring expenses
      const recMonthly = await repository.addExpense({
        title: 'Fiber Internet', amount: 999, category: 'Utilities', date: '2026-05-01', paymentMethod: 'Bank Transfer', isRecurring: true, recurringFrequency: 'Monthly', recurrenceEndDate: '2026-12-31'
      });
      assert(dbExpenses[1].recurrence_frequency === 'monthly' && recMonthly.recurringFrequency === 'Monthly', 'Monthly stored lowercase and hydrated Title Case');

      // Turning off recurrence on update MUST clear recurrence_frequency & recurrence_end_date to NULL
      await repository.updateExpense('exp_2', { isRecurring: false });
      assert(expUpdatePayload.is_recurring === false && expUpdatePayload.recurrence_frequency === null && expUpdatePayload.recurrence_end_date === null, 'Disabling isRecurring sets recurrence_frequency & recurrence_end_date to NULL');
      assert(repository.getExpenses().find(e => e.id === 'exp_2')?.recurringFrequency === 'None', 'Updated state shows None when recurrence turned off');
    }
    console.log('✓ Test 19 passed.');

    // =========================================================================
    // TEST 20: Salary Payout Timezone UTC Conversion & IST (+05:30) Midnight Round-Trip
    // =========================================================================
    console.log('Test 20: Salary payout real UTC conversion & IST (+05:30) midnight round-trip...');
    {
      // IST is UTC+05:30 (+330 minutes).
      // Instant: 2026-05-30T19:00:00.000Z === 2026-05-31 00:30:00 IST
      const istMidnightNow = new Date('2026-05-30T19:00:00.000Z');
      const istConv = localDateInputToUtcIso('2026-05-31', istMidnightNow, 330);
      assert(istConv.paidAtIso === '2026-05-30T19:00:00.000Z', `Expected true UTC 2026-05-30T19:00:00.000Z, got ${istConv.paidAtIso}`);
      assert(istConv.localDate === '2026-05-31', `Expected local IST date 2026-05-31, got ${istConv.localDate}`);
      assert(istConv.localTime === '00:30:00', `Expected local IST time 00:30:00, got ${istConv.localTime}`);

      // Hydrating UTC timestamp near midnight back in IST (+330) vs UTC (0)
      assert(utcTimestampToLocalDate('2026-05-30T19:00:00Z', 330) === '2026-05-31', 'UTC 19:00 hydrates to 2026-05-31 in IST (+05:30), NOT 2026-05-30');
      assert(utcTimestampToLocalDate('2026-05-30T19:00:00Z', 0) === '2026-05-30', 'UTC 19:00 hydrates to 2026-05-30 in UTC');

      // Verify repository recordSalaryPayout sends true UTC ISO matching local date -> UTC -> local date round-trip
      let capturedRpcArgs: any = null;
      const tzClient = createMockSupabase(
        USER_A,
        {},
        (fn, args) => {
          if (fn === 'xos_record_salary_payout') {
            capturedRpcArgs = args;
            return {
              data: {
                payout: {
                  id: UUID_1,
                  period_start: args.p_period_start,
                  period_end: args.p_period_end,
                  amount_paid: args.p_amount_paid,
                  paid_at: args.p_paid_at,
                  notes: args.p_notes,
                  created_at: args.p_paid_at
                },
                income: null
              },
              error: null
            };
          }
          return { data: null, error: null };
        }
      );

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(tzClient, true);

      const savedTzPayout = await repository.recordSalaryPayout(
        { periodStart: '2026-05-01', periodEnd: '2026-05-31', amountPaid: 8000, paidAt: '2026-05-31', notes: 'TZ check' },
        false,
        false
      );
      assert(capturedRpcArgs.p_income_date === '2026-05-31', 'Income date matches local date');
      assert(/^\d{2}:\d{2}:\d{2}$/.test(capturedRpcArgs.p_income_time), 'Income time normalized to HH:mm:ss');
      assert(!isNaN(new Date(capturedRpcArgs.p_paid_at).getTime()), 'p_paid_at is valid ISO timestamp');
      assert(savedTzPayout.paidAt === '2026-05-31', `Round-trip paidAt must equal 2026-05-31, got ${savedTzPayout.paidAt}`);
    }
    console.log('✓ Test 20 passed.');

    // =========================================================================
    // TEST 21: persistSettingsBundle Partial-Save Failure Reconciliation
    // =========================================================================
    console.log('Test 21: persistSettingsBundle partial-save failure only reconciles succeeded tables...');
    {
      let failSalaryConfig = true;
      let failUserSettings = false;

      const partialSaveClient = createMockSupabase(USER_A, {
        user_settings: (ctx) => {
          if (failUserSettings) return { data: null, error: { message: 'user_settings constraint error' } };
          return { data: ctx.payload, error: null };
        },
        salary_configs: (ctx) => {
          if (failSalaryConfig) return { data: null, error: { message: 'salary_configs check violation' } };
          return { data: ctx.payload, error: null };
        },
        profiles: (ctx) => ({ data: { id: USER_A, display_name: ctx.payload.display_name }, error: null })
      });

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(partialSaveClient, true);

      // Clean initial state: INR, Monday, salaryConfig unconfigured (undefined rates, isConfigured=false)
      assert(repository.getSettings().salaryConfig.dailyBaseSalary === undefined, 'Initial dailyBaseSalary is undefined');
      assert(repository.getSettings().salaryConfig.isConfigured === false, 'Initial salaryConfig isConfigured is false');

      let partialErr: any = null;
      try {
        await repository.persistSettingsBundle({
          displayName: 'Updated Name',
          currency: 'EUR',
          dateFormat: 'DD/MM/YYYY',
          weekStartDay: 'Sunday',
          customExpenseCategories: ['Food'],
          customIncomeSources: ['Salary'],
          widgets: [{ id: 'w1', name: 'Balance', visible: true, order: 1 }],
          salaryConfig: { dailyBaseSalary: 999, addonSalary: 0, addonEnabled: false, standardWorkingHours: 9, extraHourRate: 250, overtimeEnabled: true, currency: 'EUR', isConfigured: true }
        });
      } catch (err) {
        partialErr = err;
      }

      assert(partialErr instanceof SettingsBundleSaveError, 'Must throw SettingsBundleSaveError on partial failure');
      assert(partialErr.succeededSections.includes('user_settings') && partialErr.succeededSections.includes('profiles'), 'Reports user_settings and profiles succeeded');
      assert(partialErr.failedSections.some((f: any) => f.section === 'salary_configs'), 'Reports salary_configs failed');
      assert(partialErr.message.includes('Partial save') && partialErr.message.includes('Salary Configuration'), 'Error message explains succeeded vs failed sections');

      // Succeeded sections ARE reconciled into memoryState, while failed salary_configs MUST stay unconfigured!
      assert(repository.getSettings().currency === 'EUR', 'Reconciled succeeded user_settings currency EUR');
      assert(repository.getSettings().weekStartDay === 'Sunday', 'Reconciled succeeded user_settings Sunday (0)');
      assert(repository.getSettings().profile.name === 'Updated Name', 'Reconciled succeeded profiles displayName');
      assert(repository.getSettings().salaryConfig.dailyBaseSalary === undefined, 'Failed salary_configs MUST NOT overwrite memoryState with unsaved 999');
      assert(repository.getSettings().salaryConfig.isConfigured === false, 'Failed salary_configs preserves unconfigured state');

      // Now flip: user_settings fails while salary_configs succeeds
      failUserSettings = true;
      failSalaryConfig = false;
      let secondErr: any = null;
      try {
        await repository.persistSettingsBundle({
          displayName: 'Updated Name',
          currency: 'USD',
          dateFormat: 'MM/DD/YYYY',
          weekStartDay: 'Monday',
          customExpenseCategories: ['Other'],
          customIncomeSources: ['Other'],
          widgets: [{ id: 'w1', name: 'Balance', visible: true, order: 1 }],
          salaryConfig: { dailyBaseSalary: 1200, addonSalary: 100, addonEnabled: true, standardWorkingHours: 8, extraHourRate: 150, overtimeEnabled: true, currency: 'USD' }
        });
      } catch (err) {
        secondErr = err;
      }

      assert(secondErr instanceof SettingsBundleSaveError, 'Must throw SettingsBundleSaveError when user_settings fails');
      assert(secondErr.failedSections.some((f: any) => f.section === 'user_settings'), 'Reports user_settings failed');
      assert(repository.getSettings().salaryConfig.dailyBaseSalary === 1200, 'Reconciled succeeded salary_configs (1200)');
      assert(repository.getSettings().currency === 'EUR', 'Failed user_settings did NOT overwrite saved EUR with USD');
      assert(repository.getSettings().weekStartDay === 'Sunday', 'Failed user_settings did NOT overwrite saved Sunday with Monday');
    }
    console.log('✓ Test 21 passed.');

    // Test 22: Debt Direction Serialization & Deserialization Edge Cases
    {
      // 1. [Pay] Rent -> direction pay, description Rent
      const r1 = deserializeDebtDescription('[Pay] Rent');
      assert(r1.direction === 'pay' && r1.description === 'Rent', '[Pay] Rent parsed correctly');

      // 2. [pAy] Rent -> direction pay, description Rent
      const r2 = deserializeDebtDescription('[pAy] Rent');
      assert(r2.direction === 'pay' && r2.description === 'Rent', '[pAy] Rent parsed correctly');

      // 3. [ReCeIvE] Dinner -> direction receive, description Dinner
      const r3 = deserializeDebtDescription('[ReCeIvE] Dinner');
      assert(r3.direction === 'receive' && r3.description === 'Dinner', '[ReCeIvE] Dinner parsed correctly');

      // 4. [PAY] [RECEIVE] Rent -> clean description Rent (first recognized direction wins)
      const r4 = deserializeDebtDescription('[PAY] [RECEIVE] Rent');
      assert(r4.direction === 'pay' && r4.description === 'Rent', 'Multiple consecutive prefixes parsed correctly');

      // 5. Bought item [PAY] store -> preserve entire description
      const r5 = deserializeDebtDescription('Bought item [PAY] store');
      assert(r5.direction === 'receive' && r5.description === 'Bought item [PAY] store', 'Middle prefix-like text preserved');

      // 6. Empty description -> correct canonical prefix
      const s1 = serializeDebtDescription('pay', '');
      assert(s1 === '[PAY]', 'Empty description serializes to canonical [PAY]');
      const s2 = serializeDebtDescription('receive', undefined);
      assert(s2 === '[RECEIVE]', 'Undefined description serializes to canonical [RECEIVE]');

      // 7. Direction change -> exactly one prefix matching new direction
      const updated = serializeDebtDescription('pay', '[RECEIVE] Rent');
      assert(updated === '[PAY] Rent', 'Direction change produces exactly one correct prefix');

      // 8. Description-only edit -> direction remains unchanged
      const descEdit = serializeDebtDescription('pay', 'New Rent Desc');
      assert(descEdit === '[PAY] New Rent Desc', 'Description-only edit preserves direction');

      // 9. Other-field edit -> direction and description remain unchanged
      const otherEdit = serializeDebtDescription('pay', '[PAY] Rent');
      assert(otherEdit === '[PAY] Rent', 'Other-field edit preserves direction and description');
    }
    console.log('✓ Test 22 passed.');

    // =========================================================================
    // TEST 23: Full Account Data Reset via xos_reset_user_data() RPC
    // =========================================================================
    console.log('Test 23: Full account data reset via xos_reset_user_data() RPC...');
    {
      let rpcCallCount = 0;
      let tableDeleteCount = 0;
      let rpcMode: 'error' | 'null' | 'false' | 'obj_false' | 'empty_obj' | 'status_error' | 'status_ok' | 'obj_true' | 'bool_true' = 'obj_true';
      let isResetOnBackend = false;

      const dbState = {
        expenses: [{ id: UUID_1, title: 'Old Expense', amount: 100, category: 'Food', expense_date: '2026-05-01', payment_method: 'Cash', is_recurring: false, created_at: '2026-05-01' }],
        incomes: [{ id: UUID_2, title: 'Old Income', amount: 5000, source: 'Salary', income_date: '2026-05-01', created_at: '2026-05-01' }],
        debts: [{ id: UUID_3, person_name: 'Bob', original_amount: 400, remaining_amount: 400, lent_date: '2026-05-01', description: '[RECEIVE] Lunch', status: 'outstanding', created_at: '2026-05-01' }],
        debt_repayments: [{ id: UUID_4, debt_id: UUID_3, amount: 100, repayment_date: '2026-05-02', created_at: '2026-05-02' }],
        attendance_records: [{ id: UUID_1, attendance_date: '2026-05-01', status: 'present', break_minutes: 0, hours_worked: 8, extra_hours: 0, calculated_salary: 500 }],
        savings_goals: [{ id: UUID_2, name: 'Car', target_amount: 10000, current_balance: 500, created_at: '2026-05-01' }],
        savings_transactions: [{ id: UUID_3, savings_goal_id: UUID_2, amount: 500, transaction_type: 'deposit', transaction_date: '2026-05-01', created_at: '2026-05-01' }],
        salary_payouts: [{ id: UUID_4, period_start: '2026-05-01', period_end: '2026-05-31', amount_paid: 5000, paid_at: '2026-05-31T10:00:00Z', created_at: '2026-05-31' }],
        goals: [{ id: UUID_1, title: 'Buy Car', description: '', category: 'Financial', target_amount: 10000, progress_percentage: 5, priority: 'high', status: 'in_progress', savings_goal_id: UUID_2, created_at: '2026-05-01' }],
        user_settings: { user_id: USER_A, currency_code: 'USD', date_format: 'MM/DD/YYYY', week_starts_on: 0, expense_categories: ['CustomCat'], income_sources: ['CustomInc'] },
        salary_configs: { user_id: USER_A, currency_code: 'USD', daily_base_salary: 900, standard_hours: 9, extra_hour_rate: 150 },
        profiles: { id: USER_A, display_name: 'Preserved User', avatar_url: 'https://example.com/a.png' }
      };

      const makeResetClient = (sessionUid: string | null) =>
        createMockSupabase(
          sessionUid,
          {
            expenses: (ctx) => { if (ctx.op === 'delete') tableDeleteCount++; return { data: isResetOnBackend ? [] : dbState.expenses, error: null }; },
            incomes: (ctx) => { if (ctx.op === 'delete') tableDeleteCount++; return { data: isResetOnBackend ? [] : dbState.incomes, error: null }; },
            debts: (ctx) => { if (ctx.op === 'delete') tableDeleteCount++; return { data: isResetOnBackend ? [] : dbState.debts, error: null }; },
            debt_repayments: (ctx) => { if (ctx.op === 'delete') tableDeleteCount++; return { data: isResetOnBackend ? [] : dbState.debt_repayments, error: null }; },
            attendance_records: (ctx) => { if (ctx.op === 'delete') tableDeleteCount++; return { data: isResetOnBackend ? [] : dbState.attendance_records, error: null }; },
            savings_goals: (ctx) => { if (ctx.op === 'delete') tableDeleteCount++; return { data: isResetOnBackend ? [] : dbState.savings_goals, error: null }; },
            savings_transactions: (ctx) => { if (ctx.op === 'delete') tableDeleteCount++; return { data: isResetOnBackend ? [] : dbState.savings_transactions, error: null }; },
            salary_payouts: (ctx) => { if (ctx.op === 'delete') tableDeleteCount++; return { data: isResetOnBackend ? [] : dbState.salary_payouts, error: null }; },
            goals: (ctx) => { if (ctx.op === 'delete') tableDeleteCount++; return { data: isResetOnBackend ? [] : dbState.goals, error: null }; },
            user_settings: (ctx) => {
              if (ctx.op === 'delete') tableDeleteCount++;
              return {
                data: isResetOnBackend
                  ? { user_id: USER_A, currency_code: 'INR', date_format: 'YYYY-MM-DD', week_starts_on: 1 }
                  : dbState.user_settings,
                error: null
              };
            },
            salary_configs: (ctx) => {
              if (ctx.op === 'delete') tableDeleteCount++;
              return {
                data: isResetOnBackend
                  ? { user_id: USER_A, currency_code: 'INR', daily_base_salary: null, standard_hours: null, extra_hour_rate: null, overtime_enabled: false, addon_enabled: false, addon_salary: 0 }
                  : dbState.salary_configs,
                error: null
              };
            },
            profiles: (ctx) => {
              if (ctx.op === 'delete') tableDeleteCount++;
              return { data: dbState.profiles, error: null };
            }
          },
          async (fn) => {
            if (fn === 'xos_reset_user_data') {
              rpcCallCount++;
              await new Promise(resolve => setTimeout(resolve, 15));
              if (rpcMode === 'error') return { data: null, error: { message: 'RLS/Auth rejected reset' } };
              if (rpcMode === 'false') return { data: false, error: null };
              if (rpcMode === 'obj_false') return { data: { success: false, message: 'Server aborted reset' }, error: null };
              if (rpcMode === 'empty_obj') return { data: {}, error: null };
              if (rpcMode === 'status_error') return { data: { status: 'error', message: 'Reset failed' }, error: null };
              isResetOnBackend = true;
              if (rpcMode === 'null') return { data: null, error: null };
              if (rpcMode === 'status_ok') return { data: { status: 'ok' }, error: null };
              return { data: rpcMode === 'bool_true' ? true : { success: true }, error: null };
            }
            return { data: null, error: { message: `Unexpected RPC ${fn}` } };
          }
        );

      // Hydrate populated user data first
      const resetClient = makeResetClient(USER_A);
      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(resetClient, true);
      await repository.fetchAllUserData(USER_A);
      repository.saveSettings({
        ...repository.getSettings(),
        profile: { ...repository.getSettings().profile, email: 'musthafa@test.local' }
      });

      assert(repository.getExpenses().length === 1 && repository.getGoals().length === 1 && repository.getSettings().currency === 'USD', 'Pre-reset state is populated');

      // Seed API cache to verify invalidation timing
      let cacheComputeCount = 0;
      await apiOptimization.fetchWithCache('reset-test-cache', async () => ++cacheComputeCount, 60000);
      assert(cacheComputeCount === 1, 'Cache seeded');

      // 1) Unauthenticated session must reject without calling RPC or clearing state/cache
      (resetClient as any).__setSessionUserId(null);
      let unauthRejected = false;
      try {
        await repository.resetUserData();
      } catch {
        unauthRejected = true;
      }
      assert(unauthRejected && rpcCallCount === 0, 'Unauthenticated reset rejected before calling RPC');
      assert(repository.getExpenses().length === 1, 'State preserved when session missing');

      // Restore authenticated session
      (resetClient as any).__setSessionUserId(USER_A);

      // 2) RPC errors and falsy/invalid success confirmations must reject WITHOUT clearing cache or local state
      for (const badMode of ['error', 'false', 'obj_false', 'empty_obj', 'status_error'] as const) {
        rpcMode = badMode;
        let failed = false;
        try {
          await repository.resetUserData();
        } catch {
          failed = true;
        }
        assert(failed, `Reset mode '${badMode}' must throw`);
        assert(repository.getExpenses().length === 1 && repository.getGoals().length === 1, `Mode '${badMode}' preserved in-memory state`);
        await apiOptimization.fetchWithCache('reset-test-cache', async () => ++cacheComputeCount, 60000);
        assert(cacheComputeCount === 1, `Mode '${badMode}' did NOT invalidate cache on failure`);
      }

      // 3) Duplicate concurrent triggers while in-flight coalesce to ONE RPC call
      rpcMode = 'obj_true';
      rpcCallCount = 0;
      await Promise.all([repository.resetUserData(), repository.resetUserData()]);
      assert(rpcCallCount === 1, `Concurrent resetUserData calls coalesced into 1 RPC call (got ${rpcCallCount})`);
      assert(tableDeleteCount === 0, `Frontend issued ZERO direct table DELETE calls (got ${tableDeleteCount})`);

      // Verify cache was invalidated on confirmed reset success
      await apiOptimization.fetchWithCache('reset-test-cache', async () => ++cacheComputeCount, 60000);
      assert(cacheComputeCount === 2, 'API cache invalidated after confirmed reset success');

      // Verify all module collections are cleared and backend default settings + preserved profile hydrated
      assert(repository.getExpenses().length === 0, 'Expenses cleared');
      assert(repository.getIncomes().length === 0, 'Incomes cleared');
      assert(repository.getAttendance().length === 0, 'Attendance cleared');
      assert(repository.getDebts().length === 0, 'Debts cleared');
      assert(repository.getDebtRepayments().length === 0, 'Debt repayments cleared');
      assert(repository.getGoals().length === 0, 'Goals cleared');
      assert(repository.getSavingsGoals().length === 0, 'Savings goals cleared');
      assert(repository.getSavingsTransactions().length === 0, 'Savings transactions cleared');
      assert(repository.getSalaryPayouts().length === 0, 'Salary payouts cleared');
      assert(repository.getActiveUserId() === USER_A, 'Authenticated activeUserId preserved');
      assert(repository.getSettings().currency === 'INR', 'Settings reset to INR default from backend');
      assert(repository.getSettings().dateFormat === 'YYYY-MM-DD', 'Date format reset to default');
      assert(repository.getSettings().weekStartDay === 'Monday', 'Week start reset to default');
      assert(repository.getSettings().salaryConfig.dailyBaseSalary === undefined, 'Salary config dailyBaseSalary cleared on reset');
      assert(repository.getSettings().salaryConfig.standardWorkingHours === undefined, 'Salary config standardWorkingHours cleared on reset');
      assert(repository.getSettings().salaryConfig.extraHourRate === undefined, 'Salary config extraHourRate cleared on reset');
      assert(repository.getSettings().salaryConfig.overtimeEnabled === false, 'Salary config overtimeEnabled reset to false');
      assert(repository.getSettings().salaryConfig.isConfigured === false, 'Salary config marked unconfigured after reset');
      assert(repository.getSettings().profile.name === 'Preserved User', 'Preserved profile display_name hydrated from profiles');
      assert(repository.getSettings().profile.email === 'musthafa@test.local', 'Authenticated profile email preserved');

      // 4) Boolean true, status:'ok', and PostgreSQL RETURNS void (null data with null error) accepted cleanly
      rpcMode = 'bool_true';
      await repository.resetUserData();
      assert(repository.getActiveUserId() === USER_A, 'Boolean true RPC response succeeded cleanly');

      rpcMode = 'status_ok';
      await repository.resetUserData();
      assert(repository.getActiveUserId() === USER_A, 'Status ok RPC response succeeded cleanly');

      rpcMode = 'null';
      await repository.resetUserData();
      assert(repository.getActiveUserId() === USER_A, 'PostgreSQL RETURNS void (null data, null error) RPC response succeeded cleanly');
    }
    console.log('✓ Test 23 passed.');

    // =========================================================================
    // TEST 24: Consecutive Debt Creation (3rd+ Record), Independent Abort Lifecycle & AbortError Reconciliation
    // =========================================================================
    console.log('Test 24: Consecutive debt creation (1st..4th), independent fetch AbortControllers, and AbortError handling...');
    {
      // A) Verify createOptimizedFetch uses independent AbortControllers, respects writeTimeoutMs > readTimeoutMs,
      //    and does not let one caller's abort signal cancel another coalesced GET request.
      const originalFetch = globalThis.fetch;
      const seenSignals: AbortSignal[] = [];
      try {
        globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (init?.signal) seenSignals.push(init.signal);
          const method = (init?.method || 'GET').toUpperCase();
          const delayMs = method === 'POST' ? 60 : 15;
          await new Promise<void>((resolve, reject) => {
            if (init?.signal?.aborted) {
              reject(init.signal.reason ?? new DOMException('Fetch is aborted', 'AbortError'));
              return;
            }
            const timer = setTimeout(() => {
              init?.signal?.removeEventListener('abort', onAbort);
              resolve();
            }, delayMs);
            const onAbort = () => {
              clearTimeout(timer);
              reject(init?.signal?.reason ?? new DOMException('Fetch is aborted', 'AbortError'));
            };
            init?.signal?.addEventListener('abort', onAbort, { once: true });
          });
          return new Response(JSON.stringify({ ok: true }), { status: method === 'POST' ? 201 : 200 });
        }) as typeof fetch;

        const optimizedFetch = apiOptimization.createOptimizedFetch(25, 300);

        // 4 consecutive POST writes taking 60ms (> 25ms read timeout, < 300ms write timeout) must all succeed
        for (let i = 0; i < 4; i++) {
          const res = await optimizedFetch('https://example.supabase.co/rest/v1/debts', {
            method: 'POST',
            headers: { Authorization: 'Bearer tok-1' },
            body: JSON.stringify({ n: i + 1 })
          });
          assert(res.status === 201, `Consecutive POST #${i + 1} must succeed without 25ms read timeout abort`);
        }

        assert(seenSignals.length === 4, 'Each POST request received its own AbortSignal');
        assert(new Set(seenSignals).size === 4, 'All 4 POST requests used distinct AbortController instances');
        assert(seenSignals.every(sig => !sig.aborted), 'Completed POST requests did not leave aborted signals');

        // Caller-aborted GET must NOT abort an un-signaled coalesced GET to the same URL
        const callerAC = new AbortController();
        const coalescedGet = optimizedFetch('https://example.supabase.co/rest/v1/debts?select=*', {
          method: 'GET',
          headers: { Authorization: 'Bearer tok-1' }
        });
        const signaledGet = optimizedFetch('https://example.supabase.co/rest/v1/debts?select=*', {
          method: 'GET',
          headers: { Authorization: 'Bearer tok-1' },
          signal: callerAC.signal
        });
        callerAC.abort();

        let signaledFailed = false;
        try {
          await signaledGet;
        } catch (err: any) {
          signaledFailed = err?.name === 'AbortError';
        }
        assert(signaledFailed, 'Caller-aborted GET rejected with AbortError');
        const sharedGetRes = await coalescedGet;
        assert(sharedGetRes.status === 200, 'Uncancelled GET succeeded independently');

        // Exceeding writeTimeoutMs produces TimeoutError, not ambiguous AbortError
        const shortWriteFetch = apiOptimization.createOptimizedFetch(20, 30);
        let timedOutName = '';
        try {
          await shortWriteFetch('https://example.supabase.co/rest/v1/debts', { method: 'POST' });
        } catch (err: any) {
          timedOutName = err?.name || '';
        }
        assert(timedOutName === 'TimeoutError', `Expired write timeout surfaces TimeoutError (got ${timedOutName})`);
      } finally {
        globalThis.fetch = originalFetch;
      }

      // B) Verify 1st, 2nd, 3rd, and 4th consecutive addDebt calls persist both [RECEIVE] and [PAY] directions,
      //    and genuine AbortError neither retries blindly nor corrupts existing debts, while reconciling committed writes.
      const dbDebts: any[] = [];
      let insertCount = 0;
      let nextDebtMode: 'success' | 'abort_uncommitted' | 'abort_committed' = 'success';

      const debtCrudClient = createMockSupabase(USER_A, {
        debts: (ctx) => {
          if (ctx.op === 'insert') {
            insertCount += 1;
            if (nextDebtMode === 'abort_uncommitted') {
              return { data: null, error: { message: 'AbortError: Fetch is aborted' } };
            }
            const row = {
              id: `00000000-0000-4000-8000-00000000000${insertCount}`,
              ...ctx.payload,
              remaining_amount: ctx.payload.original_amount,
              status: 'outstanding',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };
            dbDebts.unshift(row);
            if (nextDebtMode === 'abort_committed') {
              return { data: null, error: { message: 'AbortError: Fetch is aborted' } };
            }
            return { data: row, error: null };
          }
          if (ctx.op === 'select') {
            const nameFilter = ctx.filters.find(f => f.col === 'person_name')?.val;
            const dateFilter = ctx.filters.find(f => f.col === 'lent_date')?.val;
            const filtered = dbDebts.filter(
              r => (!nameFilter || r.person_name === nameFilter) && (!dateFilter || r.lent_date === dateFilter)
            );
            return { data: filtered, error: null };
          }
          return { data: [], error: null };
        }
      });

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(debtCrudClient, true);

      // 1st debt (receive)
      const d1 = await repository.addDebt({
        person_name: 'Alice',
        original_amount: 500,
        lent_date: '2026-11-10',
        direction: 'receive'
      });
      // 2nd debt (pay)
      const d2 = await repository.addDebt({
        person_name: 'Bob',
        original_amount: 300,
        lent_date: '2026-11-11',
        direction: 'pay'
      });
      // 3rd debt (receive)
      const d3 = await repository.addDebt({
        person_name: 'Charlie',
        original_amount: 750,
        lent_date: '2026-11-12',
        direction: 'receive'
      });
      // 4th debt (pay)
      const d4 = await repository.addDebt({
        person_name: 'Diana',
        original_amount: 200,
        lent_date: '2026-11-13',
        direction: 'pay'
      });

      assert(repository.getDebts().length === 4, `All 4 consecutive debts persisted (got ${repository.getDebts().length})`);
      assert(d1.direction === 'receive' && d2.direction === 'pay' && d3.direction === 'receive' && d4.direction === 'pay', 'Directions preserved across consecutive debts');

      // Genuine AbortError where row did NOT reach DB: must NOT auto-retry insert and must surface DebtRequestAbortError
      const insertsBeforeAbort = insertCount;
      nextDebtMode = 'abort_uncommitted';
      let caughtAbort: Error | null = null;
      try {
        await repository.addDebt({
          person_name: 'Eve',
          original_amount: 999,
          lent_date: '2026-11-13',
          direction: 'receive'
        });
      } catch (err) {
        caughtAbort = err as Error;
      }
      assert(caughtAbort !== null && caughtAbort.name === 'DebtRequestAbortError', `Uncommitted AbortError throws DebtRequestAbortError (got ${caughtAbort?.name})`);
      assert(insertCount === insertsBeforeAbort + 1, 'Aborted addDebt did NOT automatically retry INSERT');
      assert(repository.getDebts().length === 4, 'Existing 4 debt records remained intact after aborted 5th attempt');

      // AbortError where server DID commit before response arrived: reconciles via SELECT with zero duplicate insert
      const insertsBeforeReconcile = insertCount;
      nextDebtMode = 'abort_committed';
      const d5 = await repository.addDebt({
        person_name: 'Frank',
        original_amount: 420,
        lent_date: '2026-11-13',
        direction: 'pay'
      });
      assert(insertCount === insertsBeforeReconcile + 1, 'Committed-but-aborted addDebt reconciled via SELECT without duplicate INSERT');
      assert(d5.person_name === 'Frank' && d5.direction === 'pay', 'Reconciled debt preserves name and [PAY] direction');
      assert(repository.getDebts().length === 5, 'Debt list updated cleanly to 5 records with zero duplicates');
    }
    console.log('✓ Test 24 passed.');

    // ==========================================
    // TEST 25: Per-Date Salary Override & Historical Snapshot Persistence (Supabase Mock)
    // ==========================================
    console.log('Test 25: Per-date salary override & historical snapshot persistence...');
    {
      const savedAttendanceRows: any[] = [];
      let savedSalaryConfigRow: any = {
        id: 'sal_cfg_1',
        user_id: USER_A,
        daily_base_salary: 500,
        addon_salary: 0,
        addon_enabled: false,
        standard_hours: 8,
        extra_hour_rate: 100,
        overtime_enabled: true,
        currency_code: 'INR',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const salaryMockClient = createMockSupabase(USER_A, {
        attendance_records: (ctx) => {
          if (ctx.op === 'upsert') {
            const row = {
              id: `att_${savedAttendanceRows.length + 1}`,
              ...ctx.payload,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };
            const existingIdx = savedAttendanceRows.findIndex(r => r.attendance_date === row.attendance_date);
            if (existingIdx >= 0) {
              savedAttendanceRows[existingIdx] = row;
            } else {
              savedAttendanceRows.unshift(row);
            }
            return { data: row, error: null };
          }
          return { data: savedAttendanceRows, error: null };
        },
        salary_configs: (ctx) => {
          if (ctx.op === 'upsert') {
            savedSalaryConfigRow = {
              ...savedSalaryConfigRow,
              ...ctx.payload
            };
            return { data: savedSalaryConfigRow, error: null };
          }
          return { data: savedSalaryConfigRow, error: null };
        }
      });

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(salaryMockClient, true);
      await repository.persistSalaryConfig({
        dailyBaseSalary: 500,
        addonSalary: 0,
        addonEnabled: false,
        standardWorkingHours: 8,
        extraHourRate: 100,
        overtimeEnabled: true,
        currency: 'INR'
      });

      const customDay = await repository.upsertAttendanceRecord({
        date: '2026-07-04',
        status: 'Present',
        calculatedHours: 10,
        dailyBaseSalary: 800,
        extraHourRate: 150,
        salaryOverrideEnabled: true,
        salaryOverrideAmount: 1250,
        notes: 'Holiday shift bonus'
      });

      assert(savedAttendanceRows.length === 1, 'One attendance_records row upserted');
      assert(savedAttendanceRows[0].daily_base_salary === 800, 'DB daily_base_salary reflects custom day rate 800');
      assert(savedAttendanceRows[0].extra_hour_rate === 150, 'DB extra_hour_rate reflects custom overtime rate 150');
      assert(savedAttendanceRows[0].salary_override_enabled === true, 'DB salary_override_enabled persists true');
      assert(savedAttendanceRows[0].salary_override_amount === 1250, 'DB salary_override_amount persists 1250');
      assert(savedAttendanceRows[0].calculated_salary === 1250, 'DB calculated_salary persists explicit override 1250');
      assert(customDay.salaryOverrideEnabled === true && customDay.salaryOverrideAmount === 1250, 'Returned AttendanceRecord exposes explicit override flag and amount');
      assert(customDay.dailyEarnedSalary === 1250, 'Returned AttendanceRecord preserves custom earned salary');

      await repository.persistSalaryConfig({
        dailyBaseSalary: 950,
        addonSalary: 150,
        addonEnabled: true,
        standardWorkingHours: 8,
        extraHourRate: 175,
        overtimeEnabled: false,
        currency: 'INR'
      });

      assert(savedSalaryConfigRow.addon_salary === 150 && savedSalaryConfigRow.addon_enabled === true, 'Add-on config persisted to salary_configs');
      assert(savedSalaryConfigRow.extra_hour_rate === 175 && savedSalaryConfigRow.overtime_enabled === false, 'Disabling overtime preserves extra_hour_rate=175 and writes overtime_enabled=false');
      assert(savedAttendanceRows[0].calculated_salary === 1250, 'Historical attendance calculated_salary untouched after config update');
      assert(repository.getAttendance()[0].dailyEarnedSalary === 1250, 'In-memory historical attendance untouched after config update');
    }
    console.log('✓ Test 25 passed.');

    // ==========================================
    // TEST 26: New Supabase Salary Schema Columns, Legacy Defaults, Snapshot Preservation on Edit & Non-Substitution
    // ==========================================
    console.log('Test 26: New salary schema columns, legacy defaults, edit snapshot preservation & calculated_salary non-substitution...');
    {
      let dbSalaryConfig: any = {
        id: 'sal_cfg_26',
        user_id: USER_A,
        daily_base_salary: 600,
        addon_salary: 120,
        addon_enabled: true,
        standard_hours: 8,
        extra_hour_rate: 200,
        overtime_enabled: false,
        currency_code: 'INR',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const dbAttendance: any[] = [
        // Legacy row with NULL/missing new schema columns & a drifted calculated_salary (must NOT imply salary_override_enabled)
        {
          id: 'att_legacy_1',
          user_id: USER_A,
          attendance_date: '2026-08-01',
          status: 'present',
          hours_worked: 9,
          extra_hours: 1,
          daily_base_salary: 500,
          extra_hour_rate: 100,
          calculated_salary: 777, // differs from 600, but salary_override_enabled is missing/null
          addon_salary: null,
          addon_enabled: null,
          overtime_enabled: null,
          salary_override_enabled: null,
          salary_override_amount: null,
          notes: 'Legacy row',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ];

      const schemaClient = createMockSupabase(USER_A, {
        user_settings: (ctx) => ({ data: ctx.payload, error: null }),
        salary_configs: (ctx) => {
          if (ctx.op === 'upsert') {
            dbSalaryConfig = { ...dbSalaryConfig, ...ctx.payload };
            return { data: dbSalaryConfig, error: null };
          }
          return { data: dbSalaryConfig, error: null };
        },
        attendance_records: (ctx) => {
          if (ctx.op === 'upsert') {
            const idx = dbAttendance.findIndex(r => r.attendance_date === ctx.payload.attendance_date);
            const row = {
              id: idx >= 0 ? dbAttendance[idx].id : `att_${dbAttendance.length + 1}`,
              ...ctx.payload,
              created_at: idx >= 0 ? dbAttendance[idx].created_at : new Date().toISOString(),
              updated_at: new Date().toISOString()
            };
            if (idx >= 0) dbAttendance[idx] = row;
            else dbAttendance.unshift(row);
            return { data: row, error: null };
          }
          return { data: dbAttendance, error: null };
        }
      });

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(schemaClient, true);

      // 1. Hydrate from DB and verify global salary_configs + safe legacy defaults
      await repository.fetchAllUserData(USER_A);
      const hydratedCfg = repository.getSettings().salaryConfig;
      assert(hydratedCfg.dailyBaseSalary === 600, 'Hydrated dailyBaseSalary=600');
      assert(hydratedCfg.addonSalary === 120, 'Hydrated addonSalary=120');
      assert(hydratedCfg.addonEnabled === true, 'Hydrated addonEnabled=true');
      assert(hydratedCfg.extraHourRate === 200, 'Hydrated extraHourRate=200');
      assert(hydratedCfg.overtimeEnabled === false, 'Hydrated overtimeEnabled=false');

      const legacyHydrated = repository.getAttendance().find(a => a.date === '2026-08-01')!;
      assert(legacyHydrated.addonSalary === 0, 'Legacy null addon_salary defaults to 0');
      assert(legacyHydrated.addonEnabled === false, 'Legacy null addon_enabled defaults to false');
      assert(legacyHydrated.overtimeEnabled === true, 'Legacy null overtime_enabled defaults to true');
      assert(legacyHydrated.salaryOverrideEnabled === false, 'Legacy null salary_override_enabled defaults to false even when calculated_salary differs from formula');
      assert(legacyHydrated.salaryOverrideAmount === undefined, 'Legacy null salary_override_amount defaults to undefined');
      assert(legacyHydrated.dailyEarnedSalary === 777, 'Legacy calculated_salary preserved as read-only value without promoting to override flag');

      // 2. Save new attendance under global config (base=600, addon=120 enabled, extraRate=200 overtime_enabled=false)
      const newDay = await repository.upsertAttendanceRecord({
        date: '2026-08-02',
        status: 'Present',
        calculatedHours: 10
      });
      const newDbRow = dbAttendance.find(r => r.attendance_date === '2026-08-02')!;
      assert(newDbRow.addon_salary === 120 && newDbRow.addon_enabled === true, 'New record saves per-date add-on snapshot');
      assert(newDbRow.extra_hour_rate === 200 && newDbRow.overtime_enabled === false, 'New record preserves extra_hour_rate=200 and overtime_enabled=false');
      assert(newDbRow.salary_override_enabled === false && newDbRow.salary_override_amount === null, 'New formula record sets override disabled');
      assert(newDbRow.calculated_salary === 720, 'Formula computes 600 + 120 + 0 (OT disabled) = 720');
      assert(newDay.dailyEarnedSalary === 720, 'Mapped dailyEarnedSalary matches 720');

      // 3. Change global settings via persistSettingsBundle, then partially edit 2026-08-02 -> MUST preserve 2026-08-02 snapshot!
      await repository.persistSettingsBundle({
        currency: 'INR',
        dateFormat: 'YYYY-MM-DD',
        weekStartDay: 'Monday',
        customExpenseCategories: ['Food'],
        customIncomeSources: ['Salary'],
        widgets: [{ id: 'w1', name: 'Balance', visible: true, order: 1 }],
        salaryConfig: {
          dailyBaseSalary: 1500,
          addonSalary: 300,
          addonEnabled: false,
          standardWorkingHours: 8,
          extraHourRate: 350,
          overtimeEnabled: true,
          currency: 'INR'
        }
      });

      assert(dbSalaryConfig.addon_salary === 300 && dbSalaryConfig.addon_enabled === false && dbSalaryConfig.overtime_enabled === true, 'persistSettingsBundle saves new salary_configs fields');

      await repository.upsertAttendanceRecord({
        date: '2026-08-02',
        status: 'Present',
        calculatedHours: 11,
        notes: 'Partial edit after global change'
      });
      const afterPartialEditRow = dbAttendance.find(r => r.attendance_date === '2026-08-02')!;
      assert(afterPartialEditRow.daily_base_salary === 600, 'Partial edit does NOT overwrite daily_base_salary with new global 1500');
      assert(afterPartialEditRow.addon_salary === 120 && afterPartialEditRow.addon_enabled === true, 'Partial edit preserves per-date addon snapshot');
      assert(afterPartialEditRow.extra_hour_rate === 200 && afterPartialEditRow.overtime_enabled === false, 'Partial edit preserves per-date overtime snapshot');
      assert(afterPartialEditRow.calculated_salary === 720, 'Calculated salary stays 720 using preserved snapshot');

      // 4. Enable manual override explicitly, then disable it later -> recalculates from formula and clears override amount
      await repository.upsertAttendanceRecord({
        date: '2026-08-02',
        status: 'Present',
        calculatedHours: 11,
        salaryOverrideEnabled: true,
        salaryOverrideAmount: 1400
      });
      assert(dbAttendance.find(r => r.attendance_date === '2026-08-02')!.salary_override_enabled === true, 'Manual override flag saved as true');
      assert(dbAttendance.find(r => r.attendance_date === '2026-08-02')!.salary_override_amount === 1400, 'Manual override amount saved as 1400');
      assert(dbAttendance.find(r => r.attendance_date === '2026-08-02')!.calculated_salary === 1400, 'Calculated salary matches override amount 1400');

      await repository.upsertAttendanceRecord({
        date: '2026-08-02',
        status: 'Present',
        calculatedHours: 11,
        salaryOverrideEnabled: false,
        salaryOverrideAmount: undefined
      });
      const clearedRow = dbAttendance.find(r => r.attendance_date === '2026-08-02')!;
      assert(clearedRow.salary_override_enabled === false && clearedRow.salary_override_amount === null, 'Disabling manual override clears DB override fields');
      assert(clearedRow.calculated_salary === 720, 'Disabling manual override restores formula calculation from snapshot (720)');
    }
    console.log('✓ Test 26 passed.');

    // ==========================================
    // TEST 27: Override Reload, Non-Present Normalization, Multi-Date, Duplicate Prevention, Failure/Retry & User Isolation
    // ==========================================
    console.log('Test 27: Override reload, Non-Present normalization, multi-date, duplicate coalescing, failure/retry & user isolation...');
    {
      const dbConfigsByUser: Record<string, any> = {
        [USER_A]: {
          id: 'cfg_a',
          user_id: USER_A,
          daily_base_salary: 700,
          addon_salary: 150,
          addon_enabled: true,
          standard_hours: 8,
          extra_hour_rate: 120,
          overtime_enabled: true,
          currency_code: 'INR',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
        // Note: USER_B intentionally starts with NO salary_configs row
      };
      const dbAttendanceByUser: Record<string, any[]> = {
        [USER_A]: [],
        [USER_B]: []
      };

      let currentAuthUser = USER_A;
      let salaryUpsertCount = 0;
      let attendanceUpsertCount = 0;
      let failNextSalaryWrite = false;
      let failNextAttendanceWrite = false;

      const createScopedClient = (uid: string) =>
        createMockSupabase(uid, {
          salary_configs: (ctx) => {
            if (ctx.op === 'upsert') {
              salaryUpsertCount += 1;
              if (failNextSalaryWrite) {
                return { data: null, error: { message: 'Simulated salary_configs write failure' } };
              }
              dbConfigsByUser[uid] = {
                ...(dbConfigsByUser[uid] || { id: `cfg_${uid}`, created_at: new Date().toISOString() }),
                ...ctx.payload,
                updated_at: new Date().toISOString()
              };
              return { data: dbConfigsByUser[uid], error: null };
            }
            return { data: dbConfigsByUser[uid] || null, error: null };
          },
          attendance_records: (ctx) => {
            if (ctx.op === 'upsert') {
              attendanceUpsertCount += 1;
              if (failNextAttendanceWrite) {
                return { data: null, error: { message: 'Simulated attendance_records write failure' } };
              }
              const list = dbAttendanceByUser[uid] || (dbAttendanceByUser[uid] = []);
              const idx = list.findIndex(r => r.attendance_date === ctx.payload.attendance_date);
              const row = {
                id: idx >= 0 ? list[idx].id : `att_${uid}_${list.length + 1}`,
                ...ctx.payload,
                created_at: idx >= 0 ? list[idx].created_at : new Date().toISOString(),
                updated_at: new Date().toISOString()
              };
              if (idx >= 0) list[idx] = row;
              else list.unshift(row);
              return { data: row, error: null };
            }
            return { data: dbAttendanceByUser[uid] || [], error: null };
          }
        });

      let activeMockClient = createScopedClient(USER_A);
      const switchUser = (uid: string) => {
        currentAuthUser = uid;
        activeMockClient = createScopedClient(uid);
        repository.clearUserData();
        repository.setActiveUserId(uid);
        configureRepositoryBackendForTests(activeMockClient, true);
      };

      switchUser(USER_A);
      await repository.fetchAllUserData(USER_A);

      // 1. Multiple attendance records across different dates + manual override reload persistence
      await repository.upsertAttendanceRecord({
        date: '2026-09-01',
        status: 'Present',
        calculatedHours: 9,
        salaryOverrideEnabled: true,
        salaryOverrideAmount: 1350,
        notes: 'Override day'
      });
      await repository.upsertAttendanceRecord({
        date: '2026-09-02',
        status: 'Present',
        calculatedHours: 10
      });

      // Reload from DB and verify manual override + formula day both persisted accurately
      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      await repository.fetchAllUserData(USER_A);
      const reloadedSept1 = repository.getAttendance().find(a => a.date === '2026-09-01')!;
      const reloadedSept2 = repository.getAttendance().find(a => a.date === '2026-09-02')!;
      assert(reloadedSept1.salaryOverrideEnabled === true && reloadedSept1.salaryOverrideAmount === 1350 && reloadedSept1.dailyEarnedSalary === 1350, 'Manual override persists after reload');
      assert(reloadedSept2.dailyEarnedSalary === 700 + 150 + 2 * 120, `Multi-date Sept 2 formula computed 1090, got ${reloadedSept2.dailyEarnedSalary}`);

      // 2. Non-Present normalization across Leave, Absent, and Holiday while preserving historical rate snapshots
      for (const nonPresentStatus of ['Leave', 'Absent', 'Holiday'] as const) {
        const res = await repository.upsertAttendanceRecord({
          date: '2026-09-01',
          status: nonPresentStatus,
          calculatedHours: 9,
          notes: `Changed to ${nonPresentStatus}`
        });
        const dbRow = dbAttendanceByUser[USER_A].find(r => r.attendance_date === '2026-09-01')!;
        assert(dbRow.salary_override_enabled === false && dbRow.salary_override_amount === null, `${nonPresentStatus} clears override fields in DB`);
        assert(dbRow.calculated_salary === 0 && dbRow.hours_worked === 0 && dbRow.extra_hours === 0, `${nonPresentStatus} zeroes salary and hours in DB`);
        assert(dbRow.daily_base_salary === 700 && dbRow.addon_salary === 150 && dbRow.addon_enabled === true && dbRow.extra_hour_rate === 120 && dbRow.overtime_enabled === true, `${nonPresentStatus} preserves historical rate snapshots`);
        assert(res.dailyEarnedSalary === 0 && res.salaryOverrideEnabled === false && res.salaryOverrideAmount === undefined, `${nonPresentStatus} maps cleanly in returned record`);
      }

      // 3. Duplicate submission prevention (concurrent identical saves coalesce to 1 DB write)
      const salBefore = salaryUpsertCount;
      await Promise.all([
        repository.persistSalaryConfig({
          dailyBaseSalary: 750,
          addonSalary: 150,
          addonEnabled: false,
          standardWorkingHours: 8,
          extraHourRate: 140,
          overtimeEnabled: true,
          currency: 'INR'
        }),
        repository.persistSalaryConfig({
          dailyBaseSalary: 750,
          addonSalary: 150,
          addonEnabled: false,
          standardWorkingHours: 8,
          extraHourRate: 140,
          overtimeEnabled: true,
          currency: 'INR'
        })
      ]);
      assert(salaryUpsertCount === salBefore + 1, `Concurrent identical persistSalaryConfig calls coalesced to 1 upsert (got ${salaryUpsertCount - salBefore})`);

      const attBefore = attendanceUpsertCount;
      await Promise.all([
        repository.upsertAttendanceRecord({ date: '2026-09-03', status: 'Present', calculatedHours: 8 }),
        repository.upsertAttendanceRecord({ date: '2026-09-03', status: 'Present', calculatedHours: 8 })
      ]);
      assert(attendanceUpsertCount === attBefore + 1, `Concurrent identical upsertAttendanceRecord calls coalesced to 1 upsert (got ${attendanceUpsertCount - attBefore})`);

      // 4. Write failure and retry behavior (error does NOT corrupt state; retry succeeds)
      failNextSalaryWrite = true;
      let salaryErrCaught = false;
      try {
        await repository.persistSalaryConfig({
          dailyBaseSalary: 9999,
          addonSalary: 500,
          addonEnabled: true,
          standardWorkingHours: 8,
          extraHourRate: 300,
          overtimeEnabled: true,
          currency: 'INR'
        });
      } catch {
        salaryErrCaught = true;
      }
      assert(salaryErrCaught, 'Failed salary_configs write throws explicit error');
      assert(repository.getSettings().salaryConfig.dailyBaseSalary === 750, 'Failed salary_configs write preserves previous state (750)');

      failNextSalaryWrite = false;
      await repository.persistSalaryConfig({
        dailyBaseSalary: 9999,
        addonSalary: 500,
        addonEnabled: true,
        standardWorkingHours: 8,
        extraHourRate: 300,
        overtimeEnabled: true,
        currency: 'INR'
      });
      assert(repository.getSettings().salaryConfig.dailyBaseSalary === 9999, 'Retry after salary_configs failure succeeds cleanly');

      failNextAttendanceWrite = true;
      let attErrCaught = false;
      try {
        await repository.upsertAttendanceRecord({
          date: '2026-09-04',
          status: 'Present',
          calculatedHours: 8
        });
      } catch {
        attErrCaught = true;
      }
      assert(attErrCaught, 'Failed attendance_records write throws explicit error');
      assert(!repository.getAttendance().some(a => a.date === '2026-09-04'), 'Failed attendance write does NOT insert phantom record into memoryState');

      failNextAttendanceWrite = false;
      const retriedAtt = await repository.upsertAttendanceRecord({
        date: '2026-09-04',
        status: 'Present',
        calculatedHours: 8
      });
      assert(retriedAtt.date === '2026-09-04' && repository.getAttendance().some(a => a.date === '2026-09-04'), 'Retry after attendance failure succeeds cleanly');

      // 5. User-specific data isolation & user with NO salary_configs row safely hydrates unconfigured state
      switchUser(USER_B);
      await repository.fetchAllUserData(USER_B);
      assert(repository.getAttendance().length === 0, 'USER_B has zero attendance records (no USER_A leakage)');
      assert(repository.getSettings().salaryConfig.dailyBaseSalary === undefined, 'USER_B with no salary_configs row keeps dailyBaseSalary undefined');
      assert(repository.getSettings().salaryConfig.standardWorkingHours === undefined, 'USER_B with no salary_configs row keeps standardWorkingHours undefined');
      assert(repository.getSettings().salaryConfig.extraHourRate === undefined, 'USER_B with no salary_configs row keeps extraHourRate undefined');
      assert(repository.getSettings().salaryConfig.addonEnabled === false && repository.getSettings().salaryConfig.overtimeEnabled === false, 'USER_B safe unconfigured toggles');
      assert(repository.getSettings().salaryConfig.isConfigured === false, 'USER_B salaryConfig isConfigured is false');

      // USER_B saves their own attendance cleanly (daily_earned = 0 before configuring salary) without affecting USER_A
      const userBAtt = await repository.upsertAttendanceRecord({ date: '2026-09-01', status: 'Present', calculatedHours: 8 });
      assert(userBAtt.dailyEarnedSalary === 0, 'Unconfigured USER_B attendance yields 0 dailyEarnedSalary (no fabricated 500 default)');
      assert(dbAttendanceByUser[USER_B].length === 1 && dbAttendanceByUser[USER_A].length === 4, 'USER_B attendance isolated from USER_A');
      assert(currentAuthUser === USER_B, 'Active user check');
    }
    console.log('✓ Test 27 passed.');

    // ==========================================
    // TEST 28: Post-Reset Missing Row Default Restoration (No Stale Memory Inheritance)
    // ==========================================
    console.log('Test 28: Post-reset missing settings/config rows & empty categories restore clean defaults...');
    {
      let backendResetDone = false;
      const sparseResetClient = createMockSupabase(
        USER_A,
        {
          expenses: () => ({
            data: backendResetDone ? [] : [{ id: UUID_1, title: 'Old', amount: 50, category: 'CustomCat', expense_date: '2026-05-01', payment_method: 'Cash', is_recurring: false, created_at: '2026-05-01' }],
            error: null
          }),
          user_settings: () => ({
            // Simulate RPC deleting user_settings & salary_configs rows (or leaving empty arrays)
            data: backendResetDone ? null : {
              user_id: USER_A,
              currency_code: 'USD',
              date_format: 'MM/DD/YYYY',
              week_starts_on: 0,
              expense_categories: ['CustomCatOnly'],
              income_sources: ['CustomSourceOnly'],
              dashboard_widgets: [{ id: 'w_old', name: 'Old', visible: false, order: 99 }]
            },
            error: null
          }),
          salary_configs: () => ({
            data: backendResetDone ? null : {
              user_id: USER_A,
              currency_code: 'USD',
              daily_base_salary: 1200,
              addon_salary: 250,
              addon_enabled: true,
              standard_hours: 9,
              extra_hour_rate: 300,
              overtime_enabled: false
            },
            error: null
          }),
          profiles: () => ({
            data: { id: USER_A, display_name: 'Musthafa', avatar_url: null },
            error: null
          })
        },
        async (fn) => {
          if (fn === 'xos_reset_user_data') {
            backendResetDone = true;
            return { data: null, error: null };
          }
          return { data: null, error: { message: 'Unexpected RPC' } };
        }
      );

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(sparseResetClient, true);
      await repository.fetchAllUserData(USER_A);

      assert(repository.getSettings().currency === 'USD', 'Pre-reset USD loaded');
      assert(repository.getSettings().salaryConfig.dailyBaseSalary === 1200, 'Pre-reset salary config loaded');
      assert(repository.getSettings().salaryConfig.addonEnabled === true, 'Pre-reset addonEnabled loaded');
      assert(repository.getSettings().customExpenseCategories[0] === 'CustomCatOnly', 'Pre-reset custom categories loaded');

      await repository.resetUserData();

      const afterSettings = repository.getSettings();
      assert(repository.getExpenses().length === 0, 'Expenses wiped on reset');
      assert(afterSettings.currency === 'INR', `Currency restored to default INR when user_settings deleted (got ${afterSettings.currency})`);
      assert(afterSettings.dateFormat === 'YYYY-MM-DD', 'Date format restored to default when user_settings deleted');
      assert(afterSettings.weekStartDay === 'Monday', 'Week start restored to default when user_settings deleted');
      assert(afterSettings.customExpenseCategories.includes('Food & Dining') && !afterSettings.customExpenseCategories.includes('CustomCatOnly'), 'Expense categories restored to clean defaults (no stale pre-reset categories)');
      assert(afterSettings.customIncomeSources.includes('Salary') && !afterSettings.customIncomeSources.includes('CustomSourceOnly'), 'Income sources restored to clean defaults');
      assert(afterSettings.salaryConfig.dailyBaseSalary === undefined, 'Salary dailyBaseSalary cleared to undefined when salary_configs deleted');
      assert(afterSettings.salaryConfig.standardWorkingHours === undefined, 'Salary standardWorkingHours cleared to undefined when salary_configs deleted');
      assert(afterSettings.salaryConfig.extraHourRate === undefined, 'Salary extraHourRate cleared to undefined when salary_configs deleted');
      assert(afterSettings.salaryConfig.addonEnabled === false && afterSettings.salaryConfig.addonSalary === 0, 'Salary addon config restored to disabled 0');
      assert(afterSettings.salaryConfig.overtimeEnabled === false, 'Salary overtime config restored to disabled');
      assert(afterSettings.salaryConfig.isConfigured === false, 'Salary config marked unconfigured on reset');
      assert(afterSettings.profile.name === 'Musthafa', 'Authenticated profile preserved after missing-row reset');
    }
    console.log('✓ Test 28 passed.');

    // ==========================================
    // TEST 29: Goals & Savings 1:1 Sync, Edit Sync, Archived/Cancelled Filtering & Null Link Resilience
    // ==========================================
    console.log('Test 29: Goals & Savings 1:1 sync, edit sync, archived/cancelled filtering & legacy null-link resilience...');
    {
      const dbGoals: any[] = [
        // 1) Active linked goal whose stored progress_percentage lags behind savings balance (must derive from savings balance!)
        {
          id: 'g_active_1',
          user_id: USER_A,
          title: 'Emergency Fund',
          description: '6 months buffer',
          category: 'Financial',
          target_amount: 1000,
          progress_percentage: 0, // Stale DB column; savings_goals has 400 -> UI must compute 40%
          priority: 'high',
          status: 'in_progress',
          savings_goal_id: 'sg_1',
          created_at: '2026-06-01T00:00:00Z',
          updated_at: '2026-06-01T00:00:00Z'
        },
        // 2) Soft-archived goal via status='archived' -> MUST NOT reappear as active after refresh
        {
          id: 'g_arch_status',
          user_id: USER_A,
          title: 'Archived By Status',
          category: 'Financial',
          target_amount: 500,
          progress_percentage: 10,
          priority: 'medium',
          status: 'archived',
          savings_goal_id: 'sg_arch_1',
          created_at: '2026-06-01T00:00:00Z'
        },
        // 3) Soft-archived goal via archived_at -> MUST NOT reappear as active after refresh
        {
          id: 'g_arch_ts',
          user_id: USER_A,
          title: 'Archived By Timestamp',
          category: 'Travel',
          target_amount: 800,
          progress_percentage: 20,
          priority: 'low',
          status: 'in_progress',
          archived_at: '2026-06-05T00:00:00Z',
          savings_goal_id: 'sg_arch_2',
          created_at: '2026-06-01T00:00:00Z'
        },
        // 4) Cancelled goal -> DB archived status, MUST NOT appear in Goals or Active Goals on Dashboard
        {
          id: 'g_cancelled',
          user_id: USER_A,
          title: 'Cancelled Vacation',
          category: 'Travel',
          target_amount: 2000,
          progress_percentage: 10,
          priority: 'medium',
          status: 'cancelled',
          savings_goal_id: 'sg_cancelled',
          created_at: '2026-06-01T00:00:00Z'
        },
        // 5) Legacy broken goal with null savings_goal_id -> MUST NOT crash fetchAllUserData!
        {
          id: 'g_legacy_null',
          user_id: USER_A,
          title: 'Legacy Unlinked Goal',
          category: 'Personal',
          target_amount: 300,
          progress_percentage: 15,
          priority: 'low',
          status: 'in_progress',
          savings_goal_id: null,
          created_at: '2026-06-01T00:00:00Z'
        },
        // 6) Duplicate claimer pointing to sg_1 -> strict 1:1 enforcement prevents double-counting sg_1 balance
        {
          id: 'g_dup_claim',
          user_id: USER_A,
          title: 'Duplicate Link Attempt',
          category: 'Financial',
          target_amount: 1000,
          progress_percentage: 0,
          priority: 'medium',
          status: 'in_progress',
          savings_goal_id: 'sg_1',
          created_at: '2026-06-02T00:00:00Z'
        }
      ];

      const dbSavingsGoals: any[] = [
        { id: 'sg_1', user_id: USER_A, name: 'Emergency Fund', target_amount: 1000, current_balance: 400, created_at: '2026-06-01T00:00:00Z' },
        { id: 'sg_1', user_id: USER_A, name: 'Emergency Fund', target_amount: 1000, current_balance: 400, created_at: '2026-06-01T00:00:00Z' }, // Duplicate row ID check
        { id: 'sg_arch_1', user_id: USER_A, name: 'Archived Fund', target_amount: 500, current_balance: 50, created_at: '2026-06-01T00:00:00Z' },
        { id: 'sg_arch_2', user_id: USER_A, name: 'Archived TS Fund', target_amount: 800, current_balance: 160, archived_at: '2026-06-05T00:00:00Z', created_at: '2026-06-01T00:00:00Z' },
        { id: 'sg_cancelled', user_id: USER_A, name: 'Paused Vacation', target_amount: 2000, current_balance: 200, created_at: '2026-06-01T00:00:00Z' }
      ];

      const dbSavingsTxs: any[] = [];

      const syncClient = createMockSupabase(USER_A, {
        goals: (ctx) => {
          if (ctx.op === 'update') {
            const idFilter = ctx.filters.find(f => f.col === 'id')?.val;
            const idx = dbGoals.findIndex(g => g.id === idFilter);
            if (idx >= 0) {
              dbGoals[idx] = { ...dbGoals[idx], ...ctx.payload, updated_at: new Date().toISOString() };
              return { data: dbGoals[idx], error: null };
            }
            return { data: null, error: null };
          }
          const filtered = dbGoals.filter(row => ctx.filters.every(f => row[f.col] === f.val));
          if (ctx.singleMode !== 'none') {
            return { data: filtered[0] || null, error: null };
          }
          return { data: filtered, error: null };
        },
        savings_goals: (ctx) => {
          if (ctx.op === 'update') {
            const idFilter = ctx.filters.find(f => f.col === 'id')?.val;
            let updatedRow: any = null;
            for (let i = 0; i < dbSavingsGoals.length; i++) {
              if (dbSavingsGoals[i].id === idFilter) {
                dbSavingsGoals[i] = { ...dbSavingsGoals[i], ...ctx.payload, updated_at: new Date().toISOString() };
                updatedRow = dbSavingsGoals[i];
              }
            }
            return { data: updatedRow, error: null };
          }
          const filtered = dbSavingsGoals.filter(row => ctx.filters.every(f => row[f.col] === f.val));
          if (ctx.singleMode !== 'none') {
            return { data: filtered[0] || null, error: null };
          }
          return { data: filtered, error: null };
        },
        savings_transactions: (ctx) => {
          if (ctx.op === 'insert') {
            const tx = { id: `st_${dbSavingsTxs.length + 1}`, ...ctx.payload, created_at: new Date().toISOString() };
            dbSavingsTxs.unshift(tx);
            const delta = tx.transaction_type === 'deposit' ? tx.amount : -tx.amount;
            for (const sg of dbSavingsGoals) {
              if (sg.id === tx.savings_goal_id) {
                sg.current_balance = Math.max(0, Number(sg.current_balance) + delta);
              }
            }
            return { data: tx, error: null };
          }
          return { data: dbSavingsTxs, error: null };
        }
      });

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(syncClient, true);

      await repository.fetchAllUserData(USER_A);
      const initialGoals = repository.getGoals();
      const initialSavings = repository.getSavingsGoals();

      // Hydration must not crash on legacy null savings_goal_id and must exclude soft-archived rows
      assert(!initialGoals.some(g => g.id === 'g_arch_status' || g.id === 'g_arch_ts'), 'Archived goals filtered out cleanly on fetch');
      assert(initialGoals.some(g => g.id === 'g_legacy_null'), 'Legacy goal with null savings_goal_id survived hydration without crashing');
      assert(initialSavings.filter(sg => sg.id === 'sg_1').length === 1, 'Duplicate savings_goals IDs deduplicated');
      assert(!initialSavings.some(sg => sg.id === 'sg_arch_1' || sg.id === 'sg_arch_2'), 'Archived goal linked savings accounts filtered out');

      // Unified Goal + Savings resolution
      const resolved1 = resolveGoalsWithSavings(initialGoals, initialSavings);
      const emergencyItem = resolved1.find(r => r.goal.id === 'g_active_1')!;
      const dupClaimItem = resolved1.find(r => r.goal.id === 'g_dup_claim')!;
      const cancelledItem = resolved1.find(r => r.goal.id === 'g_cancelled');

      assert(emergencyItem.savedAmount === 400 && emergencyItem.progressPercentage === 40, `Active goal progress derived from linked savings balance (expected 40%, got ${emergencyItem.progressPercentage}%)`);
      assert(emergencyItem.isActive === true, 'Linked in-progress goal is active');
      assert(dupClaimItem.hasValidSavingsLink === false && dupClaimItem.savedAmount === 0, 'Strict 1:1 link prevents duplicate claim double-counting sg_1 balance');
      assert(!initialGoals.some(g => g.id === 'g_cancelled'), 'Cancelled DB goal excluded as Archived in repository state');
      assert(cancelledItem === undefined, 'Cancelled/archived goal is excluded from resolved active/goal UI lists');

      // Real Paused goal remains visible with isPaused=true and isActive=false (B-01 distinction)
      const pausedResolved = resolveGoalsWithSavings(
        [
          {
            id: 'g_real_paused',
            title: 'Real Paused Goal',
            description: 'Temporary pause',
            category: 'Travel',
            targetAmount: 1000,
            progressPercentage: 25,
            priority: 'Medium',
            status: 'Paused',
            createdAt: '2026-06-01',
            savingsGoalId: 'sg_real_paused'
          }
        ],
        [
          {
            id: 'sg_real_paused',
            name: 'Real Paused Goal',
            targetAmount: 1000,
            currentAmount: 250,
            createdAt: '2026-06-01'
          }
        ]
      );
      assert(pausedResolved.length === 1 && pausedResolved[0].isPaused === true && pausedResolved[0].isActive === false, 'Real Paused goal stays in goal list as Paused (not treated as Archived)');

      // Editing the goal syncs name & target_amount to linked savings_goals without breaking savings_goal_id or balance
      await repository.updateGoal('g_active_1', {
        title: 'Emergency Cash Buffer',
        targetAmount: 2000,
        description: 'Expanded buffer'
      });
      const updatedSg = dbSavingsGoals.find(sg => sg.id === 'sg_1')!;
      const updatedDbGoal = dbGoals.find(g => g.id === 'g_active_1')!;
      assert(updatedSg.name === 'Emergency Cash Buffer' && updatedSg.target_amount === 2000, 'Goal edit synced title & target_amount to linked savings_goals');
      assert(updatedSg.current_balance === 400 && updatedDbGoal.savings_goal_id === 'sg_1', 'Goal edit preserved balance and 1:1 savings_goal_id link');

      // Deposit into linked savings updates Goal progress immediately AND across full refresh
      await repository.addSavingsTransaction({
        savingsGoalId: 'sg_1',
        amount: 600,
        type: 'deposit',
        date: '2026-06-10',
        note: 'Top up'
      });

      const resolvedAfterDeposit = resolveGoalsWithSavings(repository.getGoals(), repository.getSavingsGoals());
      const emergencyAfterDeposit = resolvedAfterDeposit.find(r => r.goal.id === 'g_active_1')!;
      assert(emergencyAfterDeposit.savedAmount === 1000 && emergencyAfterDeposit.progressPercentage === 50, `Immediate deposit sync (1000/2000 = 50%, got ${emergencyAfterDeposit.progressPercentage}%)`);

      // Full refresh check
      await repository.fetchAllUserData(USER_A);
      const resolvedAfterRefresh = resolveGoalsWithSavings(repository.getGoals(), repository.getSavingsGoals());
      const emergencyAfterRefresh = resolvedAfterRefresh.find(r => r.goal.id === 'g_active_1')!;
      assert(emergencyAfterRefresh.savedAmount === 1000 && emergencyAfterRefresh.progressPercentage === 50, 'Goal progress stays 50% after full DB refresh');

      // Deposit remaining 1000 -> auto-completes goal and removes it from Active Dashboard list
      await repository.addSavingsTransaction({
        savingsGoalId: 'sg_1',
        amount: 1000,
        type: 'deposit',
        date: '2026-06-11',
        note: 'Completion'
      });
      const resolvedCompleted = resolveGoalsWithSavings(repository.getGoals(), repository.getSavingsGoals());
      const emergencyCompleted = resolvedCompleted.find(r => r.goal.id === 'g_active_1')!;
      assert(emergencyCompleted.isCompleted === true && emergencyCompleted.isActive === false && emergencyCompleted.progressPercentage === 100, 'Reaching target completes goal and removes from Active list');

      // Totals and stats consistency
      const unifiedTotals = calculateUnifiedGoalTotals(resolvedCompleted);
      const goalStats = calculateGoalStats(repository.getGoals(), repository.getSavingsGoals());
      assert(unifiedTotals.completedGoalsCount === 1 && goalStats.completedCount === 1, 'Goal stats match unified totals');
      assert(unifiedTotals.totalSavedAmount === 2000, `Unified total saved excludes archived/cancelled/duplicate balances (expected 2000, got ${unifiedTotals.totalSavedAmount})`);
    }
    console.log('✓ Test 29 passed.');

    // ==========================================
    // TEST 30: Goal Archive RPC Integration (xos_archive_goal), Error Handling, Coalescing & Refresh Exclusion
    // ==========================================
    console.log('Test 30: xos_archive_goal(p_goal_id) RPC, boolean true/false handling, error rollback, savings preservation & refresh exclusion...');
    {
      const dbGoals: any[] = [
        {
          id: UUID_1,
          user_id: USER_A,
          title: 'Archive Target Goal',
          description: 'Travel savings',
          category: 'Travel',
          target_amount: 1500,
          progress_percentage: 20,
          priority: 'medium',
          status: 'in_progress',
          savings_goal_id: UUID_2,
          created_at: '2026-06-01T00:00:00Z'
        },
        {
          id: UUID_3,
          user_id: USER_A,
          title: 'Keep Active Goal',
          description: 'Laptop fund',
          category: 'Career',
          target_amount: 2000,
          progress_percentage: 50,
          priority: 'high',
          status: 'in_progress',
          savings_goal_id: UUID_4,
          created_at: '2026-06-02T00:00:00Z'
        }
      ];
      const dbSavingsGoals: any[] = [
        { id: UUID_2, user_id: USER_A, name: 'Archive Target Goal', target_amount: 1500, current_balance: 300, created_at: '2026-06-01T00:00:00Z' },
        { id: UUID_4, user_id: USER_A, name: 'Keep Active Goal', target_amount: 2000, current_balance: 1000, created_at: '2026-06-02T00:00:00Z' }
      ];
      const dbSavingsTransactions: any[] = [
        {
          id: '55555555-5555-4555-8555-555555555555',
          user_id: USER_A,
          savings_goal_id: UUID_2,
          transaction_type: 'deposit',
          amount: 300,
          transaction_date: '2026-06-01',
          notes: 'Initial deposit',
          created_at: '2026-06-01T00:00:00Z'
        }
      ];

      let archiveRpcMode: 'error' | 'not_found_error' | 'bool_false' | 'obj_false' | 'void_null' | 'bool_true' = 'error';
      let archiveCallCount = 0;
      let goalsSelectCount = 0;
      const calledRpcs: Array<{ fn: string; args: Record<string, any> }> = [];

      const archiveClient = createMockSupabase(
        USER_A,
        {
          goals: () => {
            goalsSelectCount += 1;
            return { data: dbGoals, error: null };
          },
          savings_goals: () => ({ data: dbSavingsGoals, error: null }),
          savings_transactions: () => ({ data: dbSavingsTransactions, error: null })
        },
        async (fn, args) => {
          calledRpcs.push({ fn, args });
          if (fn === 'xos_delete_goal') {
            throw new Error('Deprecated xos_delete_goal RPC must NEVER be called');
          }
          if (fn === 'xos_archive_goal') {
            archiveCallCount += 1;
            await new Promise(resolve => setTimeout(resolve, 15));
            if (archiveRpcMode === 'error') {
              return { data: null, error: { message: 'Could not find function public.xos_delete_goal or permission denied' } };
            }
            if (archiveRpcMode === 'not_found_error') {
              return { data: null, error: { message: 'Goal not found or already archived' } };
            }
            if (archiveRpcMode === 'bool_false') {
              return { data: false, error: null };
            }
            if (archiveRpcMode === 'obj_false') {
              return { data: { success: false, message: 'Goal archive aborted on server' }, error: null };
            }
            // Live backend sets status = 'cancelled' when archiving a Goal and preserves savings & transactions
            const target = dbGoals.find(g => g.id === args.p_goal_id);
            if (!target || target.status === 'cancelled' || target.status === 'archived') {
              return { data: null, error: { message: 'Goal not found or already archived' } };
            }
            target.status = 'cancelled';
            return { data: archiveRpcMode === 'void_null' ? null : true, error: null };
          }
          return { data: null, error: { message: `Unexpected RPC ${fn}` } };
        }
      );

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(archiveClient, true);
      await repository.fetchAllUserData(USER_A);

      const preResolved = resolveGoalsWithSavings(repository.getGoals(), repository.getSavingsGoals());
      assert(preResolved.filter(g => g.isActive).length === 2, 'Pre-archive has 2 active goals');

      // 0) Passing savings_goal_id instead of goal.id must fail cleanly before invoking RPC
      {
        const callsBefore = archiveCallCount;
        let sgRejected = false;
        try {
          await repository.deleteGoal(UUID_2);
        } catch (err) {
          sgRejected = err instanceof Error && err.message.includes('savings account ID');
        }
        assert(sgRejected, 'Passing savings_goal_id instead of goal.id must be rejected');
        assert(archiveCallCount === callsBefore, 'Passing savings_goal_id must not invoke xos_archive_goal');
      }

      // 1) RPC error, "Goal not found or already archived", boolean false, & { success: false } MUST reject cleanly and preserve state without refetching
      for (const badMode of ['error', 'not_found_error', 'bool_false', 'obj_false'] as const) {
        archiveRpcMode = badMode;
        const selectsBefore = goalsSelectCount;
        let caughtMessage = '';
        try {
          await repository.deleteGoal(UUID_1);
        } catch (err) {
          caughtMessage = err instanceof Error ? err.message : String(err);
        }
        assert(caughtMessage.length > 0, `Archive mode '${badMode}' must throw error`);
        if (badMode === 'not_found_error') {
          assert(caughtMessage === 'Goal not found or already archived', 'Exact Supabase error message surfaced without masking');
        }
        assert(goalsSelectCount === selectsBefore, `Archive failure mode '${badMode}' must NOT trigger success refetch`);
        assert(repository.getGoals().some(g => g.id === UUID_1), `Goal kept in state on '${badMode}'`);
        assert(repository.getSavingsGoals().some(sg => sg.id === UUID_2), `Linked savings kept in state on '${badMode}'`);
        assert(repository.getSavingsTransactions().some(tx => tx.savingsGoalId === UUID_2), `Linked savings tx kept in state on '${badMode}'`);
      }

      // 2) Duplicate concurrent archival for the same UUID coalesces into ONE xos_archive_goal({ p_goal_id }) RPC call returning boolean true and refetches data
      archiveRpcMode = 'bool_true';
      archiveCallCount = 0;
      const selectsBeforeSuccess = goalsSelectCount;
      await Promise.all([repository.deleteGoal(UUID_1), repository.deleteGoal(UUID_1)]);

      assert(archiveCallCount === 1, `Concurrent deleteGoal calls coalesced into 1 xos_archive_goal call (got ${archiveCallCount})`);
      assert(
        calledRpcs.every(c => c.fn === 'xos_archive_goal' && c.args.p_goal_id === UUID_1),
        'All archive RPC calls used xos_archive_goal with exact parameter p_goal_id'
      );
      assert(goalsSelectCount > selectsBeforeSuccess, 'Successful archive triggered Goals/Savings refetch synchronization');

      // Linked savings account and transaction history MUST remain preserved in DB/state, while cancelled Goal is excluded from active/resolved lists
      assert(repository.getSavingsGoals().some(sg => sg.id === UUID_2), 'Linked savings account remains preserved after Goal archival');
      assert(repository.getSavingsTransactions().some(tx => tx.savingsGoalId === UUID_2), 'Linked savings transaction history remains preserved after Goal archival');

      const postArchiveResolved = resolveGoalsWithSavings(repository.getGoals(), repository.getSavingsGoals());
      assert(!postArchiveResolved.some(i => i.goal.id === UUID_1), 'Archived (cancelled) goal excluded from active & resolved lists immediately');
      assert(postArchiveResolved.filter(i => i.isActive).length === 1 && postArchiveResolved[0].goal.id === UUID_3, 'Remaining active goal preserved on Dashboard');

      // 3) Simulate full page reload / session refresh -> archived (cancelled) Goal remains excluded, while linked savings & txs remain preserved
      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      await repository.fetchAllUserData(USER_A);

      assert(repository.getSavingsGoals().some(sg => sg.id === UUID_2), 'Linked savings account remains preserved after full reload');
      assert(repository.getSavingsTransactions().some(tx => tx.savingsGoalId === UUID_2), 'Linked savings transactions remain preserved after full reload');
      const postRefreshResolved = resolveGoalsWithSavings(repository.getGoals(), repository.getSavingsGoals());
      assert(!postRefreshResolved.some(i => i.goal.id === UUID_1), 'Archived (cancelled) goal remains excluded after full reload');
      assert(postRefreshResolved.filter(i => i.isActive).length === 1 && postRefreshResolved[0].goal.id === UUID_3, 'Only active non-archived goal shows after refresh');
      const postRefreshTotals = calculateUnifiedGoalTotals(postRefreshResolved);
      assert(postRefreshTotals.totalSavedAmount === 1000 && postRefreshTotals.totalTargetAmount === 2000, 'Archived (cancelled) goal savings excluded from unified totals after refresh');
    }
    console.log('✓ Test 30 passed.');

    // ==========================================
    // TEST 31: Audit Bug Fixes Regression (B-05, N-11, N-10, B-12, B-06, N-02, Reset Validation)
    // ==========================================
    console.log('Test 31: Verifying B-05, N-11, N-10, B-12, B-06, N-02 & reset validation regressions...');
    {
      const uuidDebt = '77777777-7777-4777-8777-777777777777';
      const uuidPayout = '88888888-8888-4888-8888-888888888888';
      const uuidIncomeSynced = '99999999-9999-4999-8999-999999999999';
      const uuidAtt = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

      const dbDebts: any[] = [
        {
          id: uuidDebt,
          user_id: USER_A,
          person_name: 'Jordan',
          original_amount: 1000,
          remaining_amount: 700,
          lent_date: '2026-05-01',
          due_date: '2026-06-01',
          description: '[RECEIVE] Original memo',
          status: 'partially_paid',
          created_at: '2026-05-01T00:00:00Z'
        }
      ];
      const dbDebtRepayments: any[] = [
        {
          id: 'rep_existing_1',
          user_id: USER_A,
          debt_id: uuidDebt,
          amount: 300,
          repayment_date: '2026-05-10',
          payment_method: 'Bank Transfer',
          created_at: '2026-05-10T00:00:00Z'
        }
      ];
      const dbPayouts: any[] = [
        {
          id: uuidPayout,
          user_id: USER_A,
          period_start: '2026-05-01',
          period_end: '2026-05-31',
          amount_paid: 5000,
          paid_at: '2026-05-31T00:00:00Z',
          notes: 'May salary'
        }
      ];
      const dbIncomes: any[] = [
        {
          id: uuidIncomeSynced,
          user_id: USER_A,
          title: 'Salary May',
          amount: 5000,
          source: 'Salary',
          income_date: '2026-05-31',
          salary_payout_id: uuidPayout,
          created_at: '2026-05-31T00:00:00Z'
        }
      ];
      const dbAttendance: any[] = [
        {
          id: uuidAtt,
          user_id: USER_A,
          attendance_date: '2026-05-05',
          status: 'present',
          check_in: '09:00',
          check_out: '19:30',
          break_minutes: 30,
          hours_worked: 10,
          extra_hours: 2,
          daily_base_salary: 500,
          addon_salary: 0,
          addon_enabled: false,
          extra_hour_rate: 100,
          overtime_enabled: true,
          calculated_salary: 700
        }
      ];

      let lastDebtUpdatePayload: any = null;
      let lastAttendanceUpdatePayload: any = null;
      let resetRpcResponse: any = { status: 'unexpected_value' };

      const auditClient = createMockSupabase(
        USER_A,
        {
          debts: (ctx) => {
            if (ctx.op === 'update') {
              lastDebtUpdatePayload = { ...ctx.payload };
              dbDebts[0] = { ...dbDebts[0], ...ctx.payload };
              return { data: dbDebts[0], error: null };
            }
            return { data: dbDebts, error: null };
          },
          debt_repayments: () => ({ data: dbDebtRepayments, error: null }),
          salary_payouts: () => ({ data: dbPayouts, error: null }),
          incomes: () => ({ data: dbIncomes, error: null }),
          salary_configs: () => ({
            data: [{
              user_id: USER_A,
              daily_base_salary: 500,
              addon_salary: 0,
              addon_enabled: false,
              standard_hours: 12,
              extra_hour_rate: 100,
              overtime_enabled: true,
              currency_code: 'INR'
            }],
            error: null
          }),
          attendance_records: (ctx) => {
            if (ctx.op === 'upsert' || ctx.op === 'update') {
              lastAttendanceUpdatePayload = { ...ctx.payload };
              const idx = dbAttendance.findIndex(r => r.attendance_date === ctx.payload.attendance_date);
              if (idx >= 0) {
                dbAttendance[idx] = { ...dbAttendance[idx], ...ctx.payload };
                return { data: dbAttendance[idx], error: null };
              }
              const inserted = { id: `att_mock_${dbAttendance.length + 1}`, ...ctx.payload };
              dbAttendance.push(inserted);
              return { data: inserted, error: null };
            }
            return { data: dbAttendance, error: null };
          }
        },
        async (fn) => {
          if (fn === 'xos_reset_user_data') {
            return { data: resetRpcResponse, error: null };
          }
          return { data: null, error: null };
        }
      );

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(auditClient, true);
      await repository.fetchAllUserData(USER_A);

      // B-05: Lowering original_amount below already repaid (300) must reject BEFORE DB update
      let debtUnderRepaidRejected = false;
      try {
        await repository.updateDebt(uuidDebt, { original_amount: 200 });
      } catch (err) {
        debtUnderRepaidRejected = err instanceof Error && err.message.includes('cannot be less than total repayments');
      }
      assert(debtUnderRepaidRejected, 'B-05: updateDebt rejects original_amount < already repaid');

      // B-05 & N-11: Raising original_amount to 1500 updates remaining_amount to 1200 & status='partially_paid', and clearing due_date & notes sends null/cleared
      await repository.updateDebt(uuidDebt, {
        original_amount: 1500,
        due_date: '',
        notes: ''
      });
      assert(lastDebtUpdatePayload?.remaining_amount === 1200, `B-05: updateDebt recomputes remaining_amount (expected 1200, got ${lastDebtUpdatePayload?.remaining_amount})`);
      assert(lastDebtUpdatePayload?.status === 'partially_paid', 'B-05: updateDebt keeps partially_paid status when repaid > 0');
      assert(lastDebtUpdatePayload?.due_date === null, 'N-11: clearing due_date sends null to Supabase');
      const updatedDebtLocal = repository.getDebts().find(d => d.id === uuidDebt)!;
      assert(updatedDebtLocal.due_date === undefined && !updatedDebtLocal.notes, 'N-11: cleared due_date & notes reflected in hydrated state');

      // N-10: Directly updating or deleting a payout-synced income must be rejected
      let syncUpdateBlocked = false;
      try {
        await repository.updateIncome(uuidIncomeSynced, { amount: 9999 });
      } catch (err) {
        syncUpdateBlocked = err instanceof Error && err.message.includes('Salary');
      }
      let syncDeleteBlocked = false;
      try {
        await repository.deleteIncome(uuidIncomeSynced);
      } catch (err) {
        syncDeleteBlocked = err instanceof Error && err.message.includes('Salary');
      }
      assert(syncUpdateBlocked && syncDeleteBlocked, 'N-10: Direct mutation of payout-synced income rejected cleanly');

      // B-12: 0 payout rejected even when syncToIncome is false
      let zeroPayoutBlocked = false;
      try {
        await repository.recordSalaryPayout(
          { periodStart: '2026-06-01', periodEnd: '2026-06-30', amountPaid: 0, paidAt: '2026-06-30' },
          false
        );
      } catch {
        zeroPayoutBlocked = true;
      }
      assert(zeroPayoutBlocked, 'B-12: Zero salary payout blocked even when syncToIncome=false');

      // B-06: Asia/Kolkata IST attendance date validation & exact YYYY-MM-DD payload preservation
      const istCases = [
        { label: 'Nov 16 12:30 AM IST', utcIso: '2026-11-15T19:00:00.000Z', date: '2026-11-16', expectedIst: '2026-11-16', allow: true },
        { label: 'Nov 16 01:00 AM IST', utcIso: '2026-11-15T19:30:00.000Z', date: '2026-11-16', expectedIst: '2026-11-16', allow: true },
        { label: 'Nov 16 05:29 AM IST', utcIso: '2026-11-15T23:59:00.000Z', date: '2026-11-16', expectedIst: '2026-11-16', allow: true },
        { label: 'Nov 16 05:30 AM IST', utcIso: '2026-11-16T00:00:00.000Z', date: '2026-11-16', expectedIst: '2026-11-16', allow: true },
        { label: 'Nov 16 11:59 PM IST', utcIso: '2026-11-16T18:29:00.000Z', date: '2026-11-16', expectedIst: '2026-11-16', allow: true },
        { label: 'Nov 16 01:00 AM IST future Nov 17', utcIso: '2026-11-15T19:30:00.000Z', date: '2026-11-17', expectedIst: '2026-11-16', allow: false },
        { label: 'Nov 16 01:00 AM IST past Nov 15', utcIso: '2026-11-15T19:30:00.000Z', date: '2026-11-15', expectedIst: '2026-11-16', allow: true }
      ];
      for (const tc of istCases) {
        const instant = new Date(tc.utcIso);
        assert(getIstTodayString(instant) === tc.expectedIst, `B-06: ${tc.label} resolves IST today=${tc.expectedIst}`);
        assert(!isFutureIstDate(tc.date, instant) === tc.allow, `B-06: ${tc.label} for ${tc.date} allow=${tc.allow}`);
      }

      // Exercise repository.upsertAttendanceRecord during 01:00 AM IST (19:30 UTC prior day) via mocked Date
      const RealDate = globalThis.Date;
      const fixedInstantMs = Date.parse('2026-11-15T19:30:00.000Z'); // 2026-11-16 01:00 AM IST
      class MockIstDate extends RealDate {
        constructor(...args: any[]) {
          if (args.length === 0) {
            super(fixedInstantMs);
          } else {
            super(...(args as [any]));
          }
        }
        static now() {
          return fixedInstantMs;
        }
      }
      (globalThis as any).Date = MockIstDate;
      try {
        // 1. Nov 16 01:00 AM IST -> Nov 16 must pass frontend validation & send exact '2026-11-16'
        const savedIstToday = await repository.upsertAttendanceRecord({
          date: '2026-11-16',
          status: 'Present',
          calculatedHours: 8
        });
        assert(lastAttendanceUpdatePayload?.attendance_date === '2026-11-16', 'B-06: Sends exact YYYY-MM-DD 2026-11-16 without UTC shift');
        assert(savedIstToday.date === '2026-11-16', 'B-06: Accepts Nov 16 at 01:00 AM IST');

        // 2. Nov 16 01:00 AM IST -> Nov 15 (past) must be accepted
        const savedIstPast = await repository.upsertAttendanceRecord({
          date: '2026-11-15',
          status: 'Present',
          calculatedHours: 8
        });
        assert(lastAttendanceUpdatePayload?.attendance_date === '2026-11-15', 'B-06: Accepts past date Nov 15 at 01:00 AM IST');
        assert(savedIstPast.date === '2026-11-15', 'B-06: Hydrated past date preserves 2026-11-15');

        // 3. Nov 16 01:00 AM IST -> Nov 17 (future IST) must be rejected before DB write
        let futureIstBlocked = false;
        try {
          await repository.upsertAttendanceRecord({
            date: '2026-11-17',
            status: 'Present',
            calculatedHours: 8
          });
        } catch {
          futureIstBlocked = true;
        }
        assert(futureIstBlocked, 'B-06: Future IST date 2026-11-17 rejected cleanly before DB write');
      } finally {
        (globalThis as any).Date = RealDate;
      }

      // Restore dbAttendance[0] cleanly before N-02 unchanged-hours test
      dbAttendance[0] = {
        id: uuidAtt,
        user_id: USER_A,
        attendance_date: '2026-05-05',
        status: 'present',
        check_in: '09:00',
        check_out: '19:30',
        break_minutes: 30,
        hours_worked: 10,
        extra_hours: 2,
        daily_base_salary: 500,
        addon_salary: 0,
        addon_enabled: false,
        extra_hour_rate: 100,
        overtime_enabled: true,
        calculated_salary: 700
      };

      // N-02: Editing notes without changing Present working hours preserves existing extraHours (2h)
      await repository.upsertAttendanceRecord({
        id: uuidAtt,
        date: '2026-05-05',
        status: 'Present',
        checkInTime: '09:00',
        checkOutTime: '19:30',
        breakDurationMinutes: 30,
        calculatedHours: 10,
        notes: 'Updated memo only'
      });
      assert(lastAttendanceUpdatePayload?.extra_hours === 2, `N-02: Unchanged hours edit preserves extra_hours=2 (got ${lastAttendanceUpdatePayload?.extra_hours})`);

      // Info: Unrecognized reset RPC object payload must be rejected (not treated as success)
      resetRpcResponse = { unexpected: true };
      let badResetRejected = false;
      try {
        await repository.resetUserData();
      } catch {
        badResetRejected = true;
      }
      assert(badResetRejected, 'validateResetRpcResponse rejects unrecognized non-empty payload objects');
    }
    console.log('✓ Test 31 passed.');

    // ==========================================
    // TEST 32: New User Clean-State Hydration, Unconfigured Settings Save, Explicit Config & Existing User Preservation
    // ==========================================
    console.log('Test 32: New user clean-state hydration, unconfigured preferences save, explicit salary config & existing user preservation...');
    {
      let persistedSalaryRow: any = null;
      let salaryUpserts = 0;
      let userSettingsRow: any = null;
      let profileRow: any = { id: USER_A, display_name: 'New User', avatar_url: null };

      const cleanClient = createMockSupabase(USER_A, {
        user_settings: (ctx) => {
          if (ctx.op === 'upsert') {
            userSettingsRow = { ...ctx.payload };
            return { data: userSettingsRow, error: null };
          }
          return { data: userSettingsRow, error: null };
        },
        salary_configs: (ctx) => {
          if (ctx.op === 'upsert') {
            salaryUpserts += 1;
            persistedSalaryRow = { ...ctx.payload };
            return { data: persistedSalaryRow, error: null };
          }
          return { data: persistedSalaryRow, error: null };
        },
        profiles: (ctx) => {
          if (ctx.op === 'update') {
            profileRow = { ...profileRow, ...ctx.payload };
            return { data: profileRow, error: null };
          }
          return { data: profileRow, error: null };
        }
      });

      // 1) New user with completely empty DB rows
      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(cleanClient, true);
      await repository.fetchAllUserData(USER_A);

      assert(repository.getExpenses().length === 0 && repository.getIncomes().length === 0, 'New user has 0 transactions');
      assert(repository.getDebts().length === 0 && repository.getDebtRepayments().length === 0, 'New user has 0 debts');
      assert(repository.getGoals().length === 0 && repository.getSavingsGoals().length === 0, 'New user has 0 goals/savings');
      assert(repository.getAttendance().length === 0 && repository.getSalaryPayouts().length === 0, 'New user has 0 attendance/payouts');
      const newSettings = repository.getSettings();
      assert(newSettings.currency === 'INR', 'New user defaults to INR currency');
      assert(newSettings.salaryConfig.isConfigured === false, 'New user salaryConfig starts unconfigured');
      assert(newSettings.salaryConfig.dailyBaseSalary === undefined, 'New user dailyBaseSalary is undefined');
      assert(newSettings.salaryConfig.standardWorkingHours === undefined, 'New user standardWorkingHours is undefined');
      assert(newSettings.salaryConfig.extraHourRate === undefined, 'New user extraHourRate is undefined');
      assert(newSettings.salaryConfig.overtimeEnabled === false, 'New user overtimeEnabled is false');

      // 2) Saving profile/currency/categories with unconfigured salary skips salary_configs upsert
      await repository.persistSettingsBundle({
        displayName: 'New User Renamed',
        currency: 'USD',
        dateFormat: 'DD/MM/YYYY',
        weekStartDay: 'Sunday',
        customExpenseCategories: ['Food & Dining', 'Travel'],
        customIncomeSources: ['Freelance'],
        widgets: newSettings.widgets,
        salaryConfig: newSettings.salaryConfig
      });
      assert(salaryUpserts === 0, 'Unconfigured settings bundle skips salary_configs upsert');
      assert(repository.getSettings().currency === 'USD' && repository.getSettings().profile.name === 'New User Renamed', 'Profile & preferences saved without forcing salary inputs');
      assert(repository.getSettings().salaryConfig.isConfigured === false, 'Salary remains unconfigured after saving preferences');

      // 3) Explicitly configuring salary persists numeric values and flips isConfigured to true
      await repository.persistSalaryConfig({
        dailyBaseSalary: 750,
        addonSalary: 0,
        addonEnabled: false,
        standardWorkingHours: 9,
        extraHourRate: 120,
        overtimeEnabled: true,
        currency: 'USD',
        isConfigured: true
      });
      assert(salaryUpserts === 1 && persistedSalaryRow?.daily_base_salary === 750 && persistedSalaryRow?.standard_hours === 9, 'Explicit salary config upserts real numeric values');
      assert(repository.getSettings().salaryConfig.isConfigured === true, 'Configured salary marks isConfigured=true');

      // 4) Existing user reload preserves configured rates cleanly
      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      await repository.fetchAllUserData(USER_A);
      const reloaded = repository.getSettings();
      assert(reloaded.salaryConfig.isConfigured === true, 'Existing user reload preserves isConfigured=true');
      assert(reloaded.salaryConfig.dailyBaseSalary === 750 && reloaded.salaryConfig.standardWorkingHours === 9 && reloaded.salaryConfig.extraHourRate === 120, 'Existing user reload preserves configured rates');
      assert(reloaded.currency === 'USD' && reloaded.profile.name === 'New User Renamed', 'Existing user reload preserves settings & profile');
    }
    console.log('✓ Test 32 passed.');

    console.log('\n======================================================');
    console.log('--- ALL 32 PERSISTENCE & LIVE SCHEMA TESTS PASSED! ---');
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
