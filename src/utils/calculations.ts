import { 
  AttendanceDayType,
  AttendanceRecord, 
  AttendanceStatus,
  DateFilterPreset, 
  Debt,
  DebtRepayment,
  Expense, 
  Goal, 
  Income, 
  SalaryConfig, 
  SalaryPayout, 
  SavingsGoal, 
  SavingsTransaction 
} from '../types';
import { formatDate, getMonthString, parseCalendarDate } from './formatters';

export function filterRecordsByDateRange<T extends { date: string }>(
  records: T[],
  preset: DateFilterPreset | 'all',
  customStart?: string,
  customEnd?: string,
  referenceDate: Date = new Date()
): T[] {
  if (preset === 'all') return records;
  const today = referenceDate;
  const todayIso = formatDate(today, 'YYYY-MM-DD');

  return records.filter(r => {
    if (!r.date) return false;
    const rDate = parseCalendarDate(r.date);
    if (isNaN(rDate.getTime())) return false;
    const rIso = formatDate(rDate, 'YYYY-MM-DD');

    switch (preset) {
      case 'today': {
        return rIso === todayIso;
      }
      case 'this_month': {
        return rDate.getFullYear() === today.getFullYear() && rDate.getMonth() === today.getMonth();
      }
      case 'last_month': {
        const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        return rDate.getFullYear() === lastMonth.getFullYear() && rDate.getMonth() === lastMonth.getMonth();
      }
      case 'this_year': {
        return rDate.getFullYear() === today.getFullYear();
      }
      case 'custom': {
        if (customStart && rIso < customStart) return false;
        if (customEnd && rIso > customEnd) return false;
        return true;
      }
      default:
        return true;
    }
  });
}

export function resolveAttendanceDayType(
  recordOrDayType?: AttendanceDayType | Pick<AttendanceRecord, 'status' | 'dayType'> | null
): AttendanceDayType {
  if (!recordOrDayType) return 'full_day';
  if (typeof recordOrDayType === 'string') {
    return recordOrDayType === 'half_day' ? 'half_day' : 'full_day';
  }
  if (recordOrDayType.status !== 'Present') return 'full_day';
  return recordOrDayType.dayType === 'half_day' ? 'half_day' : 'full_day';
}

export function deduplicateAttendanceByDate(records: AttendanceRecord[]): AttendanceRecord[] {
  const seenDates = new Set<string>();
  const result: AttendanceRecord[] = [];
  for (const record of records) {
    if (!record || !record.date) continue;
    if (seenDates.has(record.date)) continue;
    seenDates.add(record.date);
    result.push(record);
  }
  return result;
}

export function calculateAttendanceStatsForRecords(
  records: AttendanceRecord[],
  _expectedDailyHours?: number
) {
  const uniqueRecords = deduplicateAttendanceByDate(records);
  let presentDays = 0;
  let fullDays = 0;
  let halfDays = 0;
  let absentDays = 0;
  let leaveDays = 0;
  let holidayDays = 0;

  uniqueRecords.forEach(r => {
    if (r.status === 'Present') {
      presentDays += 1;
      if (resolveAttendanceDayType(r) === 'half_day') {
        halfDays += 1;
      } else {
        fullDays += 1;
      }
    } else if (r.status === 'Absent') {
      absentDays += 1;
    } else if (r.status === 'Leave') {
      leaveDays += 1;
    } else if (r.status === 'Holiday') {
      holidayDays += 1;
    }
  });

  return {
    presentDays,
    fullDays,
    halfDays,
    absentDays,
    leaveDays,
    holidayDays,
    totalHours: 0,
    totalRecorded: uniqueRecords.length,
    missingHoursCount: 0
  };
}

export function calculateAttendanceStats(
  records: AttendanceRecord[], 
  monthStr?: string,
  expectedDailyHours?: number
) {
  const targetMonth = monthStr || getMonthString();
  const monthRecords = records.filter(r => typeof r.date === 'string' && r.date.startsWith(targetMonth));
  return calculateAttendanceStatsForRecords(monthRecords, expectedDailyHours);
}

