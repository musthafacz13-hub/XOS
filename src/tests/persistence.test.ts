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
  utcTimestampToLocalDate
} from '../utils/formatters';
import { calculateMonthlySalarySummary, filterRecordsByDateRange } from '../utils/calculations';

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
        standardWorkingHours: 9,
        extraHourRate: 200
      });

      assert(capturedSalaryPayload?.currency_code === 'USD', 'salary_configs upsert sends currency_code');
      assert(capturedSalaryPayload?.daily_base_salary === 1200, 'salary_configs upsert sends daily_base_salary');
      assert(capturedSalaryPayload?.standard_hours === 9, 'salary_configs upsert sends standard_hours');
      assert(capturedSalaryPayload?.extra_hour_rate === 200, 'salary_configs upsert sends extra_hour_rate');

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
        salaryConfig: { dailyBaseSalary: 500, standardWorkingHours: 8, extraHourRate: 100, currency: 'INR' }
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
        salaryConfig: { dailyBaseSalary: 500, standardWorkingHours: 8, extraHourRate: 100, currency: 'INR' }
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
      const attClient = createMockSupabase(USER_A, {
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
      assert(fromDbGoalStatus('cancelled') === 'Paused', 'DB cancelled maps safely to Paused');
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

      // Simulate DB row with cancelled status hydrating cleanly
      dbGoals.push({ id: 'goal_5', title: 'Cancelled One', description: '', category: 'Life', progress_percentage: 20, priority: 'low', status: 'cancelled', savings_goal_id: 'sg_rpc_2', created_at: '2026-05-01' });
      repository.clearUserData();
      await repository.fetchAllUserData(USER_A);
      const hydrated = repository.getGoals();
      assert(hydrated.find(g => g.id === 'goal_5')?.status === 'Paused', 'DB cancelled status hydrates to Paused safely');
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

      // Baseline defaults: INR, Monday, dailyBaseSalary = 500
      assert(repository.getSettings().salaryConfig.dailyBaseSalary === 500, 'Initial dailyBaseSalary is 500');

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
          salaryConfig: { dailyBaseSalary: 999, standardWorkingHours: 9, extraHourRate: 250, currency: 'EUR' }
        });
      } catch (err) {
        partialErr = err;
      }

      assert(partialErr instanceof SettingsBundleSaveError, 'Must throw SettingsBundleSaveError on partial failure');
      assert(partialErr.succeededSections.includes('user_settings') && partialErr.succeededSections.includes('profiles'), 'Reports user_settings and profiles succeeded');
      assert(partialErr.failedSections.some((f: any) => f.section === 'salary_configs'), 'Reports salary_configs failed');
      assert(partialErr.message.includes('Partial save') && partialErr.message.includes('Salary Configuration'), 'Error message explains succeeded vs failed sections');

      // Succeeded sections ARE reconciled into memoryState, while failed salary_configs MUST stay at 500!
      assert(repository.getSettings().currency === 'EUR', 'Reconciled succeeded user_settings currency EUR');
      assert(repository.getSettings().weekStartDay === 'Sunday', 'Reconciled succeeded user_settings Sunday (0)');
      assert(repository.getSettings().profile.name === 'Updated Name', 'Reconciled succeeded profiles displayName');
      assert(repository.getSettings().salaryConfig.dailyBaseSalary === 500, 'Failed salary_configs MUST NOT overwrite memoryState with unsaved 999');

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
          salaryConfig: { dailyBaseSalary: 1200, standardWorkingHours: 8, extraHourRate: 150, currency: 'USD' }
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
      let rpcMode: 'error' | 'null' | 'false' | 'obj_false' | 'empty_obj' | 'obj_true' | 'bool_true' = 'obj_true';
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
                  ? { user_id: USER_A, currency_code: 'INR', daily_base_salary: 500, standard_hours: 8, extra_hour_rate: 100 }
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
              if (rpcMode === 'null') return { data: null, error: null };
              if (rpcMode === 'false') return { data: false, error: null };
              if (rpcMode === 'obj_false') return { data: { success: false, message: 'Server aborted reset' }, error: null };
              if (rpcMode === 'empty_obj') return { data: {}, error: null };
              isResetOnBackend = true;
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
      for (const badMode of ['error', 'null', 'false', 'obj_false', 'empty_obj'] as const) {
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
      assert(repository.getSettings().salaryConfig.dailyBaseSalary === 500, 'Salary config reset to default');
      assert(repository.getSettings().profile.name === 'Preserved User', 'Preserved profile display_name hydrated from profiles');
      assert(repository.getSettings().profile.email === 'musthafa@test.local', 'Authenticated profile email preserved');

      // 4) Boolean true RPC response also accepted cleanly
      rpcMode = 'bool_true';
      await repository.resetUserData();
      assert(repository.getActiveUserId() === USER_A, 'Boolean true RPC response succeeded cleanly');
    }
    console.log('✓ Test 23 passed.');

    console.log('\n======================================================');
    console.log('--- ALL 23 PERSISTENCE & LIVE SCHEMA TESTS PASSED! ---');
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
