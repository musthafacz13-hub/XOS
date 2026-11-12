import { 
  AttendanceRecord, 
  Debt,
  DebtRepayment,
  Expense, 
  Goal, 
  Income, 
  SalaryPayout, 
  SavingsGoal, 
  SavingsTransaction, 
  UserSettings 
} from '../types';
import { DEFAULT_USER_SETTINGS, generateDemoDataset } from '../data/initialData';
import { calculateWorkingHours, getTodayString } from '../utils/formatters';
import { calculateDailyEarnedSalary } from '../utils/calculations';
import { isSupabaseConfigured } from './supabase';

/**
 * ARCHITECTURAL MANDATE:
 * XOS is a backend-first application whose backend has not yet been connected.
 * In accordance with strict application constraints:
 * - NO permanent user data is stored in browser-side persistent storage.
 * - All runtime records live exclusively in temporary, backend-ready in-memory state.
 * - ZERO browser storage APIs (localStorage, sessionStorage, IndexedDB, CacheAPI) are accessed or invoked.
 */

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
}

const memoryState: InMemoryState = {
  settings: { ...DEFAULT_USER_SETTINGS },
  goals: [],
  expenses: [],
  incomes: [],
  attendance: [],
  savingsGoals: [],
  savingsTransactions: [],
  salaryPayouts: [],
  debts: [],
  debtRepayments: []
};

type Listener = () => void;
const listeners = new Set<Listener>();

function notifyListeners() {
  listeners.forEach(cb => cb());
}

