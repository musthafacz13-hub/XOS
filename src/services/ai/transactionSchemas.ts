/**
 * XOS Jarvis — Strict Voice-to-Data Schemas, Bilingual Number/Date Parsers & Validation
 * Shared cleanly between frontend UI/executor and backend /api/ai/assistant (NodeNext ESM compatible).
 */
import { z } from 'zod';

export const ALLOWED_PAYMENT_METHODS = [
  'Cash',
  'Credit Card',
  'Debit Card',
  'Bank Transfer',
  'Digital Wallet'
] as const;

export type ValidPaymentMethod = (typeof ALLOWED_PAYMENT_METHODS)[number];

export type TransactionIntentType =
  | 'create_expense'
  | 'create_income'
  | 'create_debt_receivable'
  | 'create_debt_payable'
  | 'record_debt_repayment'
  | 'create_savings_transaction';

export type AssistantActionType =
  | 'read_only_query'
  | 'transaction_proposal'
  | 'clarification_needed'
  | 'unsupported_mutation';

export const PENDING_TRANSACTION_TTL_MS = 120_000;
export const MIN_PROPOSAL_CONFIDENCE = 0.7;
export const MAX_TRANSACTION_AMOUNT = 100_000_000;

export function isValidStrictCalendarDate(dateStr: string): boolean {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    return false;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    return false;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function subtractIstDays(istDateStr: string, days: number): string {
  if (!isValidStrictCalendarDate(istDateStr)) {
    return istDateStr;
  }
  const [y, m, d] = istDateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export const CalendarDateSchema = z
  .string()
  .trim()
  .refine(isValidStrictCalendarDate, {
    message: 'Date must be a valid YYYY-MM-DD calendar date.'
  });

export const PositiveAmountSchema = z
  .number()
  .finite()
  .positive('Amount must be greater than zero.')
  .max(MAX_TRANSACTION_AMOUNT, 'Amount exceeds the maximum supported limit.');

export const PaymentMethodSchema = z.enum(ALLOWED_PAYMENT_METHODS);

export const CreateExpenseProposalSchema = z.object({
  intent: z.literal('create_expense'),
  amount: PositiveAmountSchema,
  category: z.string().trim().min(1, 'Expense category is required.').max(80),
  title: z.string().trim().min(1, 'Expense description is required.').max(160),
  date: CalendarDateSchema,
  paymentMethod: PaymentMethodSchema.default('Cash'),
  notes: z.string().trim().max(400).optional()
});

export const CreateIncomeProposalSchema = z.object({
  intent: z.literal('create_income'),
  amount: PositiveAmountSchema,
  source: z.string().trim().min(1, 'Income source is required.').max(80),
  title: z.string().trim().min(1, 'Income description is required.').max(160),
  date: CalendarDateSchema,
  notes: z.string().trim().max(400).optional()
});

export const CreateDebtReceivableProposalSchema = z.object({
  intent: z.literal('create_debt_receivable'),
  direction: z.literal('receive'),
  personName: z.string().trim().min(1, 'Person name is required.').max(120),
  amount: PositiveAmountSchema,
  date: CalendarDateSchema,
  dueDate: CalendarDateSchema.optional(),
  description: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(400).optional()
});

export const CreateDebtPayableProposalSchema = z.object({
  intent: z.literal('create_debt_payable'),
  direction: z.literal('pay'),
  personName: z.string().trim().min(1, 'Person or creditor name is required.').max(120),
  amount: PositiveAmountSchema,
  date: CalendarDateSchema,
  dueDate: CalendarDateSchema.optional(),
  description: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(400).optional()
});

export const RecordDebtRepaymentProposalSchema = z.object({
  intent: z.literal('record_debt_repayment'),
  debtId: z.string().trim().min(1, 'Target debt ID is required.').max(120),
  personName: z.string().trim().min(1, 'Person name is required.').max(120),
  direction: z.enum(['receive', 'pay']),
  amount: PositiveAmountSchema,
  remainingBefore: z.number().finite().nonnegative(),
  remainingAfter: z.number().finite().nonnegative(),
  date: CalendarDateSchema,
  paymentMethod: PaymentMethodSchema.default('Bank Transfer'),
  notes: z.string().trim().max(400).optional()
});

export const CreateSavingsTransactionProposalSchema = z.object({
  intent: z.literal('create_savings_transaction'),
  savingsGoalId: z.string().trim().min(1, 'Target savings goal ID is required.').max(120),
  savingsGoalName: z.string().trim().min(1, 'Savings goal name is required.').max(120),
  transactionType: z.enum(['deposit', 'withdrawal']).default('deposit'),
  amount: PositiveAmountSchema,
  currentBalanceBefore: z.number().finite().nonnegative(),
  balanceAfter: z.number().finite().nonnegative(),
  date: CalendarDateSchema,
  note: z.string().trim().max(400).optional()
});

export const ValidatedTransactionProposalSchema = z.discriminatedUnion('intent', [
  CreateExpenseProposalSchema,
  CreateIncomeProposalSchema,
  CreateDebtReceivableProposalSchema,
  CreateDebtPayableProposalSchema,
  RecordDebtRepaymentProposalSchema,
  CreateSavingsTransactionProposalSchema
]);

export type CreateExpenseProposal = z.infer<typeof CreateExpenseProposalSchema>;
export type CreateIncomeProposal = z.infer<typeof CreateIncomeProposalSchema>;
export type CreateDebtReceivableProposal = z.infer<typeof CreateDebtReceivableProposalSchema>;
export type CreateDebtPayableProposal = z.infer<typeof CreateDebtPayableProposalSchema>;
export type RecordDebtRepaymentProposal = z.infer<typeof RecordDebtRepaymentProposalSchema>;
export type CreateSavingsTransactionProposal = z.infer<typeof CreateSavingsTransactionProposalSchema>;
export type ValidatedTransactionProposal = z.infer<typeof ValidatedTransactionProposalSchema>;

export interface EntryDebtSummary {
  id: string;
  personName: string;
  direction: 'receive' | 'pay';
  originalAmount: number;
  remainingAmount: number;
  date: string;
  description?: string;
}

export interface EntrySavingsGoalSummary {
  id: string;
  name: string;
  currentAmount: number;
  targetAmount: number;
}

export interface EntryCatalog {
  currency: string;
  todayIst: string;
  expenseCategories: string[];
  incomeSources: string[];
  activeDebts: EntryDebtSummary[];
  activeSavingsGoals: EntrySavingsGoalSummary[];
}

export const EntryCatalogSchema = z.object({
  currency: z.string().trim().min(1).max(10).default('INR'),
  todayIst: CalendarDateSchema,
  expenseCategories: z.array(z.string().trim().min(1).max(80)).max(50),
  incomeSources: z.array(z.string().trim().min(1).max(80)).max(50),
  activeDebts: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(120),
        personName: z.string().trim().min(1).max(120),
        direction: z.enum(['receive', 'pay']),
        originalAmount: z.number().finite().nonnegative(),
        remainingAmount: z.number().finite().nonnegative(),
        date: z.string().trim().max(20),
        description: z.string().trim().max(200).optional()
      })
    )
    .max(50),
  activeSavingsGoals: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(120),
        name: z.string().trim().min(1).max(120),
        currentAmount: z.number().finite().nonnegative(),
        targetAmount: z.number().finite().nonnegative()
      })
    )
    .max(50)
});

export interface PendingTransactionProposal {
  proposalId: string;
  idempotencyKey: string;
  createdAtMs: number;
  expiresAtMs: number;
  confidence: number;
  summaryReply: string;
  detectedLanguage: 'ml' | 'en' | 'mixed';
  transaction: ValidatedTransactionProposal;
}

export type DisambiguationOption =
  | {
      kind: 'debt';
      id: string;
      label: string;
      personName: string;
      direction: 'receive' | 'pay';
      remainingAmount: number;
      date: string;
      proposedAmount: number;
      proposedDate: string;
      paymentMethod: ValidPaymentMethod;
      notes?: string;
    }
  | {
      kind: 'savings_goal';
      id: string;
      label: string;
      name: string;
      currentAmount: number;
      targetAmount: number;
      proposedAmount: number;
      transactionType: 'deposit' | 'withdrawal';
      proposedDate: string;
      note?: string;
    };

export interface ClarificationResult {
  reason:
    | 'ambiguous_amount'
    | 'invalid_amount'
    | 'invalid_date'
    | 'unclear_category'
    | 'unclear_source'
    | 'unclear_person'
    | 'multiple_debts'
    | 'debt_not_found'
    | 'repayment_exceeds_balance'
    | 'unclear_savings_goal'
    | 'withdrawal_exceeds_balance'
    | 'low_confidence'
    | 'missing_details';
  message: string;
  disambiguationOptions?: DisambiguationOption[];
}

