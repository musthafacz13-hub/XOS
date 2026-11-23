import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AttendanceRecord,
  AttendanceStatus,
  CreateGoalInput,
  CurrencyCode,
  DashboardWidgetConfig,
  DateFormat,
  Debt,
  DebtDirection,
  DebtRepayment,
  DebtStatus,
  Expense,
  ExpenseCategory,
  Goal,
  GoalPriority,
  GoalStatus,
  Income,
  IncomeSource,
  PaymentMethod,
  RecurrenceFrequency,
  SalaryConfig,
  SalaryPayout,
  SavingsGoal,
  SavingsTransaction,
  SavingsTransactionType,
  UpdateGoalInput,
  UserSettings,
  WeekStartDay
} from '../types';
import { DEFAULT_USER_SETTINGS } from '../data/initialData';
import {
  calculateWorkingHours,
  getIstTodayString,
  getTodayString,
  isFutureIstDate,
  isValidCalendarDateString,
  localDateInputToUtcIso,
  normalizeDbTime,
  utcTimestampToLocalDate
} from '../utils/formatters';
import { calculateDailyEarnedSalary } from '../utils/calculations';
import { isSafeExternalUrl, sanitizeDatabaseErrorMessage } from '../utils/authValidation';
import { supabase, isSupabaseConfigured } from './supabase';
import { apiOptimization } from './apiClient';

export interface FetchTableError {
  table: string;
  message: string;
}

export interface FetchAllResult {
  partialErrors: FetchTableError[];
  stale: boolean;
}

export type SettingsBundleSection = 'user_settings' | 'salary_configs' | 'profiles';

export class SettingsBundleSaveError extends Error {
  succeededSections: SettingsBundleSection[];
  failedSections: Array<{ section: SettingsBundleSection; label: string; message: string }>;

  constructor(
    succeededSections: SettingsBundleSection[],
    failedSections: Array<{ section: SettingsBundleSection; label: string; message: string }>
  ) {
    const sectionLabels: Record<SettingsBundleSection, string> = {
      user_settings: 'Regional & Category Preferences',
      salary_configs: 'Salary Configuration',
      profiles: 'Profile Display Name'
    };
    const failedSummary = failedSections.map(f => `${f.label} (${f.message})`).join('; ');
    const succeededSummary = succeededSections.map(s => sectionLabels[s]).join(', ');
    const message =
      succeededSections.length > 0
        ? `Partial save: Saved ${succeededSummary}, but failed to save ${failedSummary}.`
        : `Failed to save settings: ${failedSummary}.`;
    super(message);
    this.name = 'SettingsBundleSaveError';
    this.succeededSections = succeededSections;
    this.failedSections = failedSections;
  }
}

export interface SettingsBundleInput {
  displayName?: string;
  currency: CurrencyCode;
  dateFormat: DateFormat;
  weekStartDay: WeekStartDay;
  customExpenseCategories: string[];
  customIncomeSources: string[];
  widgets: DashboardWidgetConfig[];
  salaryConfig: SalaryConfig;
}

interface InMemoryState {
  settings: UserSettings;
  goals: Goal[];
  expenses: Expense[];
  incomes: Income[];
  attendance: AttendanceRecord[];
  savingsGoals: SavingsGoal[];
  savingsTransactions: SavingsTransaction[];
  salaryPayouts: SalaryPayout[];
  debts: Debt[];
  debtRepayments: DebtRepayment[];
  fetchErrors: FetchTableError[];
}

function createDefaultSettings(): UserSettings {
  return {
    ...DEFAULT_USER_SETTINGS,
    profile: { ...DEFAULT_USER_SETTINGS.profile },
    salaryConfig: { ...DEFAULT_USER_SETTINGS.salaryConfig },
    widgets: DEFAULT_USER_SETTINGS.widgets.map(w => ({ ...w })),
    customExpenseCategories: [...DEFAULT_USER_SETTINGS.customExpenseCategories],
    customIncomeSources: [...DEFAULT_USER_SETTINGS.customIncomeSources]
  };
}

const memoryState: InMemoryState = {
  settings: createDefaultSettings(),
  goals: [],
  expenses: [],
  incomes: [],
  attendance: [],
  savingsGoals: [],
  savingsTransactions: [],
  salaryPayouts: [],
  debts: [],
  debtRepayments: [],
  fetchErrors: []
};

type Listener = () => void;
const listeners = new Set<Listener>();

function createCachedArrayGetter<T>(readSource: () => T[]): () => T[] {
  let cachedSource: T[] | null = null;
  let cachedSnapshot: T[] = [];
  return () => {
    const source = readSource();
    if (source !== cachedSource) {
      cachedSource = source;
      cachedSnapshot = [...source];
    }
    return cachedSnapshot;
  };
}

let cachedSettingsSource: UserSettings | null = null;
let cachedSettingsSnapshot: UserSettings | null = null;

const getCachedFetchErrors = createCachedArrayGetter(() => memoryState.fetchErrors);
const getCachedGoals = createCachedArrayGetter(() => memoryState.goals);
const getCachedExpenses = createCachedArrayGetter(() => memoryState.expenses);
const getCachedIncomes = createCachedArrayGetter(() => memoryState.incomes);
const getCachedAttendance = createCachedArrayGetter(() => memoryState.attendance);
const getCachedSavingsGoals = createCachedArrayGetter(() => memoryState.savingsGoals);
const getCachedSavingsTransactions = createCachedArrayGetter(() => memoryState.savingsTransactions);
const getCachedSalaryPayouts = createCachedArrayGetter(() => memoryState.salaryPayouts);
const getCachedDebts = createCachedArrayGetter(() => memoryState.debts);
const getCachedDebtRepayments = createCachedArrayGetter(() => memoryState.debtRepayments);

const SUPABASE_BACKEND_STATUS = {
  isBackendConfigured: true,
  persistenceMode: 'supabase' as const,
  statusLabel: 'Supabase Connected',
  syncStatus: 'Connected',
  backendNotice: 'Connected to your private Supabase database with Row Level Security active.'
};

const LOCAL_BACKEND_STATUS = {
  isBackendConfigured: false,
  persistenceMode: 'in-memory' as const,
  statusLabel: 'Local Session Active',
  syncStatus: 'Local-First Mode',
  backendNotice: 'Operating in local workspace mode.'
};

function notifyListeners() {
  listeners.forEach(cb => cb());
}

let activeSupabaseClient: SupabaseClient = supabase;
let configuredOverride: boolean | null = null;
let activeUserId: string | null = null;
let hydratedUserId: string | null = null;
let isHydrating = false;
let inFlightFetchAll: { userId: string; seq: number; promise: Promise<FetchAllResult> } | null = null;
let fetchSequence = 0;
let resetInFlightPromise: Promise<void> | null = null;
const archiveGoalInFlightPromises = new Map<string, Promise<void>>();
const debtRepaymentQueues = new Map<string, Promise<unknown>>();
const legacyNoteLinkedExpenseIds = new Set<string>();

function enqueueDebtRepaymentOp<T>(debtId: string, task: () => Promise<T>): Promise<T> {
  const previous = debtRepaymentQueues.get(debtId) || Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  const clearQueueTail = () => {
    if (debtRepaymentQueues.get(debtId) === cleanup) {
      debtRepaymentQueues.delete(debtId);
    }
  };
  const cleanup = next.then(clearQueueTail, clearQueueTail);
  debtRepaymentQueues.set(debtId, cleanup);
  return next;
}

function validateResetRpcResponse(rpcData: unknown): void {
  // Standard PostgreSQL RETURNS void functions return data: null (with error: null) via PostgREST.
  if (rpcData === null || rpcData === undefined) {
    return;
  }
  if (typeof rpcData === 'boolean') {
    if (rpcData !== true) {
      throw new Error('Account reset was rejected by the server.');
    }
    return;
  }
  if (typeof rpcData === 'string') {
    const normalized = rpcData.trim().toLowerCase();
    if (normalized === 'ok' || normalized === 'success' || normalized === 'true' || normalized === '') {
      return;
    }
    throw new Error(`Account reset failed: unexpected server response (${rpcData}).`);
  }

  const candidate = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  if (candidate && typeof candidate === 'object') {
    const record = candidate as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 0) {
      throw new Error('Account reset failed: server returned an empty confirmation payload.');
    }
    if (typeof record.error === 'string' && record.error.trim().length > 0) {
      throw new Error(record.error.trim());
    }
    if ('success' in record) {
      if (record.success !== true) {
        const msg =
          (typeof record.message === 'string' && record.message) ||
          (typeof record.error === 'string' && record.error) ||
          'Account reset failed on the server.';
        throw new Error(msg);
      }
      return;
    }
    if ('ok' in record) {
      if (record.ok !== true) {
        const msg =
          (typeof record.message === 'string' && record.message) ||
          (typeof record.error === 'string' && record.error) ||
          'Account reset failed on the server.';
        throw new Error(msg);
      }
      return;
    }
    if ('reset' in record) {
      if (record.reset !== true) {
        const msg =
          (typeof record.message === 'string' && record.message) ||
          'Account reset failed on the server.';
        throw new Error(msg);
      }
      return;
    }
    if (typeof record.status === 'string') {
      const normalizedStatus = record.status.trim().toLowerCase();
      if (['error', 'failed', 'rejected', 'false'].includes(normalizedStatus)) {
        const msg =
          (typeof record.message === 'string' && record.message) ||
          'Account reset failed on the server.';
        throw new Error(msg);
      }
      if (['ok', 'success', 'completed', 'true'].includes(normalizedStatus)) {
        return;
      }
      throw new Error(`Account reset failed: unexpected status (${record.status}).`);
    }
    throw new Error('Account reset failed: unrecognized confirmation payload from server.');
  }

  throw new Error('Account reset failed: invalid confirmation response from server.');
}

function validateArchiveGoalRpcResponse(rpcData: unknown): void {
  // Standard PostgreSQL RETURNS void returns data: null (with error: null) via PostgREST.
  if (rpcData === null || rpcData === undefined) {
    return;
  }
  if (typeof rpcData === 'boolean') {
    if (rpcData !== true) {
      throw new Error('Goal archive was rejected by the server.');
    }
    return;
  }
  if (typeof rpcData === 'string') {
    const normalized = rpcData.trim().toLowerCase();
    if (normalized === 'ok' || normalized === 'success' || normalized === 'true' || normalized === 'archived' || normalized === '') {
      return;
    }
    if (normalized === 'false') {
      throw new Error('Goal archive was rejected by the server.');
    }
    throw new Error(`Goal archive failed: unexpected server response (${rpcData}).`);
  }

  const candidate = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  if (typeof candidate === 'boolean') {
    if (candidate !== true) {
      throw new Error('Goal archive was rejected by the server.');
    }
    return;
  }
  if (candidate && typeof candidate === 'object') {
    const record = candidate as Record<string, unknown>;
    if ('xos_archive_goal' in record && typeof record.xos_archive_goal === 'boolean') {
      if (record.xos_archive_goal !== true) {
        throw new Error('Goal archive was rejected by the server.');
      }
      return;
    }
    if (typeof record.error === 'string' && record.error.trim().length > 0) {
      throw new Error(record.error.trim());
    }
    if ('success' in record && record.success !== true) {
      const msg =
        (typeof record.message === 'string' && record.message) ||
        'Database error: Could not archive goal.';
      throw new Error(msg);
    }
    if ('ok' in record && record.ok !== true) {
      const msg =
        (typeof record.message === 'string' && record.message) ||
        'Database error: Could not archive goal.';
      throw new Error(msg);
    }
    if ('archived' in record && record.archived !== true) {
      const msg =
        (typeof record.message === 'string' && record.message) ||
        'Database error: Could not archive goal.';
      throw new Error(msg);
    }
    if (typeof record.status === 'string') {
      const normalizedStatus = record.status.trim().toLowerCase();
      if (['error', 'failed', 'rejected', 'false'].includes(normalizedStatus)) {
        const msg =
          (typeof record.message === 'string' && record.message) ||
          'Database error: Could not archive goal.';
        throw new Error(msg);
      }
    }
    return;
  }

  throw new Error('Database error: Invalid goal archive confirmation from server.');
}

function classifyFetchError(err: unknown): 'abort' | 'timeout' | 'other' {
  if (!err) return 'other';
  const anyErr = err as { name?: unknown; code?: unknown; message?: unknown };
  const name = typeof anyErr.name === 'string' ? anyErr.name : '';
  const code = typeof anyErr.code === 'string' ? anyErr.code : '';
  const msg = typeof anyErr.message === 'string' ? anyErr.message : String(err);

  if (
    name === 'TimeoutError' ||
    name === 'DebtRequestTimeoutError' ||
    /Request timed out|TimeoutError/i.test(msg)
  ) {
    return 'timeout';
  }
  if (
    name === 'AbortError' ||
    name === 'DebtRequestAbortError' ||
    code === 'ABORT_ERR' ||
    /AbortError|Fetch is aborted|signal is aborted/i.test(msg)
  ) {
    return 'abort';
  }
  return 'other';
}

function formatDebtMutationError(err: unknown, fallbackMessage: string): Error {
  const kind = classifyFetchError(err);
  if (kind === 'timeout') {
    const timeoutErr = new Error(
      'Request timed out before confirmation from the server. Please verify your debt list before trying again.'
    );
    timeoutErr.name = 'DebtRequestTimeoutError';
    return timeoutErr;
  }
  if (kind === 'abort') {
    const abortErr = new Error(
      'Request was cancelled before confirmation (AbortError: Fetch is aborted). Please verify your debt list before trying again.'
    );
    abortErr.name = 'DebtRequestAbortError';
    return abortErr;
  }
  const msg =
    err && typeof err === 'object' && 'message' in err && typeof (err as any).message === 'string'
      ? (err as any).message
      : err instanceof Error
        ? err.message
        : '';
  return new Error(sanitizeDatabaseErrorMessage(msg, fallbackMessage));
}

/**
 * Test-only hook allowing unit suites to inject a mocked Supabase client
 * without modifying production configuration.
 */
export function configureRepositoryBackendForTests(
  client: SupabaseClient | null,
  isConfigured: boolean | null
) {
  activeSupabaseClient = client || supabase;
  configuredOverride = isConfigured;
}

function isBackendActive(): boolean {
  return configuredOverride !== null ? configuredOverride : isSupabaseConfigured;
}

function getClient(): SupabaseClient {
  return activeSupabaseClient;
}

async function getAuthUser() {
  if (!isBackendActive()) return null;
  const { data, error } = await getClient().auth.getSession();
  if (error) {
    throw new Error(sanitizeDatabaseErrorMessage(error, 'Could not verify authentication session.'));
  }
  return data?.session?.user || null;
}

async function requirePersistenceContext() {
  if (!isBackendActive()) {
    return { mode: 'local' as const };
  }
  const user = await getAuthUser();
  if (!user) {
    throw new Error('Your session has expired. Please sign in again to save changes.');
  }
  if (activeUserId && user.id !== activeUserId) {
    throw new Error('Active user session changed. Please reload before saving.');
  }
  return { mode: 'supabase' as const, user, client: getClient() };
}

export function toDbWeekStartDay(day: WeekStartDay): 0 | 1 {
  if (day === 'Sunday') return 0;
  if (day === 'Monday') return 1;
  throw new Error(`Unsupported week start day: ${String(day)}`);
}

export function fromDbWeekStartDay(val: unknown, fallback: WeekStartDay = 'Monday'): WeekStartDay {
  if (val === 0 || val === '0' || val === 'Sunday' || val === 'sunday') return 'Sunday';
  if (val === 1 || val === '1' || val === 'Monday' || val === 'monday') return 'Monday';
  return fallback;
}

export function toDbAttendanceStatus(status: AttendanceStatus | string): 'present' | 'absent' | 'leave' | 'holiday' {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'present' || normalized === 'absent' || normalized === 'leave' || normalized === 'holiday') {
    return normalized;
  }
  throw new Error(`Unsupported attendance status: ${String(status)}`);
}

export function fromDbAttendanceStatus(val: unknown): AttendanceStatus {
  const normalized = String(val || '').trim().toLowerCase();
  switch (normalized) {
    case 'present':
      return 'Present';
    case 'absent':
      return 'Absent';
    case 'leave':
      return 'Leave';
    case 'holiday':
      return 'Holiday';
    default:
      return 'Absent';
  }
}

export function toDbGoalStatus(
  status: GoalStatus | string
): 'not_started' | 'in_progress' | 'completed' | 'paused' {
  const normalized = String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  switch (normalized) {
    case 'not_started':
      return 'not_started';
    case 'in_progress':
      return 'in_progress';
    case 'completed':
      return 'completed';
    case 'paused':
      return 'paused';
    case 'archived':
    case 'cancelled':
      throw new Error('Use Archive Goal to cancel or archive a goal.');
    default:
      throw new Error(`Unsupported goal status: ${String(status)}`);
  }
}

