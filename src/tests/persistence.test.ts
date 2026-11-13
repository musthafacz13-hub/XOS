/**
 * XOS Mocked-Supabase Persistence, Auth Isolation, Date & Currency Test Suite
 *
 * Covers:
 *  1. Failed inserts across tables reject cleanly & never mutate state or emit fake IDs
 *  2. Failed updates across tables reject cleanly & preserve original state
 *  3. Failed deletes (DB errors and 0 affected rows) reject cleanly & retain records
 *  4. Duplicate salary payouts, one-way incomes.salary_payout_id FK + compensating delete & replace
 *  5. Receivables over-repayment guard & DB trigger status reconciliation
 *  6. Savings over-withdrawal guard, trigger current_balance mapping & initial deposit rollback
 *  7. Partial failure resilience in fetchAllUserData preserving valid state + recording errors
 *  8. User switching & stale response discard (User A in-flight discarded after User B enters)
 *  9. Sequence / clearAllData race guards canceling in-flight hydration
 * 10. Sign-out full state clearing across all 10 collections + activeUserId
 * 11. Calendar date parsing (YYYY-MM-DD, leap day, invalid calendar dates) without UTC shift
 * 12. Month boundary filtering (1st, last day, Dec->Jan transition, leap day)
 * 13. INR default currency behavior & non-overwriting preservation of saved USD/EUR
 * 14. salary_configs persistence + updateGoal type inclusion
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

function createMockSupabase(
  sessionUserId: string | null,
  handlers: Record<string, TableHandler>
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
  console.log('--- Running XOS Mocked-Supabase Persistence & Integrity Test Suite ---');

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
        () => repository.addDebt({ person_name: 'Sam', type: 'lent', original_amount: 1000, transaction_date: '2026-05-01' }),
        () => repository.addSavingsGoal({ name: 'Trip', targetAmount: 50000, initialDeposit: 0, startDate: '2026-05-01' }),
        () => repository.upsertAttendanceRecord({ date: '2026-05-01', status: 'Present', calculatedHours: 8 }),
        () => repository.addGoal({ title: 'Save', description: '', type: 'goal', category: 'Financial', priority: 'High', status: 'In Progress' })
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
    // TEST 2: Failed Update — preserves original memoryState
    // =========================================================================
    console.log('Test 2: Failed updates preserve existing state...');
    {
      const failUpdateClient = createMockSupabase(USER_A, {
        expenses: (ctx) => ctx.op === 'insert'
          ? {
              data: { id: UUID_1, title: 'Rent', amount: 12000, category: 'Housing', date: '2026-05-01', payment_method: 'Bank Transfer', is_recurring: false, recurring_frequency: 'None', created_at: '2026-05-01T00:00:00Z' },
              error: null
            }
          : { data: null, error: { message: 'Update denied by RLS' } },
        incomes: (ctx) => ctx.op === 'insert'
          ? {
              data: { id: UUID_2, title: 'Bonus', amount: 5000, source: 'Salary', date: '2026-05-01', created_at: '2026-05-01T00:00:00Z' },
              error: null
            }
          : { data: null, error: { message: 'Update failed on incomes' } }
      });

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(failUpdateClient, true);

      const exp = await repository.addExpense({ title: 'Rent', amount: 12000, category: 'Housing', date: '2026-05-01', paymentMethod: 'Bank Transfer' });
      const inc = await repository.addIncome({ title: 'Bonus', amount: 5000, source: 'Salary', date: '2026-05-01' });

      assert(exp.id === UUID_1, 'Expense uses PostgreSQL UUID');
      assert(inc.id === UUID_2, 'Income uses PostgreSQL UUID');

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
    // TEST 3: Failed Delete (error AND 0 affected rows) retains record
    // =========================================================================
    console.log('Test 3: Failed deletes (DB error and 0 rows affected) retain record...');
    {
      let deleteMode: 'error' | 'empty' = 'error';
      const delClient = createMockSupabase(USER_A, {
        goals: (ctx) => {
          if (ctx.op === 'insert') {
            assert(
              !('current_amount' in ctx.payload),
              'goals insert MUST NOT send unsupported current_amount column'
            );
            return {
              data: { id: UUID_1, title: 'Learn Rust', description: '', type: 'goal', category: 'Learning', priority: 'Medium', status: 'In Progress', created_at: '2026-05-01T00:00:00Z' },
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

      await repository.addGoal({ title: 'Learn Rust', description: '', type: 'goal', category: 'Learning', priority: 'Medium', status: 'In Progress' });
      assert(repository.getGoals().length === 1, 'Goal added');

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
    // TEST 4: Duplicate Payout Prevention & One-Way FK Sync + Compensating Delete
    // =========================================================================
    console.log('Test 4: Duplicate salary payout, one-way salary_payout_id FK, and compensating delete...');
    {
      let payoutsTable: any[] = [];
      let incomesTable: any[] = [];
      let failStep2IncomeInsert = false;
      let nextPayoutId = UUID_1;
      const opLog: string[] = [];

      const salaryClient = createMockSupabase(USER_A, {
        salary_payouts: (ctx) => {
          assert(
            !ctx.selectColumns?.includes('synced_to_income_id'),
            'salary_payouts select MUST NOT reference non-existent synced_to_income_id'
          );
          if (ctx.payload && 'synced_to_income_id' in ctx.payload) {
            throw new Error('salary_payouts payload MUST NOT include non-existent synced_to_income_id');
          }

          if (ctx.op === 'insert') {
            opLog.push('insert_payout');
            const period = ctx.payload.period_month;
            if (payoutsTable.some(p => p.period_month === period)) {
              return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint unique_user_salary_period' } };
            }
            const row = { id: nextPayoutId, ...ctx.payload };
            payoutsTable.push(row);
            return { data: row, error: null };
          }
          if (ctx.op === 'update') {
            throw new Error('salary_payouts should not require post-insert update when using one-way FK incomes.salary_payout_id');
          }
          if (ctx.op === 'delete') {
            opLog.push('delete_payout');
            const idFilter = ctx.filters.find(f => f.col === 'id')?.val;
            const deleted = payoutsTable.filter(p => p.id === idFilter);
            payoutsTable = payoutsTable.filter(p => p.id !== idFilter);
            return { data: deleted.map(d => ({ id: d.id })), error: null };
          }
          if (ctx.op === 'select' && (ctx.singleMode === 'maybeSingle' || ctx.singleMode === 'single')) {
            const periodFilter = ctx.filters.find(f => f.col === 'period_month')?.val;
            const found = periodFilter
              ? payoutsTable.find(p => p.period_month === periodFilter) || null
              : payoutsTable[0] || null;
            return { data: found, error: null };
          }
          return { data: payoutsTable, error: null };
        },
        incomes: (ctx) => {
          if (ctx.op === 'insert') {
            opLog.push('insert_income');
            if (failStep2IncomeInsert) {
              return { data: null, error: { message: 'Step 2 income insert failed' } };
            }
            const row = { id: UUID_2, created_at: '2026-05-31T00:00:00Z', ...ctx.payload };
            incomesTable.push(row);
            return { data: row, error: null };
          }
          if (ctx.op === 'delete') {
            opLog.push('delete_income');
            const payoutIdFilter = ctx.filters.find(f => f.col === 'salary_payout_id')?.val;
            const idFilter = ctx.filters.find(f => f.col === 'id')?.val;
            const deleted = incomesTable.filter(i =>
              payoutIdFilter ? i.salary_payout_id === payoutIdFilter : i.id === idFilter
            );
            incomesTable = incomesTable.filter(i =>
              payoutIdFilter ? i.salary_payout_id !== payoutIdFilter : i.id !== idFilter
            );
            return { data: deleted.map(d => ({ id: d.id })), error: null };
          }
          return { data: incomesTable, error: null };
        }
      });

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(salaryClient, true);

      const basePayout = {
        periodMonth: '2026-05',
        paymentDate: '2026-05-31',
        salaryType: 'daily_wage' as const,
        baseAmount: 500,
        presentDays: 22,
        absentDays: 0,
        leaveDays: 0,
        holidayDays: 0,
        totalWorkingHours: 176,
        overtimeHours: 0,
        grossSalary: 11000,
        totalAllowances: 0,
        totalDeductions: 0,
        netSalary: 11000,
        status: 'Paid' as const,
        notes: 'May Payout'
      };

      // Step 4a: Failure on Request 2 (synced income insert) compensates by deleting Request 1 payout
      failStep2IncomeInsert = true;
      let step2RolledBack = false;
      try {
        await repository.recordSalaryPayout(basePayout, true, false);
      } catch {
        step2RolledBack = true;
      }
      assert(step2RolledBack, 'Request 2 income failure must throw');
      assert(payoutsTable.length === 0, 'Request 1 salary_payout row must be deleted via compensation when Request 2 income insert fails');
      assert(repository.getSalaryPayouts().length === 0, 'memoryState.salaryPayouts must remain empty on rollback');

      // Step 4b: Happy path 2-request workflow sets one-way FK incomes.salary_payout_id and rejects duplicate
      failStep2IncomeInsert = false;
      opLog.length = 0;
      const savedPayout = await repository.recordSalaryPayout(basePayout, true, false);
      assert(savedPayout.id === UUID_1, 'Payout uses DB UUID');
      assert(opLog.join(',') === 'insert_payout,insert_income', `Expected 2-step insert order, got ${opLog.join(',')}`);
      assert(repository.getIncomes()[0].salaryPayoutId === UUID_1, 'Income salaryPayoutId links via one-way FK to payout UUID');
      assert(incomesTable[0].salary_payout_id === UUID_1, 'DB income stores salary_payout_id = payout UUID');

      let dupRejected = false;
      try {
        await repository.recordSalaryPayout(basePayout, true, false);
      } catch {
        dupRejected = true;
      }
      assert(dupRejected, 'Duplicate period payout with allowReplace=false must be rejected');

      // Step 4c: Safe replace deletes old linked income first, then old payout, then inserts fresh pair
      opLog.length = 0;
      nextPayoutId = UUID_3;
      const replaced = await repository.recordSalaryPayout({ ...basePayout, netSalary: 11500 }, true, true);
      assert(replaced.id === UUID_3, 'Replacement payout uses fresh DB UUID');
      assert(replaced.netSalary === 11500, 'Replacement payout updated');
      assert(
        opLog.join(',') === 'delete_income,delete_payout,insert_payout,insert_income',
        `Expected safe replace order, got ${opLog.join(',')}`
      );
      assert(repository.getSalaryPayouts().length === 1, 'Exactly 1 payout after replace');
      assert(repository.getIncomes().length === 1 && repository.getIncomes()[0].salaryPayoutId === UUID_3, 'Exactly 1 linked income pointing to replacement payout');

      // Step 4d: deleteSalaryPayout deletes linked income (by salary_payout_id) first, then payout
      opLog.length = 0;
      await repository.deleteSalaryPayout(UUID_3);
      assert(opLog.join(',') === 'delete_income,delete_payout', `Expected delete order delete_income,delete_payout, got ${opLog.join(',')}`);
      assert(incomesTable.length === 0 && payoutsTable.length === 0, 'Both linked income and payout deleted cleanly from DB');
      assert(repository.getIncomes().length === 0 && repository.getSalaryPayouts().length === 0, 'Both cleared from state');
    }
    console.log('✓ Test 4 passed.');

    // =========================================================================
    // TEST 5: Receivables Over-Repayment & DB Trigger Reconciliation
    // =========================================================================
    console.log('Test 5: Receivables over-repayment block & trigger status reconciliation...');
    {
      let debtRow: any = {
        id: UUID_1,
        person_name: 'Vikram',
        type: 'lent',
        original_amount: 1000,
        transaction_date: '2026-05-01',
        status: 'Pending',
        created_at: '2026-05-01T00:00:00Z',
        updated_at: '2026-05-01T00:00:00Z'
      };

      const debtClient = createMockSupabase(USER_A, {
        debts: (ctx) => {
          if (ctx.op === 'insert') return { data: debtRow, error: null };
          return { data: debtRow, error: null }; // .select().single() reconciliation
        },
        debt_repayments: (ctx) => {
          if (ctx.op === 'insert') {
            // Simulate PostgreSQL trigger trg_sync_debt_status updating debts.status
            debtRow = { ...debtRow, status: 'Partial' };
            return {
              data: { id: UUID_2, debt_id: UUID_1, amount: ctx.payload.amount, repayment_date: ctx.payload.repayment_date, notes: '', created_at: '2026-05-02T00:00:00Z' },
              error: null
            };
          }
          if (ctx.op === 'delete') {
            debtRow = { ...debtRow, status: 'Pending' };
            return { data: [{ id: UUID_2 }], error: null };
          }
          return { data: [], error: null };
        }
      });

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(debtClient, true);

      await repository.addDebt({ person_name: 'Vikram', type: 'lent', original_amount: 1000, transaction_date: '2026-05-01' });

      let overRepayRejected = false;
      try {
        await repository.addDebtRepayment({ debt_id: UUID_1, amount: 1500, repayment_date: '2026-05-02' });
      } catch {
        overRepayRejected = true;
      }
      assert(overRepayRejected, 'Over-repayment must be rejected');

      await repository.addDebtRepayment({ debt_id: UUID_1, amount: 400, repayment_date: '2026-05-02' });
      assert(repository.getDebts()[0].status === 'Partial', 'Debt status reconciled to Partial');

      await repository.deleteDebtRepayment(UUID_2);
      assert(repository.getDebts()[0].status === 'Pending', 'Debt status reconciled back to Pending after repayment deletion');
    }
    console.log('✓ Test 5 passed.');

    // =========================================================================
    // TEST 6: Savings Over-Withdrawal, current_balance Mapping & Initial Deposit Rollback
    // =========================================================================
    console.log('Test 6: Savings over-withdrawal, current_balance trigger read, & initial deposit rollback...');
    {
      let savingsGoalsTable: any[] = [];
      let failInitialTx = true;

      const savingsClient = createMockSupabase(USER_A, {
        savings_goals: (ctx) => {
          if (ctx.op === 'insert') {
            assert(
              !('current_amount' in ctx.payload),
              'savings_goals insert MUST NOT write unsupported current_amount column'
            );
            assert(
              !('current_balance' in ctx.payload),
              'savings_goals insert MUST NOT manually overwrite trigger-maintained current_balance'
            );
            assert(
              !('start_date' in ctx.payload),
              'savings_goals insert MUST NOT write unsupported start_date column'
            );
            assert(
              !('description' in ctx.payload),
              'savings_goals insert MUST NOT write unsupported description column (must map to notes)'
            );
            const row = { id: UUID_1, ...ctx.payload, current_balance: 0, created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z' };
            savingsGoalsTable.push(row);
            return { data: row, error: null };
          }
          if (ctx.op === 'update') {
            assert(
              !('current_amount' in ctx.payload) && !('current_balance' in ctx.payload),
              'savings_goals update MUST NOT overwrite trigger-maintained current_balance'
            );
            assert(
              !('start_date' in ctx.payload),
              'savings_goals update MUST NOT write unsupported start_date column'
            );
            assert(
              !('description' in ctx.payload),
              'savings_goals update MUST NOT write unsupported description column (must map to notes)'
            );
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
            if (failInitialTx) {
              return { data: null, error: { message: 'Initial deposit insert failed' } };
            }
            // Simulate DB trigger updating current_balance (NOT current_amount)
            if (savingsGoalsTable[0]) {
              savingsGoalsTable[0] = {
                ...savingsGoalsTable[0],
                current_balance: savingsGoalsTable[0].current_balance + ctx.payload.amount
              };
            }
            return {
              data: { id: UUID_2, ...ctx.payload, created_at: '2026-05-01T00:00:00Z' },
              error: null
            };
          }
          return { data: [], error: null };
        }
      });

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(savingsClient, true);

      let goalRolledBack = false;
      try {
        await repository.addSavingsGoal({ name: 'Laptop', targetAmount: 80000, initialDeposit: 10000, startDate: '2026-05-01', description: 'Workstation reserve' });
      } catch {
        goalRolledBack = true;
      }
      assert(goalRolledBack, 'Failed initial deposit must throw');
      assert(savingsGoalsTable.length === 0, 'Parent savings_goal must be rolled back when initial deposit fails');

      failInitialTx = false;
      const sg = await repository.addSavingsGoal({ name: 'Laptop', targetAmount: 80000, initialDeposit: 10000, startDate: '2026-05-01', description: 'Workstation reserve' });
      assert(sg.currentAmount === 10000, 'Reconciled currentAmount from trigger-maintained current_balance after initial deposit');
      assert(sg.description === 'Workstation reserve', 'Mapped DB notes column back to SavingsGoal.description');
      assert(savingsGoalsTable[0].notes === 'Workstation reserve', 'DB insert stored description in notes column');

      // Update savings goal: description -> notes, startDate ignored by DB payload, current_balance untouched
      await repository.updateSavingsGoal(sg.id, {
        name: 'MacBook Pro',
        targetAmount: 95000,
        startDate: '2026-06-01',
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
          data: [{ id: UUID_1, title: 'Internet', amount: 999, category: 'Utilities', date: '2026-05-01', payment_method: 'Bank Transfer', is_recurring: false, recurring_frequency: 'None', created_at: '2026-05-01' }],
          error: null
        }),
        incomes: () => incomesShouldFail
          ? { data: null, error: { message: 'Temporary timeout on incomes' } }
          : { data: [{ id: UUID_2, title: 'Paycheck', amount: 50000, source: 'Salary', date: '2026-05-01', created_at: '2026-05-01' }], error: null }
      });

      repository.clearUserData();
      configureRepositoryBackendForTests(partialClient, true);

      const firstFetch = await repository.fetchAllUserData(USER_A);
      assert(firstFetch.partialErrors.length === 0, 'Initial full fetch succeeds');
      assert(repository.getIncomes().length === 1, 'Incomes populated');

      // Second fetch: incomes errors out, expenses stays valid
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
            data: [{ id: UUID_4, title: 'User B Expense', amount: 250, category: 'Food', date: '2026-05-03', payment_method: 'Cash', is_recurring: false, recurring_frequency: 'None', created_at: '2026-05-03' }],
            error: null
          };
        }
      });

      repository.clearUserData();
      configureRepositoryBackendForTests(slowClient, true);

      // Start slow User A hydration
      const userAPromise = repository.fetchAllUserData(USER_A);

      // Switch to User B immediately
      (slowClient as any).__setSessionUserId(USER_B);
      repository.clearUserData();
      const userBResult = await repository.fetchAllUserData(USER_B);
      assert(userBResult.stale === false, 'User B fetch completes actively');
      assert(repository.getExpenses().length === 1 && repository.getExpenses()[0].id === UUID_4, 'User B expenses active');

      // Now User A's stale slow query finally resolves!
      resolveUserAFetch({
        data: [{ id: UUID_3, title: 'User A Stale Expense', amount: 9999, category: 'Other', date: '2026-05-01', payment_method: 'Cash', is_recurring: false, recurring_frequency: 'None', created_at: '2026-05-01' }],
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

      // Reference date in Jan 2026 -> this_month should include Jan 1 and Jan 31, exclude Dec 31 and Feb 1
      const janFiltered = filterRecordsByDateRange(sampleRecords, 'this_month', undefined, undefined, new Date(2026, 0, 15));
      assert(janFiltered.map(r => r.id).join(',') === 'r2,r3', `Jan this_month got ${janFiltered.map(r => r.id).join(',')}`);

      // Reference date in Jan 2026 -> last_month should include 2025-12-31 across year transition!
      const decFiltered = filterRecordsByDateRange(sampleRecords, 'last_month', undefined, undefined, new Date(2026, 0, 10));
      assert(decFiltered.map(r => r.id).join(',') === 'r1', `Dec last_month across year boundary got ${decFiltered.map(r => r.id).join(',')}`);

      // Leap year Feb 2024 boundary
      const leapFiltered = filterRecordsByDateRange(sampleRecords, 'this_month', undefined, undefined, new Date(2024, 1, 29));
      assert(leapFiltered.map(r => r.id).join(',') === 'r4', 'Leap day included in Feb 2024 month filter');

      // Custom range
      const customFiltered = filterRecordsByDateRange(sampleRecords, 'custom', '2026-01-01', '2026-02-01');
      assert(customFiltered.map(r => r.id).join(',') === 'r2,r3,r5', 'Custom boundary inclusive on both endpoints');
    }
    console.log('✓ Test 12 passed.');

    // =========================================================================
    // TEST 13: INR Default Currency & Preserving Saved User currency_code
    // =========================================================================
    console.log('Test 13: INR default vs saved USD/EUR currency_code preservation...');
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
      settingsRow = { user_id: USER_A, currency_code: null, date_format: 'YYYY-MM-DD', week_start_day: 'Monday' };
      await repository.fetchAllUserData(USER_A);
      assert(repository.getSettings().currency === 'INR', 'Null currency_code column defaults to INR');

      // Existing saved USD -> preserved!
      settingsRow = { user_id: USER_A, currency_code: 'USD', date_format: 'MM/DD/YYYY', week_start_day: 'Sunday' };
      salaryConfigRow = { user_id: USER_A, currency_code: 'USD', salary_type: 'daily_wage', daily_base_salary: 200 };
      await repository.fetchAllUserData(USER_A);
      assert(repository.getSettings().currency === 'USD', 'Saved USD currency_code preference MUST be preserved');
      assert(repository.getSettings().salaryConfig.currency === 'USD', 'salary_configs currency_code USD mapped');
      assert(repository.getSettings().dateFormat === 'MM/DD/YYYY', 'Saved date format preserved');
      assert(repository.getSettings().weekStartDay === 'Sunday', 'Saved week start day preserved');

      // Existing saved EUR -> preserved!
      settingsRow = { user_id: USER_A, currency_code: 'EUR', date_format: 'DD/MM/YYYY', week_start_day: 'Monday' };
      salaryConfigRow = { user_id: USER_A, currency_code: 'EUR', salary_type: 'fixed_monthly', base_amount: 4000 };
      await repository.fetchAllUserData(USER_A);
      assert(repository.getSettings().currency === 'EUR', 'Saved EUR currency_code preference MUST be preserved');
      assert(repository.getSettings().salaryConfig.currency === 'EUR', 'salary_configs currency_code EUR mapped');
    }
    console.log('✓ Test 13 passed.');

    // =========================================================================
    // TEST 14: salary_configs currency_code Persistence & updateGoal Includes `type`
    // =========================================================================
    console.log('Test 14: salary_configs currency_code persistence & updateGoal sends type...');
    {
      let capturedSalaryPayload: any = null;
      let capturedGoalUpdatePayload: any = null;

      const configClient = createMockSupabase(USER_A, {
        salary_configs: (ctx) => {
          assert(
            !('currency' in ctx.payload),
            'salary_configs upsert MUST NOT write non-existent currency column (must write currency_code)'
          );
          capturedSalaryPayload = ctx.payload;
          return { data: ctx.payload, error: null };
        },
        goals: (ctx) => {
          if (ctx.op === 'insert') {
            assert(
              !('current_amount' in ctx.payload),
              'goals insert MUST NOT send unsupported current_amount column'
            );
            return {
              data: { id: UUID_1, title: 'My Goal', description: '', type: 'goal', category: 'Personal', priority: 'Medium', status: 'In Progress', created_at: '2026-05-01' },
              error: null
            };
          }
          if (ctx.op === 'update') {
            assert(
              !('current_amount' in ctx.payload),
              'goals update MUST NOT send unsupported current_amount column'
            );
            capturedGoalUpdatePayload = ctx.payload;
            return {
              data: { id: UUID_1, title: 'My Dream', description: '', type: ctx.payload.type || 'goal', category: 'Personal', priority: 'High', status: 'In Progress', created_at: '2026-05-01' },
              error: null
            };
          }
          return { data: [], error: null };
        }
      });

      repository.clearUserData();
      repository.setActiveUserId(USER_A);
      configureRepositoryBackendForTests(configClient, true);

      await repository.persistSalaryConfig({
        currency: 'USD',
        salaryType: 'daily_wage',
        dailyBaseSalary: 1200,
        standardWorkingHours: 9,
        extraHourRate: 200,
        baseAmount: 1200,
        expectedWorkingDaysPerMonth: 24,
        expectedWorkingHoursPerDay: 9,
        weeklyHolidays: ['Sunday'],
        paidLeaveAllowancePerMonth: 1,
        overtimeRateMultiplier: 1.5,
        paymentDateOfMonth: 1,
        fixedMonthlyAbsencePolicy: 'no_deduction',
        includeOvertimeInMonthly: true,
        allowances: [],
        deductions: []
      });

      assert(capturedSalaryPayload?.currency_code === 'USD', 'salary_configs upsert sends currency_code');
      assert(capturedSalaryPayload?.daily_base_salary === 1200, 'salary_configs upsert sends daily_base_salary');
      assert(capturedSalaryPayload?.standard_working_hours === 9, 'salary_configs upsert sends standard_working_hours');
      assert(capturedSalaryPayload?.extra_hour_rate === 200, 'salary_configs upsert sends extra_hour_rate');
      assert(repository.getSettings().salaryConfig.currency === 'USD', 'memoryState reflects persisted currency_code');
      assert(repository.getSettings().salaryConfig.dailyBaseSalary === 1200, 'memoryState reflects persisted dailyBaseSalary');

      await repository.addGoal({ title: 'My Goal', description: '', type: 'goal', category: 'Personal', currentAmount: 500, priority: 'Medium', status: 'In Progress' });
      await repository.updateGoal(UUID_1, { title: 'My Dream', type: 'dream', currentAmount: 900, priority: 'High' });
      assert(capturedGoalUpdatePayload?.type === 'dream', 'updateGoal must include type field in DB payload');
      assert(repository.getGoals()[0].type === 'dream', 'Goal type updated cleanly in state');
    }
    console.log('✓ Test 14 passed.');

    console.log('\n======================================================');
    console.log('--- ALL 14 PERSISTENCE & INTEGRITY TESTS PASSED! ---');
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
