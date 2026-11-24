/**
 * XOS Jarvis — Confirmed Transaction Executor
 * Executes ONLY user-confirmed, schema-validated, non-expired transaction proposals
 * through authenticated XOS repository functions, with strict in-memory idempotency.
 */
import {
  Debt,
  DebtRepayment,
  Expense,
  Income,
  SavingsTransaction
} from '../../types';
import { formatCurrency } from '../../utils/formatters';
import { repository } from '../repository';
import {
  formatRupeesSimple,
  PendingTransactionProposal,
  ValidatedTransactionProposal,
  ValidatedTransactionProposalSchema
} from './transactionSchemas';

export type ConfirmationSource = 'button' | 'voice';

export interface ExecuteConfirmedTransactionResult {
  ok: true;
  deduplicated: boolean;
  intent: ValidatedTransactionProposal['intent'];
  recordId: string;
  confirmationMessage: string;
  createdRecord: Expense | Income | Debt | DebtRepayment | SavingsTransaction;
}

const MAX_COMPLETED_IDEMPOTENCY_ENTRIES = 100;
const inFlightExecutions = new Map<string, Promise<ExecuteConfirmedTransactionResult>>();
const completedExecutions = new Map<string, ExecuteConfirmedTransactionResult>();

export function resetTransactionExecutorState(): void {
  inFlightExecutions.clear();
  completedExecutions.clear();
}

function getExecutorUserScope(): string {
  const hyd = repository.getHydrationState();
  return hyd.hydratedUserId || 'local';
}

function recordCompletedExecution(key: string, result: ExecuteConfirmedTransactionResult): void {
  if (completedExecutions.size >= MAX_COMPLETED_IDEMPOTENCY_ENTRIES) {
    const oldestKey = completedExecutions.keys().next().value;
    if (oldestKey) {
      completedExecutions.delete(oldestKey);
    }
  }
  completedExecutions.set(key, result);
}

export function buildSuccessConfirmationMessage(
  tx: ValidatedTransactionProposal,
  lang: 'ml' | 'en' | 'mixed',
  currency: string = 'INR'
): string {
  const isMl = lang === 'ml' || lang === 'mixed';
  const fmt = (amt: number) => {
    try {
      return formatCurrency(amt, currency as never);
    } catch {
      return formatRupeesSimple(amt, currency);
    }
  };

  switch (tx.intent) {
    case 'create_expense': {
      const amt = fmt(tx.amount);
      return isMl
        ? `${amt} ${tx.category} ചെലവ് വിജയകരമായി ചേർത്തു.`
        : `Saved ${amt} under ${tx.category} expenses.`;
    }
    case 'create_income': {
      const amt = fmt(tx.amount);
      return isMl
        ? `${amt} ${tx.source} വരവ് വിജയകരമായി ചേർത്തു.`
        : `Saved ${amt} income under ${tx.source}.`;
    }
    case 'create_debt_receivable': {
      const amt = fmt(tx.amount);
      return isMl
        ? `${tx.personName}-ൽ നിന്ന് ${amt} കിട്ടാനുള്ള കടമായി ചേർത്തു.`
        : `Recorded ${amt} owed to you by ${tx.personName}.`;
    }
    case 'create_debt_payable': {
      const amt = fmt(tx.amount);
      return isMl
        ? `${tx.personName}-ന് ${amt} കൊടുക്കാനുള്ള കടമായി ചേർത്തു.`
        : `Recorded ${amt} owed to ${tx.personName}.`;
    }
    case 'record_debt_repayment': {
      const amt = fmt(tx.amount);
      if (isMl) {
        return tx.direction === 'pay'
          ? `${tx.personName}-ന് ${amt} തിരിച്ചടവും Debt Repayment ചെലവും വിജയകരമായി ചേർത്തു.`
          : `${tx.personName}-ൽ നിന്ന് ${amt} തിരിച്ചുകിട്ടിയതായി വിജയകരമായി രേഖപ്പെടുത്തി.`;
      }
      return tx.direction === 'pay'
        ? `Recorded ${amt} debt repayment to ${tx.personName} and logged the linked Debt Repayment expense.`
        : `Recorded ${amt} repayment received from ${tx.personName}.`;
    }
    case 'create_savings_transaction': {
      const amt = fmt(tx.amount);
      if (isMl) {
        return tx.transactionType === 'withdrawal'
          ? `${tx.savingsGoalName}-ൽ നിന്ന് ${amt} പിൻവലിക്കൽ വിജയകരമായി രേഖപ്പെടുത്തി.`
          : `${tx.savingsGoalName} സേവിങ്സിലേക്ക് ${amt} വിജയകരമായി ചേർത്തു.`;
      }
      return tx.transactionType === 'withdrawal'
        ? `Recorded ${amt} withdrawal from ${tx.savingsGoalName}.`
        : `Added ${amt} to ${tx.savingsGoalName}.`;
    }
  }
}

