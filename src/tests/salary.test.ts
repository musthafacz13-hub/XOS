/**
 * XOS System Test Suite
 * Validates:
 * 1. Duplicate payout prevention & safe replacement
 * 2. Bi-directional Income and Payout synchronization
 * 3. Overtime calculations without double-counting (hourly_wage, custom, monthly)
 * 4. Zero vs missing hours handling (no hardcoded 8-hour fallback)
 * 5. Fixed monthly absence policies (no_deduction vs deduct_unpaid_absent)
 * 6. Savings goal initial deposit single-credit verification (zero double-counting)
 * 7. Debt management calculations (lent = receivable, borrowed = payable, repayments)
 * 8. Pure in-memory repository architecture without browser storage persistence
 */

import { 
  calculateAttendanceStats, 
  calculateAttendanceStatsForRecords, 
  calculateEstimatedSalary,
  calculateDebtSummary,
  calculateDebtOutstanding
} from '../utils/calculations';
import { repository } from '../services/repository';
import { AttendanceRecord, SalaryConfig } from '../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertClose(actual: number, expected: number, message: string, precision: number = 0.01) {
  if (Math.abs(actual - expected) > precision) {
    throw new Error(`Assertion failed: ${message} (Expected: ${expected}, Got: ${actual})`);
  }
}

console.log('--- Running XOS Core & Calculation Test Suite ---');

// Reset repository in-memory state
repository.clearAllData();

// ==========================================
// TEST 1: Working Hours Fallback & 0-Hour Preservation
// ==========================================
console.log('Test 1: Working-hours fallback & explicit 0-hours...');

const attendanceSample: AttendanceRecord[] = [
  { id: '1', date: '2026-05-01', status: 'Present', calculatedHours: 0 }, // explicit 0 hours
  { id: '2', date: '2026-05-02', status: 'Present', calculatedHours: 7.5 },
  { id: '3', date: '2026-05-03', status: 'Present' }, // missing hours -> should fallback to expectedDailyHours (6)
  { id: '4', date: '2026-05-04', status: 'Absent' }
];

const statsWithExpected6 = calculateAttendanceStats(attendanceSample, '2026-05', 6);
assert(statsWithExpected6.presentDays === 3, 'Present days should be 3');
assert(statsWithExpected6.absentDays === 1, 'Absent days should be 1');
assert(statsWithExpected6.missingHoursCount === 1, 'Missing hours count should be 1');
// 0 + 7.5 + 6 = 13.5 hours
assertClose(statsWithExpected6.totalHours, 13.5, 'Total hours should use 6 for missing and keep 0 for explicit 0');
console.log('✓ Test 1 passed: Explicit 0 preserved, expectedDailyHours used instead of hardcoded 8.');

// ==========================================
// TEST 2: Overtime Calculation for Hourly Wage (No Double Counting)
// ==========================================
console.log('Test 2: Hourly wage overtime calculation & multiplier...');

const hourlyConfig: SalaryConfig = {
  salaryType: 'hourly_wage',
  baseAmount: 25.00, // $25/hr
  currency: 'USD',
  expectedWorkingDaysPerMonth: 20,
  expectedWorkingHoursPerDay: 8, // expected standard is 8h/day
  weeklyHolidays: ['Saturday', 'Sunday'],
  paidLeaveAllowancePerMonth: 0,
  overtimeRateMultiplier: 1.5, // 1.5x overtime rate = $37.50/hr
  allowances: [],
  deductions: [],
  paymentDateOfMonth: 1
};

// 5 days worked, total 48 hours (40 regular hours, 8 overtime hours)
const hourlyAttendance: AttendanceRecord[] = [
  { id: 'h1', date: '2026-05-01', status: 'Present', calculatedHours: 10 },
  { id: 'h2', date: '2026-05-02', status: 'Present', calculatedHours: 10 },
  { id: 'h3', date: '2026-05-03', status: 'Present', calculatedHours: 10 },
  { id: 'h4', date: '2026-05-04', status: 'Present', calculatedHours: 10 },
  { id: 'h5', date: '2026-05-05', status: 'Present', calculatedHours: 8 }
];