export function isSalaryConfigured(config?: Partial<SalaryConfig> | null): boolean {
  if (!config) return false;
  if (config.isConfigured === false) return false;
  return (
    typeof config.dailyBaseSalary === 'number' &&
    Number.isFinite(config.dailyBaseSalary) &&
    config.dailyBaseSalary >= 0
  );
}

export interface EstimatedSalaryResult {
  dailyBaseSalary?: number;
  isConfigured: boolean;
  presentDays: number;
  fullDays: number;
  halfDays: number;
  absentDays: number;
  leaveDays: number;
  holidayDays: number;
  grossSalary: number;
  netSalary: number;
  breakdown: string[];
}

export function resolveAttendanceRecordSalary(
  record: AttendanceRecord,
  fallbackConfig: Partial<SalaryConfig> = {}
): { earnedSalary: number; dayType?: AttendanceDayType; usedSnapshot: boolean } {
  if (record.status !== 'Present') {
    const savedNonPresent =
      typeof record.dailyEarnedSalary === 'number' && Number.isFinite(record.dailyEarnedSalary)
        ? Math.max(0, Number(record.dailyEarnedSalary.toFixed(2)))
        : 0;
    return {
      earnedSalary: savedNonPresent,
      dayType: undefined,
      usedSnapshot: savedNonPresent > 0
    };
  }

  const resolvedDayType = resolveAttendanceDayType(record);

  // Always preserve saved dailyEarnedSalary snapshot so later Daily Salary edits never rewrite history.
  if (typeof record.dailyEarnedSalary === 'number' && Number.isFinite(record.dailyEarnedSalary)) {
    const cfgBase =
      typeof fallbackConfig.dailyBaseSalary === 'number' && Number.isFinite(fallbackConfig.dailyBaseSalary)
        ? fallbackConfig.dailyBaseSalary
        : undefined;
    const rateDiffers =
      typeof record.dailyBaseSalary === 'number' &&
      (cfgBase === undefined ? record.dailyBaseSalary > 0 : Math.abs(record.dailyBaseSalary - cfgBase) > 0.01);
    return {
      earnedSalary: Math.max(0, Number(record.dailyEarnedSalary.toFixed(2))),
      dayType: resolvedDayType,
      usedSnapshot: rateDiffers || Boolean(record.salaryOverrideEnabled)
    };
  }

  const effectiveBase =
    typeof record.dailyBaseSalary === 'number' && Number.isFinite(record.dailyBaseSalary)
      ? record.dailyBaseSalary
      : fallbackConfig.dailyBaseSalary;

  const calculated = calculateDailyEarnedSalary('Present', resolvedDayType, {
    dailyBaseSalary: effectiveBase,
    salaryOverrideEnabled: Boolean(record.salaryOverrideEnabled),
    salaryOverrideAmount: record.salaryOverrideAmount
  });

  const cfgBase =
    typeof fallbackConfig.dailyBaseSalary === 'number' && Number.isFinite(fallbackConfig.dailyBaseSalary)
      ? fallbackConfig.dailyBaseSalary
      : undefined;
  const rateDiffers =
    typeof record.dailyBaseSalary === 'number' &&
    (cfgBase === undefined ? record.dailyBaseSalary > 0 : Math.abs(record.dailyBaseSalary - cfgBase) > 0.01);

  return {
    earnedSalary: calculated.dailyEarnedSalary,
    dayType: resolvedDayType,
    usedSnapshot: rateDiffers
  };
}

