import { 
  AttendanceRecord, 
  Expense, 
  Goal, 
  Income, 
  SalaryConfig, 
  SalaryPayout, 
  SavingsGoal, 
  SavingsTransaction, 
  UserSettings 
} from '../types';
import { getMonthString, getTodayString } from '../utils/formatters';

export const DEFAULT_SALARY_CONFIG: SalaryConfig = {
  dailyBaseSalary: 500,
  standardWorkingHours: 8,
  extraHourRate: 100,
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
  ],
  isDemoMode: false
};

// Generates optional demo dataset ONLY when user explicitly enters demo mode
export function generateDemoDataset() {
  const todayObj = new Date();
  const currentYear = todayObj.getFullYear();
  const currentMonthIdx = todayObj.getMonth();

  const getDateStr = (dayNum: number) => {
    const d = new Date(currentYear, currentMonthIdx, Math.min(dayNum, 28));
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const demoGoals: Goal[] = [
    {
      id: 'g1',
      title: 'Emergency Reserve Fund',
      description: 'Build a 6-month living expense reserve.',
      category: 'Financial',
      targetAmount: 10000,
      progressPercentage: 35,
      targetDate: `${currentYear}-12-31`,
      priority: 'High',
      status: 'In Progress',
      createdAt: getDateStr(1),
      savingsGoalId: 's1'
    },
    {
      id: 'g2',
      title: 'Design Systems Certification',
      description: 'Complete advanced human interface design program.',
      category: 'Learning',
      targetAmount: 850,
      progressPercentage: 100,
      targetDate: getDateStr(10),
      priority: 'Medium',
      status: 'Completed',
      createdAt: getDateStr(2),
      completedAt: getDateStr(10),
      savingsGoalId: 's2'
    },
    {
      id: 'g3',
      title: 'Northern Fjords & Auroras',
      description: 'Explore the Arctic coast and Nordic landscapes.',
      category: 'Travel',
      targetAmount: 4200,
      progressPercentage: 28,
      targetDate: `${currentYear + 1}-09-15`,
      priority: 'Medium',
      status: 'In Progress',
      createdAt: getDateStr(3),
      savingsGoalId: 's3'
    }
  ];

  const demoExpenses: Expense[] = [
    {
      id: 'e1',
      title: 'Apartment Lease',
      amount: 1400,
      category: 'Housing',
      date: getDateStr(1),
      paymentMethod: 'Bank Transfer',
      isRecurring: true,
      recurringFrequency: 'Monthly',
      createdAt: getDateStr(1)
    },
    {
      id: 'e2',
      title: 'Weekly Market Provisions',
      amount: 145.20,
      category: 'Food & Dining',
      date: getDateStr(3),
      paymentMethod: 'Credit Card',
      createdAt: getDateStr(3)
    },
    {
      id: 'e3',
      title: 'Fibre Optic Broadband',
      amount: 65.00,
      category: 'Utilities',
      date: getDateStr(5),
      paymentMethod: 'Credit Card',
      isRecurring: true,
      recurringFrequency: 'Monthly',
      createdAt: getDateStr(5)
    }
  ];

  const demoIncome: Income[] = [
    {
      id: 'i1',
      title: 'Monthly Salary Base',
      amount: 3800.00,
      source: 'Salary',
      date: getDateStr(1),
      notes: 'Direct deposit',
      createdAt: getDateStr(1)
    },
    {
      id: 'i2',
      title: 'Consulting Milestone',
      amount: 950.00,
      source: 'Freelance',
      date: getDateStr(6),
      notes: 'Design review retainer',
      createdAt: getDateStr(6)
    }
  ];

  const demoAttendance: AttendanceRecord[] = [];
  const daysToGenerate = Math.min(todayObj.getDate(), 15);
  for (let i = 1; i <= daysToGenerate; i++) {
    const d = new Date(currentYear, currentMonthIdx, i);
    const dayOfWeek = d.getDay();
    const dateStr = getDateStr(i);

    if (dayOfWeek === 0 || dayOfWeek === 6) {
      demoAttendance.push({
        id: `att_${i}`,
        date: dateStr,
        status: 'Holiday',
        notes: dayOfWeek === 0 ? 'Sunday Weekend' : 'Saturday Weekend'
      });
    } else {
      demoAttendance.push({
        id: `att_${i}`,
        date: dateStr,
        status: 'Present',
        checkInTime: '09:00',
        checkOutTime: '17:30',
        breakDurationMinutes: 30,
        calculatedHours: 8,
        extraHours: 0,
        dailyBaseSalary: 500,
        extraHourRate: 100,
        dailyEarnedSalary: 500,
        notes: 'Regular working day'
      });
    }
  }

  const demoSavingsGoals: SavingsGoal[] = [
    {
      id: 's1',
      name: 'Emergency Reserve Fund',
      targetAmount: 10000,
      currentAmount: 3500,
      targetDate: `${currentYear}-12-31`,
      description: 'Build a 6-month living expense reserve.',
      createdAt: getDateStr(1)
    },
    {
      id: 's2',
      name: 'Design Systems Certification',
      targetAmount: 850,
      currentAmount: 850,
      targetDate: getDateStr(10),
      description: 'Complete advanced human interface design program.',
      createdAt: getDateStr(2)
    },
    {
      id: 's3',
      name: 'Northern Fjords & Auroras',
      targetAmount: 4200,
      currentAmount: 1176,
      targetDate: `${currentYear + 1}-09-15`,
      description: 'Explore the Arctic coast and Nordic landscapes.',
      createdAt: getDateStr(3)
    }
  ];

  const demoSavingsTransactions: SavingsTransaction[] = [
    {
      id: 'st1',
      savingsGoalId: 's1',
      amount: 400,
      type: 'deposit',
      date: getDateStr(2),
      note: 'Scheduled reserve allocation',
      createdAt: getDateStr(2)
    }
  ];

  const demoSalaryPayouts: SalaryPayout[] = [];

  return {
    goals: demoGoals,
    expenses: demoExpenses,
    incomes: demoIncome,
    attendance: demoAttendance,
    savingsGoals: demoSavingsGoals,
    savingsTransactions: demoSavingsTransactions,
    salaryPayouts: demoSalaryPayouts
  };
}