const hourlyResult = calculateEstimatedSalary(hourlyConfig, hourlyAttendance, '2026-05');
assert(hourlyResult.totalWorkingHours === 48, 'Total hours should be 48');
assert(hourlyResult.overtimeHours === 8, 'Overtime hours should be 8 (48 - 5*8 = 8)');

// Regular: 40 * $25 = $1000
// Overtime: 8 * ($25 * 1.5) = 8 * $37.50 = $300
// Total: $1300
assertClose(hourlyResult.grossSalary, 1300, 'Hourly gross salary should be 1000 + 300 = 1300');
assertClose(hourlyResult.netSalary, 1300, 'Hourly net salary should be 1300');
console.log('✓ Test 2 passed: Overtime rate multiplier applied with zero double-counting.');

// ==========================================
// TEST 3: Fixed Monthly Absence Policies
// ==========================================
console.log('Test 3: Fixed monthly absence policies...');

const fixedMonthlyBaseConfig: SalaryConfig = {
  salaryType: 'fixed_monthly',
  baseAmount: 4000.00,
  currency: 'USD',
  expectedWorkingDaysPerMonth: 20, // $200/day
  expectedWorkingHoursPerDay: 8,
  weeklyHolidays: ['Saturday', 'Sunday'],
  paidLeaveAllowancePerMonth: 1, // 1 paid leave
  overtimeRateMultiplier: 1.5,
  allowances: [],
  deductions: [],
  paymentDateOfMonth: 1
};

const monthlyAttendance: AttendanceRecord[] = [
  ...Array.from({ length: 15 }, (_, i) => ({
    id: `m_p_${i}`,
    date: `2026-05-${String(i + 1).padStart(2, '0')}`,
    status: 'Present' as const,
    calculatedHours: 8
  })),
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `m_a_${i}`,
    date: `2026-05-${String(i + 16).padStart(2, '0')}`,
    status: 'Absent' as const
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `m_l_${i}`,
    date: `2026-05-${String(i + 19).padStart(2, '0')}`,
    status: 'Leave' as const
  }))
];

// Sub-test A: policy = 'no_deduction'
const noDeductionResult = calculateEstimatedSalary({
  ...fixedMonthlyBaseConfig,
  fixedMonthlyAbsencePolicy: 'no_deduction'
}, monthlyAttendance, '2026-05');

assertClose(noDeductionResult.grossSalary, 4000, 'no_deduction policy should preserve full base amount');
assert(noDeductionResult.absenceDeduction === 0, 'no_deduction absence deduction should be 0');

// Sub-test B: policy = 'deduct_unpaid_absent'
// 3 absent + 1 unpaid leave = 4 unpaid days
// Daily rate = 4000 / 20 = $200/day
// Deduction = 4 * 200 = $800
// Gross = 4000 - 800 = $3200
const deductResult = calculateEstimatedSalary({
  ...fixedMonthlyBaseConfig,
  fixedMonthlyAbsencePolicy: 'deduct_unpaid_absent'
}, monthlyAttendance, '2026-05');

assertClose(deductResult.absenceDeduction, 800, 'Deduction should be 4 days * 200 = 800');
assertClose(deductResult.grossSalary, 3200, 'Gross salary should be 4000 - 800 = 3200');
console.log('✓ Test 3 passed: Configurable absence policies computed and itemized accurately.');

// ==========================================
// TEST 4: Duplicate Payout Prevention & Safe Replacement
// ==========================================
console.log('Test 4: Repository duplicate payout prevention...');

const payoutPayload = {
  periodMonth: '2026-05',
  paymentDate: '2026-05-31',
  salaryType: 'fixed_monthly' as const,
  baseAmount: 3000,
  presentDays: 20,
  absentDays: 0,
  leaveDays: 0,
  holidayDays: 0,
  totalWorkingHours: 160,
  overtimeHours: 0,
  grossSalary: 3000,
  totalAllowances: 0,
  totalDeductions: 0,
  netSalary: 3000,
  status: 'Paid' as const,
  notes: 'May 2026'
};

