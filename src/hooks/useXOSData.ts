import { useEffect, useState } from 'react';
import { repository } from '../services/repository';

export function useXOSData() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsubscribe = repository.subscribe(() => {
      setTick(prev => prev + 1);
    });
    return unsubscribe;
  }, []);

  return {
    settings: repository.getSettings(),
    goals: repository.getGoals(),
    expenses: repository.getExpenses(),
    incomes: repository.getIncomes(),
    attendance: repository.getAttendance(),
    savingsGoals: repository.getSavingsGoals(),
    savingsTransactions: repository.getSavingsTransactions(),
    salaryPayouts: repository.getSalaryPayouts(),
    debts: repository.getDebts(),
    debtRepayments: repository.getDebtRepayments(),
    backendStatus: repository.getBackendStatus(),
    
    // Actions
    saveSettings: (s: Parameters<typeof repository.saveSettings>[0]) => repository.saveSettings(s),
    addGoal: (g: Parameters<typeof repository.addGoal>[0]) => repository.addGoal(g),
    updateGoal: (id: string, u: Parameters<typeof repository.updateGoal>[1]) => repository.updateGoal(id, u),
    deleteGoal: (id: string) => repository.deleteGoal(id),

    addExpense: (e: Parameters<typeof repository.addExpense>[0]) => repository.addExpense(e),
    updateExpense: (id: string, u: Parameters<typeof repository.updateExpense>[1]) => repository.updateExpense(id, u),
    deleteExpense: (id: string) => repository.deleteExpense(id),

    addIncome: (i: Parameters<typeof repository.addIncome>[0]) => repository.addIncome(i),
    updateIncome: (id: string, u: Parameters<typeof repository.updateIncome>[1]) => repository.updateIncome(id, u),
    deleteIncome: (id: string) => repository.deleteIncome(id),

    addDebt: (d: Parameters<typeof repository.addDebt>[0]) => repository.addDebt(d),
    updateDebt: (id: string, u: Parameters<typeof repository.updateDebt>[1]) => repository.updateDebt(id, u),
    deleteDebt: (id: string) => repository.deleteDebt(id),
    addDebtRepayment: (r: Parameters<typeof repository.addDebtRepayment>[0]) => repository.addDebtRepayment(r),
    deleteDebtRepayment: (id: string) => repository.deleteDebtRepayment(id),

    upsertAttendanceRecord: (r: Parameters<typeof repository.upsertAttendanceRecord>[0]) => repository.upsertAttendanceRecord(r),
    deleteAttendanceRecord: (id: string) => repository.deleteAttendanceRecord(id),

    addSavingsGoal: (g: Parameters<typeof repository.addSavingsGoal>[0]) => repository.addSavingsGoal(g),
    updateSavingsGoal: (id: string, u: Parameters<typeof repository.updateSavingsGoal>[1]) => repository.updateSavingsGoal(id, u),
    deleteSavingsGoal: (id: string) => repository.deleteSavingsGoal(id),
    addSavingsTransaction: (tx: Parameters<typeof repository.addSavingsTransaction>[0]) => repository.addSavingsTransaction(tx),

    recordSalaryPayout: (p: Parameters<typeof repository.recordSalaryPayout>[0], sync?: boolean, allowReplace?: boolean) => repository.recordSalaryPayout(p, sync, allowReplace),
    getPayoutByPeriod: (periodMonth: string) => repository.getPayoutByPeriod(periodMonth),
    deleteSalaryPayout: (id: string) => repository.deleteSalaryPayout(id),

    loadDemoData: () => repository.loadDemoData(),
    clearAllData: () => repository.clearAllData(),
    exportJSON: () => repository.exportJSON(),
    importJSON: (s: string) => repository.importJSON(s)
  };
}