export interface RawLlmTransactionCandidate {
  intent: TransactionIntentType;
  amount?: unknown;
  category?: unknown;
  source?: unknown;
  title?: unknown;
  description?: unknown;
  date?: unknown;
  dueDate?: unknown;
  paymentMethod?: unknown;
  notes?: unknown;
  note?: unknown;
  personName?: unknown;
  direction?: unknown;
  debtId?: unknown;
  savingsGoalId?: unknown;
  savingsGoalName?: unknown;
  transactionType?: unknown;
  confidence?: unknown;
  reply?: unknown;
}

export type ParsedLlmEnvelope =
  | {
      action: 'read_only_query';
      reply: string;
    }
  | {
      action: 'unsupported_mutation';
      reply: string;
    }
  | {
      action: 'clarification_needed';
      reply: string;
      reason?: ClarificationResult['reason'];
      candidate?: RawLlmTransactionCandidate;
    }
  | {
      action: 'transaction_proposal';
      reply: string;
      confidence: number;
      candidate: RawLlmTransactionCandidate;
    };

export function createProposalId(): string {
  return `prop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createIdempotencyKey(proposalId: string, tx: ValidatedTransactionProposal): string {
  const canonical = JSON.stringify(tx);
  let hash = 5381;
  for (let i = 0; i < canonical.length; i++) {
    hash = ((hash << 5) + hash) ^ canonical.charCodeAt(i);
  }
  const hex = (hash >>> 0).toString(36);
  return `idem_${proposalId}_${hex}`;
}

export function formatRupeesSimple(amount: number, currency: string = 'INR'): string {
  const symbol = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : `${currency} `;
  const hasDecimals = Math.abs(amount % 1) > 0.001;
  const formatted = new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2
  }).format(amount);
  return `${symbol}${formatted}`;
}

// ============================================================
// Voice Confirmation / Cancellation / Read-Only Classification
// ============================================================

const CONFIRM_PHRASES = new Set([
  'yes',
  'yeah',
  'yep',
  'confirm',
  'confirmed',
  'save',
  'save it',
  'yes confirm',
  'yes save',
  'yes save it',
  'yes please',
  'ok save',
  'ok confirm',
  'go ahead',
  'do it',
  'proceed',
  'athe',
  'sheri',
  'sheriyanu',
  'save cheyyu',
  'cherkku',
  'confirm cheyyu',
  'athe save cheyyu',
  'athe confirm',
  'yes cheyyu',
  'അതെ',
  'ശരി',
  'ശരിയാണ്',
  'സേവ് ചെയ്യൂ',
  'ചേർക്കൂ',
  'ചേർക്ക്',
  'കൺഫേം',
  'അതെ save ചെയ്യൂ',
  'അതെ സേവ് ചെയ്യൂ',
  'അതെ ചേർക്കൂ'
]);

const CANCEL_PHRASES = new Set([
  'no',
  'nope',
  'cancel',
  'discard',
  'stop',
  'never mind',
  'nevermind',
  'dont save',
  'do not save',
  'cancel it',
  'venda',
  'vendaa',
  'cancel cheyyu',
  'വേണ്ട',
  'ക്യാൻസൽ',
  'റദ്ദാക്കൂ',
  'മാറ്റിവെക്കൂ'
]);

function normalizeVoiceCommandPhrase(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/['’.,!?;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchPendingConfirmationVoiceCommand(transcript: string): 'confirm' | 'cancel' | null {
  const norm = normalizeVoiceCommandPhrase(transcript);
  if (!norm) return null;
  if (CONFIRM_PHRASES.has(norm)) return 'confirm';
  if (CANCEL_PHRASES.has(norm)) return 'cancel';

  // Exact two-part polite Malayalam/English confirmation variants like "അതെ, ഇത് save ചെയ്യൂ"
  if (
    /^(അതെ|athe|yes|ok|ശരി)\s+(please\s+)?(save|confirm|സേവ് ചെയ്യൂ|ചേർക്കൂ|save ചെയ്യൂ|save cheyyu|confirm cheyyu)(\s+it)?$/.test(
      norm
    )
  ) {
    return 'confirm';
  }
  if (/^(വേണ്ട|venda|no|cancel)\s+(സേവ്|save|it|വേണ്ട)?$/.test(norm)) {
    return 'cancel';
  }
  return null;
}

const READ_ONLY_QUESTION_PREFIXES = [
  /^how\s+(much|many|are|is|did|do|does|long|often)\b/i,
  /^what\s+(is|are|was|were|did)\b/i,
  /^when\s+(is|did|was)\b/i,
  /^where\s+(is|did)\b/i,
  /^who\s+(owes|is)\b/i,
  /^show\s+(me\s+)?(my|the|all)\b/i,
  /^tell\s+me\b/i,
  /^compare\b/i,
  /^summarize\b/i,
  /^explain\b/i,
  /^list\s+(my|the)\b/i
];

export function isExplicitReadOnlyQuestion(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();

  // If the user explicitly asks to add/record/log something, do not prematurely treat as read-only
  const hasExplicitEntryVerb =
    /\b(add|create|log|record|save|deposit|withdraw|repay|paid back|lent|borrowed|spent|received|earned)\b/i.test(
      lower
    ) ||
    /(ചേർക്കൂ|ചേർക്ക്|ചേർക്കണം|ചെലവായി|ചിലവായി|കടം കൊടുത്തു|കടം വാങ്ങി|തിരിച്ചു കൊടുത്തു|തിരിച്ചു തന്നു|സേവ് ചെയ്യ|ഇട്ടു|കിട്ടി|ലഭിച്ചു)/.test(
      trimmed
    ) ||
    /\b(koduthu|vaangi|chelavayi|chilavayi|thirichu|kitti|itt[uo]|cherkk)/i.test(lower);

  if (READ_ONLY_QUESTION_PREFIXES.some(re => re.test(lower)) && !hasExplicitEntryVerb) {
    return true;
  }

  // Malayalam/Manglish pure question markers ("എത്ര...", "എങ്ങനെയുണ്ട്...", "ethra...", "undo?", "aano?")
  if (
    (/(എത്ര|എന്തൊക്കെയാണ്|എങ്ങനെയുണ്ട്|ആർക്കൊക്കെ|ethra|enganeyundu|enthanu|aarkkokke|undo\b)/i.test(lower) ||
      trimmed.endsWith('?')) &&
    !hasExplicitEntryVerb
  ) {
    return true;
  }

  return false;
}

export function isUnsupportedDeleteOrEditRequest(message: string): boolean {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();
  const hasDeleteOrReset =
    /\b(delete|remove|erase|clear all|reset|wipe)\b/i.test(lower) ||
    /(ഡിലീറ്റ്|നീക്കം ചെയ്യ|കളയൂ|റീസെറ്റ്)/.test(trimmed);
  const hasDbEdit =
    /\b(edit|update|modify|change)\s+(my|the|last|existing|previous)\b/i.test(lower) ||
    /(മാറ്റൂ|എഡിറ്റ് ചെയ്യൂ|അപ്ഡേറ്റ് ചെയ്യൂ)/.test(trimmed);

  return hasDeleteOrReset || hasDbEdit;
}

export function hasPotentialTransactionIntent(message: string): boolean {
  if (isExplicitReadOnlyQuestion(message)) return false;
  if (isUnsupportedDeleteOrEditRequest(message)) return true;

  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  const hasVerbOrTrigger =
    /\b(add|create|log|record|save|spent|spend|paid|pay|bought|earned|received|got|income|salary|freelance|lent|owe|owes|borrowed|borrow|debt|loan|repaid|repay|return|returned|deposit|withdraw|savings|expense)\b/i.test(
      lower
    ) ||
    /(ചെലവ്|ചെലവായി|ചിലവ്|ചിലവായി|രൂപ|വരവ്|വരുമാനം|ശമ്പളം|കിട്ടി|കടം|തരാൻ|കൊടുത്തു|വാങ്ങി|തിരിച്ചു|സേവിംഗ്സ്|സേവിങ്സ്|സമ്പാദ്യം|നിക്ഷേപ|ചേർക്ക|ആഡ്)/.test(
      trimmed
    ) ||
    /\b(rupa|paisa|chelav|chilav|kadam|koduthu|vaangi|thirichu|kitti|shambalam|sambalam|varavu|savings|nooru|aayiram|anjooru)\b/i.test(
      lower
    );

  return hasVerbOrTrigger;
}

// ============================================================
// Malayalam, Manglish & English Number & Date Parsing
// ============================================================

const AMBIGUOUS_AMOUNT_PATTERNS = [
  /(കുറച്ചു|കുറച്ച്|കുറെ|അല്പം)\s*(പണം|രൂപ|പൈസ)?/i,
  /\b(kurachu|kurach|kure|alppam)\s*(paisa|rupa|money)?\b/i,
  /\b(some|a few|a little|a bit of|little bit)\s*(money|rupees|cash|bucks|paisa)?\b/i
];

const MALAYALAM_NUMBER_PHRASES: Array<[RegExp, number]> = [
  [/ഒരു\s*ലക്ഷം/g, 100000],
  [/രണ്ട്\s*ലക്ഷം|രണ്ടു\s*ലക്ഷം/g, 200000],
  [/അര\s*ലക്ഷം/g, 50000],
  [/ലക്ഷം/g, 100000],
  [/ഒന്നര\s*ആയിരം|ഒന്നരക്കായിരം|ഒന്നരായിരം/g, 1500],
  [/രണ്ടര\s*ആയിരം|രണ്ടരക്കായിരം/g, 2500],
  [/പതിനായിരം/g, 10000],
  [/ഇരുപതിനായിരം/g, 20000],
  [/മുപ്പതിനായിരം/g, 30000],
  [/അമ്പതിനായിരം|അൻപതിനായിരം/g, 50000],
  [/ഒമ്പതിനായിരം|ഒൻപതിനായിരം/g, 9000],
  [/എട്ടായിരം/g, 8000],
  [/ഏഴായിരം/g, 7000],
  [/ആറായിരം/g, 6000],
  [/അയ്യായിരം|അഞ്ച്\s*ആയിരം|അഞ്ചു\s*ആയിരം/g, 5000],
  [/നാലായിരം|നാല്\s*ആയിരം|നാലു\s*ആയിരം/g, 4000],
  [/മൂന്നായിരം|മൂന്ന്\s*ആയിരം|മൂന്നു\s*ആയിരം/g, 3000],
  [/രണ്ടായിരം|രണ്ട്\s*ആയിരം|രണ്ടു\s*ആയിരം/g, 2000],
  [/ഒരായിരം|ഒരു\s*ആയിരം|ആയിരം/g, 1000],
  [/രണ്ടര\s*നൂറ്|രണ്ടരനൂറ്/g, 250],
  [/ഒന്നര\s*നൂറ്|ഒന്നരനൂറ്|നൂറ്റമ്പത്|നൂറ്റിയമ്പത്|നൂറ്റി\s*അമ്പത്/g, 150],
  [/ഇരുന്നൂറ്റമ്പത്|ഇരുന്നൂറ്റിയമ്പത്/g, 250],
  [/മുന്നൂറ്റമ്പത്|മുന്നൂറ്റിയമ്പത്/g, 350],
  [/നാനൂറ്റമ്പത്|നാനൂറ്റിയമ്പത്/g, 450],
  [/അഞ്ഞൂറ്റമ്പത്|അഞ്ഞൂറ്റിയമ്പത്/g, 550],
  [/തൊള്ളായിരം/g, 900],
  [/എണ്ണൂറ്|എണ്ണൂറു/g, 800],
  [/എഴുന്നൂറ്|എഴുന്നൂറു/g, 700],
  [/അറുന്നൂറ്|അറുന്നൂറു/g, 600],
  [/അഞ്ഞൂറ്|അഞ്ഞൂറു/g, 500],
  [/നാനൂറ്|നാനൂറു/g, 400],
  [/മുന്നൂറ്|മുന്നൂറു/g, 300],
  [/ഇരുന്നൂറ്|ഇരുന്നൂറു/g, 200],
  [/നൂറ്|നൂറു/g, 100],
  [/തൊണ്ണൂറ്/g, 90],
  [/എൺപത്/g, 80],
  [/എഴുപത്/g, 70],
  [/അറുപത്/g, 60],
  [/അമ്പത്|അൻപത്/g, 50],
  [/നാല്പത്|നാൽപ്പത്/g, 40],
  [/മുപ്പത്/g, 30],
  [/ഇരുപത്/g, 20],
  [/പതിനഞ്ച്/g, 15],
  [/പന്ത്രണ്ട്/g, 12],
  [/പത്ത്|പത്തു/g, 10],
  [/അഞ്ച്|അഞ്ചു/g, 5]
];

const MANGLISH_NUMBER_PHRASES: Array<[RegExp, number]> = [
  [/\bonnara\s+aayiram\b|\bonnarayiram\b/gi, 1500],
  [/\brandara\s+aayiram\b/gi, 2500],
  [/\b(?:randu|rand)\s+aayiram\b|\brandaayiram\b/gi, 2000],
  [/\b(?:moonu|moonnu)\s+aayiram\b|\bmoonaayiram\b/gi, 3000],
  [/\b(?:naalu|nalu)\s+aayiram\b|\bnaalaayiram\b/gi, 4000],
  [/\b(?:anju|anchu)\s+aayiram\b|\bayyayiram\b|\banjaayiram\b/gi, 5000],
  [/\bpathinaayiram\b/gi, 10000],
  [/\b(?:oru\s+)?laksham\b/gi, 100000],
  [/\b(?:oru\s+)?aayiram\b|\bayiram\b/gi, 1000],
  [/\bnoorambathu\b|\bnoorambath\b|\bonnara\s+nooru\b/gi, 150],
  [/\brandara\s+nooru\b/gi, 250],
  [/\b(?:irunnooru|irunooru)\b/gi, 200],
  [/\bmunnooru\b/gi, 300],
  [/\bnaanooru\b/gi, 400],
  [/\b(?:anjooru|anjuru|anchooru)\b/gi, 500],
  [/\bnooru\b/gi, 100],
  [/\b(?:ambathu|anpathu)\b/gi, 50],
  [/\bmuppathu\b/gi, 30],
  [/\birupathu\b/gi, 20],
  [/\bpathu\b/gi, 10]
];

export interface ParsedAmountResult {
  amount: number | null;
  ambiguous: boolean;
  explicitNonPositive: boolean;
  reason?: string;
}

export function parseMalayalamManglishAmount(rawText: string): ParsedAmountResult {
  const text = rawText.trim();
  if (!text) {
    return { amount: null, ambiguous: false, explicitNonPositive: false, reason: 'Empty input.' };
  }

  // Strip ISO/slash dates before searching for numeric money values so "2026-11-24" isn't confused with money
  const textWithoutDates = text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, ' ');

  // 1. Check explicit negative or zero numbers
  const negMatch = /(?:₹|rs\.?|inr)?\s*(-\d+(?:,\d{3})*(?:\.\d+)?)/i.exec(textWithoutDates);
  if (negMatch) {
    const val = Number(negMatch[1].replace(/,/g, ''));
    if (Number.isFinite(val) && val <= 0) {
      return {
        amount: val,
        ambiguous: false,
        explicitNonPositive: true,
        reason: 'Amount must be greater than zero.'
      };
    }
  }

  // 2. Numeric currency/amount values (e.g. "₹150", "100 രൂപ", "1,500rs", "150")
  const numericMatches = Array.from(
    textWithoutDates.matchAll(/(?:₹|rs\.?|inr)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:₹|rs\.?|rupees?|rupa|രൂപ|ക)?/gi)
  )
    .map(m => ({
      raw: m[0],
      val: Number(m[1].replace(/,/g, ''))
    }))
    .filter(item => Number.isFinite(item.val));

  if (numericMatches.length === 1) {
    const val = numericMatches[0].val;
    if (val <= 0) {
      return {
        amount: val,
        ambiguous: false,
        explicitNonPositive: true,
        reason: 'Amount must be greater than zero.'
      };
    }
    return { amount: val, ambiguous: false, explicitNonPositive: false };
  }

  if (numericMatches.length > 1) {
    // Check if there's an explicit currency-tagged match first
    const currencyTagged = numericMatches.filter(m =>
      /₹|rs|rupee|rupa|രൂപ/i.test(m.raw)
    );
    if (currencyTagged.length === 1 && currencyTagged[0].val > 0) {
      return { amount: currencyTagged[0].val, ambiguous: false, explicitNonPositive: false };
    }
    return {
      amount: null,
      ambiguous: true,
      explicitNonPositive: false,
      reason: 'Multiple numeric amounts detected. Please clarify the exact amount.'
    };
  }

  if (/\bzero\s+(?:rupees?|rs|inr)\b|പൂജ്യം\s*രൂപ/i.test(textWithoutDates)) {
    return {
      amount: 0,
      ambiguous: false,
      explicitNonPositive: true,
      reason: 'Amount must be greater than zero.'
    };
  }

  // 3. Malayalam number words (longest phrases checked first)
  for (const [pattern, value] of MALAYALAM_NUMBER_PHRASES) {
    pattern.lastIndex = 0;
    if (pattern.test(textWithoutDates)) {
      return { amount: value, ambiguous: false, explicitNonPositive: false };
    }
  }

  // 4. Manglish number words
  for (const [pattern, value] of MANGLISH_NUMBER_PHRASES) {
    pattern.lastIndex = 0;
    if (pattern.test(textWithoutDates)) {
      return { amount: value, ambiguous: false, explicitNonPositive: false };
    }
  }

  // 5. English number words ("five hundred", "one thousand", etc.)
  const englishWords: Array<[RegExp, number]> = [
    [/\bfive\s+hundred\b/i, 500],
    [/\btwo\s+hundred\b/i, 200],
    [/\bone\s+hundred\b|\ba\s+hundred\b/i, 100],
    [/\bone\s+thousand\b|\ba\s+thousand\b/i, 1000],
    [/\btwo\s+thousand\b/i, 2000],
    [/\bfive\s+thousand\b/i, 5000],
    [/\bfifty\b/i, 50]
  ];
  for (const [pattern, value] of englishWords) {
    if (pattern.test(textWithoutDates)) {
      return { amount: value, ambiguous: false, explicitNonPositive: false };
    }
  }

  // 6. Ambiguous vague quantity words ("some money", "കുറച്ചു പണം")
  if (AMBIGUOUS_AMOUNT_PATTERNS.some(re => re.test(textWithoutDates))) {
    return {
      amount: null,
      ambiguous: true,
      explicitNonPositive: false,
      reason: 'Amount is unclear. Please specify an exact amount.'
    };
  }

  return {
    amount: null,
    ambiguous: true,
    explicitNonPositive: false,
    reason: 'No clear amount specified.'
  };
}

const MONTH_NAME_TO_NUM: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12
};

export function detectExplicitInvalidDateInText(text: string): string | null {
  const isoMatch = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);
  if (isoMatch && !isValidStrictCalendarDate(isoMatch[1])) {
    return isoMatch[1];
  }

  const dmyMatch = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/.exec(text);
  if (dmyMatch) {
    const dd = dmyMatch[1].padStart(2, '0');
    const mm = dmyMatch[2].padStart(2, '0');
    const yyyy = dmyMatch[3];
    const candidate = `${yyyy}-${mm}-${dd}`;
    if (!isValidStrictCalendarDate(candidate)) {
      return dmyMatch[0];
    }
  }

  const monthDayMatch =
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/i.exec(
      text
    );
  if (monthDayMatch) {
    const m = MONTH_NAME_TO_NUM[monthDayMatch[1].toLowerCase()];
    const d = Number(monthDayMatch[2]);
    const y = monthDayMatch[3] ? Number(monthDayMatch[3]) : 2026;
    const candidate = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!isValidStrictCalendarDate(candidate)) {
      return monthDayMatch[0];
    }
  }

  return null;
}

export function resolveNaturalDateInText(
  text: string,
  todayIst: string
): { date: string; invalidDateText: string | null } {
  const invalid = detectExplicitInvalidDateInText(text);
  if (invalid) {
    return { date: todayIst, invalidDateText: invalid };
  }

  const isoMatch = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);
  if (isoMatch && isValidStrictCalendarDate(isoMatch[1])) {
    return { date: isoMatch[1], invalidDateText: null };
  }

  const dmyMatch = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/.exec(text);
  if (dmyMatch) {
    const candidate = `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
    if (isValidStrictCalendarDate(candidate)) {
      return { date: candidate, invalidDateText: null };
    }
  }

  const lower = text.toLowerCase();
  if (/മിനിഞ്ഞാന്ന്|\bday before yesterday\b/.test(lower)) {
    return { date: subtractIstDays(todayIst, 2), invalidDateText: null };
  }
  if (/ഇന്നലെ|\binnale\b|\byesterday\b/.test(lower)) {
    return { date: subtractIstDays(todayIst, 1), invalidDateText: null };
  }

  return { date: todayIst, invalidDateText: null };
}