// First recording should succeed
const firstPayout = repository.recordSalaryPayout(payoutPayload, true, false);
assert(firstPayout.id.startsWith('sp_'), 'First payout created');
assert(repository.getSalaryPayouts().length === 1, 'Payouts count should be 1');
assert(repository.getIncomes().length === 1, 'Incomes count should be 1');

// Duplicate recording without allowReplace must throw an Error
let duplicatePrevented = false;
try {
  repository.recordSalaryPayout(payoutPayload, true, false);
} catch (err) {
  duplicatePrevented = true;
}
assert(duplicatePrevented, 'Repository must reject duplicate payout for 2026-05');
assert(repository.getSalaryPayouts().length === 1, 'Payouts count must remain 1 after rejected duplicate');
assert(repository.getIncomes().length === 1, 'Incomes count must remain 1 after rejected duplicate');

// Recording with allowReplace should succeed and replace without leaving duplicate income
const updatedPayoutPayload = {
  ...payoutPayload,
  netSalary: 3500,
  grossSalary: 3500
};
const replacedPayout = repository.recordSalaryPayout(updatedPayoutPayload, true, true);
assert(repository.getSalaryPayouts().length === 1, 'Payouts count must still be 1 after replacement');
assert(repository.getIncomes().length === 1, 'Incomes count must still be 1 after replacement');
assert(repository.getSalaryPayouts()[0].netSalary === 3500, 'Net salary updated to 3500');
assert(repository.getIncomes()[0].amount === 3500, 'Synced income updated to 3500');
console.log('✓ Test 4 passed: Duplicate payouts blocked; replacement executed cleanly.');

// ==========================================
// TEST 5: Income Deletion Detaches Payout Sync Without Deleting Payout History
// ==========================================
console.log('Test 5: Income deletion safely detaches payout sync...');

const linkedIncomeId = replacedPayout.syncedToIncomeId!;
assert(Boolean(linkedIncomeId), 'Linked income id must exist');

// Delete the income manually
repository.deleteIncome(linkedIncomeId);

// The Income should be gone
assert(repository.getIncomes().length === 0, 'Income must be deleted');

// The SalaryPayout MUST STILL EXIST, but syncedToIncomeId must be undefined
const payoutsAfterIncomeDelete = repository.getSalaryPayouts();
assert(payoutsAfterIncomeDelete.length === 1, 'Payout history must be preserved');
assert(payoutsAfterIncomeDelete[0].syncedToIncomeId === undefined, 'Payout syncedToIncomeId must be detached');
console.log('✓ Test 5 passed: Income deletion safely detached payout sync while preserving history.');

// ==========================================
// TEST 6: Payout Deletion Cleans Up Linked Income
// ==========================================
console.log('Test 6: Payout deletion cleans up linked income...');

const freshPayout = repository.recordSalaryPayout({
  ...payoutPayload,
  periodMonth: '2026-06'
}, true, false);

assert(repository.getSalaryPayouts().length === 2, 'Two payouts exist');
assert(repository.getIncomes().length === 1, 'One income exists');

repository.deleteSalaryPayout(freshPayout.id);
assert(repository.getSalaryPayouts().length === 1, 'Payout deleted');
assert(repository.getIncomes().length === 0, 'Linked income was deleted along with payout');
console.log('✓ Test 6 passed: Payout deletion cleaned up linked income cleanly.');

// ==========================================
// TEST 7: Savings Goal Initial Deposit (Zero Double Counting)
// ==========================================
console.log('Test 7: Savings goal initial deposit single-credit...');

const initialDepositAmount = 500;
const newGoal = repository.addSavingsGoal({
  name: 'Emergency Fund',
  targetAmount: 5000,
  startDate: '2026-05-01',
  description: 'Safety net',
  initialDeposit: initialDepositAmount
});

