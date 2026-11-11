import React, { useState, useEffect } from 'react';
import { Calculator, Plus, Trash2, FileText, X, Check, AlertCircle, Info } from 'lucide-react';
import { useXOSData } from '../../hooks/useXOSData';
import { Allowance, Deduction, SalaryConfig, SalaryType, FixedMonthlyAbsencePolicy } from '../../types';
import { calculateEstimatedSalary } from '../../utils/calculations';
import { formatCurrency, formatHumanDate, getMonthString } from '../../utils/formatters';
import { EmptyState } from '../common/EmptyState';
import { ConfirmDialog } from '../common/ConfirmDialog';

export const SalaryView: React.FC = () => {
  const data = useXOSData();

  const [activeTab, setActiveTab] = useState<'estimator' | 'rules' | 'payouts'>('estimator');
  const [selectedMonth, setSelectedMonth] = useState(getMonthString());

  // Confirmation dialog state
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  // Rule Config Form State
  const [salaryConfig, setSalaryConfig] = useState<SalaryConfig>(data.settings.salaryConfig);
  const [newAllowanceName, setNewAllowanceName] = useState('');
  const [newAllowanceAmount, setNewAllowanceAmount] = useState('');
  const [newDeductionName, setNewDeductionName] = useState('');
  const [newDeductionAmount, setNewDeductionAmount] = useState('');
  const [savedNotification, setSavedNotification] = useState(false);

  // Payslip Modal State
  const [isPayslipOpen, setIsPayslipOpen] = useState(false);
  const [isSyncingToIncome, setIsSyncingToIncome] = useState(true);
  const [payoutErrorMessage, setPayoutErrorMessage] = useState<string | null>(null);

  // Sync state if settings updated externally
  useEffect(() => {
    setSalaryConfig(data.settings.salaryConfig);
  }, [data.settings.salaryConfig]);

  // Escape key handler for modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isPayslipOpen) {
        setIsPayslipOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPayslipOpen]);

  // Existing payout for current selected period
  const existingPayout = data.salaryPayouts.find(p => p.periodMonth === selectedMonth);

  const estimatedSalary = calculateEstimatedSalary(data.settings.salaryConfig, data.attendance, selectedMonth);

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    data.saveSettings({
      ...data.settings,
      salaryConfig
    });
    setSavedNotification(true);
    setTimeout(() => setSavedNotification(false), 3000);
  };

  const handleAddAllowance = () => {
    if (!newAllowanceName.trim() || !newAllowanceAmount) return;
    const newAllowance: Allowance = {
      id: 'all_' + Date.now(),
      name: newAllowanceName.trim(),
      amount: parseFloat(newAllowanceAmount)
    };
    setSalaryConfig({
      ...salaryConfig,
      allowances: [...salaryConfig.allowances, newAllowance]
    });
    setNewAllowanceName('');
    setNewAllowanceAmount('');
  };

  const handleRemoveAllowance = (id: string) => {
    setSalaryConfig({
      ...salaryConfig,
      allowances: salaryConfig.allowances.filter(a => a.id !== id)
    });
  };

  const handleAddDeduction = () => {
    if (!newDeductionName.trim() || !newDeductionAmount) return;
    const newDeduction: Deduction = {
      id: 'ded_' + Date.now(),
      name: newDeductionName.trim(),
      amount: parseFloat(newDeductionAmount)
    };
    setSalaryConfig({
      ...salaryConfig,
      deductions: [...salaryConfig.deductions, newDeduction]
    });
    setNewDeductionName('');
    setNewDeductionAmount('');
  };

  const handleRemoveDeduction = (id: string) => {
    setSalaryConfig({
      ...salaryConfig,
      deductions: salaryConfig.deductions.filter(d => d.id !== id)
    });
  };

  const handleRecordPayout = () => {
    setPayoutErrorMessage(null);
    try {
      data.recordSalaryPayout({
        periodMonth: selectedMonth,
        paymentDate: new Date().toISOString().split('T')[0],
        salaryType: estimatedSalary.salaryType as SalaryType,
        baseAmount: estimatedSalary.baseAmount,
        presentDays: estimatedSalary.presentDays,
        absentDays: estimatedSalary.absentDays,
        leaveDays: estimatedSalary.leaveDays,
        holidayDays: estimatedSalary.holidayDays,
        totalWorkingHours: estimatedSalary.totalWorkingHours,
        overtimeHours: estimatedSalary.overtimeHours,
        grossSalary: estimatedSalary.grossSalary,
        totalAllowances: estimatedSalary.totalAllowances,
        totalDeductions: estimatedSalary.totalDeductions,
        netSalary: estimatedSalary.netSalary,
        status: 'Paid',
        notes: `Payout calculated for ${selectedMonth}`
      }, isSyncingToIncome, Boolean(existingPayout));

      setIsPayslipOpen(false);
      setActiveTab('payouts');
    } catch (err) {
      console.error('Failed to record payout:', err);
      setPayoutErrorMessage(err instanceof Error ? err.message : 'Failed to record salary payout.');
    }
  };

  const handleDeletePayout = (id: string) => {
    setDeleteTargetId(id);
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-black/[0.06]">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-[#111111] tracking-tight">
            Salary & Payroll
          </h2>
          <p className="text-xs sm:text-sm text-neutral-500 font-normal mt-0.5">
            Configure employment rules, estimate attendance-based earnings, and record net salary payouts.
          </p>
        </div>

        {/* View Tabs */}
        <div className="flex items-center gap-1 bg-neutral-100 p-1 rounded-xl self-start sm:self-auto border border-neutral-200/60 overflow-x-auto">
          <button
            onClick={() => setActiveTab('estimator')}
            type="button"
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'estimator' ? 'bg-white text-[#111111] shadow-xs font-semibold' : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            Estimator
          </button>
          <button
            onClick={() => setActiveTab('rules')}
            type="button"
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'rules' ? 'bg-white text-[#111111] shadow-xs font-semibold' : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            Payroll Rules
          </button>
          <button
            onClick={() => setActiveTab('payouts')}
            type="button"
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'payouts' ? 'bg-white text-[#111111] shadow-xs font-semibold' : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            Payout History
          </button>
        </div>
      </div>

      {/* VIEW 1: ESTIMATOR */}
      {activeTab === 'estimator' && (
        <div className="space-y-6">
          {/* Month Selector Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-neutral-50 rounded-2xl border border-neutral-200">
            <div className="flex items-center gap-2">
              <Calculator className="w-4 h-4 text-[#87CEEB]" />
              <span className="font-bold text-sm text-[#111111]">Estimated Earnings for Selected Period</span>
            </div>

            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-3 py-1.5 text-xs font-mono font-semibold border border-neutral-300 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
            />
          </div>

          {/* Duplicate Payout Warning Banner */}
          {existingPayout && (
            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-amber-900 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-xs">
              <div className="flex items-start sm:items-center gap-2.5">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5 sm:mt-0" />
                <div>
                  <span className="font-bold block sm:inline mr-1">Payout Record Exists:</span>
                  <span>
                    A salary payout of <strong>{formatCurrency(existingPayout.netSalary, data.settings.currency)}</strong> was already recorded for <strong>{selectedMonth}</strong> on {formatHumanDate(existingPayout.paymentDate)}.
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('payouts')}
                className="text-xs font-bold text-amber-800 hover:text-black underline shrink-0 cursor-pointer"
              >
                View Payout History
              </button>
            </div>
          )}

          {/* Big Net Salary Card & Itemized Card */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
            {/* Net Earned Box */}
            <div className="p-5 sm:p-6 rounded-2xl bg-[#111111] text-white flex flex-col justify-between space-y-4 shadow-xs">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                  Estimated Net Salary
                </span>
                <div className="text-3xl font-extrabold font-mono tracking-tight text-white mt-1 tabular-nums">
                  {formatCurrency(estimatedSalary.netSalary, data.settings.currency)}
                </div>
                <p className="text-xs text-neutral-400 mt-1">
                  Rule: {data.settings.salaryConfig.salaryType.replace('_', ' ').toUpperCase()}
                </p>
              </div>

              <div className="space-y-2 pt-3 border-t border-neutral-800 text-xs">
                <div className="flex justify-between text-neutral-400 font-mono tabular-nums">
                  <span>Gross Earned Base:</span>
                  <span className="text-white">
                    {formatCurrency(estimatedSalary.grossSalary, data.settings.currency)}
                  </span>
                </div>
                {estimatedSalary.absenceDeduction > 0 && (
                  <div className="flex justify-between text-rose-300 font-mono tabular-nums">
                    <span>- Absence Deduction:</span>
                    <span>-{formatCurrency(estimatedSalary.absenceDeduction, data.settings.currency)}</span>
                  </div>
                )}
                <div className="flex justify-between text-neutral-300 font-mono tabular-nums">
                  <span>+ Total Allowances:</span>
                  <span>+{formatCurrency(estimatedSalary.totalAllowances, data.settings.currency)}</span>
                </div>
                <div className="flex justify-between text-neutral-300 font-mono tabular-nums">
                  <span>- Total Deductions:</span>
                  <span>-{formatCurrency(estimatedSalary.totalDeductions, data.settings.currency)}</span>
                </div>
              </div>

              <button
                onClick={() => setIsPayslipOpen(true)}
                type="button"
                className={`w-full py-2.5 font-bold text-xs rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                  existingPayout
                    ? 'bg-amber-400 hover:bg-amber-300 text-black'
                    : 'bg-[#87CEEB] hover:bg-sky-300 text-[#111111]'
                }`}
              >
                <FileText className="w-4 h-4" />
                <span>
                  {existingPayout ? 'Review or Update Recorded Payslip' : 'Generate & Record Payslip'}
                </span>
              </button>
            </div>

            {/* Attendance Calculation Factors */}
            <div className="lg:col-span-2 p-5 sm:p-6 rounded-2xl bg-white border border-black/[0.08] space-y-4 shadow-xs">
              <h3 className="font-bold text-sm text-[#111111] border-b border-black/[0.06] pb-3">
                Calculation Factors from Attendance Records ({selectedMonth})
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
                <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
                  <span className="text-[10px] font-semibold text-neutral-500 uppercase block">Present Days</span>
                  <span className="text-xl font-bold font-mono text-[#111111] block tabular-nums">{estimatedSalary.presentDays}</span>
                  <span className="text-[10px] text-neutral-400">Worked days</span>
                </div>

                <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
                  <span className="text-[10px] font-semibold text-neutral-500 uppercase block">Paid Leave</span>
                  <span className="text-xl font-bold font-mono text-[#111111] block tabular-nums">{estimatedSalary.paidLeaveDays}</span>
                  <span className="text-[10px] text-neutral-400">Of {estimatedSalary.leaveDays} leaves</span>
                </div>

                <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
                  <span className="text-[10px] font-semibold text-neutral-500 uppercase block">Holidays</span>
                  <span className="text-xl font-bold font-mono text-[#111111] block tabular-nums">{estimatedSalary.holidayDays}</span>
                  <span className="text-[10px] text-neutral-400">Off days</span>
                </div>

                <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
                  <span className="text-[10px] font-semibold text-neutral-500 uppercase block">Total Hours</span>
                  <span className="text-xl font-bold font-mono text-[#111111] block tabular-nums">{estimatedSalary.totalWorkingHours}h</span>
                  <span className="text-[10px] text-neutral-400">
                    {estimatedSalary.overtimeHours > 0 ? `(${estimatedSalary.overtimeHours}h overtime)` : 'Standard hours'}
                  </span>
                </div>
              </div>

              {/* Step Breakdown Formula */}
              <div className="p-4 bg-neutral-50 rounded-xl space-y-2 border border-neutral-200">
                <span className="text-xs font-bold text-[#111111] block">Calculation Steps</span>
                <ul className="space-y-1 text-xs text-neutral-700 font-mono">
                  {estimatedSalary.breakdown.map((step, idx) => (
                    <li key={idx} className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#87CEEB] shrink-0" />
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: PAYROLL RULES EDITOR */}
      {activeTab === 'rules' && (
        <form onSubmit={handleSaveConfig} className="p-5 sm:p-6 rounded-2xl bg-white border border-black/[0.08] space-y-6 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-black/[0.06] pb-4">
            <div>
              <h3 className="font-bold text-base text-[#111111]">Employment & Payroll Rules</h3>
              <p className="text-xs text-neutral-500 mt-0.5">Customize your salary type, rates, allowances, deductions, overtime rules, and absence policy.</p>
            </div>

            <div className="flex items-center gap-2">
              {savedNotification && (
                <span className="text-xs text-neutral-700 flex items-center gap-1 font-medium">
                  <Check className="w-3.5 h-3.5 text-emerald-600" /> Saved
                </span>
              )}
              <button
                type="submit"
                className="px-4 py-2 bg-[#111111] text-white text-xs font-semibold rounded-xl hover:bg-black transition-colors shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
              >
                Save Configuration
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* General Salary Type & Rates */}
            <div className="space-y-4">
              <h4 className="font-bold text-xs uppercase tracking-wider text-neutral-500">Base Salary & Workload</h4>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Salary Type *</label>
                <select
                  value={salaryConfig.salaryType}
                  onChange={(e) => setSalaryConfig({ ...salaryConfig, salaryType: e.target.value as SalaryType })}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                >
                  <option value="fixed_monthly">Fixed Monthly Salary</option>
                  <option value="attendance_monthly">Attendance-Based Monthly (Prorated)</option>
                  <option value="daily_wage">Daily Wage Rate</option>
                  <option value="hourly_wage">Hourly Wage Rate</option>
                  <option value="custom">Custom (Base + Overtime + Allowances)</option>
                </select>
              </div>

              {/* Fixed Monthly Absence Policy Options */}
              {salaryConfig.salaryType === 'fixed_monthly' && (
                <div className="p-3.5 bg-neutral-50 rounded-xl border border-neutral-200 space-y-2">
                  <label className="block text-xs font-semibold text-neutral-800">
                    Fixed Monthly Absence Policy
                  </label>
                  <div className="space-y-2 text-xs">
                    <label className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      (salaryConfig.fixedMonthlyAbsencePolicy || 'no_deduction') === 'no_deduction' 
                        ? 'bg-white border-[#87CEEB] shadow-xs' 
                        : 'bg-neutral-50/50 border-neutral-200 text-neutral-600'
                    }`}>
                      <input
                        type="radio"
                        name="absencePolicy"
                        value="no_deduction"
                        checked={(salaryConfig.fixedMonthlyAbsencePolicy || 'no_deduction') === 'no_deduction'}
                        onChange={() => setSalaryConfig({ ...salaryConfig, fixedMonthlyAbsencePolicy: 'no_deduction' })}
                        className="mt-0.5 text-[#111111] focus:ring-[#87CEEB]"
                      />
                      <div>
                        <span className="font-semibold block text-[#111111]">No Absence Deduction</span>
                        <span className="text-[11px] text-neutral-500 block">Guaranteed fixed base salary regardless of unexcused absences.</span>
                      </div>
                    </label>

                    <label className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      salaryConfig.fixedMonthlyAbsencePolicy === 'deduct_unpaid_absent' 
                        ? 'bg-white border-[#87CEEB] shadow-xs' 
                        : 'bg-neutral-50/50 border-neutral-200 text-neutral-600'
                    }`}>
                      <input
                        type="radio"
                        name="absencePolicy"
                        value="deduct_unpaid_absent"
                        checked={salaryConfig.fixedMonthlyAbsencePolicy === 'deduct_unpaid_absent'}
                        onChange={() => setSalaryConfig({ ...salaryConfig, fixedMonthlyAbsencePolicy: 'deduct_unpaid_absent' })}
                        className="mt-0.5 text-[#111111] focus:ring-[#87CEEB]"
                      />
                      <div>
                        <span className="font-semibold block text-[#111111]">Deduct Unpaid Absences</span>
                        <span className="text-[11px] text-neutral-500 block">Deducts (Base / Expected Days) for each absent and unpaid leave day.</span>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Base Amount ({salaryConfig.currency})</label>
                  <input
                    type="number"
                    step="0.01"
                    value={salaryConfig.baseAmount}
                    onChange={(e) => setSalaryConfig({ ...salaryConfig, baseAmount: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Expected Days / Month</label>
                  <input
                    type="number"
                    value={salaryConfig.expectedWorkingDaysPerMonth}
                    onChange={(e) => setSalaryConfig({ ...salaryConfig, expectedWorkingDaysPerMonth: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Standard Hours / Day</label>
                  <input
                    type="number"
                    value={salaryConfig.expectedWorkingHoursPerDay}
                    onChange={(e) => setSalaryConfig({ ...salaryConfig, expectedWorkingHoursPerDay: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Monthly Paid Leave Allowance</label>
                  <input
                    type="number"
                    value={salaryConfig.paidLeaveAllowancePerMonth}
                    onChange={(e) => setSalaryConfig({ ...salaryConfig, paidLeaveAllowancePerMonth: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
              </div>

              {/* Overtime multiplier & monthly inclusion */}
              <div className="p-3.5 bg-neutral-50 rounded-xl border border-neutral-200 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-800 mb-1">
                    Overtime Rate Multiplier (e.g. 1.5x)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="1.0"
                    value={salaryConfig.overtimeRateMultiplier || 1.5}
                    onChange={(e) => setSalaryConfig({ ...salaryConfig, overtimeRateMultiplier: parseFloat(e.target.value) || 1.5 })}
                    className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>

                {(salaryConfig.salaryType === 'fixed_monthly' || salaryConfig.salaryType === 'attendance_monthly') && (
                  <label className="flex items-start gap-2 text-xs text-neutral-800 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={Boolean(salaryConfig.includeOvertimeInMonthly)}
                      onChange={(e) => setSalaryConfig({ ...salaryConfig, includeOvertimeInMonthly: e.target.checked })}
                      className="mt-0.5 rounded text-[#111111] focus:ring-[#87CEEB]"
                    />
                    <div>
                      <span className="font-semibold block text-[#111111]">Include Overtime in Monthly Earnings</span>
                      <span className="text-[11px] text-neutral-500 block">Compensate overtime hours at the overtime rate in addition to the monthly rate.</span>
                    </div>
                  </label>
                )}
              </div>
            </div>

            {/* Allowances & Deductions */}
            <div className="space-y-4">
              <h4 className="font-bold text-xs uppercase tracking-wider text-neutral-500">Allowances & Deductions</h4>

              {/* Allowances */}
              <div className="p-4 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-3">
                <span className="text-xs font-bold text-[#111111] block">+ Allowances</span>
                <div className="space-y-1.5">
                  {salaryConfig.allowances.length === 0 ? (
                    <p className="text-xs text-neutral-400">No allowances configured.</p>
                  ) : (
                    salaryConfig.allowances.map((all) => (
                      <div key={all.id} className="flex items-center justify-between text-xs bg-white p-2 rounded-xl border border-neutral-200">
                        <span className="font-medium text-neutral-800">{all.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-neutral-900">
                            +{formatCurrency(all.amount, data.settings.currency)}
                          </span>
                          <button type="button" onClick={() => handleRemoveAllowance(all.id)} className="text-neutral-400 hover:text-rose-600 cursor-pointer">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="flex gap-2 pt-1">
                  <input
                    type="text"
                    placeholder="Allowance name (e.g. Housing)"
                    value={newAllowanceName}
                    onChange={(e) => setNewAllowanceName(e.target.value)}
                    className="flex-1 px-2.5 py-1 text-xs border border-neutral-300 rounded-lg bg-white"
                  />
                  <input
                    type="number"
                    placeholder="Amount"
                    value={newAllowanceAmount}
                    onChange={(e) => setNewAllowanceAmount(e.target.value)}
                    className="w-20 px-2 py-1 text-xs font-mono border border-neutral-300 rounded-lg bg-white"
                  />
                  <button type="button" onClick={handleAddAllowance} className="px-3 py-1 bg-[#111111] text-white text-xs font-semibold rounded-lg cursor-pointer">
                    Add
                  </button>
                </div>
              </div>

              {/* Deductions */}
              <div className="p-4 bg-neutral-50 rounded-2xl border border-neutral-200 space-y-3">
                <span className="text-xs font-bold text-[#111111] block">- Deductions</span>
                <div className="space-y-1.5">
                  {salaryConfig.deductions.length === 0 ? (
                    <p className="text-xs text-neutral-400">No deductions configured.</p>
                  ) : (
                    salaryConfig.deductions.map((ded) => (
                      <div key={ded.id} className="flex items-center justify-between text-xs bg-white p-2 rounded-xl border border-neutral-200">
                        <span className="font-medium text-neutral-800">{ded.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-neutral-900">
                            -{formatCurrency(ded.amount, data.settings.currency)}
                          </span>
                          <button type="button" onClick={() => handleRemoveDeduction(ded.id)} className="text-neutral-400 hover:text-rose-600 cursor-pointer">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="flex gap-2 pt-1">
                  <input
                    type="text"
                    placeholder="Deduction name (e.g. Tax)"
                    value={newDeductionName}
                    onChange={(e) => setNewDeductionName(e.target.value)}
                    className="flex-1 px-2.5 py-1 text-xs border border-neutral-300 rounded-lg bg-white"
                  />
                  <input
                    type="number"
                    placeholder="Amount"
                    value={newDeductionAmount}
                    onChange={(e) => setNewDeductionAmount(e.target.value)}
                    className="w-20 px-2 py-1 text-xs font-mono border border-neutral-300 rounded-lg bg-white"
                  />
                  <button type="button" onClick={handleAddDeduction} className="px-3 py-1 bg-[#111111] text-white text-xs font-semibold rounded-lg cursor-pointer">
                    Add
                  </button>
                </div>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* VIEW 3: PAYOUT HISTORY */}
      {activeTab === 'payouts' && (
        <>
          {data.salaryPayouts.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No salary payouts recorded yet"
              description="Calculate monthly net earnings based on your attendance and record itemized payslips."
              actionLabel="Go to Estimator"
              onAction={() => setActiveTab('estimator')}
            />
          ) : (
            <>
              {/* Mobile Card List for Salary Payouts */}
              <div className="md:hidden space-y-2.5">
                {data.salaryPayouts.map((pay) => {
                  const isActuallySynced = Boolean(pay.syncedToIncomeId && data.incomes.some(i => i.id === pay.syncedToIncomeId));
                  return (
                    <div key={pay.id} className="p-4 rounded-2xl border border-black/[0.08] bg-white space-y-2.5 shadow-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-sm text-[#111111]">
                          {pay.periodMonth}
                        </span>
                        <span className="font-mono font-bold text-sm text-[#111111] tabular-nums">
                          {formatCurrency(pay.netSalary, data.settings.currency)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs text-neutral-500 font-mono">
                        <span>{formatHumanDate(pay.paymentDate)}</span>
                        <span>{pay.presentDays} days ({pay.totalWorkingHours}h)</span>
                      </div>

                      <div className="pt-2 border-t border-neutral-100 flex items-center justify-between text-xs text-neutral-500">
                        <span>{isActuallySynced ? 'Synced to Income' : 'Manual / Unsynced'}</span>
                        <button
                          onClick={() => handleDeletePayout(pay.id)}
                          className="p-1 text-neutral-400 hover:text-rose-600 cursor-pointer"
                          title="Delete payout"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Table (widths >= 768px) */}
              <div className="hidden md:block bg-white rounded-2xl border border-black/[0.08] overflow-hidden shadow-xs">
                <div className="p-4 border-b border-black/[0.06] font-bold text-sm text-[#111111]">
                  Salary Payout History
                </div>
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-neutral-50/80 border-b border-black/[0.06] text-[11px] font-bold text-neutral-500 uppercase tracking-wider">
                      <th className="py-3 px-4">Period Month</th>
                      <th className="py-3 px-4">Payout Date</th>
                      <th className="py-3 px-4">Working Days</th>
                      <th className="py-3 px-4">Gross Earned</th>
                      <th className="py-3 px-4 text-right">Net Paid</th>
                      <th className="py-3 px-4 text-center">Income Sync</th>
                      <th className="py-3 px-4 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.06] text-xs text-neutral-700">
                    {data.salaryPayouts.map((pay) => {
                      const isActuallySynced = Boolean(pay.syncedToIncomeId && data.incomes.some(i => i.id === pay.syncedToIncomeId));
                      return (
                        <tr key={pay.id} className="hover:bg-neutral-50/70 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-[#111111]">
                            {pay.periodMonth}
                          </td>
                          <td className="py-3 px-4 font-mono text-neutral-600 tabular-nums">
                            {formatHumanDate(pay.paymentDate)}
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums">
                            {pay.presentDays} days ({pay.totalWorkingHours}h)
                          </td>
                          <td className="py-3 px-4 font-mono text-neutral-700 tabular-nums">
                            {formatCurrency(pay.grossSalary, data.settings.currency)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-[#111111] tabular-nums">
                            {formatCurrency(pay.netSalary, data.settings.currency)}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {isActuallySynced ? (
                              <span className="px-2 py-0.5 rounded text-[10px] bg-neutral-100 text-neutral-700 border border-neutral-200 font-semibold">
                                Synced
                              </span>
                            ) : (
                              <span className="text-neutral-400 text-[10px]">Manual</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <button
                              onClick={() => handleDeletePayout(pay.id)}
                              className="p-1 text-neutral-400 hover:text-rose-600 cursor-pointer"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {/* Payslip & Record Payout Modal */}
      {isPayslipOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setIsPayslipOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div 
            className="bg-white rounded-2xl max-w-lg w-full border border-black/[0.08] shadow-2xl p-5 sm:p-6 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
              <div>
                <h3 className="font-bold text-base sm:text-lg text-[#111111]">Itemized Salary Payslip</h3>
                <span className="text-xs text-neutral-500 font-mono">Period: {selectedMonth}</span>
              </div>
              <button onClick={() => setIsPayslipOpen(false)} className="p-1 text-neutral-400 hover:text-black cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {existingPayout && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-bold">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  <span>Existing Payout Will Be Replaced</span>
                </div>
                <p className="text-[11px] text-amber-700">
                  A payout of <strong>{formatCurrency(existingPayout.netSalary, data.settings.currency)}</strong> is already recorded for {selectedMonth}. Confirming will overwrite the existing payslip record and update your linked income.
                </p>
              </div>
            )}

            {payoutErrorMessage && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs">
                {payoutErrorMessage}
              </div>
            )}

            <div className="p-4 bg-neutral-50 rounded-2xl space-y-3 text-xs font-mono border border-neutral-200">
              <div className="flex justify-between font-bold text-[#111111] pb-2 border-b border-neutral-200">
                <span>Base Gross Earned ({estimatedSalary.presentDays} Days)</span>
                <span>{formatCurrency(estimatedSalary.grossSalary, data.settings.currency)}</span>
              </div>

              {estimatedSalary.absenceDeduction > 0 && (
                <div className="flex justify-between text-rose-600">
                  <span>- Absence Deduction</span>
                  <span>-{formatCurrency(estimatedSalary.absenceDeduction, data.settings.currency)}</span>
                </div>
              )}

              {data.settings.salaryConfig.allowances.map(a => (
                <div key={a.id} className="flex justify-between text-neutral-700">
                  <span>+ {a.name}</span>
                  <span>+{formatCurrency(a.amount, data.settings.currency)}</span>
                </div>
              ))}

              {data.settings.salaryConfig.deductions.map(d => (
                <div key={d.id} className="flex justify-between text-neutral-700">
                  <span>- {d.name}</span>
                  <span>-{formatCurrency(d.amount, data.settings.currency)}</span>
                </div>
              ))}

              <div className="flex justify-between text-base font-extrabold text-[#111111] pt-3 border-t border-neutral-300">
                <span>NET SALARY PAYOUT</span>
                <span className="text-[#111111]">{formatCurrency(estimatedSalary.netSalary, data.settings.currency)}</span>
              </div>
            </div>

            <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200">
              <label className="flex items-center gap-2 text-xs text-neutral-800 font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={isSyncingToIncome}
                  onChange={(e) => setIsSyncingToIncome(e.target.checked)}
                  className="rounded text-[#111111] focus:ring-[#87CEEB]"
                />
                <span>Automatically sync to Income Module (Prevents double-counting)</span>
              </label>
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-neutral-100">
              <button
                type="button"
                onClick={() => setIsPayslipOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRecordPayout}
                className={`px-5 py-2 text-xs font-semibold rounded-xl text-white transition-colors cursor-pointer ${
                  existingPayout ? 'bg-amber-600 hover:bg-amber-700' : 'bg-[#111111] hover:bg-black'
                }`}
              >
                {existingPayout ? 'Confirm & Replace Payout' : 'Confirm & Record Payout'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Accessible Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteTargetId !== null}
        title="Delete Payout Record"
        message="Are you sure you want to delete this recorded payout? If synced to income, the corresponding income transaction will also be removed."
        confirmLabel="Delete Payout"
        onConfirm={() => {
          if (deleteTargetId) data.deleteSalaryPayout(deleteTargetId);
          setDeleteTargetId(null);
        }}
        onCancel={() => setDeleteTargetId(null)}
      />
    </div>
  );
};