export async function executeConfirmedTransaction(params: {
  proposal: PendingTransactionProposal;
  confirmedByUser: boolean;
  confirmationSource: ConfirmationSource;
  nowMs?: number;
}): Promise<ExecuteConfirmedTransactionResult> {
  const { proposal, confirmedByUser } = params;
  const nowMs = params.nowMs ?? Date.now();

  if (confirmedByUser !== true) {
    throw new Error('Explicit user confirmation is required before saving any transaction.');
  }

  if (!proposal || !proposal.proposalId || !proposal.idempotencyKey) {
    throw new Error('Invalid transaction confirmation payload.');
  }

  const scopeKey = `${getExecutorUserScope()}:${proposal.idempotencyKey}`;

  // 1. Return previously completed result cleanly without re-creating duplicate DB rows
  const alreadySaved = completedExecutions.get(scopeKey);
  if (alreadySaved) {
    return {
      ...alreadySaved,
      deduplicated: true
    };
  }

  // 2. Coalesce concurrent duplicate confirmation calls (e.g. double-tap or voice+click race)
  const inFlight = inFlightExecutions.get(scopeKey);
  if (inFlight) {
    const res = await inFlight;
    return {
      ...res,
      deduplicated: true
    };
  }

  // 3. Reject expired confirmation previews
  if (nowMs > proposal.expiresAtMs) {
    throw new Error('This transaction preview has expired. Please speak or type it again to review before saving.');
  }

  // 4. Re-validate strictly against Zod discriminated union schema right before persistence
  const parsed = ValidatedTransactionProposalSchema.safeParse(proposal.transaction);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message || 'Transaction details failed validation.');
  }

  const tx = parsed.data;
  const settings = repository.getSettings();
  const currency = settings.currency || 'INR';

  const runPromise = (async (): Promise<ExecuteConfirmedTransactionResult> => {
    let createdRecord: Expense | Income | Debt | DebtRepayment | SavingsTransaction;
    let recordId = '';

    switch (tx.intent) {
      case 'create_expense': {
        const created = await repository.addExpense({
          title: tx.title,
          amount: tx.amount,
          category: tx.category,
          date: tx.date,
          paymentMethod: tx.paymentMethod,
          notes: tx.notes
        });
        createdRecord = created;
        recordId = created.id;
        break;
      }

      case 'create_income': {
        const created = await repository.addIncome({
          title: tx.title,
          amount: tx.amount,
          source: tx.source,
          date: tx.date,
          notes: tx.notes
        });
        createdRecord = created;
        recordId = created.id;
        break;
      }

      case 'create_debt_receivable': {
        const created = await repository.addDebt({
          person_name: tx.personName,
          original_amount: tx.amount,
          lent_date: tx.date,
          due_date: tx.dueDate,
          description: tx.description,
          notes: tx.notes,
          direction: 'receive'
        });
        createdRecord = created;
        recordId = created.id;
        break;
      }

      case 'create_debt_payable': {
        const created = await repository.addDebt({
          person_name: tx.personName,
          original_amount: tx.amount,
          lent_date: tx.date,
          due_date: tx.dueDate,
          description: tx.description,
          notes: tx.notes,
          direction: 'pay'
        });
        createdRecord = created;
        recordId = created.id;
        break;
      }

      case 'record_debt_repayment': {
        const created = await repository.addDebtRepayment({
          debt_id: tx.debtId,
          amount: tx.amount,
          repayment_date: tx.date,
          payment_method: tx.paymentMethod,
          notes: tx.notes
        });
        createdRecord = created;
        recordId = created.id;
        break;
      }

      case 'create_savings_transaction': {
        const created = await repository.addSavingsTransaction({
          savingsGoalId: tx.savingsGoalId,
          amount: tx.amount,
          type: tx.transactionType,
          date: tx.date,
          note: tx.note
        });
        createdRecord = created;
        recordId = created.id;
        break;
      }
    }

    const result: ExecuteConfirmedTransactionResult = {
      ok: true,
      deduplicated: false,
      intent: tx.intent,
      recordId,
      confirmationMessage: buildSuccessConfirmationMessage(tx, proposal.detectedLanguage, currency),
      createdRecord
    };

    recordCompletedExecution(scopeKey, result);
    return result;
  })().finally(() => {
    inFlightExecutions.delete(scopeKey);
  });

  inFlightExecutions.set(scopeKey, runPromise);
  return runPromise;
}
