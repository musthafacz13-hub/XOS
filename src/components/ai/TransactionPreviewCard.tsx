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

  const fieldInputClass =
    'w-full min-h-[44px] sm:min-h-[38px] rounded-xl border border-black/[0.12] bg-white px-3 py-2 text-base sm:text-sm text-[#1d1d1f] focus:outline-none focus:border-[#0284c7] focus:ring-2 focus:ring-[#0284c7]/15';

  return (
    <div
      data-testid="transaction-preview-card"
      className="mb-3 rounded-2xl border border-black/[0.08] bg-[#f5f5f7] p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-[#0284c7] truncate">
            {getIntentBadge(tx)}
          </span>
          <span aria-hidden="true" className="text-[#86868b] text-xs">·</span>
          <span className="text-xs text-[#6e6e73] truncate">
            Requires confirmation
          </span>
        </div>

        {!isEditing && (
          <button
            type="button"
            onClick={onStartEdit}
            disabled={isSaving}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-[#6e6e73] hover:text-[#1d1d1f] hover:bg-white cursor-pointer disabled:opacity-50 min-h-[36px]"
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
              <span className="text-[11px] font-medium text-[#6e6e73]">Amount</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={draft.amount}
                onChange={(e) => setDraft(prev => ({ ...prev, amount: e.target.value }))}
                className={`${fieldInputClass} font-mono tabular-nums`}
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-[#6e6e73]">Date</span>
              <input
                type="date"
                value={draft.date}
                onChange={(e) => setDraft(prev => ({ ...prev, date: e.target.value }))}
                className={fieldInputClass}
              />
            </label>

            {tx.intent === 'create_expense' && (
              <>
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-[#6e6e73]">Category</span>
                  <select
                    value={draft.category}
                    onChange={(e) => setDraft(prev => ({ ...prev, category: e.target.value }))}
                    className={fieldInputClass}
                  >
                    {expenseCatOptions.map(cat => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-[#6e6e73]">Payment Method</span>
                  <select
                    value={draft.paymentMethod}
                    onChange={(e) =>
                      setDraft(prev => ({
                        ...prev,
                        paymentMethod: e.target.value as ValidPaymentMethod
                      }))
                    }
                    className={fieldInputClass}
                  >
                    {ALLOWED_PAYMENT_METHODS.map(pm => (
                      <option key={pm} value={pm}>
                        {pm}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1 sm:col-span-2">
                  <span className="text-[11px] font-medium text-[#6e6e73]">Description</span>
                  <input
                    type="text"
                    value={draft.title}
                    onChange={(e) => setDraft(prev => ({ ...prev, title: e.target.value }))}
                    className={fieldInputClass}
                  />
                </label>
              </>
            )}

            {tx.intent === 'create_income' && (
              <>
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-[#6e6e73]">Source</span>
                  <select
                    value={draft.source}
                    onChange={(e) => setDraft(prev => ({ ...prev, source: e.target.value }))}
                    className={fieldInputClass}
                  >
                    {incomeSrcOptions.map(src => (
                      <option key={src} value={src}>
                        {src}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-[#6e6e73]">Description</span>
                  <input
                    type="text"
                    value={draft.title}
                    onChange={(e) => setDraft(prev => ({ ...prev, title: e.target.value }))}
                    className={fieldInputClass}
                  />
                </label>
              </>
            )}

            {(tx.intent === 'create_debt_receivable' || tx.intent === 'create_debt_payable') && (
              <>
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-[#6e6e73]">Person</span>
                  <input
                    type="text"
                    value={draft.personName}
                    onChange={(e) => setDraft(prev => ({ ...prev, personName: e.target.value }))}
                    className={fieldInputClass}
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-[#6e6e73]">Due Date (Optional)</span>
                  <input
                    type="date"
                    value={draft.dueDate}
                    onChange={(e) => setDraft(prev => ({ ...prev, dueDate: e.target.value }))}
                    className={fieldInputClass}
                  />
                </label>

                <label className="block space-y-1 sm:col-span-2">
                  <span className="text-[11px] font-medium text-[#6e6e73]">Description</span>
                  <input
                    type="text"
                    value={draft.description}
                    onChange={(e) => setDraft(prev => ({ ...prev, description: e.target.value }))}
                    className={fieldInputClass}
                  />
                </label>
              </>
            )}

            {tx.intent === 'record_debt_repayment' && (
              <label className="block space-y-1 sm:col-span-2">
                <span className="text-[11px] font-medium text-[#6e6e73]">Payment Method</span>
                <select
                  value={draft.paymentMethod}
                  onChange={(e) =>
                    setDraft(prev => ({
                      ...prev,
                      paymentMethod: e.target.value as ValidPaymentMethod
                    }))
                  }
                  className={fieldInputClass}
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
                    <span className="text-[11px] font-medium text-[#6e6e73]">Savings Goal</span>
                    <select
                      value={draft.savingsGoalId}
                      onChange={(e) => setDraft(prev => ({ ...prev, savingsGoalId: e.target.value }))}
                      className={fieldInputClass}
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
                  <span className="text-[11px] font-medium text-[#6e6e73]">Type</span>
                  <select
                    value={draft.transactionType}
                    onChange={(e) =>
                      setDraft(prev => ({
                        ...prev,
                        transactionType: e.target.value as 'deposit' | 'withdrawal'
                      }))
                    }
                    className={fieldInputClass}
                  >
                    <option value="deposit">Deposit</option>
                    <option value="withdrawal">Withdrawal</option>
                  </select>
                </label>
              </>
            )}

            <label className="block space-y-1 sm:col-span-2">
              <span className="text-[11px] font-medium text-[#6e6e73]">Notes (Optional)</span>
              <input
                type="text"
                value={draft.notes}
                onChange={(e) => setDraft(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Optional note"
                className={fieldInputClass}
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
              className="px-3.5 py-2 rounded-xl border border-black/[0.12] bg-white text-xs font-medium text-[#1d1d1f] hover:bg-[#fbfbfd] cursor-pointer min-h-[44px] sm:min-h-[38px]"
            >
              Back
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-semibold cursor-pointer min-h-[44px] sm:min-h-[38px]"
            >
              Apply Changes
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl bg-white p-3.5 text-xs">
            <div>
              <span className="text-[#86868b] block">Amount</span>
              <span className="font-semibold text-[#1d1d1f] text-sm font-mono tabular-nums">
                {fmt(tx.amount)}
              </span>
            </div>

            <div>
              <span className="text-[#86868b] block">Date</span>
              <span className="font-medium text-[#1d1d1f] tabular-nums">{tx.date}</span>
            </div>

            {tx.intent === 'create_expense' && (
              <>
                <div>
                  <span className="text-[#86868b] block">Category</span>
                  <span className="font-medium text-[#1d1d1f]">{tx.category}</span>
                </div>
                <div>
                  <span className="text-[#86868b] block">Payment</span>
                  <span className="font-medium text-[#1d1d1f]">{tx.paymentMethod}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-[#86868b] block">Description</span>
                  <span className="font-medium text-[#1d1d1f]">{tx.title}</span>
                </div>
                {tx.notes && (
                  <div className="col-span-2">
                    <span className="text-[#86868b] block">Notes</span>
                    <span className="text-[#6e6e73]">{tx.notes}</span>
                  </div>
                )}
              </>
            )}

            {tx.intent === 'create_income' && (
              <>
                <div>
                  <span className="text-[#86868b] block">Source</span>
                  <span className="font-medium text-[#1d1d1f]">{tx.source}</span>
                </div>
                <div>
                  <span className="text-[#86868b] block">Description</span>
                  <span className="font-medium text-[#1d1d1f]">{tx.title}</span>
                </div>
                {tx.notes && (
                  <div className="col-span-2">
                    <span className="text-[#86868b] block">Notes</span>
                    <span className="text-[#6e6e73]">{tx.notes}</span>
                  </div>
                )}
              </>
            )}

            {(tx.intent === 'create_debt_receivable' || tx.intent === 'create_debt_payable') && (
              <>
                <div>
                  <span className="text-[#86868b] block">Person</span>
                  <span className="font-medium text-[#1d1d1f]">{tx.personName}</span>
                </div>
                <div>
                  <span className="text-[#86868b] block">Direction</span>
                  <span className="font-medium text-[#1d1d1f]">
                    {tx.direction === 'receive' ? 'Money to Receive' : 'Money to Pay'}
                  </span>
                </div>
                {tx.dueDate && (
                  <div>
                    <span className="text-[#86868b] block">Due Date</span>
                    <span className="font-medium text-[#1d1d1f] tabular-nums">{tx.dueDate}</span>
                  </div>
                )}
                {tx.description && (
                  <div className="col-span-2">
                    <span className="text-[#86868b] block">Description</span>
                    <span className="text-[#6e6e73]">{tx.description}</span>
                  </div>
                )}
              </>
            )}

            {tx.intent === 'record_debt_repayment' && (
              <>
                <div>
                  <span className="text-[#86868b] block">Person</span>
                  <span className="font-medium text-[#1d1d1f]">{tx.personName}</span>
                </div>
                <div>
                  <span className="text-[#86868b] block">Payment</span>
                  <span className="font-medium text-[#1d1d1f]">{tx.paymentMethod}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-[#86868b] block">Remaining Balance</span>
                  <span className="font-medium text-[#1d1d1f] font-mono tabular-nums">
                    {fmt(tx.remainingBefore)} → {fmt(tx.remainingAfter)}
                  </span>
                </div>
                {tx.direction === 'pay' && (
                  <div className="col-span-2 text-[11px] text-[#0284c7]">
                    Also logs a linked Debt Repayment expense automatically.
                  </div>
                )}
              </>
            )}

            {tx.intent === 'create_savings_transaction' && (
              <>
                <div>
                  <span className="text-[#86868b] block">Savings Goal</span>
                  <span className="font-medium text-[#1d1d1f]">{tx.savingsGoalName}</span>
                </div>
                <div>
                  <span className="text-[#86868b] block">Type</span>
                  <span className="font-medium text-[#1d1d1f] capitalize">{tx.transactionType}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-[#86868b] block">Updated Balance</span>
                  <span className="font-medium text-[#1d1d1f] font-mono tabular-nums">
                    {fmt(tx.currentBalanceBefore)} → {fmt(tx.balanceAfter)}
                  </span>
                </div>
                {tx.note && (
                  <div className="col-span-2">
                    <span className="text-[#86868b] block">Note</span>
                    <span className="text-[#6e6e73]">{tx.note}</span>
                  </div>
                )}
              </>
            )}
          </div>

          <p className="text-[11px] text-[#6e6e73]">
            Tap Confirm &amp; Save, or speak “Yes, confirm” / “അതെ, save ചെയ്യൂ”.
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onConfirm}
              disabled={isSaving}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 min-h-[44px] sm:min-h-[40px]"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{isSaving ? 'Saving…' : 'Confirm & Save'}</span>
            </button>

            <button
              type="button"
              onClick={onCancel}
              disabled={isSaving}
              className="inline-flex items-center justify-center gap-1 px-3.5 py-2.5 rounded-xl border border-black/[0.12] bg-white hover:bg-[#fbfbfd] text-xs font-medium text-[#1d1d1f] cursor-pointer disabled:opacity-60 min-h-[44px] sm:min-h-[40px]"
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