const createdGoal = repository.getSavingsGoals().find(g => g.id === newGoal.id);
assert(createdGoal !== undefined, 'Created goal should exist');
assert(createdGoal!.currentAmount === 500, `currentAmount must be exactly ${initialDepositAmount}, got ${createdGoal!.currentAmount}`);

const goalTransactions = repository.getSavingsTransactions().filter(t => t.savingsGoalId === newGoal.id);
assert(goalTransactions.length === 1, 'Exactly 1 initial deposit transaction must exist');
assert(goalTransactions[0].amount === 500, 'Transaction amount must be 500');

console.log('✓ Test 7 passed: Savings goal initial deposit is credited exactly once (no double-count).');

// ==========================================
// TEST 8: Debt Management Calculations & Repayments
// ==========================================
console.log('Test 8: Debt management calculation...');

const lentDebt = repository.addDebt({
  person_name: 'Alex Rivera',
  type: 'lent',
  original_amount: 1000,
  transaction_date: '2026-05-01',
  due_date: '2026-06-30',
  description: 'Project advance'
});

const borrowedDebt = repository.addDebt({
  person_name: 'City Bank',
  type: 'borrowed',
  original_amount: 2000,
  transaction_date: '2026-05-01',
  due_date: '2026-12-31',
  description: 'Equipment loan'
});

let debtSummary = calculateDebtSummary(repository.getDebts(), repository.getDebtRepayments());
assert(debtSummary.totalLent === 1000, 'Total lent must be 1000');
assert(debtSummary.totalBorrowed === 2000, 'Total borrowed must be 2000');
assert(debtSummary.outstandingReceivable === 1000, 'Outstanding receivable must be 1000');
assert(debtSummary.outstandingPayable === 2000, 'Outstanding payable must be 2000');
assert(debtSummary.pendingCount === 2, 'Pending count must be 2');

// Add partial repayment to Alex (300 repaid)
repository.addDebtRepayment({
  debt_id: lentDebt.id,
  amount: 300,
  repayment_date: '2026-05-15',
  notes: 'First installment'
});

const updatedLent = repository.getDebts().find(d => d.id === lentDebt.id);
assert(updatedLent!.status === 'Partial', 'Debt status must transition to Partial');
assertClose(calculateDebtOutstanding(updatedLent!, repository.getDebtRepayments()), 700, 'Outstanding must be 700');

// Complete repayment (700 repaid)
repository.addDebtRepayment({
  debt_id: lentDebt.id,
  amount: 700,
  repayment_date: '2026-05-20',
  notes: 'Full payoff'
});

const paidLent = repository.getDebts().find(d => d.id === lentDebt.id);
assert(paidLent!.status === 'Paid', 'Debt status must transition to Paid');
assertClose(calculateDebtOutstanding(paidLent!, repository.getDebtRepayments()), 0, 'Outstanding must be 0');

debtSummary = calculateDebtSummary(repository.getDebts(), repository.getDebtRepayments());
assert(debtSummary.completedCount === 1, 'Completed count must be 1');
assert(debtSummary.outstandingReceivable === 0, 'Outstanding receivable must now be 0');
assert(debtSummary.outstandingPayable === 2000, 'Outstanding payable must remain 2000');

console.log('✓ Test 8 passed: Debt accounting, status transitions, and outstanding balances verified.');

// ==========================================
// TEST 9: In-Memory Isolation (No browser storage reliance)
// ==========================================
console.log('Test 9: In-memory session verification...');

const status = repository.getBackendStatus();
assert(status.isBackendConfigured === false, 'Backend configured should be false');
assert(status.persistenceMode === 'in-memory', 'Persistence mode must be in-memory');

console.log('✓ Test 9 passed: Pure in-memory session verified.');

console.log('\n======================================================');
console.log('--- ALL 9 TEST SUITE CASES COMPLETED SUCCESSFULLY! ---');
console.log('======================================================');
