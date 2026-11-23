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
} from '../../types';
import {
  calculateAttendanceStats,
  calculateDebtOutstanding,
  calculateDebtSummary,
  calculateFinancialTotals,
  calculateMonthlyExpenseTotal,
  calculateMonthlySalarySummary,
  calculateSeparateDebtTotals,
  calculateUnifiedGoalTotals,
  filterRecordsByDateRange,
  isSalaryConfigured,
  resolveGoalsWithSavings
} from '../../utils/calculations';
import { formatCurrency, getIstTodayString, getMonthString } from '../../utils/formatters';
import { XosModuleKey } from './xosKnowledge';

export interface XOSReadOnlySnapshot {
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

export interface SessionTurnMemory {
  role: 'user' | 'model';
  text: string;
  modules?: XosModuleKey[];
}

export type TimeScope =
  | 'today'
  | 'this_month'
  | 'last_month'
  | 'this_year'
  | 'all'
  | 'compare_months';

export interface DetectedIntent {
  modules: XosModuleKey[];
  timeScope: TimeScope;
  explicitMonth?: string; // YYYY-MM
  wantsComparison: boolean;
  readOnlyMutationRequested: boolean;
  detectedLanguage: 'ml' | 'en' | 'mixed';
}

const MODULE_KEYWORDS: Record<XosModuleKey, string[]> = {
  expenses: [
    'expense', 'expenses', 'spend', 'spent', 'spending', 'cost', 'bill', 'bills', 'recurring',
    'chelav', 'chelavu', 'chilavu', 'chilav', 'poyathu', 'check cheyy', 'paisa poyi',
    'ചെലവ്', 'ചെലവുകൾ', 'ചിലവ്', 'ചിലവുകൾ', 'ചെലവായ', 'ചിലവായ'
  ],
  income: [
    'income', 'incomes', 'earn', 'earned', 'earning', 'revenue', 'inflow', 'cash in', 'freelance',
    'varavu', 'kittiya', 'varumanam',
    'വരവ്', 'വരുമാനം', 'കിട്ടിയ'
  ],
  debt: [
    'debt', 'debts', 'owe', 'owed', 'owes', 'lend', 'lent', 'borrow', 'borrowed', 'repay',
    'repayment', 'repayments', 'payable', 'receivable', 'loan', 'credit',
    'kadam', 'kadangal', 'kodukkan', 'tharan', 'baaki', 'thirichu',
    'കടം', 'കടങ്ങൾ', 'തരാൻ', 'കൊടുക്കാൻ', 'ബാക്കി', 'തിരിച്ചു'
  ],
  attendance: [
    'attendance', 'work', 'worked', 'working', 'shift', 'shifts', 'hours', 'overtime', 'ot',
    'present', 'absent', 'leave', 'holiday', 'check in', 'check out', 'checkin', 'checkout',
    'joli', 'hazir', 'divasam', 'manikkoor',
    'ജോലി', 'അറ്റൻഡൻസ്', 'ഹാജർ', 'ദിവസം', 'മണിക്കൂർ', 'ഓവർടൈം', 'അവധി'
  ],
  salary: [
    'salary', 'pay', 'payout', 'payouts', 'wage', 'wages', 'payroll', 'base salary', 'addon',
    'add-on', 'hourly', 'rate', 'remaining salary',
    'shambalam', 'sambalam', 'shambala', 'kittanulla',
    'ശമ്പളം', 'ശമ്പള', 'വേതനം', 'കിട്ടാനുള്ള'
  ],
  savings: [
    'saving', 'savings', 'reserve', 'reserves', 'deposit', 'deposits', 'withdraw', 'withdrawal',
    'emergency fund', 'fund', 'funds',
    'sampadyam', 'neekkiveppu',
    'സേവിംഗ്സ്', 'സേവിങ്സ്', 'സമ്പാദ്യം', 'നീക്കിവെപ്പ്'
  ],
  goals: [
    'goal', 'goals', 'target', 'targets', 'dream', 'dreams', 'milestone', 'milestones', 'progress',
    'lakshyam', 'lakshyangal',
    'ലക്ഷ്യം', 'ലക്ഷ്യങ്ങൾ', 'ഗോൾ'
  ],
  overview: [
    'overview', 'summary', 'balance', 'available money', 'available balance', 'cash flow', 'cashflow',
    'net', 'status', 'financial health', 'how am i doing', 'dashboard', 'overall', 'total',
    'enganeyundu', 'balans',
    'ബാലൻസ്', 'ആകെ', 'സമ്മറി', 'എങ്ങനെയുണ്ട്', 'സ്ഥിതി'
  ],
  app_help: [
    'how does', 'how do i', 'how to', 'what is xos', 'explain', 'feature', 'module', 'settings',
    'export', 'pdf', 'backup', 'reset', 'currency', 'timezone', 'ist', 'help', 'guide',
    'engane', 'enthanu',
    'എങ്ങനെ', 'എന്താണ്', 'സഹായം', 'സെറ്റിംഗ്സ്'
  ]
};

const COMPARE_KEYWORDS = [
  'compare', 'comparison', 'vs', 'versus', 'difference', 'more than last', 'less than last',
  'better than', 'worse than', 'change from', 'trend',
  'tharatamyam', 'vyathyasam', 'munnathe',
  'താരതമ്യം', 'വ്യത്യാസം', 'മുൻപത്തെ'
];

const LAST_MONTH_KEYWORDS = [
  'last month', 'previous month', 'prev month', 'prior month',
  'kazhinja masam', 'kazhinja maasam',
  'കഴിഞ്ഞ മാസം', 'കഴിഞ്ഞമാസം'
];

const THIS_MONTH_KEYWORDS = [
  'this month', 'current month', 'monthly',
  'ee masam', 'ee maasam',
  'ഈ മാസം', 'ഈമാസം'
];

const TODAY_KEYWORDS = ['today', 'innu', 'ഇന്ന്'];
const THIS_YEAR_KEYWORDS = ['this year', 'yearly', 'annual', 'ee varsham', 'ഈ വർഷം'];
const ALL_TIME_KEYWORDS = ['all time', 'all-time', 'overall history', 'ever', 'ആകെ എല്ലാം'];

const MUTATION_KEYWORDS = [
  'add ', 'create ', 'log ', 'record ', 'delete ', 'remove ', 'erase ', 'edit ', 'update ', 'change ', 'reset ',
  'ചേർക്ക', 'ഡിലീറ്റ്', 'നീക്കം', 'മാറ്റു', 'റീസെറ്റ്'
];

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some(keyword => haystack.includes(keyword));
}