// ============================================================
// Category, Source, Debt & Savings Goal Matching
// ============================================================

const EXPENSE_CATEGORY_SYNONYMS: Array<{ patterns: RegExp[]; canonicalTargets: string[] }> = [
  {
    patterns: [
      /\b(food|dining|lunch|dinner|breakfast|snacks?|tea|coffee|biryani|meals?|restaurant|cafe|hotel|grocer(?:y|ies)|bakery|swiggy|zomato)\b/i,
      /(ഭക്ഷണം|ഭക്ഷണ|ചായ|കാപ്പി|ഊണ്|ഉച്ചഭക്ഷണം|അത്താഴം|പലചരക്ക്|ഹോട്ടൽ)/
    ],
    canonicalTargets: ['Food & Dining', 'Food']
  },
  {
    patterns: [
      /\b(transport|petrol|diesel|fuel|bus|train|auto|rickshaw|taxi|cab|uber|ola|metro|flight|ticket|toll|parking|travel)\b/i,
      /(പെട്രോൾ|ഡീസൽ|യാത്ര|ബസ്|ട്രെയിൻ|ഓട്ടോ|ടാക്സി)/
    ],
    canonicalTargets: ['Transport', 'Transportation', 'Travel']
  },
  {
    patterns: [
      /\b(utilities|electricity|current|power|water|gas|internet|wifi|broadband|recharge|mobile\s*bill|phone\s*bill)\b/i,
      /(കറന്റ്|വൈദ്യുതി|വെള്ളം|റീചാർജ്|ഇന്റർനെറ്റ്|ബിൽ)/
    ],
    canonicalTargets: ['Utilities']
  },
  {
    patterns: [
      /\b(shopping|clothes|dress|shirt|shoes|amazon|flipkart|mall|purchase)\b/i,
      /(ഷോപ്പിംഗ്|വസ്ത്രം|സാധനം|സാധനങ്ങൾ)/
    ],
    canonicalTargets: ['Shopping']
  },
  {
    patterns: [
      /\b(health|fitness|gym|medicine|medical|doctor|hospital|pharmacy|clinic|tablets?)\b/i,
      /(മരുന്ന്|ആശുപത്രി|ഡോക്ടർ|ജിം)/
    ],
    canonicalTargets: ['Health & Fitness', 'Health', 'Medical']
  },
  {
    patterns: [
      /\b(housing|rent|house\s*rent|room\s*rent|maintenance)\b/i,
      /(വാടക|വീട്ടുവാടക)/
    ],
    canonicalTargets: ['Housing', 'Rent']
  },
  {
    patterns: [
      /\b(entertainment|movie|cinema|theatre|game|gaming|outing)\b/i,
      /(സിനിമ|വിനോദം)/
    ],
    canonicalTargets: ['Entertainment']
  },
  {
    patterns: [
      /\b(education|books?|course|tuition|fees?|exam|college|school)\b/i,
      /(പഠനം|പുസ്തകം|ഫീസ്)/
    ],
    canonicalTargets: ['Education']
  },
  {
    patterns: [
      /\b(subscriptions?|netflix|spotify|prime|youtube|membership)\b/i,
      /(സബ്സ്ക്രിപ്ഷൻ)/
    ],
    canonicalTargets: ['Subscriptions']
  },
  {
    patterns: [/\b(debt\s*&\s*bills|credit\s*card\s*bill)\b/i],
    canonicalTargets: ['Debt & Bills']
  },
  {
    patterns: [/\b(other|miscellaneous|misc)\b/i, /(മറ്റുള്ളവ)/],
    canonicalTargets: ['Other']
  }
];

