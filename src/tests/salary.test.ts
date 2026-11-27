/**
 * XOS Core, Salary & Attendance System Test Suite
 * Validates:
 * 1. Full Day (100%) & Half Day (50%) Daily Salary calculations; Absent & Holiday = 0
 * 2. Historical salary snapshot protection when Daily Salary is updated
 * 3. Monthly total accuracy & duplicate-date deduplication
 * 4. Attendance edit & delete recalculation
 * 5. Legacy / pre-migration attendance record compatibility (missing dayType, Leave status)
 * 6. Dashboard, Salary Management & Report calculation consistency + unconfigured state
 * 7. Future attendance date blocking & IST boundary matrix
 * 8. Savings, Debt, and In-Memory repository integrity guards
 */

import {
  calculateAttendanceStats,
  calculateAttendanceStatsForRecords,
  calculateDailyEarnedSalary,
  calculateMonthlySalarySummary,
  calculatePeriodSalarySummary,
  calculateEstimatedSalary,
  calculateFinancialTotals,
  calculateDebtSummary,
  calculateSeparateDebtTotals,
  calculateMonthlyExpenseTotal,
  isSalaryConfigured,
  resolveAttendanceDayType,
  resolveAttendanceRecordSalary
} from '../utils/calculations';
import {
  formatCurrency,
  getIstTodayString,
  isFutureIstDate
} from '../utils/formatters';
import { repository } from '../services/repository';
import { DEFAULT_USER_SETTINGS } from '../data/initialData';
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
  console.log('--- Running XOS Core & Simplified Salary Test Suite ---');

  repository.clearAllData();

  // ==========================================
  // TEST 1: Full Day, Half Day, Absent & Holiday Daily Salary Calculations
  // ==========================================
  console.log('Test 1: Daily salary rules (Full Day 100%, Half Day 50%, Absent 0, Holiday 0)...');

  const config600: Partial<SalaryConfig> = {
    dailyBaseSalary: 600,
    isConfigured: true,
    currency: 'INR'
  };

  const fullDayRes = calculateDailyEarnedSalary('Present', 'full_day', config600);
  assert(fullDayRes.dayType === 'full_day', 'Full Day resolves to full_day');
  assertClose(fullDayRes.dailyEarnedSalary, 600, 'Present + Full Day pays 100% of Daily Salary (600)');

  const halfDayRes = calculateDailyEarnedSalary('Present', 'half_day', config600);
  assert(halfDayRes.dayType === 'half_day', 'Half Day resolves to half_day');
  assertClose(halfDayRes.dailyEarnedSalary, 300, 'Present + Half Day pays 50% of Daily Salary (300)');

  const oddHalfDayRes = calculateDailyEarnedSalary('Present', 'half_day', { dailyBaseSalary: 555 });
  assertClose(oddHalfDayRes.dailyEarnedSalary, 277.5, 'Half Day preserves 2-decimal precision (555 / 2 = 277.5)');

  const absentRes = calculateDailyEarnedSalary('Absent', 'full_day', config600);
  assertClose(absentRes.dailyEarnedSalary, 0, 'Absent pays 0');

  const holidayRes = calculateDailyEarnedSalary('Holiday', 'full_day', config600);
  assertClose(holidayRes.dailyEarnedSalary, 0, 'Holiday pays 0');

  const legacyLeaveRes = calculateDailyEarnedSalary('Leave', 'full_day', config600);
  assertClose(legacyLeaveRes.dailyEarnedSalary, 0, 'Legacy Leave pays 0');

  console.log('✓ Test 1 passed.');

  // ==========================================
  // TEST 2: Future Attendance Date Guard & IST Matrix
  // ==========================================
  console.log('Test 2: Future attendance date guard & IST boundary matrix...');

  let futureBlocked = false;
  try {
    await repository.upsertAttendanceRecord({
      date: '2099-12-31',
      status: 'Present',
      dayType: 'full_day'
    });
  } catch {
    futureBlocked = true;
  }
  assert(futureBlocked, 'Repository must reject future attendance dates');

  const istMatrix: Array<{ utcIso: string; attDate: string; expectAccept: boolean; label: string }> = [
    { utcIso: '2026-11-15T19:00:00.000Z', attDate: '2026-11-16', expectAccept: true, label: 'Nov 16 12:30 AM IST -> Nov 16' },
    { utcIso: '2026-11-15T19:30:00.000Z', attDate: '2026-11-16', expectAccept: true, label: 'Nov 16 01:00 AM IST -> Nov 16' },
    { utcIso: '2026-11-15T23:59:00.000Z', attDate: '2026-11-16', expectAccept: true, label: 'Nov 16 05:29 AM IST -> Nov 16' },
    { utcIso: '2026-11-16T00:00:00.000Z', attDate: '2026-11-16', expectAccept: true, label: 'Nov 16 05:30 AM IST -> Nov 16' },
    { utcIso: '2026-11-16T18:29:00.000Z', attDate: '2026-11-16', expectAccept: true, label: 'Nov 16 11:59 PM IST -> Nov 16' },
    { utcIso: '2026-11-15T19:30:00.000Z', attDate: '2026-11-17', expectAccept: false, label: 'Nov 16 01:00 AM IST -> Nov 17' },
    { utcIso: '2026-11-15T19:30:00.000Z', attDate: '2026-11-15', expectAccept: true, label: 'Nov 16 01:00 AM IST -> Nov 15' }
  ];
  for (const row of istMatrix) {
    const accepted = !isFutureIstDate(row.attDate, new Date(row.utcIso));
    assert(accepted === row.expectAccept, `IST matrix failed for ${row.label}`);
  }
  assert(getIstTodayString(new Date('2026-03-08T19:00:00.000Z')) === '2026-03-09', 'DST spring-forward IST date');
  assert(getIstTodayString(new Date('2026-11-01T19:00:00.000Z')) === '2026-11-02', 'DST fall-back IST date');

  console.log('✓ Test 2 passed.');

  // ==========================================
  // TEST 3: Daily Salary Update Preserves Historical Snapshots + Edit & Delete Behavior
  // ==========================================
  console.log('Test 3: Historical snapshot protection, edit & delete recalculation...');
  repository.clearAllData();

  await repository.persistSalaryConfig({
    dailyBaseSalary: 600,
    isConfigured: true,
    currency: 'INR'
  });

  const d1 = await repository.upsertAttendanceRecord({
    date: '2026-06-01',
    status: 'Present',
    dayType: 'full_day',
    notes: 'Regular shift'
  });
  const d2 = await repository.upsertAttendanceRecord({
    date: '2026-06-02',
    status: 'Present',
    dayType: 'half_day'
  });
  const d3 = await repository.upsertAttendanceRecord({
    date: '2026-06-03',
    status: 'Absent'
  });
  const d4 = await repository.upsertAttendanceRecord({
    date: '2026-06-04',
    status: 'Holiday'
  });

  assertClose(d1.dailyEarnedSalary || 0, 600, 'Day 1 Full Day earns 600');
  assertClose(d2.dailyEarnedSalary || 0, 300, 'Day 2 Half Day earns 300');
  assertClose(d3.dailyEarnedSalary || 0, 0, 'Day 3 Absent earns 0');
  assertClose(d4.dailyEarnedSalary || 0, 0, 'Day 4 Holiday earns 0');

  // Update Daily Salary to 900 — historical entries must stay 600 and 300!
  await repository.persistSalaryConfig({
    dailyBaseSalary: 900,
    isConfigured: true,
    currency: 'INR'
  });

  const d5 = await repository.upsertAttendanceRecord({
    date: '2026-06-05',
    status: 'Present',
    dayType: 'full_day'
  });
  assertClose(d5.dailyEarnedSalary || 0, 900, 'New entry after rate change uses new Daily Salary (900)');

  // Editing note on old Day 1 preserves historical earned salary snapshot (600)
  const d1EditedNotes = await repository.upsertAttendanceRecord({
    date: '2026-06-01',
    status: 'Present',
    dayType: 'full_day',
    notes: 'Updated memo only'
  });
  assertClose(d1EditedNotes.dailyEarnedSalary || 0, 600, 'Editing notes on historical entry preserves 600 snapshot');

  let juneSummary = calculateMonthlySalarySummary(
    repository.getAttendance(),
    [],
    repository.getSettings().salaryConfig,
    '2026-06'
  );
  assertClose(juneSummary.earnedSalary, 600 + 300 + 0 + 0 + 900, 'June earned salary sums historical + new entries (1800)');
  assert(juneSummary.fullDays === 2, 'June has 2 Full Days');
  assert(juneSummary.halfDays === 1, 'June has 1 Half Day');
  assert(juneSummary.absentDays === 1, 'June has 1 Absent Day');
  assert(juneSummary.holidayDays === 1, 'June has 1 Holiday Day');

  // Edit Day 1 from Full Day -> Half Day (uses Day 1's snapshot rate 600 -> 300)
  const d1ToHalf = await repository.upsertAttendanceRecord({
    date: '2026-06-01',
    status: 'Present',
    dayType: 'half_day'
  });
  assertClose(d1ToHalf.dailyEarnedSalary || 0, 300, 'Editing Day 1 to Half Day updates earnings to 300');

  juneSummary = calculateMonthlySalarySummary(
    repository.getAttendance(),
    [],
    repository.getSettings().salaryConfig,
    '2026-06'
  );
  assertClose(juneSummary.earnedSalary, 300 + 300 + 900, 'June earned salary updates to 1500 after Day 1 edit');
  assert(juneSummary.fullDays === 1 && juneSummary.halfDays === 2, 'Counts update to 1 Full Day and 2 Half Days');

  // Delete Day 5 -> monthly total recalculates cleanly
  await repository.deleteAttendanceRecord(d5.id);
  juneSummary = calculateMonthlySalarySummary(
    repository.getAttendance(),
    [],
    repository.getSettings().salaryConfig,
    '2026-06'
  );
  assertClose(juneSummary.earnedSalary, 600, 'Deleting Day 5 recalculates June earned salary to 600');
  assert(juneSummary.fullDays === 0 && juneSummary.halfDays === 2, 'Counts update after delete');

  console.log('✓ Test 3 passed.');

  // ==========================================
  // TEST 4: Old Attendance Compatibility & Duplicate-Date Deduplication
  // ==========================================
  console.log('Test 4: Pre-migration attendance compatibility & deduplication...');
  {
    const currentCfg: SalaryConfig = { dailyBaseSalary: 1000, isConfigured: true, currency: 'INR' };
    const legacyRecords: AttendanceRecord[] = [
      // Pre-migration Present record without dayType, with saved historical dailyEarnedSalary snapshot of 700
      { id: 'old_1', date: '2026-07-01', status: 'Present', calculatedHours: 10, dailyEarnedSalary: 700 },
      // Pre-migration Present record without dayType or snapshot (falls back cleanly to Full Day = 100% of current Daily Salary)
      { id: 'old_2', date: '2026-07-02', status: 'Present' },
      // Legacy Leave record -> 0 earned, counted in leaveDays without crashing
      { id: 'old_3', date: '2026-07-03', status: 'Leave' },
      // Duplicate date entry (first one wins or deduplicated so never double counted)
      { id: 'dup_1', date: '2026-07-04', status: 'Present', dayType: 'half_day', dailyEarnedSalary: 500 },
      { id: 'dup_2', date: '2026-07-04', status: 'Present', dayType: 'full_day', dailyEarnedSalary: 1000 }
    ];

    assert(resolveAttendanceDayType(legacyRecords[0]) === 'full_day', 'Present record without dayType defaults to full_day');
    assertClose(resolveAttendanceRecordSalary(legacyRecords[0], currentCfg).earnedSalary, 700, 'Historical snapshot 700 preserved');
    assertClose(resolveAttendanceRecordSalary(legacyRecords[1], currentCfg).earnedSalary, 1000, 'Present without snapshot calculates 100% Daily Salary');
    assertClose(resolveAttendanceRecordSalary(legacyRecords[2], currentCfg).earnedSalary, 0, 'Legacy Leave calculates 0');

    const stats = calculateAttendanceStats(legacyRecords, '2026-07');
    const summary = calculateMonthlySalarySummary(legacyRecords, [], currentCfg, '2026-07');
    const period = calculatePeriodSalarySummary(legacyRecords, [], currentCfg, 'custom', '2026-07-01', '2026-07-31');
    const estimated = calculateEstimatedSalary(currentCfg, legacyRecords, '2026-07');
    const directStats = calculateAttendanceStatsForRecords(legacyRecords);

    assert(stats.totalRecorded === 4, `Deduplicated totalRecorded is 4 (got ${stats.totalRecorded})`);
    assert(stats.leaveDays === 1, 'Legacy Leave record counted safely in leaveDays');
    assert(stats.presentDays === 3, 'Present days deduplicated to 3');
    assert(stats.fullDays === 2 && stats.halfDays === 1, 'Day types deduplicated cleanly');
    assertClose(summary.earnedSalary, 700 + 1000 + 0 + 500, 'Monthly summary matches deduplicated earned total (2200)');
    assertClose(period.earnedSalary, summary.earnedSalary, 'Period summary matches Monthly summary');
    assertClose(estimated.grossSalary, summary.earnedSalary, 'Estimated salary matches Monthly summary');
    assert(
      directStats.fullDays === summary.fullDays &&
        directStats.halfDays === summary.halfDays &&
        directStats.absentDays === summary.absentDays &&
        directStats.holidayDays === summary.holidayDays,
      'Dashboard, Salary, and Report stats agree 100%'
    );
  }
  console.log('✓ Test 4 passed.');

  // ==========================================
  // TEST 5: Clean Initial Unconfigured Salary State
  // ==========================================
  console.log('Test 5: Clean initial unconfigured salary yields isConfigured=false and 0...');
  {
    assert(isSalaryConfigured(DEFAULT_USER_SETTINGS.salaryConfig) === false, 'Default salaryConfig is unconfigured');
    const unconfiguredDaily = calculateDailyEarnedSalary('Present', 'full_day', {});
    assertClose(unconfiguredDaily.dailyEarnedSalary, 0, 'Unconfigured daily calculation yields 0 (no fallback rate)');

    const emptyMonth = calculateMonthlySalarySummary([], [], DEFAULT_USER_SETTINGS.salaryConfig, '2026-08');
    assertClose(emptyMonth.earnedSalary, 0, 'Unconfigured empty month earnedSalary is 0');
    assert(emptyMonth.isConfigured === false, 'Empty month reports isConfigured === false');

    const emptyEst = calculateEstimatedSalary(DEFAULT_USER_SETTINGS.salaryConfig, [], '2026-08');
    assert(emptyEst.isConfigured === false, 'Empty estimate reports isConfigured === false');
    assertClose(emptyEst.grossSalary, 0, 'Empty estimate grossSalary is 0');
    assert(emptyEst.dailyBaseSalary === undefined, 'Empty estimate leaves dailyBaseSalary undefined');
  }
  console.log('✓ Test 5 passed.');

  // ==========================================
  // TEST 6: Savings, Debt, & In-Memory Isolation Guards
  // ==========================================
  console.log('Test 6: Savings, Debt, & In-Memory repository integrity guards...');
  repository.clearAllData();

  const status = repository.getBackendStatus();
  assert(status.isBackendConfigured === false && status.persistenceMode === 'in-memory', 'Pure in-memory session verified');

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
      amount: 1000,
      type: 'withdrawal',
      date: '2026-05-02'
    });
  } catch {
    overWithdrawalBlocked = true;
  }
  assert(overWithdrawalBlocked, 'Repository blocks savings withdrawal exceeding balance');

  const recDebt1 = await repository.addDebt({
    person_name: 'Sam',
    original_amount: 1200,
    lent_date: '2026-06-01',
    direction: 'receive'
  });
  const payDebt1 = await repository.addDebt({
    person_name: 'Vikram',
    original_amount: 1500,
    lent_date: '2026-06-03',
    direction: 'pay'
  });
  let overRepayBlocked = false;
  try {
    await repository.addDebtRepayment({
      debt_id: recDebt1.id,
      amount: 1500,
      repayment_date: '2026-06-04'
    });
  } catch {
    overRepayBlocked = true;
  }
  assert(overRepayBlocked, 'Repository blocks repayment exceeding remaining debt balance');

  await repository.addDebtRepayment({
    debt_id: payDebt1.id,
    amount: 500,
    repayment_date: '2026-06-04'
  });
  const debtTotals = calculateSeparateDebtTotals(repository.getDebts(), repository.getDebtRepayments());
  assertClose(debtTotals.totalToReceive, 1200, 'Receive total matches');
  assertClose(debtTotals.totalToPay, 1000, 'Pay total uses remaining balance');

  const recSummary = calculateDebtSummary(repository.getDebts(), repository.getDebtRepayments());
  assertClose(recSummary.outstandingReceivable, 1200, 'calculateDebtSummary excludes payable debts');

  assertClose(
    calculateMonthlyExpenseTotal(repository.getExpenses(), '2026-06'),
    500,
    'Money to Pay repayment syncs expense to monthly total'
  );

  const finTotals = calculateFinancialTotals(
    [{ id: 'inc_1', title: 'Salary', amount: 5000, source: 'Salary', date: '2026-08-01', createdAt: '2026-08-01' }],
    [{ id: 'exp_1', title: 'Rent', amount: 1500, category: 'Housing', date: '2026-08-02', paymentMethod: 'Bank Transfer', createdAt: '2026-08-02' }],
    [{ id: 'sg_active', name: 'Active', targetAmount: 2000, currentAmount: 500, createdAt: '2026-08-01' }],
    [
      { id: 'st_active', savingsGoalId: 'sg_active', amount: 500, type: 'deposit', date: '2026-08-03', createdAt: '2026-08-03' },
      { id: 'st_archived', savingsGoalId: 'sg_archived_goal', amount: 800, type: 'deposit', date: '2026-08-04', createdAt: '2026-08-04' }
    ]
  );
  assertClose(finTotals.availableBalance, 2200, 'Available balance deducts archived goal deposits too');
  assert(formatCurrency(0, 'INR') === '₹0', 'Currency formatting check');

  console.log('✓ Test 6 passed.');

  console.log('\n======================================================');
  console.log('--- ALL XOS SALARY & CORE TESTS PASSED! ---');
  console.log('======================================================');
}

runTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
