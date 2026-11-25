import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  Target,
  Plus,
  Trash2,
  Edit3,
  ArrowUpRight,
  ArrowDownLeft,
  History,
  AlertCircle
} from 'lucide-react';
import { useXOSData } from '../../hooks/useXOSData';
import { Goal, GoalCategory, GoalPriority, SavingsGoal } from '../../types';
import { formatCurrency, formatHumanDate, getTodayString } from '../../utils/formatters';
import { calculateUnifiedGoalTotals, resolveGoalsWithSavings } from '../../utils/calculations';
import { EmptyState } from '../common/EmptyState';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { sanitizeDatabaseErrorMessage } from '../../utils/authValidation';
import {
  ACCENT_BUTTON_CLASS,
  ActionIconButton,
  FilterBar,
  INPUT_CLASS,
  LABEL_CLASS,
  MONO_INPUT_CLASS,
  MetricCard,
  Modal,
  PRIMARY_BUTTON_CLASS,
  PageHeader,
  SECONDARY_BUTTON_CLASS,
  SELECT_CLASS,
  SegmentedControl,
  TEXTAREA_CLASS
} from '../ui';

export const GoalsAndSavingsView: React.FC = () => {
  const data = useXOSData();

  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'completed'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [isSubmittingGoal, setIsSubmittingGoal] = useState(false);
  const isSubmittingGoalRef = useRef(false);
  const [goalFormError, setGoalFormError] = useState<string | null>(null);

  const [selectedDetailGoalId, setSelectedDetailGoalId] = useState<string | null>(null);
  const selectedDetailGoal = selectedDetailGoalId
    ? data.goals.find(g => g.id === selectedDetailGoalId) || null
    : null;

  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [txType, setTxType] = useState<'deposit' | 'withdrawal'>('deposit');
  const [txAmount, setTxAmount] = useState('');
  const [txNote, setTxNote] = useState('');
  const [txError, setTxError] = useState<string | null>(null);
  const [isSubmittingTx, setIsSubmittingTx] = useState(false);
  const isSubmittingTxRef = useRef(false);

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const isDeletingRef = useRef(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<GoalCategory>('Personal');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [priority, setPriority] = useState<GoalPriority>('Medium');
  const [initialDeposit, setInitialDeposit] = useState('');

  const resolvedGoals = useMemo(
    () => resolveGoalsWithSavings(data.goals, data.savingsGoals),
    [data.goals, data.savingsGoals]
  );

  const resolvedByGoalId = useMemo(
    () => new Map(resolvedGoals.map(item => [item.goal.id, item])),
    [resolvedGoals]
  );

  const selectedResolvedGoal = selectedDetailGoalId
    ? resolvedByGoalId.get(selectedDetailGoalId) || null
    : null;

  const getConnectedSavingsGoal = useCallback(
    (goal: Goal): SavingsGoal | undefined => resolvedByGoalId.get(goal.id)?.savingsGoal,
    [resolvedByGoalId]
  );

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

  const handleSaveGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingGoalRef.current || isSubmittingGoal) return;

    if (!title.trim()) {
      setGoalFormError('Goal name is required.');
      return;
    }

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

    isSubmittingGoalRef.current = true;
    setGoalFormError(null);
    setIsSubmittingGoal(true);

    try {
      if (editingGoal) {
        await data.updateGoal(editingGoal.id, {
          title: title.trim(),
          description: description.trim(),
          category,
          targetAmount: parsedTarget,
          targetDate: targetDate || undefined,
          priority
        });
      } else {
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
      setGoalFormError(sanitizeDatabaseErrorMessage(err, 'Failed to save goal & savings account.'));
    } finally {
      isSubmittingGoalRef.current = false;
      setIsSubmittingGoal(false);
    }
  };

  const openTxModal = (type: 'deposit' | 'withdrawal') => {
    setTxType(type);
    setTxAmount('');
    setTxNote('');
    setTxError(null);
    setIsTxModalOpen(true);
  };

  const handleSaveTx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDetailGoal || isSubmittingTxRef.current || isSubmittingTx) return;

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

    isSubmittingTxRef.current = true;
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
      setTxError(sanitizeDatabaseErrorMessage(err, 'Failed to record transaction.'));
    } finally {
      isSubmittingTxRef.current = false;
      setIsSubmittingTx(false);
    }
  };

  const handleDeleteGoal = async () => {
    if (!deleteTargetId || isDeletingRef.current || isDeleting) return;
    isDeletingRef.current = true;
    setDeleteError(null);
    setIsDeleting(true);

    try {
      await data.deleteGoal(deleteTargetId);
      if (selectedDetailGoalId === deleteTargetId) {
        setSelectedDetailGoalId(null);
      }
      setDeleteTargetId(null);
    } catch (err) {
      setDeleteError(sanitizeDatabaseErrorMessage(err, 'Failed to archive goal.'));
    } finally {
      isDeletingRef.current = false;
      setIsDeleting(false);
    }
  };

  const goalTotals = useMemo(
    () => calculateUnifiedGoalTotals(resolvedGoals),
    [resolvedGoals]
  );

  const {
    totalCount,
    totalTargetAmount,
    totalSavedAmount,
    totalRemainingAmount,
    overallProgress,
    activeGoalsCount,
    completedGoalsCount
  } = goalTotals;

  const filteredResolvedGoals = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return resolvedGoals.filter(item => {
      if (activeTab === 'active' && !item.isActive) return false;
      if (activeTab === 'completed' && !item.isCompleted) return false;
      if (selectedCategory !== 'all' && item.goal.category !== selectedCategory) return false;
      if (q) {
        return (
          item.goal.title.toLowerCase().includes(q) ||
          (item.goal.description && item.goal.description.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [resolvedGoals, activeTab, selectedCategory, searchQuery]);

  const selectedGoalTransactions = useMemo(() => {
    if (!selectedResolvedGoal?.savingsGoal) return [];
    const connectedSgId = selectedResolvedGoal.savingsGoal.id;
    return data.savingsTransactions
      .filter(tx => tx.savingsGoalId === connectedSgId)
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [selectedResolvedGoal, data.savingsTransactions]);

  const categories = ['Financial', 'Career', 'Health', 'Travel', 'Learning', 'Life', 'Personal'];

  const filterTabs = useMemo(
    () => [
      { id: 'all' as const, label: `All Goals (${totalCount})` },
      { id: 'active' as const, label: 'Active' },
      { id: 'completed' as const, label: 'Completed' }
    ],
    [totalCount]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Goals & Savings"
        description="One connected savings account per goal. Deposit, withdraw, and track progress automatically."
        actions={
          <button
            onClick={openCreateModal}
            type="button"
            className={PRIMARY_BUTTON_CLASS}
          >
            <Plus className="w-4 h-4" />
            <span>New Goal &amp; Account</span>
          </button>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
        <MetricCard
          variant="focal"
          label="Total Saved Across Goals"
          value={formatCurrency(totalSavedAmount, data.settings.currency)}
          progress={overallProgress}
          sublabel={`Target sum: ${formatCurrency(totalTargetAmount, data.settings.currency)} · ${overallProgress}% funded`}
        />

        <MetricCard
          label="Remaining to Save"
          value={formatCurrency(totalRemainingAmount, data.settings.currency)}
          sublabel={`${activeGoalsCount} active · ${totalCount} total accounts`}
        />

        <MetricCard
          variant="subtle"
          tone="positive"
          label="Accomplished Goals"
          value={completedGoalsCount}
          sublabel={`Out of ${totalCount} goal accounts`}
        />
      </div>

      {/* Filters */}
      <FilterBar
        leading={
          <SegmentedControl
            options={filterTabs}
            value={activeTab}
            onChange={setActiveTab}
            ariaLabel="Filter goals by status"
          />
        }
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search goals…"
        searchAriaLabel="Search goals"
        filters={
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            aria-label="Filter goals by category"
            className={`${SELECT_CLASS} sm:w-44`}
          >
            <option value="all">All Categories</option>
            {categories.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        }
      />

      {/* Goals Grid */}
      {filteredResolvedGoals.length === 0 ? (
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
          {filteredResolvedGoals.map(item => {
            const { goal, savedAmount, targetAmount, remainingAmount, progressPercentage, isCompleted, isPaused, hasValidSavingsLink } = item;
            const statusLabel = isCompleted ? 'Completed' : isPaused ? 'Paused' : 'In Progress';
            const statusToneClass = isCompleted
              ? 'text-emerald-700'
              : isPaused
                ? 'text-[#6e6e73]'
                : 'text-[#0284c7]';

            return (
              <div
                key={goal.id}
                onClick={() => setSelectedDetailGoalId(goal.id)}
                className="cv-auto p-5 rounded-2xl bg-white border border-black/[0.08] hover:border-black/[0.18] transition-colors flex flex-col justify-between space-y-4 cursor-pointer group"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-[#6e6e73]">
                        <span>{goal.category}</span>
                        <span aria-hidden="true"> · </span>
                        <span className={`font-medium ${statusToneClass}`}>{statusLabel}</span>
                      </div>
                      <h3 className="text-base font-semibold text-[#1d1d1f] mt-1 tracking-[-0.01em] truncate">
                        {goal.title}
                      </h3>
                      {goal.description && (
                        <p className="text-xs text-[#6e6e73] mt-1 line-clamp-2 leading-relaxed">
                          {goal.description}
                        </p>
                      )}
                      {!hasValidSavingsLink && (
                        <p className="text-xs text-amber-700 mt-1">
                          Savings account link unavailable
                        </p>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-[11px] text-[#86868b]">Target</div>
                      <div className="text-base font-semibold font-mono text-[#1d1d1f] tabular-nums">
                        {formatCurrency(targetAmount, data.settings.currency)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    <div className="flex justify-between text-xs font-mono tabular-nums">
                      <span className="text-[#1d1d1f] font-medium">Saved: {formatCurrency(savedAmount, data.settings.currency)}</span>
                      <span className="text-[#6e6e73]">Remaining: {formatCurrency(remainingAmount, data.settings.currency)}</span>
                    </div>
                    <div className="w-full h-1.5 bg-black/[0.06] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${isCompleted ? 'bg-emerald-600' : 'bg-[#0284c7]'}`}
                        style={{ width: `${progressPercentage}%` }}
                      />
                    </div>
                    <div className="flex justify-between items-center text-xs text-[#6e6e73] font-mono tabular-nums pt-0.5">
                      <span>{progressPercentage}% funded</span>
                      {goal.targetDate && (
                        <span>Target {formatHumanDate(goal.targetDate)}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-black/[0.06] flex items-center justify-between text-xs">
                  <span className="text-[#6e6e73]">View savings activity &amp; transactions</span>
                  <span className="font-medium text-[#0284c7] group-hover:translate-x-0.5 transition-transform">Manage →</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CREATE / EDIT GOAL MODAL */}
      <Modal
        isOpen={isGoalModalOpen}
        onClose={() => { if (!isSubmittingGoal) setIsGoalModalOpen(false); }}
        disableClose={isSubmittingGoal}
        maxWidth="lg"
        title={editingGoal ? 'Edit Goal & Savings Account' : 'New Goal & Connected Savings'}
        subtitle="One goal automatically establishes one connected savings account."
        footer={
          <>
            <button
              type="button"
              disabled={isSubmittingGoal}
              onClick={() => setIsGoalModalOpen(false)}
              className={SECONDARY_BUTTON_CLASS}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="goal-form"
              disabled={isSubmittingGoal}
              className={PRIMARY_BUTTON_CLASS}
            >
              {isSubmittingGoal ? 'Saving…' : (editingGoal ? 'Update Goal' : 'Create Goal & Account')}
            </button>
          </>
        }
      >
        {goalFormError && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{goalFormError}</span>
          </div>
        )}

        <form id="goal-form" onSubmit={handleSaveGoal} className="space-y-4">
          <div>
            <label className={LABEL_CLASS}>Goal Name *</label>
            <input
              type="text"
              required
              placeholder="e.g. MacBook Pro"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className={LABEL_CLASS}>Target Amount ({data.settings.currency}) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="0.00"
                value={targetAmount}
                onChange={(e) => setTargetAmount(e.target.value)}
                className={MONO_INPUT_CLASS}
              />
            </div>

            {!editingGoal && (
              <div>
                <label className={LABEL_CLASS}>Initial Deposit (Optional)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={initialDeposit}
                  onChange={(e) => setInitialDeposit(e.target.value)}
                  className={MONO_INPUT_CLASS}
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className={LABEL_CLASS}>Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as GoalCategory)}
                className={SELECT_CLASS}
              >
                {categories.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={LABEL_CLASS}>Target Date (Optional)</label>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div>
            <label className={LABEL_CLASS}>Description (Optional)</label>
            <textarea
              rows={2}
              placeholder="Why are you saving for this goal…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={TEXTAREA_CLASS}
            />
          </div>
        </form>
      </Modal>

      {/* GOAL DETAIL & SAVINGS ACTIVITY MODAL */}
      {(() => {
        const detail = selectedDetailGoal && selectedResolvedGoal ? selectedResolvedGoal : null;
        const badgeLabel = detail
          ? detail.isCompleted ? 'Completed' : detail.isPaused ? 'Paused' : 'In Progress'
          : '';
        return (
          <Modal
            isOpen={Boolean(selectedDetailGoal && detail)}
            onClose={() => {
              if (deleteTargetId === null && !isDeleting) {
                setSelectedDetailGoalId(null);
              }
            }}
            disableClose={deleteTargetId !== null || isDeleting}
            maxWidth="2xl"
            title={selectedDetailGoal?.title || 'Goal Details'}
            subtitle={selectedDetailGoal ? `${selectedDetailGoal.category} · ${badgeLabel}` : undefined}
            footer={
              <button
                type="button"
                onClick={() => setSelectedDetailGoalId(null)}
                className={PRIMARY_BUTTON_CLASS}
              >
                Close
              </button>
            }
          >
            {selectedDetailGoal && detail && (
              <div className="space-y-6">
                {/* Progress Summary */}
                <div className="p-5 rounded-2xl bg-[#f5f5f7] space-y-4">
                  <div className="grid grid-cols-3 gap-2 text-center sm:text-left">
                    <div>
                      <span className="text-[11px] text-[#6e6e73] font-medium block">Target</span>
                      <div className="text-base sm:text-xl font-semibold font-mono text-[#1d1d1f] tabular-nums">
                        {formatCurrency(detail.targetAmount, data.settings.currency)}
                      </div>
                    </div>
                    <div>
                      <span className="text-[11px] text-[#6e6e73] font-medium block">Saved</span>
                      <div className="text-base sm:text-xl font-semibold font-mono text-emerald-700 tabular-nums">
                        {formatCurrency(detail.savedAmount, data.settings.currency)}
                      </div>
                    </div>
                    <div>
                      <span className="text-[11px] text-[#6e6e73] font-medium block">Remaining</span>
                      <div className="text-base sm:text-xl font-semibold font-mono text-[#1d1d1f] tabular-nums">
                        {formatCurrency(detail.remainingAmount, data.settings.currency)}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="w-full h-2 bg-black/[0.08] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${detail.isCompleted ? 'bg-emerald-600' : 'bg-[#0284c7]'}`}
                        style={{ width: `${detail.progressPercentage}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs font-mono text-[#6e6e73] tabular-nums">
                      <span>{detail.progressPercentage}% funded</span>
                      {selectedDetailGoal.targetDate && <span>Target: {formatHumanDate(selectedDetailGoal.targetDate)}</span>}
                    </div>
                  </div>

                  {selectedDetailGoal.description && (
                    <p className="text-xs text-[#6e6e73] pt-2 border-t border-black/[0.06] leading-relaxed">
                      {selectedDetailGoal.description}
                    </p>
                  )}
                </div>

                {!detail.hasValidSavingsLink && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
                    <span>This goal has no connected savings account record. Deposits and withdrawals are disabled.</span>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    disabled={!detail.hasValidSavingsLink}
                    onClick={() => openTxModal('deposit')}
                    className={ACCENT_BUTTON_CLASS}
                  >
                    <ArrowUpRight className="w-4 h-4" />
                    <span>Add Money (Deposit)</span>
                  </button>
                  <button
                    type="button"
                    disabled={!detail.hasValidSavingsLink}
                    onClick={() => openTxModal('withdrawal')}
                    className={SECONDARY_BUTTON_CLASS}
                  >
                    <ArrowDownLeft className="w-4 h-4" />
                    <span>Withdraw Money</span>
                  </button>
                  <div className="ml-auto flex items-center gap-1">
                    <ActionIconButton
                      icon={Edit3}
                      label="Edit Goal"
                      variant="edit"
                      onClick={() => {
                        setSelectedDetailGoalId(null);
                        openEditModal(selectedDetailGoal);
                      }}
                    />
                    <ActionIconButton
                      icon={Trash2}
                      label="Archive Goal"
                      variant="delete"
                      disabled={detail.isPaused || selectedDetailGoal.status === 'Archived' || isDeleting}
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteTargetId(selectedDetailGoal.id);
                      }}
                    />
                  </div>
                </div>

                {/* Transaction History */}
                <div className="space-y-3">
                  <h4 className="font-semibold text-sm text-[#1d1d1f] flex items-center gap-2">
                    <History className="w-4 h-4 text-[#6e6e73]" />
                    <span>Connected Savings Transactions ({selectedGoalTransactions.length})</span>
                  </h4>

                  {selectedGoalTransactions.length === 0 ? (
                    <p className="text-xs text-[#86868b] text-center py-6 bg-[#f5f5f7] rounded-2xl">
                      No savings transactions recorded yet for this goal account.
                    </p>
                  ) : (
                    <div className="divide-y divide-black/[0.06] border border-black/[0.08] rounded-2xl overflow-hidden max-h-60 overflow-y-auto bg-white">
                      {selectedGoalTransactions.map(tx => {
                        const isDeposit = tx.type === 'deposit';
                        return (
                          <div key={tx.id} className="p-3.5 flex items-center justify-between text-xs gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              {isDeposit ? (
                                <ArrowUpRight className="w-4 h-4 text-emerald-600 shrink-0" />
                              ) : (
                                <ArrowDownLeft className="w-4 h-4 text-amber-600 shrink-0" />
                              )}
                              <div className="min-w-0">
                                <span className="font-mono font-semibold text-[#1d1d1f] block tabular-nums">
                                  {isDeposit ? '+' : '-'}{formatCurrency(tx.amount, data.settings.currency)}
                                </span>
                                <span className="text-xs text-[#6e6e73] font-mono tabular-nums block truncate">
                                  {formatHumanDate(tx.date)}{tx.note ? ` · ${tx.note}` : ''}
                                </span>
                              </div>
                            </div>
                            <span className={`text-xs font-medium capitalize shrink-0 ${isDeposit ? 'text-emerald-700' : 'text-amber-700'}`}>
                              {tx.type}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </Modal>
        );
      })()}

      {/* DEPOSIT / WITHDRAWAL MODAL */}
      <Modal
        isOpen={isTxModalOpen && Boolean(selectedDetailGoal)}
        onClose={() => { if (!isSubmittingTx) setIsTxModalOpen(false); }}
        disableClose={isSubmittingTx}
        maxWidth="md"
        title={txType === 'deposit' ? 'Add Money to Goal' : 'Withdraw Money from Goal'}
        subtitle={selectedDetailGoal?.title}
        footer={
          <>
            <button
              type="button"
              disabled={isSubmittingTx}
              onClick={() => setIsTxModalOpen(false)}
              className={SECONDARY_BUTTON_CLASS}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="goal-tx-form"
              disabled={isSubmittingTx}
              className={PRIMARY_BUTTON_CLASS}
            >
              {isSubmittingTx ? 'Processing…' : (txType === 'deposit' ? 'Confirm Deposit' : 'Confirm Withdrawal')}
            </button>
          </>
        }
      >
        {txError && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{txError}</span>
          </div>
        )}

        <form id="goal-tx-form" onSubmit={handleSaveTx} className="space-y-4">
          <div>
            <label className={LABEL_CLASS}>Amount ({data.settings.currency}) *</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              placeholder="0.00"
              value={txAmount}
              onChange={(e) => setTxAmount(e.target.value)}
              className={MONO_INPUT_CLASS}
            />
            {txType === 'withdrawal' && selectedDetailGoal && (() => {
              const sg = getConnectedSavingsGoal(selectedDetailGoal);
              return sg ? (
                <p className="text-xs text-[#6e6e73] mt-1 font-mono tabular-nums">
                  Available balance: {formatCurrency(sg.currentAmount || 0, data.settings.currency)}
                </p>
              ) : null;
            })()}
          </div>

          <div>
            <label className={LABEL_CLASS}>Note / Reference (Optional)</label>
            <input
              type="text"
              placeholder={txType === 'deposit' ? 'e.g. Monthly paycheck contribution' : 'e.g. Partial purchase withdrawal'}
              value={txNote}
              onChange={(e) => setTxNote(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={deleteTargetId !== null}
        title="Archive Goal"
        message="Are you sure you want to archive this goal? This marks the goal as cancelled and removes it from active lists, while preserving its connected savings account and transaction history."
        confirmLabel="Archive Goal"
        isLoading={isDeleting}
        error={deleteError}
        onConfirm={handleDeleteGoal}
        onCancel={() => {
          if (isDeleting) return;
          setDeleteError(null);
          setDeleteTargetId(null);
        }}
      />
    </div>
  );
};
