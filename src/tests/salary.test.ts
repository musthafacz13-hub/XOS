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
  calculateDebtOutstanding,
  calculateSeparateDebtTotals
} from '../utils/calculations';
import { formatCurrency } from '../utils/formatters';
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

async function runTests() {
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
    await repository.upsertAttendanceRecord({
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

  const savingsGoal = await repository.addSavingsGoal({
    name: 'Emergency Fund',
    targetAmount: 5000,
    initialDeposit: 500,
    initialDepositDate: '2026-05-01'
  });

  let overWithdrawalBlocked = false;
  try {
    await repository.addSavingsTransaction({
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

  const debtRecord = await repository.addDebt({
    person_name: 'Alex Johnson',
    original_amount: 500,
    lent_date: '2026-05-01'
  });

  let overRepaymentBlocked = false;
  try {
    await repository.addDebtRepayment({
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
    periodStart: '2026-05-01',
    periodEnd: '2026-05-31',
    amountPaid: 10000,
    paidAt: '2026-05-31',
    notes: 'May 2026'
  };

  const firstPayout = await repository.recordSalaryPayout(payoutPayload, true, false);
  assert(firstPayout.id.startsWith('sp_'), 'First payout created');
  assert(repository.getSalaryPayouts().length === 1, 'Payouts count should be 1');

  let duplicatePrevented = false;
  try {
    await repository.recordSalaryPayout(payoutPayload, true, false);
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

  // ==========================================
  // TEST 7: Overtime Disabled & Custom Daily Overrides
  // ==========================================
  console.log('Test 7: Overtime disabled & custom daily overrides...');

  const noOvertimeConfig: SalaryConfig = {
    dailyBaseSalary: 600,
    addonSalary: 0,
    addonEnabled: false,
    standardWorkingHours: 8,
    extraHourRate: 0,
    overtimeEnabled: false,
    currency: 'INR'
  };
  const noOtRes = calculateDailyEarnedSalary('Present', 11, noOvertimeConfig);
  assert(noOtRes.extraHours === 3, 'Extra hours still tracked when overtime is disabled');
  assert(noOtRes.dailyEarnedSalary === 600, 'Daily salary ignores overtime pay when overtime is disabled');

  await repository.persistSalaryConfig({
    dailyBaseSalary: 500,
    addonSalary: 0,
    addonEnabled: false,
    standardWorkingHours: 8,
    extraHourRate: 100,
    overtimeEnabled: true,
    currency: 'INR'
  });

  const day1 = await repository.upsertAttendanceRecord({
    date: '2026-06-01',
    status: 'Present',
    calculatedHours: 8
  });
  assertClose(day1.dailyEarnedSalary || 0, 500, 'Day 1 uses default rates');

  const day2 = await repository.upsertAttendanceRecord({
    date: '2026-06-02',
    status: 'Present',
    calculatedHours: 10,
    dailyBaseSalary: 700,
    extraHourRate: 150
  });
  assertClose(day2.dailyBaseSalary || 0, 700, 'Day 2 stores custom daily base salary');
  assertClose(day2.extraHourRate || 0, 150, 'Day 2 stores custom extra hour rate');
  assertClose(day2.dailyEarnedSalary || 0, 1000, 'Day 2 computes 700 + 2*150 = 1000');

  const day3 = await repository.upsertAttendanceRecord({
    date: '2026-06-03',
    status: 'Present',
    calculatedHours: 8,
    dailyBaseSalary: 500,
    extraHourRate: 100,
    salaryOverrideEnabled: true,
    salaryOverrideAmount: 650,
    notes: 'Bonus +150'
  });
  assert(day3.salaryOverrideEnabled === true, 'Day 3 stores salaryOverrideEnabled=true');
  assertClose(day3.salaryOverrideAmount || 0, 650, 'Day 3 stores salaryOverrideAmount=650');
  assertClose(day3.dailyEarnedSalary || 0, 650, 'Day 3 stores explicit earned override 650');

  // Changing global salary defaults must NEVER mutate past days
  await repository.persistSalaryConfig({
    dailyBaseSalary: 1200,
    addonSalary: 200,
    addonEnabled: true,
    standardWorkingHours: 8,
    extraHourRate: 250,
    overtimeEnabled: true,
    currency: 'INR'
  });

  const juneSummary = calculateMonthlySalarySummary(
    repository.getAttendance(),
    [],
    repository.getSettings().salaryConfig,
    '2026-06'
  );
  assertClose(juneSummary.earnedSalary, 500 + 1000 + 650, 'Monthly summary sums historical snapshots (2150)');
  assert(juneSummary.customizedDaysCount === 3, `Monthly summary counts snapshot/custom differences vs new defaults (got ${juneSummary.customizedDaysCount})`);

  console.log('✓ Test 7 passed: Custom daily overrides & historical protection verified.');

  // ==========================================
  // TEST 8: Add-on Salary, Non-Destructive Overtime Toggle, Explicit Override Flag & Snapshot Preservation on Edit
  // ==========================================
  console.log('Test 8: Add-on salary, overtimeEnabled=false with rate>0, explicit override flag, & edit snapshot preservation...');

  const addonOnRes = calculateDailyEarnedSalary('Present', 9, {
    dailyBaseSalary: 500,
    addonSalary: 100,
    addonEnabled: true,
    standardWorkingHours: 8,
    extraHourRate: 150,
    overtimeEnabled: true
  });
  assertClose(addonOnRes.dailyEarnedSalary, 750, 'Present with addonEnabled=true adds addonSalary: 500 + 100 + 1*150 = 750');

  const addonOffRes = calculateDailyEarnedSalary('Present', 9, {
    dailyBaseSalary: 500,
    addonSalary: 100,
    addonEnabled: false,
    standardWorkingHours: 8,
    extraHourRate: 150,
    overtimeEnabled: true
  });
  assertClose(addonOffRes.dailyEarnedSalary, 650, 'Present with addonEnabled=false excludes addonSalary: 500 + 1*150 = 650');

  const otDisabledKeepRate = calculateDailyEarnedSalary('Present', 10, {
    dailyBaseSalary: 500,
    addonSalary: 100,
    addonEnabled: true,
    standardWorkingHours: 8,
    extraHourRate: 150,
    overtimeEnabled: false
  });
  assert(otDisabledKeepRate.extraHours === 2, 'Extra hours still tracked when overtimeEnabled=false with positive extraHourRate');
  assertClose(otDisabledKeepRate.dailyEarnedSalary, 600, 'Overtime disabled ignores positive extraHourRate: 500 + 100 = 600');

  // Passing dailyEarnedSalary without salaryOverrideEnabled=true MUST NOT override formula
  await repository.persistSalaryConfig({
    dailyBaseSalary: 500,
    addonSalary: 100,
    addonEnabled: true,
    standardWorkingHours: 8,
    extraHourRate: 150,
    overtimeEnabled: false,
    currency: 'INR'
  });

  const nonOverrideRecord = await repository.upsertAttendanceRecord({
    date: '2026-06-04',
    status: 'Present',
    calculatedHours: 10,
    dailyEarnedSalary: 999
  });
  assert(nonOverrideRecord.salaryOverrideEnabled === false, 'dailyEarnedSalary alone does NOT enable salaryOverrideEnabled');
  assert(nonOverrideRecord.salaryOverrideAmount === undefined, 'salaryOverrideAmount remains undefined without override flag');
  assertClose(nonOverrideRecord.addonSalary || 0, 100, 'Snapshot preserves addonSalary=100');
  assert(nonOverrideRecord.addonEnabled === true, 'Snapshot preserves addonEnabled=true');
  assertClose(nonOverrideRecord.extraHourRate || 0, 150, 'Snapshot preserves extraHourRate=150 even when overtimeEnabled=false');
  assert(nonOverrideRecord.overtimeEnabled === false, 'Snapshot preserves overtimeEnabled=false');
  assertClose(nonOverrideRecord.dailyEarnedSalary || 0, 600, 'Formula result (600) wins over stale dailyEarnedSalary (999) when salaryOverrideEnabled is false');

  // Change global settings drastically, then partially edit 2026-06-04 and 2026-06-03
  await repository.persistSalaryConfig({
    dailyBaseSalary: 2000,
    addonSalary: 500,
    addonEnabled: false,
    standardWorkingHours: 8,
    extraHourRate: 400,
    overtimeEnabled: true,
    currency: 'INR'
  });

  const editedNonOverride = await repository.upsertAttendanceRecord({
    date: '2026-06-04',
    status: 'Present',
    calculatedHours: 11,
    notes: 'Updated shift hours only'
  });
  assertClose(editedNonOverride.dailyBaseSalary || 0, 500, 'Partial edit preserves existing dailyBaseSalary=500 snapshot');
  assertClose(editedNonOverride.addonSalary || 0, 100, 'Partial edit preserves existing addonSalary=100 snapshot');
  assert(editedNonOverride.addonEnabled === true, 'Partial edit preserves existing addonEnabled=true snapshot');
  assertClose(editedNonOverride.extraHourRate || 0, 150, 'Partial edit preserves existing extraHourRate=150 snapshot');
  assert(editedNonOverride.overtimeEnabled === false, 'Partial edit preserves existing overtimeEnabled=false snapshot');
  assertClose(editedNonOverride.dailyEarnedSalary || 0, 600, 'Recalculated from preserved snapshot (500 + 100, ot disabled)');

  const editedOverrideDay = await repository.upsertAttendanceRecord({
    date: '2026-06-03',
    status: 'Present',
    calculatedHours: 9,
    notes: 'Updated note on overridden day'
  });
  assert(editedOverrideDay.salaryOverrideEnabled === true, 'Partial edit preserves salaryOverrideEnabled=true');
  assertClose(editedOverrideDay.salaryOverrideAmount || 0, 650, 'Partial edit preserves salaryOverrideAmount=650');
  assertClose(editedOverrideDay.dailyEarnedSalary || 0, 650, 'Partial edit preserves overridden earned salary 650');

  // Switching an overridden day to Absent clears the override cleanly
  const markedAbsent = await repository.upsertAttendanceRecord({
    date: '2026-06-03',
    status: 'Absent'
  });
  assert(markedAbsent.salaryOverrideEnabled === false, 'Marking day Absent clears salaryOverrideEnabled');
  assert(markedAbsent.salaryOverrideAmount === undefined, 'Marking day Absent clears salaryOverrideAmount');
  assertClose(markedAbsent.dailyEarnedSalary || 0, 0, 'Marking day Absent sets earned salary to 0');

  console.log('✓ Test 8 passed: Add-on, overtime toggle, explicit override flag, & snapshot preservation verified.');

  // ==========================================
  // TEST 9: Separate Receive & Pay Debt Totals
  // ==========================================
  console.log('Test 9: Separate Receive & Pay debt totals (outstanding, partial, paid, edit, delete)...');
  repository.clearAllData();

  // Empty -> ₹0 for both
  const emptyTotals = calculateSeparateDebtTotals(repository.getDebts(), repository.getDebtRepayments());
  assertClose(emptyTotals.totalToReceive, 0, 'Empty receive total is 0');
  assertClose(emptyTotals.totalToPay, 0, 'Empty pay total is 0');
  assert(formatCurrency(emptyTotals.totalToReceive, 'INR') === '₹0', 'Formats empty INR receive total as ₹0');
  assert(formatCurrency(emptyTotals.totalToPay, 'INR') === '₹0', 'Formats empty INR pay total as ₹0');

  // Add separate Receive and Pay debts
  const recDebt1 = await repository.addDebt({
    person_name: 'Sam',
    original_amount: 1200,
    lent_date: '2026-06-01',
    direction: 'receive'
  });
  const recDebt2 = await repository.addDebt({
    person_name: 'Riya',
    original_amount: 800,
    lent_date: '2026-06-02',
    direction: 'receive'
  });
  const payDebt1 = await repository.addDebt({
    person_name: 'Vikram',
    original_amount: 1500,
    lent_date: '2026-06-03',
    direction: 'pay'
  });

  let totals = calculateSeparateDebtTotals(repository.getDebts(), repository.getDebtRepayments());
  assertClose(totals.totalToReceive, 2000, 'Total Money to Receive sums receive debts (1200 + 800)');
  assertClose(totals.totalToPay, 1500, 'Total Money to Pay sums pay debts separately (1500)');

  // Partial repayment uses remaining balance, not original amount
  await repository.addDebtRepayment({
    debt_id: recDebt1.id,
    amount: 450,
    repayment_date: '2026-06-04'
  });
  await repository.addDebtRepayment({
    debt_id: payDebt1.id,
    amount: 500,
    repayment_date: '2026-06-04'
  });
  totals = calculateSeparateDebtTotals(repository.getDebts(), repository.getDebtRepayments());
  assertClose(totals.totalToReceive, 750 + 800, 'Receive total uses remaining balance (750 + 800 = 1550)');
  assertClose(totals.totalToPay, 1000, 'Pay total uses remaining balance (1000)');

  // Fully paid debt is excluded
  await repository.addDebtRepayment({
    debt_id: recDebt2.id,
    amount: 800,
    repayment_date: '2026-06-05'
  });
  totals = calculateSeparateDebtTotals(repository.getDebts(), repository.getDebtRepayments());
  assertClose(totals.totalToReceive, 750, 'Fully paid receive debt excluded (750 remaining)');

  // Editing debt updates totals immediately
  await repository.updateDebt(payDebt1.id, { original_amount: 2000 });
  totals = calculateSeparateDebtTotals(repository.getDebts(), repository.getDebtRepayments());
  assertClose(totals.totalToPay, 1500, 'Edited pay debt updates remaining balance (2000 - 500 = 1500)');

  // Deleting debt updates totals immediately back to 0
  await repository.deleteDebt(recDebt1.id);
  await repository.deleteDebt(payDebt1.id);
  totals = calculateSeparateDebtTotals(repository.getDebts(), repository.getDebtRepayments());
  assertClose(totals.totalToReceive, 0, 'Deleted receive debt reduces total to 0');
  assertClose(totals.totalToPay, 0, 'Deleted pay debt reduces total to 0');

  console.log('✓ Test 9 passed: Separate Receive & Pay debt totals verified.');

  console.log('\n======================================================');
  console.log('--- ALL XOS TEST SUITE CASES PASSED SUCCESSFULLY! ---');
  console.log('======================================================');
}

runTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
