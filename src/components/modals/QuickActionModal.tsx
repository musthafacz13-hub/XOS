import React, { useState, useEffect, useRef, useMemo } from 'react';
import { X, CreditCard, TrendingUp, CalendarCheck, Target, PiggyBank } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useXOSData } from '../../hooks/useXOSData';
import { AttendanceStatus, ExpenseCategory, IncomeSource, PaymentMethod } from '../../types';
import {
  getIstTodayString,
  getTodayString,
  formatCurrency,
  calculateWorkingHours,
  getShiftSpanMinutes,
  isOvernightShift
} from '../../utils/formatters';
import { resolveGoalsWithSavings } from '../../utils/calculations';
import { modalBackdropVariants, modalContentVariants, MOTION_SPRINGS } from '../../utils/motion';
import { sanitizeDatabaseErrorMessage } from '../../utils/authValidation';

interface QuickActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultAction?: 'expense' | 'income' | 'attendance' | 'goal' | 'savings';
}

export const QuickActionModal: React.FC<QuickActionModalProps> = ({
  isOpen,
  onClose,
  defaultAction = 'expense'
}) => {
  const data = useXOSData();
  const [activeTab, setActiveTab] = useState<'expense' | 'income' | 'attendance' | 'goal' | 'savings'>(defaultAction);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Sync tab with defaultAction prop when opened
  useEffect(() => {
    if (isOpen) {
      setActiveTab(defaultAction);
    }
  }, [isOpen, defaultAction]);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, isSubmitting]);

  // Expense State
  const [expenseTitle, setExpenseTitle] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState<ExpenseCategory>(() => data.settings.customExpenseCategories[0] || 'Other');
  const [expenseDate, setExpenseDate] = useState(getTodayString());
  const [expenseTime, setExpenseTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [expensePaymentMethod, setExpensePaymentMethod] = useState<PaymentMethod>('Credit Card');
  const [expenseNotes, setExpenseNotes] = useState('');

  // Income State
  const [incomeTitle, setIncomeTitle] = useState('');
  const [incomeAmount, setIncomeAmount] = useState('');
  const [incomeSource, setIncomeSource] = useState<IncomeSource>(() => data.settings.customIncomeSources[0] || 'Other');
  const [incomeDate, setIncomeDate] = useState(getTodayString());
  const [incomeTime, setIncomeTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [incomeNotes, setIncomeNotes] = useState('');

  // Attendance State
  const [attDate, setAttDate] = useState(getIstTodayString());
  const [attStatus, setAttStatus] = useState<AttendanceStatus>('Present');
  const [attIn, setAttIn] = useState('');
  const [attOut, setAttOut] = useState('');
  const [attBreak, setAttBreak] = useState('');
  const [attNotes, setAttNotes] = useState('');

  // Goal State
  const [goalTitle, setGoalTitle] = useState('');
  const [goalCategory, setGoalCategory] = useState('Personal');
  const [goalTargetAmount, setGoalTargetAmount] = useState('');
  const [goalTargetDate, setGoalTargetDate] = useState('');
  const [goalPriority, setGoalPriority] = useState<'Low' | 'Medium' | 'High'>('Medium');

  const expenseCategories = useMemo(() => {
    const list = (data.settings.customExpenseCategories || []).filter(Boolean);
    return list.length > 0 ? Array.from(new Set(list)) : ['Other'];
  }, [data.settings.customExpenseCategories]);

  const incomeSources = useMemo(() => {
    const list = (data.settings.customIncomeSources || []).filter(Boolean);
    return list.length > 0 ? Array.from(new Set(list)) : ['Other'];
  }, [data.settings.customIncomeSources]);

  const availableSavingsGoals = useMemo(() => {
    const resolved = resolveGoalsWithSavings(data.goals, data.savingsGoals);
    const activeLinked = resolved
      .filter(item => item.savingsGoal && !item.isArchived)
      .map(item => item.savingsGoal!);
    if (activeLinked.length > 0) {
      return activeLinked;
    }
    const archivedIds = new Set(
      data.goals
        .filter(g => g.status === 'Archived' && g.savingsGoalId)
        .map(g => g.savingsGoalId as string)
    );
    return Array.from(
      new Map(
        data.savingsGoals
          .filter(sg => sg && sg.id && !sg.isArchived && !archivedIds.has(sg.id))
          .map(sg => [sg.id, sg])
      ).values()
    );
  }, [data.goals, data.savingsGoals]);

  // Savings State
  const [savingsGoalId, setSavingsGoalId] = useState(availableSavingsGoals[0]?.id || '');
  const [savingsAmount, setSavingsAmount] = useState('');
  const [savingsType, setSavingsType] = useState<'deposit' | 'withdrawal'>('deposit');

  useEffect(() => {
    if (availableSavingsGoals.length === 0) {
      if (savingsGoalId) setSavingsGoalId('');
      return;
    }
    if (!savingsGoalId || !availableSavingsGoals.some(g => g.id === savingsGoalId)) {
      setSavingsGoalId(availableSavingsGoals[0].id);
    }
  }, [availableSavingsGoals, savingsGoalId]);

  // Reset form values & dates when modal opens
  useEffect(() => {
    if (isOpen) {
      const nowToday = getTodayString();
      const nowTime = new Date().toTimeString().slice(0, 5);
      setExpenseTitle('');
      setExpenseAmount('');
      setExpenseCategory(data.settings.customExpenseCategories[0] || 'Other');
      setExpenseDate(nowToday);
      setExpenseTime(nowTime);
      setExpenseNotes('');
      setIncomeTitle('');
      setIncomeAmount('');
      setIncomeSource(data.settings.customIncomeSources[0] || 'Other');
      setIncomeDate(nowToday);
      setIncomeTime(nowTime);
      setIncomeNotes('');
      setAttDate(getIstTodayString());
      setAttStatus('Present');
      setAttIn('');
      setAttOut('');
      setAttBreak('');
      setAttNotes('');
      setGoalTitle('');
      setGoalTargetAmount('');
      setGoalTargetDate('');
      setSavingsAmount('');
    }
  }, [isOpen, data.settings.customExpenseCategories, data.settings.customIncomeSources]);

  // Clear errors when tab or open state changes
  useEffect(() => {
    setActionError(null);
    isSubmittingRef.current = false;
    setIsSubmitting(false);
  }, [activeTab, isOpen]);

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || isSubmitting) return;

    if (!expenseTitle.trim()) {
      setActionError('Expense title is required.');
      return;
    }

    const numAmount = parseFloat(expenseAmount);
    if (!expenseAmount || isNaN(numAmount) || numAmount <= 0) {
      setActionError('Expense amount must be greater than zero.');
      return;
    }

    isSubmittingRef.current = true;
    setActionError(null);
    setIsSubmitting(true);
    try {
      await data.addExpense({
        title: expenseTitle.trim(),
        amount: numAmount,
        category: expenseCategory,
        date: expenseDate,
        time: expenseTime,
        paymentMethod: expensePaymentMethod,
        notes: expenseNotes.trim()
      });
      onClose();
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('Failed to add expense:', err);
      }
      setActionError(sanitizeDatabaseErrorMessage(err, 'Database error: Could not save expense.'));
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleAddIncome = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || isSubmitting) return;

    if (!incomeTitle.trim()) {
      setActionError('Income title is required.');
      return;
    }

    const numAmount = parseFloat(incomeAmount);
    if (!incomeAmount || isNaN(numAmount) || numAmount <= 0) {
      setActionError('Income amount must be greater than zero.');
      return;
    }

    isSubmittingRef.current = true;
    setActionError(null);
    setIsSubmitting(true);
    try {
      await data.addIncome({
        title: incomeTitle.trim(),
        amount: numAmount,
        source: incomeSource,
        date: incomeDate,
        time: incomeTime,
        notes: incomeNotes.trim()
      });
      onClose();
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('Failed to add income:', err);
      }
      setActionError(sanitizeDatabaseErrorMessage(err, 'Database error: Could not save income.'));
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const istTodayStr = getIstTodayString();

  const handleSaveAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || isSubmitting) return;
    if (attDate > getIstTodayString()) {
      setActionError('Attendance cannot be logged for future dates.');
      return;
    }
    const rawBreak = attBreak.trim();
    const parsedBreak = attStatus === 'Present' ? (rawBreak === '' ? 0 : Number(rawBreak)) : 0;
    let hours = 0;
    if (attStatus === 'Present') {
      if (!attIn || !attOut) {
        setActionError('Please enter both In Time and Out Time.');
        return;
      }
      if (!Number.isFinite(parsedBreak) || parsedBreak < 0) {
        setActionError('Break duration must be zero or a positive number.');
        return;
      }
      const shiftMins = getShiftSpanMinutes(attIn, attOut);
      if (parsedBreak >= shiftMins) {
        setActionError('Break duration must be shorter than total shift duration.');
        return;
      }
      hours = calculateWorkingHours(attIn, attOut, parsedBreak);
    }
    isSubmittingRef.current = true;
    setActionError(null);
    setIsSubmitting(true);
    try {
      await data.upsertAttendanceRecord({
        date: attDate,
        status: attStatus,
        checkInTime: attStatus === 'Present' ? attIn : undefined,
        checkOutTime: attStatus === 'Present' ? attOut : undefined,
        breakDurationMinutes: parsedBreak,
        calculatedHours: attStatus === 'Present' ? hours : 0,
        notes: attNotes.trim()
      });
      onClose();
    } catch (err: any) {
      setActionError(sanitizeDatabaseErrorMessage(err, 'Database error: Could not log attendance.'));
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleAddGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || isSubmitting) return;
    if (!goalTitle.trim()) {
      setActionError('Goal title is required.');
      return;
    }
    const parsedTarget = parseFloat(goalTargetAmount);
    if (isNaN(parsedTarget) || parsedTarget <= 0) {
      setActionError('Target amount is required and must be greater than zero.');
      return;
    }
    isSubmittingRef.current = true;
    setActionError(null);
    setIsSubmitting(true);
    try {
      await data.addGoal({
        title: goalTitle.trim(),
        description: '',
        category: goalCategory,
        targetAmount: parsedTarget,
        targetDate: goalTargetDate || undefined,
        priority: goalPriority
      });
      onClose();
    } catch (err: any) {
      setActionError(sanitizeDatabaseErrorMessage(err, 'Database error: Could not save goal.'));
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleAddSavingsTx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!savingsGoalId || isSubmittingRef.current || isSubmitting) return;
    const parsedAmount = parseFloat(savingsAmount);
    if (!savingsAmount || isNaN(parsedAmount) || parsedAmount <= 0) {
      setActionError('Transaction amount must be greater than zero.');
      return;
    }
    if (savingsType === 'withdrawal') {
      const targetSg = availableSavingsGoals.find(sg => sg.id === savingsGoalId);
      const currentSaved = targetSg?.currentAmount || 0;
      if (parsedAmount > currentSaved + 0.001) {
        setActionError(`Withdrawal cannot exceed saved balance of ${formatCurrency(currentSaved, data.settings.currency)}.`);
        return;
      }
    }
    isSubmittingRef.current = true;
    setActionError(null);
    setIsSubmitting(true);
    try {
      await data.addSavingsTransaction({
        savingsGoalId,
        amount: parsedAmount,
        type: savingsType,
        date: getTodayString(),
        note: 'Quick entry'
      });
      onClose();
    } catch (err: any) {
      setActionError(sanitizeDatabaseErrorMessage(err, 'Database error: Could not save savings transaction.'));
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          variants={modalBackdropVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
          onClick={() => { if (!isSubmitting) onClose(); }}
          role="dialog"
          aria-modal="true"
        >
          <motion.div 
            variants={modalContentVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="bg-white rounded-2xl max-w-lg w-full border border-black/[0.08] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-black/[0.06] bg-neutral-50/50">
              <h2 className="font-bold text-sm sm:text-base text-[#111111]">Quick Activity Log</h2>
              <motion.button
                whileTap={{ scale: 0.9 }}
                disabled={isSubmitting}
                onClick={onClose}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-black hover:bg-neutral-100 transition-colors cursor-pointer disabled:opacity-50"
                aria-label="Close dialog"
              >
                <X className="w-4 h-4" />
              </motion.button>
            </div>

            {/* Tab Selector with Fluid Sliding Capsule */}
            <div className="flex border-b border-black/[0.06] bg-neutral-100 p-1.5 gap-1 overflow-x-auto shrink-0 relative">
              {[
                { id: 'expense' as const, label: 'Expense', icon: CreditCard },
                { id: 'income' as const, label: 'Income', icon: TrendingUp },
                { id: 'attendance' as const, label: 'Work', icon: CalendarCheck },
                { id: 'goal' as const, label: 'Goal', icon: Target },
                { id: 'savings' as const, label: 'Savings', icon: PiggyBank },
              ].map(tab => {
                const Icon = tab.icon;
                const isSelected = activeTab === tab.id;
                return (
                  <motion.button
                    key={tab.id}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setActiveTab(tab.id)}
                    type="button"
                    className={`flex-1 min-w-[70px] py-1.5 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer relative z-10 ${
                      isSelected ? 'text-[#111111]' : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    {isSelected && (
                      <motion.div
                        layoutId="quickActionTabActive"
                        transition={MOTION_SPRINGS.tactile}
                        className="absolute inset-0 bg-white rounded-lg shadow-xs z-0"
                      />
                    )}
                    <Icon className="w-3.5 h-3.5 relative z-10" />
                    <span className="relative z-10">{tab.label}</span>
                  </motion.button>
                );
              })}
            </div>

            {/* Content Body */}
            <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4">
          {actionError && (
            <div className="p-3 text-xs bg-rose-50 border border-rose-200 text-rose-700 rounded-xl font-medium">
              {actionError}
            </div>
          )}

          {activeTab === 'expense' && (
            <form onSubmit={handleAddExpense} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Title *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Groceries"
                    value={expenseTitle}
                    onChange={(e) => setExpenseTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Amount ({data.settings.currency}) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="0.00"
                    value={expenseAmount}
                    onChange={(e) => setExpenseAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Category</label>
                  <select
                    value={expenseCategory}
                    onChange={(e) => setExpenseCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  >
                    {expenseCategories.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Payment Method</label>
                  <select
                    value={expensePaymentMethod}
                    onChange={(e) => setExpensePaymentMethod(e.target.value as PaymentMethod)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  >
                    <option value="Cash">Cash</option>
                    <option value="Credit Card">Credit Card</option>
                    <option value="Debit Card">Debit Card</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Digital Wallet">Digital Wallet</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Notes</label>
                  <input
                    type="text"
                    placeholder="Short description"
                    value={expenseNotes}
                    onChange={(e) => setExpenseNotes(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-neutral-100">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-xs font-semibold bg-[#111111] text-white hover:bg-black rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Save Expense'}
                </button>
              </div>
            </form>
          )}

          {activeTab === 'income' && (
            <form onSubmit={handleAddIncome} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Title *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Monthly Salary"
                    value={incomeTitle}
                    onChange={(e) => setIncomeTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Amount ({data.settings.currency}) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="0.00"
                    value={incomeAmount}
                    onChange={(e) => setIncomeAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Source</label>
                  <select
                    value={incomeSource}
                    onChange={(e) => setIncomeSource(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  >
                    {incomeSources.map((src) => (
                      <option key={src} value={src}>{src}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={incomeDate}
                    onChange={(e) => setIncomeDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Notes</label>
                <input
                  type="text"
                  placeholder="Additional details"
                  value={incomeNotes}
                  onChange={(e) => setIncomeNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-neutral-100">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-xs font-semibold bg-[#111111] text-white hover:bg-black rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Save Income'}
                </button>
              </div>
            </form>
          )}

          {activeTab === 'attendance' && (
            <form onSubmit={handleSaveAttendance} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Date</label>
                  <input
                    type="date"
                    max={istTodayStr}
                    value={attDate}
                    onChange={(e) => setAttDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Status</label>
                  <select
                    value={attStatus}
                    onChange={(e) => setAttStatus(e.target.value as AttendanceStatus)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  >
                    <option value="Present">Present</option>
                    <option value="Absent">Absent</option>
                    <option value="Leave">Leave</option>
                    <option value="Holiday">Holiday</option>
                  </select>
                </div>
              </div>

              {attStatus === 'Present' && (
                <div className="space-y-2 p-3 bg-neutral-50 rounded-xl border border-neutral-200">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div className="min-w-0">
                      <label className="block text-[11px] font-semibold text-neutral-700 mb-1">In Time</label>
                      <input
                        type="time"
                        value={attIn}
                        onChange={(e) => setAttIn(e.target.value)}
                        className="w-full min-h-[42px] px-2.5 py-2 text-xs font-mono border border-neutral-300 rounded-lg bg-white"
                      />
                    </div>
                    <div className="min-w-0">
                      <label className="block text-[11px] font-semibold text-neutral-700 mb-1">Out Time</label>
                      <input
                        type="time"
                        value={attOut}
                        onChange={(e) => setAttOut(e.target.value)}
                        className="w-full min-h-[42px] px-2.5 py-2 text-xs font-mono border border-neutral-300 rounded-lg bg-white"
                      />
                    </div>
                    <div className="min-w-0">
                      <label className="block text-[11px] font-semibold text-neutral-700 mb-1">Break (m)</label>
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={attBreak}
                        onChange={(e) => setAttBreak(e.target.value)}
                        className="w-full min-h-[42px] px-2.5 py-2 text-xs font-mono border border-neutral-300 rounded-lg bg-white"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-neutral-500">
                    {!attIn || !attOut
                      ? 'Enter in and out times to calculate hours'
                      : isOvernightShift(attIn, attOut)
                        ? `Overnight shift (+1 day) · Net: ${calculateWorkingHours(attIn, attOut, Math.max(0, parseInt(attBreak, 10) || 0))}h`
                        : `Net working hours: ${calculateWorkingHours(attIn, attOut, Math.max(0, parseInt(attBreak, 10) || 0))}h`}
                  </p>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Notes</label>
                <input
                  type="text"
                  placeholder="Summary of today's work"
                  value={attNotes}
                  onChange={(e) => setAttNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-neutral-100">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-xs font-semibold bg-[#111111] text-white hover:bg-black rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Log Attendance'}
                </button>
              </div>
            </form>
          )}

          {activeTab === 'goal' && (
            <form onSubmit={handleAddGoal} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Goal Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Save $5,000 for emergency buffer"
                  value={goalTitle}
                  onChange={(e) => setGoalTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Target Amount ({data.settings.currency}) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="e.g. 5000"
                    value={goalTargetAmount}
                    onChange={(e) => setGoalTargetAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Category</label>
                  <select
                    value={goalCategory}
                    onChange={(e) => setGoalCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  >
                    <option value="Financial">Financial</option>
                    <option value="Career">Career</option>
                    <option value="Health">Health</option>
                    <option value="Travel">Travel</option>
                    <option value="Learning">Learning</option>
                    <option value="Personal">Personal</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Priority</label>
                  <select
                    value={goalPriority}
                    onChange={(e) => setGoalPriority(e.target.value as 'Low' | 'Medium' | 'High')}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Target Date (Optional)</label>
                  <input
                    type="date"
                    value={goalTargetDate}
                    onChange={(e) => setGoalTargetDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-neutral-100">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-xs font-semibold bg-[#111111] text-white hover:bg-black rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Create Goal'}
                </button>
              </div>
            </form>
          )}

          {activeTab === 'savings' && (
            <form onSubmit={handleAddSavingsTx} className="space-y-4">
              {availableSavingsGoals.length === 0 ? (
                <div className="p-5 text-center text-xs text-neutral-500 bg-neutral-50 rounded-xl border border-neutral-200">
                  No active goal savings funds available yet. Create a goal first under the Goals tab.
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 mb-1">Target Savings Fund</label>
                    <select
                      value={savingsGoalId}
                      onChange={(e) => setSavingsGoalId(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                    >
                      {availableSavingsGoals.map((sg) => (
                        <option key={sg.id} value={sg.id}>{sg.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-neutral-700 mb-1">Transaction Type</label>
                      <select
                        value={savingsType}
                        onChange={(e) => setSavingsType(e.target.value as 'deposit' | 'withdrawal')}
                        className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                      >
                        <option value="deposit">Deposit (+)</option>
                        <option value="withdrawal">Withdrawal (-)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-neutral-700 mb-1">Amount ({data.settings.currency}) *</label>
                      <input
                        type="number"
                        step="0.01"
                        required
                        placeholder="0.00"
                        value={savingsAmount}
                        onChange={(e) => setSavingsAmount(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                      />
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end gap-2 border-t border-neutral-100">
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={onClose}
                      className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl cursor-pointer disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="px-5 py-2 text-xs font-semibold bg-[#111111] text-white hover:bg-black rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {isSubmitting ? 'Saving...' : 'Save Transaction'}
                    </button>
                  </div>
                </>
              )}
            </form>
          )}
        </div>
      </motion.div>
    </motion.div>
  )}
</AnimatePresence>
  );
};
