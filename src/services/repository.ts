import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AttendanceRecord,
  CurrencyCode,
  DashboardWidgetConfig,
  DateFormat,
  Debt,
  DebtRepayment,
  DebtStatus,
  Expense,
  ExpenseCategory,
  Goal,
  Income,
  IncomeSource,
  PaymentMethod,
  RecurrenceFrequency,
  SalaryConfig,
  SalaryPayout,
  SavingsGoal,
  SavingsTransaction,
  UserSettings,
  WeekStartDay
} from '../types';
import { DEFAULT_USER_SETTINGS, generateDemoDataset } from '../data/initialData';
import { calculateWorkingHours, getTodayString } from '../utils/formatters';
import { calculateDailyEarnedSalary } from '../utils/calculations';
import { supabase, isSupabaseConfigured } from './supabase';

export interface FetchTableError {
  table: string;
  message: string;
}

export interface FetchAllResult {
  partialErrors: FetchTableError[];
  stale: boolean;
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

function notifyListeners() {
  listeners.forEach(cb => cb());
}

let activeSupabaseClient: SupabaseClient = supabase;
let configuredOverride: boolean | null = null;
let activeUserId: string | null = null;
let fetchSequence = 0;

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
    throw new Error(error.message || 'Could not verify authentication session.');
  }
  return data?.session?.user || null;
}

