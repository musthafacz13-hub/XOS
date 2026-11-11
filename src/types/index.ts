export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'INR' | 'JPY' | 'AUD' | 'CAD' | 'SGD' | 'AED' | 'BRL';

export interface CurrencyConfig {
  code: CurrencyCode;
  symbol: string;
  name: string;
}

export type DateFormat = 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY';
export type WeekStartDay = 'Sunday' | 'Monday';

export type SalaryType = 
  | 'fixed_monthly' 
  | 'attendance_monthly' 
  | 'daily_wage' 
  | 'hourly_wage' 
  | 'custom';

export interface Allowance {
  id: string;
  name: string;
  amount: number;
}

export interface Deduction {
  id: string;
  name: string;
  amount: number;
}

export type FixedMonthlyAbsencePolicy = 'no_deduction' | 'deduct_unpaid_absent';

export interface SalaryConfig {
  salaryType: SalaryType;
  baseAmount: number; // monthly fixed, daily rate, or hourly rate
  currency: CurrencyCode;
  expectedWorkingDaysPerMonth: number;
  expectedWorkingHoursPerDay: number;
  weeklyHolidays: string[]; // e.g. ['Sunday'] or ['Saturday', 'Sunday']
  paidLeaveAllowancePerMonth: number; // e.g. 2 days
  overtimeRateMultiplier: number; // e.g. 1.5
  allowances: Allowance[];
  deductions: Deduction[];
  paymentDateOfMonth: number; // e.g. 1 or 28 or 30
  fixedMonthlyAbsencePolicy?: FixedMonthlyAbsencePolicy;
  includeOvertimeInMonthly?: boolean;
}

export interface UserProfile {
  name: string;
  email: string;
  occupation: string;
  tagline: string;
}

export interface DashboardWidgetConfig {
  id: string;
  name: string;
  visible: boolean;
  order: number;
}

export interface UserSettings {
  profile: UserProfile;
  currency: CurrencyCode;
  dateFormat: DateFormat;
  weekStartDay: WeekStartDay;
  salaryConfig: SalaryConfig;
  widgets: DashboardWidgetConfig[];
  customExpenseCategories: string[];
  customIncomeSources: string[];
  isDemoMode: boolean;
}

export type GoalCategory = 'Career' | 'Financial' | 'Health' | 'Travel' | 'Learning' | 'Life' | 'Personal' | string;
export type GoalPriority = 'Low' | 'Medium' | 'High';
export type GoalStatus = 'Not Started' | 'In Progress' | 'Completed' | 'Paused';
export type GoalType = 'goal' | 'dream';

export interface Goal {
  id: string;
  title: string;
  description: string;
  type: GoalType;
  category: GoalCategory;
  targetAmount?: number;
  currentAmount?: number;
  targetDate?: string; // YYYY-MM-DD
  priority: GoalPriority;
  status: GoalStatus;
  coverImage?: string;
  createdAt: string;
  completedAt?: string;
}

export type ExpenseCategory = 
  | 'Food & Dining' 
  | 'Housing' 
  | 'Utilities' 
  | 'Transport' 
  | 'Entertainment' 
  | 'Shopping' 
  | 'Health & Fitness' 
  | 'Education' 
  | 'Debt & Bills' 
  | 'Other'
  | string;

export type PaymentMethod = 'Cash' | 'Credit Card' | 'Debit Card' | 'Bank Transfer' | 'Digital Wallet';

export type RecurrenceFrequency = 'None' | 'Daily' | 'Weekly' | 'Monthly' | 'Yearly';

export interface Expense {
  id: string;
  title: string;
  amount: number;
  category: ExpenseCategory;
  date: string; // YYYY-MM-DD
  paymentMethod: PaymentMethod;
  notes?: string;
  isRecurring?: boolean;
  recurringFrequency?: RecurrenceFrequency;
  createdAt: string;
}

export type IncomeSource = 'Salary' | 'Freelance' | 'Business' | 'Gifts' | 'Investments' | 'Other' | string;

export interface Income {
  id: string;
  title: string;
  amount: number;
  source: IncomeSource;
  date: string; // YYYY-MM-DD
  notes?: string;
  salaryPayoutId?: string; // Links to salary payout if recorded from salary module
  createdAt: string;
}

export type AttendanceStatus = 'Present' | 'Absent' | 'Leave' | 'Holiday';

export interface AttendanceRecord {
  id: string;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  checkInTime?: string; // HH:mm
  checkOutTime?: string; // HH:mm
  breakDurationMinutes?: number;
  notes?: string;
  calculatedHours?: number;
}

export interface SalaryPayout {
  id: string;
  periodMonth: string; // YYYY-MM
  paymentDate: string; // YYYY-MM-DD
  salaryType: SalaryType;
  baseAmount: number;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  holidayDays: number;
  totalWorkingHours: number;
  overtimeHours: number;
  grossSalary: number;
  totalAllowances: number;
  totalDeductions: number;
  netSalary: number;
  status: 'Estimated' | 'Paid';
  notes?: string;
  syncedToIncomeId?: string;
}

export interface SavingsGoal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  startDate: string; // YYYY-MM-DD
  targetDate?: string; // YYYY-MM-DD
  description?: string;
  icon?: string;
  createdAt: string;
}

export type SavingsTransactionType = 'deposit' | 'withdrawal';

export interface SavingsTransaction {
  id: string;
  savingsGoalId: string;
  amount: number;
  type: SavingsTransactionType;
  date: string; // YYYY-MM-DD
  note?: string;
  createdAt: string;
}

export type DateFilterPreset = 'today' | 'this_month' | 'last_month' | 'this_year' | 'custom';

export interface DateRangeFilter {
  preset: DateFilterPreset;
  startDate?: string;
  endDate?: string;
}

// DEBT MANAGEMENT
export type DebtType = 'lent' | 'borrowed';
export type DebtStatus = 'Pending' | 'Partial' | 'Paid';

export interface Debt {
  id: string;
  person_name: string;
  type: DebtType;
  original_amount: number;
  transaction_date: string; // YYYY-MM-DD
  due_date?: string; // YYYY-MM-DD
  description?: string;
  notes?: string;
  status: DebtStatus;
  created_at: string;
  updated_at?: string;
}

export interface DebtRepayment {
  id: string;
  debt_id: string;
  amount: number;
  repayment_date: string; // YYYY-MM-DD
  notes?: string;
  created_at: string;
}
