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
  salaryType: string;
  baseAmount: number;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  holidayDays: number;
  totalWorkingHours: number;
  overtimeHours: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absenceDeduction: number;
  grossSalary: number;
  totalAllowances: number;
  totalDeductions: number;
  netSalary: number;
  breakdown: string[];
}

export function calculateEstimatedSalary(
  config: SalaryConfig,
  attendanceRecords: AttendanceRecord[],
  monthStr: string = getMonthString()
): EstimatedSalaryResult {
  const { 
    baseAmount = 0, 
    salaryType, 
    expectedWorkingDaysPerMonth = 22, 
    expectedWorkingHoursPerDay = 8, 
    paidLeaveAllowancePerMonth = 0, 
    overtimeRateMultiplier = 1.5, 
    allowances = [], 
    deductions = [],
    fixedMonthlyAbsencePolicy = 'no_deduction',
    includeOvertimeInMonthly = false
  } = config;

  const stats = calculateAttendanceStats(attendanceRecords, monthStr, expectedWorkingHoursPerDay);

  const totalAllowances = allowances.reduce((acc, curr) => acc + (curr.amount || 0), 0);
  const totalDeductions = deductions.reduce((acc, curr) => acc + (curr.amount || 0), 0);

  let grossSalary = 0;
  let absenceDeduction = 0;
  const breakdown: string[] = [];

  // Paid leave rules vs unpaid
  const paidLeaveDays = Math.min(stats.leaveDays, paidLeaveAllowancePerMonth || 0);
  const unpaidLeaveDays = Math.max(0, stats.leaveDays - paidLeaveDays);
  
  // Payable days includes Present + Paid Leave + Holiday
  const payableDays = stats.presentDays + paidLeaveDays + stats.holidayDays;

  // Expected hours for Present days based on configured standard day
  const standardDayHours = expectedWorkingHoursPerDay > 0 ? expectedWorkingHoursPerDay : 8;
  const expectedTotalHours = stats.presentDays * standardDayHours;
  const overtimeHours = Math.max(0, Number((stats.totalHours - expectedTotalHours).toFixed(1)));

  switch (salaryType) {
    case 'fixed_monthly': {
      if (fixedMonthlyAbsencePolicy === 'deduct_unpaid_absent') {
        const unpaidAbsenceDays = stats.absentDays + unpaidLeaveDays;
        const dailyRate = expectedWorkingDaysPerMonth > 0 ? baseAmount / expectedWorkingDaysPerMonth : 0;
        absenceDeduction = Number((unpaidAbsenceDays * dailyRate).toFixed(2));
        const baseEarned = Math.max(0, Number((baseAmount - absenceDeduction).toFixed(2)));

        breakdown.push(`Fixed Base Monthly Rate: ${baseAmount.toFixed(2)}`);
        breakdown.push(`Policy: Deduct per unpaid absent day (${dailyRate.toFixed(2)}/day)`);
        if (absenceDeduction > 0) {
          breakdown.push(`Absence Deduction: -${absenceDeduction.toFixed(2)} (${stats.absentDays} absent + ${unpaidLeaveDays} unpaid leave)`);
        }
        breakdown.push(`Adjusted Base Earned: ${baseEarned.toFixed(2)}`);

        if (includeOvertimeInMonthly && overtimeHours > 0) {
          const hourlyRate = standardDayHours > 0 ? dailyRate / standardDayHours : 0;
          const overtimePay = Number((overtimeHours * hourlyRate * (overtimeRateMultiplier || 1.5)).toFixed(2));
          grossSalary = baseEarned + overtimePay;
          breakdown.push(`Overtime (${overtimeHours} hrs @ ${overtimeRateMultiplier}x): +${overtimePay.toFixed(2)}`);
        } else {
          grossSalary = baseEarned;
          if (overtimeHours > 0) {
            breakdown.push(`Overtime: ${overtimeHours} hrs recorded (exempt from fixed contract)`);
          }
        }
      } else {
        // No absence deduction policy
        grossSalary = baseAmount;
        breakdown.push(`Fixed Base Monthly Rate: ${baseAmount.toFixed(2)}`);
        breakdown.push(`Policy: Guaranteed fixed salary (no absence deductions)`);

        if (includeOvertimeInMonthly && overtimeHours > 0) {
          const dailyRate = expectedWorkingDaysPerMonth > 0 ? baseAmount / expectedWorkingDaysPerMonth : 0;
          const hourlyRate = standardDayHours > 0 ? dailyRate / standardDayHours : 0;
          const overtimePay = Number((overtimeHours * hourlyRate * (overtimeRateMultiplier || 1.5)).toFixed(2));
          grossSalary = Number((baseAmount + overtimePay).toFixed(2));
          breakdown.push(`Overtime (${overtimeHours} hrs @ ${overtimeRateMultiplier}x): +${overtimePay.toFixed(2)}`);
        } else if (overtimeHours > 0) {
          breakdown.push(`Overtime: ${overtimeHours} hrs recorded (exempt from fixed contract)`);
        }
      }
      break;
    }
    case 'attendance_monthly': {
      const dailyRate = expectedWorkingDaysPerMonth > 0 ? baseAmount / expectedWorkingDaysPerMonth : 0;
      const effectiveDays = Math.min(payableDays, expectedWorkingDaysPerMonth);
      const baseEarned = Number((dailyRate * effectiveDays).toFixed(2));

      breakdown.push(`Daily Rate (${baseAmount.toFixed(2)} / ${expectedWorkingDaysPerMonth} days) = ${dailyRate.toFixed(2)}/day`);
      breakdown.push(`Payable Days: ${payableDays} days (${stats.presentDays} Present + ${paidLeaveDays} Paid Leave + ${stats.holidayDays} Holiday)`);
      if (payableDays > expectedWorkingDaysPerMonth) {
        breakdown.push(`Capped at expected working days: ${expectedWorkingDaysPerMonth} days`);
      }
      breakdown.push(`Base Earned: ${baseEarned.toFixed(2)}`);

      if (includeOvertimeInMonthly && overtimeHours > 0) {
        const hourlyRate = standardDayHours > 0 ? dailyRate / standardDayHours : 0;
        const overtimePay = Number((overtimeHours * hourlyRate * (overtimeRateMultiplier || 1.5)).toFixed(2));
        grossSalary = Number((baseEarned + overtimePay).toFixed(2));
        breakdown.push(`Overtime (${overtimeHours} hrs @ ${overtimeRateMultiplier}x): +${overtimePay.toFixed(2)}`);
      } else {
        grossSalary = baseEarned;
        if (overtimeHours > 0) {
          breakdown.push(`Overtime: ${overtimeHours} hrs recorded`);
        }
      }
      break;
    }
    case 'daily_wage': {
      grossSalary = Number((baseAmount * payableDays).toFixed(2));
      breakdown.push(`Daily Wage Rate: ${baseAmount.toFixed(2)} / day`);
      breakdown.push(`Payable Days: ${payableDays} days (${stats.presentDays} Present + ${paidLeaveDays} Paid Leave + ${stats.holidayDays} Holiday)`);
      breakdown.push(`Earned: ${grossSalary.toFixed(2)}`);
      break;
    }
    case 'hourly_wage': {
      const hourlyRate = baseAmount;
      // Partition totalHours into regular hours (up to expected) and overtime hours to avoid double-counting
      const regularHours = expectedTotalHours > 0 ? Math.min(stats.totalHours, expectedTotalHours) : stats.totalHours;
      const calculatedOvertimeHours = Math.max(0, Number((stats.totalHours - regularHours).toFixed(1)));

      const regularPay = Number((regularHours * hourlyRate).toFixed(2));
      const overtimeRate = Number((hourlyRate * (overtimeRateMultiplier || 1.5)).toFixed(2));
      const overtimePay = Number((calculatedOvertimeHours * overtimeRate).toFixed(2));

      grossSalary = Number((regularPay + overtimePay).toFixed(2));

      breakdown.push(`Hourly Base Rate: ${hourlyRate.toFixed(2)} / hour`);
      breakdown.push(`Regular Hours: ${regularHours.toFixed(1)} hrs @ ${hourlyRate.toFixed(2)} = ${regularPay.toFixed(2)}`);
      if (calculatedOvertimeHours > 0) {
        breakdown.push(`Overtime: ${calculatedOvertimeHours.toFixed(1)} hrs @ ${overtimeRateMultiplier}x (${overtimeRate.toFixed(2)}/hr) = ${overtimePay.toFixed(2)}`);
      }
      breakdown.push(`Total Earned: ${grossSalary.toFixed(2)}`);
      break;
    }
    case 'custom':
    default: {
      const dailyRate = expectedWorkingDaysPerMonth > 0 ? baseAmount / expectedWorkingDaysPerMonth : 0;
      const hourlyRate = standardDayHours > 0 ? dailyRate / standardDayHours : 0;
      const effectiveDays = expectedWorkingDaysPerMonth > 0 ? Math.min(payableDays, expectedWorkingDaysPerMonth) : payableDays;
      const baseEarned = Number((dailyRate * effectiveDays).toFixed(2));
      const overtimePay = Number((overtimeHours * hourlyRate * (overtimeRateMultiplier || 1.5)).toFixed(2));
      
      grossSalary = Number((baseEarned + overtimePay).toFixed(2));
      breakdown.push(`Base Earned (${effectiveDays} days @ ${dailyRate.toFixed(2)}/day): ${baseEarned.toFixed(2)}`);
      if (overtimeHours > 0) {
        breakdown.push(`Overtime (${overtimeHours} hrs @ ${overtimeRateMultiplier}x): +${overtimePay.toFixed(2)}`);
      }
      break;
    }
  }

  const netSalary = Math.max(0, Number((grossSalary + totalAllowances - totalDeductions).toFixed(2)));

  return {
    salaryType: salaryType || 'daily_wage',
    baseAmount,
    presentDays: stats.presentDays,
    absentDays: stats.absentDays,
    leaveDays: stats.leaveDays,
    holidayDays: stats.holidayDays,
    totalWorkingHours: stats.totalHours,
    overtimeHours: Number(overtimeHours.toFixed(1)),
    paidLeaveDays,
    unpaidLeaveDays,
    absenceDeduction: Number(absenceDeduction.toFixed(2)),
    grossSalary: Number(grossSalary.toFixed(2)),
    totalAllowances: Number(totalAllowances.toFixed(2)),
    totalDeductions: Number(totalDeductions.toFixed(2)),
    netSalary: Number(netSalary.toFixed(2)),
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

export function calculateDailyEarnedSalary(
  status: 'Present' | 'Absent' | 'Leave' | 'Holiday',
  workingHours: number,
  config: Partial<SalaryConfig> = {}
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
    : (typeof config.expectedWorkingHoursPerDay === 'number' && config.expectedWorkingHoursPerDay > 0 ? config.expectedWorkingHoursPerDay : 8);
  
  const dailyBase = typeof config.dailyBaseSalary === 'number' ? config.dailyBaseSalary : (config.baseAmount || 500);
  const extraRate = typeof config.extraHourRate === 'number' ? config.extraHourRate : 100;

  const extraHours = Math.max(0, Number((workingHours - standardHours).toFixed(2)));
  const dailyEarnedSalary = Number((dailyBase + (extraHours * extraRate)).toFixed(2));

  return {
    workingHours: Number(workingHours.toFixed(2)),
    extraHours,
    dailyEarnedSalary
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
  let totalWorkingHours = 0;
  let totalExtraHours = 0;
  let totalEarned = 0;

  monthRecords.forEach(r => {
    if (r.status === 'Present') {
      presentDays += 1;
      const hours = r.calculatedHours || 0;
      const res = calculateDailyEarnedSalary('Present', hours, config);
      totalWorkingHours += hours;
      totalExtraHours += (typeof r.extraHours === 'number' ? r.extraHours : res.extraHours);
      totalEarned += (typeof r.dailyEarnedSalary === 'number' ? r.dailyEarnedSalary : res.dailyEarnedSalary);
    } else if (r.status === 'Leave') {
      leaveDays += 1;
    } else if (r.status === 'Absent') {
      absentDays += 1;
    }
  });

  const monthPayouts = payouts.filter(p => p.periodMonth === monthStr);
  const salaryReceived = monthPayouts.reduce((sum, p) => sum + (p.netSalary || 0), 0);
  const remainingSalary = Math.max(0, Number((totalEarned - salaryReceived).toFixed(2)));

  return {
    periodMonth: monthStr,
    earnedSalary: Number(totalEarned.toFixed(2)),
    salaryReceived: Number(salaryReceived.toFixed(2)),
    remainingSalary,
    presentDays,
    leaveDays,
    absentDays,
    totalWorkingHours: Number(totalWorkingHours.toFixed(1)),
    totalExtraHours: Number(totalExtraHours.toFixed(1)),
    recordCount: monthRecords.length
  };
}

export function calculateGoalStats(goals: Goal[]) {
  const activeGoals = goals.filter(g => g.status === 'In Progress' || g.status === 'Not Started');
  const completedGoals = goals.filter(g => g.status === 'Completed');
  const dreams = goals.filter(g => g.type === 'dream');

  return {
    total: goals.length,
    activeCount: activeGoals.length,
    completedCount: completedGoals.length,
    dreamCount: dreams.length,
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
  const repaid = calculateTotalRepaid(debt.id, repayments);
  return Math.max(0, Number((debt.original_amount - repaid).toFixed(2)));
}

export function calculateDebtSummary(debts: Debt[], repayments: DebtRepayment[]) {
  let totalLent = 0;
  let totalBorrowed = 0;
  let outstandingReceivable = 0;
  let outstandingPayable = 0;
  let pendingCount = 0;
  let partialCount = 0;
  let completedCount = 0;

  debts.forEach(d => {
    const outstanding = calculateDebtOutstanding(d, repayments);

    if (d.type === 'lent' || !d.type) {
      totalLent += d.original_amount;
      outstandingReceivable += outstanding;
    } else {
      totalBorrowed += d.original_amount;
      outstandingPayable += outstanding;
    }

    if (outstanding <= 0.0001) {
      completedCount++;
    } else if (outstanding < d.original_amount) {
      partialCount++;
    } else {
      pendingCount++;
    }
  });

  return {
    totalLent: Number(totalLent.toFixed(2)),
    totalBorrowed: Number(totalBorrowed.toFixed(2)),
    outstandingReceivable: Number(outstandingReceivable.toFixed(2)),
    outstandingPayable: Number(outstandingPayable.toFixed(2)),
    pendingCount,
    partialCount,
    completedCount,
    totalRecords: debts.length
  };
}