export function calculateEstimatedSalary(
  config: SalaryConfig,
  attendanceRecords: AttendanceRecord[],
  monthStr: string = getMonthString()
): EstimatedSalaryResult {
  const configured = isSalaryConfigured(config);
  const dailyBaseSalary =
    typeof config.dailyBaseSalary === 'number' && Number.isFinite(config.dailyBaseSalary)
      ? config.dailyBaseSalary
      : undefined;

  const monthRecords = deduplicateAttendanceByDate(
    attendanceRecords.filter(r => typeof r.date === 'string' && r.date.startsWith(monthStr))
  );

  let presentDays = 0;
  let fullDays = 0;
  let halfDays = 0;
  let absentDays = 0;
  let leaveDays = 0;
  let holidayDays = 0;
  let grossSalary = 0;
  let fullDaysEarned = 0;
  let halfDaysEarned = 0;
  let usedSnapshotRates = false;

  monthRecords.forEach(r => {
    if (r.status === 'Present') {
      presentDays += 1;
      const resolved = resolveAttendanceRecordSalary(r, config);
      if (resolved.usedSnapshot) usedSnapshotRates = true;
      if (resolved.dayType === 'half_day') {
        halfDays += 1;
        halfDaysEarned += resolved.earnedSalary;
      } else {
        fullDays += 1;
        fullDaysEarned += resolved.earnedSalary;
      }
      grossSalary += resolved.earnedSalary;
    } else if (r.status === 'Absent') {
      absentDays += 1;
    } else if (r.status === 'Leave') {
      leaveDays += 1;
      grossSalary += resolveAttendanceRecordSalary(r, config).earnedSalary;
    } else if (r.status === 'Holiday') {
      holidayDays += 1;
      grossSalary += resolveAttendanceRecordSalary(r, config).earnedSalary;
    }
  });

  const roundedGross = Number(grossSalary.toFixed(2));
  const breakdown: string[] = [];
  if (!configured && presentDays === 0) {
    breakdown.push('Daily salary not set yet.');
  } else {
    if (fullDays > 0) {
      breakdown.push(
        usedSnapshotRates || dailyBaseSalary === undefined
          ? `Full Days (${fullDays}) = ${fullDaysEarned.toFixed(2)}`
          : `Full Days: ${fullDays} × ${dailyBaseSalary.toFixed(2)} = ${fullDaysEarned.toFixed(2)}`
      );
    }
    if (halfDays > 0) {
      breakdown.push(
        usedSnapshotRates || dailyBaseSalary === undefined
          ? `Half Days (${halfDays}) = ${halfDaysEarned.toFixed(2)}`
          : `Half Days: ${halfDays} × ${(dailyBaseSalary * 0.5).toFixed(2)} = ${halfDaysEarned.toFixed(2)}`
      );
    }
    if (fullDays === 0 && halfDays === 0) {
      breakdown.push('No Present days logged yet.');
    }
  }

  return {
    dailyBaseSalary,
    isConfigured: configured,
    presentDays,
    fullDays,
    halfDays,
    absentDays,
    leaveDays,
    holidayDays,
    grossSalary: roundedGross,
    netSalary: roundedGross,
    breakdown
  };
}

export function calculateFinancialTotals(
  incomes: Income[],
  expenses: Expense[],
  savingsGoals: SavingsGoal[],
  savingsTransactions: SavingsTransaction[]
) {
  const totalIncome = incomes.reduce((sum, item) => sum + (item.amount || 0), 0);
  const totalExpenses = expenses.reduce((sum, item) => sum + (item.amount || 0), 0);

  // Net saved in savings accounts
  const totalSavingsDeposits = savingsTransactions
    .filter(t => t.type === 'deposit')
    .reduce((sum, t) => sum + (t.amount || 0), 0);
  const totalSavingsWithdrawals = savingsTransactions
    .filter(t => t.type === 'withdrawal')
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  // Current balance in savings
  const currentSavingsBalance = savingsGoals.reduce((sum, g) => sum + (g.currentAmount || 0), 0);

  // Available cash balance = Total Income - Total Expenses - Net transferred to Savings
  const netSavingsTransfer = Math.max(0, totalSavingsDeposits - totalSavingsWithdrawals);
  const availableBalance = totalIncome - totalExpenses - netSavingsTransfer;

  return {
    totalIncome: Number(totalIncome.toFixed(2)),
    totalExpenses: Number(totalExpenses.toFixed(2)),
    availableBalance: Number(availableBalance.toFixed(2)),
    currentSavingsBalance: Number(currentSavingsBalance.toFixed(2)),
    netCashFlow: Number((totalIncome - totalExpenses).toFixed(2))
  };
}

