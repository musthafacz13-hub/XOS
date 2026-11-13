import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AttendanceRecord,
  Debt,
  DebtRepayment,
  Expense,
  Goal,
  Income,
  SalaryConfig,
  SalaryPayout,
  SavingsGoal,
  SavingsTransaction,
  UserSettings,
  ExpenseCategory,
  PaymentMethod,
  RecurrenceFrequency,
  IncomeSource,
  CurrencyCode,
  DateFormat,
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
    salaryConfig: {
      ...DEFAULT_USER_SETTINGS.salaryConfig,
      weeklyHolidays: [...(DEFAULT_USER_SETTINGS.salaryConfig.weeklyHolidays || [])],
      allowances: [...(DEFAULT_USER_SETTINGS.salaryConfig.allowances || [])],
      deductions: [...(DEFAULT_USER_SETTINGS.salaryConfig.deductions || [])]
    },
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
    date: e.date,
    time: e.time ? String(e.time).slice(0, 5) : undefined,
    paymentMethod: (e.payment_method || 'Cash') as PaymentMethod,
    notes: e.notes || '',
    isRecurring: Boolean(e.is_recurring),
    recurringFrequency: (e.recurring_frequency || 'None') as RecurrenceFrequency,
    createdAt: e.created_at
  };
}

function mapIncomeRow(i: any): Income {
  return {
    id: i.id,
    title: i.title,
    amount: Number(i.amount),
    source: i.source as IncomeSource,
    date: i.date,
    time: i.time ? String(i.time).slice(0, 5) : undefined,
    notes: i.notes || '',
    salaryPayoutId: i.salary_payout_id || undefined,
    createdAt: i.created_at
  };
}

function mapDebtRow(d: any): Debt {
  return {
    id: d.id,
    person_name: d.person_name,
    type: d.type,
    original_amount: Number(d.original_amount),
    transaction_date: d.transaction_date,
    due_date: d.due_date || undefined,
    description: d.description || '',
    notes: d.notes || '',
    status: d.status,
    created_at: d.created_at,
    updated_at: d.updated_at
  };
}

function mapDebtRepaymentRow(r: any): DebtRepayment {
  return {
    id: r.id,
    debt_id: r.debt_id,
    amount: Number(r.amount),
    repayment_date: r.repayment_date,
    notes: r.notes || '',
    created_at: r.created_at
  };
}

function mapAttendanceRow(a: any): AttendanceRecord {
  return {
    id: a.id,
    date: a.date,
    status: a.status,
    checkInTime: a.check_in_time ? String(a.check_in_time).slice(0, 5) : undefined,
    checkOutTime: a.check_out_time ? String(a.check_out_time).slice(0, 5) : undefined,
    breakDurationMinutes: a.break_duration_minutes || 0,
    calculatedHours: Number(a.calculated_hours) || 0,
    extraHours: Number(a.extra_hours) || 0,
    dailyEarnedSalary: Number(a.daily_earned_salary) || 0,
    notes: a.notes || ''
  };
}

function mapSavingsGoalRow(g: any): SavingsGoal {
  return {
    id: g.id,
    name: g.name,
    targetAmount: Number(g.target_amount),
    currentAmount: Number(g.current_balance) || 0,
    startDate: g.created_at ? String(g.created_at).slice(0, 10) : getTodayString(),
    targetDate: g.target_date || undefined,
    description: g.notes || '',
    createdAt: g.created_at
  };
}

function mapSavingsTxRow(tx: any): SavingsTransaction {
  return {
    id: tx.id,
    savingsGoalId: tx.savings_goal_id,
    amount: Number(tx.amount),
    type: tx.type,
    date: tx.date,
    note: tx.note || '',
    createdAt: tx.created_at
  };
}

