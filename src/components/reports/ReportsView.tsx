import React, { useState, useMemo, lazy, Suspense } from 'react';
import { BarChart3, FileText } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { useXOSData } from '../../hooks/useXOSData';
import { DateFilterPreset } from '../../types';
import {
  calculateAttendanceStatsForRecords,
  calculateDebtSummary,
  calculateSeparateDebtTotals,
  calculateFinancialTotals,
  calculatePeriodSalarySummary,
  filterRecordsByDateRange,
  isSalaryConfigured
} from '../../utils/calculations';
import { formatCurrency, getMonthString } from '../../utils/formatters';
import { EmptyState } from '../common/EmptyState';
import {
  INPUT_CLASS,
  MetricCard,
  PRIMARY_BUTTON_CLASS,
  PageHeader,
  SectionCard,
  SegmentedControl
} from '../ui';

const PDFExportModal = lazy(() =>
  import('../modals/PDFExportModal').then(m => ({ default: m.PDFExportModal }))
);

const PERIOD_OPTIONS = [
  { id: 'today' as const, label: 'Today' },
  { id: 'this_month' as const, label: 'This Month' },
  { id: 'last_month' as const, label: 'Last Month' },
  { id: 'this_year' as const, label: 'This Year' },
  { id: 'custom' as const, label: 'Custom' }
];

