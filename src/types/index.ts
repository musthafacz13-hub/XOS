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
  dailyBaseSalary: number; // default: 500 -> DB daily_base_salary
  standardWorkingHours: number; // default: 8 -> DB standard_hours
  extraHourRate: number; // default: 100 -> DB extra_hour_rate
  currency: CurrencyCode; // DB currency_code
}

export interface UserProfile {
  name: string;
  email: string;
  avatarUrl?: string;
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

export interface Goal {
  id: string;
  title: string;
  description: string;
  category: GoalCategory;
  targetAmount?: number;
  progressPercentage: number; // 0-100 -> DB progress_percentage
  targetDate?: string; // YYYY-MM-DD
  priority: GoalPriority;
  status: GoalStatus;
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
  date: string; // YYYY-MM-DD -> DB expense_date
  time?: string; // HH:mm -> DB expense_time
  paymentMethod: PaymentMethod;
  notes?: string;
  isRecurring?: boolean;
  recurringFrequency?: RecurrenceFrequency; // DB recurrence_frequency
  recurrenceEndDate?: string; // YYYY-MM-DD -> DB recurrence_end_date
  createdAt: string;
}

export type IncomeSource = 'Salary' | 'Freelance' | 'Business' | 'Gifts' | 'Investments' | 'Other' | string;

export interface Income {
  id: string;
  title: string;
  amount: number;
  source: IncomeSource;
  date: string; // YYYY-MM-DD -> DB income_date
  time?: string; // HH:mm -> DB income_time
  notes?: string;
  salaryPayoutId?: string; // DB salary_payout_id
  createdAt: string;
}

export type AttendanceStatus = 'Present' | 'Absent' | 'Leave' | 'Holiday';

export interface AttendanceRecord {
  id: string;
  date: string; // YYYY-MM-DD -> DB attendance_date
  status: AttendanceStatus;
  checkInTime?: string; // HH:mm -> DB check_in
  checkOutTime?: string; // HH:mm -> DB check_out
  breakDurationMinutes?: number; // DB break_minutes
  calculatedHours?: number; // DB hours_worked
  extraHours?: number; // DB extra_hours
  dailyBaseSalary?: number; // DB daily_base_salary
  extraHourRate?: number; // DB extra_hour_rate
  dailyEarnedSalary?: number; // DB calculated_salary
  notes?: string;
}

export interface SalaryPayout {
  id: string;
  periodStart: string; // YYYY-MM-DD -> DB period_start
  periodEnd: string; // YYYY-MM-DD -> DB period_end
  amountPaid: number; // DB amount_paid
  paidAt: string; // ISO/YYYY-MM-DD -> DB paid_at
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SavingsGoal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number; // Trigger-maintained DB current_balance
  targetDate?: string; // YYYY-MM-DD
  description?: string; // DB notes
  color?: string; // DB color
  createdAt: string;
  updatedAt?: string;
}

export type SavingsTransactionType = 'deposit' | 'withdrawal';

export interface SavingsTransaction {
  id: string;
  savingsGoalId: string; // DB savings_goal_id
  amount: number;
  type: SavingsTransactionType; // DB transaction_type
  date: string; // YYYY-MM-DD -> DB transaction_date
  note?: string; // DB notes
  createdAt: string;
}

export type DateFilterPreset = 'today' | 'this_month' | 'last_month' | 'this_year' | 'custom';

export interface DateRangeFilter {
  preset: DateFilterPreset;
  startDate?: string;
  endDate?: string;
}

// DEBT MANAGEMENT (Receivables — live DB status enum)
export type DebtStatus = 'outstanding' | 'partially_paid' | 'paid';

export interface Debt {
  id: string;
  person_name: string;
  original_amount: number;
  remaining_amount: number; // Trigger-maintained DB remaining_amount
  lent_date: string; // YYYY-MM-DD -> DB lent_date
  due_date?: string; // YYYY-MM-DD -> DB due_date
  description?: string;
  notes?: string;
  status: DebtStatus; // Trigger-maintained DB status
  created_at: string;
  updated_at?: string;
}

export interface DebtRepayment {
  id: string;
  debt_id: string;
  amount: number;
  repayment_date: string; // YYYY-MM-DD
  payment_method?: string;
  notes?: string;
  created_at: string;
}