export function normalizeExpenseCategory(
  rawCategory: string | undefined,
  userCategories: string[],
  fallbackText: string = ''
): { category: string | null; ambiguous: boolean } {
  const allowed = userCategories.length > 0 ? userCategories : ['Food & Dining', 'Transport', 'Utilities', 'Other'];
  const allowedMap = new Map(allowed.map(c => [c.toLowerCase(), c]));

  const candidateRaw = (rawCategory || '').trim();
  if (candidateRaw) {
    const exact = allowedMap.get(candidateRaw.toLowerCase());
    if (exact) {
      return { category: exact, ambiguous: false };
    }
  }

  // Try synonym rules against candidateRaw first, then against full user text
  for (const probe of [candidateRaw, fallbackText].filter(Boolean)) {
    for (const rule of EXPENSE_CATEGORY_SYNONYMS) {
      if (rule.patterns.some(p => p.test(probe))) {
        for (const target of rule.canonicalTargets) {
          const matched = allowedMap.get(target.toLowerCase());
          if (matched) {
            return { category: matched, ambiguous: false };
          }
        }
      }
    }

    // Check partial match against user's custom expense categories
    const lowerProbe = probe.toLowerCase();
    for (const cat of allowed) {
      const catLower = cat.toLowerCase();
      if (lowerProbe.includes(catLower) || (candidateRaw && catLower.includes(candidateRaw.toLowerCase()))) {
        return { category: cat, ambiguous: false };
      }
    }
  }

  return { category: null, ambiguous: true };
}

