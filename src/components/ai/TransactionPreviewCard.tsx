import React, { useEffect, useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import {
  ALLOWED_PAYMENT_METHODS,
  EntryCatalog,
  formatRupeesSimple,
  isValidStrictCalendarDate,
  MAX_TRANSACTION_AMOUNT,
  PendingTransactionProposal,
  ValidatedTransactionProposal,
  ValidatedTransactionProposalSchema,
  ValidPaymentMethod
} from '../../services/ai/transactionSchemas';

interface TransactionPreviewCardProps {
  proposal: PendingTransactionProposal;
  catalog: EntryCatalog;
  isEditing: boolean;
  isSaving: boolean;
  editError: string | null;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onApplyEdit: (updatedTx: ValidatedTransactionProposal) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

interface EditDraftState {
  amount: string;
  title: string;
  category: string;
  source: string;
  personName: string;
  date: string;
  dueDate: string;
  paymentMethod: ValidPaymentMethod;
  description: string;
  notes: string;
  savingsGoalId: string;
  transactionType: 'deposit' | 'withdrawal';
}

function buildInitialDraft(tx: ValidatedTransactionProposal): EditDraftState {
  switch (tx.intent) {
    case 'create_expense':
      return {
        amount: String(tx.amount),
        title: tx.title,
        category: tx.category,
        source: '',
        personName: '',
        date: tx.date,
        dueDate: '',
        paymentMethod: tx.paymentMethod,
        description: '',
        notes: tx.notes || '',
        savingsGoalId: '',
        transactionType: 'deposit'
      };
    case 'create_income':
      return {
        amount: String(tx.amount),
        title: tx.title,
        category: '',
        source: tx.source,
        personName: '',
        date: tx.date,
        dueDate: '',
        paymentMethod: 'Cash',
        description: '',
        notes: tx.notes || '',
        savingsGoalId: '',
        transactionType: 'deposit'
      };
    case 'create_debt_receivable':
    case 'create_debt_payable':
      return {
        amount: String(tx.amount),
        title: '',
        category: '',
        source: '',
        personName: tx.personName,
        date: tx.date,
        dueDate: tx.dueDate || '',
        paymentMethod: 'Cash',
        description: tx.description || '',
        notes: tx.notes || '',
        savingsGoalId: '',
        transactionType: 'deposit'
      };
    case 'record_debt_repayment':
      return {
        amount: String(tx.amount),
        title: '',
        category: '',
        source: '',
        personName: tx.personName,
        date: tx.date,
        dueDate: '',
        paymentMethod: tx.paymentMethod,
        description: '',
        notes: tx.notes || '',
        savingsGoalId: '',
        transactionType: 'deposit'
      };
    case 'create_savings_transaction':
      return {
        amount: String(tx.amount),
        title: '',
        category: '',
        source: '',
        personName: '',
        date: tx.date,
        dueDate: '',
        paymentMethod: 'Cash',
        description: '',
        notes: tx.note || '',
        savingsGoalId: tx.savingsGoalId,
        transactionType: tx.transactionType
      };
  }
}

function getIntentBadge(tx: ValidatedTransactionProposal): string {
  switch (tx.intent) {
    case 'create_expense':
      return 'Expense Preview';
    case 'create_income':
      return 'Income Preview';
    case 'create_debt_receivable':
      return 'Debt · Money to Receive';
    case 'create_debt_payable':
      return 'Debt · Money to Pay';
    case 'record_debt_repayment':
      return tx.direction === 'pay' ? 'Debt Repayment (Payable)' : 'Debt Repayment (Receivable)';
    case 'create_savings_transaction':
      return tx.transactionType === 'withdrawal' ? 'Savings Withdrawal' : 'Savings Deposit';
  }
}

export const TransactionPreviewCard: React.FC<TransactionPreviewCardProps> = ({
  proposal,
  catalog,
  isEditing,
  isSaving,
  editError,
  onStartEdit,
  onCancelEdit,
  onApplyEdit,
  onConfirm,
  onCancel
}) => {
  const tx = proposal.transaction;
  const [draft, setDraft] = useState<EditDraftState>(() => buildInitialDraft(tx));
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(buildInitialDraft(proposal.transaction));
    setLocalError(null);
  }, [proposal.proposalId, proposal.transaction, isEditing]);

  const combinedError = localError || editError;
  const fmt = (val: number) => formatRupeesSimple(val, catalog.currency);

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    const amountNum = Number(draft.amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setLocalError('Amount must be greater than zero.');
      return;
    }
    if (amountNum > MAX_TRANSACTION_AMOUNT) {
      setLocalError('Amount exceeds the supported limit.');
      return;
    }
    if (!isValidStrictCalendarDate(draft.date)) {
      setLocalError('Please enter a valid calendar date.');
      return;
    }

    let nextCandidate: ValidatedTransactionProposal;

    switch (tx.intent) {
      case 'create_expense': {
        const cleanTitle = draft.title.trim();
        if (!cleanTitle) {
          setLocalError('Description is required.');
          return;
        }
        nextCandidate = {
          intent: 'create_expense',
          amount: Number(amountNum.toFixed(2)),
          category: draft.category.trim() || tx.category,
          title: cleanTitle.slice(0, 160),
          date: draft.date,
          paymentMethod: draft.paymentMethod,
          ...(draft.notes.trim() ? { notes: draft.notes.trim().slice(0, 400) } : {})
        };
        break;
      }

      case 'create_income': {
        const cleanTitle = draft.title.trim();
        if (!cleanTitle) {
          setLocalError('Description is required.');
          return;
        }
        nextCandidate = {
          intent: 'create_income',
          amount: Number(amountNum.toFixed(2)),
          source: draft.source.trim() || tx.source,
          title: cleanTitle.slice(0, 160),
          date: draft.date,
          ...(draft.notes.trim() ? { notes: draft.notes.trim().slice(0, 400) } : {})
        };
        break;
      }

      case 'create_debt_receivable': {
        const cleanPerson = draft.personName.trim();
        if (!cleanPerson) {
          setLocalError('Person name is required.');
          return;
        }
        const dueRaw = draft.dueDate.trim();
        if (dueRaw && !isValidStrictCalendarDate(dueRaw)) {
          setLocalError('Due date must be a valid calendar date.');
          return;
        }
        nextCandidate = {
          intent: 'create_debt_receivable',
          direction: 'receive',
          personName: cleanPerson.slice(0, 120),
          amount: Number(amountNum.toFixed(2)),
          date: draft.date,
          ...(dueRaw ? { dueDate: dueRaw } : {}),
          ...(draft.description.trim() ? { description: draft.description.trim().slice(0, 200) } : {}),
          ...(draft.notes.trim() ? { notes: draft.notes.trim().slice(0, 400) } : {})
        };
        break;
      }

      case 'create_debt_payable': {
        const cleanPerson = draft.personName.trim();
        if (!cleanPerson) {
          setLocalError('Person name is required.');
          return;
        }
        const dueRaw = draft.dueDate.trim();
        if (dueRaw && !isValidStrictCalendarDate(dueRaw)) {
          setLocalError('Due date must be a valid calendar date.');
          return;
        }
        nextCandidate = {
          intent: 'create_debt_payable',
          direction: 'pay',
          personName: cleanPerson.slice(0, 120),
          amount: Number(amountNum.toFixed(2)),
          date: draft.date,
          ...(dueRaw ? { dueDate: dueRaw } : {}),
          ...(draft.description.trim() ? { description: draft.description.trim().slice(0, 200) } : {}),
          ...(draft.notes.trim() ? { notes: draft.notes.trim().slice(0, 400) } : {})
        };
        break;
      }

      case 'record_debt_repayment': {
        if (amountNum > tx.remainingBefore + 0.001) {
          setLocalError(`Repayment cannot exceed remaining balance (${fmt(tx.remainingBefore)}).`);
          return;
        }
        const remainingAfter = Math.max(0, Number((tx.remainingBefore - amountNum).toFixed(2)));
        nextCandidate = {
          intent: 'record_debt_repayment',
          debtId: tx.debtId,
          personName: tx.personName,
          direction: tx.direction,
          amount: Number(amountNum.toFixed(2)),
          remainingBefore: tx.remainingBefore,
          remainingAfter,
          date: draft.date,
          paymentMethod: draft.paymentMethod,
          ...(draft.notes.trim() ? { notes: draft.notes.trim().slice(0, 400) } : {})
        };
        break;
      }

      case 'create_savings_transaction': {
        const selectedGoal =
          catalog.activeSavingsGoals.find(g => g.id === draft.savingsGoalId) ||
          {
            id: tx.savingsGoalId,
            name: tx.savingsGoalName,
            currentAmount: tx.currentBalanceBefore,
            targetAmount: tx.currentBalanceBefore
          };

        if (draft.transactionType === 'withdrawal' && amountNum > selectedGoal.currentAmount + 0.001) {
          setLocalError(
            `Withdrawal exceeds ${selectedGoal.name}'s balance (${fmt(selectedGoal.currentAmount)}).`
          );
          return;
        }

        const balanceAfter =
          draft.transactionType === 'deposit'
            ? Number((selectedGoal.currentAmount + amountNum).toFixed(2))
            : Math.max(0, Number((selectedGoal.currentAmount - amountNum).toFixed(2)));

        nextCandidate = {
          intent: 'create_savings_transaction',
          savingsGoalId: selectedGoal.id,
          savingsGoalName: selectedGoal.name,
          transactionType: draft.transactionType,
          amount: Number(amountNum.toFixed(2)),
          currentBalanceBefore: selectedGoal.currentAmount,
          balanceAfter,
          date: draft.date,
          ...(draft.notes.trim() ? { note: draft.notes.trim().slice(0, 400) } : {})
        };
        break;
      }
    }

    const validated = ValidatedTransactionProposalSchema.safeParse(nextCandidate);
    if (!validated.success) {
      setLocalError(validated.error.issues[0]?.message || 'Invalid transaction details.');
      return;
    }

    onApplyEdit(validated.data);
  };

  const expenseCatOptions = Array.from(
    new Set([
      ...catalog.expenseCategories,
      ...(tx.intent === 'create_expense' ? [tx.category] : [])
    ])
  );
  const incomeSrcOptions = Array.from(
    new Set([
      ...catalog.incomeSources,
      ...(tx.intent === 'create_income' ? [tx.source] : [])
    ])
  );

  return (
    <div
      data-testid="transaction-preview-card"
      className="mb-3 rounded-2xl border border-[#0284C7]/25 bg-sky-50/35 p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-[#0284C7]/10 text-[#0284C7] text-xs font-semibold">
            {getIntentBadge(tx)}
          </span>
          <span className="text-[11px] text-neutral-500 truncate">
            Requires confirmation
          </span>
        </div>

        {!isEditing && (
          <button
            type="button"
            onClick={onStartEdit}
            disabled={isSaving}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-neutral-600 hover:text-[#111111] hover:bg-white cursor-pointer disabled:opacity-50 min-h-[32px]"
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>Edit</span>
          </button>
        )}
      </div>

      {isEditing ? (
        <form onSubmit={handleSaveEdit} className="space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-neutral-600">Amount</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={draft.amount}
                onChange={(e) => setDraft(prev => ({ ...prev, amount: e.target.value }))}
                className="w-full rounded-xl border border-black/[0.12] bg-white px-3 py-2 text-sm text-[#111111] focus:outline-none focus:border-[#0284C7]"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-neutral-600">Date</span>
              <input
                type="date"
                value={draft.date}
                onChange={(e) => setDraft(prev => ({ ...prev, date: e.target.value }))}
                className="w-full rounded-xl border border-black/[0.12] bg-white px-3 py-2 text-sm text-[#111111] focus:outline-none focus:border-[#0284C7]"
              />
            </label>

            {tx.intent === 'create_expense' && (
              <>
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-neutral-600">Category</span>
                  <select
                    value={draft.category}
                    onChange={(e) => setDraft(prev => ({ ...prev, category: e.target.value }))}
                    className="w-full rounded-xl border border-black/[0.12] bg-white px-3 py-2 text-sm text-[#111111] focus:outline-none focus:border-[#0284C7]"
                  >
                    {expenseCatOptions.map(cat => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-neutral-600">Payment Method</span>
                  <select
                    value={draft.paymentMethod}
                    onChange={(e) =>
                      setDraft(prev => ({
                        ...prev,
                        paymentMethod: e.target.value as ValidPaymentMethod
                      }))
                    }
                    className="w-full rounded-xl border border-black/[0.12] bg-white px-3 py-2 text-sm text-[#111111] focus:outline-none focus:border-[#0284C7]"
                  >
                    {ALLOWED_PAYMENT_METHODS.map(pm => (
                      <option key={pm} value={pm}>
                        {pm}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1 sm:col-span-2">
                  <span className="text-[11px] font-medium text-neutral-600">Description</span>
                  <input
                    type="text"
                    value={draft.title}
                    onChange={(e) => setDraft(prev => ({ ...prev, title: e.target.value }))}
                    className="w-full rounded-xl border border-black/[0.12] bg-white px-3 py-2 text-sm text-[#111111] focus:outline-none focus:border-[#0284C7]"
                  />
                </label>
              </>
            )}

            {tx.intent === 'create_income' && (
              <>
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-neutral-600">Source</span>
                  <select
                    value={draft.source}
                    onChange={(e) => setDraft(prev => ({ ...prev, source: e.target.value }))}
                    className="w-full rounded-xl border border-black/[0.12] bg-white px-3 py-2 text-sm text-[#111111] focus:outline-none focus:border-[#0284C7]"
                  >
                    {incomeSrcOptions.map(src => (
                      <option key={src} value={src}>
                        {src}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-neutral-600">Description</span>
                  <input
                    type="text"
                    value={draft.title}
                    onChange={(e) => setDraft(prev => ({ ...prev, title: e.target.value }))}
                    className="w-full rounded-xl border border-black/[0.12] bg-white px-3 py-2 text-sm text-[#111111] focus:outline-none focus:border-[#0284C7]"
                  />
                </label>
              </>
            )}

            {(tx.intent === 'create_debt_receivable' || tx.intent === 'create_debt_payable') && (
              <>
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-neutral-600">Person</span>
                  <input
                    type="text"
                    value={draft.personName}
                    onChange={(e) => setDraft(prev => ({ ...prev, personName: e.target.value }))}
                    className="w-full rounded-xl border border-black/[0.12] bg-white px-3 py-2 text-sm text-[#111111] focus:outline-none focus:border-[#0284C7]"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-neutral-600">Due Date (Optional)</span>
                  <input
                    type="date"
                    value={draft.dueDate}
                    onChange={(e) => setDraft(prev => ({ ...prev, dueDate: e.target.value }))}
                    className="w-full rounded-xl border border-black/[0.12] bg-white px-3 py-2 text-sm text-[#111111] focus:outline-none focus:border-[#0284C7]"
                  />
                </label>

                <label className="block space-y-1 sm:col-span-2">
                  <span className="text-[11px] font-medium text-neutral-600">Description</span>
                  <input
                    type="text"
                    value={draft.description}
                    onChange={(e) => setDraft(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full rounded-xl border border-black/[0.12] bg-white px-3 py-2 text-sm text-[#111111] focus:outline-none focus:border-[#0284C7]"
                  />
                </label>
              </>
            )}

            {tx.intent === 'record_debt_repayment' && (
              <label className="block space-y-1 sm:col-span-2">
                <span className="text-[11px] font-medium text-neutral-600">Payment Method</span>
                <select
                  value={draft.paymentMethod}
                  onChange={(e) =>
                    setDraft(prev => ({
                      ...prev,
                      paymentMethod: e.target.value as ValidPaymentMethod
                    }))
                  }
                  className="w-full rounded-xl border border-black/[0.12] bg-white px-3 py-2 text-sm text-[#111111] focus:outline-none focus:border-[#0284C7]"
                >
                  {ALLOWED_PAYMENT_METHODS.map(pm => (
                    <option key={pm} value={pm}>
                      {pm}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {tx.intent === 'create_savings_transaction' && (
              <>
                {catalog.activeSavingsGoals.length > 0 && (
                  <label className="block space-y-1">
                    <span className="text-[11px] font-medium text-neutral-600">Savings Goal</span>
                    <select
                      value={draft.savingsGoalId}
                      onChange={(e) => setDraft(prev => ({ ...prev, savingsGoalId: e.target.value }))}
                      className="w-full rounded-xl border border-black/[0.12] bg-white px-3 py-2 text-sm text-[#111111] focus:outline-none focus:border-[#0284C7]"
                    >
                      {catalog.activeSavingsGoals.map(goal => (
                        <option key={goal.id} value={goal.id}>
                          {goal.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-neutral-600">Type</span>
                  <select
                    value={draft.transactionType}
                    onChange={(e) =>
                      setDraft(prev => ({
                        ...prev,
                        transactionType: e.target.value as 'deposit' | 'withdrawal'
                      }))
                    }
                    className="w-full rounded-xl border border-black/[0.12] bg-white px-3 py-2 text-sm text-[#111111] focus:outline-none focus:border-[#0284C7]"
                  >
                    <option value="deposit">Deposit</option>
                    <option value="withdrawal">Withdrawal</option>
                  </select>
                </label>
              </>
            )}

            <label className="block space-y-1 sm:col-span-2">
              <span className="text-[11px] font-medium text-neutral-600">Notes (Optional)</span>
              <input
                type="text"
                value={draft.notes}
                onChange={(e) => setDraft(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Optional note"
                className="w-full rounded-xl border border-black/[0.12] bg-white px-3 py-2 text-sm text-[#111111] focus:outline-none focus:border-[#0284C7]"
              />
            </label>
          </div>

          {combinedError && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200/80 rounded-lg px-2.5 py-1.5">
              {combinedError}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onCancelEdit}
              className="px-3 py-2 rounded-xl border border-black/[0.1] bg-white text-xs font-medium text-neutral-700 hover:text-[#111111] cursor-pointer min-h-[38px]"
            >
              Back
            </button>
            <button
              type="submit"
              className="px-3.5 py-2 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold cursor-pointer min-h-[38px]"
            >
              Apply Changes
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-white border border-black/[0.06] p-3 text-xs">
            <div>
              <span className="text-neutral-400 block">Amount</span>
              <span className="font-semibold text-[#111111] text-sm tabular-nums">
                {fmt(tx.amount)}
              </span>
            </div>

            <div>
              <span className="text-neutral-400 block">Date</span>
              <span className="font-medium text-[#111111] tabular-nums">{tx.date}</span>
            </div>

            {tx.intent === 'create_expense' && (
              <>
                <div>
                  <span className="text-neutral-400 block">Category</span>
                  <span className="font-medium text-[#111111]">{tx.category}</span>
                </div>
                <div>
                  <span className="text-neutral-400 block">Payment</span>
                  <span className="font-medium text-[#111111]">{tx.paymentMethod}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-neutral-400 block">Description</span>
                  <span className="font-medium text-[#111111]">{tx.title}</span>
                </div>
                {tx.notes && (
                  <div className="col-span-2">
                    <span className="text-neutral-400 block">Notes</span>
                    <span className="text-neutral-700">{tx.notes}</span>
                  </div>
                )}
              </>
            )}

            {tx.intent === 'create_income' && (
              <>
                <div>
                  <span className="text-neutral-400 block">Source</span>
                  <span className="font-medium text-[#111111]">{tx.source}</span>
                </div>
                <div>
                  <span className="text-neutral-400 block">Description</span>
                  <span className="font-medium text-[#111111]">{tx.title}</span>
                </div>
                {tx.notes && (
                  <div className="col-span-2">
                    <span className="text-neutral-400 block">Notes</span>
                    <span className="text-neutral-700">{tx.notes}</span>
                  </div>
                )}
              </>
            )}

            {(tx.intent === 'create_debt_receivable' || tx.intent === 'create_debt_payable') && (
              <>
                <div>
                  <span className="text-neutral-400 block">Person</span>
                  <span className="font-medium text-[#111111]">{tx.personName}</span>
                </div>
                <div>
                  <span className="text-neutral-400 block">Direction</span>
                  <span className="font-medium text-[#111111]">
                    {tx.direction === 'receive' ? 'Money to Receive' : 'Money to Pay'}
                  </span>
                </div>
                {tx.dueDate && (
                  <div>
                    <span className="text-neutral-400 block">Due Date</span>
                    <span className="font-medium text-[#111111] tabular-nums">{tx.dueDate}</span>
                  </div>
                )}
                {tx.description && (
                  <div className="col-span-2">
                    <span className="text-neutral-400 block">Description</span>
                    <span className="text-neutral-700">{tx.description}</span>
                  </div>
                )}
              </>
            )}

            {tx.intent === 'record_debt_repayment' && (
              <>
                <div>
                  <span className="text-neutral-400 block">Person</span>
                  <span className="font-medium text-[#111111]">{tx.personName}</span>
                </div>
                <div>
                  <span className="text-neutral-400 block">Payment</span>
                  <span className="font-medium text-[#111111]">{tx.paymentMethod}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-neutral-400 block">Remaining Balance</span>
                  <span className="font-medium text-[#111111] tabular-nums">
                    {fmt(tx.remainingBefore)} → {fmt(tx.remainingAfter)}
                  </span>
                </div>
                {tx.direction === 'pay' && (
                  <div className="col-span-2 text-[11px] text-[#0284C7]">
                    Also logs a linked Debt Repayment expense automatically.
                  </div>
                )}
              </>
            )}

            {tx.intent === 'create_savings_transaction' && (
              <>
                <div>
                  <span className="text-neutral-400 block">Savings Goal</span>
                  <span className="font-medium text-[#111111]">{tx.savingsGoalName}</span>
                </div>
                <div>
                  <span className="text-neutral-400 block">Type</span>
                  <span className="font-medium text-[#111111] capitalize">{tx.transactionType}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-neutral-400 block">Updated Balance</span>
                  <span className="font-medium text-[#111111] tabular-nums">
                    {fmt(tx.currentBalanceBefore)} → {fmt(tx.balanceAfter)}
                  </span>
                </div>
                {tx.note && (
                  <div className="col-span-2">
                    <span className="text-neutral-400 block">Note</span>
                    <span className="text-neutral-700">{tx.note}</span>
                  </div>
                )}
              </>
            )}
          </div>

          <p className="text-[11px] text-neutral-500">
            Tap Confirm &amp; Save, or speak “Yes, confirm” / “അതെ, save ചെയ്യൂ”.
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onConfirm}
              disabled={isSaving}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 min-h-[40px]"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{isSaving ? 'Saving…' : 'Confirm & Save'}</span>
            </button>

            <button
              type="button"
              onClick={onCancel}
              disabled={isSaving}
              className="inline-flex items-center justify-center gap-1 px-3.5 py-2.5 rounded-xl border border-black/[0.1] bg-white hover:bg-neutral-50 text-xs font-medium text-neutral-700 cursor-pointer disabled:opacity-60 min-h-[40px]"
            >
              <X className="w-3.5 h-3.5" />
              <span>Cancel</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
};