function mapSalaryPayoutRow(p: any): SalaryPayout {
  return {
    id: p.id,
    periodMonth: p.period_month,
    paymentDate: p.payment_date,
    salaryType: p.salary_type,
    baseAmount: Number(p.base_amount),
    presentDays: p.present_days,
    absentDays: p.absent_days,
    leaveDays: p.leave_days,
    holidayDays: p.holiday_days,
    totalWorkingHours: Number(p.total_working_hours),
    overtimeHours: Number(p.overtime_hours),
    grossSalary: Number(p.gross_salary),
    totalAllowances: Number(p.total_allowances),
    totalDeductions: Number(p.total_deductions),
    netSalary: Number(p.net_salary),
    status: p.status,
    notes: p.notes || ''
  };
}

function mapGoalRow(g: any): Goal {
  return {
    id: g.id,
    title: g.title,
    description: g.description || '',
    type: g.type,
    category: g.category,
    targetAmount: g.target_amount !== null && g.target_amount !== undefined ? Number(g.target_amount) : undefined,
    currentAmount: 0,
    targetDate: g.target_date || undefined,
    priority: g.priority,
    status: g.status,
    coverImage: g.cover_image || undefined,
    createdAt: g.created_at,
    completedAt: g.completed_at || undefined
  };
}

