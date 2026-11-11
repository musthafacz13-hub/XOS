import React, { useState } from 'react';
import { BarChart3, Download, TrendingUp, TrendingDown, PiggyBank, FileText } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { useXOSData } from '../../hooks/useXOSData';
import { DateFilterPreset } from '../../types';
import { calculateAttendanceStatsForRecords, calculateEstimatedSalary, calculateFinancialTotals, filterRecordsByDateRange } from '../../utils/calculations';
import { formatCurrency, getMonthString } from '../../utils/formatters';
import { EmptyState } from '../common/EmptyState';
import { PDFExportModal } from '../modals/PDFExportModal';

const CHART_PALETTE = ['#87CEEB', '#111111', '#525252', '#737373', '#A3A3A3', '#D4D4D4'];

export const ReportsView: React.FC = () => {
  const data = useXOSData();

  const [periodPreset, setPeriodPreset] = useState<DateFilterPreset>('this_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const filteredIncomes = filterRecordsByDateRange(data.incomes, periodPreset, customStart, customEnd);
  const filteredExpenses = filterRecordsByDateRange(data.expenses, periodPreset, customStart, customEnd);
  const filteredAttendance = filterRecordsByDateRange(data.attendance, periodPreset, customStart, customEnd);

  const totals = calculateFinancialTotals(filteredIncomes, filteredExpenses, data.savingsGoals, data.savingsTransactions);

  const currentMonth = getMonthString();
  const attStats = calculateAttendanceStatsForRecords(filteredAttendance, data.settings.salaryConfig.expectedWorkingHoursPerDay);
  const salaryEst = calculateEstimatedSalary(data.settings.salaryConfig, filteredAttendance, currentMonth);

  // Group cash flow by date
  const dateMap: Record<string, { date: string; income: number; expense: number }> = {};

  filteredIncomes.forEach(i => {
    if (!dateMap[i.date]) dateMap[i.date] = { date: i.date, income: 0, expense: 0 };
    dateMap[i.date].income += i.amount;
  });

  filteredExpenses.forEach(e => {
    if (!dateMap[e.date]) dateMap[e.date] = { date: e.date, income: 0, expense: 0 };
    dateMap[e.date].expense += e.amount;
  });

  const cashFlowTimelineData = Object.values(dateMap).sort((a, b) => (a.date > b.date ? 1 : -1));

  // Category breakdown
  const catMap: Record<string, number> = {};
  filteredExpenses.forEach(e => {
    catMap[e.category] = (catMap[e.category] || 0) + e.amount;
  });

  const categoryData = Object.entries(catMap).map(([name, value]) => ({
    name,
    amount: Number(value.toFixed(2))
  })).sort((a, b) => b.amount - a.amount);

  const attendancePieData = [
    { name: 'Present', count: attStats.presentDays, fill: '#111111' },
    { name: 'Absent', count: attStats.absentDays, fill: '#737373' },
    { name: 'Leave', count: attStats.leaveDays, fill: '#A3A3A3' },
    { name: 'Holiday', count: attStats.holidayDays, fill: '#87CEEB' }
  ].filter(d => d.count > 0);

  const hasData = data.incomes.length > 0 || data.expenses.length > 0 || data.attendance.length > 0;

  const [isPDFModalOpen, setIsPDFModalOpen] = useState(false);

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-black/[0.06]">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-[#111111] tracking-tight">
            Analytics & Reports
          </h2>
          <p className="text-xs sm:text-sm text-neutral-500 font-normal mt-0.5">
            Monitor cash flow dynamics, expense allocations, and attendance breakdown.
          </p>
        </div>

        <button
          onClick={() => setIsPDFModalOpen(true)}
          type="button"
          className="self-start sm:self-auto flex items-center gap-1.5 px-3.5 py-2 bg-[#111111] text-white text-xs font-semibold rounded-xl hover:bg-black transition-colors shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
        >
          <FileText className="w-4 h-4 text-[#87CEEB]" />
          <span>Export PDF Report</span>
        </button>
      </div>

      {!hasData ? (
        <EmptyState
          icon={BarChart3}
          title="Add records to see your financial reports"
          description="Log income, track expenses, or mark attendance to generate detailed cash flow analytics and visual breakdown charts."
        />
      ) : (
        <>
          {/* Date Range Selector Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-neutral-50 p-2.5 rounded-2xl border border-neutral-200">
            <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
              {[
                { id: 'today', label: 'Today' },
                { id: 'this_month', label: 'This Month' },
                { id: 'last_month', label: 'Last Month' },
                { id: 'this_year', label: 'This Year' },
                { id: 'custom', label: 'Custom' }
              ].map(p => (
                <button
                  key={p.id}
                  onClick={() => setPeriodPreset(p.id as DateFilterPreset)}
                  type="button"
                  className={`px-3 py-1.5 text-xs font-medium rounded-xl transition-colors whitespace-nowrap cursor-pointer ${
                    periodPreset === p.id ? 'bg-white text-[#111111] shadow-xs font-semibold' : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {periodPreset === 'custom' && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="px-2.5 py-1 text-xs border border-neutral-300 rounded-lg bg-white"
                />
                <span className="text-xs text-neutral-400">to</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="px-2.5 py-1 text-xs border border-neutral-300 rounded-lg bg-white"
                />
              </div>
            )}
          </div>

          {/* Prominent Section Dashboard Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* Prominent Dark Summary Panel (Left Column) */}
            <div className="lg:col-span-1 p-5 sm:p-6 rounded-2xl bg-[#111111] text-white flex flex-col justify-between space-y-4 shadow-xs">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Net Cash Flow</span>
                  <BarChart3 className="w-5 h-5 text-[#87CEEB]" />
                </div>
                <div>
                  <div className="text-2xl sm:text-3xl font-extrabold font-mono tracking-tight text-white tabular-nums">
                    {formatCurrency(totals.netCashFlow, data.settings.currency)}
                  </div>
                  <p className="text-xs text-neutral-400 mt-1">
                    Period Income minus Expense
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <button
                  onClick={() => setIsPDFModalOpen(true)}
                  type="button"
                  className="w-full flex items-center justify-center gap-1.5 px-3.5 py-2 bg-[#87CEEB] text-[#111111] text-xs font-bold rounded-xl hover:bg-[#70c2e3] transition-colors cursor-pointer"
                >
                  <FileText className="w-4 h-4 text-[#111111]" />
                  <span>Export PDF Report</span>
                </button>
              </div>
            </div>

            {/* Section Key Metric Cards Grid (Right 3 Columns) */}
            <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              <div className="p-4 sm:p-5 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-1 shadow-xs">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Period Revenue</span>
                <div className="text-2xl font-bold font-mono text-emerald-600 tabular-nums">{formatCurrency(totals.totalIncome, data.settings.currency)}</div>
                <span className="text-[11px] text-neutral-400">{filteredIncomes.length} Entries Logged</span>
              </div>

              <div className="p-4 sm:p-5 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-1 shadow-xs">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Period Expenses</span>
                <div className="text-2xl font-bold font-mono text-[#111111] tabular-nums">{formatCurrency(totals.totalExpenses, data.settings.currency)}</div>
                <span className="text-[11px] text-neutral-400">{filteredExpenses.length} Transactions</span>
              </div>

              <div className="p-4 sm:p-5 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-1 shadow-xs">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Total Reserves</span>
                <div className="text-2xl font-bold font-mono text-[#111111] tabular-nums">{formatCurrency(totals.currentSavingsBalance, data.settings.currency)}</div>
                <span className="text-[11px] text-neutral-400">Across {data.savingsGoals.length} Funds</span>
              </div>

              <div className="p-4 sm:p-5 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-1 shadow-xs">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Remaining Salary</span>
                <div className="text-2xl font-bold font-mono text-[#111111] tabular-nums">{formatCurrency(salaryEst.netSalary, data.settings.currency)}</div>
                <span className="text-[11px] text-neutral-400">Est. Salary Due</span>
              </div>

              <div className="p-4 sm:p-5 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-1 shadow-xs sm:col-span-2 lg:col-span-1">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Money Owed to Me</span>
                <div className="text-2xl font-bold font-mono text-[#111111] tabular-nums">{formatCurrency(data.debts.filter(d => d.type === 'lent').reduce((acc, d) => acc + d.original_amount, 0), data.settings.currency)}</div>
                <span className="text-[11px] text-neutral-400">Total Receivables</span>
              </div>
            </div>
          </div>

          {/* Cash Flow Timeline Chart */}
          <div className="p-5 sm:p-6 rounded-2xl bg-white border border-black/[0.08] space-y-4 shadow-xs">
            <div className="flex items-center justify-between border-b border-black/[0.06] pb-3">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-[#87CEEB]" />
                <h3 className="font-bold text-sm text-[#111111]">Income vs Expense Net Cash Flow Timeline</h3>
              </div>
              <span className="text-xs text-neutral-400">Timeline Analysis</span>
            </div>

            {cashFlowTimelineData.length === 0 ? (
              <div className="h-60 flex items-center justify-center text-xs text-neutral-400">
                No activity records exist for the selected date range.
              </div>
            ) : (
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={cashFlowTimelineData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip
                      formatter={(val: any) => [formatCurrency(Number(val || 0), data.settings.currency)]}
                      contentStyle={{ backgroundColor: '#111111', color: '#ffffff', borderRadius: '12px', fontSize: '12px', border: 'none' }}
                    />
                    <Area type="monotone" dataKey="income" stroke="#87CEEB" fill="#87CEEB" fillOpacity={0.25} name="Income" />
                    <Area type="monotone" dataKey="expense" stroke="#111111" fill="#111111" fillOpacity={0.12} name="Expense" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Dual Column Analytics */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Category Spending Bar Chart */}
            <div className="p-5 rounded-2xl bg-white border border-black/[0.08] space-y-3 shadow-xs">
              <h3 className="font-bold text-sm text-[#111111]">Expense Category Breakdown</h3>

              {categoryData.length === 0 ? (
                <div className="h-44 flex items-center justify-center text-xs text-neutral-400">
                  No categorized expenses recorded in this period.
                </div>
              ) : (
                <div className="h-44 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={categoryData} layout="vertical" margin={{ top: 5, right: 10, left: 30, bottom: 5 }}>
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} />
                      <Tooltip
                        formatter={(val: any) => [formatCurrency(Number(val || 0), data.settings.currency), 'Amount']}
                        contentStyle={{ backgroundColor: '#111111', color: '#ffffff', borderRadius: '12px', fontSize: '12px', border: 'none' }}
                      />
                      <Bar dataKey="amount" fill="#111111" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Attendance Distribution Chart */}
            <div className="p-5 rounded-2xl bg-white border border-black/[0.08] space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm text-[#111111]">
                  Attendance Breakdown ({periodPreset === 'this_month' ? currentMonth : periodPreset.replace('_', ' ')})
                </h3>
                <span className="text-xs text-neutral-500 font-mono">Est Salary: ${salaryEst.netSalary}</span>
              </div>

              {attendancePieData.length === 0 ? (
                <div className="h-44 flex items-center justify-center text-xs text-neutral-400">
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
                      <Tooltip contentStyle={{ backgroundColor: '#111111', color: '#ffffff', borderRadius: '12px', fontSize: '12px', border: 'none' }} />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* PDF Export Options Modal */}
      <PDFExportModal
        isOpen={isPDFModalOpen}
        onClose={() => setIsPDFModalOpen(false)}
        defaultPreset={periodPreset}
      />
    </div>
  );
};