export function calculateMonthlyExpenseTotal(
  expenses: Expense[],
  monthStr: string = getMonthString()
): number {
  const total = expenses
    .filter(e => typeof e.date === 'string' && e.date.startsWith(monthStr))
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  return Number(total.toFixed(2));
}

// DAILY SALARY CALCULATIONS
export interface DailySalaryCalculationResult {
  dayType?: AttendanceDayType;
  workingHours: number;
  extraHours: number;
  dailyEarnedSalary: number;
}

export type DailySalaryCalculationConfig = Partial<SalaryConfig> & {
  salaryOverrideEnabled?: boolean;
  salaryOverrideAmount?: number;
};

export function calculateDailyEarnedSalary(
  status: AttendanceStatus,
  dayTypeOrLegacyHours: AttendanceDayType | number = 'full_day',
  config: DailySalaryCalculationConfig = {}
): DailySalaryCalculationResult {
  if (status !== 'Present') {
    return {
      dayType: undefined,
      workingHours: 0,
      extraHours: 0,
      dailyEarnedSalary: 0
    };
  }

  const resolvedDayType: AttendanceDayType =
    dayTypeOrLegacyHours === 'half_day' ? 'half_day' : 'full_day';

  const dailyBase =
    typeof config.dailyBaseSalary === 'number' && Number.isFinite(config.dailyBaseSalary)
      ? Math.max(0, config.dailyBaseSalary)
      : 0;

  const hasManualOverride =
    config.salaryOverrideEnabled === true &&
    typeof config.salaryOverrideAmount === 'number' &&
    Number.isFinite(config.salaryOverrideAmount);

  const multiplier = resolvedDayType === 'half_day' ? 0.5 : 1;
  const formulaSalary = dailyBase * multiplier;

  const dailyEarnedSalary = hasManualOverride
    ? Number(Math.max(0, config.salaryOverrideAmount!).toFixed(2))
    : Number(formulaSalary.toFixed(2));

  return {
    dayType: resolvedDayType,
    workingHours: 0,
    extraHours: 0,
    dailyEarnedSalary
  };
}

export function getMonthDateBounds(monthStr: string): { periodStart: string; periodEnd: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(monthStr);
  if (!match) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const lastDay = new Date(y, m, 0).getDate();
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    return { periodStart: `${ym}-01`, periodEnd: `${ym}-${String(lastDay).padStart(2, '0')}` };
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const lastDay = new Date(y, m, 0).getDate();
  return {
    periodStart: `${monthStr}-01`,
    periodEnd: `${monthStr}-${String(lastDay).padStart(2, '0')}`
  };
}

export function payoutMatchesMonth(payout: SalaryPayout, monthStr: string): boolean {
  if (!payout.periodStart) return false;
  return payout.periodStart.startsWith(monthStr);
}