async function requirePersistenceContext() {
  if (!isBackendActive() || memoryState.settings.isDemoMode) {
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

function mapExpenseRow(e: any): Expense {
  return {
    id: e.id,
    title: e.title,
    amount: Number(e.amount),
    category: e.category as ExpenseCategory,
    date: e.expense_date,
    time: e.expense_time ? String(e.expense_time).slice(0, 5) : undefined,
    paymentMethod: (e.payment_method || 'Cash') as PaymentMethod,
    notes: e.notes || '',
    isRecurring: Boolean(e.is_recurring),
    recurringFrequency: (e.recurrence_frequency || 'None') as RecurrenceFrequency,
    recurrenceEndDate: e.recurrence_end_date || undefined,
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

function mapDebtRow(d: any): Debt {
  const original = Number(d.original_amount);
  const remaining =
    d.remaining_amount !== null && d.remaining_amount !== undefined
      ? Number(d.remaining_amount)
      : original;

  return {
    id: d.id,
    person_name: d.person_name,
    original_amount: original,
    remaining_amount: remaining,
    lent_date: d.lent_date,
    due_date: d.due_date || undefined,
    description: d.description || '',
    notes: d.notes || '',
    status: (d.status || 'outstanding') as DebtStatus,
    created_at: d.created_at,
    updated_at: d.updated_at || undefined
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
  return {
    id: a.id,
    date: a.attendance_date,
    status: a.status,
    checkInTime: a.check_in ? String(a.check_in).slice(0, 5) : undefined,
    checkOutTime: a.check_out ? String(a.check_out).slice(0, 5) : undefined,
    breakDurationMinutes: a.break_minutes || 0,
    calculatedHours: Number(a.hours_worked) || 0,
    extraHours: Number(a.extra_hours) || 0,
    dailyBaseSalary:
      a.daily_base_salary !== null && a.daily_base_salary !== undefined
        ? Number(a.daily_base_salary)
        : undefined,
    extraHourRate:
      a.extra_hour_rate !== null && a.extra_hour_rate !== undefined
        ? Number(a.extra_hour_rate)
        : undefined,
    dailyEarnedSalary: Number(a.calculated_salary) || 0,
    notes: a.notes || ''
  };
}

function mapSavingsGoalRow(g: any): SavingsGoal {
  return {
    id: g.id,
    name: g.name,
    targetAmount: Number(g.target_amount),
    currentAmount: Number(g.current_balance) || 0,
    targetDate: g.target_date || undefined,
    description: g.notes || '',
    color: g.color || undefined,
    createdAt: g.created_at,
    updatedAt: g.updated_at || undefined
  };
}

function mapSavingsTxRow(tx: any): SavingsTransaction {
  return {
    id: tx.id,
    savingsGoalId: tx.savings_goal_id,
    amount: Number(tx.amount),
    type: tx.transaction_type,
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
    amountPaid: Number(p.amount_paid) || 0,
    paidAt: p.paid_at ? String(p.paid_at).slice(0, 10) : getTodayString(),
    notes: p.notes || '',
    createdAt: p.created_at || undefined,
    updatedAt: p.updated_at || undefined
  };
}

function mapGoalRow(g: any): Goal {
  const status = g.status || 'In Progress';
  const progress =
    g.progress_percentage !== null && g.progress_percentage !== undefined
      ? Math.max(0, Math.min(100, Number(g.progress_percentage)))
      : status === 'Completed'
        ? 100
        : 0;

  return {
    id: g.id,
    title: g.title,
    description: g.description || '',
    category: g.category,
    targetAmount:
      g.target_amount !== null && g.target_amount !== undefined
        ? Number(g.target_amount)
        : undefined,
    progressPercentage: progress,
    targetDate: g.target_date || undefined,
    priority: g.priority,
    status,
    createdAt: g.created_at,
    completedAt: g.completed_at || undefined
  };
}

function mapSalaryConfigRow(row: any, fallback: SalaryConfig): SalaryConfig {
  return {
    currency: (row.currency_code as CurrencyCode) || fallback.currency,
    dailyBaseSalary:
      row.daily_base_salary !== undefined && row.daily_base_salary !== null
        ? Number(row.daily_base_salary)
        : fallback.dailyBaseSalary,
    standardWorkingHours:
      row.standard_hours !== undefined && row.standard_hours !== null
        ? Number(row.standard_hours)
        : fallback.standardWorkingHours,
    extraHourRate:
      row.extra_hour_rate !== undefined && row.extra_hour_rate !== null
        ? Number(row.extra_hour_rate)
        : fallback.extraHourRate
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
    }
  },

  getActiveUserId(): string | null {
    return activeUserId;
  },

  getFetchErrors(): FetchTableError[] {
    return [...memoryState.fetchErrors];
  },

  /**
   * Diagnostic backend integration status
   */
  getBackendStatus() {
    const active = isBackendActive();
    return {
      isBackendConfigured: active,
      persistenceMode: active ? ('supabase' as const) : ('in-memory' as const),
      statusLabel: active ? 'Supabase Connected' : 'Local Session Active',
      syncStatus: active ? 'Connected' : 'Local-First Mode',
      backendNotice: active
        ? 'Connected to your private Supabase database with Row Level Security active.'
        : 'Operating in local workspace mode.'
    };
  },

  /**
   * Cross-browser data synchronization:
   * Restores all user records from Supabase tables for the authenticated user.
   */
  async fetchAllUserData(userId: string): Promise<FetchAllResult> {
    if (!isBackendActive() || !userId) {
      return { partialErrors: [], stale: false };
    }

    const client = getClient();
    activeUserId = userId;
    const mySeq = ++fetchSequence;

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
        promise: client.from('salary_configs').select('id, user_id, daily_base_salary, standard_hours, extra_hour_rate, currency_code, created_at, updated_at').eq('user_id', userId).maybeSingle()
      }
    ] as const;

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
          message: res.reason instanceof Error ? res.reason.message : 'Request failed'
        });
        return { ok: false, data: null };
      }
      if (res.value.error) {
        partialErrors.push({
          table,
          message: res.value.error.message || 'Database query error'
        });
        return { ok: false, data: null };
      }
      return { ok: true, data: res.value.data };
    };

    const expensesRes = readResult(0);
    if (expensesRes.ok && Array.isArray(expensesRes.data)) {
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
    if (savingsGoalsRes.ok && Array.isArray(savingsGoalsRes.data)) {
      memoryState.savingsGoals = savingsGoalsRes.data.map(mapSavingsGoalRow);
    }

    const savingsTxRes = readResult(6);
    if (savingsTxRes.ok && Array.isArray(savingsTxRes.data)) {
      memoryState.savingsTransactions = savingsTxRes.data.map(mapSavingsTxRow);
    }

    const salaryPayoutsRes = readResult(7);
    if (salaryPayoutsRes.ok && Array.isArray(salaryPayoutsRes.data)) {
      memoryState.salaryPayouts = salaryPayoutsRes.data.map(mapSalaryPayoutRow);
    }

    const goalsRes = readResult(8);
    if (goalsRes.ok && Array.isArray(goalsRes.data)) {
      memoryState.goals = goalsRes.data.map(mapGoalRow);
    }

    const settingsRes = readResult(9);
    const profileRes = readResult(10);
    const salaryConfigRes = readResult(11);

    // Currency precedence: user_settings.currency_code -> salary_configs.currency_code -> 'INR'
    const savedSettingsCurrency = settingsRes.ok ? settingsRes.data?.currency_code : undefined;
    const savedSalaryCurrency = salaryConfigRes.ok ? salaryConfigRes.data?.currency_code : undefined;
    const resolvedCurrency = (savedSettingsCurrency || savedSalaryCurrency || 'INR') as CurrencyCode;

    if (settingsRes.ok) {
      const sData = settingsRes.data;
      if (sData) {
        memoryState.settings = {
          ...memoryState.settings,
          currency: resolvedCurrency,
          dateFormat: (sData.date_format as DateFormat) || memoryState.settings.dateFormat,
          weekStartDay: (sData.week_starts_on as WeekStartDay) || memoryState.settings.weekStartDay,
          customExpenseCategories:
            Array.isArray(sData.expense_categories) && sData.expense_categories.length > 0
              ? sData.expense_categories
              : memoryState.settings.customExpenseCategories,
          customIncomeSources:
            Array.isArray(sData.income_sources) && sData.income_sources.length > 0
              ? sData.income_sources
              : memoryState.settings.customIncomeSources,
          widgets: mergeWidgets(sData.dashboard_widgets, memoryState.settings.widgets)
        };
      } else {
        memoryState.settings = {
          ...memoryState.settings,
          currency: resolvedCurrency
        };
      }
    }

    if (profileRes.ok && profileRes.data) {
      memoryState.settings.profile = {
        ...memoryState.settings.profile,
        name: profileRes.data.display_name || memoryState.settings.profile.name,
        avatarUrl: profileRes.data.avatar_url || memoryState.settings.profile.avatarUrl
      };
    }

    if (salaryConfigRes.ok && salaryConfigRes.data) {
      memoryState.settings.salaryConfig = mapSalaryConfigRow(salaryConfigRes.data, {
        ...memoryState.settings.salaryConfig,
        currency: resolvedCurrency
      });
    } else if (settingsRes.ok) {
      memoryState.settings.salaryConfig = {
        ...memoryState.settings.salaryConfig,
        currency: resolvedCurrency
      };
    }

    memoryState.fetchErrors = partialErrors;
    if (partialErrors.length > 0) {
      console.warn('Partial errors during fetchAllUserData:', partialErrors);
    }

    notifyListeners();
    return { partialErrors, stale: false };
  },

  /**
   * Reset local state on user sign out / user switch
   */
  clearUserData() {
    fetchSequence += 1;
    activeUserId = null;
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
    return {
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
    const ctx = await requirePersistenceContext();
    const resolvedCurrency = bundle.currency || memoryState.settings.currency || 'INR';
    const normalizedCategories = bundle.customExpenseCategories
      .map(c => c.trim())
      .filter(Boolean);
    const normalizedSources = bundle.customIncomeSources
      .map(s => s.trim())
      .filter(Boolean);

    if (ctx.mode === 'supabase') {
      const now = new Date().toISOString();

      // 1. Update public.user_settings
      const { data: settingsData, error: settingsError } = await ctx.client
        .from('user_settings')
        .upsert(
          {
            user_id: ctx.user.id,
            currency_code: resolvedCurrency,
            date_format: bundle.dateFormat,
            week_starts_on: bundle.weekStartDay,
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
        throw new Error(settingsError?.message || 'Database error: Could not save user settings.');
      }

      // 2. Update public.salary_configs (only verified live columns)
      const { data: salaryData, error: salaryError } = await ctx.client
        .from('salary_configs')
        .upsert(
          {
            user_id: ctx.user.id,
            daily_base_salary: bundle.salaryConfig.dailyBaseSalary,
            standard_hours: bundle.salaryConfig.standardWorkingHours,
            extra_hour_rate: bundle.salaryConfig.extraHourRate,
            currency_code: resolvedCurrency,
            updated_at: now
          },
          { onConflict: 'user_id' }
        )
        .select('id, user_id, daily_base_salary, standard_hours, extra_hour_rate, currency_code, created_at, updated_at')
        .single();

      if (salaryError || !salaryData) {
        throw new Error(salaryError?.message || 'Database error: Could not save salary configuration.');
      }

      // 3. Update public.profiles if displayName provided (safe when profile row does not yet exist)
      let confirmedName = bundle.displayName !== undefined ? bundle.displayName.trim() : memoryState.settings.profile.name;
      if (bundle.displayName !== undefined) {
        const { data: profData, error: profError } = await ctx.client
          .from('profiles')
          .update({
            display_name: confirmedName,
            updated_at: now
          })
          .eq('id', ctx.user.id)
          .select('id, display_name, avatar_url')
          .maybeSingle();

        if (profError) {
          throw new Error(profError.message || 'Database error: Could not update profile display name.');
        }
        if (profData?.display_name !== undefined && profData?.display_name !== null) {
          confirmedName = profData.display_name;
        }
      }

      memoryState.settings = {
        ...memoryState.settings,
        profile: {
          ...memoryState.settings.profile,
          name: confirmedName
        },
        currency: (settingsData.currency_code as CurrencyCode) || resolvedCurrency,
        dateFormat: (settingsData.date_format as DateFormat) || bundle.dateFormat,
        weekStartDay: (settingsData.week_starts_on as WeekStartDay) || bundle.weekStartDay,
        customExpenseCategories: Array.isArray(settingsData.expense_categories)
          ? settingsData.expense_categories
          : normalizedCategories,
        customIncomeSources: Array.isArray(settingsData.income_sources)
          ? settingsData.income_sources
          : normalizedSources,
        widgets: mergeWidgets(settingsData.dashboard_widgets, bundle.widgets),
        salaryConfig: mapSalaryConfigRow(salaryData, {
          ...bundle.salaryConfig,
          currency: resolvedCurrency
        })
      };

      notifyListeners();
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
      salaryConfig: {
        ...bundle.salaryConfig,
        currency: resolvedCurrency
      }
    };
    notifyListeners();
  },

  async persistSalaryConfig(salaryConfig: SalaryConfig): Promise<void> {
    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const resolvedCurrency = salaryConfig.currency || memoryState.settings.currency || 'INR';
      const payload = {
        user_id: ctx.user.id,
        currency_code: resolvedCurrency,
        daily_base_salary: salaryConfig.dailyBaseSalary,
        standard_hours: salaryConfig.standardWorkingHours,
        extra_hour_rate: salaryConfig.extraHourRate,
        updated_at: new Date().toISOString()
      };

      const { data, error } = await ctx.client
        .from('salary_configs')
        .upsert(payload, { onConflict: 'user_id' })
        .select('id, user_id, daily_base_salary, standard_hours, extra_hour_rate, currency_code, created_at, updated_at')
        .single();

      if (error || !data) {
        throw new Error(error?.message || 'Database error: Could not save salary configuration.');
      }

      memoryState.settings = {
        ...memoryState.settings,
        salaryConfig: mapSalaryConfigRow(data, { ...salaryConfig, currency: resolvedCurrency })
      };
    } else {
      memoryState.settings = {
        ...memoryState.settings,
        salaryConfig: {
          ...memoryState.settings.salaryConfig,
          ...salaryConfig
        }
      };
    }

    notifyListeners();
  },

  // GOALS (Backed by public.goals)
  getGoals(): Goal[] {
    return [...memoryState.goals];
  },

  saveGoals(goals: Goal[]) {
    memoryState.goals = [...goals];
    notifyListeners();
  },

  async addGoal(goal: Omit<Goal, 'id' | 'createdAt'>): Promise<Goal> {
    if (!goal.title || !goal.title.trim()) {
      throw new Error('Goal title is required.');
    }

    const clampedProgress = Math.max(0, Math.min(100, Math.round(goal.progressPercentage ?? 0)));
    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const status = goal.status || 'In Progress';
      const progressVal = status === 'Completed' ? 100 : clampedProgress;
      const { data, error } = await ctx.client
        .from('goals')
        .insert({
          user_id: ctx.user.id,
          title: goal.title.trim(),
          description: goal.description || '',
          category: goal.category,
          priority: goal.priority,
          status,
          progress_percentage: progressVal,
          target_amount: goal.targetAmount ?? null,
          target_date: goal.targetDate || null,
          completed_at: status === 'Completed' ? (goal.completedAt || new Date().toISOString()) : null
        })
        .select()
        .single();

      if (error || !data) {
        throw new Error(error?.message || 'Database error: Could not create goal.');
      }

      const confirmed = mapGoalRow(data);
      memoryState.goals = [confirmed, ...memoryState.goals];
      notifyListeners();
      return confirmed;
    }

    const newGoal: Goal = {
      ...goal,
      progressPercentage: goal.status === 'Completed' ? 100 : clampedProgress,
      id: 'g_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      createdAt: getTodayString()
    };
    memoryState.goals = [newGoal, ...memoryState.goals];
    notifyListeners();
    return newGoal;
  },

  async updateGoal(id: string, updates: Partial<Goal>): Promise<void> {
    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const dbPayload: Record<string, any> = {};
      if (updates.title !== undefined) dbPayload.title = updates.title.trim();
      if (updates.description !== undefined) dbPayload.description = updates.description;
      if (updates.category !== undefined) dbPayload.category = updates.category;
      if (updates.priority !== undefined) dbPayload.priority = updates.priority;
      if (updates.status !== undefined) dbPayload.status = updates.status;
      if (updates.progressPercentage !== undefined) {
        dbPayload.progress_percentage = Math.max(0, Math.min(100, Math.round(updates.progressPercentage)));
      }
      if (updates.targetAmount !== undefined) dbPayload.target_amount = updates.targetAmount ?? null;
      if (updates.targetDate !== undefined) dbPayload.target_date = updates.targetDate || null;
      if ('completedAt' in updates) dbPayload.completed_at = updates.completedAt || null;

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
        throw new Error(error?.message || 'Database error: Could not update goal.');
      }

      const confirmed = mapGoalRow(data);
      memoryState.goals = memoryState.goals.map(g => (g.id === id ? confirmed : g));
      notifyListeners();
      return;
    }

    memoryState.goals = memoryState.goals.map(g => (g.id === id ? { ...g, ...updates } : g));
    notifyListeners();
  },

  async deleteGoal(id: string): Promise<void> {
    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const { data, error } = await ctx.client
        .from('goals')
        .delete()
        .eq('id', id)
        .eq('user_id', ctx.user.id)
        .select('id');

      if (error) {
        throw new Error(error.message || 'Database error: Could not delete goal.');
      }
      if (!data || data.length === 0) {
        throw new Error('Goal record not found or could not be deleted.');
      }
    }

    memoryState.goals = memoryState.goals.filter(g => g.id !== id);
    notifyListeners();
  },

  // EXPENSES (Backed by public.expenses)
  getExpenses(): Expense[] {
    return [...memoryState.expenses];
  },

  saveExpenses(expenses: Expense[]) {
    memoryState.expenses = [...expenses];
    notifyListeners();
  },

  async addExpense(expense: Omit<Expense, 'id' | 'createdAt'>): Promise<Expense> {
    if (expense.amount <= 0) {
      throw new Error('Expense amount must be greater than zero.');
    }
    const currentTime = new Date().toTimeString().slice(0, 5);
    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const timeVal = expense.time || currentTime;
      const formattedTime = timeVal ? (timeVal.length === 5 ? `${timeVal}:00` : timeVal) : null;

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
          notes: expense.notes ? expense.notes.trim() : null,
          is_recurring: Boolean(expense.isRecurring),
          recurrence_frequency: expense.recurringFrequency || 'None',
          recurrence_end_date: expense.recurrenceEndDate || null
        })
        .select()
        .single();

      if (error || !data) {
        throw new Error(error?.message || 'Database error: Could not save expense.');
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
      time: expense.time || currentTime,
      id: 'e_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      createdAt: getTodayString()
    };
    memoryState.expenses = [newExpense, ...memoryState.expenses];
    notifyListeners();
    return newExpense;
  },

  async updateExpense(id: string, updates: Partial<Expense>): Promise<void> {
    if (updates.amount !== undefined && updates.amount <= 0) {
      throw new Error('Expense amount must be greater than zero.');
    }

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const dbPayload: Record<string, any> = {};
      if (updates.title !== undefined) dbPayload.title = updates.title.trim();
      if (updates.amount !== undefined) dbPayload.amount = updates.amount;
      if (updates.category !== undefined) dbPayload.category = updates.category;
      if (updates.date !== undefined) dbPayload.expense_date = updates.date;
      if (updates.time !== undefined) {
        dbPayload.expense_time = updates.time ? (updates.time.length === 5 ? `${updates.time}:00` : updates.time) : null;
      }
      if (updates.paymentMethod !== undefined) dbPayload.payment_method = updates.paymentMethod;
      if (updates.notes !== undefined) dbPayload.notes = updates.notes ? updates.notes.trim() : null;
      if (updates.isRecurring !== undefined) dbPayload.is_recurring = Boolean(updates.isRecurring);
      if (updates.recurringFrequency !== undefined) dbPayload.recurrence_frequency = updates.recurringFrequency;
      if (updates.recurrenceEndDate !== undefined) dbPayload.recurrence_end_date = updates.recurrenceEndDate || null;

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
        throw new Error(error?.message || 'Database error: Could not update expense.');
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
    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const { data, error } = await ctx.client
        .from('expenses')
        .delete()
        .eq('id', id)
        .eq('user_id', ctx.user.id)
        .select('id');

      if (error) {
        throw new Error(error.message || 'Database error: Could not delete expense.');
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
    return [...memoryState.incomes];
  },

  saveIncomes(incomes: Income[]) {
    memoryState.incomes = [...incomes];
    notifyListeners();
  },

  async addIncome(income: Omit<Income, 'id' | 'createdAt'>): Promise<Income> {
    if (income.amount <= 0) {
      throw new Error('Income amount must be greater than zero.');
    }
    const currentTime = new Date().toTimeString().slice(0, 5);
    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const timeVal = income.time || currentTime;
      const formattedTime = timeVal ? (timeVal.length === 5 ? `${timeVal}:00` : timeVal) : null;

      const { data, error } = await ctx.client
        .from('incomes')
        .insert({
          user_id: ctx.user.id,
          title: income.title.trim(),
          amount: income.amount,
          source: income.source,
          income_date: income.date,
          income_time: formattedTime,
          notes: income.notes ? income.notes.trim() : null,
          salary_payout_id: income.salaryPayoutId || null
        })
        .select()
        .single();

      if (error || !data) {
        throw new Error(error?.message || 'Database error: Could not save income.');
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
    if (updates.amount !== undefined && updates.amount <= 0) {
      throw new Error('Income amount must be greater than zero.');
    }

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const dbPayload: Record<string, any> = {};
      if (updates.title !== undefined) dbPayload.title = updates.title.trim();
      if (updates.amount !== undefined) dbPayload.amount = updates.amount;
      if (updates.source !== undefined) dbPayload.source = updates.source;
      if (updates.date !== undefined) dbPayload.income_date = updates.date;
      if (updates.time !== undefined) {
        dbPayload.income_time = updates.time ? (updates.time.length === 5 ? `${updates.time}:00` : updates.time) : null;
      }
      if (updates.notes !== undefined) dbPayload.notes = updates.notes ? updates.notes.trim() : null;

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
        throw new Error(error?.message || 'Database error: Could not update income.');
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
    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const { data, error } = await ctx.client
        .from('incomes')
        .delete()
        .eq('id', id)
        .eq('user_id', ctx.user.id)
        .select('id');

      if (error) {
        throw new Error(error.message || 'Database error: Could not delete income.');
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
    return [...memoryState.attendance];
  },

  saveAttendance(records: AttendanceRecord[]) {
    memoryState.attendance = [...records];
    notifyListeners();
  },

  async upsertAttendanceRecord(record: Omit<AttendanceRecord, 'id'> & { id?: string }): Promise<AttendanceRecord> {
    const todayStr = getTodayString();
    if (record.date > todayStr) {
      throw new Error('Attendance cannot be logged for future dates.');
    }

    const salaryConfig = memoryState.settings.salaryConfig;
    let hours = record.calculatedHours || 0;
    if (record.status === 'Present' && record.checkInTime && record.checkOutTime) {
      hours = calculateWorkingHours(record.checkInTime, record.checkOutTime, record.breakDurationMinutes || 0);
    }
    const dailyRes = calculateDailyEarnedSalary(record.status, hours, salaryConfig);

    const processedRecordPayload = {
      ...record,
      status: record.status,
      calculatedHours: record.status === 'Present' ? dailyRes.workingHours : 0,
      extraHours: record.status === 'Present' ? dailyRes.extraHours : 0,
      dailyBaseSalary: salaryConfig.dailyBaseSalary,
      extraHourRate: salaryConfig.extraHourRate,
      dailyEarnedSalary: dailyRes.dailyEarnedSalary
    };

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const { data, error } = await ctx.client
        .from('attendance_records')
        .upsert(
          {
            user_id: ctx.user.id,
            attendance_date: record.date,
            status: record.status,
            check_in: record.status === 'Present' && record.checkInTime
              ? (record.checkInTime.length === 5 ? `${record.checkInTime}:00` : record.checkInTime)
              : null,
            check_out: record.status === 'Present' && record.checkOutTime
              ? (record.checkOutTime.length === 5 ? `${record.checkOutTime}:00` : record.checkOutTime)
              : null,
            break_minutes: record.status === 'Present' ? (record.breakDurationMinutes || 0) : 0,
            hours_worked: processedRecordPayload.calculatedHours,
            extra_hours: processedRecordPayload.extraHours,
            daily_base_salary: salaryConfig.dailyBaseSalary,
            extra_hour_rate: salaryConfig.extraHourRate,
            calculated_salary: processedRecordPayload.dailyEarnedSalary,
            notes: record.notes ? record.notes.trim() : null
          },
          { onConflict: 'user_id,attendance_date' }
        )
        .select()
        .single();

      if (error || !data) {
        throw new Error(error?.message || 'Database error: Could not save attendance record.');
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
        throw new Error(error.message || 'Database error: Could not delete attendance record.');
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
    return [...memoryState.savingsGoals];
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
        throw new Error(error?.message || 'Database error: Could not create savings fund.');
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
        throw new Error(error?.message || 'Database error: Could not update savings fund.');
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
        throw new Error(error.message || 'Database error: Could not delete savings fund.');
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
    return [...memoryState.savingsTransactions];
  },

  saveSavingsTransactions(txs: SavingsTransaction[]) {
    memoryState.savingsTransactions = [...txs];
    notifyListeners();
  },

  async addSavingsTransaction(tx: Omit<SavingsTransaction, 'id' | 'createdAt'>): Promise<SavingsTransaction> {
    if (tx.amount <= 0) {
      throw new Error('Transaction amount must be greater than zero.');
    }

    const targetGoal = memoryState.savingsGoals.find(g => g.id === tx.savingsGoalId);
    if (!targetGoal) {
      throw new Error('Savings goal fund not found.');
    }

    if (tx.type === 'withdrawal' && tx.amount > targetGoal.currentAmount + 0.001) {
      throw new Error('Withdrawal amount exceeds available balance.');
    }

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const { data: dbTx, error } = await ctx.client
        .from('savings_transactions')
        .insert({
          savings_goal_id: tx.savingsGoalId,
          user_id: ctx.user.id,
          transaction_type: tx.type,
          amount: tx.amount,
          transaction_date: tx.date,
          notes: tx.note ? tx.note.trim() : null
        })
        .select()
        .single();

      if (error || !dbTx) {
        throw new Error(error?.message || 'Database error: Could not record savings transaction.');
      }

      const confirmedTx = mapSavingsTxRow(dbTx);
      memoryState.savingsTransactions = [confirmedTx, ...memoryState.savingsTransactions];

      // Reconcile balance from DB trigger update (current_balance)
      const { data: refreshedGoal, error: refreshError } = await ctx.client
        .from('savings_goals')
        .select('*')
        .eq('id', tx.savingsGoalId)
        .eq('user_id', ctx.user.id)
        .single();

      if (!refreshError && refreshedGoal) {
        const mappedGoal = mapSavingsGoalRow(refreshedGoal);
        memoryState.savingsGoals = memoryState.savingsGoals.map(g =>
          g.id === mappedGoal.id ? mappedGoal : g
        );
      } else {
        const delta = tx.type === 'deposit' ? tx.amount : -tx.amount;
        const updatedAmount = Math.max(0, Number(((targetGoal.currentAmount || 0) + delta).toFixed(2)));
        memoryState.savingsGoals = memoryState.savingsGoals.map(g =>
          g.id === targetGoal.id ? { ...g, currentAmount: updatedAmount } : g
        );
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
        throw new Error(error.message || 'Database error: Could not delete savings transaction.');
      }
      if (!data || data.length === 0) {
        throw new Error('Savings transaction not found or could not be deleted.');
      }

      memoryState.savingsTransactions = memoryState.savingsTransactions.filter(t => t.id !== id);

      const { data: refreshedGoal, error: refreshError } = await ctx.client
        .from('savings_goals')
        .select('*')
        .eq('id', targetTx.savingsGoalId)
        .eq('user_id', ctx.user.id)
        .single();

      if (!refreshError && refreshedGoal) {
        const mappedGoal = mapSavingsGoalRow(refreshedGoal);
        memoryState.savingsGoals = memoryState.savingsGoals.map(g =>
          g.id === mappedGoal.id ? mappedGoal : g
        );
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
    }
    notifyListeners();
  },

  // SALARY PAYOUTS (Backed by RPCs xos_record_salary_payout & xos_delete_salary_payout)
  getSalaryPayouts(): SalaryPayout[] {
    return [...memoryState.salaryPayouts];
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
    if (payout.amountPaid < 0) {
      throw new Error('Payout amount cannot be negative.');
    }
    if (syncToIncome && payout.amountPaid <= 0) {
      throw new Error('Synced salary payout amount must be greater than zero.');
    }

    const matchingPayouts = memoryState.salaryPayouts.filter(
      p => p.periodStart === payout.periodStart && p.periodEnd === payout.periodEnd
    );
    if (matchingPayouts.length > 0 && !allowReplace) {
      throw new Error(`A salary payout for period "${payout.periodStart.slice(0, 7)}" already exists. Cannot record duplicate payout.`);
    }

    const ctx = await requirePersistenceContext();
    const periodLabel = payout.periodStart.slice(0, 7);
    const paidDate = payout.paidAt.slice(0, 10);
    const currentTimeWithSeconds = `${new Date().toTimeString().slice(0, 5)}:00`;
    const incomeTitle = `Salary Payout (${periodLabel})`;
    const incomeNotes = payout.notes?.trim()
      ? payout.notes.trim()
      : `Recorded via Salary Module (${periodLabel})`;

    if (ctx.mode === 'supabase') {
      const paidAtIso = payout.paidAt.includes('T')
        ? payout.paidAt
        : `${paidDate}T${currentTimeWithSeconds}Z`;

      const { data: rpcResult, error: rpcError } = await ctx.client.rpc('xos_record_salary_payout', {
        p_period_start: payout.periodStart,
        p_period_end: payout.periodEnd,
        p_amount_paid: payout.amountPaid,
        p_paid_at: paidAtIso,
        p_notes: payout.notes ? payout.notes.trim() : null,
        p_sync_to_income: syncToIncome,
        p_income_date: paidDate,
        p_income_time: currentTimeWithSeconds,
        p_income_title: incomeTitle,
        p_income_notes: incomeNotes,
        p_replace_existing: allowReplace
      });

      if (rpcError || !rpcResult || !rpcResult.payout) {
        const rawMsg = rpcError?.message || '';
        if (rpcError?.code === '23505' || rawMsg.toLowerCase().includes('already exists') || rawMsg.toLowerCase().includes('duplicate')) {
          throw new Error(`A salary payout for period "${periodLabel}" already exists. Enable replace existing or delete the previous payout first.`);
        }
        throw new Error(rawMsg || 'Database error: Could not record salary payout.');
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
      paidAt: paidDate,
      id: 'sp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)
    };

    if (syncToIncome) {
      const newIncome: Income = {
        title: incomeTitle,
        amount: payout.amountPaid,
        source: 'Salary' as IncomeSource,
        date: paidDate,
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
        throw new Error(rpcError.message || 'Database error: Could not delete salary payout.');
      }
    }

    memoryState.incomes = memoryState.incomes.filter(i => i.salaryPayoutId !== id);
    memoryState.salaryPayouts = memoryState.salaryPayouts.filter(p => p.id !== id);
    notifyListeners();
  },

  loadDemoData() {
    const demo = generateDemoDataset();
    memoryState.goals = [...demo.goals];
    memoryState.expenses = [...demo.expenses];
    memoryState.incomes = [...demo.incomes];
    memoryState.attendance = [...demo.attendance];
    memoryState.savingsGoals = [...demo.savingsGoals];
    memoryState.savingsTransactions = [...demo.savingsTransactions];
    memoryState.salaryPayouts = [...demo.salaryPayouts];
    memoryState.debts = [];
    memoryState.debtRepayments = [];
    memoryState.settings = { ...memoryState.settings, isDemoMode: true };
    notifyListeners();
  },

  // DEBTS (Backed by public.debts & public.debt_repayments)
  getDebts(): Debt[] {
    return [...memoryState.debts];
  },

  saveDebts(debts: Debt[]) {
    memoryState.debts = [...debts];
    notifyListeners();
  },

  async addDebt(
    debt: Omit<Debt, 'id' | 'status' | 'remaining_amount' | 'created_at' | 'updated_at'>
  ): Promise<Debt> {
    if (!debt.person_name || !debt.person_name.trim()) {
      throw new Error("Borrower's name is required.");
    }
    if (debt.original_amount <= 0) {
      throw new Error('Loan amount must be greater than zero.');
    }

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const { data, error } = await ctx.client
        .from('debts')
        .insert({
          user_id: ctx.user.id,
          person_name: debt.person_name.trim(),
          description: debt.description ? debt.description.trim() : null,
          original_amount: debt.original_amount,
          lent_date: debt.lent_date,
          due_date: debt.due_date || null,
          notes: debt.notes ? debt.notes.trim() : null
        })
        .select()
        .single();

      if (error || !data) {
        throw new Error(error?.message || 'Database error: Could not save loan record.');
      }

      const confirmedDebt = mapDebtRow(data);
      memoryState.debts = [confirmedDebt, ...memoryState.debts];
      notifyListeners();
      return confirmedDebt;
    }

    const newDebt: Debt = {
      ...debt,
      person_name: debt.person_name.trim(),
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
    updates: Partial<Pick<Debt, 'person_name' | 'original_amount' | 'lent_date' | 'due_date' | 'description' | 'notes'>>
  ): Promise<void> {
    if (updates.original_amount !== undefined && updates.original_amount <= 0) {
      throw new Error('Loan amount must be greater than zero.');
    }

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const dbPayload: Record<string, any> = {};
      if (updates.person_name !== undefined) dbPayload.person_name = updates.person_name.trim();
      if (updates.original_amount !== undefined) dbPayload.original_amount = updates.original_amount;
      if (updates.lent_date !== undefined) dbPayload.lent_date = updates.lent_date;
      if (updates.due_date !== undefined) dbPayload.due_date = updates.due_date || null;
      if (updates.description !== undefined) dbPayload.description = updates.description ? updates.description.trim() : null;
      if (updates.notes !== undefined) dbPayload.notes = updates.notes ? updates.notes.trim() : null;

      if (Object.keys(dbPayload).length === 0) {
        return;
      }

      const { data, error } = await ctx.client
        .from('debts')
        .update(dbPayload)
        .eq('id', id)
        .eq('user_id', ctx.user.id)
        .select()
        .single();

      if (error || !data) {
        throw new Error(error?.message || 'Database error: Could not update loan record.');
      }

      const confirmed = mapDebtRow(data);
      memoryState.debts = memoryState.debts.map(d => (d.id === id ? confirmed : d));
      notifyListeners();
      return;
    }

    memoryState.debts = memoryState.debts.map(d => {
      if (d.id !== id) return d;
      const nextOriginal = updates.original_amount ?? d.original_amount;
      const repaid = memoryState.debtRepayments
        .filter(r => r.debt_id === id)
        .reduce((sum, r) => sum + r.amount, 0);
      const nextRemaining = Math.max(0, Number((nextOriginal - repaid).toFixed(2)));
      const nextStatus: DebtStatus =
        nextRemaining <= 0.0001 ? 'paid' : repaid > 0 ? 'partially_paid' : 'outstanding';
      return {
        ...d,
        ...updates,
        remaining_amount: nextRemaining,
        status: nextStatus,
        updated_at: getTodayString()
      };
    });
    notifyListeners();
  },

  async deleteDebt(id: string): Promise<void> {
    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const { data, error } = await ctx.client
        .from('debts')
        .delete()
        .eq('id', id)
        .eq('user_id', ctx.user.id)
        .select('id');

      if (error) {
        throw new Error(error.message || 'Database error: Could not delete loan record.');
      }
      if (!data || data.length === 0) {
        throw new Error('Loan record not found or could not be deleted.');
      }
    }

    memoryState.debts = memoryState.debts.filter(d => d.id !== id);
    memoryState.debtRepayments = memoryState.debtRepayments.filter(r => r.debt_id !== id);
    notifyListeners();
  },

  // DEBT REPAYMENTS (Backed by public.debt_repayments)
  getDebtRepayments(): DebtRepayment[] {
    return [...memoryState.debtRepayments];
  },

  saveDebtRepayments(repayments: DebtRepayment[]) {
    memoryState.debtRepayments = [...repayments];
    notifyListeners();
  },

  async addDebtRepayment(repayment: Omit<DebtRepayment, 'id' | 'created_at'>): Promise<DebtRepayment> {
    if (repayment.amount <= 0) {
      throw new Error('Repayment amount must be greater than zero.');
    }

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

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const insertPayload: Record<string, any> = {
        debt_id: repayment.debt_id,
        user_id: ctx.user.id,
        amount: repayment.amount,
        repayment_date: repayment.repayment_date,
        notes: repayment.notes ? repayment.notes.trim() : null
      };
      if (repayment.payment_method) {
        insertPayload.payment_method = repayment.payment_method;
      }

      const { data: dbRep, error } = await ctx.client
        .from('debt_repayments')
        .insert(insertPayload)
        .select()
        .single();

      if (error || !dbRep) {
        throw new Error(error?.message || 'Database error: Could not record repayment.');
      }

      const confirmedRep = mapDebtRepaymentRow(dbRep);
      memoryState.debtRepayments = [confirmedRep, ...memoryState.debtRepayments];

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

    const totalRepaidNow = existingRepaid + repayment.amount;
    const nextRemaining = Math.max(0, Number((targetDebt.original_amount - totalRepaidNow).toFixed(2)));
    const newStatus: DebtStatus = nextRemaining <= 0.0001 ? 'paid' : 'partially_paid';
    memoryState.debts = memoryState.debts.map(d =>
      d.id === targetDebt.id ? { ...d, remaining_amount: nextRemaining, status: newStatus } : d
    );

    notifyListeners();
    return newRepayment;
  },

  async deleteDebtRepayment(id: string): Promise<void> {
    const targetRepayment = memoryState.debtRepayments.find(r => r.id === id);
    if (!targetRepayment) {
      throw new Error('Repayment record not found.');
    }

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const { data: deletedRows, error } = await ctx.client
        .from('debt_repayments')
        .delete()
        .eq('id', id)
        .eq('user_id', ctx.user.id)
        .select('id');

      if (error) {
        throw new Error(error.message || 'Database error: Could not delete repayment.');
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

      notifyListeners();
      return;
    }

    memoryState.debtRepayments = memoryState.debtRepayments.filter(r => r.id !== id);

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
    memoryState.settings = { ...createDefaultSettings(), isDemoMode: false };
    notifyListeners();
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
    if (isBackendActive() && !memoryState.settings.isDemoMode) {
      console.warn('JSON import into memory is disabled while connected to a live Supabase account.');
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
      console.error('Failed to parse in-memory JSON payload:', e);
      return false;
    }
  }
};
