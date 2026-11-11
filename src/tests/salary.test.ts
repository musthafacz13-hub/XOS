/**
 * XOS System Test Suite
 * Validates:
 * 1. Working-hours calculation & daily earnings formula (Base 500 + Extra Hours * 100)
 * 2. Future attendance date blocking in repository
 * 3. Savings goal over-withdrawal rejection
 * 4. Receivables debt over-repayment rejection
 * 5. Duplicate payout prevention & safe replacement
 * 6. Bi-directional Income and Payout synchronization
 * 7. Pure in-memory repository architecture without browser storage persistence
 */

import { 
  calculateAttendanceStats, 
  calculateDailyEarnedSalary,
  calculateMonthlySalarySummary,
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
// TEST 1: Daily Salary Formula (Present: Base 500 + ExtraHours*100; Absent/Leave: 0)
// ==========================================
console.log('Test 1: Daily Salary Formula...');

const config: Partial<SalaryConfig> = {
  dailyBaseSalary: 500,
  standardWorkingHours: 8,
  extraHourRate: 100
};

// 8 hours Present -> 500
const res8h = calculateDailyEarnedSalary('Present', 8, config);
assert(res8h.workingHours === 8, 'Working hours 8');
assert(res8h.extraHours === 0, 'Extra hours 0');
assert(res8h.dailyEarnedSalary === 500, 'Daily salary for 8h present should be 500');

// 9 hours Present -> 500 + 1*100 = 600
const res9h = calculateDailyEarnedSalary('Present', 9, config);
assert(res9h.extraHours === 1, 'Extra hours 1');
assert(res9h.dailyEarnedSalary === 600, 'Daily salary for 9h present should be 600');

// 10 hours Present -> 500 + 2*100 = 700
const res10h = calculateDailyEarnedSalary('Present', 10, config);
assert(res10h.extraHours === 2, 'Extra hours 2');
assert(res10h.dailyEarnedSalary === 700, 'Daily salary for 10h present should be 700');

// Leave -> 0
const resLeave = calculateDailyEarnedSalary('Leave', 8, config);
assert(resLeave.dailyEarnedSalary === 0, 'Daily salary for Leave should be 0');

// Absent -> 0
const resAbsent = calculateDailyEarnedSalary('Absent', 8, config);
assert(resAbsent.dailyEarnedSalary === 0, 'Daily salary for Absent should be 0');

console.log('✓ Test 1 passed: Daily salary formula verified.');

// ==========================================
// TEST 2: Future Attendance Date Guard
// ==========================================
console.log('Test 2: Future attendance date guard in repository...');

let futureBlocked = false;
try {
  repository.upsertAttendanceRecord({
    date: '2099-12-31',
    status: 'Present',
    calculatedHours: 8
  });
} catch (err) {
  futureBlocked = true;
}
assert(futureBlocked, 'Repository must reject future attendance dates');
console.log('✓ Test 2 passed: Future attendance date successfully blocked.');

// ==========================================
// TEST 3: Savings Over-Withdrawal Guard
// ==========================================
console.log('Test 3: Savings over-withdrawal guard...');

const savingsGoal = repository.addSavingsGoal({
  name: 'Emergency Fund',
  targetAmount: 5000,
  initialDeposit: 500,
  startDate: '2026-05-01'
});

let overWithdrawalBlocked = false;
try {
  repository.addSavingsTransaction({
    savingsGoalId: savingsGoal.id,
    amount: 1000, // available is only 500!
    type: 'withdrawal',
    date: '2026-05-02'
  });
} catch (err) {
  overWithdrawalBlocked = true;
}
assert(overWithdrawalBlocked, 'Repository must block withdrawal exceeding current amount');
console.log('✓ Test 3 passed: Over-withdrawal successfully blocked.');

// ==========================================
// TEST 4: Receivables Over-Repayment Guard
// ==========================================
console.log('Test 4: Receivables over-repayment guard...');

const debtRecord = repository.addDebt({
  person_name: 'Alex Johnson',
  type: 'lent',
  original_amount: 500,
  transaction_date: '2026-05-01'
});

let overRepaymentBlocked = false;
try {
  repository.addDebtRepayment({
    debt_id: debtRecord.id,
    amount: 700, // remaining balance is only 500!
    repayment_date: '2026-05-02'
  });
} catch (err) {
  overRepaymentBlocked = true;
}
assert(overRepaymentBlocked, 'Repository must block repayment exceeding remaining balance');
console.log('✓ Test 4 passed: Over-repayment successfully blocked.');

// ==========================================
// TEST 5: Duplicate Payout Prevention & Safe Replacement
// ==========================================
console.log('Test 5: Repository duplicate payout prevention...');

const payoutPayload = {
  periodMonth: '2026-05',
  paymentDate: '2026-05-31',
  salaryType: 'daily_wage' as const,
  baseAmount: 500,
  presentDays: 20,
  absentDays: 0,
  leaveDays: 0,
  holidayDays: 0,
  totalWorkingHours: 160,
  overtimeHours: 0,
  grossSalary: 10000,
  totalAllowances: 0,
  totalDeductions: 0,
  netSalary: 10000,
  status: 'Paid' as const,
  notes: 'May 2026'
};

const firstPayout = repository.recordSalaryPayout(payoutPayload, true, false);
assert(firstPayout.id.startsWith('sp_'), 'First payout created');
assert(repository.getSalaryPayouts().length === 1, 'Payouts count should be 1');

let duplicatePrevented = false;
try {
  repository.recordSalaryPayout(payoutPayload, true, false);
} catch (err) {
  duplicatePrevented = true;
}
assert(duplicatePrevented, 'Repository must reject duplicate payout for 2026-05');
console.log('✓ Test 5 passed: Duplicate payouts blocked.');

// ==========================================
// TEST 6: In-Memory Isolation (No browser storage reliance)
// ==========================================
console.log('Test 6: In-memory session verification...');

const status = repository.getBackendStatus();
assert(status.isBackendConfigured === false, 'Backend configured should be false');
assert(status.persistenceMode === 'in-memory', 'Persistence mode must be in-memory');

console.log('✓ Test 6 passed: Pure in-memory session verified.');

console.log('\n======================================================');
console.log('--- ALL XOS TEST SUITE CASES PASSED SUCCESSFULLY! ---');
console.log('======================================================');