export function calculatePeriodSalarySummary(
  attendanceRecords: AttendanceRecord[],
  payouts: SalaryPayout[],
  config: SalaryConfig,
  preset: DateFilterPreset | 'all' = 'this_month',
  customStart?: string,
  customEnd?: string,
  referenceDate: Date = new Date()
) {
  const periodRecords = deduplicateAttendanceByDate(
    filterRecordsByDateRange(attendanceRecords, preset, customStart, customEnd, referenceDate)
  );

  let presentDays = 0;
  let fullDays = 0;
  let halfDays = 0;
  let leaveDays = 0;
  let absentDays = 0;
  let holidayDays = 0;
  let totalEarned = 0;

  periodRecords.forEach(r => {
    if (r.status === 'Present') {
      presentDays += 1;
      const resolved = resolveAttendanceRecordSalary(r, config);
      if (resolved.dayType === 'half_day') {
        halfDays += 1;
      } else {
        fullDays += 1;
      }
      totalEarned += resolved.earnedSalary;
    } else if (r.status === 'Leave') {
      leaveDays += 1;
      totalEarned += resolveAttendanceRecordSalary(r, config).earnedSalary;
    } else if (r.status === 'Absent') {
      absentDays += 1;
      totalEarned += resolveAttendanceRecordSalary(r, config).earnedSalary;
    } else if (r.status === 'Holiday') {
      holidayDays += 1;
      totalEarned += resolveAttendanceRecordSalary(r, config).earnedSalary;
    }
  });

  const periodPayouts = filterRecordsByDateRange(
    payouts.map(p => ({ ...p, date: p.periodStart })),
    preset,
    customStart,
    customEnd,
    referenceDate
  );
  const salaryReceived = periodPayouts.reduce((sum, p) => sum + (p.amountPaid || 0), 0);
  const earnedSalary = Number(totalEarned.toFixed(2));
  const remainingSalary = Math.max(0, Number((earnedSalary - salaryReceived).toFixed(2)));
  const overpaidAmount = Math.max(0, Number((salaryReceived - earnedSalary).toFixed(2)));

  return {
    earnedSalary,
    salaryReceived: Number(salaryReceived.toFixed(2)),
    remainingSalary,
    overpaidAmount,
    presentDays,
    fullDays,
    halfDays,
    leaveDays,
    absentDays,
    holidayDays,
    totalWorkingHours: 0,
    totalExtraHours: 0,
    recordCount: periodRecords.length,
    isConfigured: isSalaryConfigured(config)
  };
}

export function calculateMonthlySalarySummary(
  attendanceRecords: AttendanceRecord[],
  payouts: SalaryPayout[],
  config: SalaryConfig,
  monthStr: string = getMonthString()
) {
  const monthRecords = deduplicateAttendanceByDate(
    attendanceRecords.filter(r => typeof r.date === 'string' && r.date.startsWith(monthStr))
  );

  let presentDays = 0;
  let fullDays = 0;
  let halfDays = 0;
  let leaveDays = 0;
  let absentDays = 0;
  let holidayDays = 0;
  let totalEarned = 0;
  let customizedDaysCount = 0;

  monthRecords.forEach(r => {
    if (r.status === 'Present') {
      presentDays += 1;
      const resolved = resolveAttendanceRecordSalary(r, config);
      if (resolved.dayType === 'half_day') {
        halfDays += 1;
      } else {
        fullDays += 1;
      }
      if (resolved.usedSnapshot) {
        customizedDaysCount += 1;
      }
      totalEarned += resolved.earnedSalary;
    } else if (r.status === 'Leave') {
      leaveDays += 1;
      totalEarned += resolveAttendanceRecordSalary(r, config).earnedSalary;
    } else if (r.status === 'Absent') {
      absentDays += 1;
      totalEarned += resolveAttendanceRecordSalary(r, config).earnedSalary;
    } else if (r.status === 'Holiday') {
      holidayDays += 1;
      totalEarned += resolveAttendanceRecordSalary(r, config).earnedSalary;
    }
  });

  const monthPayouts = payouts.filter(p => payoutMatchesMonth(p, monthStr));
  const salaryReceived = monthPayouts.reduce((sum, p) => sum + (p.amountPaid || 0), 0);
  const earnedSalary = Number(totalEarned.toFixed(2));
  const remainingSalary = Math.max(0, Number((earnedSalary - salaryReceived).toFixed(2)));
  const overpaidAmount = Math.max(0, Number((salaryReceived - earnedSalary).toFixed(2)));

  return {
    periodMonth: monthStr,
    earnedSalary,
    salaryReceived: Number(salaryReceived.toFixed(2)),
    remainingSalary,
    overpaidAmount,
    presentDays,
    fullDays,
    halfDays,
    leaveDays,
    absentDays,
    holidayDays,
    totalWorkingHours: 0,
    totalExtraHours: 0,
    customizedDaysCount,
    recordCount: monthRecords.length,
    isConfigured: isSalaryConfigured(config)
  };
}

export interface ResolvedGoalItem {
  goal: Goal;
  savingsGoal?: SavingsGoal;
  savedAmount: number;
  targetAmount: number;
  remainingAmount: number;
  progressPercentage: number;
  isCompleted: boolean;
  isPaused: boolean;
  isArchived: boolean;
  isActive: boolean;
  hasValidSavingsLink: boolean;
}

