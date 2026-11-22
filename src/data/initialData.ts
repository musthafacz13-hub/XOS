import { SalaryConfig, UserSettings } from '../types';

export const DEFAULT_SALARY_CONFIG: SalaryConfig = {
  dailyBaseSalary: undefined,
  addonSalary: 0,
  addonEnabled: false,
  standardWorkingHours: undefined,
  extraHourRate: undefined,
  overtimeEnabled: false,
  isConfigured: false,
  currency: 'INR'
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
  profile: {
    name: '',
    email: ''
  },
  currency: 'INR',
  dateFormat: 'YYYY-MM-DD',
  weekStartDay: 'Monday',
  salaryConfig: DEFAULT_SALARY_CONFIG,
  widgets: [
    { id: 'balance_overview', name: 'Balance & Cash Flow', visible: true, order: 1 },
    { id: 'work_attendance', name: 'Work Attendance & Earned Salary', visible: true, order: 2 },
    { id: 'income_expense_summary', name: 'Income vs Expenses', visible: true, order: 3 },
    { id: 'active_goals', name: 'Active Goals & Targets', visible: true, order: 4 },
    { id: 'savings_progress', name: 'Savings Tracker', visible: true, order: 5 },
    { id: 'recent_activity', name: 'Recent Financial Activity', visible: true, order: 6 },
    { id: 'quick_actions', name: 'Quick Action Shortcuts', visible: true, order: 7 }
  ],
  customExpenseCategories: [
    'Food & Dining',
    'Housing',
    'Utilities',
    'Transport',
    'Entertainment',
    'Shopping',
    'Health & Fitness',
    'Education',
    'Debt & Bills',
    'Debt Repayment',
    'Subscriptions',
    'Other'
  ],
  customIncomeSources: [
    'Salary',
    'Freelance',
    'Business',
    'Gifts',
    'Investments',
    'Other'
  ]
};

