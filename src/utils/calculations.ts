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
  preset: DateFilterPreset,
  customStart?: string,
  customEnd?: string,
  referenceDate: Date = new Date()
): T[] {
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

export interface EstimatedSalaryResult {
  dailyBaseSalary: number;
  addonSalary: number;
  addonEnabled: boolean;
  standardWorkingHours: number;
  extraHourRate: number;
  overtimeEnabled: boolean;
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
  const dailyBaseSalary = typeof config.dailyBaseSalary === 'number' ? config.dailyBaseSalary : 500;
  const addonSalary = typeof config.addonSalary === 'number' ? config.addonSalary : 0;
  const addonEnabled = typeof config.addonEnabled === 'boolean' ? config.addonEnabled : false;
  const standardWorkingHours =
    typeof config.standardWorkingHours === 'number' && config.standardWorkingHours > 0
      ? config.standardWorkingHours
      : 8;
  const extraHourRate = typeof config.extraHourRate === 'number' ? config.extraHourRate : 100;
  const overtimeEnabled = typeof config.overtimeEnabled === 'boolean' ? config.overtimeEnabled : true;

  const monthRecords = attendanceRecords.filter(r => r.date && r.date.startsWith(monthStr));
  let presentDays = 0;
  let absentDays = 0;
  let leaveDays = 0;
  let holidayDays = 0;
  let totalWorkingHours = 0;
  let overtimeHours = 0;
  let grossSalary = 0;

  monthRecords.forEach(r => {
    if (r.status === 'Present') {
      presentDays += 1;
      const hours = r.calculatedHours || 0;
      const res = calculateDailyEarnedSalary('Present', hours, {
        dailyBaseSalary: typeof r.dailyBaseSalary === 'number' ? r.dailyBaseSalary : dailyBaseSalary,
        addonSalary: typeof r.addonSalary === 'number' ? r.addonSalary : addonSalary,
        addonEnabled: typeof r.addonEnabled === 'boolean' ? r.addonEnabled : addonEnabled,
        standardWorkingHours,
        extraHourRate: typeof r.extraHourRate === 'number' ? r.extraHourRate : extraHourRate,
        overtimeEnabled: typeof r.overtimeEnabled === 'boolean' ? r.overtimeEnabled : overtimeEnabled,
        salaryOverrideEnabled: Boolean(r.salaryOverrideEnabled),
        salaryOverrideAmount: r.salaryOverrideAmount
      });
      totalWorkingHours += hours;
      overtimeHours += typeof r.extraHours === 'number' ? r.extraHours : res.extraHours;
      grossSalary += typeof r.dailyEarnedSalary === 'number' ? r.dailyEarnedSalary : res.dailyEarnedSalary;
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
  const breakdown: string[] = [
    `Present Days: ${presentDays} × ${dailyBaseSalary.toFixed(2)} = ${(presentDays * dailyBaseSalary).toFixed(2)}`
  ];
  if (addonEnabled && addonSalary > 0) {
    breakdown.push(`Daily Add-on: ${presentDays} × ${addonSalary.toFixed(2)} = ${(presentDays * addonSalary).toFixed(2)}`);
  }
  if (overtimeEnabled && roundedOvertime > 0) {
    breakdown.push(`Extra Hours: ${roundedOvertime.toFixed(1)} hrs × ${extraHourRate.toFixed(2)} = ${(roundedOvertime * extraHourRate).toFixed(2)}`);
  }

  return {
    dailyBaseSalary,
    addonSalary,
    addonEnabled,
    standardWorkingHours,
    extraHourRate,
    overtimeEnabled,
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

  const standardHours = typeof config.standardWorkingHours === 'number' && config.standardWorkingHours > 0
    ? config.standardWorkingHours
    : 8;

  const dailyBase =
    typeof config.dailyBaseSalary === 'number' && Number.isFinite(config.dailyBaseSalary)
      ? Math.max(0, config.dailyBaseSalary)
      : 500;
  const addonSalary =
    typeof config.addonSalary === 'number' && Number.isFinite(config.addonSalary)
      ? Math.max(0, config.addonSalary)
      : 0;
  const addonEnabled = typeof config.addonEnabled === 'boolean' ? config.addonEnabled : false;
  const extraRate =
    typeof config.extraHourRate === 'number' && Number.isFinite(config.extraHourRate)
      ? Math.max(0, config.extraHourRate)
      : 100;
  const overtimeEnabled = typeof config.overtimeEnabled === 'boolean' ? config.overtimeEnabled : true;

  const safeHours = Math.max(0, Number.isFinite(workingHours) ? workingHours : 0);
  const extraHours = Math.max(0, Number((safeHours - standardHours).toFixed(2)));
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
  preset: DateFilterPreset = 'this_month',
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

  return {
    earnedSalary: Number(totalEarned.toFixed(2)),
    salaryReceived: Number(salaryReceived.toFixed(2)),
    remainingSalary,
    presentDays,
    leaveDays,
    absentDays,
    holidayDays,
    totalWorkingHours: Number(totalWorkingHours.toFixed(1)),
    totalExtraHours: Number(totalExtraHours.toFixed(1)),
    recordCount: periodRecords.length
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

      if (
        effectiveOverrideEnabled ||
        (typeof r.dailyBaseSalary === 'number' && Math.abs(r.dailyBaseSalary - config.dailyBaseSalary) > 0.01) ||
        (typeof r.addonEnabled === 'boolean' && r.addonEnabled !== config.addonEnabled) ||
        (typeof r.addonSalary === 'number' && Math.abs(r.addonSalary - config.addonSalary) > 0.01) ||
        (typeof r.overtimeEnabled === 'boolean' && r.overtimeEnabled !== config.overtimeEnabled) ||
        (typeof r.extraHourRate === 'number' && Math.abs(r.extraHourRate - config.extraHourRate) > 0.01)
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

  return {
    periodMonth: monthStr,
    earnedSalary: Number(totalEarned.toFixed(2)),
    salaryReceived: Number(salaryReceived.toFixed(2)),
    remainingSalary,
    presentDays,
    leaveDays,
    absentDays,
    holidayDays,
    totalWorkingHours: Number(totalWorkingHours.toFixed(1)),
    totalExtraHours: Number(totalExtraHours.toFixed(1)),
    customizedDaysCount,
    recordCount: monthRecords.length
  };
}

export function calculateGoalStats(goals: Goal[]) {
  const activeGoals = goals.filter(g => g.status === 'In Progress' || g.status === 'Not Started');
  const completedGoals = goals.filter(g => g.status === 'Completed');
  const averageProgress = goals.length > 0
    ? Math.round(goals.reduce((sum, g) => sum + Math.max(0, Math.min(100, g.progressPercentage || 0)), 0) / goals.length)
    : 0;

  return {
    total: goals.length,
    activeCount: activeGoals.length,
    completedCount: completedGoals.length,
    averageProgress,
    completionPercentage: goals.length > 0 ? Math.round((completedGoals.length / goals.length) * 100) : 0
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
  let totalLent = 0;
  let outstandingReceivable = 0;
  let totalRepaid = 0;
  let outstandingCount = 0;
  let partiallyPaidCount = 0;
  let paidCount = 0;

  debts.forEach(d => {
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
    totalRecords: debts.length
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
