import React, { useState, useEffect } from 'react';
import { PiggyBank, Plus, ArrowUpRight, ArrowDownLeft, Trash2, Edit3, ShieldAlert, X } from 'lucide-react';
import { useXOSData } from '../../hooks/useXOSData';
import { SavingsGoal } from '../../types';
import { formatCurrency, formatHumanDate, getTodayString } from '../../utils/formatters';
import { EmptyState } from '../common/EmptyState';
import { ConfirmDialog } from '../common/ConfirmDialog';

export const SavingsView: React.FC = () => {
  const data = useXOSData();

  // Confirmation dialog state
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  // Modal State
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<SavingsGoal | null>(null);

  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [selectedTxGoalId, setSelectedTxGoalId] = useState<string>('');

  // Goal Form Fields
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [initialDeposit, setInitialDeposit] = useState('');
  const [startDate, setStartDate] = useState(getTodayString());
  const [targetDate, setTargetDate] = useState('');
  const [description, setDescription] = useState('');

  // Tx Form Fields
  const [txAmount, setTxAmount] = useState('');
  const [txType, setTxType] = useState<'deposit' | 'withdrawal'>('deposit');
  const [txNote, setTxNote] = useState('');

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isGoalModalOpen) setIsGoalModalOpen(false);
        if (isTxModalOpen) setIsTxModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isGoalModalOpen, isTxModalOpen]);

  const openCreateGoalModal = () => {
    setEditingGoal(null);
    setName('');
    setTargetAmount('');
    setInitialDeposit('');
    setStartDate(getTodayString());
    setTargetDate('');
    setDescription('');
    setIsGoalModalOpen(true);
  };

  const openEditGoalModal = (sg: SavingsGoal) => {
    setEditingGoal(sg);
    setName(sg.name);
    setTargetAmount(String(sg.targetAmount));
    setInitialDeposit('0');
    setStartDate(sg.startDate);
    setTargetDate(sg.targetDate || '');
    setDescription(sg.description || '');
    setIsGoalModalOpen(true);
  };

  const openTxModal = (goalId: string, type: 'deposit' | 'withdrawal' = 'deposit') => {
    setSelectedTxGoalId(goalId);
    setTxType(type);
    setTxAmount('');
    setTxNote('');
    setIsTxModalOpen(true);
  };

  const handleGoalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !targetAmount) return;

    if (editingGoal) {
      data.updateSavingsGoal(editingGoal.id, {
        name: name.trim(),
        targetAmount: parseFloat(targetAmount),
        startDate,
        targetDate: targetDate || undefined,
        description: description.trim()
      });
    } else {
      data.addSavingsGoal({
        name: name.trim(),
        targetAmount: parseFloat(targetAmount),
        initialDeposit: initialDeposit ? parseFloat(initialDeposit) : 0,
        startDate,
        targetDate: targetDate || undefined,
        description: description.trim()
      });
    }

    setIsGoalModalOpen(false);
  };

  const handleTxSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTxGoalId || !txAmount) return;

    data.addSavingsTransaction({
      savingsGoalId: selectedTxGoalId,
      amount: parseFloat(txAmount),
      type: txType,
      date: getTodayString(),
      note: txNote.trim() || (txType === 'deposit' ? 'Savings Contribution' : 'Savings Withdrawal')
    });

    setIsTxModalOpen(false);
  };

  const handleDeleteGoal = (id: string) => {
    setDeleteTargetId(id);
  };

  const totalSavingsBalance = data.savingsGoals.reduce((sum, g) => sum + (g.currentAmount || 0), 0);
  const totalTargetSum = data.savingsGoals.reduce((sum, g) => sum + (g.targetAmount || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-black/[0.06]">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-[#111111] tracking-tight">
            Savings & Reserves
          </h2>
          <p className="text-xs sm:text-sm text-neutral-500 font-normal mt-0.5">
            Manage high-yield savings accounts, emergency reserves, and targeted purchase funds.
          </p>
        </div>

        <button
          onClick={openCreateGoalModal}
          type="button"
          className="self-start sm:self-auto flex items-center gap-1.5 px-3.5 py-2 bg-[#111111] text-white text-xs font-semibold rounded-xl hover:bg-black transition-colors shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
        >
          <Plus className="w-4 h-4 text-[#87CEEB]" />
          <span>New Savings Fund</span>
        </button>
      </div>

      {/* Top Banner & Non-Expense Notice */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
        {/* Balance Card */}
        <div className="p-5 sm:p-6 rounded-2xl bg-[#111111] text-white flex flex-col justify-between space-y-4 shadow-xs">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Total Savings Reserves</span>
            <div className="text-3xl font-extrabold font-mono tracking-tight text-white mt-1 tabular-nums">
              {formatCurrency(totalSavingsBalance, data.settings.currency)}
            </div>
            <p className="text-xs text-neutral-400 mt-1">
              Overall target: {formatCurrency(totalTargetSum, data.settings.currency)}
            </p>
          </div>

          <div className="p-3 bg-neutral-900 rounded-xl border border-neutral-800 text-[11px] text-neutral-300 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-[#87CEEB] shrink-0" />
            <span>Savings transfers are stored separately and not counted as expenses.</span>
          </div>
        </div>

        {/* Funds Summary Cards or Inline Hint */}
        <div className="lg:col-span-2">
          {data.savingsGoals.length === 0 ? (
            <div className="h-full flex items-center justify-center p-6 bg-neutral-50 rounded-2xl border border-neutral-200 text-center">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-neutral-800">No active savings funds</p>
                <p className="text-xs text-neutral-500">Create a fund above to start tracking allocations.</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {data.savingsGoals.map((sg) => {
                const progressPct = sg.targetAmount > 0
                  ? Math.min(100, Math.round(((sg.currentAmount || 0) / sg.targetAmount) * 100))
                  : 0;
                const remaining = Math.max(0, sg.targetAmount - (sg.currentAmount || 0));

                return (
                  <div key={sg.id} className="p-5 rounded-2xl bg-white border border-black/[0.08] space-y-4 shadow-xs flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold text-sm text-[#111111] line-clamp-1">{sg.name}</h3>
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEditGoalModal(sg)} className="p-1 text-neutral-400 hover:text-black cursor-pointer">
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleDeleteGoal(sg.id)} className="p-1 text-neutral-400 hover:text-rose-600 cursor-pointer">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="text-2xl font-extrabold font-mono text-[#111111] tabular-nums">
                        {formatCurrency(sg.currentAmount || 0, data.settings.currency)}
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-xs text-neutral-500 font-mono tabular-nums">
                          <span>{progressPct}% saved</span>
                          <span>Target: {formatCurrency(sg.targetAmount, data.settings.currency)}</span>
                        </div>
                        <div className="w-full h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                          <div className="h-full bg-[#87CEEB] transition-all duration-300" style={{ width: `${progressPct}%` }} />
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-black/[0.06] flex items-center justify-between gap-2">
                      <span className="text-[11px] text-neutral-400 font-mono tabular-nums">
                        Remaining: {formatCurrency(remaining, data.settings.currency)}
                      </span>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => openTxModal(sg.id, 'deposit')}
                          className="px-2.5 py-1 text-xs font-semibold bg-neutral-100 text-neutral-900 border border-neutral-200 rounded-lg hover:bg-neutral-200 transition-colors cursor-pointer"
                        >
                          + Deposit
                        </button>
                        <button
                          onClick={() => openTxModal(sg.id, 'withdrawal')}
                          className="px-2.5 py-1 text-xs font-medium text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-lg hover:bg-neutral-100 transition-colors cursor-pointer"
                        >
                          - Withdraw
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Savings Transactions Log Table or Empty State */}
      {data.savingsGoals.length === 0 ? (
        <EmptyState
          icon={PiggyBank}
          title="Start building your savings"
          description="Create your first savings fund to track emergency reserves, investments, or travel savings."
          actionLabel="Create Savings Fund"
          onAction={openCreateGoalModal}
        />
      ) : (
        <>
          {/* Mobile Card List for Transactions */}
          <div className="md:hidden space-y-2.5">
            <div className="text-xs font-bold text-neutral-500 uppercase tracking-wider px-1">
              Savings Activity
            </div>
            {data.savingsTransactions.length === 0 ? (
              <div className="p-6 bg-white rounded-2xl border border-neutral-200 text-center text-xs text-neutral-400">
                No contributions or withdrawals recorded yet.
              </div>
            ) : (
              data.savingsTransactions.map((tx) => {
                const goal = data.savingsGoals.find(g => g.id === tx.savingsGoalId);
                const isDeposit = tx.type === 'deposit';

                return (
                  <div key={tx.id} className="p-4 rounded-2xl border border-black/[0.08] bg-white space-y-1.5 shadow-xs">
                    <div className="flex items-start justify-between">
                      <span className="font-semibold text-sm text-[#111111]">
                        {goal ? goal.name : 'Savings Fund'}
                      </span>
                      <span className={`font-mono font-bold text-sm tabular-nums ${isDeposit ? 'text-emerald-600' : 'text-[#111111]'}`}>
                        {isDeposit ? '+' : '-'}{formatCurrency(tx.amount, data.settings.currency)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs text-neutral-500">
                      <span>{isDeposit ? 'Deposit' : 'Withdrawal'}</span>
                      <span className="font-mono">{formatHumanDate(tx.date)}</span>
                    </div>

                    {tx.note && (
                      <p className="text-xs text-neutral-500 bg-neutral-50 p-2 rounded-lg font-normal">
                        {tx.note}
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop Table (widths >= 768px) */}
          <div className="hidden md:block bg-white rounded-2xl border border-black/[0.08] overflow-hidden shadow-xs">
            <div className="p-4 border-b border-black/[0.06] font-bold text-sm text-[#111111]">
              Savings Activity History
            </div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-neutral-50/80 border-b border-black/[0.06] text-[11px] font-bold text-neutral-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Fund Name</th>
                  <th className="py-3 px-4">Transaction Type</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Note</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06] text-xs text-neutral-700">
                {data.savingsTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-neutral-400">
                      No savings contributions or withdrawals logged yet.
                    </td>
                  </tr>
                ) : (
                  data.savingsTransactions.map((tx) => {
                    const goal = data.savingsGoals.find(g => g.id === tx.savingsGoalId);
                    const isDeposit = tx.type === 'deposit';

                    return (
                      <tr key={tx.id} className="hover:bg-neutral-50/70 transition-colors">
                        <td className="py-3 px-4 font-semibold text-[#111111]">
                          {goal ? goal.name : 'Unknown Savings Fund'}
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-neutral-100 text-neutral-800">
                            {isDeposit ? 'Deposit (+)' : 'Withdrawal (-)'}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono text-neutral-600 tabular-nums">
                          {formatHumanDate(tx.date)}
                        </td>
                        <td className="py-3 px-4 text-neutral-500">
                          {tx.note || '—'}
                        </td>
                        <td className={`py-3 px-4 text-right font-mono font-bold tabular-nums ${isDeposit ? 'text-emerald-600' : 'text-[#111111]'}`}>
                          {isDeposit ? '+' : '-'}{formatCurrency(tx.amount, data.settings.currency)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Modal Add Savings Goal */}
      {isGoalModalOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setIsGoalModalOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div 
            className="bg-white rounded-2xl max-w-md w-full border border-black/[0.08] shadow-2xl p-5 sm:p-6 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
              <h3 className="font-bold text-base sm:text-lg text-[#111111]">
                {editingGoal ? 'Edit Savings Fund' : 'New Savings Fund'}
              </h3>
              <button
                onClick={() => setIsGoalModalOpen(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-black cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleGoalSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Fund Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rainy Day Reserve"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Target Amount ({data.settings.currency}) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="10000"
                    value={targetAmount}
                    onChange={(e) => setTargetAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
                {!editingGoal && (
                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 mb-1">Initial Deposit</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={initialDeposit}
                      onChange={(e) => setInitialDeposit(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Target Date (Optional)</label>
                  <input
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Description (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. 6-month living expenses buffer"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => setIsGoalModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-semibold bg-[#111111] text-white rounded-xl hover:bg-black transition-colors cursor-pointer"
                >
                  Save Fund
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Transaction */}
      {isTxModalOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setIsTxModalOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div 
            className="bg-white rounded-2xl max-w-sm w-full border border-black/[0.08] shadow-2xl p-5 sm:p-6 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
              <h3 className="font-bold text-base text-[#111111]">
                Record Savings {txType === 'deposit' ? 'Deposit (+)' : 'Withdrawal (-)'}
              </h3>
              <button
                onClick={() => setIsTxModalOpen(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-black cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleTxSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Amount ({data.settings.currency}) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="0.00"
                  value={txAmount}
                  onChange={(e) => setTxAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Note (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Monthly transfer"
                  value={txNote}
                  onChange={(e) => setTxNote(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => setIsTxModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-semibold bg-[#111111] text-white rounded-xl hover:bg-black transition-colors cursor-pointer"
                >
                  Confirm Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Accessible Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteTargetId !== null}
        title="Delete Savings Fund"
        message="Are you sure you want to delete this savings reserve? All recorded deposits and withdrawals for this fund will also be removed."
        confirmLabel="Delete Fund"
        onConfirm={() => {
          if (deleteTargetId) data.deleteSavingsGoal(deleteTargetId);
          setDeleteTargetId(null);
        }}
        onCancel={() => setDeleteTargetId(null)}
      />
    </div>
  );
};