function mapSalaryConfigRow(row: any, fallback: SalaryConfig): SalaryConfig {
  return {
    ...fallback,
    currency: (row.currency_code as CurrencyCode) || fallback.currency,
    salaryType: row.salary_type || fallback.salaryType,
    dailyBaseSalary: row.daily_base_salary !== undefined && row.daily_base_salary !== null ? Number(row.daily_base_salary) : fallback.dailyBaseSalary,
    standardWorkingHours: row.standard_working_hours !== undefined && row.standard_working_hours !== null ? Number(row.standard_working_hours) : fallback.standardWorkingHours,
    extraHourRate: row.extra_hour_rate !== undefined && row.extra_hour_rate !== null ? Number(row.extra_hour_rate) : fallback.extraHourRate,
    baseAmount: row.base_amount !== undefined && row.base_amount !== null ? Number(row.base_amount) : fallback.baseAmount,
    expectedWorkingDaysPerMonth: row.expected_working_days_per_month ?? fallback.expectedWorkingDaysPerMonth,
    expectedWorkingHoursPerDay: row.expected_working_hours_per_day !== undefined && row.expected_working_hours_per_day !== null ? Number(row.expected_working_hours_per_day) : fallback.expectedWorkingHoursPerDay,
    weeklyHolidays: Array.isArray(row.weekly_holidays) ? row.weekly_holidays : fallback.weeklyHolidays,
    paidLeaveAllowancePerMonth: row.paid_leave_allowance_per_month ?? fallback.paidLeaveAllowancePerMonth,
    overtimeRateMultiplier: row.overtime_rate_multiplier !== undefined && row.overtime_rate_multiplier !== null ? Number(row.overtime_rate_multiplier) : fallback.overtimeRateMultiplier,
    paymentDateOfMonth: row.payment_date_of_month ?? fallback.paymentDateOfMonth,
    fixedMonthlyAbsencePolicy: row.fixed_monthly_absence_policy || fallback.fixedMonthlyAbsencePolicy,
    includeOvertimeInMonthly: row.include_overtime_in_monthly !== undefined && row.include_overtime_in_monthly !== null ? Boolean(row.include_overtime_in_monthly) : fallback.includeOvertimeInMonthly,
    allowances: Array.isArray(row.allowances) ? row.allowances : fallback.allowances,
    deductions: Array.isArray(row.deductions) ? row.deductions : fallback.deductions
  };
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
   * Uses Promise.allSettled + sequence guards so partial failures never overwrite valid state
   * and stale user fetches are safely discarded.
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
        promise: client.from('expenses').select('*').eq('user_id', userId).order('date', { ascending: false })
      },
      {
        table: 'incomes',
        promise: client.from('incomes').select('*').eq('user_id', userId).order('date', { ascending: false })
      },
      {
        table: 'debts',
        promise: client.from('debts').select('*').eq('user_id', userId).order('transaction_date', { ascending: false })
      },
      {
        table: 'debt_repayments',
        promise: client.from('debt_repayments').select('*').eq('user_id', userId).order('repayment_date', { ascending: false })
      },
      {
        table: 'attendance_records',
        promise: client.from('attendance_records').select('*').eq('user_id', userId).order('date', { ascending: false })
      },
      {
        table: 'savings_goals',
        promise: client.from('savings_goals').select('*').eq('user_id', userId).order('created_at', { ascending: true })
      },
      {
        table: 'savings_transactions',
        promise: client.from('savings_transactions').select('*').eq('user_id', userId).order('date', { ascending: false })
      },
      {
        table: 'salary_payouts',
        promise: client.from('salary_payouts').select('*').eq('user_id', userId).order('period_month', { ascending: false })
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
        promise: client.from('profiles').select('*').eq('id', userId).maybeSingle()
      },
      {
        table: 'salary_configs',
        promise: client.from('salary_configs').select('*').eq('user_id', userId).maybeSingle()
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
    if (settingsRes.ok) {
      const sData = settingsRes.data;
      if (sData) {
        const resolvedCurrency = sData.currency_code ? (sData.currency_code as CurrencyCode) : 'INR';
        memoryState.settings = {
          ...memoryState.settings,
          currency: resolvedCurrency,
          dateFormat: (sData.date_format as DateFormat) || memoryState.settings.dateFormat,
          weekStartDay: (sData.week_start_day as WeekStartDay) || memoryState.settings.weekStartDay,
          customExpenseCategories: Array.isArray(sData.custom_expense_categories) && sData.custom_expense_categories.length > 0
            ? sData.custom_expense_categories
            : memoryState.settings.customExpenseCategories,
          customIncomeSources: Array.isArray(sData.custom_income_sources) && sData.custom_income_sources.length > 0
            ? sData.custom_income_sources
            : memoryState.settings.customIncomeSources
        };
      } else {
        memoryState.settings = {
          ...memoryState.settings,
          currency: 'INR'
        };
      }
    }

    const profileRes = readResult(10);
    if (profileRes.ok && profileRes.data) {
      memoryState.settings.profile = {
        name: profileRes.data.display_name || memoryState.settings.profile.name,
        email: memoryState.settings.profile.email,
        occupation: profileRes.data.occupation || memoryState.settings.profile.occupation,
        tagline: profileRes.data.tagline || memoryState.settings.profile.tagline
      };
    }

    const salaryConfigRes = readResult(11);
    if (salaryConfigRes.ok && salaryConfigRes.data) {
      memoryState.settings.salaryConfig = mapSalaryConfigRow(
        salaryConfigRes.data,
        {
          ...memoryState.settings.salaryConfig,
          currency: memoryState.settings.currency
        }
      );
      if ((!settingsRes.ok || !settingsRes.data?.currency_code) && salaryConfigRes.data.currency_code) {
        memoryState.settings.currency = salaryConfigRes.data.currency_code as CurrencyCode;
      }
    } else if (settingsRes.ok) {
      memoryState.settings.salaryConfig = {
        ...memoryState.settings.salaryConfig,
        currency: memoryState.settings.currency
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
      }
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

  async persistSalaryConfig(salaryConfig: SalaryConfig): Promise<void> {
    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const resolvedCurrency = salaryConfig.currency || memoryState.settings.currency || 'INR';
      const payload = {
        user_id: ctx.user.id,
        currency_code: resolvedCurrency,
        salary_type: salaryConfig.salaryType || 'daily_wage',
        daily_base_salary: salaryConfig.dailyBaseSalary,
        standard_working_hours: salaryConfig.standardWorkingHours,
        extra_hour_rate: salaryConfig.extraHourRate,
        base_amount: salaryConfig.baseAmount ?? salaryConfig.dailyBaseSalary ?? 0,
        expected_working_days_per_month: salaryConfig.expectedWorkingDaysPerMonth ?? 26,
        expected_working_hours_per_day: salaryConfig.expectedWorkingHoursPerDay ?? salaryConfig.standardWorkingHours ?? 8,
        weekly_holidays: salaryConfig.weeklyHolidays ?? ['Sunday'],
        paid_leave_allowance_per_month: salaryConfig.paidLeaveAllowancePerMonth ?? 0,
        overtime_rate_multiplier: salaryConfig.overtimeRateMultiplier ?? 1.5,
        payment_date_of_month: salaryConfig.paymentDateOfMonth ?? 30,
        fixed_monthly_absence_policy: salaryConfig.fixedMonthlyAbsencePolicy ?? 'no_deduction',
        include_overtime_in_monthly: salaryConfig.includeOvertimeInMonthly ?? true,
        allowances: salaryConfig.allowances ?? [],
        deductions: salaryConfig.deductions ?? [],
        updated_at: new Date().toISOString()
      };

      const { data, error } = await ctx.client
        .from('salary_configs')
        .upsert(payload, { onConflict: 'user_id' })
        .select()
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

  // GOALS
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

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const { data, error } = await ctx.client
        .from('goals')
        .insert({
          user_id: ctx.user.id,
          title: goal.title.trim(),
          description: goal.description || '',
          type: goal.type,
          category: goal.category,
          target_amount: goal.targetAmount ?? null,
          target_date: goal.targetDate || null,
          priority: goal.priority,
          status: goal.status || 'In Progress',
          cover_image: goal.coverImage || null
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
      if (updates.type !== undefined) dbPayload.type = updates.type;
      if (updates.category !== undefined) dbPayload.category = updates.category;
      if (updates.targetAmount !== undefined) dbPayload.target_amount = updates.targetAmount ?? null;
      if (updates.targetDate !== undefined) dbPayload.target_date = updates.targetDate || null;
      if (updates.priority !== undefined) dbPayload.priority = updates.priority;
      if (updates.status !== undefined) dbPayload.status = updates.status;
      if (updates.coverImage !== undefined) dbPayload.cover_image = updates.coverImage || null;
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

  // EXPENSES (Backed by Supabase table public.expenses)
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
          date: expense.date,
          time: formattedTime,
          payment_method: expense.paymentMethod || 'Cash',
          notes: expense.notes ? expense.notes.trim() : null,
          is_recurring: Boolean(expense.isRecurring),
          recurring_frequency: expense.recurringFrequency || 'None'
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
      if (updates.date !== undefined) dbPayload.date = updates.date;
      if (updates.time !== undefined) {
        dbPayload.time = updates.time ? (updates.time.length === 5 ? `${updates.time}:00` : updates.time) : null;
      }
      if (updates.paymentMethod !== undefined) dbPayload.payment_method = updates.paymentMethod;
      if (updates.notes !== undefined) dbPayload.notes = updates.notes ? updates.notes.trim() : null;
      if (updates.isRecurring !== undefined) dbPayload.is_recurring = Boolean(updates.isRecurring);
      if (updates.recurringFrequency !== undefined) dbPayload.recurring_frequency = updates.recurringFrequency;

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

  // INCOMES (Backed by Supabase table public.incomes)
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
          date: income.date,
          time: formattedTime,
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
      if (updates.date !== undefined) dbPayload.date = updates.date;
      if (updates.time !== undefined) {
        dbPayload.time = updates.time ? (updates.time.length === 5 ? `${updates.time}:00` : updates.time) : null;
      }
      if (updates.notes !== undefined) dbPayload.notes = updates.notes ? updates.notes.trim() : null;

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

  // ATTENDANCE (Backed by Supabase table public.attendance_records)
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

    let hours = record.calculatedHours || 0;
    if (record.status === 'Present' && record.checkInTime && record.checkOutTime) {
      hours = calculateWorkingHours(record.checkInTime, record.checkOutTime, record.breakDurationMinutes || 0);
    }
    const dailyRes = calculateDailyEarnedSalary(record.status, hours, memoryState.settings.salaryConfig);

    const processedRecordPayload = {
      ...record,
      status: record.status,
      calculatedHours: record.status === 'Present' ? hours : 0,
      extraHours: record.status === 'Present' ? dailyRes.extraHours : 0,
      dailyEarnedSalary: dailyRes.dailyEarnedSalary
    };

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const { data, error } = await ctx.client
        .from('attendance_records')
        .upsert(
          {
            user_id: ctx.user.id,
            date: record.date,
            status: record.status,
            check_in_time: record.status === 'Present' && record.checkInTime
              ? (record.checkInTime.length === 5 ? `${record.checkInTime}:00` : record.checkInTime)
              : null,
            check_out_time: record.status === 'Present' && record.checkOutTime
              ? (record.checkOutTime.length === 5 ? `${record.checkOutTime}:00` : record.checkOutTime)
              : null,
            break_duration_minutes: record.status === 'Present' ? (record.breakDurationMinutes || 0) : 0,
            calculated_hours: processedRecordPayload.calculatedHours,
            extra_hours: processedRecordPayload.extraHours,
            daily_earned_salary: processedRecordPayload.dailyEarnedSalary,
            notes: record.notes ? record.notes.trim() : null
          },
          { onConflict: 'user_id,date' }
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

  // SAVINGS GOALS & TRANSACTIONS
  getSavingsGoals(): SavingsGoal[] {
    return [...memoryState.savingsGoals];
  },

  saveSavingsGoals(goals: SavingsGoal[]) {
    memoryState.savingsGoals = [...goals];
    notifyListeners();
  },

  async addSavingsGoal(
    goal: Omit<SavingsGoal, 'id' | 'createdAt' | 'currentAmount'> & { initialDeposit?: number }
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
      const { data: dbGoal, error } = await ctx.client
        .from('savings_goals')
        .insert({
          user_id: ctx.user.id,
          name: goal.name.trim(),
          target_amount: goal.targetAmount,
          target_date: goal.targetDate || null,
          notes: goal.description ? goal.description.trim() : null
        })
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
            date: goal.startDate || getTodayString(),
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
      startDate: goal.startDate,
      targetDate: goal.targetDate,
      description: goal.description,
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
        date: goal.startDate,
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
      const dbPayload: Record<string, any> = {
        updated_at: new Date().toISOString()
      };
      if (updates.name !== undefined) dbPayload.name = updates.name.trim();
      if (updates.targetAmount !== undefined) dbPayload.target_amount = updates.targetAmount;
      if (updates.targetDate !== undefined) dbPayload.target_date = updates.targetDate || null;
      if (updates.description !== undefined) dbPayload.notes = updates.description ? updates.description.trim() : null;

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

    if (tx.type === 'withdrawal' && tx.amount > targetGoal.currentAmount) {
      throw new Error('Withdrawal amount exceeds available balance.');
    }

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const { data: dbTx, error } = await ctx.client
        .from('savings_transactions')
        .insert({
          savings_goal_id: tx.savingsGoalId,
          user_id: ctx.user.id,
          amount: tx.amount,
          type: tx.type,
          date: tx.date,
          note: tx.note ? tx.note.trim() : null
        })
        .select()
        .single();

      if (error || !dbTx) {
        throw new Error(error?.message || 'Database error: Could not record savings transaction.');
      }

      const confirmedTx = mapSavingsTxRow(dbTx);
      memoryState.savingsTransactions = [confirmedTx, ...memoryState.savingsTransactions];

      // Reconcile balance from DB trigger update (trg_sync_savings_balance)
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
        const updatedAmount = Math.max(0, (targetGoal.currentAmount || 0) + delta);
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
    const updatedAmount = Math.max(0, (targetGoal.currentAmount || 0) + delta);
    memoryState.savingsGoals = memoryState.savingsGoals.map(g =>
      g.id === targetGoal.id ? { ...g, currentAmount: updatedAmount } : g
    );

    notifyListeners();
    return newTx;
  },

  // SALARY PAYOUTS
  getSalaryPayouts(): SalaryPayout[] {
    return [...memoryState.salaryPayouts];
  },

  saveSalaryPayouts(payouts: SalaryPayout[]) {
    memoryState.salaryPayouts = [...payouts];
    notifyListeners();
  },

  getPayoutByPeriod(periodMonth: string): SalaryPayout | undefined {
    return memoryState.salaryPayouts.find(p => p.periodMonth === periodMonth);
  },

  async recordSalaryPayout(
    payout: Omit<SalaryPayout, 'id'>,
    syncToIncome: boolean = true,
    allowReplace: boolean = false
  ): Promise<SalaryPayout> {
    if (payout.netSalary < 0) {
      throw new Error('Net salary cannot be negative.');
    }
    if (syncToIncome && payout.netSalary <= 0) {
      throw new Error('Synced salary payout amount must be greater than zero.');
    }

    const existingIndex = memoryState.salaryPayouts.findIndex(p => p.periodMonth === payout.periodMonth);
    if (existingIndex !== -1 && !allowReplace) {
      throw new Error(`A salary payout for period "${payout.periodMonth}" already exists. Cannot record duplicate payout.`);
    }

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      let replacedIncomeIds: string[] = [];
      let replacedPayoutId: string | undefined;

      if (allowReplace) {
        const { data: existingDbPayout, error: lookupError } = await ctx.client
          .from('salary_payouts')
          .select('id')
          .eq('user_id', ctx.user.id)
          .eq('period_month', payout.periodMonth)
          .maybeSingle();

        if (lookupError) {
          throw new Error(lookupError.message || 'Database error checking existing payout period.');
        }

        if (existingDbPayout) {
          replacedPayoutId = existingDbPayout.id;
          // Delete linked income record(s) first using one-way FK incomes.salary_payout_id -> salary_payouts.id
          const { data: deletedOldIncomes, error: delOldIncErr } = await ctx.client
            .from('incomes')
            .delete()
            .eq('salary_payout_id', existingDbPayout.id)
            .eq('user_id', ctx.user.id)
            .select('id');

          if (delOldIncErr) {
            throw new Error(delOldIncErr.message || 'Could not remove previous synced income during payout replacement.');
          }
          if (Array.isArray(deletedOldIncomes)) {
            replacedIncomeIds = deletedOldIncomes.map((row: any) => row.id);
          }

          const { error: delOldPayoutErr } = await ctx.client
            .from('salary_payouts')
            .delete()
            .eq('id', existingDbPayout.id)
            .eq('user_id', ctx.user.id);

          if (delOldPayoutErr) {
            throw new Error(delOldPayoutErr.message || 'Could not replace existing salary payout.');
          }
        }
      }

      // Sequential 2-request client workflow (not an atomic DB transaction):
      // Request 1: Insert salary payout row and receive its PostgreSQL UUID.
      const { data: dbPayout, error: payoutError } = await ctx.client
        .from('salary_payouts')
        .insert({
          user_id: ctx.user.id,
          period_month: payout.periodMonth,
          payment_date: payout.paymentDate,
          salary_type: payout.salaryType || 'daily_wage',
          base_amount: payout.baseAmount,
          present_days: payout.presentDays,
          absent_days: payout.absentDays,
          leave_days: payout.leaveDays,
          holiday_days: payout.holidayDays,
          total_working_hours: payout.totalWorkingHours,
          overtime_hours: payout.overtimeHours,
          gross_salary: payout.grossSalary,
          total_allowances: payout.totalAllowances,
          total_deductions: payout.totalDeductions,
          net_salary: payout.netSalary,
          status: payout.status || 'Paid',
          notes: payout.notes ? payout.notes.trim() : null
        })
        .select()
        .single();

      if (payoutError || !dbPayout) {
        const msg = payoutError?.code === '23505' || payoutError?.message?.includes('unique_user_salary_period')
          ? `A salary payout for period "${payout.periodMonth}" already exists. Cannot record duplicate payout.`
          : payoutError?.message || 'Database error: Could not save salary payout.';
        throw new Error(msg);
      }

      const confirmedPayout = mapSalaryPayoutRow(dbPayout);
      let confirmedIncome: Income | null = null;

      // Request 2: Insert linked income pointing via one-way FK incomes.salary_payout_id -> salary_payouts.id.
      if (syncToIncome) {
        const { data: dbIncome, error: incomeError } = await ctx.client
          .from('incomes')
          .insert({
            user_id: ctx.user.id,
            title: `Salary Payout (${payout.periodMonth})`,
            amount: payout.netSalary,
            source: 'Salary',
            date: payout.paymentDate,
            time: new Date().toTimeString().slice(0, 5) + ':00',
            notes: `Recorded via Salary Module. Net Salary: ${payout.netSalary}`,
            salary_payout_id: dbPayout.id
          })
          .select()
          .single();

        if (incomeError || !dbIncome) {
          // Best-effort compensating delete for Request 1 payout if Request 2 fails
          const { error: cleanupError } = await ctx.client
            .from('salary_payouts')
            .delete()
            .eq('id', dbPayout.id)
            .eq('user_id', ctx.user.id);

          if (cleanupError) {
            throw new Error(
              `Could not create linked salary income (${incomeError?.message || 'unknown error'}), and compensating deletion of payout ${dbPayout.id} failed (${cleanupError.message}).`
            );
          }
          throw new Error(incomeError?.message || 'Database error: Could not create linked salary income.');
        }

        confirmedIncome = mapIncomeRow(dbIncome);
      }

      // Reconcile memory state only after DB requests succeed
      let nextIncomes = memoryState.incomes.filter(
        i =>
          !replacedIncomeIds.includes(i.id) &&
          (!replacedPayoutId || i.salaryPayoutId !== replacedPayoutId)
      );
      if (existingIndex !== -1 && allowReplace) {
        const oldMemPayout = memoryState.salaryPayouts[existingIndex];
        nextIncomes = nextIncomes.filter(i => i.salaryPayoutId !== oldMemPayout.id);
      }
      if (confirmedIncome) {
        nextIncomes = [confirmedIncome, ...nextIncomes];
      }
      memoryState.incomes = nextIncomes;

      const nextPayouts = memoryState.salaryPayouts.filter(
        p => p.id !== replacedPayoutId && (!allowReplace || p.periodMonth !== payout.periodMonth)
      );
      memoryState.salaryPayouts = [confirmedPayout, ...nextPayouts];

      notifyListeners();
      return confirmedPayout;
    }

    // Local / unconfigured / test-runner mode
    let remainingPayouts = memoryState.salaryPayouts;
    if (existingIndex !== -1 && allowReplace) {
      const oldPayout = memoryState.salaryPayouts[existingIndex];
      memoryState.incomes = memoryState.incomes.filter(i => i.salaryPayoutId !== oldPayout.id);
      remainingPayouts = memoryState.salaryPayouts.filter((_, idx) => idx !== existingIndex);
    }

    const newPayout: SalaryPayout = {
      ...payout,
      id: 'sp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)
    };

    if (syncToIncome) {
      const newIncome: Income = {
        title: `Salary Payout (${payout.periodMonth})`,
        amount: payout.netSalary,
        source: 'Salary' as IncomeSource,
        date: payout.paymentDate,
        notes: `Recorded via Salary Module. Net Salary: ${payout.netSalary}`,
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
      // Delete linked income record(s) first using one-way FK incomes.salary_payout_id -> salary_payouts.id
      const { error: delIncError } = await ctx.client
        .from('incomes')
        .delete()
        .eq('salary_payout_id', id)
        .eq('user_id', ctx.user.id);

      if (delIncError) {
        throw new Error(delIncError.message || 'Database error: Could not delete linked salary income.');
      }

      const { data: deletedRows, error: delPayoutError } = await ctx.client
        .from('salary_payouts')
        .delete()
        .eq('id', id)
        .eq('user_id', ctx.user.id)
        .select('id');

      if (delPayoutError) {
        throw new Error(delPayoutError.message || 'Database error: Could not delete salary payout.');
      }
      if (!deletedRows || deletedRows.length === 0) {
        throw new Error('Salary payout record not found or could not be deleted.');
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
    memoryState.settings = { ...memoryState.settings, isDemoMode: true };
    notifyListeners();
  },

  // DEBTS
  getDebts(): Debt[] {
    return [...memoryState.debts];
  },

  saveDebts(debts: Debt[]) {
    memoryState.debts = [...debts];
    notifyListeners();
  },

  async addDebt(debt: Omit<Debt, 'id' | 'status' | 'created_at'>): Promise<Debt> {
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
          type: debt.type || 'lent',
          original_amount: debt.original_amount,
          transaction_date: debt.transaction_date,
          due_date: debt.due_date || null,
          description: debt.description ? debt.description.trim() : null,
          notes: debt.notes ? debt.notes.trim() : null,
          status: 'Pending'
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
      type: debt.type || 'lent',
      id: 'd_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      status: 'Pending',
      created_at: getTodayString()
    };
    memoryState.debts = [newDebt, ...memoryState.debts];
    notifyListeners();
    return newDebt;
  },

  async updateDebt(id: string, updates: Partial<Debt>): Promise<void> {
    if (updates.original_amount !== undefined && updates.original_amount <= 0) {
      throw new Error('Loan amount must be greater than zero.');
    }

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const dbPayload: Record<string, any> = {};
      if (updates.person_name !== undefined) dbPayload.person_name = updates.person_name.trim();
      if (updates.original_amount !== undefined) dbPayload.original_amount = updates.original_amount;
      if (updates.transaction_date !== undefined) dbPayload.transaction_date = updates.transaction_date;
      if (updates.due_date !== undefined) dbPayload.due_date = updates.due_date || null;
      if (updates.description !== undefined) dbPayload.description = updates.description ? updates.description.trim() : null;
      if (updates.notes !== undefined) dbPayload.notes = updates.notes ? updates.notes.trim() : null;
      if (updates.status !== undefined) dbPayload.status = updates.status;

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
      return {
        ...d,
        ...updates,
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

  // DEBT REPAYMENTS
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

    const remainingDebt = Number((targetDebt.original_amount - existingRepaid).toFixed(2));
    if (repayment.amount > remainingDebt + 0.0001) {
      throw new Error(`Repayment amount exceeds remaining debt balance (${remainingDebt}).`);
    }

    const ctx = await requirePersistenceContext();

    if (ctx.mode === 'supabase') {
      const { data: dbRep, error } = await ctx.client
        .from('debt_repayments')
        .insert({
          debt_id: repayment.debt_id,
          user_id: ctx.user.id,
          amount: repayment.amount,
          repayment_date: repayment.repayment_date,
          notes: repayment.notes ? repayment.notes.trim() : null
        })
        .select()
        .single();

      if (error || !dbRep) {
        throw new Error(error?.message || 'Database error: Could not record repayment.');
      }

      const confirmedRep = mapDebtRepaymentRow(dbRep);
      memoryState.debtRepayments = [confirmedRep, ...memoryState.debtRepayments];

      // Reconcile parent debt status updated by DB trigger trg_sync_debt_status
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
        const totalRepaidNow = existingRepaid + repayment.amount;
        const newStatus = totalRepaidNow >= targetDebt.original_amount ? 'Paid' : 'Partial';
        memoryState.debts = memoryState.debts.map(d =>
          d.id === targetDebt.id ? { ...d, status: newStatus } : d
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
    const newStatus = totalRepaidNow >= targetDebt.original_amount ? 'Paid' : 'Partial';
    memoryState.debts = memoryState.debts.map(d =>
      d.id === targetDebt.id ? { ...d, status: newStatus } : d
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
          const updatedStatus = remainingRepayments >= targetDebt.original_amount
            ? 'Paid'
            : remainingRepayments > 0
              ? 'Partial'
              : 'Pending';
          memoryState.debts = memoryState.debts.map(d =>
            d.id === targetDebt.id ? { ...d, status: updatedStatus } : d
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

      const updatedStatus = remainingRepayments >= targetDebt.original_amount
        ? 'Paid'
        : remainingRepayments > 0
          ? 'Partial'
          : 'Pending';

      memoryState.debts = memoryState.debts.map(d =>
        d.id === targetDebt.id ? { ...d, status: updatedStatus } : d
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