const INCOME_SOURCE_SYNONYMS: Array<{ patterns: RegExp[]; canonicalTargets: string[] }> = [
  {
    patterns: [/\b(salary|paycheck|wage|payroll|shambalam|sambalam)\b/i, /(ശമ്പളം|സാലറി|വേതനം)/],
    canonicalTargets: ['Salary']
  },
  {
    patterns: [/\b(freelance|client|consulting|project|gig)\b/i, /(ഫ്രീലാൻസ്|പ്രോജക്റ്റ്)/],
    canonicalTargets: ['Freelance']
  },
  {
    patterns: [/\b(business|sales|shop|profit|revenue)\b/i, /(ബിസിനസ്|കച്ചവടം|ലാഭം)/],
    canonicalTargets: ['Business']
  },
  {
    patterns: [/\b(gifts?|bonus|prize)\b/i, /(സമ്മാനം|ഗിഫ്റ്റ്)/],
    canonicalTargets: ['Gifts']
  },
  {
    patterns: [/\b(investments?|dividend|interest|stocks?|mutual\s*fund|returns?)\b/i, /(നിക്ഷേപം|പലിശ|ഡിവിഡന്റ്)/],
    canonicalTargets: ['Investments']
  },
  {
    patterns: [/\b(other)\b/i, /(മറ്റുള്ളവ)/],
    canonicalTargets: ['Other']
  }
];

export function normalizeIncomeSource(
  rawSource: string | undefined,
  userSources: string[],
  fallbackText: string = ''
): { source: string | null; ambiguous: boolean } {
  const allowed = userSources.length > 0 ? userSources : ['Salary', 'Freelance', 'Business', 'Gifts', 'Investments', 'Other'];
  const allowedMap = new Map(allowed.map(s => [s.toLowerCase(), s]));

  const candidateRaw = (rawSource || '').trim();
  if (candidateRaw) {
    const exact = allowedMap.get(candidateRaw.toLowerCase());
    if (exact) {
      return { source: exact, ambiguous: false };
    }
  }

  for (const probe of [candidateRaw, fallbackText].filter(Boolean)) {
    for (const rule of INCOME_SOURCE_SYNONYMS) {
      if (rule.patterns.some(p => p.test(probe))) {
        for (const target of rule.canonicalTargets) {
          const matched = allowedMap.get(target.toLowerCase());
          if (matched) {
            return { source: matched, ambiguous: false };
          }
        }
      }
    }

    const lowerProbe = probe.toLowerCase();
    for (const src of allowed) {
      const srcLower = src.toLowerCase();
      if (lowerProbe.includes(srcLower) || (candidateRaw && srcLower.includes(candidateRaw.toLowerCase()))) {
        return { source: src, ambiguous: false };
      }
    }
  }

  return { source: null, ambiguous: true };
}

export function normalizePaymentMethod(rawMethod: unknown, fallbackText: string = '', defaultMethod: ValidPaymentMethod = 'Cash'): ValidPaymentMethod {
  if (typeof rawMethod === 'string') {
    const exact = ALLOWED_PAYMENT_METHODS.find(m => m.toLowerCase() === rawMethod.trim().toLowerCase());
    if (exact) return exact;
  }
  const combined = `${typeof rawMethod === 'string' ? rawMethod : ''} ${fallbackText}`.toLowerCase();
  if (/\b(upi|gpay|google pay|phonepe|paytm|wallet|qr)\b/.test(combined)) return 'Digital Wallet';
  if (/\b(bank|neft|imps|rtgs|transfer|account)\b/.test(combined)) return 'Bank Transfer';
  if (/\b(credit\s*card|credit)\b/.test(combined)) return 'Credit Card';
  if (/\b(debit\s*card|debit|atm|card)\b/.test(combined)) return 'Debit Card';
  if (/\b(cash|പണം|ക്യാഷ്)\b/.test(combined)) return 'Cash';
  return defaultMethod;
}

export function matchActiveDebtForRepayment(params: {
  debtIdHint?: string;
  personHint?: string;
  directionHint?: 'receive' | 'pay';
  activeDebts: EntryDebtSummary[];
}):
  | { status: 'matched'; debt: EntryDebtSummary }
  | { status: 'ambiguous'; candidates: EntryDebtSummary[] }
  | { status: 'not_found' } {
  const unpaid = params.activeDebts.filter(d => d.remainingAmount > 0.001);
  if (unpaid.length === 0) {
    return { status: 'not_found' };
  }

  if (params.debtIdHint) {
    const byId = unpaid.find(d => d.id === params.debtIdHint);
    if (byId) return { status: 'matched', debt: byId };
  }

  const personQuery = (params.personHint || '').trim().toLowerCase();
  let matching = unpaid;

  if (personQuery) {
    const exact = unpaid.filter(d => d.personName.trim().toLowerCase() === personQuery);
    const partial =
      exact.length > 0
        ? exact
        : unpaid.filter(
            d =>
              d.personName.trim().toLowerCase().includes(personQuery) ||
              personQuery.includes(d.personName.trim().toLowerCase())
          );
    matching = partial;
  }

  if (matching.length === 0) {
    return { status: 'not_found' };
  }

  if (matching.length > 1 && params.directionHint) {
    const dirFiltered = matching.filter(d => d.direction === params.directionHint);
    if (dirFiltered.length > 0) {
      matching = dirFiltered;
    }
  }

  if (matching.length === 1) {
    return { status: 'matched', debt: matching[0] };
  }

  return { status: 'ambiguous', candidates: matching };
}

export function matchSavingsGoal(params: {
  savingsGoalIdHint?: string;
  savingsGoalNameHint?: string;
  rawText?: string;
  activeSavingsGoals: EntrySavingsGoalSummary[];
}):
  | { status: 'matched'; goal: EntrySavingsGoalSummary }
  | { status: 'ambiguous'; candidates: EntrySavingsGoalSummary[] }
  | { status: 'not_found' } {
  const goals = params.activeSavingsGoals;
  if (goals.length === 0) {
    return { status: 'not_found' };
  }

  if (params.savingsGoalIdHint) {
    const byId = goals.find(g => g.id === params.savingsGoalIdHint);
    if (byId) return { status: 'matched', goal: byId };
  }

  const nameHint = (params.savingsGoalNameHint || '').trim().toLowerCase();
  const rawLower = (params.rawText || '').toLowerCase();

  // Check exact match by nameHint
  if (nameHint) {
    const exact = goals.filter(g => g.name.trim().toLowerCase() === nameHint);
    if (exact.length === 1) return { status: 'matched', goal: exact[0] };

    const partial = goals.filter(
      g =>
        g.name.trim().toLowerCase().includes(nameHint) ||
        nameHint.includes(g.name.trim().toLowerCase())
    );
    if (partial.length === 1) return { status: 'matched', goal: partial[0] };
    if (partial.length > 1) return { status: 'ambiguous', candidates: partial };
  }

  // Check if the user utterance itself mentions one goal name directly
  const textMatches = goals.filter(g => {
    const gLower = g.name.trim().toLowerCase();
    if (!gLower) return false;
    if (rawLower.includes(gLower)) return true;
    const primaryWord = gLower.split(/\s+/)[0];
    return primaryWord.length >= 3 && rawLower.includes(primaryWord);
  });

  if (textMatches.length === 1) {
    return { status: 'matched', goal: textMatches[0] };
  }
  if (textMatches.length > 1) {
    return { status: 'ambiguous', candidates: textMatches };
  }

  // If only 1 active savings goal exists, it's unambiguous; if multiple exist and none named, ask user!
  if (goals.length === 1) {
    return { status: 'matched', goal: goals[0] };
  }

  return { status: 'ambiguous', candidates: goals };
}

