import React, { useState, useEffect, useRef, useMemo } from 'react';
import { CreditCard, TrendingUp, CalendarCheck, Target, PiggyBank } from 'lucide-react';
import { useXOSData } from '../../hooks/useXOSData';
import {
  AttendanceDayType,
  ExpenseCategory,
  IncomeSource,
  PaymentMethod,
  SelectableAttendanceStatus
} from '../../types';
import { getIstTodayString, getTodayString, formatCurrency } from '../../utils/formatters';
import { calculateDailyEarnedSalary, isSalaryConfigured, resolveGoalsWithSavings } from '../../utils/calculations';
import { sanitizeDatabaseErrorMessage } from '../../utils/authValidation';
import {
  Modal,
  SegmentedControl,
  INPUT_CLASS,
  MONO_INPUT_CLASS,
  SELECT_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS
} from '../ui';

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

  useEffect(() => {
    if (isOpen) {
      setActiveTab(defaultAction);
    }
  }, [isOpen, defaultAction]);

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
  const [attStatus, setAttStatus] = useState<SelectableAttendanceStatus>('Present');
  const [attDayType, setAttDayType] = useState<AttendanceDayType>('full_day');
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
      setAttDayType('full_day');
      setAttNotes('');
      setGoalTitle('');
      setGoalTargetAmount('');
      setGoalTargetDate('');
      setSavingsAmount('');
    }
  }, [isOpen, data.settings.customExpenseCategories, data.settings.customIncomeSources]);

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
    } catch (err: unknown) {
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
    } catch (err: unknown) {
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
    isSubmittingRef.current = true;
    setActionError(null);
    setIsSubmitting(true);
    try {
      await data.upsertAttendanceRecord({
        date: attDate,
        status: attStatus,
        dayType: attStatus === 'Present' ? attDayType : undefined,
        notes: attNotes.trim()
      });
      onClose();
    } catch (err: unknown) {
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
    } catch (err: unknown) {
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
    } catch (err: unknown) {
      setActionError(sanitizeDatabaseErrorMessage(err, 'Database error: Could not save savings transaction.'));
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const tabs = [
    { id: 'expense' as const, label: 'Expense', icon: CreditCard },
    { id: 'income' as const, label: 'Income', icon: TrendingUp },
    { id: 'attendance' as const, label: 'Work', icon: CalendarCheck },
    { id: 'goal' as const, label: 'Goal', icon: Target },
    { id: 'savings' as const, label: 'Savings', icon: PiggyBank }
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      disableClose={isSubmitting}
      title="Log Activity"
      subtitle="Add a transaction, work log, goal, or savings entry"
      maxWidth="lg"
    >
      <div className="space-y-5">
        <SegmentedControl
          options={tabs.map(t => ({ id: t.id, label: t.label }))}
          value={activeTab}
          onChange={setActiveTab}
          ariaLabel="Activity type"
          fullWidth
          size="md"
        />

        {actionError && (
          <div className="p-3 text-xs bg-[#fef2f2] border border-[#c92a2a]/20 text-[#991b1b] rounded-xl font-medium">
            {actionError}
          </div>
        )}

        {activeTab === 'expense' && (
          <form onSubmit={handleAddExpense} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLASS}>Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Groceries"
                  value={expenseTitle}
                  onChange={(e) => setExpenseTitle(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Amount ({data.settings.currency}) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="0.00"
                  value={expenseAmount}
                  onChange={(e) => setExpenseAmount(e.target.value)}
                  className={MONO_INPUT_CLASS}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLASS}>Category</label>
                <select
                  value={expenseCategory}
                  onChange={(e) => setExpenseCategory(e.target.value)}
                  className={SELECT_CLASS}
                >
                  {expenseCategories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLASS}>Date</label>
                <input
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLASS}>Payment Method</label>
                <select
                  value={expensePaymentMethod}
                  onChange={(e) => setExpensePaymentMethod(e.target.value as PaymentMethod)}
                  className={SELECT_CLASS}
                >
                  <option value="Cash">Cash</option>
                  <option value="Credit Card">Credit Card</option>
                  <option value="Debit Card">Debit Card</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Digital Wallet">Digital Wallet</option>
                </select>
              </div>
              <div>
                <label className={LABEL_CLASS}>Notes</label>
                <input
                  type="text"
                  placeholder="Short description"
                  value={expenseNotes}
                  onChange={(e) => setExpenseNotes(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
            </div>

            <div className="pt-3 flex justify-end gap-2 border-t border-black/[0.06]">
              <button type="button" disabled={isSubmitting} onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
                Cancel
              </button>
              <button type="submit" disabled={isSubmitting} className={PRIMARY_BUTTON_CLASS}>
                {isSubmitting ? 'Saving…' : 'Save Expense'}
              </button>
            </div>
          </form>
        )}

        {activeTab === 'income' && (
          <form onSubmit={handleAddIncome} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLASS}>Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Monthly Salary"
                  value={incomeTitle}
                  onChange={(e) => setIncomeTitle(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Amount ({data.settings.currency}) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="0.00"
                  value={incomeAmount}
                  onChange={(e) => setIncomeAmount(e.target.value)}
                  className={MONO_INPUT_CLASS}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLASS}>Source</label>
                <select
                  value={incomeSource}
                  onChange={(e) => setIncomeSource(e.target.value)}
                  className={SELECT_CLASS}
                >
                  {incomeSources.map((src) => (
                    <option key={src} value={src}>{src}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLASS}>Date</label>
                <input
                  type="date"
                  value={incomeDate}
                  onChange={(e) => setIncomeDate(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
            </div>

            <div>
              <label className={LABEL_CLASS}>Notes</label>
              <input
                type="text"
                placeholder="Additional details"
                value={incomeNotes}
                onChange={(e) => setIncomeNotes(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>

            <div className="pt-3 flex justify-end gap-2 border-t border-black/[0.06]">
              <button type="button" disabled={isSubmitting} onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
                Cancel
              </button>
              <button type="submit" disabled={isSubmitting} className={PRIMARY_BUTTON_CLASS}>
                {isSubmitting ? 'Saving…' : 'Save Income'}
              </button>
            </div>
          </form>
        )}

        {activeTab === 'attendance' && (
          <form onSubmit={handleSaveAttendance} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLASS}>Date</label>
                <input
                  type="date"
                  max={istTodayStr}
                  value={attDate}
                  onChange={(e) => setAttDate(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Status</label>
                <select
                  value={attStatus}
                  onChange={(e) => setAttStatus(e.target.value as SelectableAttendanceStatus)}
                  className={SELECT_CLASS}
                >
                  <option value="Present">Present</option>
                  <option value="Absent">Absent</option>
                  <option value="Holiday">Holiday</option>
                </select>
              </div>
            </div>

            {attStatus === 'Present' && (
              <div className="space-y-2.5 p-3.5 bg-[#f5f5f7] rounded-xl">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[#6e6e73]">Day Type</span>
                  <span className="text-xs font-mono font-semibold text-[#1d1d1f] tabular-nums">
                    {isSalaryConfigured(data.settings.salaryConfig)
                      ? formatCurrency(
                          calculateDailyEarnedSalary('Present', attDayType, data.settings.salaryConfig)
                            .dailyEarnedSalary,
                          data.settings.currency
                        )
                      : 'Daily Salary unset'}
                  </span>
                </div>
                <SegmentedControl
                  options={[
                    { id: 'full_day' as const, label: 'Full Day' },
                    { id: 'half_day' as const, label: 'Half Day' }
                  ]}
                  value={attDayType}
                  onChange={setAttDayType}
                  ariaLabel="Attendance day type"
                  fullWidth
                  size="md"
                />
              </div>
            )}

            <div>
              <label className={LABEL_CLASS}>Notes</label>
              <input
                type="text"
                placeholder="Optional note"
                value={attNotes}
                onChange={(e) => setAttNotes(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>

            <div className="pt-3 flex justify-end gap-2 border-t border-black/[0.06]">
              <button type="button" disabled={isSubmitting} onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
                Cancel
              </button>
              <button type="submit" disabled={isSubmitting} className={PRIMARY_BUTTON_CLASS}>
                {isSubmitting ? 'Saving…' : 'Log Attendance'}
              </button>
            </div>
          </form>
        )}

        {activeTab === 'goal' && (
          <form onSubmit={handleAddGoal} className="space-y-4">
            <div>
              <label className={LABEL_CLASS}>Goal Title *</label>
              <input
                type="text"
                required
                placeholder="e.g. Emergency buffer"
                value={goalTitle}
                onChange={(e) => setGoalTitle(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLASS}>Target Amount ({data.settings.currency}) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="0.00"
                  value={goalTargetAmount}
                  onChange={(e) => setGoalTargetAmount(e.target.value)}
                  className={MONO_INPUT_CLASS}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Category</label>
                <select
                  value={goalCategory}
                  onChange={(e) => setGoalCategory(e.target.value)}
                  className={SELECT_CLASS}
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
                <label className={LABEL_CLASS}>Priority</label>
                <select
                  value={goalPriority}
                  onChange={(e) => setGoalPriority(e.target.value as 'Low' | 'Medium' | 'High')}
                  className={SELECT_CLASS}
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                </select>
              </div>
              <div>
                <label className={LABEL_CLASS}>Target Date (Optional)</label>
                <input
                  type="date"
                  value={goalTargetDate}
                  onChange={(e) => setGoalTargetDate(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
            </div>

            <div className="pt-3 flex justify-end gap-2 border-t border-black/[0.06]">
              <button type="button" disabled={isSubmitting} onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
                Cancel
              </button>
              <button type="submit" disabled={isSubmitting} className={PRIMARY_BUTTON_CLASS}>
                {isSubmitting ? 'Saving…' : 'Create Goal'}
              </button>
            </div>
          </form>
        )}

        {activeTab === 'savings' && (
          <form onSubmit={handleAddSavingsTx} className="space-y-4">
            {availableSavingsGoals.length === 0 ? (
              <div className="p-5 text-center text-xs text-[#6e6e73] bg-[#f5f5f7] rounded-xl">
                No active goal savings funds available yet. Create a goal first under the Goal tab.
              </div>
            ) : (
              <>
                <div>
                  <label className={LABEL_CLASS}>Target Savings Fund</label>
                  <select
                    value={savingsGoalId}
                    onChange={(e) => setSavingsGoalId(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    {availableSavingsGoals.map((sg) => (
                      <option key={sg.id} value={sg.id}>{sg.name}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL_CLASS}>Transaction Type</label>
                    <select
                      value={savingsType}
                      onChange={(e) => setSavingsType(e.target.value as 'deposit' | 'withdrawal')}
                      className={SELECT_CLASS}
                    >
                      <option value="deposit">Deposit (+)</option>
                      <option value="withdrawal">Withdrawal (-)</option>
                    </select>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Amount ({data.settings.currency}) *</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      placeholder="0.00"
                      value={savingsAmount}
                      onChange={(e) => setSavingsAmount(e.target.value)}
                      className={MONO_INPUT_CLASS}
                    />
                  </div>
                </div>

                <div className="pt-3 flex justify-end gap-2 border-t border-black/[0.06]">
                  <button type="button" disabled={isSubmitting} onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
                    Cancel
                  </button>
                  <button type="submit" disabled={isSubmitting} className={PRIMARY_BUTTON_CLASS}>
                    {isSubmitting ? 'Saving…' : 'Save Transaction'}
                  </button>
                </div>
              </>
            )}
          </form>
        )}
      </div>
    </Modal>
  );
};
