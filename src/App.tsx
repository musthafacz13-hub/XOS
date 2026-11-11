import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ActiveTab, Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { MobileBottomNav } from './components/layout/MobileBottomNav';
import { QuickActionModal } from './components/modals/QuickActionModal';
import { pageVariants } from './utils/motion';

import { DashboardView } from './components/dashboard/DashboardView';
import { GoalsView } from './components/goals/GoalsView';
import { ExpensesView } from './components/expenses/ExpensesView';
import { IncomeView } from './components/income/IncomeView';
import { DebtView } from './components/debt/DebtView';
import { WorkView } from './components/work/WorkView';
import { SalaryView } from './components/salary/SalaryView';
import { SavingsView } from './components/savings/SavingsView';
import { ReportsView } from './components/reports/ReportsView';
import { SettingsView } from './components/settings/SettingsView';

import { useXOSData } from './hooks/useXOSData';
import { DateRangeFilter } from './types';

export default function App() {
  const data = useXOSData();

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateRangeFilter>({ preset: 'this_month' });

  // Quick Action Modal State
  const [isQuickActionOpen, setIsQuickActionOpen] = useState(false);
  const [quickActionDefault, setQuickActionDefault] = useState<'expense' | 'income' | 'attendance' | 'goal' | 'savings'>('expense');

  const handleOpenQuickAction = (action: 'expense' | 'income' | 'attendance' | 'goal' | 'savings' = 'expense') => {
    setQuickActionDefault(action);
    setIsQuickActionOpen(true);
  };

  return (
    <div className="min-h-screen flex bg-white text-[#111111] antialiased">
      {/* Desktop Sidebar */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        settings={data.settings}
      />

      {/* Main Workspace Frame */}
      <div className="flex-1 flex flex-col min-w-0 pb-32 md:pb-8">
        {/* Top Navigation Header */}
        <Header
          activeTab={activeTab}
          dateFilter={dateFilter}
          setDateFilter={setDateFilter}
          onOpenQuickAction={() => handleOpenQuickAction('expense')}
          settings={data.settings}
        />

        {/* Workspace Body Content with Smooth Page Transitions */}
        <main className="flex-1 p-3.5 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto relative overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeTab}
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="w-full"
            >
              {activeTab === 'dashboard' && (
                <DashboardView
                  dateFilter={dateFilter}
                  onOpenQuickAction={handleOpenQuickAction}
                  onNavigateTab={setActiveTab}
                />
              )}

              {activeTab === 'goals' && <GoalsView />}
              {activeTab === 'expenses' && <ExpensesView />}
              {activeTab === 'income' && <IncomeView />}
              {activeTab === 'debt' && <DebtView />}
              {activeTab === 'attendance' && <WorkView />}
              {activeTab === 'salary' && <SalaryView />}
              {activeTab === 'savings' && <SavingsView />}
              {activeTab === 'reports' && <ReportsView />}
              {activeTab === 'settings' && <SettingsView />}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Mobile Navigation Bar */}
        <MobileBottomNav
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          settings={data.settings}
        />

        {/* Global Quick Activity Log Modal */}
        <QuickActionModal
          isOpen={isQuickActionOpen}
          onClose={() => setIsQuickActionOpen(false)}
          defaultAction={quickActionDefault}
        />
      </div>
    </div>
  );
}