// ============================================================
// Localized Prompt / Clarification Builders
// ============================================================

export function buildConfirmationQuestion(
  tx: ValidatedTransactionProposal,
  lang: 'ml' | 'en' | 'mixed',
  currency: string = 'INR'
): string {
  const isMl = lang === 'ml' || lang === 'mixed';
  switch (tx.intent) {
    case 'create_expense': {
      const amt = formatRupeesSimple(tx.amount, currency);
      return isMl
        ? `നിങ്ങൾ ${amt} (${tx.category} — ${tx.title}) ചെലവായി ചേർക്കാൻ ആഗ്രഹിക്കുന്നുണ്ടോ?`
        : `Do you want to save ${amt} as a ${tx.category} expense (${tx.title})?`;
    }
    case 'create_income': {
      const amt = formatRupeesSimple(tx.amount, currency);
      return isMl
        ? `നിങ്ങൾ ${amt} (${tx.source} — ${tx.title}) വരവായി ചേർക്കാൻ ആഗ്രഹിക്കുന്നുണ്ടോ?`
        : `Do you want to save ${amt} as ${tx.source} income (${tx.title})?`;
    }
    case 'create_debt_receivable': {
      const amt = formatRupeesSimple(tx.amount, currency);
      return isMl
        ? `${tx.personName}-ൽ നിന്ന് ${amt} കിട്ടാനുള്ള കടമായി (Money to Receive) ചേർക്കട്ടെ?`
        : `Record ${amt} owed to you by ${tx.personName} (Money to Receive)?`;
    }
    case 'create_debt_payable': {
      const amt = formatRupeesSimple(tx.amount, currency);
      return isMl
        ? `${tx.personName}-ന് ${amt} കൊടുക്കാനുള്ള കടമായി (Money to Pay) ചേർക്കട്ടെ?`
        : `Record ${amt} you owe to ${tx.personName} (Money to Pay)?`;
    }
    case 'record_debt_repayment': {
      const amt = formatRupeesSimple(tx.amount, currency);
      const remAfter = formatRupeesSimple(tx.remainingAfter, currency);
      if (isMl) {
        return tx.direction === 'pay'
          ? `${tx.personName}-ന് ${amt} തിരിച്ചടവ് രേഖപ്പെടുത്തട്ടെ? (ബാക്കി കടം: ${remAfter}; Debt Repayment ചെലവും ചേരും)`
          : `${tx.personName}-ൽ നിന്ന് ${amt} തിരിച്ചുകിട്ടിയതായി രേഖപ്പെടുത്തട്ടെ? (ബാക്കി കിട്ടാനുള്ളത്: ${remAfter})`;
      }
      return tx.direction === 'pay'
        ? `Record ${amt} debt repayment to ${tx.personName}? Remaining balance will be ${remAfter} and a Debt Repayment expense will be logged.`
        : `Record ${amt} repayment received from ${tx.personName}? Remaining balance will be ${remAfter}.`;
    }
    case 'create_savings_transaction': {
      const amt = formatRupeesSimple(tx.amount, currency);
      const balAfter = formatRupeesSimple(tx.balanceAfter, currency);
      if (isMl) {
        return tx.transactionType === 'withdrawal'
          ? `${tx.savingsGoalName} സേവിങ്സിൽ നിന്ന് ${amt} പിൻവലിക്കാൻ ആഗ്രഹിക്കുന്നുണ്ടോ? (പുതിയ ബാലൻസ്: ${balAfter})`
          : `${tx.savingsGoalName} സേവിങ്സിലേക്ക് ${amt} ചേർക്കാൻ ആഗ്രഹിക്കുന്നുണ്ടോ? (പുതിയ ബാലൻസ്: ${balAfter})`;
      }
      return tx.transactionType === 'withdrawal'
        ? `Withdraw ${amt} from ${tx.savingsGoalName}? New balance will be ${balAfter}.`
        : `Add ${amt} to ${tx.savingsGoalName}? New balance will be ${balAfter}.`;
    }
  }
}

function localizedMessage(
  lang: 'ml' | 'en' | 'mixed',
  mlText: string,
  enText: string
): string {
  return lang === 'en' ? enText : mlText;
}

// ============================================================
// End-to-End Proposal Validator & Normalizer
// ============================================================

export function parseStructuredLlmJson(rawText: string): ParsedLlmEnvelope | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  let jsonCandidate = trimmed;
  const fencedMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fencedMatch) {
    jsonCandidate = fencedMatch[1].trim();
  } else if (!trimmed.startsWith('{')) {
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      jsonCandidate = trimmed.slice(firstBrace, lastBrace + 1);
    } else {
      return null;
    }
  }

  try {
    const parsed = JSON.parse(jsonCandidate) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const action = typeof parsed.action === 'string' ? parsed.action.trim() : '';
    const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';

    if (action === 'read_only_query' && reply) {
      return { action: 'read_only_query', reply };
    }
    if (action === 'unsupported_mutation' && reply) {
      return { action: 'unsupported_mutation', reply };
    }
    if (action === 'clarification_needed') {
      const candidate =
        parsed.transaction && typeof parsed.transaction === 'object'
          ? (parsed.transaction as RawLlmTransactionCandidate)
          : undefined;
      return {
        action: 'clarification_needed',
        reply: reply || 'Please share a bit more detail so I can prepare that transaction accurately.',
        reason: typeof parsed.reason === 'string' ? (parsed.reason as ClarificationResult['reason']) : 'missing_details',
        candidate
      };
    }
    if (action === 'transaction_proposal' && parsed.transaction && typeof parsed.transaction === 'object') {
      const confRaw = Number(parsed.confidence);
      const confidence = Number.isFinite(confRaw) ? Math.max(0, Math.min(1, confRaw)) : 0.85;
      return {
        action: 'transaction_proposal',
        reply,
        confidence,
        candidate: parsed.transaction as RawLlmTransactionCandidate
      };
    }

    return null;
  } catch {
    return null;
  }
}

export type ProposalValidationOutcome =
  | {
      status: 'valid';
      proposal: PendingTransactionProposal;
    }
  | {
      status: 'clarification';
      clarification: ClarificationResult;
    };

