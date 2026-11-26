import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus,
  Trash2,
  Edit3,
  AlertCircle,
  Banknote,
  History
} from 'lucide-react';
import { useXOSData } from '../../hooks/useXOSData';
import { Debt, DebtDirection, PaymentMethod } from '../../types';
import { calculateDebtOutstanding, calculateSeparateDebtTotals } from '../../utils/calculations';
import { formatCurrency, formatHumanDate, getTodayString } from '../../utils/formatters';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { sanitizeDatabaseErrorMessage } from '../../utils/authValidation';
import {
  ActionIconButton,
  INPUT_CLASS,
  LABEL_CLASS,
  MONO_INPUT_CLASS,
  MetricCard,
  Modal,
  PRIMARY_BUTTON_CLASS,
  PageHeader,
  SECONDARY_BUTTON_CLASS,
  SELECT_CLASS,
  SUBTLE_BUTTON_CLASS,
  SectionCard,
  TEXTAREA_CLASS
} from '../ui';

export const DebtView: React.FC = () => {
  const data = useXOSData();

  // Modals
  const [isDebtModalOpen, setIsDebtModalOpen] = useState(false);
  const [editingDebt, setEditingDebt] = useState<Debt | null>(null);
  const [modalDirection, setModalDirection] = useState<DebtDirection>('receive');

  // Repayment Modal
  const [repaymentDebtId, setRepaymentDebtId] = useState<string | null>(null);
  const [repayAmount, setRepayAmount] = useState('');
  const [repayDate, setRepayDate] = useState(getTodayString());
  const [repayMethod, setRepayMethod] = useState<PaymentMethod>('Bank Transfer');
  const [repayNotes, setRepayNotes] = useState('');
  const [repayError, setRepayError] = useState<string | null>(null);
  const [isSubmittingRepay, setIsSubmittingRepay] = useState(false);
  const isSubmittingRepayRef = useRef(false);

  // Repayment delete confirm
  const [deleteRepaymentId, setDeleteRepaymentId] = useState<string | null>(null);
  const [isDeletingRepayment, setIsDeletingRepayment] = useState(false);
  const [deleteRepaymentError, setDeleteRepaymentError] = useState<string | null>(null);

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

  const allDebts = data.debts;

  const receiveDebts = useMemo(
    () => allDebts.filter(d => (d.direction || 'receive') === 'receive'),
    [allDebts]
  );

  const payDebts = useMemo(
    () => allDebts.filter(d => d.direction === 'pay'),
    [allDebts]
  );

  const { totalToReceive, totalToPay } = useMemo(
    () => calculateSeparateDebtTotals(allDebts, data.debtRepayments),
    [allDebts, data.debtRepayments]
  );

  const existingPeople = useMemo(() => {
    const names = new Set<string>();
    allDebts.forEach(d => {
      if (d.person_name) names.add(d.person_name.trim());
    });
    return Array.from(names).sort();
  }, [allDebts]);

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

  const activeRepaymentDebt = useMemo(
    () => (repaymentDebtId ? allDebts.find(d => d.id === repaymentDebtId) || null : null),
    [allDebts, repaymentDebtId]
  );

  const activeRepaymentOutstanding = useMemo(
    () => (activeRepaymentDebt ? calculateDebtOutstanding(activeRepaymentDebt, data.debtRepayments) : 0),
    [activeRepaymentDebt, data.debtRepayments]
  );

  const activeDebtRepayments = useMemo(() => {
    if (!repaymentDebtId) return [];
    return data.debtRepayments
      .filter(r => r.debt_id === repaymentDebtId)
      .slice()
      .sort((a, b) => (b.repayment_date || '').localeCompare(a.repayment_date || '') || (b.created_at || '').localeCompare(a.created_at || ''));
  }, [data.debtRepayments, repaymentDebtId]);

  const openRepaymentModal = (debt: Debt) => {
    const outstanding = calculateDebtOutstanding(debt, data.debtRepayments);
    setRepaymentDebtId(debt.id);
    setRepayAmount(outstanding > 0 ? String(outstanding) : '');
    setRepayDate(getTodayString());
    setRepayMethod('Bank Transfer');
    setRepayNotes('');
    setRepayError(null);
    isSubmittingRepayRef.current = false;
    setIsSubmittingRepay(false);
  };

  const handleSaveRepayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRepaymentDebt || isSubmittingRepayRef.current || isSubmittingRepay) return;

    const parsedAmount = parseFloat(repayAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setRepayError('Repayment amount must be greater than 0.');
      return;
    }
    if (parsedAmount > activeRepaymentOutstanding + 0.001) {
      setRepayError(`Repayment cannot exceed remaining balance of ${formatCurrency(activeRepaymentOutstanding, data.settings.currency)}.`);
      return;
    }
    if (!repayDate) {
      setRepayError('Please select a valid repayment date.');
      return;
    }

    isSubmittingRepayRef.current = true;
    setRepayError(null);
    setIsSubmittingRepay(true);
    try {
      await data.addDebtRepayment({
        debt_id: activeRepaymentDebt.id,
        amount: parsedAmount,
        repayment_date: repayDate,
        payment_method: repayMethod,
        notes: repayNotes.trim() || undefined
      });
      if (isMountedRef.current) {
        const nextOutstanding = Math.max(0, Number((activeRepaymentOutstanding - parsedAmount).toFixed(2)));
        setRepayAmount(nextOutstanding > 0 ? String(nextOutstanding) : '');
        setRepayNotes('');
      }
    } catch (err) {
      if (isMountedRef.current) {
        setRepayError(sanitizeDatabaseErrorMessage(err, 'Database error: Could not record repayment.'));
      }
    } finally {
      isSubmittingRepayRef.current = false;
      if (isMountedRef.current) {
        setIsSubmittingRepay(false);
      }
    }
  };

  const handleSaveDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || isSubmittingDebt) return;

    if (!personName.trim()) {
      setDebtFormError("Please enter the person's name.");
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
          due_date: dueDate.trim(),
          notes: notes.trim(),
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
          setDebtFormError(sanitizeDatabaseErrorMessage(err, 'Database error: Could not save debt record.'));
        }
      }
    } finally {
      isSubmittingRef.current = false;
      if (isMountedRef.current) {
        setIsSubmittingDebt(false);
      }
    }
  };

  const renderDebtRow = (debt: Debt, direction: 'receive' | 'pay') => {
    const outstanding = calculateDebtOutstanding(debt, data.debtRepayments);
    const repaid = Math.max(0, Number((debt.original_amount - outstanding).toFixed(2)));
    const statusLabel = outstanding <= 0.005 ? 'Paid' : repaid > 0 ? 'Partially Paid' : 'Outstanding';
    const statusToneClass =
      statusLabel === 'Paid'
        ? 'text-[#1f7a4c]'
        : statusLabel === 'Partially Paid'
          ? 'text-[#0071e3]'
          : 'text-[#6e6e73]';
    const isOverdue = Boolean(debt.due_date && debt.due_date < getTodayString() && outstanding > 0);

    return (
      <div
        key={debt.id}
        className="cv-auto py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-medium text-sm text-[#1d1d1f] truncate">
              {debt.person_name}
            </span>
            <span className={`text-xs font-medium ${statusToneClass}`}>
              · {statusLabel}
            </span>
          </div>

          <div className="text-xs text-[#6e6e73] font-mono tabular-nums flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>{formatHumanDate(debt.lent_date)}</span>
            {debt.due_date && (
              <>
                <span aria-hidden="true">·</span>
                <span className={isOverdue ? 'text-[#c92a2a] font-medium' : ''}>
                  Due {formatHumanDate(debt.due_date)}
                </span>
              </>
            )}
            {repaid > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {direction === 'pay' ? 'Paid' : 'Repaid'} {formatCurrency(repaid, data.settings.currency)} of {formatCurrency(debt.original_amount, data.settings.currency)}
                </span>
              </>
            )}
          </div>

          {debt.notes && (
            <p className="text-xs text-[#6e6e73] truncate">{debt.notes}</p>
          )}
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
          <div className="sm:text-right">
            <span className="text-[11px] text-[#86868b] block">Outstanding</span>
            <span className="text-sm font-semibold font-mono text-[#1d1d1f] tabular-nums">
              {formatCurrency(outstanding, data.settings.currency)}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => openRepaymentModal(debt)}
              className="min-h-[40px] sm:min-h-[34px] px-3 py-1.5 rounded-xl text-xs font-medium bg-[#f5f5f7] hover:bg-[#e8e8ed] text-[#1d1d1f] transition-colors cursor-pointer inline-flex items-center gap-1.5"
              title="Repay / History"
            >
              <Banknote className="w-3.5 h-3.5 text-[#0071e3]" />
              <span>{outstanding > 0 ? 'Repay' : 'History'}</span>
            </button>
            <ActionIconButton
              icon={Edit3}
              label="Edit debt record"
              variant="edit"
              onClick={() => openEditModal(debt)}
            />
            <ActionIconButton
              icon={Trash2}
              label="Delete debt record"
              variant="delete"
              onClick={() => {
                setDeleteDebtError(null);
                setDeleteTargetId(debt.id);
              }}
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Personal Debt"
        description="Manage money to receive and money to pay with full repayment history."
      />

      {/* Directional Ledger Summary Band */}
      <section aria-label="Debt Position Summary" className="rounded-3xl bg-[#f5f5f7] p-4 sm:p-5">
        <div className="rounded-2xl bg-white border border-black/[0.06] grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-black/[0.06] overflow-hidden">
          <div className="p-5 sm:p-6 space-y-1.5">
            <span className="text-xs font-medium text-[#6e6e73]">Total Money to Receive</span>
            <div className="text-[26px] font-semibold font-mono tabular-nums tracking-[-0.025em] text-[#0071e3]">
              {formatCurrency(totalToReceive, data.settings.currency)}
            </div>
            <p className="text-xs text-[#86868b]">Outstanding amount others owe you</p>
          </div>

          <div className="p-5 sm:p-6 space-y-1.5">
            <span className="text-xs font-medium text-[#6e6e73]">Total Money to Pay</span>
            <div className="text-[26px] font-semibold font-mono tabular-nums tracking-[-0.025em] text-[#1d1d1f]">
              {formatCurrency(totalToPay, data.settings.currency)}
            </div>
            <p className="text-xs text-[#86868b]">Outstanding amount you owe others</p>
          </div>

          <div className="p-5 sm:p-6 space-y-1.5">
            <span className="text-xs font-medium text-[#6e6e73]">Net Position</span>
            <div
              className={`text-[26px] font-semibold font-mono tabular-nums tracking-[-0.025em] ${
                totalToReceive - totalToPay > 0
                  ? 'text-[#1f7a4c]'
                  : totalToReceive - totalToPay < 0
                    ? 'text-[#c92a2a]'
                    : 'text-[#1d1d1f]'
              }`}
            >
              {totalToReceive - totalToPay > 0 ? '+' : ''}
              {formatCurrency(totalToReceive - totalToPay, data.settings.currency)}
            </div>
            <p className="text-xs text-[#86868b]">Receivable minus payable balances</p>
          </div>
        </div>
      </section>

      {/* Two Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <SectionCard
          title="Money to Receive"
          subtitle="Money other people owe me"
          action={
            <button
              type="button"
              onClick={() => openCreateModal('receive')}
              className={PRIMARY_BUTTON_CLASS}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          }
        >
          {receiveDebts.length === 0 ? (
            <p className="text-xs text-[#86868b] text-center py-8">
              No money to receive records found.
            </p>
          ) : (
            <div className="divide-y divide-black/[0.06] -my-2">
              {receiveDebts.map(debt => renderDebtRow(debt, 'receive'))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Money to Pay"
          subtitle="Money I owe to other people"
          action={
            <button
              type="button"
              onClick={() => openCreateModal('pay')}
              className={SUBTLE_BUTTON_CLASS}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          }
        >
          {payDebts.length === 0 ? (
            <p className="text-xs text-[#86868b] text-center py-8">
              No money to pay records found.
            </p>
          ) : (
            <div className="divide-y divide-black/[0.06] -my-2">
              {payDebts.map(debt => renderDebtRow(debt, 'pay'))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* ADD / EDIT DEBT MODAL */}
      <Modal
        isOpen={isDebtModalOpen}
        onClose={() => { if (!isSubmittingRef.current && !isSubmittingDebt) setIsDebtModalOpen(false); }}
        disableClose={isSubmittingDebt}
        maxWidth="md"
        title={editingDebt ? 'Edit Debt Record' : (modalDirection === 'receive' ? 'Add Money to Receive' : 'Add Money to Pay')}
        subtitle={modalDirection === 'receive' ? 'Money other people owe me' : 'Money I owe to other people'}
        footer={
          <>
            <button
              type="button"
              disabled={isSubmittingDebt}
              onClick={() => setIsDebtModalOpen(false)}
              className={SECONDARY_BUTTON_CLASS}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="debt-form"
              disabled={isSubmittingDebt}
              className={PRIMARY_BUTTON_CLASS}
            >
              {isSubmittingDebt ? 'Saving…' : (editingDebt ? 'Update Record' : 'Save Record')}
            </button>
          </>
        }
      >
        {debtFormError && (
          <div className="mb-4 p-3 rounded-xl bg-[#fef2f2] border border-[#c92a2a]/20 text-[#991b1b] text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#c92a2a]" />
            <span>{debtFormError}</span>
          </div>
        )}

        <form id="debt-form" onSubmit={handleSaveDebt} className="space-y-4">
          <div>
            <label className={LABEL_CLASS}>Person Name *</label>
            <input
              type="text"
              required
              placeholder="e.g. Alex Johnson"
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
              list="borrower-suggestions"
              className={INPUT_CLASS}
            />
            <datalist id="borrower-suggestions">
              {existingPeople.map(p => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>

          <div>
            <label className={LABEL_CLASS}>Amount ({data.settings.currency}) *</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              placeholder="0.00"
              value={originalAmount}
              onChange={(e) => setOriginalAmount(e.target.value)}
              className={MONO_INPUT_CLASS}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className={LABEL_CLASS}>Date *</label>
              <input
                type="date"
                required
                value={transactionDate}
                onChange={(e) => setTransactionDate(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className={LABEL_CLASS}>Due Date (Optional)</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div>
            <label className={LABEL_CLASS}>Note (Optional)</label>
            <textarea
              rows={2}
              placeholder="Optional note or reference…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={TEXTAREA_CLASS}
            />
          </div>
        </form>
      </Modal>

      {/* REPAYMENT & HISTORY MODAL */}
      <Modal
        isOpen={Boolean(activeRepaymentDebt)}
        onClose={() => {
          if (!isSubmittingRepayRef.current && !isSubmittingRepay && deleteRepaymentId === null) {
            setRepaymentDebtId(null);
          }
        }}
        disableClose={isSubmittingRepay || deleteRepaymentId !== null}
        maxWidth="lg"
        title={activeRepaymentDebt ? `${activeRepaymentDebt.person_name} — Repayments` : 'Repayments'}
        subtitle={
          activeRepaymentDebt
            ? `${activeRepaymentDebt.direction === 'pay' ? 'Money I owe' : 'Money owed to me'} · Original: ${formatCurrency(activeRepaymentDebt.original_amount, data.settings.currency)}`
            : undefined
        }
      >
        {activeRepaymentDebt && (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-2.5 p-3.5 rounded-2xl bg-[#f5f5f7] text-center">
              <div>
                <span className="text-[11px] font-medium text-[#6e6e73] block">Original</span>
                <span className="text-xs sm:text-sm font-semibold font-mono text-[#1d1d1f] tabular-nums">
                  {formatCurrency(activeRepaymentDebt.original_amount, data.settings.currency)}
                </span>
              </div>
              <div>
                <span className="text-[11px] font-medium text-[#6e6e73] block">Repaid</span>
                <span className="text-xs sm:text-sm font-semibold font-mono text-[#1f7a4c] tabular-nums">
                  {formatCurrency(
                    Math.max(0, activeRepaymentDebt.original_amount - activeRepaymentOutstanding),
                    data.settings.currency
                  )}
                </span>
              </div>
              <div>
                <span className="text-[11px] font-medium text-[#6e6e73] block">Remaining</span>
                <span className="text-xs sm:text-sm font-semibold font-mono text-[#1d1d1f] tabular-nums">
                  {formatCurrency(activeRepaymentOutstanding, data.settings.currency)}
                </span>
              </div>
            </div>

            {activeRepaymentOutstanding > 0 && (
              <form onSubmit={handleSaveRepayment} className="space-y-3.5 p-4 rounded-2xl border border-black/[0.08] bg-white">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold text-[#1d1d1f]">Record Payment</h4>
                  <button
                    type="button"
                    onClick={() => setRepayAmount(String(activeRepaymentOutstanding))}
                    className="text-xs font-medium text-[#0071e3] hover:text-[#0077ed] hover:underline cursor-pointer"
                  >
                    Fill Full Balance ({formatCurrency(activeRepaymentOutstanding, data.settings.currency)})
                  </button>
                </div>

                {repayError && (
                  <div className="p-2.5 rounded-xl bg-[#fef2f2] border border-[#c92a2a]/20 text-[#991b1b] text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-[#c92a2a]" />
                    <span>{repayError}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL_CLASS}>Amount ({data.settings.currency}) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={activeRepaymentOutstanding}
                      required
                      placeholder="0.00"
                      value={repayAmount}
                      onChange={(e) => setRepayAmount(e.target.value)}
                      className={MONO_INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Date *</label>
                    <input
                      type="date"
                      required
                      value={repayDate}
                      onChange={(e) => setRepayDate(e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL_CLASS}>Payment Method</label>
                    <select
                      value={repayMethod}
                      onChange={(e) => setRepayMethod(e.target.value as PaymentMethod)}
                      className={SELECT_CLASS}
                    >
                      <option value="Bank Transfer">Bank Transfer</option>
                      <option value="Cash">Cash</option>
                      <option value="Digital Wallet">Digital Wallet</option>
                      <option value="Debit Card">Debit Card</option>
                      <option value="Credit Card">Credit Card</option>
                    </select>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>Notes (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. Partial settlement"
                      value={repayNotes}
                      onChange={(e) => setRepayNotes(e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>

                {activeRepaymentDebt.direction === 'pay' && (
                  <p className="text-xs text-[#6e6e73]">
                    Automatically records a Debt Repayment expense for the selected date.
                  </p>
                )}

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    disabled={isSubmittingRepay}
                    className={PRIMARY_BUTTON_CLASS}
                  >
                    {isSubmittingRepay ? 'Recording…' : 'Record Repayment'}
                  </button>
                </div>
              </form>
            )}

            <div className="space-y-2.5">
              <h4 className="text-xs font-semibold text-[#1d1d1f] flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-[#0071e3]" />
                <span>Repayment History ({activeDebtRepayments.length})</span>
              </h4>

              {activeDebtRepayments.length === 0 ? (
                <p className="text-xs text-[#86868b] text-center py-5 bg-[#f5f5f7] rounded-2xl">
                  No repayments recorded yet.
                </p>
              ) : (
                <div className="divide-y divide-black/[0.06] border border-black/[0.08] rounded-2xl overflow-hidden bg-white">
                  {activeDebtRepayments.map(rep => (
                    <div key={rep.id} className="p-3.5 flex items-center justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <div className="font-mono font-semibold text-[#1d1d1f] tabular-nums">
                          {formatCurrency(rep.amount, data.settings.currency)}
                        </div>
                        <div className="text-xs text-[#6e6e73] truncate mt-0.5">
                          {formatHumanDate(rep.repayment_date)}
                          {rep.payment_method ? ` · ${rep.payment_method}` : ''}
                          {rep.notes ? ` · ${rep.notes}` : ''}
                        </div>
                      </div>
                      <ActionIconButton
                        icon={Trash2}
                        label="Delete repayment"
                        variant="delete"
                        onClick={() => {
                          setDeleteRepaymentError(null);
                          setDeleteRepaymentId(rep.id);
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={deleteTargetId !== null}
        title="Delete Debt Record"
        message={
          allDebts.find(d => d.id === deleteTargetId)?.direction === 'pay' &&
          data.debtRepayments.some(r => r.debt_id === deleteTargetId)
            ? 'Are you sure you want to permanently delete this debt record? Its repayment history and linked Debt Repayment expenses will also be removed.'
            : 'Are you sure you want to permanently delete this debt record?'
        }
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
            setDeleteDebtError(sanitizeDatabaseErrorMessage(err, 'Database error: Could not delete debt.'));
          } finally {
            setIsDeletingDebt(false);
          }
        }}
        onCancel={() => {
          setDeleteDebtError(null);
          setDeleteTargetId(null);
        }}
      />

      <ConfirmDialog
        isOpen={deleteRepaymentId !== null}
        title="Delete Repayment Entry"
        message={
          activeRepaymentDebt?.direction === 'pay'
            ? 'Are you sure you want to delete this repayment? The remaining debt balance will increase automatically and its linked Debt Repayment expense will be removed.'
            : 'Are you sure you want to delete this repayment? The remaining debt balance will increase automatically.'
        }
        confirmLabel="Delete Repayment"
        isLoading={isDeletingRepayment}
        error={deleteRepaymentError}
        onConfirm={async () => {
          if (!deleteRepaymentId || isDeletingRepayment) return;
          setDeleteRepaymentError(null);
          setIsDeletingRepayment(true);
          try {
            await data.deleteDebtRepayment(deleteRepaymentId);
            setDeleteRepaymentId(null);
          } catch (err) {
            setDeleteRepaymentError(sanitizeDatabaseErrorMessage(err, 'Database error: Could not delete repayment.'));
          } finally {
            setIsDeletingRepayment(false);
          }
        }}
        onCancel={() => {
          setDeleteRepaymentError(null);
          setDeleteRepaymentId(null);
        }}
      />
    </div>
  );
};