export function fromDbGoalStatus(val: unknown): GoalStatus {
  const normalized = String(val || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  switch (normalized) {
    case 'not_started':
      return 'Not Started';
    case 'in_progress':
      return 'In Progress';
    case 'completed':
      return 'Completed';
    case 'paused':
      return 'Paused';
    case 'cancelled':
    case 'archived':
      return 'Archived';
    default:
      return 'In Progress';
  }
}

function isDbRowArchived(row: any): boolean {
  if (!row || typeof row !== 'object') return false;
  if (row.archived_at !== null && row.archived_at !== undefined && row.archived_at !== '') {
    return true;
  }
  if (row.is_archived === true) {
    return true;
  }
  const normalizedStatus = String(row.status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return normalizedStatus === 'archived' || normalizedStatus === 'cancelled';
}

export function toDbGoalPriority(priority: GoalPriority | string): 'low' | 'medium' | 'high' {
  const normalized = String(priority || '').trim().toLowerCase();
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized;
  }
  throw new Error(`Unsupported goal priority: ${String(priority)}`);
}

export function fromDbGoalPriority(val: unknown): GoalPriority {
  const normalized = String(val || '').trim().toLowerCase();
  switch (normalized) {
    case 'low':
      return 'Low';
    case 'high':
      return 'High';
    case 'medium':
    default:
      return 'Medium';
  }
}

export function toDbRecurrenceFrequency(
  isRecurring: boolean,
  frequency?: RecurrenceFrequency | string | null
): 'daily' | 'weekly' | 'monthly' | 'yearly' | null {
  if (!isRecurring) {
    return null;
  }
  const normalized = String(frequency || '').trim().toLowerCase();
  if (
    normalized === 'daily' ||
    normalized === 'weekly' ||
    normalized === 'monthly' ||
    normalized === 'yearly'
  ) {
    return normalized;
  }
  throw new Error('Recurring expenses require a frequency of Daily, Weekly, Monthly, or Yearly.');
}

export function fromDbRecurrenceFrequency(isRecurring: unknown, val: unknown): RecurrenceFrequency {
  if (!isRecurring || val === null || val === undefined || val === '') {
    return 'None';
  }
  const normalized = String(val).trim().toLowerCase();
  switch (normalized) {
    case 'daily':
      return 'Daily';
    case 'weekly':
      return 'Weekly';
    case 'monthly':
      return 'Monthly';
    case 'yearly':
      return 'Yearly';
    case 'none':
    default:
      return 'None';
  }
}

const REPAYMENT_TAG_REGEX = /\s*\[xos-repayment:([a-zA-Z0-9_-]+)\]\s*/g;

export function deserializeExpenseRepaymentNotes(
  rawNotes?: string | null,
  explicitDebtRepaymentId?: string | null
): { debtRepaymentId?: string; notes: string } {
  const raw = rawNotes ? String(rawNotes) : '';
  let extractedId: string | undefined =
    typeof explicitDebtRepaymentId === 'string' && explicitDebtRepaymentId.trim()
      ? explicitDebtRepaymentId.trim()
      : undefined;

  REPAYMENT_TAG_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REPAYMENT_TAG_REGEX.exec(raw)) !== null) {
    if (!extractedId && match[1]) {
      extractedId = match[1].trim();
    }
  }

  const cleanNotes = raw.replace(/\s*\[xos-repayment:[a-zA-Z0-9_-]+\]\s*/g, ' ').trim();
  return {
    debtRepaymentId: extractedId,
    notes: cleanNotes
  };
}

export function serializeExpenseRepaymentNotes(notes?: string | null, debtRepaymentId?: string): string | null {
  const { notes: cleanNotes } = deserializeExpenseRepaymentNotes(notes);
  if (!debtRepaymentId) {
    return cleanNotes || null;
  }
  const tag = `[xos-repayment:${debtRepaymentId}]`;
  return cleanNotes ? `${cleanNotes} ${tag}` : tag;
}

export function buildDebtRepaymentExpenseTitle(debt: Pick<Debt, 'person_name'>): string {
  const person = (debt.person_name || 'Unknown').trim();
  return `Debt Repayment — ${person}`;
}

export function buildDebtRepaymentExpenseNotes(
  debt: Pick<Debt, 'person_name' | 'description' | 'notes'>,
  repayment: Pick<DebtRepayment, 'notes'>
): string {
  const person = (debt.person_name || 'Unknown').trim();
  const debtContext = (debt.description || debt.notes || '').trim();
  const repNote = (repayment.notes || '').trim();

  if (debtContext && repNote && debtContext.toLowerCase() !== repNote.toLowerCase()) {
    return `Repayment to ${person} (${debtContext}) · ${repNote}`;
  }
  if (repNote) {
    return `Repayment to ${person} · ${repNote}`;
  }
  if (debtContext) {
    return `Repayment to ${person} (${debtContext})`;
  }
  return `Repayment to ${person}`;
}

function mapExpenseRow(e: any): Expense {
  const authoritativeFkId =
    typeof e.debt_repayment_id === 'string' && e.debt_repayment_id.trim()
      ? e.debt_repayment_id.trim()
      : undefined;
  const { debtRepaymentId: legacyTagId, notes } = deserializeExpenseRepaymentNotes(
    e.notes,
    authoritativeFkId
  );
  const resolvedLinkId = authoritativeFkId || legacyTagId;
  if (e.id) {
    if (!authoritativeFkId && legacyTagId) {
      legacyNoteLinkedExpenseIds.add(e.id);
    } else {
      legacyNoteLinkedExpenseIds.delete(e.id);
    }
  }
  return {
    id: e.id,
    title: e.title,
    amount: Number(e.amount),
    category: e.category as ExpenseCategory,
    date: e.expense_date,
    time: e.expense_time ? String(e.expense_time).slice(0, 5) : undefined,
    paymentMethod: (e.payment_method || 'Cash') as PaymentMethod,
    notes,
    isRecurring: Boolean(e.is_recurring),
    recurringFrequency: fromDbRecurrenceFrequency(e.is_recurring, e.recurrence_frequency),
    recurrenceEndDate: e.recurrence_end_date || undefined,
    debtRepaymentId: resolvedLinkId,
    createdAt: e.created_at
  };
}

function mapIncomeRow(i: any): Income {
  return {
    id: i.id,
    title: i.title,
    amount: Number(i.amount),
    source: i.source as IncomeSource,
    date: i.income_date,
    time: i.income_time ? String(i.income_time).slice(0, 5) : undefined,
    notes: i.notes || '',
    salaryPayoutId: i.salary_payout_id || undefined,
    createdAt: i.created_at
  };
}

export function deserializeDebtDescription(rawDescription?: string): { direction: DebtDirection; description: string } {
  const raw = rawDescription || '';
  let trimmed = raw.trim();
  let direction: DebtDirection = 'receive';
  let foundDirection = false;

  const prefixRegex = /^\s*\[\s*(PAY|RECEIVE)\s*\]\s*/i;

  while (prefixRegex.test(trimmed)) {
    const match = trimmed.match(prefixRegex);
    if (match && match[1]) {
      const matchedStr = match[1].toUpperCase();
      if (!foundDirection) {
        direction = matchedStr === 'PAY' ? 'pay' : 'receive';
        foundDirection = true;
      }
    }
    trimmed = trimmed.replace(prefixRegex, '').trim();
  }

  return { direction, description: trimmed };
}

export function serializeDebtDescription(direction: DebtDirection, description?: string): string {
  const { description: cleanDesc } = deserializeDebtDescription(description);
  const prefix = direction === 'pay' ? '[PAY]' : '[RECEIVE]';
  return cleanDesc ? `${prefix} ${cleanDesc}` : prefix;
}

function mapDebtRow(d: any): Debt {
  const original = Number(d.original_amount);
  const remaining =
    d.remaining_amount !== null && d.remaining_amount !== undefined
      ? Number(d.remaining_amount)
      : original;

  const { direction, description: cleanDesc } = deserializeDebtDescription(d.description);

  return {
    id: d.id,
    person_name: d.person_name,
    original_amount: original,
    remaining_amount: remaining,
    lent_date: d.lent_date,
    due_date: d.due_date || undefined,
    description: cleanDesc,
    notes: d.notes || '',
    status: (String(d.status || 'outstanding').toLowerCase()) as DebtStatus,
    created_at: d.created_at,
    updated_at: d.updated_at || undefined,
    direction
  };
}

function mapDebtRepaymentRow(r: any): DebtRepayment {
  return {
    id: r.id,
    debt_id: r.debt_id,
    amount: Number(r.amount),
    repayment_date: r.repayment_date,
    payment_method: r.payment_method || undefined,
    notes: r.notes || '',
    created_at: r.created_at
  };
}

function mapAttendanceRow(a: any): AttendanceRecord {
  const status = fromDbAttendanceStatus(a.status);
  const addonSalaryParsed = Number(a.addon_salary);
  const overrideAmountParsed = Number(a.salary_override_amount);

  return {
    id: a.id,
    date: a.attendance_date,
    status,
    checkInTime: a.check_in ? String(a.check_in).slice(0, 5) : undefined,
    checkOutTime: a.check_out ? String(a.check_out).slice(0, 5) : undefined,
    breakDurationMinutes:
      a.break_minutes !== null && a.break_minutes !== undefined && a.break_minutes !== ''
        ? Number(a.break_minutes)
        : 0,
    calculatedHours:
      a.hours_worked !== null && a.hours_worked !== undefined && a.hours_worked !== ''
        ? Number(a.hours_worked)
        : 0,
    extraHours:
      a.extra_hours !== null && a.extra_hours !== undefined && a.extra_hours !== ''
        ? Number(a.extra_hours)
        : 0,
    dailyBaseSalary:
      a.daily_base_salary !== null && a.daily_base_salary !== undefined && a.daily_base_salary !== ''
        ? Number(a.daily_base_salary)
        : undefined,
    addonSalary:
      a.addon_salary !== null &&
      a.addon_salary !== undefined &&
      a.addon_salary !== '' &&
      Number.isFinite(addonSalaryParsed)
        ? addonSalaryParsed
        : 0,
    addonEnabled: typeof a.addon_enabled === 'boolean' ? a.addon_enabled : false,
    extraHourRate:
      a.extra_hour_rate !== null && a.extra_hour_rate !== undefined && a.extra_hour_rate !== ''
        ? Number(a.extra_hour_rate)
        : undefined,
    overtimeEnabled:
      typeof a.overtime_enabled === 'boolean'
        ? a.overtime_enabled
        : Number(a.extra_hour_rate) > 0,
    salaryOverrideEnabled:
      typeof a.salary_override_enabled === 'boolean' ? a.salary_override_enabled : false,
    salaryOverrideAmount:
      a.salary_override_amount !== null &&
      a.salary_override_amount !== undefined &&
      a.salary_override_amount !== '' &&
      Number.isFinite(overrideAmountParsed)
        ? overrideAmountParsed
        : undefined,
    dailyEarnedSalary:
      a.calculated_salary !== null && a.calculated_salary !== undefined && a.calculated_salary !== ''
        ? Number(a.calculated_salary)
        : 0,
    notes: a.notes || ''
  };
}

function mapSavingsGoalRow(g: any): SavingsGoal {
  return {
    id: g.id,
    name: g.name,
    targetAmount: Number(g.target_amount),
    currentAmount:
      g.current_balance !== null && g.current_balance !== undefined ? Number(g.current_balance) : 0,
    targetDate: g.target_date || undefined,
    description: g.notes || '',
    color: g.color || undefined,
    createdAt: g.created_at,
    updatedAt: g.updated_at || undefined
  };
}

function mapSavingsTxRow(tx: any): SavingsTransaction {
  const normalizedType = String(tx.transaction_type || 'deposit').trim().toLowerCase();
  return {
    id: tx.id,
    savingsGoalId: tx.savings_goal_id,
    amount: Number(tx.amount),
    type: (normalizedType === 'withdrawal' ? 'withdrawal' : 'deposit') as SavingsTransactionType,
    date: tx.transaction_date,
    note: tx.notes || '',
    createdAt: tx.created_at
  };
}

function mapSalaryPayoutRow(p: any): SalaryPayout {
  return {
    id: p.id,
    periodStart: p.period_start,
    periodEnd: p.period_end,
    amountPaid:
      p.amount_paid !== null && p.amount_paid !== undefined ? Number(p.amount_paid) : 0,
    paidAt: p.paid_at ? utcTimestampToLocalDate(String(p.paid_at)) : getTodayString(),
    notes: p.notes || '',
    createdAt: p.created_at || undefined,
    updatedAt: p.updated_at || undefined
  };
}

export function extractCreatedGoalIds(rpcData: unknown): { goalId: string; savingsGoalId: string } {
  const raw = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  if (!raw || typeof raw !== 'object') {
    throw new Error('Database RPC xos_create_goal_with_savings did not return created record IDs.');
  }

  const obj = raw as Record<string, any>;
  const rawGoalId =
    obj.goal_id ??
    obj.goalId ??
    obj.goal?.id ??
    (obj.savings_goal_id || obj.savingsGoalId || obj.savings_goal?.id || obj.savingsGoal?.id ? obj.id : undefined);
  const rawSavingsGoalId =
    obj.savings_goal_id ??
    obj.savingsGoalId ??
    obj.savings_goal?.id ??
    obj.savingsGoal?.id;

  const goalId = typeof rawGoalId === 'string' ? rawGoalId.trim() : '';
  const savingsGoalId = typeof rawSavingsGoalId === 'string' ? rawSavingsGoalId.trim() : '';

  if (!goalId || !savingsGoalId) {
    throw new Error('Database RPC xos_create_goal_with_savings must return both Goal ID and Savings Account ID.');
  }

  return { goalId, savingsGoalId };
}

function mapGoalRow(g: any): Goal {
  const status = fromDbGoalStatus(g.status);
  const priority = fromDbGoalPriority(g.priority);
  const parsedProgress = Number(g.progress_percentage);
  const progress =
    g.progress_percentage !== null &&
    g.progress_percentage !== undefined &&
    Number.isFinite(parsedProgress)
      ? Math.max(0, Math.min(100, parsedProgress))
      : status === 'Completed'
        ? 100
        : 0;
  const savingsGoalId = typeof g.savings_goal_id === 'string' ? g.savings_goal_id.trim() : '';
  const parsedTarget =
    g.target_amount !== null && g.target_amount !== undefined && Number.isFinite(Number(g.target_amount))
      ? Number(g.target_amount)
      : undefined;

  return {
    id: typeof g.id === 'string' ? g.id.trim() : g.id,
    title: g.title || 'Untitled Goal',
    description: g.description || '',
    category: g.category || 'Personal',
    targetAmount: parsedTarget,
    progressPercentage: progress,
    targetDate: g.target_date || undefined,
    priority,
    status,
    createdAt: g.created_at || getTodayString(),
    completedAt: g.completed_at || undefined,
    savingsGoalId
  };
}

function mapSalaryConfigRow(row: any, fallback: SalaryConfig): SalaryConfig {
  const dailyBase =
    row.daily_base_salary !== undefined &&
    row.daily_base_salary !== null &&
    row.daily_base_salary !== ''
      ? Number(row.daily_base_salary)
      : undefined;
  const addonSalary =
    row.addon_salary !== undefined &&
    row.addon_salary !== null &&
    row.addon_salary !== ''
      ? Number(row.addon_salary)
      : 0;
  const stdHours =
    row.standard_hours !== undefined &&
    row.standard_hours !== null &&
    row.standard_hours !== ''
      ? Number(row.standard_hours)
      : undefined;
  const extraRate =
    row.extra_hour_rate !== undefined &&
    row.extra_hour_rate !== null &&
    row.extra_hour_rate !== ''
      ? Number(row.extra_hour_rate)
      : undefined;

  const resolvedDailyBase =
    dailyBase !== undefined && Number.isFinite(dailyBase) ? dailyBase : fallback.dailyBaseSalary;
  const resolvedStdHours =
    stdHours !== undefined && Number.isFinite(stdHours) && stdHours > 0
      ? stdHours
      : fallback.standardWorkingHours;
  const resolvedExtraRate =
    extraRate !== undefined && Number.isFinite(extraRate) ? extraRate : fallback.extraHourRate;

  return {
    currency: (row.currency_code as CurrencyCode) || fallback.currency,
    dailyBaseSalary: resolvedDailyBase,
    addonSalary: Number.isFinite(addonSalary) ? addonSalary : 0,
    addonEnabled: typeof row.addon_enabled === 'boolean' ? row.addon_enabled : false,
    standardWorkingHours: resolvedStdHours,
    extraHourRate: resolvedExtraRate,
    overtimeEnabled: typeof row.overtime_enabled === 'boolean' ? row.overtime_enabled : false,
    isConfigured:
      typeof resolvedDailyBase === 'number' &&
      Number.isFinite(resolvedDailyBase) &&
      resolvedDailyBase >= 0 &&
      typeof resolvedStdHours === 'number' &&
      Number.isFinite(resolvedStdHours) &&
      resolvedStdHours > 0
  };
}

function mergeWidgets(rawWidgets: unknown, fallback: DashboardWidgetConfig[]): DashboardWidgetConfig[] {
  if (!Array.isArray(rawWidgets) || rawWidgets.length === 0) {
    return fallback.map(w => ({ ...w }));
  }
  const byId = new Map<string, any>();
  rawWidgets.forEach(item => {
    if (item && typeof item === 'object' && typeof (item as any).id === 'string') {
      byId.set((item as any).id, item);
    }
  });
  return fallback.map(def => {
    const saved = byId.get(def.id);
    if (!saved) return { ...def };
    return {
      ...def,
      visible: typeof saved.visible === 'boolean' ? saved.visible : def.visible,
      order: typeof saved.order === 'number' ? saved.order : def.order
    };
  });
}