export function validateAndNormalizeProposal(params: {
  candidate: RawLlmTransactionCandidate;
  confidence: number;
  catalog: EntryCatalog;
  rawUserText: string;
  detectedLanguage: 'ml' | 'en' | 'mixed';
  nowMs?: number;
}): ProposalValidationOutcome {
  const { candidate, confidence, catalog, rawUserText, detectedLanguage } = params;
  const nowMs = params.nowMs ?? Date.now();

  // 1. Confidence gate
  if (!Number.isFinite(confidence) || confidence < MIN_PROPOSAL_CONFIDENCE) {
    return {
      status: 'clarification',
      clarification: {
        reason: 'low_confidence',
        message: localizedMessage(
          detectedLanguage,
          'നിങ്ങൾ പറഞ്ഞ വിവരങ്ങൾ പൂർണ്ണമായി വ്യക്തമല്ല. തുകയും വിവരവും ഒരിക്കൽ കൂടി വ്യക്തമായി പറയാമോ?',
          'I am not fully sure about the details of that transaction. Could you repeat the exact amount and type?'
        )
      }
    };
  }

  // 2. Date validation (reject explicit invalid calendar dates in text OR candidate)
  const explicitInvalidInText = detectExplicitInvalidDateInText(rawUserText);
  if (explicitInvalidInText) {
    return {
      status: 'clarification',
      clarification: {
        reason: 'invalid_date',
        message: localizedMessage(
          detectedLanguage,
          `"${explicitInvalidInText}" സാധുവായ കലണ്ടർ തീയതിയല്ല. ശരിയായ തീയതി പറയാമോ?`,
          `"${explicitInvalidInText}" is not a valid calendar date. Please provide a valid date.`
        )
      }
    };
  }

  const candidateDateRaw = typeof candidate.date === 'string' ? candidate.date.trim() : '';
  if (candidateDateRaw && !isValidStrictCalendarDate(candidateDateRaw)) {
    return {
      status: 'clarification',
      clarification: {
        reason: 'invalid_date',
        message: localizedMessage(
          detectedLanguage,
          `"${candidateDateRaw}" സാധുവായ തീയതിയല്ല. ശരിയായ തീയതി നൽകാമോ?`,
          `"${candidateDateRaw}" is not a valid calendar date. Please provide a valid date.`
        )
      }
    };
  }

  const naturalDate = resolveNaturalDateInText(rawUserText, catalog.todayIst);
  const resolvedDate = candidateDateRaw && isValidStrictCalendarDate(candidateDateRaw)
    ? candidateDateRaw
    : naturalDate.date;

  // 3. Amount validation (must be finite positive number; reject vague phrases & <= 0)
  const deterministicAmount = parseMalayalamManglishAmount(rawUserText);
  if (deterministicAmount.explicitNonPositive) {
    return {
      status: 'clarification',
      clarification: {
        reason: 'invalid_amount',
        message: localizedMessage(
          detectedLanguage,
          'തുക പൂജ്യത്തേക്കാൾ കൂടുതൽ ആയിരിക്കണം. ശരിയായ തുക പറയാമോ?',
          'The transaction amount must be greater than zero. Please specify a valid positive amount.'
        )
      }
    };
  }

  const candidateAmountNum = Number(candidate.amount);
  const resolvedAmount =
    Number.isFinite(candidateAmountNum) && candidateAmountNum > 0
      ? Number(candidateAmountNum.toFixed(2))
      : deterministicAmount.amount;

  if (
    resolvedAmount === null ||
    !Number.isFinite(resolvedAmount) ||
    resolvedAmount <= 0 ||
    (deterministicAmount.ambiguous && deterministicAmount.amount === null && !Number.isFinite(candidateAmountNum))
  ) {
    return {
      status: 'clarification',
      clarification: {
        reason: candidateAmountNum <= 0 ? 'invalid_amount' : 'ambiguous_amount',
        message: localizedMessage(
          detectedLanguage,
          'കൃത്യമായ തുക വ്യക്തമല്ല. ദയവായി ശരിയായ തുക (രൂപയിൽ) പറയാമോ?',
          'The amount is unclear. Please tell me the exact amount in rupees.'
        )
      }
    };
  }

  // Extra guard: if user literally said vague quantity ("some money", "കുറച്ചു പണം") with NO digits or number words
  if (deterministicAmount.ambiguous && deterministicAmount.amount === null) {
    return {
      status: 'clarification',
      clarification: {
        reason: 'ambiguous_amount',
        message: localizedMessage(
          detectedLanguage,
          'കൃത്യമായ തുക വ്യക്തമല്ല ("കുറച്ചു പണം" എന്നതിന് പകരം). എത്ര രൂപയാണെന്ന് പറയാമോ?',
          'The exact amount is ambiguous. Could you tell me the exact rupee amount?'
        )
      }
    };
  }

  const finalizeProposal = (tx: ValidatedTransactionProposal): ProposalValidationOutcome => {
    const parsed = ValidatedTransactionProposalSchema.safeParse(tx);
    if (!parsed.success) {
      return {
        status: 'clarification',
        clarification: {
          reason: 'missing_details',
          message: parsed.error.issues[0]?.message || 'Invalid transaction details.'
        }
      };
    }

    const proposalId = createProposalId();
    const idempotencyKey = createIdempotencyKey(proposalId, parsed.data);
    return {
      status: 'valid',
      proposal: {
        proposalId,
        idempotencyKey,
        createdAtMs: nowMs,
        expiresAtMs: nowMs + PENDING_TRANSACTION_TTL_MS,
        confidence,
        summaryReply: buildConfirmationQuestion(parsed.data, detectedLanguage, catalog.currency),
        detectedLanguage,
        transaction: parsed.data
      }
    };
  };

  // 4. Intent-specific strict schema & catalog validation
  switch (candidate.intent) {
    case 'create_expense': {
      const rawCat = typeof candidate.category === 'string' ? candidate.category : undefined;
      const catMatch = normalizeExpenseCategory(rawCat, catalog.expenseCategories, rawUserText);
      if (!catMatch.category || catMatch.ambiguous) {
        return {
          status: 'clarification',
          clarification: {
            reason: 'unclear_category',
            message: localizedMessage(
              detectedLanguage,
              `₹${resolvedAmount} ചെലവ് ഏത് വിഭാഗത്തിൽ (ഉദാ: ${catalog.expenseCategories.slice(0, 4).join(', ')}) ഉൾപ്പെടുത്തണം?`,
              `Which expense category should I use for ₹${resolvedAmount} (e.g. ${catalog.expenseCategories.slice(0, 4).join(', ')})?`
            )
          }
        };
      }

      const rawTitle =
        typeof candidate.title === 'string' && candidate.title.trim()
          ? candidate.title.trim()
          : typeof candidate.description === 'string' && candidate.description.trim()
            ? candidate.description.trim()
            : catMatch.category;

      const notes =
        typeof candidate.notes === 'string' && candidate.notes.trim()
          ? candidate.notes.trim()
          : typeof candidate.note === 'string' && candidate.note.trim()
            ? candidate.note.trim()
            : undefined;

      return finalizeProposal({
        intent: 'create_expense',
        amount: resolvedAmount,
        category: catMatch.category,
        title: rawTitle.slice(0, 160),
        date: resolvedDate,
        paymentMethod: normalizePaymentMethod(candidate.paymentMethod, rawUserText, 'Cash'),
        ...(notes ? { notes } : {})
      });
    }

    case 'create_income': {
      const rawSrc = typeof candidate.source === 'string' ? candidate.source : undefined;
      const srcMatch = normalizeIncomeSource(rawSrc, catalog.incomeSources, rawUserText);
      if (!srcMatch.source || srcMatch.ambiguous) {
        return {
          status: 'clarification',
          clarification: {
            reason: 'unclear_source',
            message: localizedMessage(
              detectedLanguage,
              `₹${resolvedAmount} വരവ് ഏത് സ്രോതസ്സിൽ നിന്നാണ് (ഉദാ: ${catalog.incomeSources.slice(0, 4).join(', ')})?`,
              `Which income source should I use for ₹${resolvedAmount} (e.g. ${catalog.incomeSources.slice(0, 4).join(', ')})?`
            )
          }
        };
      }

      const rawTitle =
        typeof candidate.title === 'string' && candidate.title.trim()
          ? candidate.title.trim()
          : typeof candidate.description === 'string' && candidate.description.trim()
            ? candidate.description.trim()
            : `${srcMatch.source} Income`;

      const notes =
        typeof candidate.notes === 'string' && candidate.notes.trim()
          ? candidate.notes.trim()
          : typeof candidate.note === 'string' && candidate.note.trim()
            ? candidate.note.trim()
            : undefined;

      return finalizeProposal({
        intent: 'create_income',
        amount: resolvedAmount,
        source: srcMatch.source,
        title: rawTitle.slice(0, 160),
        date: resolvedDate,
        ...(notes ? { notes } : {})
      });
    }

    case 'create_debt_receivable':
    case 'create_debt_payable': {
      const personName = typeof candidate.personName === 'string' ? candidate.personName.trim() : '';
      if (!personName) {
        return {
          status: 'clarification',
          clarification: {
            reason: 'unclear_person',
            message: localizedMessage(
              detectedLanguage,
              'കടം ആരുടെ പേരിലാണ് രേഖപ്പെടുത്തേണ്ടത്? ആളുടെ പേര് പറയാമോ?',
              'Who is this debt with? Please tell me the person’s name.'
            )
          }
        };
      }

      const dueDateRaw = typeof candidate.dueDate === 'string' ? candidate.dueDate.trim() : '';
      if (dueDateRaw && !isValidStrictCalendarDate(dueDateRaw)) {
        return {
          status: 'clarification',
          clarification: {
            reason: 'invalid_date',
            message: localizedMessage(
              detectedLanguage,
              `Due date "${dueDateRaw}" സാധുവല്ല. ശരിയായ തീയതി നൽകാമോ?`,
              `Due date "${dueDateRaw}" is not a valid calendar date.`
            )
          }
        };
      }

      const description =
        typeof candidate.description === 'string' && candidate.description.trim()
          ? candidate.description.trim()
          : typeof candidate.title === 'string' && candidate.title.trim()
            ? candidate.title.trim()
            : candidate.intent === 'create_debt_receivable'
              ? `Loan given to ${personName}`
              : `Borrowed from ${personName}`;

      const notes =
        typeof candidate.notes === 'string' && candidate.notes.trim()
          ? candidate.notes.trim()
          : undefined;

      if (candidate.intent === 'create_debt_receivable') {
        return finalizeProposal({
          intent: 'create_debt_receivable',
          direction: 'receive',
          personName,
          amount: resolvedAmount,
          date: resolvedDate,
          ...(dueDateRaw ? { dueDate: dueDateRaw } : {}),
          description,
          ...(notes ? { notes } : {})
        });
      }

      return finalizeProposal({
        intent: 'create_debt_payable',
        direction: 'pay',
        personName,
        amount: resolvedAmount,
        date: resolvedDate,
        ...(dueDateRaw ? { dueDate: dueDateRaw } : {}),
        description,
        ...(notes ? { notes } : {})
      });
    }

    case 'record_debt_repayment': {
      const debtIdHint = typeof candidate.debtId === 'string' ? candidate.debtId.trim() : undefined;
      const personHint = typeof candidate.personName === 'string' ? candidate.personName.trim() : undefined;
      const directionHint =
        candidate.direction === 'pay' || candidate.direction === 'receive'
          ? candidate.direction
          : undefined;
      const paymentMethod = normalizePaymentMethod(candidate.paymentMethod, rawUserText, 'Bank Transfer');
      const notes =
        typeof candidate.notes === 'string' && candidate.notes.trim()
          ? candidate.notes.trim()
          : undefined;

      const matchResult = matchActiveDebtForRepayment({
        debtIdHint,
        personHint,
        directionHint,
        activeDebts: catalog.activeDebts
      });

      if (matchResult.status === 'not_found') {
        return {
          status: 'clarification',
          clarification: {
            reason: 'debt_not_found',
            message: localizedMessage(
              detectedLanguage,
              personHint
                ? `${personHint} എന്ന പേരിൽ നിലവിൽ അടയ്ക്കാനുള്ള/കിട്ടാനുള്ള കടം കണ്ടെത്താനായില്ല.`
                : 'തിരിച്ചടവ് രേഖപ്പെടുത്താൻ നിലവിൽ സജീവമായ കടങ്ങളൊന്നും കണ്ടെത്തിയില്ല.',
              personHint
                ? `I could not find an active unpaid debt for ${personHint}.`
                : 'No active unpaid debts were found to record a repayment against.'
            )
          }
        };
      }

      if (matchResult.status === 'ambiguous') {
        const options: DisambiguationOption[] = matchResult.candidates.map(d => ({
          kind: 'debt',
          id: d.id,
          label: `${d.personName} · ${d.direction === 'pay' ? 'Money to Pay' : 'Money to Receive'} (${formatRupeesSimple(d.remainingAmount, catalog.currency)} left · ${d.date})`,
          personName: d.personName,
          direction: d.direction,
          remainingAmount: d.remainingAmount,
          date: d.date,
          proposedAmount: resolvedAmount,
          proposedDate: resolvedDate,
          paymentMethod,
          ...(notes ? { notes } : {})
        }));
        return {
          status: 'clarification',
          clarification: {
            reason: 'multiple_debts',
            message: localizedMessage(
              detectedLanguage,
              `${personHint || 'നിങ്ങളുടെ അക്കൗണ്ടിൽ'} ഒന്നിലധികം കടങ്ങൾ ഉണ്ട്. ഏത് കടത്തിലേക്കാണ് തിരിച്ചടവ് രേഖപ്പെടുത്തേണ്ടതെന്ന് തിരഞ്ഞെടുക്കൂ:`,
              `Multiple active debts match${personHint ? ` "${personHint}"` : ''}. Please select which debt this repayment is for:`
            ),
            disambiguationOptions: options
          }
        };
      }

      const matchedDebt = matchResult.debt;
      if (resolvedAmount > matchedDebt.remainingAmount + 0.001) {
        return {
          status: 'clarification',
          clarification: {
            reason: 'repayment_exceeds_balance',
            message: localizedMessage(
              detectedLanguage,
              `${matchedDebt.personName}-ന്റെ ബാക്കി തുക ${formatRupeesSimple(matchedDebt.remainingAmount, catalog.currency)} മാത്രമാണ്. അതിൽ കൂടുതൽ തിരിച്ചടവ് രേഖപ്പെടുത്താനാവില്ല.`,
              `Repayment of ${formatRupeesSimple(resolvedAmount, catalog.currency)} exceeds ${matchedDebt.personName}'s remaining debt balance (${formatRupeesSimple(matchedDebt.remainingAmount, catalog.currency)}).`
            )
          }
        };
      }

      const remainingAfter = Math.max(0, Number((matchedDebt.remainingAmount - resolvedAmount).toFixed(2)));
      return finalizeProposal({
        intent: 'record_debt_repayment',
        debtId: matchedDebt.id,
        personName: matchedDebt.personName,
        direction: matchedDebt.direction,
        amount: resolvedAmount,
        remainingBefore: matchedDebt.remainingAmount,
        remainingAfter,
        date: resolvedDate,
        paymentMethod,
        ...(notes ? { notes } : {})
      });
    }

    case 'create_savings_transaction': {
      const txType: 'deposit' | 'withdrawal' =
        candidate.transactionType === 'withdrawal' ? 'withdrawal' : 'deposit';
      const note =
        typeof candidate.note === 'string' && candidate.note.trim()
          ? candidate.note.trim()
          : typeof candidate.notes === 'string' && candidate.notes.trim()
            ? candidate.notes.trim()
            : txType === 'deposit'
              ? 'Savings Deposit'
              : 'Savings Withdrawal';

      const goalMatch = matchSavingsGoal({
        savingsGoalIdHint: typeof candidate.savingsGoalId === 'string' ? candidate.savingsGoalId : undefined,
        savingsGoalNameHint:
          typeof candidate.savingsGoalName === 'string' ? candidate.savingsGoalName : undefined,
        rawText: rawUserText,
        activeSavingsGoals: catalog.activeSavingsGoals
      });

      if (goalMatch.status === 'not_found') {
        return {
          status: 'clarification',
          clarification: {
            reason: 'unclear_savings_goal',
            message: localizedMessage(
              detectedLanguage,
              'നിലവിൽ സജീവമായ സേവിങ്സ് ഫണ്ടുകളൊന്നും ഇല്ല. ആദ്യം Savings വിഭാഗത്തിൽ ഒരു ഫണ്ട് തുടങ്ങൂ.',
              'You do not have an active savings fund yet. Please create one in Savings first.'
            )
          }
        };
      }

      if (goalMatch.status === 'ambiguous') {
        const options: DisambiguationOption[] = goalMatch.candidates.map(g => ({
          kind: 'savings_goal',
          id: g.id,
          label: `${g.name} (${formatRupeesSimple(g.currentAmount, catalog.currency)} / ${formatRupeesSimple(g.targetAmount, catalog.currency)})`,
          name: g.name,
          currentAmount: g.currentAmount,
          targetAmount: g.targetAmount,
          proposedAmount: resolvedAmount,
          transactionType: txType,
          proposedDate: resolvedDate,
          ...(note ? { note } : {})
        }));
        return {
          status: 'clarification',
          clarification: {
            reason: 'unclear_savings_goal',
            message: localizedMessage(
              detectedLanguage,
              `₹${resolvedAmount} ഏത് സേവിങ്സ് ലക്ഷ്യത്തിലേക്കാണ് (Savings Goal) മാറ്റേണ്ടതെന്ന് തിരഞ്ഞെടുക്കൂ:`,
              `Which savings goal should receive ${formatRupeesSimple(resolvedAmount, catalog.currency)}? Please choose one:`
            ),
            disambiguationOptions: options
          }
        };
      }

      const matchedGoal = goalMatch.goal;
      if (txType === 'withdrawal' && resolvedAmount > matchedGoal.currentAmount + 0.001) {
        return {
          status: 'clarification',
          clarification: {
            reason: 'withdrawal_exceeds_balance',
            message: localizedMessage(
              detectedLanguage,
              `${matchedGoal.name} ഫണ്ടിൽ ${formatRupeesSimple(matchedGoal.currentAmount, catalog.currency)} മാത്രമേ ബാക്കിയുള്ളൂ.`,
              `Withdrawal exceeds ${matchedGoal.name}'s current balance (${formatRupeesSimple(matchedGoal.currentAmount, catalog.currency)}).`
            )
          }
        };
      }

      const balanceAfter =
        txType === 'deposit'
          ? Number((matchedGoal.currentAmount + resolvedAmount).toFixed(2))
          : Math.max(0, Number((matchedGoal.currentAmount - resolvedAmount).toFixed(2)));

      return finalizeProposal({
        intent: 'create_savings_transaction',
        savingsGoalId: matchedGoal.id,
        savingsGoalName: matchedGoal.name,
        transactionType: txType,
        amount: resolvedAmount,
        currentBalanceBefore: matchedGoal.currentAmount,
        balanceAfter,
        date: resolvedDate,
        note
      });
    }
  }
}
