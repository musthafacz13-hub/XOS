import { 
  AttendanceRecord, 
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

export function calculateAttendanceStatsForRecords(
  records: AttendanceRecord[],
  expectedDailyHours?: number
) {
  let presentDays = 0;
  let absentDays = 0;
  let leaveDays = 0;
  let holidayDays = 0;
  let totalHours = 0;
  let missingHoursCount = 0;

  records.forEach(r => {
    if (r.status === 'Present') {
      presentDays += 1;
      if (typeof r.calculatedHours === 'number') {
        // Actual logged hours (preserves explicitly logged 0 hours)
        totalHours += r.calculatedHours;
      } else {
        // Missing hours: track count and use expectedDailyHours if provided, otherwise 0
        missingHoursCount += 1;
        const fallbackHours = typeof expectedDailyHours === 'number' && expectedDailyHours > 0 ? expectedDailyHours : 0;
        totalHours += fallbackHours;
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
    absentDays,
    leaveDays,
    holidayDays,
    totalHours: Number(totalHours.toFixed(1)),
    totalRecorded: records.length,
    missingHoursCount
  };
}

export function calculateAttendanceStats(
  records: AttendanceRecord[], 
  monthStr?: string,
  expectedDailyHours?: number
) {
  const targetMonth = monthStr || getMonthString();
  const monthRecords = records.filter(r => r.date.startsWith(targetMonth));
  return calculateAttendanceStatsForRecords(monthRecords, expectedDailyHours);
}

export function isSalaryConfigured(config?: Partial<SalaryConfig> | null): boolean {
  if (!config) return false;
  if (config.isConfigured === false) return false;
  return (
    typeof config.dailyBaseSalary === 'number' &&
    Number.isFinite(config.dailyBaseSalary) &&
    config.dailyBaseSalary >= 0 &&
    typeof config.standardWorkingHours === 'number' &&
    Number.isFinite(config.standardWorkingHours) &&
    config.standardWorkingHours > 0
  );
}

export interface EstimatedSalaryResult {
  dailyBaseSalary?: number;
  addonSalary: number;
  addonEnabled: boolean;
  standardWorkingHours?: number;
  extraHourRate?: number;
  overtimeEnabled: boolean;
  isConfigured: boolean;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  holidayDays: number;
  totalWorkingHours: number;
  overtimeHours: number;
  grossSalary: number;
  netSalary: number;
  breakdown: string[];
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
  const addonSalary =
    typeof config.addonSalary === 'number' && Number.isFinite(config.addonSalary)
      ? config.addonSalary
      : 0;
  const addonEnabled = typeof config.addonEnabled === 'boolean' ? config.addonEnabled : false;
  const standardWorkingHours =
    typeof config.standardWorkingHours === 'number' &&
    Number.isFinite(config.standardWorkingHours) &&
    config.standardWorkingHours > 0
      ? config.standardWorkingHours
      : undefined;
  const extraHourRate =
    typeof config.extraHourRate === 'number' && Number.isFinite(config.extraHourRate)
      ? config.extraHourRate
      : undefined;
  const overtimeEnabled = typeof config.overtimeEnabled === 'boolean' ? config.overtimeEnabled : false;

  const monthRecords = attendanceRecords.filter(r => r.date && r.date.startsWith(monthStr));
  let presentDays = 0;
  let absentDays = 0;
  let leaveDays = 0;
  let holidayDays = 0;
  let totalWorkingHours = 0;
  let overtimeHours = 0;
  let grossSalary = 0;
  let actualBaseTotal = 0;
  let actualAddonTotal = 0;
  let actualOvertimeTotal = 0;
  let actualOverrideDelta = 0;
  let usedSnapshotRates = false;

  monthRecords.forEach(r => {
    if (r.status === 'Present') {
      presentDays += 1;
      const hours = r.calculatedHours || 0;
      const dayBase = typeof r.dailyBaseSalary === 'number' ? r.dailyBaseSalary : (dailyBaseSalary ?? 0);
      const dayAddon = typeof r.addonSalary === 'number' ? r.addonSalary : addonSalary;
      const dayAddonEnabled = typeof r.addonEnabled === 'boolean' ? r.addonEnabled : addonEnabled;
      const dayExtraRate = typeof r.extraHourRate === 'number' ? r.extraHourRate : (extraHourRate ?? 0);
      const dayOvertimeEnabled = typeof r.overtimeEnabled === 'boolean' ? r.overtimeEnabled : overtimeEnabled;

      if (
        (typeof r.dailyBaseSalary === 'number' &&
          (dailyBaseSalary === undefined
            ? r.dailyBaseSalary > 0
            : Math.abs(r.dailyBaseSalary - dailyBaseSalary) > 0.01)) ||
        (typeof r.addonEnabled === 'boolean' && r.addonEnabled !== addonEnabled) ||
        (typeof r.addonSalary === 'number' && Math.abs(r.addonSalary - addonSalary) > 0.01) ||
        (typeof r.overtimeEnabled === 'boolean' && r.overtimeEnabled !== overtimeEnabled) ||
        (typeof r.extraHourRate === 'number' &&
          (extraHourRate === undefined
            ? r.extraHourRate > 0
            : Math.abs(r.extraHourRate - extraHourRate) > 0.01))
      ) {
        usedSnapshotRates = true;
      }

      const res = calculateDailyEarnedSalary('Present', hours, {
        dailyBaseSalary: dayBase,
        addonSalary: dayAddon,
        addonEnabled: dayAddonEnabled,
        standardWorkingHours,
        extraHourRate: dayExtraRate,
        overtimeEnabled: dayOvertimeEnabled,
        salaryOverrideEnabled: Boolean(r.salaryOverrideEnabled),
        salaryOverrideAmount: r.salaryOverrideAmount
      });

      const dayExtra = typeof r.extraHours === 'number' ? r.extraHours : res.extraHours;
      const dayOtPay = dayOvertimeEnabled ? dayExtra * dayExtraRate : 0;
      const dayAddonPay = dayAddonEnabled ? dayAddon : 0;
      const dayFormulaSum = dayBase + dayAddonPay + dayOtPay;
      const dayEarned = typeof r.dailyEarnedSalary === 'number' ? r.dailyEarnedSalary : res.dailyEarnedSalary;

      actualBaseTotal += dayBase;
      actualAddonTotal += dayAddonPay;
      actualOvertimeTotal += dayOtPay;
      actualOverrideDelta += dayEarned - dayFormulaSum;

      totalWorkingHours += hours;
      overtimeHours += dayExtra;
      grossSalary += dayEarned;
    } else if (r.status === 'Absent') {
      absentDays += 1;
    } else if (r.status === 'Leave') {
      leaveDays += 1;
    } else if (r.status === 'Holiday') {
      holidayDays += 1;
    }
  });

  const roundedGross = Number(grossSalary.toFixed(2));
  const roundedOvertime = Number(overtimeHours.toFixed(1));
  const roundedBase = Number(actualBaseTotal.toFixed(2));
  const roundedAddon = Number(actualAddonTotal.toFixed(2));
  const roundedOtPay = Number(actualOvertimeTotal.toFixed(2));
  const roundedOverrideDelta = Number((roundedGross - roundedBase - roundedAddon - roundedOtPay).toFixed(2));

  const breakdown: string[] =
    !configured && presentDays === 0
      ? ['Salary configuration not set yet.']
      : [
          usedSnapshotRates || dailyBaseSalary === undefined
            ? `Base Pay (${presentDays} Present days, per-day rates) = ${roundedBase.toFixed(2)}`
            : `Present Days: ${presentDays} × ${dailyBaseSalary.toFixed(2)} = ${roundedBase.toFixed(2)}`
        ];
  if (roundedAddon > 0 || (addonEnabled && addonSalary > 0)) {
    breakdown.push(
      usedSnapshotRates
        ? `Daily Add-on (${presentDays} Present days) = ${roundedAddon.toFixed(2)}`
        : `Daily Add-on: ${presentDays} × ${addonSalary.toFixed(2)} = ${roundedAddon.toFixed(2)}`
    );
  }
  if (roundedOtPay > 0 || (overtimeEnabled && roundedOvertime > 0)) {
    breakdown.push(
      usedSnapshotRates || extraHourRate === undefined
        ? `Extra Hours (${roundedOvertime.toFixed(1)} hrs, per-day rates) = ${roundedOtPay.toFixed(2)}`
        : `Extra Hours: ${roundedOvertime.toFixed(1)} hrs × ${extraHourRate.toFixed(2)} = ${roundedOtPay.toFixed(2)}`
    );
  }
  if (Math.abs(roundedOverrideDelta) >= 0.01) {
    const sign = roundedOverrideDelta > 0 ? '+' : '';
    breakdown.push(`Manual Day Adjustments = ${sign}${roundedOverrideDelta.toFixed(2)}`);
  }

  return {
    dailyBaseSalary,
    addonSalary,
    addonEnabled,
    standardWorkingHours,
    extraHourRate,
    overtimeEnabled,
    isConfigured: configured,
    presentDays,
    absentDays,
    leaveDays,
    holidayDays,
    totalWorkingHours: Number(totalWorkingHours.toFixed(1)),
    overtimeHours: roundedOvertime,
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

// DAILY SALARY CALCULATIONS
export interface DailySalaryCalculationResult {
  workingHours: number;
  extraHours: number;
  dailyEarnedSalary: number;
}

export type DailySalaryCalculationConfig = Partial<SalaryConfig> & {
  salaryOverrideEnabled?: boolean;
  salaryOverrideAmount?: number;
};

export function calculateDailyEarnedSalary(
  status: 'Present' | 'Absent' | 'Leave' | 'Holiday',
  workingHours: number,
  config: DailySalaryCalculationConfig = {}
): DailySalaryCalculationResult {
  if (status !== 'Present') {
    return {
      workingHours: 0,
      extraHours: 0,
      dailyEarnedSalary: 0
    };
  }

  const hasStandardHours =
    typeof config.standardWorkingHours === 'number' &&
    Number.isFinite(config.standardWorkingHours) &&
    config.standardWorkingHours > 0;

  const dailyBase =
    typeof config.dailyBaseSalary === 'number' && Number.isFinite(config.dailyBaseSalary)
      ? Math.max(0, config.dailyBaseSalary)
      : 0;
  const addonSalary =
    typeof config.addonSalary === 'number' && Number.isFinite(config.addonSalary)
      ? Math.max(0, config.addonSalary)
      : 0;
  const addonEnabled = typeof config.addonEnabled === 'boolean' ? config.addonEnabled : false;
  const extraRate =
    typeof config.extraHourRate === 'number' && Number.isFinite(config.extraHourRate)
      ? Math.max(0, config.extraHourRate)
      : 0;
  const overtimeEnabled = typeof config.overtimeEnabled === 'boolean' ? config.overtimeEnabled : false;

  const safeHours = Math.max(0, Number.isFinite(workingHours) ? workingHours : 0);
  const extraHours = hasStandardHours
    ? Math.max(0, Number((safeHours - config.standardWorkingHours!).toFixed(2)))
    : 0;
  const formulaSalary =
    dailyBase +
    (addonEnabled ? addonSalary : 0) +
    (overtimeEnabled ? extraHours * extraRate : 0);

  const hasManualOverride =
    config.salaryOverrideEnabled === true &&
    typeof config.salaryOverrideAmount === 'number' &&
    Number.isFinite(config.salaryOverrideAmount);

  const dailyEarnedSalary = hasManualOverride
    ? Number(Math.max(0, config.salaryOverrideAmount!).toFixed(2))
    : Number(formulaSalary.toFixed(2));

  return {
    workingHours: Number(safeHours.toFixed(2)),
    extraHours,
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
  const periodRecords = filterRecordsByDateRange(attendanceRecords, preset, customStart, customEnd, referenceDate);

  let presentDays = 0;
  let leaveDays = 0;
  let absentDays = 0;
  let holidayDays = 0;
  let totalWorkingHours = 0;
  let totalExtraHours = 0;
  let totalEarned = 0;

  periodRecords.forEach(r => {
    if (r.status === 'Present') {
      presentDays += 1;
      const hours = r.calculatedHours || 0;
      const res = calculateDailyEarnedSalary('Present', hours, {
        ...config,
        dailyBaseSalary: typeof r.dailyBaseSalary === 'number' ? r.dailyBaseSalary : config.dailyBaseSalary,
        addonSalary: typeof r.addonSalary === 'number' ? r.addonSalary : config.addonSalary,
        addonEnabled: typeof r.addonEnabled === 'boolean' ? r.addonEnabled : config.addonEnabled,
        extraHourRate: typeof r.extraHourRate === 'number' ? r.extraHourRate : config.extraHourRate,
        overtimeEnabled: typeof r.overtimeEnabled === 'boolean' ? r.overtimeEnabled : config.overtimeEnabled,
        salaryOverrideEnabled: Boolean(r.salaryOverrideEnabled),
        salaryOverrideAmount: r.salaryOverrideAmount
      });
      totalWorkingHours += hours;
      totalExtraHours += typeof r.extraHours === 'number' ? r.extraHours : res.extraHours;
      totalEarned += typeof r.dailyEarnedSalary === 'number' ? r.dailyEarnedSalary : res.dailyEarnedSalary;
    } else if (r.status === 'Leave') {
      leaveDays += 1;
    } else if (r.status === 'Absent') {
      absentDays += 1;
    } else if (r.status === 'Holiday') {
      holidayDays += 1;
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
  const remainingSalary = Math.max(0, Number((totalEarned - salaryReceived).toFixed(2)));
  const overpaidAmount = Math.max(0, Number((salaryReceived - totalEarned).toFixed(2)));

  return {
    earnedSalary: Number(totalEarned.toFixed(2)),
    salaryReceived: Number(salaryReceived.toFixed(2)),
    remainingSalary,
    overpaidAmount,
    presentDays,
    leaveDays,
    absentDays,
    holidayDays,
    totalWorkingHours: Number(totalWorkingHours.toFixed(1)),
    totalExtraHours: Number(totalExtraHours.toFixed(1)),
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
  const monthRecords = attendanceRecords.filter(r => r.date && r.date.startsWith(monthStr));

  let presentDays = 0;
  let leaveDays = 0;
  let absentDays = 0;
  let holidayDays = 0;
  let totalWorkingHours = 0;
  let totalExtraHours = 0;
  let totalEarned = 0;
  let customizedDaysCount = 0;

  monthRecords.forEach(r => {
    if (r.status === 'Present') {
      presentDays += 1;
      const hours = r.calculatedHours || 0;
      const effectiveBase = typeof r.dailyBaseSalary === 'number' ? r.dailyBaseSalary : config.dailyBaseSalary;
      const effectiveAddonSalary = typeof r.addonSalary === 'number' ? r.addonSalary : config.addonSalary;
      const effectiveAddonEnabled = typeof r.addonEnabled === 'boolean' ? r.addonEnabled : config.addonEnabled;
      const effectiveExtraRate = typeof r.extraHourRate === 'number' ? r.extraHourRate : config.extraHourRate;
      const effectiveOvertimeEnabled =
        typeof r.overtimeEnabled === 'boolean' ? r.overtimeEnabled : config.overtimeEnabled;
      const effectiveOverrideEnabled = Boolean(r.salaryOverrideEnabled);
      const effectiveOverrideAmount = r.salaryOverrideAmount;

      const res = calculateDailyEarnedSalary('Present', hours, {
        ...config,
        dailyBaseSalary: effectiveBase,
        addonSalary: effectiveAddonSalary,
        addonEnabled: effectiveAddonEnabled,
        extraHourRate: effectiveExtraRate,
        overtimeEnabled: effectiveOvertimeEnabled,
        salaryOverrideEnabled: effectiveOverrideEnabled,
        salaryOverrideAmount: effectiveOverrideAmount
      });
      const earnedForDay = typeof r.dailyEarnedSalary === 'number' ? r.dailyEarnedSalary : res.dailyEarnedSalary;

      const cfgBase = typeof config.dailyBaseSalary === 'number' ? config.dailyBaseSalary : undefined;
      const cfgExtra = typeof config.extraHourRate === 'number' ? config.extraHourRate : undefined;
      if (
        effectiveOverrideEnabled ||
        (typeof r.dailyBaseSalary === 'number' &&
          (cfgBase === undefined ? r.dailyBaseSalary > 0 : Math.abs(r.dailyBaseSalary - cfgBase) > 0.01)) ||
        (typeof r.addonEnabled === 'boolean' && r.addonEnabled !== Boolean(config.addonEnabled)) ||
        (typeof r.addonSalary === 'number' && Math.abs(r.addonSalary - (config.addonSalary ?? 0)) > 0.01) ||
        (typeof r.overtimeEnabled === 'boolean' && r.overtimeEnabled !== Boolean(config.overtimeEnabled)) ||
        (typeof r.extraHourRate === 'number' &&
          (cfgExtra === undefined ? r.extraHourRate > 0 : Math.abs(r.extraHourRate - cfgExtra) > 0.01))
      ) {
        customizedDaysCount += 1;
      }

      totalWorkingHours += hours;
      totalExtraHours += (typeof r.extraHours === 'number' ? r.extraHours : res.extraHours);
      totalEarned += earnedForDay;
    } else if (r.status === 'Leave') {
      leaveDays += 1;
    } else if (r.status === 'Absent') {
      absentDays += 1;
    } else if (r.status === 'Holiday') {
      holidayDays += 1;
    }
  });

  const monthPayouts = payouts.filter(p => payoutMatchesMonth(p, monthStr));
  const salaryReceived = monthPayouts.reduce((sum, p) => sum + (p.amountPaid || 0), 0);
  const remainingSalary = Math.max(0, Number((totalEarned - salaryReceived).toFixed(2)));
  const overpaidAmount = Math.max(0, Number((salaryReceived - totalEarned).toFixed(2)));

  return {
    periodMonth: monthStr,
    earnedSalary: Number(totalEarned.toFixed(2)),
    salaryReceived: Number(salaryReceived.toFixed(2)),
    remainingSalary,
    overpaidAmount,
    presentDays,
    leaveDays,
    absentDays,
    holidayDays,
    totalWorkingHours: Number(totalWorkingHours.toFixed(1)),
    totalExtraHours: Number(totalExtraHours.toFixed(1)),
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
