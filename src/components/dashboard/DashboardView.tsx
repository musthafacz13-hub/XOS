import React, { useMemo } from 'react';
import { 
  Wallet, 
  TrendingUp, 
  TrendingDown, 
  Target, 
  CalendarCheck, 
  Plus, 
  ArrowUpRight, 
  ArrowDownRight
} from 'lucide-react';
import { useXOSData } from '../../hooks/useXOSData';
import { DateRangeFilter } from '../../types';
import { 
  calculateAttendanceStats, 
  calculateFinancialTotals, 
  calculateMonthlySalarySummary, 
  calculateDebtSummary, 
  calculateSeparateDebtTotals,
  filterRecordsByDateRange,
  isSalaryConfigured,
  resolveGoalsWithSavings
} from '../../utils/calculations';
import { formatCurrency, formatHumanDate, getMonthString } from '../../utils/formatters';
import { EmptyState } from '../common/EmptyState';

interface DashboardViewProps {
  dateFilter: DateRangeFilter;
  onOpenQuickAction: (action?: 'expense' | 'income' | 'attendance' | 'goal' | 'savings') => void;
  onNavigateTab: (tab: any) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  dateFilter,
  onOpenQuickAction,
  onNavigateTab
}) => {
  const data = useXOSData();

  // Period label for clean English context
  const getPeriodLabel = (preset: DateRangeFilter['preset']) => {
    switch (preset) {
      case 'today': return 'Today';
      case 'this_month': return 'This Month';
      case 'last_month': return 'Last Month';
      case 'this_year': return 'This Year';
      case 'custom': return 'Custom Period';
      default: return 'Current Period';
    }
  };

  const periodLabel = getPeriodLabel(dateFilter.preset);

  // Filter financial data by header date range
  const filteredIncomes = useMemo(
    () => filterRecordsByDateRange(data.incomes, dateFilter.preset, dateFilter.startDate, dateFilter.endDate),
    [data.incomes, dateFilter.preset, dateFilter.startDate, dateFilter.endDate]
  );

  const filteredExpenses = useMemo(
    () => filterRecordsByDateRange(data.expenses, dateFilter.preset, dateFilter.startDate, dateFilter.endDate),
    [data.expenses, dateFilter.preset, dateFilter.startDate, dateFilter.endDate]
  );

  // Exclude savings linked strictly to archived goals from active reserves display
  const archivedGoalSavingsIds = useMemo(
    () =>
      new Set(
        data.goals
          .filter(g => g.status === 'Archived' && g.savingsGoalId)
          .map(g => g.savingsGoalId as string)
      ),
    [data.goals]
  );

  const activeSavingsGoals = useMemo(
    () => data.savingsGoals.filter(sg => !sg.isArchived && !archivedGoalSavingsIds.has(sg.id)),
    [data.savingsGoals, archivedGoalSavingsIds]
  );

  // Financial calculations (pass all savingsTransactions so historical deposits into archived goals still reduce available cash)
  const financialTotals = useMemo(
    () => calculateFinancialTotals(filteredIncomes, filteredExpenses, activeSavingsGoals, data.savingsTransactions),
    [filteredIncomes, filteredExpenses, activeSavingsGoals, data.savingsTransactions]
  );

  const globalTotals = useMemo(
    () => calculateFinancialTotals(data.incomes, data.expenses, activeSavingsGoals, data.savingsTransactions),
    [data.incomes, data.expenses, activeSavingsGoals, data.savingsTransactions]
  );

  // Work, Salary, and Debt calculations
  const currentMonthStr = getMonthString();

  const attendanceStats = useMemo(
    () => calculateAttendanceStats(data.attendance, currentMonthStr),
    [data.attendance, currentMonthStr]
  );

  const monthlySalarySummary = useMemo(
    () =>
      calculateMonthlySalarySummary(
        data.attendance,
        data.salaryPayouts,
        data.settings.salaryConfig,
        currentMonthStr
      ),
    [data.attendance, data.salaryPayouts, data.settings.salaryConfig, currentMonthStr]
  );

  const debtSummary = useMemo(
    () => calculateDebtSummary(data.debts, data.debtRepayments),
    [data.debts, data.debtRepayments]
  );

  const { totalToPay } = useMemo(
    () => calculateSeparateDebtTotals(data.debts, data.debtRepayments),
    [data.debts, data.debtRepayments]
  );

  // Active Goals & Dreams (derived from canonical 1:1 Goal <-> SavingsGoal link)
  const activeGoalItems = useMemo(
    () => resolveGoalsWithSavings(data.goals, data.savingsGoals).filter(item => item.isActive),
    [data.goals, data.savingsGoals]
  );

  // Recent Activity (Expenses & Incomes sorted by date)
  const recentActivity = useMemo(() => {
    const recentExpenses = [...data.expenses]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);
    const recentIncomes = [...data.incomes]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);

    return [
      ...recentExpenses.map(e => ({
        id: e.id,
        title: e.title,
        amount: -e.amount,
        date: e.date,
        type: 'expense' as const,
        category: e.category
      })),
      ...recentIncomes.map(i => ({
        id: i.id,
        title: i.title,
        amount: i.amount,
        date: i.date,
        type: 'income' as const,
        category: i.source
      }))
    ]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 6);
  }, [data.expenses, data.incomes]);

  const displayName = data.settings.profile.name.trim();
  const salaryConfigured = isSalaryConfigured(data.settings.salaryConfig);

  return (
    <div className="space-y-6">
      {/* 1. Welcome Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-black/[0.06]">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-[#111111] tracking-tight">
            {displayName ? `Welcome, ${displayName}` : 'Personal Life Dashboard'}
          </h2>
          <p className="text-xs sm:text-sm text-neutral-500 font-normal mt-0.5">
            Your personal command center for finances, work, and goals.
          </p>
        </div>
      </div>

      {/* 2. Simplified Quick Actions: Keep ONLY Log Expense, Log Income, Log Attendance */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          onClick={() => onOpenQuickAction('expense')}
          type="button"
          className="p-3.5 sm:p-4 rounded-2xl bg-white border border-black/[0.08] hover:border-black/[0.16] hover:bg-neutral-50/60 transition-all text-left flex items-center gap-3.5 shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
        >
          <div className="w-9 h-9 rounded-xl bg-neutral-100 flex items-center justify-center shrink-0">
            <Plus className="w-4 h-4 text-[#111111]" />
          </div>
          <div className="min-w-0">
            <span className="text-xs font-bold text-[#111111] block">Log Expense</span>
            <span className="text-[11px] text-neutral-500 truncate block">Record daily spending</span>
          </div>
        </button>

        <button
          onClick={() => onOpenQuickAction('income')}
          type="button"
          className="p-3.5 sm:p-4 rounded-2xl bg-white border border-black/[0.08] hover:border-black/[0.16] hover:bg-neutral-50/60 transition-all text-left flex items-center gap-3.5 shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
        >
          <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
            <Plus className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="min-w-0">
            <span className="text-xs font-bold text-[#111111] block">Log Income</span>
            <span className="text-[11px] text-neutral-500 truncate block">Record earned revenue</span>
          </div>
        </button>

        <button
          onClick={() => onOpenQuickAction('attendance')}
          type="button"
          className="p-3.5 sm:p-4 rounded-2xl bg-white border border-black/[0.08] hover:border-black/[0.16] hover:bg-neutral-50/60 transition-all text-left flex items-center gap-3.5 shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
        >
          <div className="w-9 h-9 rounded-xl bg-sky-50 flex items-center justify-center shrink-0">
            <CalendarCheck className="w-4 h-4 text-sky-600" />
          </div>
          <div className="min-w-0">
            <span className="text-xs font-bold text-[#111111] block">Log Attendance</span>
            <span className="text-[11px] text-neutral-500 truncate block">Mark daily work check-in</span>
          </div>
        </button>
      </div>

      {/* 3. Financial Overview: 5 Core Financial Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Metric 1: Available Money (Prominent Main Summary Panel) */}
        <div className="lg:col-span-1 p-5 sm:p-6 rounded-2xl bg-[#111111] text-white flex flex-col justify-between space-y-4 shadow-xs">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-neutral-400">
              <span className="text-[11px] font-semibold tracking-wider uppercase">Available Money</span>
              <Wallet className="w-5 h-5 text-[#87CEEB]" />
            </div>
            <div>
              <div className="text-2xl sm:text-3xl font-extrabold font-mono tracking-tight text-white tabular-nums">
                {formatCurrency(globalTotals.availableBalance, data.settings.currency)}
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-neutral-800 text-[11px] text-neutral-400">
            Total cash balance
          </div>
        </div>

        {/* Metrics 2 to 5: 4 Clean Metric Cards Grid */}
        <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* Metric 2: Income Summary */}
          <div className="p-5 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-3 shadow-xs">
            <div className="flex items-center justify-between text-neutral-500">
              <span className="text-[11px] font-semibold uppercase tracking-wider">
                Income Summary
              </span>
              <ArrowUpRight className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <div className="text-2xl font-bold font-mono text-emerald-600 tabular-nums">
                {formatCurrency(financialTotals.totalIncome, data.settings.currency)}
              </div>
              <p className="text-[11px] text-neutral-500 font-normal mt-1">
                {filteredIncomes.length} {filteredIncomes.length === 1 ? 'entry' : 'entries'} · {periodLabel}
              </p>
            </div>
          </div>

          {/* Metric 3: Expense Summary */}
          <div className="p-5 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-3 shadow-xs">
            <div className="flex items-center justify-between text-neutral-500">
              <span className="text-[11px] font-semibold uppercase tracking-wider">
                Expense Summary
              </span>
              <ArrowDownRight className="w-4 h-4 text-[#111111]" />
            </div>
            <div>
              <div className="text-2xl font-bold font-mono text-[#111111] tabular-nums">
                {formatCurrency(financialTotals.totalExpenses, data.settings.currency)}
              </div>
              <p className="text-[11px] text-neutral-500 font-normal mt-1">
                {filteredExpenses.length} {filteredExpenses.length === 1 ? 'transaction' : 'transactions'} · {periodLabel}
              </p>
            </div>
          </div>

          {/* Metric 4: Remaining Salary */}
          <div className="p-5 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-3 shadow-xs">
            <div className="flex items-center justify-between text-neutral-500">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Remaining Salary</span>
              <TrendingUp className="w-4 h-4 text-sky-600" />
            </div>
            <div>
              {!salaryConfigured &&
              monthlySalarySummary.earnedSalary === 0 &&
              monthlySalarySummary.salaryReceived === 0 ? (
                <>
                  <div className="text-lg sm:text-xl font-bold text-neutral-700">Not configured</div>
                  <button
                    type="button"
                    onClick={() => onNavigateTab('salary')}
                    className="text-[11px] text-[#0284C7] hover:underline font-medium mt-1 cursor-pointer text-left"
                  >
                    Set daily base &amp; hours →
                  </button>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold font-mono text-[#111111] tabular-nums">
                    {formatCurrency(monthlySalarySummary.remainingSalary, data.settings.currency)}
                  </div>
                  <p className="text-[11px] text-neutral-500 font-normal mt-1">
                    Earned: {formatCurrency(monthlySalarySummary.earnedSalary, data.settings.currency)}
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Metric 5: Debt Balance (Receivable & To Pay) */}
          <div className="p-5 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-3 shadow-xs">
            <div className="flex items-center justify-between text-neutral-500">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Money Owed to Me</span>
              <ArrowUpRight className="w-4 h-4 text-[#87CEEB]" />
            </div>
            <div>
              <div className="text-2xl font-bold font-mono text-[#111111] tabular-nums">
                {formatCurrency(debtSummary.outstandingReceivable, data.settings.currency)}
              </div>
              <p className="text-[11px] text-neutral-500 font-normal mt-1 font-mono tabular-nums">
                To Pay: {formatCurrency(totalToPay, data.settings.currency)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Work & Monthly Salary Overview */}
      <div className="p-5 sm:p-6 rounded-2xl bg-white border border-black/[0.08] space-y-4 shadow-xs">
        <div className="flex items-center justify-between border-b border-black/[0.06] pb-3">
          <div className="flex items-center gap-2">
            <CalendarCheck className="w-5 h-5 text-[#87CEEB]" />
            <h3 className="font-bold text-sm text-[#111111]">Work & Monthly Salary Overview</h3>
          </div>
          <button
            onClick={() => onNavigateTab('attendance')}
            type="button"
            className="text-xs font-semibold text-neutral-700 hover:text-black transition-colors cursor-pointer"
          >
            Calendar →
          </button>
        </div>

        {attendanceStats.totalRecorded === 0 ? (
          <div className="py-6 text-center space-y-2">
            <p className="text-xs sm:text-sm text-neutral-500">
              No attendance recorded yet for this month.
            </p>
            <button
              onClick={() => onOpenQuickAction('attendance')}
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#111111] text-white text-xs font-medium hover:bg-black transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-[#87CEEB]" />
              <span>Log Today's Work</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Days Worked */}
            <div className="p-4 rounded-xl bg-neutral-50 space-y-1.5 border border-neutral-100">
              <span className="text-[11px] font-semibold text-neutral-500 uppercase">Days Worked</span>
              <div className="text-2xl font-bold font-mono text-[#111111] tabular-nums">
                {attendanceStats.presentDays}
              </div>
              <div className="text-xs text-neutral-500 pt-1 border-t border-neutral-200">
                {attendanceStats.leaveDays} Leave · {attendanceStats.absentDays} Absent
              </div>
            </div>

            {/* Total Hours Logged */}
            <div className="p-4 rounded-xl bg-neutral-50 space-y-1.5 border border-neutral-100">
              <span className="text-[11px] font-semibold text-neutral-500 uppercase">Hours Logged</span>
              <div className="text-2xl font-bold font-mono text-[#111111] tabular-nums">
                {attendanceStats.totalHours}h
              </div>
              <p className="text-xs text-neutral-500 pt-1 border-t border-neutral-200 truncate">
                {salaryConfigured
                  ? `Daily Base: ${formatCurrency(data.settings.salaryConfig.dailyBaseSalary ?? 0, data.settings.currency)} · ${data.settings.salaryConfig.standardWorkingHours}h/day`
                  : 'Salary & working hours not configured'}
              </p>
            </div>

            {/* Earned Salary */}
            <div className="p-4 rounded-xl bg-neutral-50 space-y-1.5 border border-neutral-100">
              <span className="text-[11px] font-semibold text-neutral-500 uppercase">
                Earned Salary ({currentMonthStr})
              </span>
              <div className="text-2xl font-bold font-mono text-[#111111] tabular-nums">
                {formatCurrency(monthlySalarySummary.earnedSalary, data.settings.currency)}
              </div>
              <div className="flex items-center justify-between text-xs text-neutral-500 pt-1 border-t border-neutral-200">
                <span>Received: {formatCurrency(monthlySalarySummary.salaryReceived, data.settings.currency)}</span>
                <button
                  onClick={() => onNavigateTab('salary')}
                  type="button"
                  className="font-semibold text-neutral-900 underline hover:text-black cursor-pointer"
                >
                  Salary →
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 5. Active Goals & Dreams */}
      <div className="p-5 sm:p-6 rounded-2xl bg-white border border-black/[0.08] space-y-4 shadow-xs">
        <div className="flex items-center justify-between border-b border-black/[0.06] pb-3">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-[#87CEEB]" />
            <h3 className="font-bold text-sm text-[#111111]">Active Goals & Dreams ({activeGoalItems.length})</h3>
          </div>
          <button
            onClick={() => onNavigateTab('goals')}
            type="button"
            className="text-xs font-semibold text-neutral-700 hover:text-black transition-colors cursor-pointer"
          >
            View All →
          </button>
        </div>

        {activeGoalItems.length === 0 ? (
          <EmptyState
            icon={Target}
            title="No active goals yet"
            description="Define a personal ambition or financial target to start tracking your progress."
            actionLabel="Create First Goal"
            onAction={() => onOpenQuickAction('goal')}
            className="border-dashed"
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {activeGoalItems.slice(0, 4).map((item) => {
              const { goal, savedAmount, targetAmount, progressPercentage } = item;
              const hasAmount = targetAmount > 0;

              return (
                <button
                  key={goal.id}
                  type="button"
                  onClick={() => onNavigateTab('goals')}
                  className="p-4 rounded-xl border border-black/[0.06] bg-neutral-50/60 hover:border-black/[0.14] hover:bg-neutral-50 transition-all space-y-2.5 text-left cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 block">
                        {goal.category}
                      </span>
                      <h4 className="font-bold text-sm text-[#111111] truncate">{goal.title}</h4>
                    </div>
                    <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-md bg-white border border-neutral-200 text-neutral-700 shrink-0">
                      {goal.priority}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between items-baseline gap-2 text-xs text-neutral-600 font-mono tabular-nums">
                      <span className="truncate">
                        {hasAmount
                          ? `Saved: ${formatCurrency(savedAmount, data.settings.currency)} / ${formatCurrency(targetAmount, data.settings.currency)}`
                          : (goal.targetDate ? formatHumanDate(goal.targetDate) : 'Progress')}
                      </span>
                      <span className="font-bold text-[#111111] shrink-0">{progressPercentage}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-neutral-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#87CEEB] transition-all duration-300"
                        style={{ width: `${progressPercentage}%` }}
                      />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 6. Recent Activity */}
      <div className="p-5 sm:p-6 rounded-2xl bg-white border border-black/[0.08] space-y-4 shadow-xs">
        <div className="flex items-center justify-between border-b border-black/[0.06] pb-3">
          <h3 className="font-bold text-sm text-[#111111]">Recent Activity</h3>
          <div className="flex items-center gap-3 text-xs">
            <button 
              onClick={() => onNavigateTab('expenses')} 
              type="button"
              className="text-neutral-600 hover:text-black font-medium cursor-pointer"
            >
              Expenses
            </button>
            <span className="text-neutral-300" aria-hidden="true">·</span>
            <button 
              onClick={() => onNavigateTab('income')} 
              type="button"
              className="text-neutral-600 hover:text-black font-medium cursor-pointer"
            >
              Income
            </button>
          </div>
        </div>

        {recentActivity.length === 0 ? (
          <div className="py-8 text-center text-xs text-neutral-400">
            No recent activity recorded yet.
          </div>
        ) : (
          <div className="divide-y divide-black/[0.06]">
            {recentActivity.map((act) => (
              <div key={act.id} className="py-2.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-neutral-100 flex items-center justify-center shrink-0">
                    {act.type === 'income' ? (
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <TrendingDown className="w-3.5 h-3.5 text-rose-600" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <span className="font-semibold text-[#111111] block truncate">{act.title}</span>
                    <span className="text-[11px] text-neutral-400 block truncate">{act.category} · {formatHumanDate(act.date)}</span>
                  </div>
                </div>
                <span className={`font-mono font-bold tabular-nums shrink-0 ml-2 ${
                  act.type === 'income' ? 'text-emerald-600' : 'text-[#111111]'
                }`}>
                  {act.type === 'income' ? '+' : ''}{formatCurrency(act.amount, data.settings.currency)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