export const ReportsView: React.FC = () => {
  const data = useXOSData();

  const [periodPreset, setPeriodPreset] = useState<DateFilterPreset>('this_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const [isPDFModalOpen, setIsPDFModalOpen] = useState(false);
  const [hasOpenedPDFModal, setHasOpenedPDFModal] = useState(false);

  const openPDFModal = () => {
    setHasOpenedPDFModal(true);
    setIsPDFModalOpen(true);
  };

  const filteredIncomes = useMemo(
    () => filterRecordsByDateRange(data.incomes, periodPreset, customStart, customEnd),
    [data.incomes, periodPreset, customStart, customEnd]
  );

  const filteredExpenses = useMemo(
    () => filterRecordsByDateRange(data.expenses, periodPreset, customStart, customEnd),
    [data.expenses, periodPreset, customStart, customEnd]
  );

  const filteredAttendance = useMemo(
    () => filterRecordsByDateRange(data.attendance, periodPreset, customStart, customEnd),
    [data.attendance, periodPreset, customStart, customEnd]
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

  const totals = useMemo(
    () => calculateFinancialTotals(filteredIncomes, filteredExpenses, activeSavingsGoals, data.savingsTransactions),
    [filteredIncomes, filteredExpenses, activeSavingsGoals, data.savingsTransactions]
  );

  const currentMonth = getMonthString();

  const attStats = useMemo(
    () => calculateAttendanceStatsForRecords(filteredAttendance, data.settings.salaryConfig.standardWorkingHours),
    [filteredAttendance, data.settings.salaryConfig.standardWorkingHours]
  );

  const periodSalary = useMemo(
    () =>
      calculatePeriodSalarySummary(
        data.attendance,
        data.salaryPayouts,
        data.settings.salaryConfig,
        periodPreset,
        customStart,
        customEnd
      ),
    [data.attendance, data.salaryPayouts, data.settings.salaryConfig, periodPreset, customStart, customEnd]
  );

  const debtSummary = useMemo(
    () => calculateDebtSummary(data.debts, data.debtRepayments),
    [data.debts, data.debtRepayments]
  );

  const { totalToPay } = useMemo(
    () => calculateSeparateDebtTotals(data.debts, data.debtRepayments),
    [data.debts, data.debtRepayments]
  );

  const cashFlowTimelineData = useMemo(() => {
    const dateMap: Record<string, { date: string; income: number; expense: number }> = {};

    filteredIncomes.forEach(i => {
      if (!dateMap[i.date]) dateMap[i.date] = { date: i.date, income: 0, expense: 0 };
      dateMap[i.date].income += i.amount;
    });

    filteredExpenses.forEach(e => {
      if (!dateMap[e.date]) dateMap[e.date] = { date: e.date, income: 0, expense: 0 };
      dateMap[e.date].expense += e.amount;
    });

    return Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredIncomes, filteredExpenses]);

  const categoryData = useMemo(() => {
    const catMap: Record<string, number> = {};
    filteredExpenses.forEach(e => {
      catMap[e.category] = (catMap[e.category] || 0) + e.amount;
    });

    return Object.entries(catMap)
      .map(([name, value]) => ({
        name,
        amount: Number(value.toFixed(2))
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [filteredExpenses]);

  const attendancePieData = useMemo(
    () =>
      [
        { name: 'Present', count: attStats.presentDays, fill: '#0284c7' },
        { name: 'Absent', count: attStats.absentDays, fill: '#6e6e73' },
        { name: 'Leave', count: attStats.leaveDays, fill: '#a1a1aa' },
        { name: 'Holiday', count: attStats.holidayDays, fill: '#1d1d1f' }
      ].filter(d => d.count > 0),
    [attStats.presentDays, attStats.absentDays, attStats.leaveDays, attStats.holidayDays]
  );

  const hasData = data.incomes.length > 0 || data.expenses.length > 0 || data.attendance.length > 0;
  const salaryConfigured = isSalaryConfigured(data.settings.salaryConfig);

  const tooltipStyle = {
    backgroundColor: '#ffffff',
    color: '#1d1d1f',
    borderRadius: '12px',
    fontSize: '12px',
    border: '1px solid rgba(0,0,0,0.08)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.08)'
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics & Reports"
        description="Monitor cash flow dynamics, expense allocations, and attendance breakdown."
        actions={
          <button
            onClick={openPDFModal}
            type="button"
            className={PRIMARY_BUTTON_CLASS}
          >
            <FileText className="w-4 h-4" />
            <span>Export PDF Report</span>
          </button>
        }
      />

      {!hasData ? (
        <EmptyState
          icon={BarChart3}
          title="Add records to see your financial reports"
          description="Log income, track expenses, or mark attendance to generate detailed cash flow analytics and visual breakdown charts."
        />
      ) : (
        <>
          {/* Date Range Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <SegmentedControl
              options={PERIOD_OPTIONS}
              value={periodPreset}
              onChange={(val) => setPeriodPreset(val)}
              ariaLabel="Select report period"
            />

            {periodPreset === 'custom' && (
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  aria-label="Custom start date"
                  className={`${INPUT_CLASS} sm:w-40`}
                />
                <span className="text-xs text-[#6e6e73] shrink-0">to</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  aria-label="Custom end date"
                  className={`${INPUT_CLASS} sm:w-40`}
                />
              </div>
            )}
          </div>

          {/* KPI Overview */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 sm:gap-4">
            <MetricCard
              variant="focal"
              label="Net Cash Flow"
              tone={totals.netCashFlow >= 0 ? 'default' : 'negative'}
              value={formatCurrency(totals.netCashFlow, data.settings.currency)}
              sublabel="Period Income minus Expense"
            />

            <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              <MetricCard
                label="Period Revenue"
                tone="positive"
                value={formatCurrency(totals.totalIncome, data.settings.currency)}
                sublabel={`${filteredIncomes.length} ${filteredIncomes.length === 1 ? 'entry' : 'entries'} logged`}
              />

              <MetricCard
                label="Period Expenses"
                value={formatCurrency(totals.totalExpenses, data.settings.currency)}
                sublabel={`${filteredExpenses.length} ${filteredExpenses.length === 1 ? 'transaction' : 'transactions'}`}
              />

              <MetricCard
                label="Total Reserves"
                value={formatCurrency(totals.currentSavingsBalance, data.settings.currency)}
                sublabel={`Across ${activeSavingsGoals.length} funds`}
              />

              <MetricCard
                label="Remaining Salary"
                value={
                  !salaryConfigured && periodSalary.earnedSalary === 0 && periodSalary.salaryReceived === 0 ? (
                    <span className="text-lg font-medium text-[#6e6e73] font-sans">Not configured</span>
                  ) : (
                    formatCurrency(periodSalary.remainingSalary, data.settings.currency)
                  )
                }
                sublabel={
                  !salaryConfigured && periodSalary.earnedSalary === 0 && periodSalary.salaryReceived === 0
                    ? 'Configure in Salary Settings'
                    : `Earned: ${formatCurrency(periodSalary.earnedSalary, data.settings.currency)}`
                }
              />

              <MetricCard
                label="Money Owed to Me"
                value={formatCurrency(debtSummary.outstandingReceivable, data.settings.currency)}
                sublabel="Outstanding receivables"
              />

              <MetricCard
                label="Money to Pay"
                value={formatCurrency(totalToPay, data.settings.currency)}
                sublabel="Outstanding payables"
              />
            </div>
          </div>

          {/* Cash Flow Timeline */}
          <SectionCard
            title="Income vs Expense Timeline"
            subtitle="Net cash flow across the selected period"
          >
            {cashFlowTimelineData.length === 0 ? (
              <div className="h-60 flex items-center justify-center text-xs text-[#86868b]">
                No activity records exist for the selected date range.
              </div>
            ) : (
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={cashFlowTimelineData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6e6e73' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#6e6e73' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={(val: any) => [formatCurrency(Number(val || 0), data.settings.currency)]}
                      contentStyle={tooltipStyle}
                    />
                    <Area type="monotone" dataKey="income" stroke="#0284c7" fill="#0284c7" fillOpacity={0.18} name="Income" />
                    <Area type="monotone" dataKey="expense" stroke="#1d1d1f" fill="#1d1d1f" fillOpacity={0.08} name="Expense" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </SectionCard>

          {/* Dual Column Analytics */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SectionCard title="Expense Category Breakdown">
              {categoryData.length === 0 ? (
                <div className="h-44 flex items-center justify-center text-xs text-[#86868b]">
                  No categorized expenses recorded in this period.
                </div>
              ) : (
                <div className="h-44 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={categoryData} layout="vertical" margin={{ top: 5, right: 10, left: 30, bottom: 5 }}>
                      <XAxis type="number" tick={{ fontSize: 11, fill: '#6e6e73' }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#1d1d1f' }} width={80} axisLine={false} tickLine={false} />
                      <Tooltip
                        formatter={(val: any) => [formatCurrency(Number(val || 0), data.settings.currency), 'Amount']}
                        contentStyle={tooltipStyle}
                      />
                      <Bar dataKey="amount" fill="#0284c7" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </SectionCard>

            <SectionCard
              title={`Attendance Breakdown (${periodPreset === 'this_month' ? currentMonth : periodPreset.replace('_', ' ')})`}
              action={
                <span className="text-xs text-[#6e6e73] font-mono tabular-nums">
                  {!salaryConfigured && periodSalary.earnedSalary === 0
                    ? 'Salary: Not configured'
                    : `Est Salary: ${formatCurrency(periodSalary.earnedSalary, data.settings.currency)}`}
                </span>
              }
            >
              {attendancePieData.length === 0 ? (
                <div className="h-44 flex items-center justify-center text-xs text-[#86868b]">
                  No attendance records logged for the selected period.
                </div>
              ) : (
                <div className="h-44 w-full flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={attendancePieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={60}
                        dataKey="count"
                      >
                        {attendancePieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: '11px', color: '#6e6e73' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </SectionCard>
          </div>
        </>
      )}

      {hasOpenedPDFModal && (
        <Suspense fallback={null}>
          <PDFExportModal
            isOpen={isPDFModalOpen}
            onClose={() => setIsPDFModalOpen(false)}
            defaultPreset={periodPreset}
          />
        </Suspense>
      )}
    </div>
  );
};
