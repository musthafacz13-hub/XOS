import React, { useState, useEffect } from 'react';
import { Calculator, Plus, Trash2, Banknote, Check, AlertCircle, Calendar, Clock, DollarSign } from 'lucide-react';
import { useXOSData } from '../../hooks/useXOSData';
import { calculateMonthlySalarySummary } from '../../utils/calculations';
import { formatCurrency, formatHumanDate, getMonthString, getTodayString } from '../../utils/formatters';
import { EmptyState } from '../common/EmptyState';
import { ConfirmDialog } from '../common/ConfirmDialog';

export const SalaryView: React.FC = () => {
  const data = useXOSData();

  const [activeTab, setActiveTab] = useState<'summary' | 'payments' | 'settings'>('summary');
  const [selectedMonth, setSelectedMonth] = useState(getMonthString());

  // Deletion target
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeletingPayout, setIsDeletingPayout] = useState(false);
  const [deletePayoutError, setDeletePayoutError] = useState<string | null>(null);

  // Rate Settings form
  const [dailyBaseSalary, setDailyBaseSalary] = useState(data.settings.salaryConfig.dailyBaseSalary || 500);
  const [standardWorkingHours, setStandardWorkingHours] = useState(data.settings.salaryConfig.standardWorkingHours || 8);
  const [extraHourRate, setExtraHourRate] = useState(data.settings.salaryConfig.extraHourRate || 100);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [savedSettingsNotif, setSavedSettingsNotif] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // Salary Payment Modal
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(getTodayString());
  const [paymentNotes, setPaymentNotes] = useState('');
  const [isSyncingToIncome, setIsSyncingToIncome] = useState(true);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  useEffect(() => {
    setDailyBaseSalary(data.settings.salaryConfig.dailyBaseSalary || 500);
    setStandardWorkingHours(data.settings.salaryConfig.standardWorkingHours || 8);
    setExtraHourRate(data.settings.salaryConfig.extraHourRate || 100);
  }, [data.settings.salaryConfig]);

  // Monthly earnings summary calculation
  const monthlySummary = calculateMonthlySalarySummary(
    data.attendance,
    data.salaryPayouts,
    data.settings.salaryConfig,
    selectedMonth
  );

  const monthPayouts = data.salaryPayouts.filter(p => p.periodMonth === selectedMonth);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingSettings) return;
    setSettingsError(null);
    setSavedSettingsNotif(false);
    setIsSavingSettings(true);

    const updatedSalaryConfig = {
      ...data.settings.salaryConfig,
      currency: data.settings.currency || data.settings.salaryConfig.currency || 'INR',
      dailyBaseSalary,
      standardWorkingHours,
      extraHourRate
    };

    try {
      await data.persistSalaryConfig(updatedSalaryConfig);
      setSavedSettingsNotif(true);
      setTimeout(() => setSavedSettingsNotif(false), 3000);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to save salary rate settings.');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const openPaymentModal = () => {
    setPaymentAmount(String(monthlySummary.remainingSalary > 0 ? monthlySummary.remainingSalary : monthlySummary.earnedSalary));
    setPaymentDate(getTodayString());
    setPaymentNotes('');
    setIsSyncingToIncome(true);
    setPaymentError(null);
    setIsSubmittingPayment(false);
    setIsPaymentModalOpen(true);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingPayment) return;
    const parsedAmount = parseFloat(paymentAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setPaymentError('Please enter a valid salary payment amount greater than 0.');
      return;
    }

    setPaymentError(null);
    setIsSubmittingPayment(true);
    try {
      await data.recordSalaryPayout({
        periodMonth: selectedMonth,
        paymentDate,
        salaryType: 'daily_wage',
        baseAmount: data.settings.salaryConfig.dailyBaseSalary || 500,
        presentDays: monthlySummary.presentDays,
        absentDays: monthlySummary.absentDays,
        leaveDays: monthlySummary.leaveDays,
        holidayDays: 0,
        totalWorkingHours: monthlySummary.totalWorkingHours,
        overtimeHours: monthlySummary.totalExtraHours,
        grossSalary: monthlySummary.earnedSalary,
        totalAllowances: 0,
        totalDeductions: 0,
        netSalary: parsedAmount,
        status: 'Paid',
        notes: paymentNotes.trim() || `Salary payment for ${selectedMonth}`
      }, isSyncingToIncome, false);

      setIsPaymentModalOpen(false);
      setActiveTab('payments');
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Failed to record salary payment.');
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-black/[0.06]">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-[#111111] tracking-tight">
            Daily Salary & Earnings
          </h2>
          <p className="text-xs sm:text-sm text-neutral-500 font-normal mt-0.5">
            Automatic earnings calculation based on logged attendance hours and daily salary rates.
          </p>
        </div>

        {/* View Tabs */}
        <div className="flex items-center gap-1 bg-neutral-100 p-1 rounded-xl self-start sm:self-auto border border-neutral-200/60">
          <button
            type="button"
            onClick={() => setActiveTab('summary')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              activeTab === 'summary' ? 'bg-white text-[#111111] shadow-xs' : 'text-neutral-600 hover:text-black'
            }`}
          >
            Monthly Summary
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('payments')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              activeTab === 'payments' ? 'bg-white text-[#111111] shadow-xs' : 'text-neutral-600 hover:text-black'
            }`}
          >
            Payouts ({monthPayouts.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              activeTab === 'settings' ? 'bg-white text-[#111111] shadow-xs' : 'text-neutral-600 hover:text-black'
            }`}
          >
            Rate Settings
          </button>
        </div>
      </div>

      {/* MONTHLY SUMMARY TAB */}
      {activeTab === 'summary' && (
        <div className="space-y-6">
          {/* Month Selector */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-neutral-50 rounded-2xl border border-neutral-200">
            <div className="flex items-center gap-2">
              <Calculator className="w-4 h-4 text-[#87CEEB]" />
              <span className="font-bold text-sm text-[#111111]">Daily Earnings Period</span>
            </div>

            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-3 py-1.5 text-xs font-mono font-semibold border border-neutral-300 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
            />
          </div>

          {/* Main Dashboard Summary Area */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* Prominent Dark Summary Panel */}
            <div className="p-5 rounded-2xl bg-[#111111] text-white flex flex-col justify-between space-y-4 shadow-xs">
              <div>
                <div className="flex items-center justify-between text-neutral-400">
                  <span className="text-[11px] font-semibold uppercase tracking-wider">Earned Salary ({selectedMonth})</span>
                  <span className="text-[11px] font-mono text-[#87CEEB] tabular-nums">{monthlySummary.presentDays} days worked</span>
                </div>
                <div className="mt-3">
                  <div className="text-3xl font-extrabold font-mono tracking-tight text-white tabular-nums">
                    {formatCurrency(monthlySummary.earnedSalary, data.settings.currency)}
                  </div>
                  <p className="text-xs text-neutral-400 mt-1">
                    Calculated from logged attendance hours
                  </p>
                </div>
              </div>

              <button
                onClick={openPaymentModal}
                type="button"
                className="w-full py-2.5 bg-[#87CEEB] text-[#111111] text-xs font-bold rounded-xl hover:bg-sky-300 transition-colors text-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white flex items-center justify-center gap-1.5"
              >
                <Banknote className="w-4 h-4" />
                <span>Record Salary Payout</span>
              </button>
            </div>

            {/* Key Metrics Grid */}
            <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
              <div className="p-4 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-1.5 shadow-xs">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase">Salary Received</span>
                <div className="text-2xl sm:text-3xl font-bold font-mono text-emerald-600 tabular-nums">
                  {formatCurrency(monthlySummary.salaryReceived, data.settings.currency)}
                </div>
                <span className="text-[11px] text-neutral-400">{monthPayouts.length} payout records</span>
              </div>

              <div className="p-4 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-1.5 shadow-xs">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase">Remaining Salary Due</span>
                <div className="text-2xl sm:text-3xl font-bold font-mono text-[#111111] tabular-nums">
                  {formatCurrency(monthlySummary.remainingSalary, data.settings.currency)}
                </div>
                <span className="text-[11px] text-neutral-400">Balance to be paid</span>
              </div>

              <div className="p-4 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-1.5 shadow-xs">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase">Total Hours & Extra</span>
                <div className="text-2xl sm:text-3xl font-bold font-mono text-neutral-700 tabular-nums">
                  {monthlySummary.totalWorkingHours}h
                </div>
                <span className="text-[11px] text-neutral-400">Includes {monthlySummary.totalExtraHours}h extra hours</span>
              </div>
            </div>
          </div>

          {/* Breakdown & Config Info */}
          <div className="p-5 sm:p-6 rounded-2xl bg-white border border-black/[0.08] shadow-xs space-y-4">
            <h3 className="font-bold text-sm text-[#111111] border-b border-neutral-100 pb-3">
              Attendance & Extra Hours Breakdown
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
                <span className="text-[10px] font-semibold text-neutral-500 uppercase block">Present Days</span>
                <span className="text-xl font-bold font-mono text-[#111111] block tabular-nums">{monthlySummary.presentDays}</span>
                <span className="text-[10px] text-neutral-400">Logged days</span>
              </div>

              <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
                <span className="text-[10px] font-semibold text-neutral-500 uppercase block">Total Working Hours</span>
                <span className="text-xl font-bold font-mono text-[#111111] block tabular-nums">{monthlySummary.totalWorkingHours}h</span>
                <span className="text-[10px] text-neutral-400">Logged hours</span>
              </div>

              <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
                <span className="text-[10px] font-semibold text-neutral-500 uppercase block">Extra Hours</span>
                <span className="text-xl font-bold font-mono text-[#111111] block tabular-nums">{monthlySummary.totalExtraHours}h</span>
                <span className="text-[10px] text-neutral-400">Hours over {data.settings.salaryConfig.standardWorkingHours || 8}h/day</span>
              </div>

              <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
                <span className="text-[10px] font-semibold text-neutral-500 uppercase block">Leave / Absent</span>
                <span className="text-xl font-bold font-mono text-neutral-700 block tabular-nums">{monthlySummary.leaveDays + monthlySummary.absentDays}</span>
                <span className="text-[10px] text-neutral-400">₹0 earned on off days</span>
              </div>
            </div>

            <div className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 text-xs space-y-1.5 font-mono">
              <span className="font-bold text-[#111111] block">Active Rate Formula:</span>
              <p className="text-neutral-700">
                • Present Day Base: {formatCurrency(data.settings.salaryConfig.dailyBaseSalary || 500, data.settings.currency)} for up to {data.settings.salaryConfig.standardWorkingHours || 8} hours.
              </p>
              <p className="text-neutral-700">
                • Extra Hours: +{formatCurrency(data.settings.salaryConfig.extraHourRate || 100, data.settings.currency)}/hour for hours over {data.settings.salaryConfig.standardWorkingHours || 8}h.
              </p>
              <p className="text-neutral-700">
                • Leave / Absent: {formatCurrency(0, data.settings.currency)}.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* PAYOUT HISTORY TAB */}
      {activeTab === 'payments' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-neutral-50 rounded-2xl border border-neutral-200 text-xs">
            <span className="font-semibold text-neutral-700">Period: {selectedMonth}</span>
            <button
              type="button"
              onClick={openPaymentModal}
              className="px-3 py-1.5 bg-[#111111] text-white font-semibold rounded-xl hover:bg-black cursor-pointer"
            >
              + Record Salary Payout
            </button>
          </div>

          {monthPayouts.length === 0 ? (
            <EmptyState
              icon={Banknote}
              title="No salary payments recorded for this month"
              description={`You have earned ${formatCurrency(monthlySummary.earnedSalary, data.settings.currency)} for ${selectedMonth}. Record a payout to update your received salary.`}
              actionLabel="Record Payout"
              onAction={openPaymentModal}
            />
          ) : (
            <div className="bg-white rounded-2xl border border-black/[0.08] overflow-hidden shadow-xs">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-neutral-50/80 border-b border-black/[0.06] text-[11px] font-bold text-neutral-500 uppercase tracking-wider">
                    <th className="py-3 px-4">Payment Date</th>
                    <th className="py-3 px-4">Period</th>
                    <th className="py-3 px-4 text-right">Amount Paid</th>
                    <th className="py-3 px-4">Notes</th>
                    <th className="py-3 px-4 text-center">Income Sync</th>
                    <th className="py-3 px-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.06] text-xs text-neutral-700">
                  {monthPayouts.map((pay) => {
                    const isSynced = data.incomes.some(i => i.salaryPayoutId === pay.id);
                    return (
                      <tr key={pay.id} className="hover:bg-neutral-50/70 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-[#111111]">
                          {formatHumanDate(pay.paymentDate)}
                        </td>
                        <td className="py-3 px-4 font-mono text-neutral-600">
                          {pay.periodMonth}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600 tabular-nums">
                          {formatCurrency(pay.netSalary, data.settings.currency)}
                        </td>
                        <td className="py-3 px-4 text-neutral-600">
                          {pay.notes || 'Salary Payment'}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {isSynced ? (
                            <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-800 font-semibold">
                              Synced
                            </span>
                          ) : (
                            <span className="text-neutral-400 text-[10px]">Unsynced</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <button
                            type="button"
                            onClick={() => setDeleteTargetId(pay.id)}
                            className="p-1 text-neutral-400 hover:text-rose-600 cursor-pointer"
                            title="Delete Payout"
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
          )}
        </div>
      )}

      {/* RATE SETTINGS TAB */}
      {activeTab === 'settings' && (
        <form onSubmit={handleSaveSettings} className="p-5 sm:p-6 rounded-2xl bg-white border border-black/[0.08] shadow-xs space-y-5 max-w-xl">
          <div className="flex items-center justify-between pb-3 border-b border-black/[0.06]">
            <div>
              <h3 className="font-bold text-base text-[#111111]">Daily Salary Rate Settings</h3>
              <p className="text-xs text-neutral-500">Define base daily wage and extra hour compensation.</p>
            </div>
            {savedSettingsNotif && (
              <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Saved
              </span>
            )}
          </div>

          {settingsError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{settingsError}</span>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-neutral-700 mb-1">
                Daily Base Salary ({data.settings.currency})
              </label>
              <input
                type="number"
                required
                min="0"
                value={dailyBaseSalary}
                onChange={(e) => setDailyBaseSalary(parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
              />
              <p className="text-[11px] text-neutral-400 mt-1">
                Earned for working up to the standard daily hours. Default: ₹500
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-700 mb-1">
                Standard Working Hours / Day
              </label>
              <input
                type="number"
                required
                min="1"
                max="24"
                value={standardWorkingHours}
                onChange={(e) => setStandardWorkingHours(parseInt(e.target.value) || 8)}
                className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
              />
              <p className="text-[11px] text-neutral-400 mt-1">
                Hours required per day before extra hour rate applies. Default: 8
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-700 mb-1">
                Extra-Hour Rate ({data.settings.currency}/hour)
              </label>
              <input
                type="number"
                required
                min="0"
                value={extraHourRate}
                onChange={(e) => setExtraHourRate(parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
              />
              <p className="text-[11px] text-neutral-400 mt-1">
                Additional rate per hour worked past standard hours. Default: ₹100/hr
              </p>
            </div>

            <div className="pt-3 border-t border-neutral-100 flex justify-end">
              <button
                type="submit"
                disabled={isSavingSettings}
                className="px-5 py-2 text-xs font-semibold bg-[#111111] text-white rounded-xl hover:bg-black transition-colors cursor-pointer disabled:opacity-50"
              >
                {isSavingSettings ? 'Saving...' : 'Save Rate Settings'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* RECORD PAYMENT MODAL */}
      {isPaymentModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs"
          onClick={() => { if (!isSubmittingPayment) setIsPaymentModalOpen(false); }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-black/[0.08] p-5 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-black/[0.06]">
              <div>
                <h3 className="font-bold text-base text-[#111111]">Record Salary Payout</h3>
                <p className="text-xs text-neutral-500 font-mono">Period: {selectedMonth}</p>
              </div>
              <button
                type="button"
                disabled={isSubmittingPayment}
                onClick={() => setIsPaymentModalOpen(false)}
                className="p-1 text-neutral-400 hover:text-black cursor-pointer disabled:opacity-50"
              >
                ✕
              </button>
            </div>

            {paymentError && (
              <div className="mt-3 p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{paymentError}</span>
              </div>
            )}

            <form onSubmit={handleRecordPayment} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Payout Amount ({data.settings.currency}) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
                <p className="text-[11px] text-neutral-400 mt-1 font-mono">
                  Calculated earned: {formatCurrency(monthlySummary.earnedSalary, data.settings.currency)} · Remaining: {formatCurrency(monthlySummary.remainingSalary, data.settings.currency)}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Payment Date *
                </label>
                <input
                  type="date"
                  required
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Notes / Payment Reference (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Bank deposit reference"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200">
                <label className="flex items-center gap-2 text-xs text-neutral-800 font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isSyncingToIncome}
                    onChange={(e) => setIsSyncingToIncome(e.target.checked)}
                    className="rounded text-[#111111] focus:ring-[#87CEEB]"
                  />
                  <span>Automatically sync to Income Module</span>
                </label>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-neutral-100">
                <button
                  type="button"
                  disabled={isSubmittingPayment}
                  onClick={() => setIsPaymentModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingPayment}
                  className="px-5 py-2 text-xs font-semibold bg-[#111111] text-white rounded-xl hover:bg-black transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingPayment ? 'Saving...' : 'Record Salary Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={deleteTargetId !== null}
        title="Delete Salary Payout"
        message="Are you sure you want to delete this payout entry? If synced to income, the corresponding income transaction will also be removed."
        confirmLabel="Delete Payout"
        isLoading={isDeletingPayout}
        error={deletePayoutError}
        onConfirm={async () => {
          if (!deleteTargetId || isDeletingPayout) return;
          setIsDeletingPayout(true);
          setDeletePayoutError(null);
          try {
            await data.deleteSalaryPayout(deleteTargetId);
            setDeleteTargetId(null);
          } catch (err) {
            setDeletePayoutError(err instanceof Error ? err.message : 'Failed to delete salary payout.');
          } finally {
            setIsDeletingPayout(false);
          }
        }}
        onCancel={() => {
          setDeletePayoutError(null);
          setDeleteTargetId(null);
        }}
      />
    </div>
  );
};