function getPreviousMonthString(monthStr: string): string {
  const [yStr, mStr] = monthStr.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return getMonthString();
  }
  const d = new Date(year, month - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function detectLanguageFromText(text: string): 'ml' | 'en' | 'mixed' {
  const hasMalayalamScript = /[\u0D00-\u0D7F]/.test(text);
  const hasLatin = /[A-Za-z]{2,}/.test(text);
  if (hasMalayalamScript && hasLatin) return 'mixed';
  if (hasMalayalamScript) return 'ml';
  const lower = text.toLowerCase();
  const manglishHints = [
    'chelav', 'chilav', 'shambalam', 'sambalam', 'kadam', 'varavu',
    'enganeyundu', 'engane', 'enthanu', 'masam', 'maasam', 'kazhinja',
    'tharan', 'kodukkan', 'joli', 'namaskaram', 'sukhamano', 'parayu', 'sahayikk'
  ];
  if (manglishHints.some(hint => lower.includes(hint))) {
    return 'mixed';
  }
  return 'en';
}

export function detectQueryIntent(
  query: string,
  previousTurnModules: XosModuleKey[] = []
): DetectedIntent {
  const normalized = query.trim().toLowerCase();
  const matched = new Set<XosModuleKey>();

  (Object.keys(MODULE_KEYWORDS) as XosModuleKey[]).forEach((mod) => {
    if (containsAny(normalized, MODULE_KEYWORDS[mod])) {
      matched.add(mod);
    }
  });

  // Repayment expenses connect debt & expenses naturally
  if (matched.has('debt') && (normalized.includes('expense') || normalized.includes('ചെലവ്'))) {
    matched.add('expenses');
  }
  // Salary queries benefit from attendance context and vice versa
  if (matched.has('salary')) {
    matched.add('attendance');
  }

  const wantsComparison = containsAny(normalized, COMPARE_KEYWORDS);
  let timeScope: TimeScope = 'this_month';
  let explicitMonth: string | undefined;

  const isoMonthMatch = /\b(20\d{2})-(0[1-9]|1[0-2])\b/.exec(normalized);
  if (isoMonthMatch) {
    explicitMonth = `${isoMonthMatch[1]}-${isoMonthMatch[2]}`;
    timeScope = 'this_month';
  } else if (wantsComparison) {
    timeScope = 'compare_months';
  } else if (containsAny(normalized, LAST_MONTH_KEYWORDS)) {
    timeScope = 'last_month';
  } else if (containsAny(normalized, TODAY_KEYWORDS)) {
    timeScope = 'today';
  } else if (containsAny(normalized, THIS_YEAR_KEYWORDS)) {
    timeScope = 'this_year';
  } else if (containsAny(normalized, ALL_TIME_KEYWORDS)) {
    timeScope = 'all';
  } else if (containsAny(normalized, THIS_MONTH_KEYWORDS)) {
    timeScope = 'this_month';
  }

  // Follow-up topic inheritance when the current query is a brief refinement (e.g., "what about last month?")
  if (matched.size === 0 && previousTurnModules.length > 0) {
    const isShortFollowUp =
      normalized.length <= 90 &&
      (wantsComparison ||
        timeScope !== 'this_month' ||
        containsAny(normalized, [
          'what about', 'how about', 'and ', 'that', 'those', 'more', 'details', 'breakdown', 'why',
          'അത്', 'കൂടുതൽ', 'വിവരങ്ങൾ', 'എന്തുകൊണ്ട്', 'ബാക്കി', 'pinne', 'athu'
        ]));
    if (isShortFollowUp) {
      previousTurnModules.forEach(m => matched.add(m));
    }
  }

  // Greeting or broad overview query without specific module
  const isGreetingOnly = /^(hi|hello|hey|good morning|good afternoon|good evening|namaskaram|ഹായ്|ഹലോ|നമസ്കാരം)[!.\s?]*$/i.test(
    query.trim()
  );

  if (matched.size === 0) {
    matched.add('overview');
  }

  // Keep greeting context super lightweight
  const modules: XosModuleKey[] = isGreetingOnly ? ['overview'] : Array.from(matched);

  const readOnlyMutationRequested =
    !normalized.startsWith('how ') &&
    !normalized.includes('how do i') &&
    !normalized.includes('how to') &&
    !normalized.includes('എങ്ങനെ') &&
    containsAny(normalized, MUTATION_KEYWORDS);

  return {
    modules,
    timeScope,
    explicitMonth,
    wantsComparison,
    readOnlyMutationRequested,
    detectedLanguage: detectLanguageFromText(query)
  };
}

export interface SelectiveXosContext {
  selectedModules: XosModuleKey[];
  intent: DetectedIntent;
  groundedContext: Record<string, unknown>;
}

export function buildSelectiveXosContext(params: {
  query: string;
  data: XOSReadOnlySnapshot;
  recentTurns?: SessionTurnMemory[];
  now?: Date;
}): SelectiveXosContext {
  const now = params.now || new Date();
  const currentMonth = getMonthString(now);
  const lastMonth = getPreviousMonthString(currentMonth);
  const todayIst = getIstTodayString(now);
  const currency = params.data.settings.currency || 'INR';

  const lastUserTurnWithModules = [...(params.recentTurns || [])]
    .reverse()
    .find(t => t.role === 'user' && Array.isArray(t.modules) && t.modules.length > 0);

  const intent = detectQueryIntent(params.query, lastUserTurnWithModules?.modules || []);
  const targetMonth =
    intent.explicitMonth || (intent.timeScope === 'last_month' ? lastMonth : currentMonth);

  const fmt = (amount: number) => formatCurrency(amount, currency);

  // Exclude savings linked to archived goals (consistent with DashboardView & ReportsView)
  const archivedGoalSavingsIds = new Set(
    params.data.goals
      .filter(g => g.status === 'Archived' && g.savingsGoalId)
      .map(g => g.savingsGoalId as string)
  );
  const activeSavingsGoals = params.data.savingsGoals.filter(
    sg => !sg.isArchived && !archivedGoalSavingsIds.has(sg.id)
  );

  const modulesSet = new Set<XosModuleKey>(intent.modules);
  const payload: Record<string, unknown> = {
    workspace: {
      userName: params.data.settings.profile.name.trim() || undefined,
      currency,
      todayIst,
      currentMonth,
      lastMonth,
      targetMonth,
      timeScope: intent.timeScope,
      selectedModules: intent.modules,
      readOnlyMutationRequested: intent.readOnlyMutationRequested
    }
  };

  if (modulesSet.has('overview')) {
    const globalTotals = calculateFinancialTotals(
      params.data.incomes,
      params.data.expenses,
      activeSavingsGoals,
      params.data.savingsTransactions
    );
    const monthExpenses = calculateMonthlyExpenseTotal(params.data.expenses, targetMonth);
    const monthIncomes = params.data.incomes
      .filter(i => i.date.startsWith(targetMonth))
      .reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
    const salarySummary = calculateMonthlySalarySummary(
      params.data.attendance,
      params.data.salaryPayouts,
      params.data.settings.salaryConfig,
      currentMonth
    );
    const { totalToReceive, totalToPay } = calculateSeparateDebtTotals(
      params.data.debts,
      params.data.debtRepayments
    );
    const resolvedGoals = resolveGoalsWithSavings(params.data.goals, params.data.savingsGoals);
    const goalTotals = calculateUnifiedGoalTotals(resolvedGoals);

    payload.overview = {
      availableBalance: globalTotals.availableBalance,
      availableBalanceFormatted: fmt(globalTotals.availableBalance),
      totalSavingsBalance: globalTotals.currentSavingsBalance,
      totalSavingsBalanceFormatted: fmt(globalTotals.currentSavingsBalance),
      targetMonthIncome: Number(monthIncomes.toFixed(2)),
      targetMonthIncomeFormatted: fmt(monthIncomes),
      targetMonthExpenses: monthExpenses,
      targetMonthExpensesFormatted: fmt(monthExpenses),
      targetMonthNetCashFlow: Number((monthIncomes - monthExpenses).toFixed(2)),
      targetMonthNetCashFlowFormatted: fmt(monthIncomes - monthExpenses),
      debtToReceive: totalToReceive,
      debtToReceiveFormatted: fmt(totalToReceive),
      debtToPay: totalToPay,
      debtToPayFormatted: fmt(totalToPay),
      activeGoalsCount: goalTotals.activeGoalsCount,
      completedGoalsCount: goalTotals.completedGoalsCount,
      salaryConfigured: isSalaryConfigured(params.data.settings.salaryConfig),
      currentMonthEarnedSalary: salarySummary.earnedSalary,
      currentMonthEarnedSalaryFormatted: fmt(salarySummary.earnedSalary),
      currentMonthRemainingSalary: salarySummary.remainingSalary,
      currentMonthRemainingSalaryFormatted: fmt(salarySummary.remainingSalary),
      recordCounts: {
        expenses: params.data.expenses.length,
        incomes: params.data.incomes.length,
        debts: params.data.debts.length,
        attendance: params.data.attendance.length,
        goals: resolvedGoals.length
      }
    };
  }

  if (modulesSet.has('expenses')) {
    const presetForFilter =
      intent.timeScope === 'today'
        ? 'today'
        : intent.timeScope === 'this_year'
          ? 'this_year'
          : intent.timeScope === 'all'
            ? 'all'
            : null;

    const targetExpenses = presetForFilter
      ? filterRecordsByDateRange(params.data.expenses, presetForFilter, undefined, undefined, now)
      : params.data.expenses.filter(e => e.date && e.date.startsWith(targetMonth));

    const total = Number(
      targetExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0).toFixed(2)
    );
    const prevMonthTotal = calculateMonthlyExpenseTotal(params.data.expenses, lastMonth);
    const currentMonthTotal = calculateMonthlyExpenseTotal(params.data.expenses, currentMonth);

    const categoryMap = new Map<string, { total: number; count: number }>();
    let debtRepaymentExpenseTotal = 0;
    let recurringCount = 0;

    for (const exp of targetExpenses) {
      const cat = exp.category || 'Other';
      const entry = categoryMap.get(cat) || { total: 0, count: 0 };
      entry.total += Number(exp.amount) || 0;
      entry.count += 1;
      categoryMap.set(cat, entry);
      if (exp.category === 'Debt Repayment' || exp.debtRepaymentId) {
        debtRepaymentExpenseTotal += Number(exp.amount) || 0;
      }
      if (exp.isRecurring) recurringCount += 1;
    }

    const byCategory = Array.from(categoryMap.entries())
      .map(([category, info]) => ({
        category,
        total: Number(info.total.toFixed(2)),
        totalFormatted: fmt(info.total),
        count: info.count
      }))
      .sort((a, b) => b.total - a.total);

    const recentTransactions = [...targetExpenses]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10)
      .map(e => ({
        title: e.title,
        amount: e.amount,
        amountFormatted: fmt(e.amount),
        category: e.category,
        date: e.date,
        paymentMethod: e.paymentMethod,
        isRecurring: Boolean(e.isRecurring),
        fromDebtRepayment: Boolean(e.debtRepaymentId || e.category === 'Debt Repayment')
      }));

    payload.expenses = {
      scope: presetForFilter || targetMonth,
      transactionCount: targetExpenses.length,
      total,
      totalFormatted: fmt(total),
      debtRepaymentIncludedTotal: Number(debtRepaymentExpenseTotal.toFixed(2)),
      debtRepaymentIncludedFormatted: fmt(debtRepaymentExpenseTotal),
      recurringTransactionsCount: recurringCount,
      byCategory,
      monthComparison: {
        currentMonth,
        currentMonthTotal,
        currentMonthTotalFormatted: fmt(currentMonthTotal),
        lastMonth,
        lastMonthTotal: prevMonthTotal,
        lastMonthTotalFormatted: fmt(prevMonthTotal),
        differenceFromLastMonth: Number((currentMonthTotal - prevMonthTotal).toFixed(2)),
        differenceFormatted: fmt(currentMonthTotal - prevMonthTotal)
      },
      recentTransactions
    };
  }

  if (modulesSet.has('income')) {
    const presetForFilter =
      intent.timeScope === 'today'
        ? 'today'
        : intent.timeScope === 'this_year'
          ? 'this_year'
          : intent.timeScope === 'all'
            ? 'all'
            : null;

    const targetIncomes = presetForFilter
      ? filterRecordsByDateRange(params.data.incomes, presetForFilter, undefined, undefined, now)
      : params.data.incomes.filter(i => i.date && i.date.startsWith(targetMonth));

    const total = Number(
      targetIncomes.reduce((sum, i) => sum + (Number(i.amount) || 0), 0).toFixed(2)
    );
    const prevMonthTotal = Number(
      params.data.incomes
        .filter(i => i.date && i.date.startsWith(lastMonth))
        .reduce((sum, i) => sum + (Number(i.amount) || 0), 0)
        .toFixed(2)
    );
    const currentMonthTotal = Number(
      params.data.incomes
        .filter(i => i.date && i.date.startsWith(currentMonth))
        .reduce((sum, i) => sum + (Number(i.amount) || 0), 0)
        .toFixed(2)
    );

    const sourceMap = new Map<string, { total: number; count: number }>();
    for (const inc of targetIncomes) {
      const src = inc.source || 'Other';
      const entry = sourceMap.get(src) || { total: 0, count: 0 };
      entry.total += Number(inc.amount) || 0;
      entry.count += 1;
      sourceMap.set(src, entry);
    }

    const bySource = Array.from(sourceMap.entries())
      .map(([source, info]) => ({
        source,
        total: Number(info.total.toFixed(2)),
        totalFormatted: fmt(info.total),
        count: info.count
      }))
      .sort((a, b) => b.total - a.total);

    payload.income = {
      scope: presetForFilter || targetMonth,
      entryCount: targetIncomes.length,
      total,
      totalFormatted: fmt(total),
      bySource,
      monthComparison: {
        currentMonth,
        currentMonthTotal,
        currentMonthTotalFormatted: fmt(currentMonthTotal),
        lastMonth,
        lastMonthTotal: prevMonthTotal,
        lastMonthTotalFormatted: fmt(prevMonthTotal)
      },
      recentEntries: [...targetIncomes]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 8)
        .map(i => ({
          title: i.title,
          amount: i.amount,
          amountFormatted: fmt(i.amount),
          source: i.source,
          date: i.date,
          syncedFromSalaryPayout: Boolean(i.salaryPayoutId)
        }))
    };
  }

  if (modulesSet.has('debt')) {
    const receivableSummary = calculateDebtSummary(params.data.debts, params.data.debtRepayments);
    const { totalToReceive, totalToPay } = calculateSeparateDebtTotals(
      params.data.debts,
      params.data.debtRepayments
    );

    const debtItems = params.data.debts.map(d => {
      const remaining = calculateDebtOutstanding(d, params.data.debtRepayments);
      return {
        personName: d.person_name,
        direction: d.direction === 'pay' ? 'money_to_pay' : 'money_owed_to_me',
        originalAmount: d.original_amount,
        originalAmountFormatted: fmt(d.original_amount),
        remainingAmount: remaining,
        remainingAmountFormatted: fmt(remaining),
        status: d.status,
        date: d.lent_date,
        dueDate: d.due_date || null
      };
    });

    const recentRepayments = [...params.data.debtRepayments]
      .sort((a, b) => b.repayment_date.localeCompare(a.repayment_date))
      .slice(0, 8)
      .map(r => {
        const parent = params.data.debts.find(d => d.id === r.debt_id);
        return {
          personName: parent?.person_name || 'Unknown',
          direction: parent?.direction === 'pay' ? 'money_to_pay' : 'money_owed_to_me',
          amount: r.amount,
          amountFormatted: fmt(r.amount),
          date: r.repayment_date,
          paymentMethod: r.payment_method || null
        };
      });

    payload.debt = {
      totalToReceive,
      totalToReceiveFormatted: fmt(totalToReceive),
      totalToPay,
      totalToPayFormatted: fmt(totalToPay),
      netDebtPosition: Number((totalToReceive - totalToPay).toFixed(2)),
      netDebtPositionFormatted: fmt(totalToReceive - totalToPay),
      receivableStats: receivableSummary,
      debts: debtItems.slice(0, 12),
      recentRepayments
    };
  }

  if (modulesSet.has('attendance') || modulesSet.has('salary')) {
    const cfg = params.data.settings.salaryConfig;
    const configured = isSalaryConfigured(cfg);

    if (modulesSet.has('attendance')) {
      const targetStats = calculateAttendanceStats(
        params.data.attendance,
        targetMonth,
        cfg.standardWorkingHours
      );
      const prevStats = calculateAttendanceStats(
        params.data.attendance,
        lastMonth,
        cfg.standardWorkingHours
      );

      const recentAttendance = params.data.attendance
        .filter(r => r.date && r.date.startsWith(targetMonth))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 10)
        .map(r => ({
          date: r.date,
          status: r.status,
          hoursWorked: r.calculatedHours ?? null,
          extraHours: r.extraHours ?? null,
          dailyEarnedSalary: r.dailyEarnedSalary ?? null,
          dailyEarnedFormatted:
            typeof r.dailyEarnedSalary === 'number' ? fmt(r.dailyEarnedSalary) : null,
          manualOverride: Boolean(r.salaryOverrideEnabled)
        }));

      payload.attendance = {
        targetMonth,
        stats: targetStats,
        previousMonth: lastMonth,
        previousMonthStats: prevStats,
        recentRecords: recentAttendance
      };
    }

    if (modulesSet.has('salary')) {
      const targetSummary = calculateMonthlySalarySummary(
        params.data.attendance,
        params.data.salaryPayouts,
        cfg,
        targetMonth
      );
      const prevSummary = calculateMonthlySalarySummary(
        params.data.attendance,
        params.data.salaryPayouts,
        cfg,
        lastMonth
      );

      payload.salary = {
        isConfigured: configured,
        configuredRates: configured
          ? {
              dailyBaseSalary: cfg.dailyBaseSalary,
              dailyBaseSalaryFormatted: fmt(cfg.dailyBaseSalary || 0),
              standardWorkingHours: cfg.standardWorkingHours,
              addonEnabled: cfg.addonEnabled,
              addonSalary: cfg.addonSalary,
              addonSalaryFormatted: fmt(cfg.addonSalary),
              overtimeEnabled: cfg.overtimeEnabled,
              extraHourRate: cfg.extraHourRate ?? null,
              extraHourRateFormatted:
                typeof cfg.extraHourRate === 'number' ? fmt(cfg.extraHourRate) : null
            }
          : null,
        targetMonth,
        summary: {
          ...targetSummary,
          earnedSalaryFormatted: fmt(targetSummary.earnedSalary),
          salaryReceivedFormatted: fmt(targetSummary.salaryReceived),
          remainingSalaryFormatted: fmt(targetSummary.remainingSalary),
          overpaidAmountFormatted: fmt(targetSummary.overpaidAmount)
        },
        previousMonthSummary: {
          periodMonth: lastMonth,
          earnedSalary: prevSummary.earnedSalary,
          earnedSalaryFormatted: fmt(prevSummary.earnedSalary),
          salaryReceived: prevSummary.salaryReceived,
          salaryReceivedFormatted: fmt(prevSummary.salaryReceived),
          remainingSalary: prevSummary.remainingSalary,
          remainingSalaryFormatted: fmt(prevSummary.remainingSalary)
        },
        recentPayouts: [...params.data.salaryPayouts]
          .sort((a, b) => b.paidAt.localeCompare(a.paidAt))
          .slice(0, 8)
          .map(p => ({
            periodStart: p.periodStart,
            periodEnd: p.periodEnd,
            amountPaid: p.amountPaid,
            amountPaidFormatted: fmt(p.amountPaid),
            paidAt: p.paidAt
          }))
      };
    }
  }

  if (modulesSet.has('savings') || modulesSet.has('goals')) {
    const resolvedGoals = resolveGoalsWithSavings(params.data.goals, params.data.savingsGoals);
    const goalTotals = calculateUnifiedGoalTotals(resolvedGoals);
    const globalTotals = calculateFinancialTotals(
      params.data.incomes,
      params.data.expenses,
      activeSavingsGoals,
      params.data.savingsTransactions
    );

    if (modulesSet.has('goals')) {
      payload.goals = {
        totals: {
          ...goalTotals,
          totalTargetFormatted: fmt(goalTotals.totalTargetAmount),
          totalSavedFormatted: fmt(goalTotals.totalSavedAmount),
          totalRemainingFormatted: fmt(goalTotals.totalRemainingAmount)
        },
        items: resolvedGoals.slice(0, 12).map(item => ({
          title: item.goal.title,
          category: item.goal.category,
          priority: item.goal.priority,
          status: item.goal.status,
          targetAmount: item.targetAmount,
          targetAmountFormatted: fmt(item.targetAmount),
          savedAmount: item.savedAmount,
          savedAmountFormatted: fmt(item.savedAmount),
          remainingAmount: item.remainingAmount,
          remainingAmountFormatted: fmt(item.remainingAmount),
          progressPercentage: item.progressPercentage,
          isCompleted: item.isCompleted,
          isPaused: item.isPaused,
          targetDate: item.goal.targetDate || null
        }))
      };
    }

    if (modulesSet.has('savings')) {
      const totalDeposits = params.data.savingsTransactions
        .filter(t => t.type === 'deposit')
        .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
      const totalWithdrawals = params.data.savingsTransactions
        .filter(t => t.type === 'withdrawal')
        .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

      payload.savings = {
        totalActiveReserves: globalTotals.currentSavingsBalance,
        totalActiveReservesFormatted: fmt(globalTotals.currentSavingsBalance),
        availableCashAfterSavings: globalTotals.availableBalance,
        availableCashAfterSavingsFormatted: fmt(globalTotals.availableBalance),
        totalDepositsAllTime: Number(totalDeposits.toFixed(2)),
        totalDepositsFormatted: fmt(totalDeposits),
        totalWithdrawalsAllTime: Number(totalWithdrawals.toFixed(2)),
        totalWithdrawalsFormatted: fmt(totalWithdrawals),
        activeReserves: activeSavingsGoals.slice(0, 12).map(sg => ({
          name: sg.name,
          currentAmount: sg.currentAmount,
          currentAmountFormatted: fmt(sg.currentAmount),
          targetAmount: sg.targetAmount,
          targetAmountFormatted: fmt(sg.targetAmount),
          targetDate: sg.targetDate || null
        })),
        recentTransactions: [...params.data.savingsTransactions]
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 10)
          .map(tx => {
            const sg = params.data.savingsGoals.find(g => g.id === tx.savingsGoalId);
            return {
              fundName: sg?.name || 'Reserve',
              type: tx.type,
              amount: tx.amount,
              amountFormatted: fmt(tx.amount),
              date: tx.date,
              note: tx.note || null
            };
          })
      };
    }
  }

  return {
    selectedModules: intent.modules,
    intent,
    groundedContext: payload
  };
}
