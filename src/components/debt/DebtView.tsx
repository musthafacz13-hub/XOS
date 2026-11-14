import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  ArrowUpRight, 
  ArrowDownLeft, 
  Plus, 
  Calendar, 
  Clock, 
  Trash2, 
  Edit3, 
  X, 
  AlertCircle 
} from 'lucide-react';
import { useXOSData } from '../../hooks/useXOSData';
import { Debt, DebtDirection } from '../../types';
import { calculateDebtOutstanding, calculateSeparateDebtTotals } from '../../utils/calculations';
import { formatCurrency, formatHumanDate, getTodayString } from '../../utils/formatters';
import { ConfirmDialog } from '../common/ConfirmDialog';

export const DebtView: React.FC = () => {
  const data = useXOSData();

  // Modals
  const [isDebtModalOpen, setIsDebtModalOpen] = useState(false);
  const [editingDebt, setEditingDebt] = useState<Debt | null>(null);
  const [modalDirection, setModalDirection] = useState<DebtDirection>('receive');

  // Deletion targets
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeletingDebt, setIsDeletingDebt] = useState(false);
  const [deleteDebtError, setDeleteDebtError] = useState<string | null>(null);

  // Form Fields
  const [personName, setPersonName] = useState('');
  const [originalAmount, setOriginalAmount] = useState('');
  const [transactionDate, setTransactionDate] = useState(getTodayString());
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [debtFormError, setDebtFormError] = useState<string | null>(null);
  const [isSubmittingDebt, setIsSubmittingDebt] = useState(false);

  const isSubmittingRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Escape key listener
  useEffect(() => {
    if (!isDebtModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmittingRef.current && !isSubmittingDebt) {
        setIsDebtModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDebtModalOpen, isSubmittingDebt]);

  const allDebts = data.debts;

  // Separate Receivables vs Payables based on direction (or [PAY] / [RECEIVE] description convention)
  const receiveDebts = useMemo(() => {
    return allDebts.filter(d => (d.direction || 'receive') === 'receive');
  }, [allDebts]);

  const payDebts = useMemo(() => {
    return allDebts.filter(d => d.direction === 'pay');
  }, [allDebts]);

  const { totalToReceive, totalToPay } = useMemo(
    () => calculateSeparateDebtTotals(allDebts, data.debtRepayments),
    [allDebts, data.debtRepayments]
  );

  // Autocomplete names
  const existingPeople = useMemo(() => {
    const names = new Set<string>();
    allDebts.forEach(d => {
      if (d.person_name) names.add(d.person_name.trim());
    });
    return Array.from(names).sort();
  }, [allDebts]);

  // Open Create Modal
  const openCreateModal = (dir: DebtDirection) => {
    if (isSubmittingRef.current || isSubmittingDebt) return;
    setEditingDebt(null);
    setModalDirection(dir);
    setPersonName('');
    setOriginalAmount('');
    setTransactionDate(getTodayString());
    setDueDate('');
    setNotes('');
    setDebtFormError(null);
    setIsDebtModalOpen(true);
  };

  // Open Edit Modal
  const openEditModal = (debt: Debt) => {
    if (isSubmittingRef.current || isSubmittingDebt) return;
    setEditingDebt(debt);
    setModalDirection(debt.direction || 'receive');
    setPersonName(debt.person_name);
    setOriginalAmount(String(debt.original_amount));
    setTransactionDate(debt.lent_date);
    setDueDate(debt.due_date || '');
    setNotes(debt.notes || debt.description || '');
    setDebtFormError(null);
    setIsDebtModalOpen(true);
  };

  // Handle Save Debt (Add or Edit)
  const handleSaveDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || isSubmittingDebt) return;

    if (!personName.trim()) {
      setDebtFormError('Please enter the person\'s name.');
      return;
    }
    const parsedAmount = parseFloat(originalAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setDebtFormError('Please enter a valid amount greater than 0.');
      return;
    }
    if (!transactionDate) {
      setDebtFormError('Please select a valid date.');
      return;
    }

    isSubmittingRef.current = true;
    setDebtFormError(null);
    setIsSubmittingDebt(true);

    try {
      if (editingDebt) {
        await data.updateDebt(editingDebt.id, {
          person_name: personName.trim(),
          original_amount: parsedAmount,
          lent_date: transactionDate,
          due_date: dueDate.trim() || undefined,
          notes: notes.trim() || undefined,
          direction: modalDirection
        });
      } else {
        await data.addDebt({
          person_name: personName.trim(),
          original_amount: parsedAmount,
          lent_date: transactionDate,
          due_date: dueDate.trim() || undefined,
          notes: notes.trim() || undefined,
          direction: modalDirection
        });
      }

      if (isMountedRef.current) {
        setIsDebtModalOpen(false);
      }
    } catch (err) {
      if (isMountedRef.current) {
        if (
          err instanceof Error &&
          (err.name === 'DebtRequestAbortError' ||
            err.name === 'AbortError' ||
            /AbortError|Fetch is aborted/i.test(err.message))
        ) {
          setDebtFormError(err.message);
        } else if (
          err instanceof Error &&
          (err.name === 'DebtRequestTimeoutError' || err.name === 'TimeoutError')
        ) {
          setDebtFormError(err.message);
        } else {
          setDebtFormError(err instanceof Error ? err.message : 'Database error: Could not save debt record.');
        }
      }
    } finally {
      isSubmittingRef.current = false;
      if (isMountedRef.current) {
        setIsSubmittingDebt(false);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-3 border-b border-black/[0.06]">
        <h2 className="text-xl sm:text-2xl font-bold text-[#111111] tracking-tight">
          Personal Debt
        </h2>
        <p className="text-xs sm:text-sm text-neutral-500 font-normal mt-0.5">
          Manage money to receive and money to pay.
        </p>
      </div>

      {/* Two Minimal Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* SECTION 1: Money to Receive */}
        <div className="bg-white rounded-2xl border border-black/[0.08] p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#87CEEB]/20 text-[#111111] flex items-center justify-center font-bold">
                  <ArrowUpRight className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-[#111111]">Money to Receive</h3>
                  <p className="text-[11px] text-neutral-500">Money other people owe me</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => openCreateModal('receive')}
                className="flex items-center gap-1 px-3 py-1.5 bg-[#111111] text-white text-xs font-semibold rounded-xl hover:bg-black transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-[#87CEEB]" />
                <span>Add</span>
              </button>
            </div>

            {/* List */}
            <div className="mt-4 space-y-3">
              {receiveDebts.length === 0 ? (
                <p className="text-xs text-neutral-400 text-center py-8">
                  No money to receive records found.
                </p>
              ) : (
                receiveDebts.map(debt => {
                  const outstanding = calculateDebtOutstanding(debt, data.debtRepayments);
                  return (
                    <div 
                      key={debt.id} 
                      className="cv-auto p-3.5 bg-neutral-50 rounded-xl border border-neutral-200 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-[#111111] truncate">
                            {debt.person_name}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 text-[11px] text-neutral-500 mt-1 font-mono">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-neutral-400" />
                            <span>{formatHumanDate(debt.lent_date)}</span>
                          </span>
                          {debt.due_date && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3 text-neutral-400" />
                              <span className={debt.due_date < getTodayString() && outstanding > 0 ? 'text-rose-600 font-semibold' : ''}>
                                Due {formatHumanDate(debt.due_date)}
                              </span>
                            </span>
                          )}
                        </div>

                        {debt.notes && (
                          <p className="text-xs text-neutral-600 mt-1 truncate">
                            {debt.notes}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <div className="text-xs text-neutral-400">Outstanding</div>
                          <div className="text-sm font-bold font-mono text-[#111111]">
                            {formatCurrency(outstanding, data.settings.currency)}
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditModal(debt)}
                            className="p-1.5 rounded-lg text-neutral-500 hover:text-black hover:bg-neutral-200 transition-colors cursor-pointer"
                            title="Edit Record"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteDebtError(null);
                              setDeleteTargetId(debt.id);
                            }}
                            className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                            title="Delete Record"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* SECTION 2: Money to Pay */}
        <div className="bg-white rounded-2xl border border-black/[0.08] p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center font-bold">
                  <ArrowDownLeft className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-[#111111]">Money to Pay</h3>
                  <p className="text-[11px] text-neutral-500">Money I owe to other people</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => openCreateModal('pay')}
                className="flex items-center gap-1 px-3 py-1.5 bg-[#111111] text-white text-xs font-semibold rounded-xl hover:bg-black transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-amber-300" />
                <span>Add</span>
              </button>
            </div>

            {/* List */}
            <div className="mt-4 space-y-3">
              {payDebts.length === 0 ? (
                <p className="text-xs text-neutral-400 text-center py-8">
                  No money to pay records found.
                </p>
              ) : (
                payDebts.map(debt => {
                  const outstanding = calculateDebtOutstanding(debt, data.debtRepayments);
                  return (
                    <div 
                      key={debt.id} 
                      className="cv-auto p-3.5 bg-neutral-50 rounded-xl border border-neutral-200 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-[#111111] truncate">
                            {debt.person_name}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 text-[11px] text-neutral-500 mt-1 font-mono">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-neutral-400" />
                            <span>{formatHumanDate(debt.lent_date)}</span>
                          </span>
                          {debt.due_date && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3 text-neutral-400" />
                              <span className={debt.due_date < getTodayString() && outstanding > 0 ? 'text-rose-600 font-semibold' : ''}>
                                Due {formatHumanDate(debt.due_date)}
                              </span>
                            </span>
                          )}
                        </div>

                        {debt.notes && (
                          <p className="text-xs text-neutral-600 mt-1 truncate">
                            {debt.notes}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <div className="text-xs text-neutral-400">Outstanding</div>
                          <div className="text-sm font-bold font-mono text-[#111111]">
                            {formatCurrency(outstanding, data.settings.currency)}
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditModal(debt)}
                            className="p-1.5 rounded-lg text-neutral-500 hover:text-black hover:bg-neutral-200 transition-colors cursor-pointer"
                            title="Edit Record"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteDebtError(null);
                              setDeleteTargetId(debt.id);
                            }}
                            className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                            title="Delete Record"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

      </div>

      {/* Bottom Summary Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-black/[0.08] p-5 shadow-xs flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[#87CEEB]/20 text-[#111111] flex items-center justify-center shrink-0">
              <ArrowUpRight className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-[#111111] truncate">Total Money to Receive</h3>
              <p className="text-[11px] text-neutral-500">Outstanding amount others owe me</p>
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-[#111111] shrink-0">
            {formatCurrency(totalToReceive, data.settings.currency)}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-black/[0.08] p-5 shadow-xs flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
              <ArrowDownLeft className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-[#111111] truncate">Total Money to Pay</h3>
              <p className="text-[11px] text-neutral-500">Outstanding amount I owe others</p>
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-[#111111] shrink-0">
            {formatCurrency(totalToPay, data.settings.currency)}
          </div>
        </div>
      </div>

      {/* ADD / EDIT DEBT MODAL */}
      {isDebtModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs"
          onClick={() => { if (!isSubmittingRef.current && !isSubmittingDebt) setIsDebtModalOpen(false); }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-black/[0.08] p-5 sm:p-6 max-h-[90vh] overflow-y-auto overflow-x-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-black/[0.06]">
              <div>
                <h3 className="font-bold text-base text-[#111111] tracking-tight">
                  {editingDebt ? 'Edit Debt Record' : (modalDirection === 'receive' ? 'Add Money to Receive' : 'Add Money to Pay')}
                </h3>
                <p className="text-xs text-neutral-500">
                  {modalDirection === 'receive' ? 'Money other people owe me' : 'Money I owe to other people'}
                </p>
              </div>
              <button
                type="button"
                disabled={isSubmittingDebt}
                onClick={() => { if (!isSubmittingRef.current && !isSubmittingDebt) setIsDebtModalOpen(false); }}
                aria-label="Close modal"
                className="p-1 rounded-lg text-neutral-400 hover:text-neutral-900 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {debtFormError && (
              <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{debtFormError}</span>
              </div>
            )}

            <form onSubmit={handleSaveDebt} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Person Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Alex Johnson"
                  value={personName}
                  onChange={(e) => setPersonName(e.target.value)}
                  list="borrower-suggestions"
                  className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
                <datalist id="borrower-suggestions">
                  {existingPeople.map(p => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>

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
                  value={originalAmount}
                  onChange={(e) => setOriginalAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Date *
                </label>
                <input
                  type="date"
                  required
                  value={transactionDate}
                  onChange={(e) => setTransactionDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Due Date (Optional)
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Note (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Optional note or reference..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-neutral-100">
                <button
                  type="button"
                  disabled={isSubmittingDebt}
                  onClick={() => setIsDebtModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingDebt}
                  className="px-5 py-2 text-xs font-semibold bg-[#111111] text-white rounded-xl hover:bg-black transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingDebt ? 'Saving...' : (editingDebt ? 'Update Record' : 'Save Record')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={deleteTargetId !== null}
        title="Delete Debt Record"
        message="Are you sure you want to permanently delete this debt record?"
        confirmLabel="Delete"
        isLoading={isDeletingDebt}
        error={deleteDebtError}
        onConfirm={async () => {
          if (!deleteTargetId || isDeletingDebt) return;
          setDeleteDebtError(null);
          setIsDeletingDebt(true);
          try {
            await data.deleteDebt(deleteTargetId);
            setDeleteTargetId(null);
          } catch (err) {
            setDeleteDebtError(err instanceof Error ? err.message : 'Database error: Could not delete debt.');
          } finally {
            setIsDeletingDebt(false);
          }
        }}
        onCancel={() => {
          setDeleteDebtError(null);
          setDeleteTargetId(null);
        }}
      />
    </div>
  );
};
