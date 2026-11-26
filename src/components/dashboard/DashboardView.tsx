import React, { useMemo } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Target,
  CalendarCheck,
  Plus
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
import { XOSModuleIcon } from '../icons/XOSIcons';
import {
  MetricCard,
  PageHeader,
  SectionCard,
  SUBTLE_BUTTON_CLASS
} from '../ui';

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

  const filteredIncomes = useMemo(
    () => filterRecordsByDateRange(data.incomes, dateFilter.preset, dateFilter.startDate, dateFilter.endDate),
    [data.incomes, dateFilter.preset, dateFilter.startDate, dateFilter.endDate]
  );

  const filteredExpenses = useMemo(
    () => filterRecordsByDateRange(data.expenses, dateFilter.preset, dateFilter.startDate, dateFilter.endDate),
    [data.expenses, dateFilter.preset, dateFilter.startDate, dateFilter.endDate]
  );

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

  const financialTotals = useMemo(
    () => calculateFinancialTotals(filteredIncomes, filteredExpenses, activeSavingsGoals, data.savingsTransactions),
    [filteredIncomes, filteredExpenses, activeSavingsGoals, data.savingsTransactions]
  );

  const globalTotals = useMemo(
    () => calculateFinancialTotals(data.incomes, data.expenses, activeSavingsGoals, data.savingsTransactions),
    [data.incomes, data.expenses, activeSavingsGoals, data.savingsTransactions]
  );

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

  const activeGoalItems = useMemo(
    () => resolveGoalsWithSavings(data.goals, data.savingsGoals).filter(item => item.isActive),
    [data.goals, data.savingsGoals]
  );

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
  const salaryUnset =
    !salaryConfigured &&
    monthlySalarySummary.earnedSalary === 0 &&
    monthlySalarySummary.salaryReceived === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={displayName ? `Welcome, ${displayName}` : 'Overview'}
        description="Your finances, daily work schedule, and savings goals in one place."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onOpenQuickAction('expense')}
              type="button"
              className={SUBTLE_BUTTON_CLASS}
            >
              <Plus className="w-3.5 h-3.5 text-[#6e6e73]" />
              <span>Expense</span>
            </button>
            <button
              onClick={() => onOpenQuickAction('income')}
              type="button"
              className={SUBTLE_BUTTON_CLASS}
            >
              <Plus className="w-3.5 h-3.5 text-[#1f7a4c]" />
              <span>Income</span>
            </button>
            <button
              onClick={() => onOpenQuickAction('attendance')}
              type="button"
              className={SUBTLE_BUTTON_CLASS}
            >
              <CalendarCheck className="w-3.5 h-3.5 text-[#0071e3]" />
              <span>Attendance</span>
            </button>
          </div>
        }
      />

      {/* Architectural Financial Stage */}
      <section aria-label="Financial Overview" className="rounded-3xl bg-[#f5f5f7] p-4 sm:p-5">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
          {/* Focal Liquid Balance Anchor */}
          <div className="lg:col-span-4 rounded-2xl bg-white border border-black/[0.06] p-5 sm:p-6 flex flex-col justify-between gap-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#6e6e73]">Available Money</span>
              <span className="text-[#0071e3]">
                <XOSModuleIcon name="dashboard" isActive size={16} />
              </span>
            </div>
            <div>
              <div className="text-[28px] sm:text-[32px] font-semibold font-mono tabular-nums tracking-[-0.03em] text-[#1d1d1f] leading-tight">
                {formatCurrency(globalTotals.availableBalance, data.settings.currency)}
              </div>
              <p className="mt-1.5 text-xs text-[#86868b]">Total liquid cash balance across accounts</p>
            </div>
          </div>

          {/* Unified 4-Cell Financial Ledger Rail */}
          <div className="lg:col-span-8 rounded-2xl bg-white border border-black/[0.06] grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:grid-rows-2 overflow-hidden">
            <div className="p-5 sm:border-b sm:border-r border-black/[0.06] flex flex-col justify-between gap-1.5">
              <span className="text-xs font-medium text-[#6e6e73]">Income Summary</span>
              <div className="text-[22px] font-semibold font-mono tabular-nums tracking-[-0.02em] text-[#1f7a4c]">
                {formatCurrency(financialTotals.totalIncome, data.settings.currency)}
              </div>
              <span className="text-xs text-[#86868b]">
                {filteredIncomes.length} {filteredIncomes.length === 1 ? 'entry' : 'entries'} · {periodLabel}
              </span>
            </div>

            <div className="p-5 sm:border-b border-black/[0.06] flex flex-col justify-between gap-1.5">
              <span className="text-xs font-medium text-[#6e6e73]">Expense Summary</span>
              <div className="text-[22px] font-semibold font-mono tabular-nums tracking-[-0.02em] text-[#1d1d1f]">
                {formatCurrency(financialTotals.totalExpenses, data.settings.currency)}
              </div>
              <span className="text-xs text-[#86868b]">
                {filteredExpenses.length} {filteredExpenses.length === 1 ? 'transaction' : 'transactions'} · {periodLabel}
              </span>
            </div>

            <div className="p-5 sm:border-r border-black/[0.06] flex flex-col justify-between gap-1.5">
              <span className="text-xs font-medium text-[#6e6e73]">Remaining Salary</span>
              <div className="text-[22px] font-semibold font-mono tabular-nums tracking-[-0.02em] text-[#1d1d1f]">
                {salaryUnset ? (
                  <span className="text-base font-medium text-[#6e6e73] font-sans">Not configured</span>
                ) : (
                  formatCurrency(monthlySalarySummary.remainingSalary, data.settings.currency)
                )}
              </div>
              <div className="text-xs text-[#86868b]">
                {salaryUnset ? (
                  <button
                    type="button"
                    onClick={() => onNavigateTab('salary')}
                    className="text-[#0071e3] hover:text-[#0077ed] hover:underline font-medium cursor-pointer"
                  >
                    Set daily base &amp; hours →
                  </button>
                ) : (
                  <span className="font-mono tabular-nums">
                    Earned: {formatCurrency(monthlySalarySummary.earnedSalary, data.settings.currency)}
                  </span>
                )}
              </div>
            </div>

            <div className="p-5 flex flex-col justify-between gap-1.5">
              <span className="text-xs font-medium text-[#6e6e73]">Money Owed to Me</span>
              <div className="text-[22px] font-semibold font-mono tabular-nums tracking-[-0.02em] text-[#0071e3]">
                {formatCurrency(debtSummary.outstandingReceivable, data.settings.currency)}
              </div>
              <span className="text-xs text-[#86868b] font-mono tabular-nums">
                To pay: {formatCurrency(totalToPay, data.settings.currency)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Work & Monthly Salary Overview */}
      <SectionCard
        title="Work & Monthly Salary"
        subtitle={`Summary for ${currentMonthStr}`}
        action={
          <button
            onClick={() => onNavigateTab('attendance')}
            type="button"
            className="text-xs font-medium text-[#0071e3] hover:text-[#0077ed] hover:underline cursor-pointer"
          >
            Calendar →
          </button>
        }
      >
        {attendanceStats.totalRecorded === 0 ? (
          <div className="py-6 text-center space-y-3">
            <p className="text-sm text-[#6e6e73]">
              No attendance recorded yet for this month.
            </p>
            <button
              onClick={() => onOpenQuickAction('attendance')}
              type="button"
              className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 rounded-full bg-[#1d1d1f] text-white text-xs font-medium hover:bg-black transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Log Today&apos;s Work</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <MetricCard
              variant="subtle"
              label="Days Worked"
              value={attendanceStats.presentDays}
              sublabel={`${attendanceStats.leaveDays} Leave · ${attendanceStats.absentDays} Absent`}
            />

            <MetricCard
              variant="subtle"
              label="Hours Logged"
              value={`${attendanceStats.totalHours}h`}
              sublabel={
                salaryConfigured
                  ? `Base ${formatCurrency(data.settings.salaryConfig.dailyBaseSalary ?? 0, data.settings.currency)} · ${data.settings.salaryConfig.standardWorkingHours}h/day`
                  : 'Salary & working hours not configured'
              }
            />

            <MetricCard
              variant="subtle"
              label={`Earned Salary (${currentMonthStr})`}
              value={formatCurrency(monthlySalarySummary.earnedSalary, data.settings.currency)}
              sublabel={
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono tabular-nums">
                    Received: {formatCurrency(monthlySalarySummary.salaryReceived, data.settings.currency)}
                  </span>
                  <button
                    onClick={() => onNavigateTab('salary')}
                    type="button"
                    className="font-medium text-[#0071e3] hover:text-[#0077ed] hover:underline cursor-pointer shrink-0"
                  >
                    Salary →
                  </button>
                </div>
              }
            />
          </div>
        )}
      </SectionCard>

      {/* Goals & Recent Activity Two-Column Split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <SectionCard
          title={`Active Goals (${activeGoalItems.length})`}
          action={
            <button
              onClick={() => onNavigateTab('goals')}
              type="button"
              className="text-xs font-medium text-[#0071e3] hover:text-[#0077ed] hover:underline cursor-pointer"
            >
              View All →
            </button>
          }
        >
          {activeGoalItems.length === 0 ? (
            <EmptyState
              icon={Target}
              iconName="goals"
              title="No active goals yet"
              description="Define a personal ambition or financial target to start tracking your progress."
              actionLabel="Create First Goal"
              onAction={() => onOpenQuickAction('goal')}
            />
          ) : (
            <div className="divide-y divide-black/[0.06] -my-2">
              {activeGoalItems.slice(0, 4).map((item) => {
                const { goal, savedAmount, targetAmount, progressPercentage } = item;
                const hasAmount = targetAmount > 0;

                return (
                  <button
                    key={goal.id}
                    type="button"
                    onClick={() => onNavigateTab('goals')}
                    className="w-full py-3.5 text-left space-y-2 hover:opacity-80 transition-opacity cursor-pointer block"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="font-medium text-sm text-[#1d1d1f] truncate">{goal.title}</h4>
                        <span className="text-xs text-[#6e6e73] block mt-0.5">
                          {goal.category} · {goal.priority} priority
                        </span>
                      </div>
                      <span className="text-xs font-mono font-semibold text-[#1d1d1f] tabular-nums shrink-0">
                        {progressPercentage}%
                      </span>
                    </div>

                    <div className="w-full h-1.5 bg-black/[0.06] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#0071e3] rounded-full transition-all duration-300"
                        style={{ width: `${progressPercentage}%` }}
                      />
                    </div>

                    <div className="text-xs text-[#6e6e73] font-mono tabular-nums">
                      {hasAmount
                        ? `${formatCurrency(savedAmount, data.settings.currency)} / ${formatCurrency(targetAmount, data.settings.currency)}`
                        : (goal.targetDate ? formatHumanDate(goal.targetDate) : 'In progress')}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Recent Activity"
          action={
            <div className="flex items-center gap-2 text-xs">
              <button
                onClick={() => onNavigateTab('expenses')}
                type="button"
                className="text-[#6e6e73] hover:text-[#1d1d1f] font-medium cursor-pointer"
              >
                Expenses
              </button>
              <span className="text-black/20" aria-hidden="true">·</span>
              <button
                onClick={() => onNavigateTab('income')}
                type="button"
                className="text-[#6e6e73] hover:text-[#1d1d1f] font-medium cursor-pointer"
              >
                Income
              </button>
            </div>
          }
        >
          {recentActivity.length === 0 ? (
            <div className="py-10 text-center text-sm text-[#86868b]">
              No recent activity recorded yet.
            </div>
          ) : (
            <div className="divide-y divide-black/[0.06] -my-2">
              {recentActivity.map((act) => (
                <div key={act.id} className="py-3 flex items-center justify-between gap-3 text-sm">
                  <div className="flex items-center gap-3 min-w-0">
                    {act.type === 'income' ? (
                      <TrendingUp className="w-4 h-4 text-[#1f7a4c] shrink-0" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-[#86868b] shrink-0" />
                    )}
                    <div className="min-w-0">
                      <span className="font-medium text-[#1d1d1f] block truncate">{act.title}</span>
                      <span className="text-xs text-[#6e6e73] block truncate">
                        {act.category} · {formatHumanDate(act.date)}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`font-mono font-semibold text-[13px] tabular-nums shrink-0 ${
                      act.type === 'income' ? 'text-[#1f7a4c]' : 'text-[#1d1d1f]'
                    }`}
                  >
                    {act.type === 'income' ? '+' : ''}
                    {formatCurrency(act.amount, data.settings.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
};
