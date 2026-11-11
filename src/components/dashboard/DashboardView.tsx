import React, { useState } from 'react';
import { 
  Wallet, 
  TrendingUp, 
  TrendingDown, 
  PiggyBank, 
  Target, 
  CalendarCheck, 
  Plus, 
  ArrowUpRight, 
  ArrowDownRight, 
  SlidersHorizontal,
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff,
  Check
} from 'lucide-react';
import { useXOSData } from '../../hooks/useXOSData';
import { DateRangeFilter } from '../../types';
import { calculateAttendanceStats, calculateEstimatedSalary, calculateFinancialTotals, calculateMonthlySalarySummary, calculateDebtSummary, filterRecordsByDateRange } from '../../utils/calculations';
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
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);

  // Filter financial data by header date range
  const filteredIncomes = filterRecordsByDateRange(data.incomes, dateFilter.preset, dateFilter.startDate, dateFilter.endDate);
  const filteredExpenses = filterRecordsByDateRange(data.expenses, dateFilter.preset, dateFilter.startDate, dateFilter.endDate);
  
  const financialTotals = calculateFinancialTotals(filteredIncomes, filteredExpenses, data.savingsGoals, data.savingsTransactions);
  const globalTotals = calculateFinancialTotals(data.incomes, data.expenses, data.savingsGoals, data.savingsTransactions);

  const currentMonthStr = getMonthString();
  const attendanceStats = calculateAttendanceStats(data.attendance, currentMonthStr);
  const monthlySalarySummary = calculateMonthlySalarySummary(data.attendance, data.salaryPayouts, data.settings.salaryConfig, currentMonthStr);
  const debtSummary = calculateDebtSummary(data.debts, data.debtRepayments);

  const activeGoals = data.goals.filter(g => g.status === 'In Progress' || g.status === 'Not Started');
  const recentExpenses = [...data.expenses].sort((a, b) => (b.date > a.date ? 1 : -1)).slice(0, 5);
  const recentIncomes = [...data.incomes].sort((a, b) => (b.date > a.date ? 1 : -1)).slice(0, 5);

  const recentActivity = [
    ...recentExpenses.map(e => ({ id: e.id, title: e.title, amount: -e.amount, date: e.date, type: 'expense' as const, category: e.category })),
    ...recentIncomes.map(i => ({ id: i.id, title: i.title, amount: i.amount, date: i.date, type: 'income' as const, category: i.source }))
  ].sort((a, b) => (b.date > a.date ? 1 : -1)).slice(0, 6);

  const sortedWidgets = [...data.settings.widgets].sort((a, b) => a.order - b.order);

  const handleToggleWidget = (id: string) => {
    const updated = data.settings.widgets.map(w => w.id === id ? { ...w, visible: !w.visible } : w);
    data.saveSettings({ ...data.settings, widgets: updated });
  };

  const handleMoveWidget = (index: number, direction: 'up' | 'down') => {
    const widgets = [...sortedWidgets];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= widgets.length) return;

    const tempOrder = widgets[index].order;
    widgets[index].order = widgets[targetIdx].order;
    widgets[targetIdx].order = tempOrder;

    data.saveSettings({ ...data.settings, widgets });
  };

  const displayName = data.settings.profile.name.trim();

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-black/[0.06]">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-[#111111] tracking-tight">
            {displayName ? `Welcome, ${displayName}` : 'Personal Life Dashboard'}
          </h2>
          <p className="text-xs sm:text-sm text-neutral-500 font-normal mt-0.5">
            {data.settings.profile.tagline || 'Your personal command center for goals, work, and finances.'}
          </p>
        </div>

        <button
          onClick={() => setIsCustomizeOpen(!isCustomizeOpen)}
          type="button"
          className="self-start sm:self-auto flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200/80 rounded-xl transition-colors cursor-pointer border border-neutral-200/60"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-neutral-500" />
          <span>{isCustomizeOpen ? 'Close Customizer' : 'Customize Widgets'}</span>
        </button>
      </div>

      {/* Widget Layout Customizer */}
      {isCustomizeOpen && (
        <div className="p-4 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-3 animate-in fade-in duration-150">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#111111] uppercase tracking-wider">
              Dashboard Widgets Order & Visibility
            </span>
            <button
              onClick={() => setIsCustomizeOpen(false)}
              className="text-xs text-neutral-500 hover:text-black font-medium cursor-pointer"
            >
              Done
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {sortedWidgets.map((widget, idx) => (
              <div key={widget.id} className="flex items-center justify-between p-2.5 bg-white rounded-xl border border-neutral-200 text-xs">
                <span className="font-medium text-neutral-800 truncate mr-2">{widget.name}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleMoveWidget(idx, 'up')}
                    disabled={idx === 0}
                    className="p-1 text-neutral-400 hover:text-black disabled:opacity-20 cursor-pointer"
                    aria-label="Move widget up"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleMoveWidget(idx, 'down')}
                    disabled={idx === sortedWidgets.length - 1}
                    className="p-1 text-neutral-400 hover:text-black disabled:opacity-20 cursor-pointer"
                    aria-label="Move widget down"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleToggleWidget(widget.id)}
                    className={`p-1 rounded-md cursor-pointer transition-colors ${
                      widget.visible ? 'text-[#111111] bg-neutral-100' : 'text-neutral-400 hover:bg-neutral-100'
                    }`}
                    aria-label={widget.visible ? 'Hide widget' : 'Show widget'}
                  >
                    {widget.visible ? <Eye className="w-3.5 h-3.5 text-[#87CEEB]" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Render Dynamic Widgets */}
      <div className="space-y-6">
        {sortedWidgets.filter(w => w.visible).map((widget) => {
          switch (widget.id) {
            case 'balance_overview':
              return (
                <div key={widget.id} className="grid grid-cols-1 lg:grid-cols-4 gap-3 sm:gap-4">
                  {/* Card 1: Prominent Dark Summary Panel (Left Column) */}
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

                    <div className="space-y-2">
                      <button
                        onClick={() => onOpenQuickAction('expense')}
                        type="button"
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-[#87CEEB] text-[#111111] text-xs font-bold rounded-xl hover:bg-[#70c2e3] transition-colors cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5 text-[#111111]" />
                        <span>+ Log New Expense</span>
                      </button>
                    </div>
                  </div>

                  {/* Right Column: 4 Key Metric Cards Grid */}
                  <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                    {/* Card 2: Period Income */}
                    <div className="p-5 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-3 shadow-xs">
                      <div className="flex items-center justify-between text-neutral-500">
                        <span className="text-[11px] font-semibold uppercase tracking-wider">
                          Income
                        </span>
                        <ArrowUpRight className="w-4 h-4 text-emerald-600" />
                      </div>
                      <div>
                        <div className="text-2xl font-bold font-mono text-emerald-600 tabular-nums">
                          {formatCurrency(financialTotals.totalIncome, data.settings.currency)}
                        </div>
                        <p className="text-[11px] text-neutral-500 font-normal mt-1">
                          {filteredIncomes.length} revenue entries
                        </p>
                      </div>
                    </div>

                    {/* Card 3: Period Expense */}
                    <div className="p-5 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-3 shadow-xs">
                      <div className="flex items-center justify-between text-neutral-500">
                        <span className="text-[11px] font-semibold uppercase tracking-wider">
                          Expenses
                        </span>
                        <ArrowDownRight className="w-4 h-4 text-[#111111]" />
                      </div>
                      <div>
                        <div className="text-2xl font-bold font-mono text-[#111111] tabular-nums">
                          {formatCurrency(financialTotals.totalExpenses, data.settings.currency)}
                        </div>
                        <p className="text-[11px] text-neutral-500 font-normal mt-1">
                          {filteredExpenses.length} transactions
                        </p>
                      </div>
                    </div>

                    {/* Card 4: Remaining Salary Due */}
                    <div className="p-5 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-3 shadow-xs">
                      <div className="flex items-center justify-between text-neutral-500">
                        <span className="text-[11px] font-semibold uppercase tracking-wider">Remaining Salary</span>
                        <TrendingUp className="w-4 h-4 text-sky-600" />
                      </div>
                      <div>
                        <div className="text-2xl font-bold font-mono text-[#111111] tabular-nums">
                          {formatCurrency(monthlySalarySummary.remainingSalary, data.settings.currency)}
                        </div>
                        <p className="text-[11px] text-neutral-500 font-normal mt-1">
                          Earned: {formatCurrency(monthlySalarySummary.earnedSalary, data.settings.currency)}
                        </p>
                      </div>
                    </div>

                    {/* Card 5: Money Owed to Me */}
                    <div className="p-5 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-3 shadow-xs">
                      <div className="flex items-center justify-between text-neutral-500">
                        <span className="text-[11px] font-semibold uppercase tracking-wider">Owed to Me</span>
                        <ArrowUpRight className="w-4 h-4 text-[#87CEEB]" />
                      </div>
                      <div>
                        <div className="text-2xl font-bold font-mono text-[#111111] tabular-nums">
                          {formatCurrency(debtSummary.outstandingReceivable, data.settings.currency)}
                        </div>
                        <p className="text-[11px] text-neutral-400 font-normal mt-1">
                          Lent receivables
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );

            case 'work_attendance':
              return (
                <div key={widget.id} className="p-5 sm:p-6 rounded-2xl bg-white border border-black/[0.08] space-y-4 shadow-xs">
                  <div className="flex items-center justify-between border-b border-black/[0.06] pb-3">
                    <div className="flex items-center gap-2">
                      <CalendarCheck className="w-5 h-5 text-[#87CEEB]" />
                      <h3 className="font-bold text-sm text-[#111111]">Work & Monthly Salary Overview</h3>
                    </div>
                    <button
                      onClick={() => onNavigateTab('attendance')}
                      className="text-xs font-semibold text-neutral-700 hover:text-black transition-colors cursor-pointer"
                    >
                      Calendar →
                    </button>
                  </div>

                  {attendanceStats.totalRecorded === 0 && data.settings.salaryConfig.baseAmount === 0 ? (
                    <div className="py-6 text-center space-y-2">
                      <p className="text-xs sm:text-sm text-neutral-500">
                        No attendance recorded yet for this month.
                      </p>
                      <button
                        onClick={() => onOpenQuickAction('attendance')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#111111] text-white text-xs font-medium hover:bg-black transition-colors cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5 text-[#87CEEB]" />
                        <span>Log Today's Work</span>
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {/* Attendance Stats */}
                      <div className="p-4 rounded-xl bg-neutral-50 space-y-1.5 border border-neutral-100">
                        <span className="text-[11px] font-semibold text-neutral-500 uppercase">Days Worked</span>
                        <div className="text-2xl font-bold font-mono text-[#111111] tabular-nums">
                          {attendanceStats.presentDays}
                        </div>
                        <div className="text-xs text-neutral-500 pt-1 border-t border-neutral-200">
                          {attendanceStats.leaveDays} Leave · {attendanceStats.absentDays} Absent
                        </div>
                      </div>

                      {/* Total Hours */}
                      <div className="p-4 rounded-xl bg-neutral-50 space-y-1.5 border border-neutral-100">
                        <span className="text-[11px] font-semibold text-neutral-500 uppercase">Hours Logged</span>
                        <div className="text-2xl font-bold font-mono text-[#111111] tabular-nums">
                          {attendanceStats.totalHours}h
                        </div>
                        <p className="text-xs text-neutral-500 pt-1 border-t border-neutral-200 truncate">
                          Type: {(data.settings.salaryConfig.salaryType || 'daily_wage').replace('_', ' ')}
                        </p>
                      </div>

                      {/* Estimated Salary */}
                      <div className="p-4 rounded-xl bg-neutral-50 space-y-1.5 border border-neutral-100">
                        <span className="text-[11px] font-semibold text-neutral-500 uppercase">Earned Salary ({currentMonthStr})</span>
                        <div className="text-2xl font-bold font-mono text-[#111111] tabular-nums">
                          {formatCurrency(monthlySalarySummary.earnedSalary, data.settings.currency)}
                        </div>
                        <div className="flex items-center justify-between text-xs text-neutral-500 pt-1 border-t border-neutral-200">
                          <span>Received: {formatCurrency(monthlySalarySummary.salaryReceived, data.settings.currency)}</span>
                          <button
                            onClick={() => onNavigateTab('salary')}
                            className="font-semibold text-neutral-900 underline hover:text-black cursor-pointer"
                          >
                            Salary →
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );

            case 'active_goals':
              return (
                <div key={widget.id} className="p-5 sm:p-6 rounded-2xl bg-white border border-black/[0.08] space-y-4 shadow-xs">
                  <div className="flex items-center justify-between border-b border-black/[0.06] pb-3">
                    <div className="flex items-center gap-2">
                      <Target className="w-5 h-5 text-[#87CEEB]" />
                      <h3 className="font-bold text-sm text-[#111111]">Active Goals & Dreams ({activeGoals.length})</h3>
                    </div>
                    <button
                      onClick={() => onNavigateTab('goals')}
                      className="text-xs font-semibold text-neutral-700 hover:text-black transition-colors cursor-pointer"
                    >
                      View All →
                    </button>
                  </div>

                  {activeGoals.length === 0 ? (
                    <EmptyState
                      icon={Target}
                      title="No goals or dreams yet"
                      description="Define your first personal ambition, financial target, or bucket list item."
                      actionLabel="Create First Goal"
                      onAction={() => onOpenQuickAction('goal')}
                      className="border-dashed"
                    />
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {activeGoals.slice(0, 4).map((goal) => {
                        const hasAmount = goal.targetAmount && goal.targetAmount > 0;
                        const progressPct = hasAmount
                          ? Math.min(100, Math.round(((goal.currentAmount || 0) / goal.targetAmount!) * 100))
                          : 0;

                        return (
                          <div key={goal.id} className="p-4 rounded-xl border border-black/[0.06] bg-neutral-50/60 space-y-2.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 block">
                                  {goal.type === 'dream' ? 'Dream' : 'Goal'} · {goal.category}
                                </span>
                                <h4 className="font-bold text-sm text-[#111111] truncate">{goal.title}</h4>
                              </div>
                              <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-md bg-white border border-neutral-200 text-neutral-700 shrink-0">
                                {goal.priority}
                              </span>
                            </div>

                            {hasAmount ? (
                              <div className="space-y-1">
                                <div className="flex justify-between text-xs text-neutral-600 font-mono tabular-nums">
                                  <span>{formatCurrency(goal.currentAmount || 0, data.settings.currency)}</span>
                                  <span>{progressPct}%</span>
                                </div>
                                <div className="w-full h-1.5 bg-neutral-200 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-[#87CEEB] transition-all duration-300"
                                    style={{ width: `${progressPct}%` }}
                                  />
                                </div>
                              </div>
                            ) : (
                              <p className="text-xs text-neutral-500 line-clamp-1">
                                {goal.description || (goal.targetDate ? `Target: ${formatHumanDate(goal.targetDate)}` : 'Open deadline')}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );

            case 'recent_activity':
              return (
                <div key={widget.id} className="p-5 sm:p-6 rounded-2xl bg-white border border-black/[0.08] space-y-4 shadow-xs">
                  <div className="flex items-center justify-between border-b border-black/[0.06] pb-3">
                    <h3 className="font-bold text-sm text-[#111111]">Recent Activity</h3>
                    <div className="flex items-center gap-3 text-xs">
                      <button onClick={() => onNavigateTab('expenses')} className="text-neutral-600 hover:text-black font-medium cursor-pointer">Expenses</button>
                      <span className="text-neutral-300" aria-hidden="true">·</span>
                      <button onClick={() => onNavigateTab('income')} className="text-neutral-600 hover:text-black font-medium cursor-pointer">Income</button>
                    </div>
                  </div>

                  {recentActivity.length === 0 ? (
                    <div className="py-8 text-center text-xs text-neutral-400">
                      No transactions recorded yet.
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
              );

            case 'quick_actions':
              return (
                <div key={widget.id} className="p-5 sm:p-6 rounded-2xl bg-[#111111] text-white space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-neutral-300">Quick Actions</span>
                    <span className="text-[11px] text-neutral-400">Instant activity logging</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <button
                      onClick={() => onOpenQuickAction('expense')}
                      type="button"
                      className="p-3.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 transition-colors text-left space-y-1.5 cursor-pointer border border-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                    >
                      <Plus className="w-4 h-4 text-[#87CEEB]" />
                      <span className="text-xs font-semibold block text-white">Log Expense</span>
                    </button>
                    <button
                      onClick={() => onOpenQuickAction('income')}
                      type="button"
                      className="p-3.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 transition-colors text-left space-y-1.5 cursor-pointer border border-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                    >
                      <Plus className="w-4 h-4 text-[#87CEEB]" />
                      <span className="text-xs font-semibold block text-white">Log Income</span>
                    </button>
                    <button
                      onClick={() => onOpenQuickAction('attendance')}
                      type="button"
                      className="p-3.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 transition-colors text-left space-y-1.5 cursor-pointer border border-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                    >
                      <Plus className="w-4 h-4 text-[#87CEEB]" />
                      <span className="text-xs font-semibold block text-white">Mark Attendance</span>
                    </button>
                    <button
                      onClick={() => onOpenQuickAction('savings')}
                      type="button"
                      className="p-3.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 transition-colors text-left space-y-1.5 cursor-pointer border border-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                    >
                      <Plus className="w-4 h-4 text-[#87CEEB]" />
                      <span className="text-xs font-semibold block text-white">Deposit Savings</span>
                    </button>
                  </div>
                </div>
              );

            default:
              return null;
          }
        })}
      </div>
    </div>
  );
};