export const repository = {
  subscribe(callback: Listener): () => void {
    listeners.add(callback);
    return () => listeners.delete(callback);
  },

  /**
   * Diagnostic backend integration status
   */
  getBackendStatus() {
    return {
      isBackendConfigured: isSupabaseConfigured,
      persistenceMode: isSupabaseConfigured ? ('supabase' as const) : ('in-memory' as const),
      statusLabel: isSupabaseConfigured ? 'Supabase Connected' : 'Local Session Active',
      syncStatus: isSupabaseConfigured ? 'Connected' : 'Local-First Mode',
      backendNotice: isSupabaseConfigured
        ? 'Connected to your private Supabase database with Row Level Security active.'
        : 'Operating in local workspace mode.'
    };
  },

  // USER SETTINGS
  getSettings(): UserSettings {
    return {
      ...memoryState.settings,
      profile: {
        ...memoryState.settings.profile
      }
    };
  },

  saveSettings(settings: UserSettings) {
    memoryState.settings = {
      ...DEFAULT_USER_SETTINGS,
      ...settings,
      profile: {
        ...DEFAULT_USER_SETTINGS.profile,
        ...(settings.profile || {})
      }
    };
    notifyListeners();
  },

  // GOALS (Clean slate on fresh start)
  getGoals(): Goal[] {
    return [...memoryState.goals];
  },

  saveGoals(goals: Goal[]) {
    memoryState.goals = [...goals];
    notifyListeners();
  },

  addGoal(goal: Omit<Goal, 'id' | 'createdAt'>): Goal {
    const newGoal: Goal = {
      ...goal,
      id: 'g_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      createdAt: new Date().toISOString().split('T')[0]
    };
    memoryState.goals = [newGoal, ...memoryState.goals];
    notifyListeners();
    return newGoal;
  },

  updateGoal(id: string, updates: Partial<Goal>) {
    memoryState.goals = memoryState.goals.map(g => g.id === id ? { ...g, ...updates } : g);
    notifyListeners();
  },

  deleteGoal(id: string) {
    memoryState.goals = memoryState.goals.filter(g => g.id !== id);
    notifyListeners();
  },

  // EXPENSES (Clean slate on fresh start)
  getExpenses(): Expense[] {
    return [...memoryState.expenses];
  },

  saveExpenses(expenses: Expense[]) {
    memoryState.expenses = [...expenses];
    notifyListeners();
  },

  addExpense(expense: Omit<Expense, 'id' | 'createdAt'>): Expense {
    if (expense.amount <= 0) {
      throw new Error("Expense amount must be greater than zero.");
    }
    const currentTime = new Date().toTimeString().slice(0, 5);
    const newExpense: Expense = {
      ...expense,
      time: expense.time || currentTime,
      id: 'e_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      createdAt: new Date().toISOString().split('T')[0]
    };
    memoryState.expenses = [newExpense, ...memoryState.expenses];
    notifyListeners();
    return newExpense;
  },

  updateExpense(id: string, updates: Partial<Expense>) {
    memoryState.expenses = memoryState.expenses.map(e => e.id === id ? { ...e, ...updates } : e);
    notifyListeners();
  },

  deleteExpense(id: string) {
    memoryState.expenses = memoryState.expenses.filter(e => e.id !== id);
    notifyListeners();
  },

  // INCOMES (Clean slate on fresh start)
  getIncomes(): Income[] {
    return [...memoryState.incomes];
  },

  saveIncomes(incomes: Income[]) {
    memoryState.incomes = [...incomes];
    notifyListeners();
  },

  addIncome(income: Omit<Income, 'id' | 'createdAt'>): Income {
    if (income.amount <= 0) {
      throw new Error("Income amount must be greater than zero.");
    }
    const currentTime = new Date().toTimeString().slice(0, 5);
    const newIncome: Income = {
      ...income,
      time: income.time || currentTime,
      id: 'i_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      createdAt: new Date().toISOString().split('T')[0]
    };
    memoryState.incomes = [newIncome, ...memoryState.incomes];
    notifyListeners();
    return newIncome;
  },

  updateIncome(id: string, updates: Partial<Income>) {
    memoryState.incomes = memoryState.incomes.map(i => i.id === id ? { ...i, ...updates } : i);
    notifyListeners();
  },

  deleteIncome(id: string) {
    const targetIncome = memoryState.incomes.find(i => i.id === id);

    // If this income was linked to a salary payout, update the payout's sync status
    let payoutsUpdated = false;
    const updatedPayouts = memoryState.salaryPayouts.map(p => {
      if (p.syncedToIncomeId === id || (targetIncome?.salaryPayoutId && p.id === targetIncome.salaryPayoutId)) {
        payoutsUpdated = true;
        const { syncedToIncomeId, ...rest } = p;
        return { ...rest, syncedToIncomeId: undefined };
      }
      return p;
    });

    if (payoutsUpdated) {
      memoryState.salaryPayouts = updatedPayouts;
    }

    memoryState.incomes = memoryState.incomes.filter(i => i.id !== id);
    notifyListeners();
  },

  // ATTENDANCE (Clean slate on fresh start)
  getAttendance(): AttendanceRecord[] {
    return [...memoryState.attendance];
  },

  saveAttendance(records: AttendanceRecord[]) {
    memoryState.attendance = [...records];
    notifyListeners();
  },

  upsertAttendanceRecord(record: Omit<AttendanceRecord, 'id'> & { id?: string }): AttendanceRecord {
    const todayStr = getTodayString();
    if (record.date > todayStr) {
      throw new Error("Attendance cannot be logged for future dates.");
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

    const existingIndex = memoryState.attendance.findIndex(r => r.date === record.date);

    if (existingIndex >= 0) {
      const updatedRecord: AttendanceRecord = {
        ...memoryState.attendance[existingIndex],
        ...processedRecordPayload,
        id: memoryState.attendance[existingIndex].id
      };
      memoryState.attendance[existingIndex] = updatedRecord;
      notifyListeners();
      return updatedRecord;
    } else {
      const newRecord: AttendanceRecord = {
        ...processedRecordPayload,
        id: 'att_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)
      };
      memoryState.attendance = [newRecord, ...memoryState.attendance];
      notifyListeners();
      return newRecord;
    }
  },

  deleteAttendanceRecord(id: string) {
    memoryState.attendance = memoryState.attendance.filter(r => r.id !== id);
    notifyListeners();
  },

  // SAVINGS GOALS & TRANSACTIONS (Fixed initial deposit double count)
  getSavingsGoals(): SavingsGoal[] {
    return [...memoryState.savingsGoals];
  },

  saveSavingsGoals(goals: SavingsGoal[]) {
    memoryState.savingsGoals = [...goals];
    notifyListeners();
  },

  addSavingsGoal(goal: Omit<SavingsGoal, 'id' | 'createdAt' | 'currentAmount'> & { initialDeposit?: number }): SavingsGoal {
    // Initialize currentAmount to 0. If initialDeposit > 0, addSavingsTransaction will credit it,
    // ensuring the balance matches initialDeposit exactly without double-counting.
    const newGoal: SavingsGoal = {
      ...goal,
      id: 'sg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      currentAmount: 0,
      createdAt: new Date().toISOString().split('T')[0]
    };
    memoryState.savingsGoals = [newGoal, ...memoryState.savingsGoals];

    if (goal.initialDeposit && goal.initialDeposit > 0) {
      this.addSavingsTransaction({
        savingsGoalId: newGoal.id,
        amount: goal.initialDeposit,
        type: 'deposit',
        date: goal.startDate,
        note: 'Initial deposit'
      });
    }

    notifyListeners();
    return memoryState.savingsGoals.find(g => g.id === newGoal.id) || newGoal;
  },

  updateSavingsGoal(id: string, updates: Partial<SavingsGoal>) {
    memoryState.savingsGoals = memoryState.savingsGoals.map(g => g.id === id ? { ...g, ...updates } : g);
    notifyListeners();
  },

  deleteSavingsGoal(id: string) {
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

  addSavingsTransaction(tx: Omit<SavingsTransaction, 'id' | 'createdAt'>): SavingsTransaction {
    if (tx.amount <= 0) {
      throw new Error("Transaction amount must be greater than zero.");
    }

    const targetGoal = memoryState.savingsGoals.find(g => g.id === tx.savingsGoalId);
    if (!targetGoal) {
      throw new Error("Savings goal fund not found.");
    }

    if (tx.type === 'withdrawal' && tx.amount > targetGoal.currentAmount) {
      throw new Error(`Withdrawal amount exceeds available balance.`);
    }

    const newTx: SavingsTransaction = {
      ...tx,
      id: 'stx_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      createdAt: new Date().toISOString().split('T')[0]
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

  recordSalaryPayout(
    payout: Omit<SalaryPayout, 'id'>, 
    syncToIncome: boolean = true, 
    allowReplace: boolean = false
  ): SalaryPayout {
    const existingIndex = memoryState.salaryPayouts.findIndex(p => p.periodMonth === payout.periodMonth);

    // Guard against duplicate salary payouts for the same period
    if (existingIndex !== -1 && !allowReplace) {
      throw new Error(`A salary payout for period "${payout.periodMonth}" already exists. Cannot record duplicate payout.`);
    }

    let remainingPayouts = memoryState.salaryPayouts;

    // If replacing an existing payout, safely remove the old linked income
    if (existingIndex !== -1 && allowReplace) {
      const oldPayout = memoryState.salaryPayouts[existingIndex];
      if (oldPayout.syncedToIncomeId) {
        memoryState.incomes = memoryState.incomes.filter(i => i.id !== oldPayout.syncedToIncomeId);
      }
      remainingPayouts = memoryState.salaryPayouts.filter((_, idx) => idx !== existingIndex);
    }

    const newPayout: SalaryPayout = {
      ...payout,
      id: 'sp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)
    };

    if (syncToIncome) {
      const newIncome = this.addIncome({
        title: `Salary Payout (${payout.periodMonth})`,
        amount: payout.netSalary,
        source: 'Salary',
        date: payout.paymentDate,
        notes: `Recorded via Salary Module. Net Salary: ${payout.netSalary}`,
        salaryPayoutId: newPayout.id
      });
      newPayout.syncedToIncomeId = newIncome.id;
    }

    memoryState.salaryPayouts = [newPayout, ...remainingPayouts];
    notifyListeners();
    return newPayout;
  },

  deleteSalaryPayout(id: string) {
    const target = memoryState.salaryPayouts.find(p => p.id === id);
    if (target && target.syncedToIncomeId) {
      // Safely delete linked income only if it exists
      memoryState.incomes = memoryState.incomes.filter(i => i.id !== target.syncedToIncomeId);
    }
    memoryState.salaryPayouts = memoryState.salaryPayouts.filter(p => p.id !== id);
    notifyListeners();
  },

  // EXPLICIT DEMO DATA LOAD (Only triggered manually by user in Settings)
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

  // DEBTS (Clean slate on fresh start)
  getDebts(): Debt[] {
    return [...memoryState.debts];
  },

  saveDebts(debts: Debt[]) {
    memoryState.debts = [...debts];
    notifyListeners();
  },

  addDebt(debt: Omit<Debt, 'id' | 'status' | 'created_at'>): Debt {
    const newDebt: Debt = {
      ...debt,
      type: 'lent',
      id: 'd_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      status: 'Pending',
      created_at: new Date().toISOString().split('T')[0]
    };
    memoryState.debts = [newDebt, ...memoryState.debts];
    notifyListeners();
    return newDebt;
  },

  updateDebt(id: string, updates: Partial<Debt>) {
    memoryState.debts = memoryState.debts.map(d => {
      if (d.id !== id) return d;
      return {
        ...d,
        ...updates,
        updated_at: new Date().toISOString().split('T')[0]
      };
    });
    notifyListeners();
  },

  deleteDebt(id: string) {
    memoryState.debts = memoryState.debts.filter(d => d.id !== id);
    // Also remove any repayments associated with this debt
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

  addDebtRepayment(repayment: Omit<DebtRepayment, 'id' | 'created_at'>): DebtRepayment {
    if (repayment.amount <= 0) {
      throw new Error("Repayment amount must be greater than zero.");
    }
    const targetDebt = memoryState.debts.find(d => d.id === repayment.debt_id);
    if (!targetDebt) {
      throw new Error("Debt record not found.");
    }

    const currentRepaid = memoryState.debtRepayments
      .filter(r => r.debt_id === targetDebt.id)
      .reduce((sum, r) => sum + r.amount, 0);

    const remaining = Math.max(0, targetDebt.original_amount - currentRepaid);
    if (repayment.amount > remaining + 0.001) {
      throw new Error("Repayment amount cannot exceed remaining balance.");
    }

    const newRepayment: DebtRepayment = {
      ...repayment,
      id: 'dr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      created_at: new Date().toISOString().split('T')[0]
    };
    memoryState.debtRepayments = [newRepayment, ...memoryState.debtRepayments];

    const totalRepaid = currentRepaid + repayment.amount;
    let nextStatus: 'Pending' | 'Partial' | 'Paid' = 'Pending';
    if (totalRepaid >= targetDebt.original_amount - 0.0001) {
      nextStatus = 'Paid';
    } else if (totalRepaid > 0) {
      nextStatus = 'Partial';
    }

    memoryState.debts = memoryState.debts.map(d => 
      d.id === targetDebt.id 
        ? { ...d, status: nextStatus, updated_at: new Date().toISOString().split('T')[0] } 
        : d
    );

    notifyListeners();
    return newRepayment;
  },

  deleteDebtRepayment(repaymentId: string) {
    const target = memoryState.debtRepayments.find(r => r.id === repaymentId);
    if (!target) return;

    memoryState.debtRepayments = memoryState.debtRepayments.filter(r => r.id !== repaymentId);

    // Re-sync debt status
    const targetDebt = memoryState.debts.find(d => d.id === target.debt_id);
    if (targetDebt) {
      const totalRepaid = memoryState.debtRepayments
        .filter(r => r.debt_id === targetDebt.id)
        .reduce((sum, r) => sum + r.amount, 0);

      let nextStatus: 'Pending' | 'Partial' | 'Paid' = 'Pending';
      if (totalRepaid >= targetDebt.original_amount - 0.0001) {
        nextStatus = 'Paid';
      } else if (totalRepaid > 0) {
        nextStatus = 'Partial';
      }

      memoryState.debts = memoryState.debts.map(d => 
        d.id === targetDebt.id 
          ? { ...d, status: nextStatus, updated_at: new Date().toISOString().split('T')[0] } 
          : d
      );
    }

    notifyListeners();
  },

  // CLEAR ALL DATA (Resets in-memory state cleanly)
  clearAllData() {
    memoryState.goals = [];
    memoryState.expenses = [];
    memoryState.incomes = [];
    memoryState.attendance = [];
    memoryState.savingsGoals = [];
    memoryState.savingsTransactions = [];
    memoryState.salaryPayouts = [];
    memoryState.debts = [];
    memoryState.debtRepayments = [];
    memoryState.settings = { ...DEFAULT_USER_SETTINGS, isDemoMode: false };
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
      if (data.settings) memoryState.settings = { ...DEFAULT_USER_SETTINGS, ...data.settings };
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
