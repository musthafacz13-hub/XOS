import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Target, 
  Plus, 
  CheckCircle2, 
  Clock, 
  Trash2, 
  Edit3, 
  Search, 
  X, 
  PiggyBank, 
  ArrowUpRight, 
  ArrowDownLeft, 
  History,
  AlertCircle
} from 'lucide-react';
import { useXOSData } from '../../hooks/useXOSData';
import { Goal, GoalCategory, GoalPriority, GoalStatus, SavingsGoal, SavingsTransaction } from '../../types';
import { formatCurrency, formatHumanDate, getTodayString } from '../../utils/formatters';
import { EmptyState } from '../common/EmptyState';
import { ConfirmDialog } from '../common/ConfirmDialog';

export const GoalsAndSavingsView: React.FC = () => {
  const data = useXOSData();

  // Filters & Search
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'completed'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [isSubmittingGoal, setIsSubmittingGoal] = useState(false);
  const [goalFormError, setGoalFormError] = useState<string | null>(null);

  // Selected Goal for Savings Activity / Detail Modal (derived from live state)
  const [selectedDetailGoalId, setSelectedDetailGoalId] = useState<string | null>(null);
  const selectedDetailGoal = selectedDetailGoalId
    ? data.goals.find(g => g.id === selectedDetailGoalId) || null
    : null;

  // Deposit / Withdrawal Modal State
  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [txType, setTxType] = useState<'deposit' | 'withdrawal'>('deposit');
  const [txAmount, setTxAmount] = useState('');
  const [txNote, setTxNote] = useState('');
  const [txError, setTxError] = useState<string | null>(null);
  const [isSubmittingTx, setIsSubmittingTx] = useState(false);

  // Deletion State
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Form Fields - Goal
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<GoalCategory>('Personal');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [priority, setPriority] = useState<GoalPriority>('Medium');
  const [initialDeposit, setInitialDeposit] = useState('');

  // Escape key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isGoalModalOpen && !isSubmittingGoal) setIsGoalModalOpen(false);
        if (isTxModalOpen && !isSubmittingTx) setIsTxModalOpen(false);
        if (selectedDetailGoalId) setSelectedDetailGoalId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isGoalModalOpen, isTxModalOpen, isSubmittingGoal, isSubmittingTx, selectedDetailGoalId]);

  const savingsById = useMemo(
    () => new Map(data.savingsGoals.map(sg => [sg.id, sg])),
    [data.savingsGoals]
  );

  // Helper to find the connected Savings Goal via strict 1:1 ID relationship
  const getConnectedSavingsGoal = useCallback(
    (goal: Goal): SavingsGoal | undefined => savingsById.get(goal.savingsGoalId),
    [savingsById]
  );

  // Open Create Modal
  const openCreateModal = () => {
    setEditingGoal(null);
    setGoalFormError(null);
    setTitle('');
    setDescription('');
    setCategory('Personal');
    setTargetAmount('');
    setTargetDate('');
    setPriority('Medium');
    setInitialDeposit('');
    setIsGoalModalOpen(true);
  };

  // Open Edit Modal
  const openEditModal = (g: Goal) => {
    setEditingGoal(g);
    setGoalFormError(null);
    setTitle(g.title);
    setDescription(g.description || '');
    setCategory(g.category);
    setTargetAmount(g.targetAmount !== undefined ? String(g.targetAmount) : '');
    setTargetDate(g.targetDate || '');
    setPriority(g.priority);
    setInitialDeposit('');
    setIsGoalModalOpen(true);
  };

  // Handle Save Goal (Create or Update)
  const handleSaveGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || isSubmittingGoal) return;

    const parsedTarget = parseFloat(targetAmount);
    if (isNaN(parsedTarget) || parsedTarget <= 0) {
      setGoalFormError('Please enter a valid target amount greater than 0.');
      return;
    }

    const parsedInitial = initialDeposit ? parseFloat(initialDeposit) : 0;
    if (isNaN(parsedInitial) || parsedInitial < 0) {
      setGoalFormError('Initial deposit cannot be negative.');
      return;
    }

    setGoalFormError(null);
    setIsSubmittingGoal(true);

    try {
      if (editingGoal) {
        // Update Goal metadata (backend trigger synchronizes linked savings account & recalculates progress/completion)
        await data.updateGoal(editingGoal.id, {
          title: title.trim(),
          description: description.trim(),
          category,
          targetAmount: parsedTarget,
          targetDate: targetDate || undefined,
          priority
        });
      } else {
        // Create Goal (handled atomically via xos_create_goal_with_savings RPC on backend)
        await data.addGoal({
          title: title.trim(),
          description: description.trim(),
          category,
          targetAmount: parsedTarget,
          targetDate: targetDate || undefined,
          priority,
          initialDeposit: parsedInitial
        });
      }

      setIsGoalModalOpen(false);
    } catch (err) {
      setGoalFormError(err instanceof Error ? err.message : 'Failed to save goal & savings account.');
    } finally {
      setIsSubmittingGoal(false);
    }
  };

  // Open Deposit / Withdrawal Modal
  const openTxModal = (type: 'deposit' | 'withdrawal') => {
    setTxType(type);
    setTxAmount('');
    setTxNote('');
    setTxError(null);
    setIsTxModalOpen(true);
  };

  // Handle Save Transaction (Deposit / Withdrawal)
  const handleSaveTx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDetailGoal || isSubmittingTx) return;

    const parsedAmount = parseFloat(txAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setTxError('Please enter a valid amount greater than 0.');
      return;
    }

    const connectedSg = getConnectedSavingsGoal(selectedDetailGoal);
    if (!connectedSg) {
      setTxError('No connected savings account found for this goal.');
      return;
    }

    const currentSaved = connectedSg.currentAmount || 0;
    if (txType === 'withdrawal' && parsedAmount > currentSaved + 0.001) {
      setTxError(`Withdrawal cannot exceed saved balance of ${formatCurrency(currentSaved, data.settings.currency)}.`);
      return;
    }

    setTxError(null);
    setIsSubmittingTx(true);

    try {
      await data.addSavingsTransaction({
        savingsGoalId: connectedSg.id,
        amount: parsedAmount,
        type: txType,
        date: getTodayString(),
        note: txNote.trim() || (txType === 'deposit' ? 'Goal Deposit' : 'Goal Withdrawal')
      });

      setIsTxModalOpen(false);
    } catch (err) {
      setTxError(err instanceof Error ? err.message : 'Failed to record transaction.');
    } finally {
      setIsSubmittingTx(false);
    }
  };

  // Handle Goal Deletion (delegates atomically to xos_archive_goal RPC)
  const handleDeleteGoal = async () => {
    if (!deleteTargetId || isDeleting) return;
    setDeleteError(null);
    setIsDeleting(true);

    try {
      await data.deleteGoal(deleteTargetId);
      if (selectedDetailGoalId === deleteTargetId) {
        setSelectedDetailGoalId(null);
      }
      setDeleteTargetId(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete goal.');
    } finally {
      setIsDeleting(false);
    }
  };

  // Totals across all goals & connected savings
  const goalTotals = useMemo(() => {
    const totalTargetAmount = data.goals.reduce((sum, g) => sum + (g.targetAmount || 0), 0);
    const totalSavedAmount = data.savingsGoals.reduce((sum, sg) => sum + (sg.currentAmount || 0), 0);
    const totalRemainingAmount = Math.max(0, totalTargetAmount - totalSavedAmount);
    const overallProgress = totalTargetAmount > 0 ? Math.min(100, Math.round((totalSavedAmount / totalTargetAmount) * 100)) : 0;

    let activeGoalsCount = 0;
    let completedGoalsCount = 0;
    data.goals.forEach(g => {
      const sg = savingsById.get(g.savingsGoalId);
      const saved = sg?.currentAmount || 0;
      const target = g.targetAmount || 0;
      if (sg && target > 0 && saved >= target) {
        completedGoalsCount += 1;
      }
      if (!sg || saved < target) {
        activeGoalsCount += 1;
      }
    });

    return {
      totalTargetAmount,
      totalSavedAmount,
      totalRemainingAmount,
      overallProgress,
      activeGoalsCount,
      completedGoalsCount
    };
  }, [data.goals, data.savingsGoals, savingsById]);

  const {
    totalTargetAmount,
    totalSavedAmount,
    totalRemainingAmount,
    overallProgress,
    activeGoalsCount,
    completedGoalsCount
  } = goalTotals;

  // Filtered goals
  const filteredGoals = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return data.goals.filter(g => {
      const connectedSg = savingsById.get(g.savingsGoalId);
      const saved = connectedSg?.currentAmount || 0;
      const target = g.targetAmount || 0;
      const isCompleted = target > 0 && saved >= target;

      if (activeTab === 'active' && isCompleted) return false;
      if (activeTab === 'completed' && !isCompleted) return false;
      if (selectedCategory !== 'all' && g.category !== selectedCategory) return false;
      if (q) {
        return g.title.toLowerCase().includes(q) || (g.description && g.description.toLowerCase().includes(q));
      }
      return true;
    });
  }, [data.goals, savingsById, activeTab, selectedCategory, searchQuery]);

  const selectedGoalTransactions = useMemo(() => {
    if (!selectedDetailGoal) return [];
    const connectedSg = savingsById.get(selectedDetailGoal.savingsGoalId);
    if (!connectedSg) return [];
    return data.savingsTransactions
      .filter(tx => tx.savingsGoalId === connectedSg.id)
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [selectedDetailGoal, savingsById, data.savingsTransactions]);

  const categories = ['Financial', 'Career', 'Health', 'Travel', 'Learning', 'Life', 'Personal'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-black/[0.06]">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-[#111111] tracking-tight">
            Goals & Savings System
          </h2>
          <p className="text-xs sm:text-sm text-neutral-500 font-normal mt-0.5">
            One connected savings account per goal. Deposit, withdraw, and track real progress automatically.
          </p>
        </div>

        <button
          onClick={openCreateModal}
          type="button"
          className="self-start sm:self-auto flex items-center gap-1.5 px-3.5 py-2 bg-[#111111] text-white text-xs font-semibold rounded-xl hover:bg-black transition-colors shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
        >
          <Plus className="w-4 h-4 text-[#87CEEB]" />
          <span>New Goal & Savings Account</span>
        </button>
      </div>

      {/* Overview Dashboard Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
        {/* Total Saved Card */}
        <div className="p-5 rounded-2xl bg-[#111111] text-white flex flex-col justify-between space-y-4 shadow-xs">
          <div>
            <div className="flex items-center justify-between text-neutral-400">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Total Saved Across Goals</span>
              <PiggyBank className="w-4 h-4 text-[#87CEEB]" />
            </div>
            <div className="mt-3">
              <div className="text-3xl font-extrabold font-mono tracking-tight text-white tabular-nums">
                {formatCurrency(totalSavedAmount, data.settings.currency)}
              </div>
              <p className="text-xs text-neutral-400 mt-1">
                Target sum: {formatCurrency(totalTargetAmount, data.settings.currency)} ({overallProgress}%)
              </p>
            </div>
          </div>
          <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
            <div className="bg-[#87CEEB] h-full transition-all duration-300" style={{ width: `${overallProgress}%` }} />
          </div>
        </div>

        {/* Total Remaining Card */}
        <div className="p-5 rounded-2xl bg-white border border-black/[0.08] text-[#111111] flex flex-col justify-between space-y-4 shadow-xs">
          <div>
            <div className="flex items-center justify-between text-neutral-500">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Remaining to Save</span>
              <Target className="w-4 h-4 text-neutral-600" />
            </div>
            <div className="mt-3">
              <div className="text-3xl font-extrabold font-mono tracking-tight text-[#111111] tabular-nums">
                {formatCurrency(totalRemainingAmount, data.settings.currency)}
              </div>
              <p className="text-xs text-neutral-500 mt-1">
                Across {data.goals.length} active goal accounts
              </p>
            </div>
          </div>
          <div className="text-[11px] font-mono text-neutral-400 pt-2 border-t border-neutral-100 flex justify-between">
            <span>Active Goals:</span>
            <span className="text-black font-bold">{activeGoalsCount}</span>
          </div>
        </div>

        {/* Completed Goals Card */}
        <div className="p-5 rounded-2xl bg-neutral-100 border border-neutral-200 text-[#111111] flex flex-col justify-between space-y-4 shadow-xs">
          <div>
            <div className="flex items-center justify-between text-neutral-500">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Accomplished Goals</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="mt-3">
              <div className="text-3xl font-extrabold font-mono tracking-tight text-emerald-700 tabular-nums">
                {completedGoalsCount}
              </div>
              <p className="text-xs text-neutral-600 mt-1">
                Fully funded savings targets
              </p>
            </div>
          </div>
          <div className="text-[11px] font-mono text-neutral-500 pt-2 border-t border-neutral-200 flex justify-between">
            <span>Total Goals:</span>
            <span className="text-black font-bold">{data.goals.length}</span>
          </div>
        </div>
      </div>

      {/* Tabs & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-neutral-50 p-2.5 rounded-2xl border border-neutral-200">
        <div className="flex items-center gap-1.5 p-1 bg-white rounded-xl border border-neutral-200 self-start overflow-x-auto max-w-full">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer shrink-0 ${
              activeTab === 'all' ? 'bg-[#111111] text-white' : 'text-neutral-600 hover:text-black'
            }`}
          >
            All Goals ({data.goals.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('active')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer shrink-0 ${
              activeTab === 'active' ? 'bg-[#111111] text-white' : 'text-neutral-600 hover:text-black'
            }`}
          >
            Active
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('completed')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer shrink-0 ${
              activeTab === 'completed' ? 'bg-[#111111] text-white' : 'text-neutral-600 hover:text-black'
            }`}
          >
            Completed
          </button>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-1.5 text-xs bg-white border border-neutral-200 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
          >
            <option value="all">All Categories</option>
            {categories.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <div className="relative flex-1 sm:w-64">
            <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search goals..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs border border-neutral-200 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
            />
          </div>
        </div>
      </div>

      {/* Goals List */}
      {filteredGoals.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No unified goal & savings accounts found"
          description={
            searchQuery || activeTab !== 'all' || selectedCategory !== 'all'
              ? 'No records match your search or filter criteria.'
              : 'Create your first goal to automatically establish its connected savings account.'
          }
          actionLabel="Create Goal"
          onAction={openCreateModal}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredGoals.map(goal => {
            const connectedSg = getConnectedSavingsGoal(goal);
            const savedAmount = connectedSg?.currentAmount || 0;
            const targetAmount = goal.targetAmount || 0;
            const remainingAmount = Math.max(0, targetAmount - savedAmount);
            const progress = targetAmount > 0 ? Math.min(100, Math.round((savedAmount / targetAmount) * 100)) : 0;
            const isCompleted = targetAmount > 0 && savedAmount >= targetAmount;

            return (
              <div
                key={goal.id}
                onClick={() => setSelectedDetailGoalId(goal.id)}
                className="cv-auto p-5 rounded-2xl bg-white border border-black/[0.08] hover:border-black/[0.18] transition-all shadow-xs flex flex-col justify-between space-y-4 cursor-pointer group"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-bold px-2 py-0.5 bg-neutral-100 text-neutral-700 rounded-md uppercase tracking-wider">
                          {goal.category}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${
                          isCompleted ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800'
                        }`}>
                          {isCompleted ? 'Completed' : 'In Progress'}
                        </span>
                      </div>
                      <h3 className="text-base font-bold text-[#111111] mt-2 group-hover:text-black tracking-tight truncate">
                        {goal.title}
                      </h3>
                      {goal.description && (
                        <p className="text-xs text-neutral-500 mt-1 line-clamp-2">
                          {goal.description}
                        </p>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-xs text-neutral-400 font-medium">Target</div>
                      <div className="text-base font-bold font-mono text-[#111111]">
                        {formatCurrency(targetAmount, data.settings.currency)}
                      </div>
                    </div>
                  </div>

                  {/* Progress & Balances */}
                  <div className="mt-4 space-y-2">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-neutral-600 font-semibold">Saved: {formatCurrency(savedAmount, data.settings.currency)}</span>
                      <span className="text-neutral-400">Remaining: {formatCurrency(remainingAmount, data.settings.currency)}</span>
                    </div>
                    <div className="w-full h-2 bg-neutral-100 rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-300 ${isCompleted ? 'bg-emerald-500' : 'bg-[#111111]'}`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="flex justify-between items-center text-[11px] text-neutral-400 font-mono pt-1">
                      <span>{progress}% funded</span>
                      {goal.targetDate && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>Target {formatHumanDate(goal.targetDate)}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-neutral-100 flex items-center justify-between text-xs">
                  <span className="text-neutral-500 font-medium">Click to view savings activity & transactions</span>
                  <span className="font-bold text-[#111111] group-hover:translate-x-0.5 transition-transform">Manage →</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CREATE / EDIT GOAL MODAL */}
      {isGoalModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs"
          onClick={() => { if (!isSubmittingGoal) setIsGoalModalOpen(false); }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-black/[0.08] p-5 sm:p-6 overflow-hidden max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-black/[0.06]">
              <div>
                <h3 className="font-bold text-base text-[#111111] tracking-tight">
                  {editingGoal ? 'Edit Goal & Savings Account' : 'New Goal & Connected Savings'}
                </h3>
                <p className="text-xs text-neutral-500">
                  One goal automatically establishes one connected savings account.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsGoalModalOpen(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-neutral-900 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {goalFormError && (
              <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{goalFormError}</span>
              </div>
            )}

            <form onSubmit={handleSaveGoal} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Goal Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. MacBook Pro M3"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Target Amount ({data.settings.currency}) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="0.00"
                    value={targetAmount}
                    onChange={(e) => setTargetAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>

                {!editingGoal && (
                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 mb-1">
                      Initial Deposit (Optional)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={initialDeposit}
                      onChange={(e) => setInitialDeposit(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as GoalCategory)}
                    className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  >
                    {categories.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Target Date (Optional)
                  </label>
                  <input
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Description (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Why are you saving for this goal..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-neutral-100">
                <button
                  type="button"
                  disabled={isSubmittingGoal}
                  onClick={() => setIsGoalModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingGoal}
                  className="px-5 py-2 text-xs font-semibold bg-[#111111] text-white rounded-xl hover:bg-black transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingGoal ? 'Saving...' : (editingGoal ? 'Update Goal' : 'Create Goal & Account')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* GOAL DETAIL & SAVINGS ACTIVITY MODAL */}
      {selectedDetailGoal && (() => {
        const connectedSg = getConnectedSavingsGoal(selectedDetailGoal);
        const saved = connectedSg?.currentAmount || 0;
        const target = selectedDetailGoal.targetAmount || 0;
        const remaining = Math.max(0, target - saved);
        const progress = target > 0 ? Math.min(100, Math.round((saved / target) * 100)) : 0;
        const isCompleted = target > 0 && saved >= target;
        const txs = selectedGoalTransactions;

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs"
            onClick={() => setSelectedDetailGoalId(null)}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-black/[0.08] p-5 sm:p-6 overflow-hidden max-h-[90vh] overflow-y-auto space-y-6"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-4 border-b border-black/[0.06]">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold px-2 py-0.5 bg-neutral-100 text-neutral-700 rounded-md uppercase tracking-wider">
                      {selectedDetailGoal.category}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${
                      isCompleted ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800'
                    }`}>
                      {isCompleted ? 'Completed' : 'In Progress'}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-[#111111] mt-1 tracking-tight">
                    {selectedDetailGoal.title}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedDetailGoalId(null)}
                  className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-900 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Progress Summary Box */}
              <div className="p-5 rounded-2xl bg-neutral-50 border border-neutral-200 space-y-4">
                <div className="grid grid-cols-3 gap-2 text-center sm:text-left">
                  <div>
                    <span className="text-[11px] text-neutral-500 uppercase font-semibold">Target</span>
                    <div className="text-lg sm:text-xl font-extrabold font-mono text-[#111111]">
                      {formatCurrency(target, data.settings.currency)}
                    </div>
                  </div>
                  <div>
                    <span className="text-[11px] text-neutral-500 uppercase font-semibold">Saved</span>
                    <div className="text-lg sm:text-xl font-extrabold font-mono text-emerald-700">
                      {formatCurrency(saved, data.settings.currency)}
                    </div>
                  </div>
                  <div>
                    <span className="text-[11px] text-neutral-500 uppercase font-semibold">Remaining</span>
                    <div className="text-lg sm:text-xl font-extrabold font-mono text-neutral-800">
                      {formatCurrency(remaining, data.settings.currency)}
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="w-full h-2.5 bg-neutral-200 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-300 ${isCompleted ? 'bg-emerald-500' : 'bg-[#111111]'}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs font-mono text-neutral-500">
                    <span>{progress}% funded</span>
                    {selectedDetailGoal.targetDate && <span>Target Date: {formatHumanDate(selectedDetailGoal.targetDate)}</span>}
                  </div>
                </div>

                {selectedDetailGoal.description && (
                  <p className="text-xs text-neutral-600 pt-2 border-t border-neutral-200">
                    {selectedDetailGoal.description}
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => openTxModal('deposit')}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-[#111111] text-white text-xs font-semibold rounded-xl hover:bg-black transition-colors cursor-pointer shadow-xs"
                >
                  <ArrowUpRight className="w-4 h-4 text-[#87CEEB]" />
                  <span>Add Money (Deposit)</span>
                </button>
                <button
                  type="button"
                  onClick={() => openTxModal('withdrawal')}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-white text-[#111111] border border-neutral-300 text-xs font-semibold rounded-xl hover:bg-neutral-50 transition-colors cursor-pointer"
                >
                  <ArrowDownLeft className="w-4 h-4 text-neutral-700" />
                  <span>Withdraw Money</span>
                </button>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDetailGoalId(null);
                      openEditModal(selectedDetailGoal);
                    }}
                    className="p-2 text-neutral-600 hover:text-black hover:bg-neutral-100 rounded-xl transition-colors cursor-pointer"
                    title="Edit Goal"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleteTargetId(selectedDetailGoal.id);
                    }}
                    className="p-2 text-neutral-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
                    title="Delete Goal & Account"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Transaction History */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-sm text-[#111111] flex items-center gap-2">
                    <History className="w-4 h-4 text-neutral-500" />
                    <span>Connected Savings Transactions ({txs.length})</span>
                  </h4>
                </div>

                {txs.length === 0 ? (
                  <p className="text-xs text-neutral-400 text-center py-6 bg-neutral-50 rounded-xl border border-neutral-200">
                    No savings transactions recorded yet for this goal account.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {txs.map(tx => {
                        const isDeposit = tx.type === 'deposit';
                        return (
                          <div key={tx.id} className="p-3 bg-neutral-50 rounded-xl border border-neutral-200 flex items-center justify-between text-xs">
                            <div className="flex items-center gap-3">
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold ${
                                isDeposit ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                              }`}>
                                {isDeposit ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownLeft className="w-4 h-4" />}
                              </div>
                              <div>
                                <span className="font-mono font-bold text-[#111111] block">
                                  {isDeposit ? '+' : '-'}{formatCurrency(tx.amount, data.settings.currency)}
                                </span>
                                <span className="text-[11px] text-neutral-400 font-mono">
                                  {formatHumanDate(tx.date)} {tx.note ? `· ${tx.note}` : ''}
                                </span>
                              </div>
                            </div>
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                              isDeposit ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                            }`}>
                              {tx.type}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              <div className="pt-3 flex justify-end border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => setSelectedDetailGoalId(null)}
                  className="px-4 py-2 text-xs font-semibold bg-[#111111] text-white rounded-xl hover:bg-black cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* DEPOSIT / WITHDRAWAL MODAL */}
      {isTxModalOpen && selectedDetailGoal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs"
          onClick={() => { if (!isSubmittingTx) setIsTxModalOpen(false); }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-black/[0.08] p-5 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-black/[0.06]">
              <div>
                <h3 className="font-bold text-base text-[#111111] tracking-tight">
                  {txType === 'deposit' ? 'Add Money to Goal' : 'Withdraw Money from Goal'}
                </h3>
                <p className="text-xs text-neutral-500">
                  {selectedDetailGoal.title}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsTxModalOpen(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-neutral-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {txError && (
              <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{txError}</span>
              </div>
            )}

            <form onSubmit={handleSaveTx} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Amount ({data.settings.currency}) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="0.00"
                  value={txAmount}
                  onChange={(e) => setTxAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
                {txType === 'withdrawal' && (() => {
                  const sg = getConnectedSavingsGoal(selectedDetailGoal);
                  return sg ? (
                    <p className="text-[11px] text-neutral-400 mt-1 font-mono">
                      Available balance: {formatCurrency(sg.currentAmount || 0, data.settings.currency)}
                    </p>
                  ) : null;
                })()}
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Note / Reference (Optional)
                </label>
                <input
                  type="text"
                  placeholder={txType === 'deposit' ? 'e.g. Monthly paycheck contribution' : 'e.g. Partial purchase withdrawal'}
                  value={txNote}
                  onChange={(e) => setTxNote(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-neutral-100">
                <button
                  type="button"
                  disabled={isSubmittingTx}
                  onClick={() => setIsTxModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingTx}
                  className="px-5 py-2 text-xs font-semibold bg-[#111111] text-white rounded-xl hover:bg-black transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingTx ? 'Processing...' : (txType === 'deposit' ? 'Confirm Deposit' : 'Confirm Withdrawal')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={deleteTargetId !== null}
        title="Delete Goal & Connected Savings Account"
        message="Are you sure you want to permanently delete this goal and its connected savings fund and transaction history?"
        confirmLabel="Delete Goal"
        isLoading={isDeleting}
        error={deleteError}
        onConfirm={handleDeleteGoal}
        onCancel={() => {
          setDeleteError(null);
          setDeleteTargetId(null);
        }}
      />
    </div>
  );
};