export function resolveGoalsWithSavings(
  goals: Goal[],
  savingsGoals: SavingsGoal[]
): ResolvedGoalItem[] {
  const savingsById = new Map<string, SavingsGoal>();
  for (const sg of savingsGoals) {
    if (sg && sg.id && !savingsById.has(sg.id)) {
      savingsById.set(sg.id, sg);
    }
  }

  const claimedSavingsIds = new Set<string>();
  const resolved: ResolvedGoalItem[] = [];

  for (const goal of goals) {
    if (!goal || goal.status === 'Archived') {
      continue;
    }

    const sgId = typeof goal.savingsGoalId === 'string' ? goal.savingsGoalId.trim() : '';
    const candidateSg = sgId && !claimedSavingsIds.has(sgId) ? savingsById.get(sgId) : undefined;
    if (candidateSg) {
      claimedSavingsIds.add(candidateSg.id);
    }

    const savedAmount = candidateSg ? Math.max(0, Number(candidateSg.currentAmount) || 0) : 0;
    const rawTarget = goal.targetAmount ?? candidateSg?.targetAmount ?? 0;
    const targetAmount = Math.max(0, Number(rawTarget) || 0);
    const remainingAmount = Math.max(0, Number((targetAmount - savedAmount).toFixed(2)));
    const isPaused = goal.status === 'Paused';

    let progressPercentage = 0;
    if (candidateSg && targetAmount > 0) {
      progressPercentage = Math.min(100, Math.max(0, Math.round((savedAmount / targetAmount) * 100)));
    } else if (targetAmount > 0 && savedAmount > 0) {
      progressPercentage = Math.min(100, Math.max(0, Math.round((savedAmount / targetAmount) * 100)));
    } else if (goal.status === 'Completed' && targetAmount <= 0) {
      progressPercentage = 100;
    } else if (!candidateSg && targetAmount <= 0) {
      progressPercentage = Math.min(100, Math.max(0, Math.round(goal.progressPercentage || 0)));
    }

    const isCompleted =
      !isPaused &&
      (targetAmount > 0 ? savedAmount >= targetAmount : goal.status === 'Completed');

    const isActive = !isPaused && !isCompleted;

    resolved.push({
      goal,
      savingsGoal: candidateSg,
      savedAmount: Number(savedAmount.toFixed(2)),
      targetAmount: Number(targetAmount.toFixed(2)),
      remainingAmount,
      progressPercentage,
      isCompleted,
      isPaused,
      isArchived: false,
      isActive,
      hasValidSavingsLink: Boolean(candidateSg)
    });
  }

  return resolved;
}

export function calculateUnifiedGoalTotals(items: ResolvedGoalItem[]) {
  const nonArchived = items.filter(i => !i.isArchived);
  const totalTargetAmount = nonArchived.reduce((sum, i) => sum + i.targetAmount, 0);
  const totalSavedAmount = nonArchived.reduce((sum, i) => sum + i.savedAmount, 0);
  const totalRemainingAmount = Math.max(0, Number((totalTargetAmount - totalSavedAmount).toFixed(2)));
  const overallProgress =
    totalTargetAmount > 0
      ? Math.min(100, Math.round((totalSavedAmount / totalTargetAmount) * 100))
      : 0;

  let activeGoalsCount = 0;
  let completedGoalsCount = 0;
  for (const item of nonArchived) {
    if (item.isCompleted) {
      completedGoalsCount += 1;
    } else if (item.isActive) {
      activeGoalsCount += 1;
    }
  }

  return {
    totalCount: nonArchived.length,
    totalTargetAmount: Number(totalTargetAmount.toFixed(2)),
    totalSavedAmount: Number(totalSavedAmount.toFixed(2)),
    totalRemainingAmount,
    overallProgress,
    activeGoalsCount,
    completedGoalsCount
  };
}