export const repository = {
  subscribe(callback: Listener): () => void {
    listeners.add(callback);
    return () => listeners.delete(callback);
  },

  setActiveUserId(userId: string | null) {
    if (activeUserId !== userId) {
      fetchSequence += 1;
      activeUserId = userId;
      hydratedUserId = null;
      isHydrating = false;
      inFlightFetchAll = null;
    }
  },

  getActiveUserId(): string | null {
    return activeUserId;
  },

  getHydrationState(): { isHydrating: boolean; hasHydrated: boolean; hydratedUserId: string | null } {
    const backendActive = isBackendActive();
    return {
      isHydrating,
      hasHydrated: !backendActive || (hydratedUserId !== null && hydratedUserId === activeUserId),
      hydratedUserId
    };
  },

  getFetchErrors(): FetchTableError[] {
    return getCachedFetchErrors();
  },

  /**
   * Diagnostic backend integration status
   */
  getBackendStatus() {
    return isBackendActive() ? SUPABASE_BACKEND_STATUS : LOCAL_BACKEND_STATUS;
  },

  /**
   * Cross-browser data synchronization:
   * Restores all user records from Supabase tables for the authenticated user.
   */
  async fetchAllUserData(userId: string): Promise<FetchAllResult> {
    if (!isBackendActive() || !userId) {
      return { partialErrors: [], stale: false };
    }

    if (
      inFlightFetchAll &&
      inFlightFetchAll.userId === userId &&
      inFlightFetchAll.seq === fetchSequence
    ) {
      return inFlightFetchAll.promise;
    }

    const client = getClient();
    activeUserId = userId;
    const mySeq = ++fetchSequence;
    isHydrating = true;

    const queryDefs = [
      {
        table: 'expenses',
        promise: client.from('expenses').select('*').eq('user_id', userId).order('expense_date', { ascending: false })
      },
      {
        table: 'incomes',
        promise: client.from('incomes').select('*').eq('user_id', userId).order('income_date', { ascending: false })
      },
      {
        table: 'debts',
        promise: client.from('debts').select('*').eq('user_id', userId).order('lent_date', { ascending: false })
      },
      {
        table: 'debt_repayments',
        promise: client.from('debt_repayments').select('*').eq('user_id', userId).order('repayment_date', { ascending: false })
      },
      {
        table: 'attendance_records',
        promise: client.from('attendance_records').select('*').eq('user_id', userId).order('attendance_date', { ascending: false })
      },
      {
        table: 'savings_goals',
        promise: client.from('savings_goals').select('*').eq('user_id', userId).order('created_at', { ascending: true })
      },
      {
        table: 'savings_transactions',
        promise: client.from('savings_transactions').select('*').eq('user_id', userId).order('transaction_date', { ascending: false })
      },
      {
        table: 'salary_payouts',
        promise: client.from('salary_payouts').select('*').eq('user_id', userId).order('period_start', { ascending: false })
      },
      {
        table: 'goals',
        promise: client.from('goals').select('*').eq('user_id', userId).order('created_at', { ascending: false })
      },
      {
        table: 'user_settings',
        promise: client.from('user_settings').select('*').eq('user_id', userId).maybeSingle()
      },
      {
        table: 'profiles',
        promise: client.from('profiles').select('id, display_name, avatar_url, created_at, updated_at').eq('id', userId).maybeSingle()
      },
      {
        table: 'salary_configs',
        promise: client.from('salary_configs').select('id, user_id, daily_base_salary, addon_salary, addon_enabled, standard_hours, extra_hour_rate, overtime_enabled, currency_code, created_at, updated_at').eq('user_id', userId).maybeSingle()
      }
    ] as const;

    const runFetch = (async (): Promise<FetchAllResult> => {
      try {
        const settled = await Promise.allSettled(queryDefs.map(q => q.promise));

    // Discard stale responses if another user switched in or user signed out while fetching
    if (mySeq !== fetchSequence || activeUserId !== userId) {
      return { partialErrors: [], stale: true };
    }

    const partialErrors: FetchTableError[] = [];

    const readResult = (index: number): { ok: boolean; data: any } => {
      const table = queryDefs[index].table;
      const res = settled[index];
      if (res.status === 'rejected') {
        partialErrors.push({
          table,
          message: sanitizeDatabaseErrorMessage(res.reason, 'Request failed')
        });
        return { ok: false, data: null };
      }
      if (res.value.error) {
        partialErrors.push({
          table,
          message: sanitizeDatabaseErrorMessage(res.value.error, 'Database query error')
        });
        return { ok: false, data: null };
      }
      return { ok: true, data: res.value.data };
    };

    const expensesRes = readResult(0);
    if (expensesRes.ok && Array.isArray(expensesRes.data)) {
      legacyNoteLinkedExpenseIds.clear();
      memoryState.expenses = expensesRes.data.map(mapExpenseRow);
    }

    const incomesRes = readResult(1);
    if (incomesRes.ok && Array.isArray(incomesRes.data)) {
      memoryState.incomes = incomesRes.data.map(mapIncomeRow);
    }

    const debtsRes = readResult(2);
    if (debtsRes.ok && Array.isArray(debtsRes.data)) {
      memoryState.debts = debtsRes.data.map(mapDebtRow);
    }

    const debtRepaymentsRes = readResult(3);
    if (debtRepaymentsRes.ok && Array.isArray(debtRepaymentsRes.data)) {
      memoryState.debtRepayments = debtRepaymentsRes.data.map(mapDebtRepaymentRow);
    }

    const attendanceRes = readResult(4);
    if (attendanceRes.ok && Array.isArray(attendanceRes.data)) {
      memoryState.attendance = attendanceRes.data.map(mapAttendanceRow);
    }

    const savingsGoalsRes = readResult(5);
    const savingsTxRes = readResult(6);
    const salaryPayoutsRes = readResult(7);
    if (salaryPayoutsRes.ok && Array.isArray(salaryPayoutsRes.data)) {
      memoryState.salaryPayouts = salaryPayoutsRes.data.map(mapSalaryPayoutRow);
    }

    const goalsRes = readResult(8);

    const hardArchivedSavingsGoalIds = new Set<string>();
    const cancelledGoalSavingsIds = new Set<string>();
    if (goalsRes.ok && Array.isArray(goalsRes.data)) {
      for (const rawGoal of goalsRes.data) {
        const sgId =
          rawGoal && typeof rawGoal.savings_goal_id === 'string'
            ? rawGoal.savings_goal_id.trim()
            : '';
        if (!sgId) continue;
        const rawStatus = String(rawGoal.status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
        if (
          (rawGoal.archived_at !== null && rawGoal.archived_at !== undefined && rawGoal.archived_at !== '') ||
          rawGoal.is_archived === true ||
          rawStatus === 'archived'
        ) {
          hardArchivedSavingsGoalIds.add(sgId);
        } else if (rawStatus === 'cancelled') {
          cancelledGoalSavingsIds.add(sgId);
        }
      }
    }
    if (savingsGoalsRes.ok && Array.isArray(savingsGoalsRes.data)) {
      for (const rawSg of savingsGoalsRes.data) {
        if (isDbRowArchived(rawSg) && typeof rawSg.id === 'string' && rawSg.id.trim()) {
          hardArchivedSavingsGoalIds.add(rawSg.id.trim());
        }
      }
    }

    if (savingsGoalsRes.ok && Array.isArray(savingsGoalsRes.data)) {
      const seenSgIds = new Set<string>();
      const mappedSavings: SavingsGoal[] = [];
      for (const rawSg of savingsGoalsRes.data) {
        if (!rawSg || isDbRowArchived(rawSg)) continue;
        const sgId = typeof rawSg.id === 'string' ? rawSg.id.trim() : '';
        if (!sgId || hardArchivedSavingsGoalIds.has(sgId) || seenSgIds.has(sgId)) continue;
        seenSgIds.add(sgId);
        const mappedSg = mapSavingsGoalRow(rawSg);
        if (cancelledGoalSavingsIds.has(sgId)) {
          mappedSg.isArchived = true;
        }
        mappedSavings.push(mappedSg);
      }
      memoryState.savingsGoals = mappedSavings;
    }

    if (savingsTxRes.ok && Array.isArray(savingsTxRes.data)) {
      const seenTxIds = new Set<string>();
      const mappedTxs: SavingsTransaction[] = [];
      for (const rawTx of savingsTxRes.data) {
        if (!rawTx || isDbRowArchived(rawTx)) continue;
        const txId = typeof rawTx.id === 'string' ? rawTx.id.trim() : '';
        if (!txId || seenTxIds.has(txId)) continue;
        seenTxIds.add(txId);
        mappedTxs.push(mapSavingsTxRow(rawTx));
      }
      memoryState.savingsTransactions = mappedTxs;
    }

    if (goalsRes.ok && Array.isArray(goalsRes.data)) {
      const seenGoalIds = new Set<string>();
      const mappedGoals: Goal[] = [];
      for (const rawGoal of goalsRes.data) {
        if (!rawGoal || isDbRowArchived(rawGoal)) continue;
        const gId = typeof rawGoal.id === 'string' ? rawGoal.id.trim() : '';
        if (!gId || seenGoalIds.has(gId)) continue;
        seenGoalIds.add(gId);
        try {
          mappedGoals.push(mapGoalRow(rawGoal));
        } catch (err) {
          partialErrors.push({
            table: 'goals',
            message: sanitizeDatabaseErrorMessage(err, 'Skipped invalid goal record')
          });
        }
      }
      memoryState.goals = mappedGoals;
    }

    const settingsRes = readResult(9);
    const profileRes = readResult(10);
    const salaryConfigRes = readResult(11);

    const defaultSettings = createDefaultSettings();

    // Currency precedence: user_settings.currency_code -> salary_configs.currency_code -> 'INR'
    const savedSettingsCurrency = settingsRes.ok ? settingsRes.data?.currency_code : undefined;
    const savedSalaryCurrency = salaryConfigRes.ok ? salaryConfigRes.data?.currency_code : undefined;
    const resolvedCurrency = (savedSettingsCurrency || savedSalaryCurrency || 'INR') as CurrencyCode;

    let nextSettings: UserSettings = {
      ...defaultSettings,
      profile: {
        ...defaultSettings.profile,
        email: memoryState.settings.profile.email || ''
      },
      salaryConfig: {
        ...defaultSettings.salaryConfig,
        currency: resolvedCurrency
      },
      widgets: defaultSettings.widgets.map(w => ({ ...w })),
      customExpenseCategories: [...defaultSettings.customExpenseCategories],
      customIncomeSources: [...defaultSettings.customIncomeSources]
    };

    if (settingsRes.ok) {
      const sData = settingsRes.data;
      if (sData) {
        nextSettings = {
          ...nextSettings,
          currency: resolvedCurrency,
          dateFormat: (sData.date_format as DateFormat) || defaultSettings.dateFormat,
          weekStartDay: fromDbWeekStartDay(sData.week_starts_on, defaultSettings.weekStartDay),
          customExpenseCategories:
            Array.isArray(sData.expense_categories) && sData.expense_categories.length > 0
              ? sData.expense_categories
              : [...defaultSettings.customExpenseCategories],
          customIncomeSources:
            Array.isArray(sData.income_sources) && sData.income_sources.length > 0
              ? sData.income_sources
              : [...defaultSettings.customIncomeSources],
          widgets: mergeWidgets(sData.dashboard_widgets, defaultSettings.widgets)
        };
      } else {
        nextSettings = {
          ...nextSettings,
          currency: resolvedCurrency
        };
      }
    } else {
      // Query failed: preserve previously hydrated regional preferences
      nextSettings = {
        ...nextSettings,
        currency: memoryState.settings.currency,
        dateFormat: memoryState.settings.dateFormat,
        weekStartDay: memoryState.settings.weekStartDay,
        customExpenseCategories: [...memoryState.settings.customExpenseCategories],
        customIncomeSources: [...memoryState.settings.customIncomeSources],
        widgets: memoryState.settings.widgets.map(w => ({ ...w }))
      };
    }

    if (profileRes.ok) {
      if (profileRes.data) {
        nextSettings = {
          ...nextSettings,
          profile: {
            ...nextSettings.profile,
            name: profileRes.data.display_name ?? defaultSettings.profile.name,
            avatarUrl: isSafeExternalUrl(profileRes.data.avatar_url)
          }
        };
      }
    } else {
      nextSettings = {
        ...nextSettings,
        profile: { ...memoryState.settings.profile }
      };
    }

    if (salaryConfigRes.ok) {
      if (salaryConfigRes.data) {
        nextSettings = {
          ...nextSettings,
          salaryConfig: mapSalaryConfigRow(salaryConfigRes.data, {
            ...defaultSettings.salaryConfig,
            currency: resolvedCurrency
          })
        };
      } else {
        nextSettings = {
          ...nextSettings,
          salaryConfig: {
            ...defaultSettings.salaryConfig,
            currency: resolvedCurrency
          }
        };
      }
    } else {
      nextSettings = {
        ...nextSettings,
        salaryConfig: {
          ...memoryState.settings.salaryConfig,
          ...(settingsRes.ok ? { currency: resolvedCurrency } : {})
        }
      };
    }

    memoryState.settings = nextSettings;
    memoryState.fetchErrors = partialErrors;
    hydratedUserId = userId;
    isHydrating = false;
    if (partialErrors.length > 0 && import.meta.env?.DEV) {
      console.warn('Partial errors during fetchAllUserData:', partialErrors.map(e => e.table));
    }

    notifyListeners();
    return { partialErrors, stale: false };
      } finally {
        if (inFlightFetchAll?.seq === mySeq) {
          inFlightFetchAll = null;
        }
        if (mySeq === fetchSequence) {
          isHydrating = false;
        }
      }
    })();

    inFlightFetchAll = { userId, seq: mySeq, promise: runFetch };
    return runFetch;
  },

  /**
   * Reset local state on user sign out / user switch
   */
  clearUserData() {
    fetchSequence += 1;
    activeUserId = null;
    hydratedUserId = null;
    isHydrating = false;
    inFlightFetchAll = null;
    legacyNoteLinkedExpenseIds.clear();
    memoryState.expenses = [];
    memoryState.incomes = [];
    memoryState.attendance = [];
    memoryState.savingsGoals = [];
    memoryState.savingsTransactions = [];
    memoryState.salaryPayouts = [];
    memoryState.debts = [];
    memoryState.debtRepayments = [];
    memoryState.goals = [];
    memoryState.fetchErrors = [];
    memoryState.settings = createDefaultSettings();
    notifyListeners();
  },

  // USER SETTINGS
  getSettings(): UserSettings {
    if (cachedSettingsSource !== memoryState.settings || !cachedSettingsSnapshot) {
      cachedSettingsSource = memoryState.settings;
      cachedSettingsSnapshot = {
        ...memoryState.settings,
        profile: {
          ...memoryState.settings.profile
        },
        salaryConfig: {
          ...memoryState.settings.salaryConfig
        },
        widgets: memoryState.settings.widgets.map(w => ({ ...w })),
        customExpenseCategories: [...memoryState.settings.customExpenseCategories],
        customIncomeSources: [...memoryState.settings.customIncomeSources]
      };
    }
    return cachedSettingsSnapshot;
  },

  saveSettings(settings: UserSettings) {
    memoryState.settings = {
      ...createDefaultSettings(),
      ...settings,
      profile: {
        ...DEFAULT_USER_SETTINGS.profile,
        ...(settings.profile || {})
      },
      salaryConfig: {
        ...DEFAULT_USER_SETTINGS.salaryConfig,
        ...(settings.salaryConfig || {})
      }
    };
    notifyListeners();
  },

  async persistSettingsBundle(bundle: SettingsBundleInput): Promise<void> {
    const isUnconfiguredSalary =
      bundle.salaryConfig.isConfigured === false &&
      bundle.salaryConfig.dailyBaseSalary === undefined &&
      bundle.salaryConfig.standardWorkingHours === undefined &&
      bundle.salaryConfig.extraHourRate === undefined &&
      !bundle.salaryConfig.addonEnabled &&
      (bundle.salaryConfig.addonSalary ?? 0) === 0 &&
      !bundle.salaryConfig.overtimeEnabled;

    const resolvedAddonSalary =
      bundle.salaryConfig.addonSalary !== undefined ? bundle.salaryConfig.addonSalary : 0;
    const resolvedExtraHourRate =
      bundle.salaryConfig.extraHourRate !== undefined ? bundle.salaryConfig.extraHourRate : 0;

    if (!isUnconfiguredSalary) {
      if (
        typeof bundle.salaryConfig.dailyBaseSalary !== 'number' ||
        !Number.isFinite(bundle.salaryConfig.dailyBaseSalary) ||
        bundle.salaryConfig.dailyBaseSalary < 0
      ) {
        throw new Error('Daily base salary is required and cannot be negative.');
      }
      if (!Number.isFinite(resolvedAddonSalary) || resolvedAddonSalary < 0) {
        throw new Error('Add-on salary cannot be negative.');
      }
      if (
        typeof bundle.salaryConfig.standardWorkingHours !== 'number' ||
        !Number.isFinite(bundle.salaryConfig.standardWorkingHours) ||
        bundle.salaryConfig.standardWorkingHours <= 0
      ) {
        throw new Error('Standard working hours must be greater than zero.');
      }
      if (!Number.isFinite(resolvedExtraHourRate) || resolvedExtraHourRate < 0) {
        throw new Error('Extra hour rate cannot be negative.');
      }
    }

    const ctx = await requirePersistenceContext();
    const resolvedCurrency = bundle.currency || memoryState.settings.currency || 'INR';
    const dbWeekStartsOn = toDbWeekStartDay(bundle.weekStartDay);
    const normalizedCategories = bundle.customExpenseCategories
      .map(c => c.trim())
      .filter(Boolean);
    const normalizedSources = bundle.customIncomeSources
      .map(s => s.trim())
      .filter(Boolean);

    const normalizedSalaryConfig: SalaryConfig = isUnconfiguredSalary
      ? {
          ...DEFAULT_USER_SETTINGS.salaryConfig,
          currency: resolvedCurrency,
          isConfigured: false
        }
      : {
          dailyBaseSalary: bundle.salaryConfig.dailyBaseSalary,
          addonSalary: resolvedAddonSalary,
          addonEnabled: Boolean(bundle.salaryConfig.addonEnabled),
          standardWorkingHours: bundle.salaryConfig.standardWorkingHours,
          extraHourRate: resolvedExtraHourRate,
          overtimeEnabled: Boolean(bundle.salaryConfig.overtimeEnabled),
          isConfigured: true,
          currency: resolvedCurrency
        };

    if (ctx.mode === 'supabase') {
      const now = new Date().toISOString();
      const succeededSections: SettingsBundleSection[] = [];
      const failedSections: Array<{ section: SettingsBundleSection; label: string; message: string }> = [];

      let nextSettings = {
        ...memoryState.settings,
        profile: { ...memoryState.settings.profile },
        salaryConfig: { ...memoryState.settings.salaryConfig }
      };

      // 1. Update public.user_settings
      try {
        const { data: settingsData, error: settingsError } = await ctx.client
          .from('user_settings')
          .upsert(
            {
              user_id: ctx.user.id,
              currency_code: resolvedCurrency,
              date_format: bundle.dateFormat,
              week_starts_on: dbWeekStartsOn,
              expense_categories: normalizedCategories,
              income_sources: normalizedSources,
              dashboard_widgets: bundle.widgets,
              updated_at: now
            },
            { onConflict: 'user_id' }
          )
          .select()
          .single();

        if (settingsError || !settingsData) {
          failedSections.push({
            section: 'user_settings',
            label: 'Regional & Category Preferences',
            message: sanitizeDatabaseErrorMessage(settingsError, 'Could not save user settings')
          });
        } else {
          succeededSections.push('user_settings');
          nextSettings = {
            ...nextSettings,
            currency: (settingsData.currency_code as CurrencyCode) || resolvedCurrency,
            dateFormat: (settingsData.date_format as DateFormat) || bundle.dateFormat,
            weekStartDay: fromDbWeekStartDay(settingsData.week_starts_on, bundle.weekStartDay),
            customExpenseCategories: Array.isArray(settingsData.expense_categories)
              ? settingsData.expense_categories
              : normalizedCategories,
            customIncomeSources: Array.isArray(settingsData.income_sources)
              ? settingsData.income_sources
              : normalizedSources,
            widgets: mergeWidgets(settingsData.dashboard_widgets, bundle.widgets)
          };
        }
      } catch (err) {
        failedSections.push({
          section: 'user_settings',
          label: 'Regional & Category Preferences',
          message: sanitizeDatabaseErrorMessage(err, 'Unexpected error saving user settings')
        });
      }

      // 2. Update public.salary_configs only when salary values are explicitly configured
      if (!isUnconfiguredSalary) {
        try {
          const { data: salaryData, error: salaryError } = await ctx.client
            .from('salary_configs')
            .upsert(
              {
                user_id: ctx.user.id,
                daily_base_salary: normalizedSalaryConfig.dailyBaseSalary,
                addon_salary: normalizedSalaryConfig.addonSalary,
                addon_enabled: normalizedSalaryConfig.addonEnabled,
                standard_hours: normalizedSalaryConfig.standardWorkingHours,
                extra_hour_rate: normalizedSalaryConfig.extraHourRate,
                overtime_enabled: normalizedSalaryConfig.overtimeEnabled,
                currency_code: resolvedCurrency,
                updated_at: now
              },
              { onConflict: 'user_id' }
            )
            .select('id, user_id, daily_base_salary, addon_salary, addon_enabled, standard_hours, extra_hour_rate, overtime_enabled, currency_code, created_at, updated_at')
            .single();

          if (salaryError || !salaryData) {
            failedSections.push({
              section: 'salary_configs',
              label: 'Salary Configuration',
              message: sanitizeDatabaseErrorMessage(salaryError, 'Could not save salary configuration')
            });
          } else {
            succeededSections.push('salary_configs');
            nextSettings = {
              ...nextSettings,
              salaryConfig: mapSalaryConfigRow(salaryData, normalizedSalaryConfig)
            };
          }
        } catch (err) {
          failedSections.push({
            section: 'salary_configs',
            label: 'Salary Configuration',
            message: sanitizeDatabaseErrorMessage(err, 'Unexpected error saving salary configuration')
          });
        }
      } else {
        nextSettings = {
          ...nextSettings,
          salaryConfig: normalizedSalaryConfig
        };
      }

      // 3. Update public.profiles if displayName provided (non-fatal when profile row does not yet exist)
      if (bundle.displayName !== undefined) {
        const trimmedName = bundle.displayName.trim();
        try {
          const { data: profData, error: profError } = await ctx.client
            .from('profiles')
            .update({
              display_name: trimmedName,
              updated_at: now
            })
            .eq('id', ctx.user.id)
            .select('id, display_name, avatar_url')
            .maybeSingle();

          if (profError) {
            failedSections.push({
              section: 'profiles',
              label: 'Profile Display Name',
              message: sanitizeDatabaseErrorMessage(profError, 'Could not update profile display name')
            });
          } else {
            succeededSections.push('profiles');
            nextSettings = {
              ...nextSettings,
              profile: {
                ...nextSettings.profile,
                name:
                  profData?.display_name !== undefined && profData?.display_name !== null
                    ? profData.display_name
                    : trimmedName
              }
            };
          }
        } catch (err) {
          failedSections.push({
            section: 'profiles',
            label: 'Profile Display Name',
            message: sanitizeDatabaseErrorMessage(err, 'Unexpected error updating profile display name')
          });
        }
      }

      // Reconcile ONLY the operations that actually succeeded in Supabase
      if (succeededSections.length > 0) {
        memoryState.settings = nextSettings;
        notifyListeners();
      }

      if (failedSections.length > 0) {
        throw new SettingsBundleSaveError(succeededSections, failedSections);
      }
      return;
    }

    memoryState.settings = {
      ...memoryState.settings,
      profile: {
        ...memoryState.settings.profile,
        name: bundle.displayName !== undefined ? bundle.displayName.trim() : memoryState.settings.profile.name
      },
      currency: resolvedCurrency,
      dateFormat: bundle.dateFormat,
      weekStartDay: bundle.weekStartDay,
      customExpenseCategories: normalizedCategories,
      customIncomeSources: normalizedSources,
      widgets: bundle.widgets.map(w => ({ ...w })),
      salaryConfig: normalizedSalaryConfig
    };
    notifyListeners();
  },

  async persistSalaryConfig(salaryConfig: SalaryConfig): Promise<void> {
    if (
      typeof salaryConfig.dailyBaseSalary !== 'number' ||
      !Number.isFinite(salaryConfig.dailyBaseSalary) ||
      salaryConfig.dailyBaseSalary < 0
    ) {
      throw new Error('Daily base salary is required and cannot be negative.');
    }
    const resolvedAddonSalary =
      salaryConfig.addonSalary !== undefined ? salaryConfig.addonSalary : 0;
    if (!Number.isFinite(resolvedAddonSalary) || resolvedAddonSalary < 0) {
      throw new Error('Add-on salary cannot be negative.');
    }
    if (
      typeof salaryConfig.standardWorkingHours !== 'number' ||
      !Number.isFinite(salaryConfig.standardWorkingHours) ||
      salaryConfig.standardWorkingHours <= 0
    ) {
      throw new Error('Standard working hours must be greater than zero.');
    }
    const resolvedExtraHourRate =
      salaryConfig.extraHourRate !== undefined ? salaryConfig.extraHourRate : 0;
    if (!Number.isFinite(resolvedExtraHourRate) || resolvedExtraHourRate < 0) {
      throw new Error('Extra hour rate cannot be negative.');
    }

    const resolvedCurrency = salaryConfig.currency || memoryState.settings.currency || 'INR';
    const normalizedSalaryConfig: SalaryConfig = {
      dailyBaseSalary: salaryConfig.dailyBaseSalary,
      addonSalary: resolvedAddonSalary,
      addonEnabled: Boolean(salaryConfig.addonEnabled),
      standardWorkingHours: salaryConfig.standardWorkingHours,
      extraHourRate: resolvedExtraHourRate,
      overtimeEnabled: Boolean(salaryConfig.overtimeEnabled),
      isConfigured: true,
      currency: resolvedCurrency
    };

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const dedupKey = `salary_config:upsert:${ctx.user.id}:${JSON.stringify(normalizedSalaryConfig)}`;
      return apiOptimization.coalesce(dedupKey, async () => {
        const payload = {
          user_id: ctx.user.id,
          currency_code: resolvedCurrency,
          daily_base_salary: normalizedSalaryConfig.dailyBaseSalary,
          addon_salary: normalizedSalaryConfig.addonSalary,
          addon_enabled: normalizedSalaryConfig.addonEnabled,
          standard_hours: normalizedSalaryConfig.standardWorkingHours,
          extra_hour_rate: normalizedSalaryConfig.extraHourRate,
          overtime_enabled: normalizedSalaryConfig.overtimeEnabled,
          updated_at: new Date().toISOString()
        };

        const { data, error } = await ctx.client
          .from('salary_configs')
          .upsert(payload, { onConflict: 'user_id' })
          .select('id, user_id, daily_base_salary, addon_salary, addon_enabled, standard_hours, extra_hour_rate, overtime_enabled, currency_code, created_at, updated_at')
          .single();

        if (error || !data) {
          throw new Error(sanitizeDatabaseErrorMessage(error, 'Database error: Could not save salary configuration.'));
        }

        memoryState.settings = {
          ...memoryState.settings,
          salaryConfig: mapSalaryConfigRow(data, normalizedSalaryConfig)
        };
        notifyListeners();
      });
    }

    memoryState.settings = {
      ...memoryState.settings,
      salaryConfig: {
        ...memoryState.settings.salaryConfig,
        ...normalizedSalaryConfig
      }
    };

    notifyListeners();
  },

  // GOALS (Backed by public.goals)
  getGoals(): Goal[] {
    return getCachedGoals();
  },

  saveGoals(goals: Goal[]) {
    memoryState.goals = [...goals];
    notifyListeners();
  },

  async addGoal(goal: CreateGoalInput): Promise<Goal> {
    if (!goal.title || !goal.title.trim()) {
      throw new Error('Goal title is required.');
    }
    if (goal.targetAmount === undefined || goal.targetAmount === null) {
      throw new Error('Target amount is required and must be greater than zero.');
    }
    if (!Number.isFinite(goal.targetAmount) || goal.targetAmount <= 0) {
      throw new Error('Target amount must be greater than zero.');
    }
    const initialDeposit = goal.initialDeposit === undefined ? 0 : goal.initialDeposit;
    if (!Number.isFinite(initialDeposit) || initialDeposit < 0) {
      throw new Error('Initial deposit cannot be negative.');
    }

    const dbPriority = toDbGoalPriority(goal.priority === undefined ? 'Medium' : goal.priority);
    const uiPriority = fromDbGoalPriority(dbPriority);

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const { data: rpcData, error: rpcError } = await ctx.client.rpc('xos_create_goal_with_savings', {
        p_user_id: ctx.user.id,
        p_title: goal.title.trim(),
        p_description: goal.description?.trim() || '',
        p_category: goal.category,
        p_target_amount: goal.targetAmount,
        p_target_date: goal.targetDate || null,
        p_priority: dbPriority,
        p_initial_deposit: initialDeposit
      });

      if (rpcError) {
        throw new Error(sanitizeDatabaseErrorMessage(rpcError, 'Database error: Could not create goal with connected savings.'));
      }

      const { goalId, savingsGoalId } = extractCreatedGoalIds(rpcData);

      const [goalRes, sgRes, txRes] = await Promise.all([
        ctx.client
          .from('goals')
          .select('*')
          .eq('id', goalId)
          .eq('user_id', ctx.user.id)
          .single(),
        ctx.client
          .from('savings_goals')
          .select('*')
          .eq('id', savingsGoalId)
          .eq('user_id', ctx.user.id)
          .single(),
        initialDeposit > 0
          ? ctx.client
              .from('savings_transactions')
              .select('*')
              .eq('savings_goal_id', savingsGoalId)
              .eq('user_id', ctx.user.id)
              .order('transaction_date', { ascending: false })
          : Promise.resolve({ data: [], error: null })
      ]);

      if (goalRes.error || !goalRes.data) {
        throw new Error(sanitizeDatabaseErrorMessage(goalRes.error, 'Goal created, but the created goal record could not be retrieved.'));
      }
      if (sgRes.error || !sgRes.data) {
        throw new Error(sanitizeDatabaseErrorMessage(sgRes.error, 'Goal created, but the connected savings account could not be retrieved.'));
      }

      const confirmedGoal = mapGoalRow(goalRes.data);
      if (confirmedGoal.savingsGoalId !== savingsGoalId) {
        throw new Error('Created goal savings_goal_id does not match the returned savings account ID.');
      }
      const confirmedSavingsGoal = mapSavingsGoalRow(sgRes.data);

      memoryState.goals = [confirmedGoal, ...memoryState.goals.filter(g => g.id !== confirmedGoal.id)];
      memoryState.savingsGoals = [
        confirmedSavingsGoal,
        ...memoryState.savingsGoals.filter(sg => sg.id !== confirmedSavingsGoal.id)
      ];

      if (!txRes.error && Array.isArray(txRes.data) && txRes.data.length > 0) {
        const mappedTxs = txRes.data.map(mapSavingsTxRow);
        const txIds = new Set(mappedTxs.map(t => t.id));
        memoryState.savingsTransactions = [
          ...mappedTxs,
          ...memoryState.savingsTransactions.filter(t => !txIds.has(t.id))
        ];
      }

      notifyListeners();
      return confirmedGoal;
    }

    const today = getTodayString();
    const suffix = Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    const newSgId = 'sg_' + suffix;
    const initialPct = Math.min(100, Math.round((initialDeposit / goal.targetAmount) * 100));
    const isCompleted = initialDeposit >= goal.targetAmount;

    const newSavingsGoal: SavingsGoal = {
      id: newSgId,
      name: goal.title.trim(),
      targetAmount: goal.targetAmount,
      currentAmount: initialDeposit,
      targetDate: goal.targetDate || undefined,
      description: goal.description?.trim() || '',
      createdAt: today
    };

    const newGoal: Goal = {
      id: 'g_' + suffix,
      title: goal.title.trim(),
      description: goal.description?.trim() || '',
      category: goal.category,
      targetAmount: goal.targetAmount,
      targetDate: goal.targetDate || undefined,
      priority: uiPriority,
      status: isCompleted ? 'Completed' : initialDeposit > 0 ? 'In Progress' : 'Not Started',
      progressPercentage: initialPct,
      completedAt: isCompleted ? today : undefined,
      createdAt: today,
      savingsGoalId: newSgId
    };

    memoryState.savingsGoals = [newSavingsGoal, ...memoryState.savingsGoals];
    memoryState.goals = [newGoal, ...memoryState.goals];
    if (initialDeposit > 0) {
      memoryState.savingsTransactions = [
        {
          id: 'stx_' + suffix,
          savingsGoalId: newSgId,
          amount: initialDeposit,
          type: 'deposit',
          date: today,
          note: 'Initial deposit',
          createdAt: today
        },
        ...memoryState.savingsTransactions
      ];
    }
    notifyListeners();
    return newGoal;
  },

  async updateGoal(id: string, updates: UpdateGoalInput): Promise<void> {
    if ('targetAmount' in updates) {
      if (
        updates.targetAmount === undefined ||
        updates.targetAmount === null ||
        !Number.isFinite(updates.targetAmount) ||
        updates.targetAmount <= 0
      ) {
        throw new Error('Target amount must be greater than zero.');
      }
    }

    const dbStatus = updates.status !== undefined ? toDbGoalStatus(updates.status) : undefined;
    const dbPriority = updates.priority !== undefined ? toDbGoalPriority(updates.priority) : undefined;
    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const dbPayload: Record<string, any> = {};
      if (updates.title !== undefined) dbPayload.title = updates.title.trim();
      if (updates.description !== undefined) dbPayload.description = updates.description;
      if (updates.category !== undefined) dbPayload.category = updates.category;
      if (dbPriority !== undefined) dbPayload.priority = dbPriority;
      if (dbStatus !== undefined) dbPayload.status = dbStatus;
      if (updates.targetAmount !== undefined) dbPayload.target_amount = updates.targetAmount;
      if (updates.targetDate !== undefined) dbPayload.target_date = updates.targetDate || null;

      if (Object.keys(dbPayload).length === 0) {
        return;
      }

      const { data, error } = await ctx.client
        .from('goals')
        .update(dbPayload)
        .eq('id', id)
        .eq('user_id', ctx.user.id)
        .select()
        .single();

      if (error || !data) {
        throw new Error(sanitizeDatabaseErrorMessage(error, 'Database error: Could not update goal.'));
      }

      const confirmed = mapGoalRow(data);
      memoryState.goals = memoryState.goals.map(g => (g.id === id ? confirmed : g));

      if (confirmed.savingsGoalId) {
        const sgPayload: Record<string, any> = {};
        if (updates.title !== undefined) sgPayload.name = updates.title.trim();
        if (updates.description !== undefined) sgPayload.notes = updates.description ? updates.description.trim() : null;
        if (updates.targetAmount !== undefined) sgPayload.target_amount = updates.targetAmount;
        if (updates.targetDate !== undefined) sgPayload.target_date = updates.targetDate || null;

        let mappedSg: SavingsGoal | null = null;
        if (Object.keys(sgPayload).length > 0) {
          sgPayload.updated_at = new Date().toISOString();
          const { data: updatedSg } = await ctx.client
            .from('savings_goals')
            .update(sgPayload)
            .eq('id', confirmed.savingsGoalId)
            .eq('user_id', ctx.user.id)
            .select()
            .maybeSingle();
          if (updatedSg) {
            mappedSg = mapSavingsGoalRow(updatedSg);
          }
        }

        if (!mappedSg) {
          const { data: refreshedSg, error: sgError } = await ctx.client
            .from('savings_goals')
            .select('*')
            .eq('id', confirmed.savingsGoalId)
            .eq('user_id', ctx.user.id)
            .maybeSingle();

          if (!sgError && refreshedSg) {
            mappedSg = mapSavingsGoalRow(refreshedSg);
          }
        }

        if (mappedSg) {
          const finalSg: SavingsGoal = {
            ...mappedSg,
            ...(updates.title !== undefined ? { name: updates.title.trim() } : {}),
            ...(updates.targetAmount !== undefined ? { targetAmount: updates.targetAmount } : {}),
            ...(updates.targetDate !== undefined ? { targetDate: updates.targetDate || undefined } : {}),
            ...(updates.description !== undefined ? { description: updates.description || '' } : {})
          };
          memoryState.savingsGoals = memoryState.savingsGoals.map(sg =>
            sg.id === finalSg.id ? finalSg : sg
          );
        }
      }

      notifyListeners();
      return;
    }

    const targetGoal = memoryState.goals.find(g => g.id === id);
    if (!targetGoal) {
      return;
    }

    if (targetGoal.savingsGoalId) {
      memoryState.savingsGoals = memoryState.savingsGoals.map(sg => {
        if (sg.id !== targetGoal.savingsGoalId) return sg;
        return {
          ...sg,
          name: updates.title !== undefined ? updates.title.trim() : sg.name,
          targetAmount: updates.targetAmount !== undefined ? updates.targetAmount : sg.targetAmount,
          targetDate: 'targetDate' in updates ? updates.targetDate : sg.targetDate,
          description: updates.description !== undefined ? updates.description : sg.description
        };
      });
    }

    const linkedSg = memoryState.savingsGoals.find(sg => sg.id === targetGoal.savingsGoalId);
    const nextTarget = updates.targetAmount ?? targetGoal.targetAmount ?? 0;
    const savedAmount = linkedSg?.currentAmount || 0;
    const recomputedProgress = nextTarget > 0 ? Math.min(100, Math.round((savedAmount / nextTarget) * 100)) : 0;

    memoryState.goals = memoryState.goals.map(g =>
      g.id === id
        ? {
            ...g,
            ...updates,
            title: updates.title !== undefined ? updates.title.trim() : g.title,
            progressPercentage: recomputedProgress
          }
        : g
    );
    notifyListeners();
  },

  async deleteGoal(id: string): Promise<void> {
    const goalId = String(id || '').trim();
    if (!goalId) {
      throw new Error('Goal ID is required to archive a goal.');
    }

    const matchingGoal = memoryState.goals.find(g => g.id === goalId);
    if (!matchingGoal && memoryState.savingsGoals.some(sg => sg.id === goalId)) {
      throw new Error('Invalid archive target: received a savings account ID instead of the goal ID.');
    }
    if (matchingGoal?.status === 'Archived') {
      throw new Error('Goal not found or already archived');
    }

    const existingPromise = archiveGoalInFlightPromises.get(goalId);
    if (existingPromise) {
      return existingPromise;
    }

    const archivePromise = (async () => {
      const ctx = await requirePersistenceContext();

      if (ctx.mode === 'supabase') {
        const { data: rpcData, error: rpcError } = await ctx.client.rpc('xos_archive_goal', {
          p_goal_id: goalId
        });

        if (rpcError) {
          throw new Error(sanitizeDatabaseErrorMessage(rpcError, 'Database error: Could not archive goal.'));
        }

        validateArchiveGoalRpcResponse(rpcData);

        apiOptimization.invalidateCache();

        // Mark Goal as archived/cancelled while preserving linked Savings account & transactions
        memoryState.goals = memoryState.goals.map(g =>
          g.id === goalId ? { ...g, status: 'Archived' } : g
        );
        notifyListeners();

        // Refetch and synchronize Goals, Savings, and Dashboard state from authoritative Supabase tables
        await this.fetchAllUserData(ctx.user.id);
        return;
      }

      // Local/Demo mode: mark Goal archived while preserving linked savings account & transaction history
      memoryState.goals = memoryState.goals.map(g =>
        g.id === goalId ? { ...g, status: 'Archived' } : g
      );
      notifyListeners();
    })().finally(() => {
      archiveGoalInFlightPromises.delete(goalId);
    });

    archiveGoalInFlightPromises.set(goalId, archivePromise);
    return archivePromise;
  },

  // EXPENSES (Backed by public.expenses)
  getExpenses(): Expense[] {
    return getCachedExpenses();
  },

  saveExpenses(expenses: Expense[]) {
    memoryState.expenses = [...expenses];
    notifyListeners();
  },

  async addExpense(expense: Omit<Expense, 'id' | 'createdAt'>): Promise<Expense> {
    if (!Number.isFinite(expense.amount) || expense.amount <= 0) {
      throw new Error('Expense amount must be greater than zero.');
    }
    const isRecurring = Boolean(expense.isRecurring);
    const dbRecurrenceFrequency = toDbRecurrenceFrequency(isRecurring, expense.recurringFrequency);
    const normalizedUiFrequency: RecurrenceFrequency = isRecurring
      ? fromDbRecurrenceFrequency(true, dbRecurrenceFrequency)
      : 'None';

    const currentTime = new Date().toTimeString().slice(0, 5);
    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const formattedTime = normalizeDbTime(expense.time || currentTime);

      const { data, error } = await ctx.client
        .from('expenses')
        .insert({
          user_id: ctx.user.id,
          title: expense.title.trim(),
          amount: expense.amount,
          category: expense.category,
          expense_date: expense.date,
          expense_time: formattedTime,
          payment_method: expense.paymentMethod || 'Cash',
          notes: expense.notes?.trim() ? expense.notes.trim() : null,
          is_recurring: isRecurring,
          recurrence_frequency: dbRecurrenceFrequency,
          recurrence_end_date: isRecurring && expense.recurrenceEndDate ? expense.recurrenceEndDate : null
        })
        .select()
        .single();

      if (error || !data) {
        throw new Error(sanitizeDatabaseErrorMessage(error, 'Database error: Could not save expense.'));
      }

      const confirmedExpense = mapExpenseRow(data);
      if (!confirmedExpense.time) {
        confirmedExpense.time = expense.time || currentTime;
      }

      memoryState.expenses = [confirmedExpense, ...memoryState.expenses];
      notifyListeners();
      return confirmedExpense;
    }

    const newExpense: Expense = {
      ...expense,
      isRecurring,
      recurringFrequency: normalizedUiFrequency,
      recurrenceEndDate: isRecurring ? expense.recurrenceEndDate : undefined,
      time: expense.time || currentTime,
      id: 'e_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      createdAt: getTodayString()
    };
    memoryState.expenses = [newExpense, ...memoryState.expenses];
    notifyListeners();
    return newExpense;
  },

  async updateExpense(id: string, updates: Partial<Expense>): Promise<void> {
    if (updates.amount !== undefined && (!Number.isFinite(updates.amount) || updates.amount <= 0)) {
      throw new Error('Expense amount must be greater than zero.');
    }

    const existing = memoryState.expenses.find(e => e.id === id);
    if (
      existing?.debtRepaymentId &&
      memoryState.debtRepayments.some(r => r.id === existing.debtRepaymentId)
    ) {
      throw new Error('This expense entry is synced with a Debt Repayment. Delete or manage the repayment in the Debt module instead.');
    }
    let resolvedRecurrencePayload: {
      is_recurring?: boolean;
      recurrence_frequency?: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;
      recurrence_end_date?: string | null;
    } = {};

    if (updates.isRecurring === false) {
      resolvedRecurrencePayload = {
        is_recurring: false,
        recurrence_frequency: null,
        recurrence_end_date: null
      };
    } else if (updates.isRecurring === true) {
      const freq = toDbRecurrenceFrequency(
        true,
        updates.recurringFrequency ?? existing?.recurringFrequency
      );
      resolvedRecurrencePayload = {
        is_recurring: true,
        recurrence_frequency: freq
      };
    } else if (updates.recurringFrequency !== undefined) {
      if (updates.recurringFrequency === 'None') {
        resolvedRecurrencePayload = {
          is_recurring: false,
          recurrence_frequency: null,
          recurrence_end_date: null
        };
      } else if (existing ? existing.isRecurring : true) {
        resolvedRecurrencePayload = {
          recurrence_frequency: toDbRecurrenceFrequency(true, updates.recurringFrequency)
        };
      } else {
        resolvedRecurrencePayload = {
          recurrence_frequency: null
        };
      }
    }

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const dbPayload: Record<string, any> = { ...resolvedRecurrencePayload };
      if (updates.title !== undefined) dbPayload.title = updates.title.trim();
      if (updates.amount !== undefined) dbPayload.amount = updates.amount;
      if (updates.category !== undefined) dbPayload.category = updates.category;
      if (updates.date !== undefined) dbPayload.expense_date = updates.date;
      if (updates.time !== undefined) {
        dbPayload.expense_time = normalizeDbTime(updates.time);
      }
      if (updates.paymentMethod !== undefined) dbPayload.payment_method = updates.paymentMethod;
      if (updates.notes !== undefined) dbPayload.notes = updates.notes?.trim() ? updates.notes.trim() : null;
      if (updates.recurrenceEndDate !== undefined && resolvedRecurrencePayload.is_recurring !== false) {
        dbPayload.recurrence_end_date = updates.recurrenceEndDate || null;
      }

      if (Object.keys(dbPayload).length === 0) {
        return;
      }

      const { data, error } = await ctx.client
        .from('expenses')
        .update(dbPayload)
        .eq('id', id)
        .eq('user_id', ctx.user.id)
        .select()
        .single();

      if (error || !data) {
        throw new Error(sanitizeDatabaseErrorMessage(error, 'Database error: Could not update expense.'));
      }

      const confirmed = mapExpenseRow(data);
      memoryState.expenses = memoryState.expenses.map(e => (e.id === id ? confirmed : e));
      notifyListeners();
      return;
    }

    memoryState.expenses = memoryState.expenses.map(e => (e.id === id ? { ...e, ...updates } : e));
    notifyListeners();
  },

  async deleteExpense(id: string): Promise<void> {
    const existing = memoryState.expenses.find(e => e.id === id);
    if (
      existing?.debtRepaymentId &&
      memoryState.debtRepayments.some(r => r.id === existing.debtRepaymentId)
    ) {
      throw new Error('This expense entry is synced with a Debt Repayment. Delete the repayment in the Debt module instead.');
    }

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const { data, error } = await ctx.client
        .from('expenses')
        .delete()
        .eq('id', id)
        .eq('user_id', ctx.user.id)
        .select('id');

      if (error) {
        throw new Error(sanitizeDatabaseErrorMessage(error, 'Database error: Could not delete expense.'));
      }
      if (!data || data.length === 0) {
        throw new Error('Expense record not found or could not be deleted.');
      }
    }

    memoryState.expenses = memoryState.expenses.filter(e => e.id !== id);
    notifyListeners();
  },

  // INCOMES (Backed by public.incomes)
  getIncomes(): Income[] {
    return getCachedIncomes();
  },

  saveIncomes(incomes: Income[]) {
    memoryState.incomes = [...incomes];
    notifyListeners();
  },

  async addIncome(income: Omit<Income, 'id' | 'createdAt'>): Promise<Income> {
    if (!income.title || !income.title.trim()) {
      throw new Error('Income title is required.');
    }
    if (!Number.isFinite(income.amount) || income.amount <= 0) {
      throw new Error('Income amount must be greater than zero.');
    }
    const currentTime = new Date().toTimeString().slice(0, 5);
    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const formattedTime = normalizeDbTime(income.time || currentTime);

      const { data, error } = await ctx.client
        .from('incomes')
        .insert({
          user_id: ctx.user.id,
          title: income.title.trim(),
          amount: income.amount,
          source: income.source,
          income_date: income.date,
          income_time: formattedTime,
          notes: income.notes?.trim() ? income.notes.trim() : null,
          salary_payout_id: income.salaryPayoutId || null
        })
        .select()
        .single();

      if (error || !data) {
        throw new Error(sanitizeDatabaseErrorMessage(error, 'Database error: Could not save income.'));
      }

      const confirmedIncome = mapIncomeRow(data);
      if (!confirmedIncome.time) {
        confirmedIncome.time = income.time || currentTime;
      }

      memoryState.incomes = [confirmedIncome, ...memoryState.incomes];
      notifyListeners();
      return confirmedIncome;
    }

    const newIncome: Income = {
      ...income,
      time: income.time || currentTime,
      id: 'i_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      createdAt: getTodayString()
    };
    memoryState.incomes = [newIncome, ...memoryState.incomes];
    notifyListeners();
    return newIncome;
  },

  async updateIncome(id: string, updates: Partial<Income>): Promise<void> {
    if (updates.amount !== undefined && (!Number.isFinite(updates.amount) || updates.amount <= 0)) {
      throw new Error('Income amount must be greater than zero.');
    }

    const existingIncome = memoryState.incomes.find(i => i.id === id);
    if (
      existingIncome?.salaryPayoutId &&
      memoryState.salaryPayouts.some(p => p.id === existingIncome.salaryPayoutId)
    ) {
      throw new Error('This income entry is synced with a Salary Payout. Update or replace the payout in the Salary module instead.');
    }

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const dbPayload: Record<string, any> = {};
      if (updates.title !== undefined) dbPayload.title = updates.title.trim();
      if (updates.amount !== undefined) dbPayload.amount = updates.amount;
      if (updates.source !== undefined) dbPayload.source = updates.source;
      if (updates.date !== undefined) dbPayload.income_date = updates.date;
      if (updates.time !== undefined) {
        dbPayload.income_time = normalizeDbTime(updates.time);
      }
      if (updates.notes !== undefined) dbPayload.notes = updates.notes?.trim() ? updates.notes.trim() : null;

      if (Object.keys(dbPayload).length === 0) {
        return;
      }

      const { data, error } = await ctx.client
        .from('incomes')
        .update(dbPayload)
        .eq('id', id)
        .eq('user_id', ctx.user.id)
        .select()
        .single();

      if (error || !data) {
        throw new Error(sanitizeDatabaseErrorMessage(error, 'Database error: Could not update income.'));
      }

      const confirmed = mapIncomeRow(data);
      memoryState.incomes = memoryState.incomes.map(i => (i.id === id ? confirmed : i));
      notifyListeners();
      return;
    }

    memoryState.incomes = memoryState.incomes.map(i => (i.id === id ? { ...i, ...updates } : i));
    notifyListeners();
  },

  async deleteIncome(id: string): Promise<void> {
    const existingIncome = memoryState.incomes.find(i => i.id === id);
    if (
      existingIncome?.salaryPayoutId &&
      memoryState.salaryPayouts.some(p => p.id === existingIncome.salaryPayoutId)
    ) {
      throw new Error('This income entry is synced with a Salary Payout. Delete the payout in the Salary module instead.');
    }

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const { data, error } = await ctx.client
        .from('incomes')
        .delete()
        .eq('id', id)
        .eq('user_id', ctx.user.id)
        .select('id');

      if (error) {
        throw new Error(sanitizeDatabaseErrorMessage(error, 'Database error: Could not delete income.'));
      }
      if (!data || data.length === 0) {
        throw new Error('Income record not found or could not be deleted.');
      }
    }

    memoryState.incomes = memoryState.incomes.filter(i => i.id !== id);
    notifyListeners();
  },

  // ATTENDANCE (Backed by public.attendance_records)
  getAttendance(): AttendanceRecord[] {
    return getCachedAttendance();
  },

  saveAttendance(records: AttendanceRecord[]) {
    memoryState.attendance = [...records];
    notifyListeners();
  },

  async upsertAttendanceRecord(record: Omit<AttendanceRecord, 'id'> & { id?: string }): Promise<AttendanceRecord> {
    if (!isValidCalendarDateString(record.date)) {
      throw new Error('Please provide a valid attendance date in YYYY-MM-DD format.');
    }
    const istTodayStr = getIstTodayString();
    if (isFutureIstDate(record.date)) {
      throw new Error('Attendance cannot be logged for future dates.');
    }

    if (record.dailyBaseSalary !== undefined && (!Number.isFinite(record.dailyBaseSalary) || record.dailyBaseSalary < 0)) {
      throw new Error('Daily base salary cannot be negative.');
    }
    if (record.addonSalary !== undefined && (!Number.isFinite(record.addonSalary) || record.addonSalary < 0)) {
      throw new Error('Add-on salary cannot be negative.');
    }
    if (record.extraHourRate !== undefined && (!Number.isFinite(record.extraHourRate) || record.extraHourRate < 0)) {
      throw new Error('Extra hour rate cannot be negative.');
    }
    if (record.salaryOverrideAmount !== undefined && (!Number.isFinite(record.salaryOverrideAmount) || record.salaryOverrideAmount < 0)) {
      throw new Error('Salary override amount cannot be negative.');
    }
    if (record.dailyEarnedSalary !== undefined && (!Number.isFinite(record.dailyEarnedSalary) || record.dailyEarnedSalary < 0)) {
      throw new Error('Daily earned salary cannot be negative.');
    }

    const normalizedStatus = fromDbAttendanceStatus(record.status);
    const dbStatus = toDbAttendanceStatus(record.status);
    const salaryConfig = memoryState.settings.salaryConfig;
    const existingRecord =
      memoryState.attendance.find(r => r.date === record.date) ||
      (record.id ? memoryState.attendance.find(r => r.id === record.id) : undefined);

    const effectiveDailyBase =
      record.dailyBaseSalary !== undefined
        ? Number(record.dailyBaseSalary)
        : existingRecord?.dailyBaseSalary !== undefined
          ? existingRecord.dailyBaseSalary
          : (salaryConfig.dailyBaseSalary ?? 0);
    const effectiveAddonSalary =
      record.addonSalary !== undefined
        ? Number(record.addonSalary)
        : existingRecord?.addonSalary !== undefined
          ? existingRecord.addonSalary
          : (salaryConfig.addonSalary ?? 0);
    const effectiveAddonEnabled =
      record.addonEnabled !== undefined
        ? Boolean(record.addonEnabled)
        : existingRecord?.addonEnabled !== undefined
          ? existingRecord.addonEnabled
          : Boolean(salaryConfig.addonEnabled);
    const effectiveExtraRate =
      record.extraHourRate !== undefined
        ? Number(record.extraHourRate)
        : existingRecord?.extraHourRate !== undefined
          ? existingRecord.extraHourRate
          : (salaryConfig.extraHourRate ?? 0);
    const effectiveOvertimeEnabled =
      record.overtimeEnabled !== undefined
        ? Boolean(record.overtimeEnabled)
        : existingRecord?.overtimeEnabled !== undefined
          ? existingRecord.overtimeEnabled
          : Boolean(salaryConfig.overtimeEnabled);

    const requestedOverrideEnabled =
      record.salaryOverrideEnabled !== undefined
        ? Boolean(record.salaryOverrideEnabled)
        : Boolean(existingRecord?.salaryOverrideEnabled);
    const effectiveOverrideEnabled = normalizedStatus === 'Present' && requestedOverrideEnabled;

    let effectiveOverrideAmount: number | undefined;
    if (effectiveOverrideEnabled) {
      const candidateOverride =
        record.salaryOverrideAmount !== undefined
          ? Number(record.salaryOverrideAmount)
          : existingRecord?.salaryOverrideAmount;
      if (candidateOverride === undefined || !Number.isFinite(candidateOverride) || candidateOverride < 0) {
        throw new Error('Manual salary override amount is required and cannot be negative.');
      }
      effectiveOverrideAmount = Number(candidateOverride.toFixed(2));
    }

    let hours =
      normalizedStatus === 'Present'
        ? (record.calculatedHours ?? existingRecord?.calculatedHours ?? 0)
        : 0;
    const rawBreakCandidate = record.breakDurationMinutes ?? existingRecord?.breakDurationMinutes ?? 0;
    const sanitizedBreak =
      normalizedStatus === 'Present' && Number.isFinite(rawBreakCandidate)
        ? Math.max(0, Math.round(rawBreakCandidate))
        : 0;
    if (normalizedStatus === 'Present' && record.checkInTime && record.checkOutTime) {
      hours = calculateWorkingHours(record.checkInTime, record.checkOutTime, sanitizedBreak);
    }

    const dailyRes = calculateDailyEarnedSalary(normalizedStatus, hours, {
      standardWorkingHours: salaryConfig.standardWorkingHours,
      dailyBaseSalary: effectiveDailyBase,
      addonSalary: effectiveAddonSalary,
      addonEnabled: effectiveAddonEnabled,
      extraHourRate: effectiveExtraRate,
      overtimeEnabled: effectiveOvertimeEnabled,
      salaryOverrideEnabled: effectiveOverrideEnabled,
      salaryOverrideAmount: effectiveOverrideAmount
    });

    const effectiveHours = normalizedStatus === 'Present' ? dailyRes.workingHours : 0;
    // Preserve historical extraHours when editing an existing Present record whose hours did not change
    const hoursUnchangedOnEdit =
      normalizedStatus === 'Present' &&
      existingRecord?.status === 'Present' &&
      typeof existingRecord.calculatedHours === 'number' &&
      typeof existingRecord.extraHours === 'number' &&
      Math.abs(effectiveHours - existingRecord.calculatedHours) < 0.001;

    const effectiveExtraHours =
      normalizedStatus === 'Present'
        ? record.extraHours !== undefined && Number.isFinite(record.extraHours)
          ? Math.max(0, Number(record.extraHours.toFixed(2)))
          : hoursUnchangedOnEdit
            ? Math.max(0, Number(existingRecord!.extraHours!.toFixed(2)))
            : dailyRes.extraHours
        : 0;
    const effectiveEarnedSalary =
      normalizedStatus === 'Present'
        ? effectiveOverrideEnabled
          ? dailyRes.dailyEarnedSalary
          : Number(
              (
                effectiveDailyBase +
                (effectiveAddonEnabled ? effectiveAddonSalary : 0) +
                (effectiveOvertimeEnabled ? effectiveExtraHours * effectiveExtraRate : 0)
              ).toFixed(2)
            )
        : 0;

    const processedRecordPayload = {
      ...record,
      status: normalizedStatus,
      checkInTime: normalizedStatus === 'Present' ? record.checkInTime : undefined,
      checkOutTime: normalizedStatus === 'Present' ? record.checkOutTime : undefined,
      breakDurationMinutes: sanitizedBreak,
      calculatedHours: effectiveHours,
      extraHours: effectiveExtraHours,
      dailyBaseSalary: effectiveDailyBase,
      addonSalary: effectiveAddonSalary,
      addonEnabled: effectiveAddonEnabled,
      extraHourRate: effectiveExtraRate,
      overtimeEnabled: effectiveOvertimeEnabled,
      salaryOverrideEnabled: effectiveOverrideEnabled,
      salaryOverrideAmount: effectiveOverrideAmount,
      dailyEarnedSalary: effectiveEarnedSalary
    };

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const dbUpsertPayload = {
        user_id: ctx.user.id,
        attendance_date: record.date,
        status: dbStatus,
        check_in: normalizedStatus === 'Present' ? normalizeDbTime(record.checkInTime) : null,
        check_out: normalizedStatus === 'Present' ? normalizeDbTime(record.checkOutTime) : null,
        break_minutes: sanitizedBreak,
        hours_worked: processedRecordPayload.calculatedHours,
        extra_hours: processedRecordPayload.extraHours,
        daily_base_salary: effectiveDailyBase,
        addon_salary: effectiveAddonSalary,
        addon_enabled: effectiveAddonEnabled,
        extra_hour_rate: effectiveExtraRate,
        overtime_enabled: effectiveOvertimeEnabled,
        salary_override_enabled: effectiveOverrideEnabled,
        salary_override_amount: effectiveOverrideEnabled ? effectiveOverrideAmount! : null,
        calculated_salary: processedRecordPayload.dailyEarnedSalary,
        notes: record.notes?.trim() ? record.notes.trim() : null
      };
      const dedupKey = `attendance:upsert:${ctx.user.id}:${record.date}:${JSON.stringify(dbUpsertPayload)}`;

      return apiOptimization.coalesce(dedupKey, async () => {
        const { data, error } = await ctx.client
          .from('attendance_records')
          .upsert(dbUpsertPayload, { onConflict: 'user_id,attendance_date' })
          .select()
          .single();

        if (error || !data) {
          const msg = error?.message || '';
          if (/future|current_date/i.test(msg)) {
            throw new Error(
              `Database rejected attendance date ${record.date} because the Supabase trigger/constraint enforces UTC CURRENT_DATE while the app uses IST (${istTodayStr}).`
            );
          }
          throw new Error(sanitizeDatabaseErrorMessage(error, 'Database error: Could not save attendance record.'));
        }

        const confirmed = mapAttendanceRow(data);
        const existingIndex = memoryState.attendance.findIndex(
          r => r.id === confirmed.id || r.date === confirmed.date
        );
        if (existingIndex >= 0) {
          memoryState.attendance = memoryState.attendance.map((r, idx) =>
            idx === existingIndex ? confirmed : r
          );
        } else {
          memoryState.attendance = [confirmed, ...memoryState.attendance];
        }
        notifyListeners();
        return confirmed;
      });
    }

    const existingIndex = memoryState.attendance.findIndex(r => r.date === record.date);
    if (existingIndex >= 0) {
      const updatedRecord: AttendanceRecord = {
        ...memoryState.attendance[existingIndex],
        ...processedRecordPayload,
        id: memoryState.attendance[existingIndex].id
      };
      memoryState.attendance = memoryState.attendance.map((r, idx) =>
        idx === existingIndex ? updatedRecord : r
      );
      notifyListeners();
      return updatedRecord;
    }

    const newRecord: AttendanceRecord = {
      ...processedRecordPayload,
      id: record.id || ('att_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4))
    };
    memoryState.attendance = [newRecord, ...memoryState.attendance];
    notifyListeners();
    return newRecord;
  },

  async deleteAttendanceRecord(id: string): Promise<void> {
    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const { data, error } = await ctx.client
        .from('attendance_records')
        .delete()
        .eq('id', id)
        .eq('user_id', ctx.user.id)
        .select('id');

      if (error) {
        throw new Error(sanitizeDatabaseErrorMessage(error, 'Database error: Could not delete attendance record.'));
      }
      if (!data || data.length === 0) {
        throw new Error('Attendance record not found or could not be deleted.');
      }
    }

    memoryState.attendance = memoryState.attendance.filter(r => r.id !== id);
    notifyListeners();
  },

  // SAVINGS GOALS & TRANSACTIONS (Backed by public.savings_goals & public.savings_transactions)
  getSavingsGoals(): SavingsGoal[] {
    return getCachedSavingsGoals();
  },

  saveSavingsGoals(goals: SavingsGoal[]) {
    memoryState.savingsGoals = [...goals];
    notifyListeners();
  },

  async addSavingsGoal(
    goal: Omit<SavingsGoal, 'id' | 'createdAt' | 'currentAmount'> & {
      initialDeposit?: number;
      initialDepositDate?: string;
    }
  ): Promise<SavingsGoal> {
    if (!goal.name || !goal.name.trim()) {
      throw new Error('Savings fund name is required.');
    }
    if (goal.targetAmount < 0) {
      throw new Error('Target amount cannot be negative.');
    }
    if (goal.initialDeposit !== undefined && goal.initialDeposit < 0) {
      throw new Error('Initial deposit cannot be negative.');
    }

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const insertPayload: Record<string, any> = {
        user_id: ctx.user.id,
        name: goal.name.trim(),
        target_amount: goal.targetAmount,
        target_date: goal.targetDate || null,
        notes: goal.description ? goal.description.trim() : null
      };
      if (goal.color !== undefined) {
        insertPayload.color = goal.color || null;
      }

      const { data: dbGoal, error } = await ctx.client
        .from('savings_goals')
        .insert(insertPayload)
        .select()
        .single();

      if (error || !dbGoal) {
        throw new Error(sanitizeDatabaseErrorMessage(error, 'Database error: Could not create savings fund.'));
      }

      const confirmedGoal = mapSavingsGoalRow(dbGoal);
      memoryState.savingsGoals = [confirmedGoal, ...memoryState.savingsGoals];

      if (goal.initialDeposit && goal.initialDeposit > 0) {
        try {
          await this.addSavingsTransaction({
            savingsGoalId: confirmedGoal.id,
            amount: goal.initialDeposit,
            type: 'deposit',
            date: goal.initialDepositDate || getTodayString(),
            note: 'Initial deposit'
          });
        } catch (txErr) {
          // Roll back created savings goal so partial failure does not leave an empty fund silently
          await ctx.client.from('savings_goals').delete().eq('id', confirmedGoal.id).eq('user_id', ctx.user.id);
          memoryState.savingsGoals = memoryState.savingsGoals.filter(g => g.id !== confirmedGoal.id);
          notifyListeners();
          throw txErr;
        }
      } else {
        notifyListeners();
      }

      return memoryState.savingsGoals.find(g => g.id === confirmedGoal.id) || confirmedGoal;
    }

    const newGoal: SavingsGoal = {
      name: goal.name.trim(),
      targetAmount: goal.targetAmount,
      targetDate: goal.targetDate,
      description: goal.description,
      color: goal.color,
      id: 'sg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      currentAmount: 0,
      createdAt: getTodayString()
    };
    memoryState.savingsGoals = [newGoal, ...memoryState.savingsGoals];

    if (goal.initialDeposit && goal.initialDeposit > 0) {
      await this.addSavingsTransaction({
        savingsGoalId: newGoal.id,
        amount: goal.initialDeposit,
        type: 'deposit',
        date: goal.initialDepositDate || getTodayString(),
        note: 'Initial deposit'
      });
    } else {
      notifyListeners();
    }

    return memoryState.savingsGoals.find(g => g.id === newGoal.id) || newGoal;
  },

  async updateSavingsGoal(id: string, updates: Partial<SavingsGoal>): Promise<void> {
    if (updates.targetAmount !== undefined && updates.targetAmount < 0) {
      throw new Error('Target amount cannot be negative.');
    }

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const dbPayload: Record<string, any> = {};
      if (updates.name !== undefined) dbPayload.name = updates.name.trim();
      if (updates.targetAmount !== undefined) dbPayload.target_amount = updates.targetAmount;
      if (updates.targetDate !== undefined) dbPayload.target_date = updates.targetDate || null;
      if (updates.description !== undefined) dbPayload.notes = updates.description ? updates.description.trim() : null;
      if (updates.color !== undefined) dbPayload.color = updates.color || null;

      if (Object.keys(dbPayload).length === 0) {
        return;
      }
      dbPayload.updated_at = new Date().toISOString();

      const { data, error } = await ctx.client
        .from('savings_goals')
        .update(dbPayload)
        .eq('id', id)
        .eq('user_id', ctx.user.id)
        .select()
        .single();

      if (error || !data) {
        throw new Error(sanitizeDatabaseErrorMessage(error, 'Database error: Could not update savings fund.'));
      }

      const confirmed = mapSavingsGoalRow(data);
      memoryState.savingsGoals = memoryState.savingsGoals.map(g => (g.id === id ? confirmed : g));
      notifyListeners();
      return;
    }

    memoryState.savingsGoals = memoryState.savingsGoals.map(g => (g.id === id ? { ...g, ...updates } : g));
    notifyListeners();
  },

  async deleteSavingsGoal(id: string): Promise<void> {
    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const { data, error } = await ctx.client
        .from('savings_goals')
        .delete()
        .eq('id', id)
        .eq('user_id', ctx.user.id)
        .select('id');

      if (error) {
        throw new Error(sanitizeDatabaseErrorMessage(error, 'Database error: Could not delete savings fund.'));
      }
      if (!data || data.length === 0) {
        throw new Error('Savings fund not found or could not be deleted.');
      }
    }

    memoryState.savingsGoals = memoryState.savingsGoals.filter(g => g.id !== id);
    memoryState.savingsTransactions = memoryState.savingsTransactions.filter(t => t.savingsGoalId !== id);
    notifyListeners();
  },

  getSavingsTransactions(): SavingsTransaction[] {
    return getCachedSavingsTransactions();
  },

  saveSavingsTransactions(txs: SavingsTransaction[]) {
    memoryState.savingsTransactions = [...txs];
    notifyListeners();
  },

  async addSavingsTransaction(tx: Omit<SavingsTransaction, 'id' | 'createdAt'>): Promise<SavingsTransaction> {
    if (!Number.isFinite(tx.amount) || tx.amount <= 0) {
      throw new Error('Transaction amount must be greater than zero.');
    }
    const normalizedTxType = String(tx.type || '').trim().toLowerCase();
    if (normalizedTxType !== 'deposit' && normalizedTxType !== 'withdrawal') {
      throw new Error(`Unsupported savings transaction type: ${String(tx.type)}`);
    }

    const targetGoal = memoryState.savingsGoals.find(g => g.id === tx.savingsGoalId);
    if (!targetGoal) {
      throw new Error('Savings goal fund not found.');
    }

    if (normalizedTxType === 'withdrawal' && tx.amount > targetGoal.currentAmount + 0.001) {
      throw new Error('Withdrawal amount exceeds available balance.');
    }

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const { data: dbTx, error } = await ctx.client
        .from('savings_transactions')
        .insert({
          savings_goal_id: tx.savingsGoalId,
          user_id: ctx.user.id,
          transaction_type: normalizedTxType,
          amount: tx.amount,
          transaction_date: tx.date,
          notes: tx.note?.trim() ? tx.note.trim() : null
        })
        .select()
        .single();

      if (error || !dbTx) {
        throw new Error(sanitizeDatabaseErrorMessage(error, 'Database error: Could not record savings transaction.'));
      }

      const confirmedTx = mapSavingsTxRow(dbTx);
      memoryState.savingsTransactions = [confirmedTx, ...memoryState.savingsTransactions];

      // Reconcile balance and linked Goal trigger state (current_balance, progress_percentage, status, completed_at)
      const [sgRefresh, goalRefresh] = await Promise.all([
        ctx.client
          .from('savings_goals')
          .select('*')
          .eq('id', tx.savingsGoalId)
          .eq('user_id', ctx.user.id)
          .single(),
        ctx.client
          .from('goals')
          .select('*')
          .eq('savings_goal_id', tx.savingsGoalId)
          .eq('user_id', ctx.user.id)
      ]);

      if (sgRefresh.error || !sgRefresh.data) {
        throw new Error(sanitizeDatabaseErrorMessage(sgRefresh.error, 'Transaction saved, but failed to refresh database-maintained savings balance.'));
      }

      const mappedGoal = mapSavingsGoalRow(sgRefresh.data);
      memoryState.savingsGoals = memoryState.savingsGoals.map(g =>
        g.id === mappedGoal.id ? mappedGoal : g
      );

      if (!goalRefresh.error && goalRefresh.data) {
        const refreshedRows = Array.isArray(goalRefresh.data) ? goalRefresh.data : [goalRefresh.data];
        for (const row of refreshedRows) {
          if (!row || isDbRowArchived(row)) continue;
          const mappedLinkedGoal = mapGoalRow(row);
          memoryState.goals = memoryState.goals.map(g =>
            g.id === mappedLinkedGoal.id ? mappedLinkedGoal : g
          );
        }
      }

      notifyListeners();
      return confirmedTx;
    }

    const newTx: SavingsTransaction = {
      ...tx,
      id: 'stx_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      createdAt: getTodayString()
    };
    memoryState.savingsTransactions = [newTx, ...memoryState.savingsTransactions];

    const delta = tx.type === 'deposit' ? tx.amount : -tx.amount;
    const updatedAmount = Math.max(0, Number(((targetGoal.currentAmount || 0) + delta).toFixed(2)));
    memoryState.savingsGoals = memoryState.savingsGoals.map(g =>
      g.id === targetGoal.id ? { ...g, currentAmount: updatedAmount } : g
    );
    memoryState.goals = memoryState.goals.map(g => {
      if (g.savingsGoalId !== targetGoal.id) return g;
      const target = g.targetAmount || 0;
      const pct = target > 0 ? Math.min(100, Math.round((updatedAmount / target) * 100)) : 0;
      const isCompleted = target > 0 && updatedAmount >= target;
      return {
        ...g,
        progressPercentage: pct,
        status: isCompleted ? 'Completed' : updatedAmount > 0 ? 'In Progress' : 'Not Started',
        completedAt: isCompleted ? (g.completedAt || getTodayString()) : undefined
      };
    });

    notifyListeners();
    return newTx;
  },

  async deleteSavingsTransaction(id: string): Promise<void> {
    const targetTx = memoryState.savingsTransactions.find(t => t.id === id);
    if (!targetTx) {
      throw new Error('Savings transaction not found.');
    }

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const { data, error } = await ctx.client
        .from('savings_transactions')
        .delete()
        .eq('id', id)
        .eq('user_id', ctx.user.id)
        .select('id');

      if (error) {
        throw new Error(sanitizeDatabaseErrorMessage(error, 'Database error: Could not delete savings transaction.'));
      }
      if (!data || data.length === 0) {
        throw new Error('Savings transaction not found or could not be deleted.');
      }

      memoryState.savingsTransactions = memoryState.savingsTransactions.filter(t => t.id !== id);

      const [sgRefresh, goalRefresh] = await Promise.all([
        ctx.client
          .from('savings_goals')
          .select('*')
          .eq('id', targetTx.savingsGoalId)
          .eq('user_id', ctx.user.id)
          .single(),
        ctx.client
          .from('goals')
          .select('*')
          .eq('savings_goal_id', targetTx.savingsGoalId)
          .eq('user_id', ctx.user.id)
      ]);

      if (sgRefresh.error || !sgRefresh.data) {
        throw new Error(sanitizeDatabaseErrorMessage(sgRefresh.error, 'Transaction deleted, but failed to refresh database-maintained savings balance.'));
      }

      const mappedGoal = mapSavingsGoalRow(sgRefresh.data);
      memoryState.savingsGoals = memoryState.savingsGoals.map(g =>
        g.id === mappedGoal.id ? mappedGoal : g
      );

      if (!goalRefresh.error && goalRefresh.data) {
        const refreshedRows = Array.isArray(goalRefresh.data) ? goalRefresh.data : [goalRefresh.data];
        for (const row of refreshedRows) {
          if (!row || isDbRowArchived(row)) continue;
          const mappedLinkedGoal = mapGoalRow(row);
          memoryState.goals = memoryState.goals.map(g =>
            g.id === mappedLinkedGoal.id ? mappedLinkedGoal : g
          );
        }
      }

      notifyListeners();
      return;
    }

    memoryState.savingsTransactions = memoryState.savingsTransactions.filter(t => t.id !== id);
    const goal = memoryState.savingsGoals.find(g => g.id === targetTx.savingsGoalId);
    if (goal) {
      const reverseDelta = targetTx.type === 'deposit' ? -targetTx.amount : targetTx.amount;
      const updatedAmount = Math.max(0, Number(((goal.currentAmount || 0) + reverseDelta).toFixed(2)));
      memoryState.savingsGoals = memoryState.savingsGoals.map(g =>
        g.id === goal.id ? { ...g, currentAmount: updatedAmount } : g
      );
      memoryState.goals = memoryState.goals.map(g => {
        if (g.savingsGoalId !== goal.id) return g;
        const target = g.targetAmount || 0;
        const pct = target > 0 ? Math.min(100, Math.round((updatedAmount / target) * 100)) : 0;
        const isCompleted = target > 0 && updatedAmount >= target;
        return {
          ...g,
          progressPercentage: pct,
          status: isCompleted ? 'Completed' : updatedAmount > 0 ? 'In Progress' : 'Not Started',
          completedAt: isCompleted ? (g.completedAt || getTodayString()) : undefined
        };
      });
    }
    notifyListeners();
  },

  // SALARY PAYOUTS (Backed by RPCs xos_record_salary_payout & xos_delete_salary_payout)
  getSalaryPayouts(): SalaryPayout[] {
    return getCachedSalaryPayouts();
  },

  saveSalaryPayouts(payouts: SalaryPayout[]) {
    memoryState.salaryPayouts = [...payouts];
    notifyListeners();
  },

  getPayoutByPeriod(periodMonthOrStart: string): SalaryPayout | undefined {
    return memoryState.salaryPayouts.find(
      p => p.periodStart === periodMonthOrStart || p.periodStart.startsWith(periodMonthOrStart)
    );
  },

  async recordSalaryPayout(
    payout: Omit<SalaryPayout, 'id' | 'createdAt' | 'updatedAt'>,
    syncToIncome: boolean = true,
    allowReplace: boolean = false
  ): Promise<SalaryPayout> {
    if (!Number.isFinite(payout.amountPaid) || payout.amountPaid <= 0) {
      throw new Error('Payout amount must be greater than zero.');
    }

    const matchingPayouts = memoryState.salaryPayouts.filter(
      p => p.periodStart === payout.periodStart && p.periodEnd === payout.periodEnd
    );
    if (matchingPayouts.length > 0 && !allowReplace) {
      throw new Error(`A salary payout for period "${payout.periodStart.slice(0, 7)}" already exists. Cannot record duplicate payout.`);
    }

    const ctx = await requirePersistenceContext();
    const periodLabel = payout.periodStart.slice(0, 7);
    const { paidAtIso, localDate, localTime } = localDateInputToUtcIso(payout.paidAt);
    const incomeTitle = `Salary Payout (${periodLabel})`;
    const incomeNotes = payout.notes?.trim()
      ? payout.notes.trim()
      : `Recorded via Salary Module (${periodLabel})`;

    if (ctx.mode === 'supabase') {
      const { data: rpcResult, error: rpcError } = await ctx.client.rpc('xos_record_salary_payout', {
        p_period_start: payout.periodStart,
        p_period_end: payout.periodEnd,
        p_amount_paid: payout.amountPaid,
        p_paid_at: paidAtIso,
        p_notes: payout.notes?.trim() ? payout.notes.trim() : null,
        p_sync_to_income: syncToIncome,
        p_income_date: localDate,
        p_income_time: localTime,
        p_income_title: incomeTitle,
        p_income_notes: incomeNotes,
        p_replace_existing: allowReplace
      });

      if (rpcError || !rpcResult || !rpcResult.payout) {
        const rawMsg = rpcError?.message || '';
        if (rpcError?.code === '23505' || rawMsg.toLowerCase().includes('already exists') || rawMsg.toLowerCase().includes('duplicate')) {
          throw new Error(`A salary payout for period "${periodLabel}" already exists. Enable replace existing or delete the previous payout first.`);
        }
        throw new Error(sanitizeDatabaseErrorMessage(rpcError, 'Database error: Could not record salary payout.'));
      }

      const confirmedPayout = mapSalaryPayoutRow(rpcResult.payout);
      const confirmedIncome = rpcResult.income ? mapIncomeRow(rpcResult.income) : null;

      const replacedIds = new Set(matchingPayouts.map(p => p.id));
      let nextIncomes = memoryState.incomes.filter(
        i => !i.salaryPayoutId || !replacedIds.has(i.salaryPayoutId)
      );
      if (confirmedIncome) {
        nextIncomes = [confirmedIncome, ...nextIncomes.filter(i => i.id !== confirmedIncome.id)];
      }
      memoryState.incomes = nextIncomes;

      const nextPayouts = memoryState.salaryPayouts.filter(
        p => p.id !== confirmedPayout.id && !replacedIds.has(p.id)
      );
      memoryState.salaryPayouts = [confirmedPayout, ...nextPayouts];

      notifyListeners();
      return confirmedPayout;
    }

    // Local / demo / test-runner mode
    let remainingPayouts = memoryState.salaryPayouts;
    if (matchingPayouts.length > 0 && allowReplace) {
      const replacedIds = new Set(matchingPayouts.map(p => p.id));
      memoryState.incomes = memoryState.incomes.filter(
        i => !i.salaryPayoutId || !replacedIds.has(i.salaryPayoutId)
      );
      remainingPayouts = memoryState.salaryPayouts.filter(p => !replacedIds.has(p.id));
    }

    const newPayout: SalaryPayout = {
      ...payout,
      paidAt: localDate,
      id: 'sp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)
    };

    if (syncToIncome) {
      const newIncome: Income = {
        title: incomeTitle,
        amount: payout.amountPaid,
        source: 'Salary' as IncomeSource,
        date: localDate,
        notes: incomeNotes,
        salaryPayoutId: newPayout.id,
        id: 'i_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        createdAt: getTodayString()
      };
      memoryState.incomes = [newIncome, ...memoryState.incomes];
    }

    memoryState.salaryPayouts = [newPayout, ...remainingPayouts];
    notifyListeners();
    return newPayout;
  },

  async deleteSalaryPayout(id: string): Promise<void> {
    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const { error: rpcError } = await ctx.client.rpc('xos_delete_salary_payout', {
        p_payout_id: id
      });

      if (rpcError) {
        throw new Error(sanitizeDatabaseErrorMessage(rpcError, 'Database error: Could not delete salary payout.'));
      }
    }

    memoryState.incomes = memoryState.incomes.filter(i => i.salaryPayoutId !== id);
    memoryState.salaryPayouts = memoryState.salaryPayouts.filter(p => p.id !== id);
    notifyListeners();
  },

  // DEBTS (Backed by public.debts & public.debt_repayments)
  getDebts(): Debt[] {
    return getCachedDebts();
  },

  saveDebts(debts: Debt[]) {
    memoryState.debts = [...debts];
    notifyListeners();
  },

  async addDebt(
    debt: Omit<Debt, 'id' | 'status' | 'remaining_amount' | 'created_at' | 'updated_at'> & { direction?: DebtDirection }
  ): Promise<Debt> {
    if (!debt.person_name || !debt.person_name.trim()) {
      throw new Error('Person name is required.');
    }
    if (!Number.isFinite(debt.original_amount) || debt.original_amount <= 0) {
      throw new Error('Loan amount must be greater than zero.');
    }

    const direction = debt.direction || 'receive';
    const storedDesc = serializeDebtDescription(direction, debt.description);
    const deserializedDesc = deserializeDebtDescription(storedDesc);

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const knownIds = new Set(memoryState.debts.map(d => d.id));
      const trimmedName = debt.person_name.trim();
      const normalizedDueDate = debt.due_date || null;
      const normalizedNotes = debt.notes ? debt.notes.trim() : null;
      const requestStartedMs = Date.now();

      let insertData: any = null;
      let insertError: any = null;

      try {
        const res = await ctx.client
          .from('debts')
          .insert({
            user_id: ctx.user.id,
            person_name: trimmedName,
            description: storedDesc,
            original_amount: debt.original_amount,
            lent_date: debt.lent_date,
            due_date: normalizedDueDate,
            notes: normalizedNotes
          })
          .select()
          .single();
        insertData = res.data;
        insertError = res.error;
      } catch (thrown) {
        insertError = thrown;
      }

      if (insertError || !insertData) {
        const errorKind = classifyFetchError(insertError);
        if (errorKind === 'abort' || errorKind === 'timeout') {
          // Never auto-retry the insert; first check whether the original insert already committed.
          try {
            let checkQuery: any = ctx.client
              .from('debts')
              .select('*')
              .eq('user_id', ctx.user.id)
              .eq('person_name', trimmedName)
              .eq('lent_date', debt.lent_date)
              .order('created_at', { ascending: false });

            if (typeof checkQuery.limit === 'function') {
              checkQuery = checkQuery.limit(10);
            }

            const { data: recentRows, error: checkError } = await checkQuery;
            if (!checkError && Array.isArray(recentRows)) {
              const matchedRow = recentRows.find((row: any) => {
                if (!row || !row.id || knownIds.has(row.id)) return false;
                const amountMatches = Math.abs(Number(row.original_amount) - debt.original_amount) < 0.005;
                const descMatches = (row.description || '') === storedDesc;
                const dueMatches = (row.due_date || null) === normalizedDueDate;
                const notesMatches = (row.notes ? String(row.notes).trim() : null) === normalizedNotes;
                const createdMs = row.created_at ? Date.parse(row.created_at) : NaN;
                const recentEnough = !Number.isFinite(createdMs) || createdMs >= requestStartedMs - 60000;
                return amountMatches && descMatches && dueMatches && notesMatches && recentEnough;
              });

              if (matchedRow) {
                const confirmedDebt = mapDebtRow(matchedRow);
                memoryState.debts = [
                  confirmedDebt,
                  ...memoryState.debts.filter(d => d.id !== confirmedDebt.id)
                ];
                notifyListeners();
                return confirmedDebt;
              }
            }
          } catch {
            // Reconciliation query also failed; throw explicit abort/timeout error below.
          }

          throw formatDebtMutationError(insertError, 'Database error: Could not save loan record.');
        }

        throw formatDebtMutationError(insertError, 'Database error: Could not save loan record.');
      }

      const confirmedDebt = mapDebtRow(insertData);
      memoryState.debts = [
        confirmedDebt,
        ...memoryState.debts.filter(d => d.id !== confirmedDebt.id)
      ];
      notifyListeners();
      return confirmedDebt;
    }

    const newDebt: Debt = {
      ...debt,
      person_name: debt.person_name.trim(),
      description: deserializedDesc.description,
      direction: deserializedDesc.direction,
      remaining_amount: debt.original_amount,
      id: 'd_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      status: 'outstanding',
      created_at: getTodayString()
    };
    memoryState.debts = [newDebt, ...memoryState.debts];
    notifyListeners();
    return newDebt;
  },

  async updateDebt(
    id: string,
    updates: Partial<Pick<Debt, 'person_name' | 'original_amount' | 'lent_date' | 'due_date' | 'description' | 'notes' | 'direction'>>
  ): Promise<void> {
    if (updates.original_amount !== undefined && (!Number.isFinite(updates.original_amount) || updates.original_amount <= 0)) {
      throw new Error('Loan amount must be greater than zero.');
    }

    const targetDebt = memoryState.debts.find(d => d.id === id);
    if (!targetDebt) {
      throw new Error('Debt record not found.');
    }

    const repaid = memoryState.debtRepayments
      .filter(r => r.debt_id === id)
      .reduce((sum, r) => sum + r.amount, 0);

    if (updates.original_amount !== undefined && updates.original_amount < repaid - 0.001) {
      throw new Error(`New amount (${updates.original_amount}) cannot be less than total repayments already recorded (${repaid}).`);
    }

    const ctx = await requirePersistenceContext();
    const nextDirection = updates.direction !== undefined ? updates.direction : (targetDebt.direction || 'receive');
    
    const currentCleanDesc = targetDebt.description || '';
    const nextDescInput = updates.description !== undefined ? updates.description : currentCleanDesc;
    const storedDesc = serializeDebtDescription(nextDirection, nextDescInput);
    const deserializedDesc = deserializeDebtDescription(storedDesc);

    if (ctx.mode === 'supabase') {
      const dbPayload: Record<string, any> = {};
      if (updates.person_name !== undefined) dbPayload.person_name = updates.person_name.trim();
      if (updates.original_amount !== undefined) {
        const nextOriginal = updates.original_amount;
        const nextRemaining = Math.max(0, Number((nextOriginal - repaid).toFixed(2)));
        const nextStatus: DebtStatus =
          nextRemaining <= 0.0001 ? 'paid' : repaid > 0 ? 'partially_paid' : 'outstanding';
        dbPayload.original_amount = nextOriginal;
        dbPayload.remaining_amount = nextRemaining;
        dbPayload.status = nextStatus;
      }
      if (updates.lent_date !== undefined) dbPayload.lent_date = updates.lent_date;
      if (updates.due_date !== undefined) dbPayload.due_date = updates.due_date.trim() ? updates.due_date.trim() : null;
      if (updates.description !== undefined || updates.direction !== undefined) {
        dbPayload.description = storedDesc;
      }
      if (updates.notes !== undefined) dbPayload.notes = updates.notes.trim() ? updates.notes.trim() : null;

      if (Object.keys(dbPayload).length === 0) {
        return;
      }

      let data: any = null;
      let error: any = null;
      try {
        const res = await ctx.client
          .from('debts')
          .update(dbPayload)
          .eq('id', id)
          .eq('user_id', ctx.user.id)
          .select()
          .single();
        data = res.data;
        error = res.error;
      } catch (thrown) {
        error = thrown;
      }

      if (error || !data) {
        throw formatDebtMutationError(error, 'Database error: Could not update loan record.');
      }

      const confirmed = mapDebtRow(data);
      memoryState.debts = memoryState.debts.map(d => (d.id === id ? confirmed : d));
      notifyListeners();
      return;
    }

    memoryState.debts = memoryState.debts.map(d => {
      if (d.id !== id) return d;
      const nextOriginal = updates.original_amount ?? d.original_amount;
      const nextRemaining = Math.max(0, Number((nextOriginal - repaid).toFixed(2)));
      const nextStatus: DebtStatus =
        nextRemaining <= 0.0001 ? 'paid' : repaid > 0 ? 'partially_paid' : 'outstanding';
      return {
        ...d,
        ...updates,
        person_name: updates.person_name !== undefined ? updates.person_name.trim() : d.person_name,
        due_date: updates.due_date !== undefined ? (updates.due_date.trim() || undefined) : d.due_date,
        notes: updates.notes !== undefined ? updates.notes.trim() : d.notes,
        description: deserializedDesc.description,
        direction: deserializedDesc.direction,
        remaining_amount: nextRemaining,
        status: nextStatus,
        updated_at: getTodayString()
      };
    });
    notifyListeners();
  },

  async deleteDebt(id: string): Promise<void> {
    const ctx = await requirePersistenceContext();
    const repaymentIds = new Set(
      memoryState.debtRepayments.filter(r => r.debt_id === id).map(r => r.id)
    );
    const linkedExpenses = memoryState.expenses.filter(
      e => e.debtRepaymentId && repaymentIds.has(e.debtRepaymentId)
    );
    // Expenses with database FK debt_repayment_id are deleted automatically via ON DELETE CASCADE.
    // Only legacy note-marker expenses (where debt_repayment_id IS NULL) require explicit cleanup.
    const legacyLinkedExpenseIds = linkedExpenses
      .filter(e => legacyNoteLinkedExpenseIds.has(e.id))
      .map(e => e.id);

    if (ctx.mode === 'supabase') {
      let data: any = null;
      let error: any = null;
      try {
        const res = await ctx.client
          .from('debts')
          .delete()
          .eq('id', id)
          .eq('user_id', ctx.user.id)
          .select('id');
        data = res.data;
        error = res.error;
      } catch (thrown) {
        error = thrown;
      }

      if (error) {
        throw formatDebtMutationError(error, 'Database error: Could not delete loan record.');
      }
      if (!data || data.length === 0) {
        throw new Error('Loan record not found or could not be deleted.');
      }

      const deletedLegacyExpenseIds = new Set<string>();
      for (const expId of legacyLinkedExpenseIds) {
        const { error: expDelError } = await ctx.client
          .from('expenses')
          .delete()
          .eq('id', expId)
          .eq('user_id', ctx.user.id)
          .select('id');
        if (expDelError) {
          memoryState.debts = memoryState.debts.filter(d => d.id !== id);
          memoryState.debtRepayments = memoryState.debtRepayments.filter(r => r.debt_id !== id);
          if (deletedLegacyExpenseIds.size > 0) {
            memoryState.expenses = memoryState.expenses.filter(e => !deletedLegacyExpenseIds.has(e.id));
            deletedLegacyExpenseIds.forEach(eid => legacyNoteLinkedExpenseIds.delete(eid));
          }
          notifyListeners();
          throw new Error(
            sanitizeDatabaseErrorMessage(
              expDelError,
              'Debt was deleted, but a legacy Debt Repayment expense could not be removed cleanly.'
            )
          );
        }
        deletedLegacyExpenseIds.add(expId);
      }
    }

    memoryState.debts = memoryState.debts.filter(d => d.id !== id);
    memoryState.debtRepayments = memoryState.debtRepayments.filter(r => r.debt_id !== id);
    if (repaymentIds.size > 0) {
      linkedExpenses.forEach(e => legacyNoteLinkedExpenseIds.delete(e.id));
      memoryState.expenses = memoryState.expenses.filter(
        e => !e.debtRepaymentId || !repaymentIds.has(e.debtRepaymentId)
      );
    }
    notifyListeners();
  },

  // DEBT REPAYMENTS (Backed by public.debt_repayments)
  getDebtRepayments(): DebtRepayment[] {
    return getCachedDebtRepayments();
  },

  saveDebtRepayments(repayments: DebtRepayment[]) {
    memoryState.debtRepayments = [...repayments];
    notifyListeners();
  },

  async addDebtRepayment(repayment: Omit<DebtRepayment, 'id' | 'created_at'>): Promise<DebtRepayment> {
    if (!Number.isFinite(repayment.amount) || repayment.amount <= 0) {
      throw new Error('Repayment amount must be greater than zero.');
    }
    if (!isValidCalendarDateString(repayment.repayment_date)) {
      throw new Error('Please select a valid repayment date in YYYY-MM-DD format.');
    }

    const normalizedNotes = repayment.notes?.trim() || '';
    const normalizedMethod = (repayment.payment_method?.trim() || 'Bank Transfer') as PaymentMethod;
    const dedupKey = `debt_repayment:add:${repayment.debt_id}:${Number(repayment.amount).toFixed(2)}:${repayment.repayment_date}:${normalizedMethod}:${normalizedNotes}`;

    return apiOptimization.coalesce(dedupKey, () =>
      enqueueDebtRepaymentOp(repayment.debt_id, async () => {
        const targetDebt = memoryState.debts.find(d => d.id === repayment.debt_id);
        if (!targetDebt) {
          throw new Error('Associated debt record not found.');
        }

        const existingRepaid = memoryState.debtRepayments
          .filter(r => r.debt_id === repayment.debt_id)
          .reduce((sum, r) => sum + r.amount, 0);

        const remainingDebt =
          typeof targetDebt.remaining_amount === 'number' && Number.isFinite(targetDebt.remaining_amount)
            ? Math.max(0, Number(targetDebt.remaining_amount.toFixed(2)))
            : Math.max(0, Number((targetDebt.original_amount - existingRepaid).toFixed(2)));

        if (repayment.amount > remainingDebt + 0.001) {
          throw new Error(`Repayment amount exceeds remaining debt balance (${remainingDebt}).`);
        }

        const isPayDebt = targetDebt.direction === 'pay';
        const currentTime = new Date().toTimeString().slice(0, 5);
        const ctx = await requirePersistenceContext();

        if (ctx.mode === 'supabase') {
          const knownRepaymentIds = new Set(memoryState.debtRepayments.map(r => r.id));
          const insertPayload: Record<string, any> = {
            debt_id: repayment.debt_id,
            user_id: ctx.user.id,
            amount: repayment.amount,
            repayment_date: repayment.repayment_date,
            notes: normalizedNotes || null
          };
          if (repayment.payment_method?.trim()) {
            insertPayload.payment_method = repayment.payment_method.trim();
          }

          let dbRep: any = null;
          let repError: any = null;
          try {
            const res = await ctx.client
              .from('debt_repayments')
              .insert(insertPayload)
              .select()
              .single();
            dbRep = res.data;
            repError = res.error;
          } catch (thrown) {
            repError = thrown;
          }

          if (repError || !dbRep) {
            const errKind = classifyFetchError(repError);
            if (errKind === 'abort' || errKind === 'timeout') {
              try {
                const { data: recentReps, error: checkRepErr } = await ctx.client
                  .from('debt_repayments')
                  .select('*')
                  .eq('user_id', ctx.user.id)
                  .eq('debt_id', repayment.debt_id)
                  .eq('repayment_date', repayment.repayment_date)
                  .order('created_at', { ascending: false });
                if (!checkRepErr && Array.isArray(recentReps)) {
                  const matchedRep = recentReps.find((row: any) => {
                    if (!row || !row.id || knownRepaymentIds.has(row.id)) return false;
                    const amountMatch = Math.abs(Number(row.amount) - repayment.amount) < 0.005;
                    const noteMatch = (row.notes ? String(row.notes).trim() : '') === normalizedNotes;
                    return amountMatch && noteMatch;
                  });
                  if (matchedRep) {
                    dbRep = matchedRep;
                    repError = null;
                  }
                }
              } catch {
                // Keep original error if reconciliation query fails
              }
            }
          }

          if (repError || !dbRep) {
            throw new Error(sanitizeDatabaseErrorMessage(repError, 'Database error: Could not record repayment.'));
          }

          const confirmedRep = mapDebtRepaymentRow(dbRep);
          let confirmedExpense: Expense | null = null;

          // Only "Money to Pay" debts create a linked Debt Repayment expense
          if (isPayDebt) {
            const existingLinkedExpense = memoryState.expenses.find(
              e => e.debtRepaymentId === confirmedRep.id
            );

            if (existingLinkedExpense) {
              confirmedExpense = existingLinkedExpense;
            } else {
              const expenseTitle = buildDebtRepaymentExpenseTitle(targetDebt);
              const humanNotes = buildDebtRepaymentExpenseNotes(targetDebt, confirmedRep);
              const formattedTime = normalizeDbTime(currentTime);
              const expenseInsertPayload = {
                user_id: ctx.user.id,
                debt_repayment_id: confirmedRep.id,
                title: expenseTitle,
                amount: confirmedRep.amount,
                category: 'Debt Repayment',
                expense_date: confirmedRep.repayment_date,
                expense_time: formattedTime,
                payment_method: confirmedRep.payment_method || normalizedMethod,
                notes: humanNotes || null,
                is_recurring: false,
                recurrence_frequency: null,
                recurrence_end_date: null
              };

              let expData: any = null;
              let expError: any = null;
              try {
                const expRes = await ctx.client
                  .from('expenses')
                  .insert(expenseInsertPayload)
                  .select()
                  .single();
                expData = expRes.data;
                expError = expRes.error;
              } catch (thrown) {
                expError = thrown;
              }

              const expErrKind = classifyFetchError(expError);
              const isUniqueViolation =
                (expError as any)?.code === '23505' ||
                /duplicate key|unique constraint/i.test(String((expError as any)?.message || ''));

              if ((expError || !expData) && (expErrKind === 'abort' || expErrKind === 'timeout' || isUniqueViolation)) {
                try {
                  // 1) Check authoritative composite FK (debt_repayment_id, user_id) first
                  const { data: fkMatchedExp, error: fkCheckErr } = await ctx.client
                    .from('expenses')
                    .select('*')
                    .eq('debt_repayment_id', confirmedRep.id)
                    .eq('user_id', ctx.user.id)
                    .maybeSingle();

                  if (!fkCheckErr && fkMatchedExp) {
                    expData = fkMatchedExp;
                    expError = null;
                  } else if (expErrKind === 'abort' || expErrKind === 'timeout') {
                    // 2) Fallback for legacy [xos-repayment:<id>] note-marker rows
                    const { data: recentExps, error: checkExpErr } = await ctx.client
                      .from('expenses')
                      .select('*')
                      .eq('user_id', ctx.user.id)
                      .eq('expense_date', confirmedRep.repayment_date)
                      .order('created_at', { ascending: false });
                    if (!checkExpErr && Array.isArray(recentExps)) {
                      const matchedExp = recentExps.find((row: any) => {
                        if (row?.debt_repayment_id === confirmedRep.id) return true;
                        const decoded = deserializeExpenseRepaymentNotes(row?.notes, row?.debt_repayment_id);
                        return decoded.debtRepaymentId === confirmedRep.id;
                      });
                      if (matchedExp) {
                        expData = matchedExp;
                        expError = null;
                      }
                    }
                  }
                } catch {
                  // Reconciliation query failed; proceed to rollback below
                }
              }

              if (expError || !expData) {
                // Atomic consistency: roll back the newly inserted debt_repayment if linked expense creation fails
                try {
                  await ctx.client
                    .from('debt_repayments')
                    .delete()
                    .eq('id', confirmedRep.id)
                    .eq('user_id', ctx.user.id);
                } catch {
                  // Best-effort rollback
                }
                throw new Error(
                  sanitizeDatabaseErrorMessage(
                    expError,
                    'Database error: Could not record linked Debt Repayment expense. Repayment was rolled back.'
                  )
                );
              }

              confirmedExpense = mapExpenseRow(expData);
              if (!confirmedExpense.time) {
                confirmedExpense.time = currentTime;
              }
              if (!confirmedExpense.debtRepaymentId) {
                confirmedExpense.debtRepaymentId = confirmedRep.id;
              }
              legacyNoteLinkedExpenseIds.delete(confirmedExpense.id);
            }
          }

          memoryState.debtRepayments = [
            confirmedRep,
            ...memoryState.debtRepayments.filter(r => r.id !== confirmedRep.id)
          ];

          if (confirmedExpense) {
            memoryState.expenses = [
              confirmedExpense,
              ...memoryState.expenses.filter(
                e => e.id !== confirmedExpense!.id && e.debtRepaymentId !== confirmedRep.id
              )
            ];
          }

          // Reconcile parent debt remaining_amount & status maintained by DB trigger
          const { data: refreshedDebt, error: refreshError } = await ctx.client
            .from('debts')
            .select('*')
            .eq('id', repayment.debt_id)
            .eq('user_id', ctx.user.id)
            .single();

          if (!refreshError && refreshedDebt) {
            const mappedDebt = mapDebtRow(refreshedDebt);
            memoryState.debts = memoryState.debts.map(d => (d.id === mappedDebt.id ? mappedDebt : d));
          } else {
            const nextRemaining = Math.max(0, Number((remainingDebt - repayment.amount).toFixed(2)));
            const newStatus: DebtStatus = nextRemaining <= 0.0001 ? 'paid' : 'partially_paid';
            memoryState.debts = memoryState.debts.map(d =>
              d.id === targetDebt.id ? { ...d, remaining_amount: nextRemaining, status: newStatus } : d
            );
          }

          notifyListeners();
          return confirmedRep;
        }

        const newRepayment: DebtRepayment = {
          ...repayment,
          id: 'dr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          created_at: getTodayString()
        };
        memoryState.debtRepayments = [newRepayment, ...memoryState.debtRepayments];

        if (isPayDebt && !memoryState.expenses.some(e => e.debtRepaymentId === newRepayment.id)) {
          const newExpense: Expense = {
            id: 'e_rep_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            title: buildDebtRepaymentExpenseTitle(targetDebt),
            amount: newRepayment.amount,
            category: 'Debt Repayment',
            date: newRepayment.repayment_date,
            time: currentTime,
            paymentMethod: (newRepayment.payment_method as PaymentMethod) || normalizedMethod,
            notes: buildDebtRepaymentExpenseNotes(targetDebt, newRepayment),
            isRecurring: false,
            recurringFrequency: 'None',
            debtRepaymentId: newRepayment.id,
            createdAt: getTodayString()
          };
          memoryState.expenses = [newExpense, ...memoryState.expenses];
        }

        const totalRepaidNow = existingRepaid + repayment.amount;
        const nextRemaining = Math.max(0, Number((targetDebt.original_amount - totalRepaidNow).toFixed(2)));
        const newStatus: DebtStatus = nextRemaining <= 0.0001 ? 'paid' : 'partially_paid';
        memoryState.debts = memoryState.debts.map(d =>
          d.id === targetDebt.id ? { ...d, remaining_amount: nextRemaining, status: newStatus } : d
        );

        notifyListeners();
        return newRepayment;
      })
    );
  },

  async deleteDebtRepayment(id: string): Promise<void> {
    const targetRepayment = memoryState.debtRepayments.find(r => r.id === id);
    if (!targetRepayment) {
      throw new Error('Repayment record not found.');
    }

    const linkedExpenses = memoryState.expenses.filter(e => e.debtRepaymentId === id);
    // FK-linked expenses (expenses.debt_repayment_id) are deleted via ON DELETE CASCADE.
    // Only legacy note-marker-only expenses require explicit cleanup.
    const legacyLinkedExpenses = linkedExpenses.filter(e => legacyNoteLinkedExpenseIds.has(e.id));
    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const { data: deletedRows, error } = await ctx.client
        .from('debt_repayments')
        .delete()
        .eq('id', id)
        .eq('user_id', ctx.user.id)
        .select('id');

      if (error) {
        throw new Error(sanitizeDatabaseErrorMessage(error, 'Database error: Could not delete repayment.'));
      }
      if (!deletedRows || deletedRows.length === 0) {
        throw new Error('Repayment record not found or could not be deleted.');
      }

      memoryState.debtRepayments = memoryState.debtRepayments.filter(r => r.id !== id);

      const { data: refreshedDebt, error: refreshError } = await ctx.client
        .from('debts')
        .select('*')
        .eq('id', targetRepayment.debt_id)
        .eq('user_id', ctx.user.id)
        .single();

      if (!refreshError && refreshedDebt) {
        const mappedDebt = mapDebtRow(refreshedDebt);
        memoryState.debts = memoryState.debts.map(d => (d.id === mappedDebt.id ? mappedDebt : d));
      } else {
        const targetDebt = memoryState.debts.find(d => d.id === targetRepayment.debt_id);
        if (targetDebt) {
          const remainingRepayments = memoryState.debtRepayments
            .filter(r => r.debt_id === targetDebt.id)
            .reduce((sum, r) => sum + r.amount, 0);
          const nextRemaining = Math.max(0, Number((targetDebt.original_amount - remainingRepayments).toFixed(2)));
          const updatedStatus: DebtStatus =
            nextRemaining <= 0.0001
              ? 'paid'
              : remainingRepayments > 0
                ? 'partially_paid'
                : 'outstanding';
          memoryState.debts = memoryState.debts.map(d =>
            d.id === targetDebt.id
              ? { ...d, remaining_amount: nextRemaining, status: updatedStatus }
              : d
          );
        }
      }

      // Clean up any legacy note-marker-only expense rows (ignoring already-deleted/cascaded 0-row results)
      const deletedLegacyExpenseIds = new Set<string>();
      for (const linkedExp of legacyLinkedExpenses) {
        const { error: expDelErr } = await ctx.client
          .from('expenses')
          .delete()
          .eq('id', linkedExp.id)
          .eq('user_id', ctx.user.id)
          .select('id');

        if (expDelErr) {
          if (deletedLegacyExpenseIds.size > 0) {
            memoryState.expenses = memoryState.expenses.filter(e => !deletedLegacyExpenseIds.has(e.id));
            deletedLegacyExpenseIds.forEach(eid => legacyNoteLinkedExpenseIds.delete(eid));
          }
          notifyListeners();
          throw new Error(
            sanitizeDatabaseErrorMessage(
              expDelErr,
              'Repayment was deleted, but its legacy Debt Repayment expense could not be removed.'
            )
          );
        }
        deletedLegacyExpenseIds.add(linkedExp.id);
      }

      linkedExpenses.forEach(e => legacyNoteLinkedExpenseIds.delete(e.id));
      memoryState.expenses = memoryState.expenses.filter(e => e.debtRepaymentId !== id);
      notifyListeners();
      return;
    }

    memoryState.debtRepayments = memoryState.debtRepayments.filter(r => r.id !== id);
    linkedExpenses.forEach(e => legacyNoteLinkedExpenseIds.delete(e.id));
    memoryState.expenses = memoryState.expenses.filter(e => e.debtRepaymentId !== id);

    const targetDebt = memoryState.debts.find(d => d.id === targetRepayment.debt_id);
    if (targetDebt) {
      const remainingRepayments = memoryState.debtRepayments
        .filter(r => r.debt_id === targetDebt.id)
        .reduce((sum, r) => sum + r.amount, 0);
      const nextRemaining = Math.max(0, Number((targetDebt.original_amount - remainingRepayments).toFixed(2)));
      const updatedStatus: DebtStatus =
        nextRemaining <= 0.0001
          ? 'paid'
          : remainingRepayments > 0
            ? 'partially_paid'
            : 'outstanding';

      memoryState.debts = memoryState.debts.map(d =>
        d.id === targetDebt.id
          ? { ...d, remaining_amount: nextRemaining, status: updatedStatus }
          : d
      );
    }

    notifyListeners();
  },

  clearAllData() {
    fetchSequence += 1;
    hydratedUserId = null;
    isHydrating = false;
    inFlightFetchAll = null;
    legacyNoteLinkedExpenseIds.clear();
    memoryState.goals = [];
    memoryState.expenses = [];
    memoryState.incomes = [];
    memoryState.attendance = [];
    memoryState.savingsGoals = [];
    memoryState.savingsTransactions = [];
    memoryState.salaryPayouts = [];
    memoryState.debts = [];
    memoryState.debtRepayments = [];
    memoryState.fetchErrors = [];
    memoryState.settings = createDefaultSettings();
    notifyListeners();
  },

  /**
   * Permanently reset the authenticated user's application data via the
   * xos_reset_user_data() Supabase RPC while preserving auth session & profile.
   */
  async resetUserData(): Promise<void> {
    if (resetInFlightPromise) {
      return resetInFlightPromise;
    }

    resetInFlightPromise = (async () => {
      const ctx = await requirePersistenceContext();

      if (ctx.mode === 'local') {
        apiOptimization.invalidateCache();
        this.clearAllData();
        return;
      }

      const { data: rpcData, error: rpcError } = await ctx.client.rpc('xos_reset_user_data');
      if (rpcError) {
        throw new Error(sanitizeDatabaseErrorMessage(rpcError, 'Database error: Could not reset account data.'));
      }

      validateResetRpcResponse(rpcData);

      const preservedEmail = memoryState.settings.profile.email || ctx.user.email || '';
      const fallbackDisplayName =
        (typeof ctx.user.user_metadata?.display_name === 'string' && ctx.user.user_metadata.display_name) ||
        (typeof ctx.user.user_metadata?.full_name === 'string' && ctx.user.user_metadata.full_name) ||
        (ctx.user.email ? ctx.user.email.split('@')[0] : '') ||
        'XOS User';

      // Only after confirmed RPC success: clear caches and in-memory state
      apiOptimization.invalidateCache();
      fetchSequence += 1;
      hydratedUserId = null;
      isHydrating = false;
      inFlightFetchAll = null;
      legacyNoteLinkedExpenseIds.clear();
      memoryState.goals = [];
      memoryState.expenses = [];
      memoryState.incomes = [];
      memoryState.attendance = [];
      memoryState.savingsGoals = [];
      memoryState.savingsTransactions = [];
      memoryState.salaryPayouts = [];
      memoryState.debts = [];
      memoryState.debtRepayments = [];
      memoryState.fetchErrors = [];
      const freshSettings = createDefaultSettings();
      if (preservedEmail) {
        freshSettings.profile.email = preservedEmail;
      }
      memoryState.settings = freshSettings;
      notifyListeners();

      // Re-fetch backend state so default settings and preserved profile hydrate cleanly
      const fetchResult = await this.fetchAllUserData(ctx.user.id);
      if (!fetchResult.stale) {
        const needsEmail = !memoryState.settings.profile.email && Boolean(preservedEmail);
        const needsName = !memoryState.settings.profile.name && Boolean(fallbackDisplayName);
        if (needsEmail || needsName) {
          memoryState.settings = {
            ...memoryState.settings,
            profile: {
              ...memoryState.settings.profile,
              ...(needsEmail ? { email: preservedEmail } : {}),
              ...(needsName ? { name: fallbackDisplayName } : {})
            }
          };
          notifyListeners();
        }
      }
    })().finally(() => {
      resetInFlightPromise = null;
    });

    return resetInFlightPromise;
  },

  exportJSON(): string {
    const payload = {
      settings: this.getSettings(),
      goals: this.getGoals(),
      expenses: this.getExpenses(),
      incomes: this.getIncomes(),
      attendance: this.getAttendance(),
      savingsGoals: this.getSavingsGoals(),
      savingsTransactions: this.getSavingsTransactions(),
      salaryPayouts: this.getSalaryPayouts(),
      debts: this.getDebts(),
      debtRepayments: this.getDebtRepayments(),
      exportedAt: new Date().toISOString()
    };
    return JSON.stringify(payload, null, 2);
  },

  importJSON(jsonString: string): boolean {
    if (isBackendActive()) {
      if (import.meta.env?.DEV) {
        console.warn('JSON import into memory is disabled while connected to a live Supabase account.');
      }
      return false;
    }
    try {
      const data = JSON.parse(jsonString);
      if (data.settings) memoryState.settings = { ...createDefaultSettings(), ...data.settings };
      if (Array.isArray(data.goals)) memoryState.goals = [...data.goals];
      if (Array.isArray(data.expenses)) memoryState.expenses = [...data.expenses];
      if (Array.isArray(data.incomes)) memoryState.incomes = [...data.incomes];
      if (Array.isArray(data.attendance)) memoryState.attendance = [...data.attendance];
      if (Array.isArray(data.savingsGoals)) memoryState.savingsGoals = [...data.savingsGoals];
      if (Array.isArray(data.savingsTransactions)) memoryState.savingsTransactions = [...data.savingsTransactions];
      if (Array.isArray(data.salaryPayouts)) memoryState.salaryPayouts = [...data.salaryPayouts];
      if (Array.isArray(data.debts)) memoryState.debts = [...data.debts];
      if (Array.isArray(data.debtRepayments)) memoryState.debtRepayments = [...data.debtRepayments];
      notifyListeners();
      return true;
    } catch (e) {
      if (import.meta.env?.DEV) {
        console.error('Failed to parse in-memory JSON payload:', e);
      }
      return false;
    }
  }
};