export function calculateGoalStats(goals: Goal[], savingsGoals?: SavingsGoal[]) {
  if (Array.isArray(savingsGoals)) {
    const resolved = resolveGoalsWithSavings(goals, savingsGoals);
    const totals = calculateUnifiedGoalTotals(resolved);
    const averageProgress =
      resolved.length > 0
        ? Math.round(resolved.reduce((sum, i) => sum + i.progressPercentage, 0) / resolved.length)
        : 0;

    return {
      total: totals.totalCount,
      activeCount: totals.activeGoalsCount,
      completedCount: totals.completedGoalsCount,
      averageProgress,
      completionPercentage:
        totals.totalCount > 0 ? Math.round((totals.completedGoalsCount / totals.totalCount) * 100) : 0
    };
  }

  const visibleGoals = goals.filter(g => g.status !== 'Archived');
  const activeGoals = visibleGoals.filter(g => g.status === 'In Progress' || g.status === 'Not Started');
  const completedGoals = visibleGoals.filter(g => g.status === 'Completed');
  const averageProgress = visibleGoals.length > 0
    ? Math.round(visibleGoals.reduce((sum, g) => sum + Math.max(0, Math.min(100, g.progressPercentage || 0)), 0) / visibleGoals.length)
    : 0;

  return {
    total: visibleGoals.length,
    activeCount: activeGoals.length,
    completedCount: completedGoals.length,
    averageProgress,
    completionPercentage: visibleGoals.length > 0 ? Math.round((completedGoals.length / visibleGoals.length) * 100) : 0
  };
}

// RECEIVABLES / DEBT CALCULATIONS (Money Owed to Me)
export function calculateTotalRepaid(debtId: string, repayments: DebtRepayment[]): number {
  return repayments
    .filter(r => r.debt_id === debtId)
    .reduce((sum, r) => sum + (r.amount || 0), 0);
}

export function calculateDebtOutstanding(debt: Debt, repayments: DebtRepayment[]): number {
  if (typeof debt.remaining_amount === 'number' && Number.isFinite(debt.remaining_amount)) {
    return Math.max(0, Number(debt.remaining_amount.toFixed(2)));
  }
  const repaid = calculateTotalRepaid(debt.id, repayments);
  return Math.max(0, Number((debt.original_amount - repaid).toFixed(2)));
}

export function calculateDebtSummary(debts: Debt[], repayments: DebtRepayment[]) {
  const receivableDebts = debts.filter(d => d.direction !== 'pay');
  let totalLent = 0;
  let outstandingReceivable = 0;
  let totalRepaid = 0;
  let outstandingCount = 0;
  let partiallyPaidCount = 0;
  let paidCount = 0;

  receivableDebts.forEach(d => {
    const outstanding = calculateDebtOutstanding(d, repayments);
    totalLent += d.original_amount || 0;
    outstandingReceivable += outstanding;
    totalRepaid += Math.max(0, (d.original_amount || 0) - outstanding);

    if (d.status === 'paid' || outstanding <= 0.0001) {
      paidCount++;
    } else if (d.status === 'partially_paid' || outstanding < d.original_amount) {
      partiallyPaidCount++;
    } else {
      outstandingCount++;
    }
  });

  return {
    totalLent: Number(totalLent.toFixed(2)),
    totalRepaid: Number(totalRepaid.toFixed(2)),
    outstandingReceivable: Number(outstandingReceivable.toFixed(2)),
    outstandingCount,
    partiallyPaidCount,
    paidCount,
    totalRecords: receivableDebts.length
  };
}

export function calculateSeparateDebtTotals(debts: Debt[], repayments: DebtRepayment[]) {
  let totalToReceive = 0;
  let totalToPay = 0;

  debts.forEach(d => {
    if (d.status === 'paid') return;
    const outstanding = calculateDebtOutstanding(d, repayments);
    if (outstanding <= 0) return;

    if (d.direction === 'pay') {
      totalToPay += outstanding;
    } else {
      totalToReceive += outstanding;
    }
  });

  return {
    totalToReceive: Number(totalToReceive.toFixed(2)),
    totalToPay: Number(totalToPay.toFixed(2))
  };
}
