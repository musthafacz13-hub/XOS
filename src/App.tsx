import React, { useState, useEffect } from 'react';
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

// Authentication & Welcome Views
import { WelcomeView } from './components/welcome/WelcomeView';
import { LoginView } from './components/auth/LoginView';
import { SignUpView } from './components/auth/SignUpView';
import { MagicLinkView } from './components/auth/MagicLinkView';
import { ForgotPasswordView } from './components/auth/ForgotPasswordView';
import { ResetPasswordView } from './components/auth/ResetPasswordView';
import { VerifyEmailView } from './components/auth/VerifyEmailView';
import { AuthCallbackView } from './components/auth/AuthCallbackView';

import { AuthProvider, useAuth } from './context/AuthContext';
import { useXOSData } from './hooks/useXOSData';
import { DateRangeFilter } from './types';

export type AuthRoute = 
  | 'welcome' 
  | 'login' 
  | 'signup' 
  | 'magic-link' 
  | 'forgot-password' 
  | 'reset-password' 
  | 'verify-email' 
  | 'callback';

function XOSApplication() {
  const data = useXOSData();
  const { user, loading, isDemoUser, isPasswordRecovery } = useAuth();

  // Authentication Navigation State
  const [authRoute, setAuthRoute] = useState<AuthRoute>(() => {
    if (typeof window === 'undefined') return 'welcome';
    const hash = window.location.hash;
    const search = window.location.search;
    const pathname = window.location.pathname;

    if (hash.includes('type=recovery') || search.includes('type=recovery')) {
      return 'reset-password';
    }
    if (search.includes('code=') || hash.includes('access_token=') || pathname === '/auth/callback') {
      return 'callback';
    }
    if (hash === '#login') return 'login';
    if (hash === '#signup') return 'signup';
    if (hash === '#magic-link') return 'magic-link';
    if (hash === '#forgot-password') return 'forgot-password';
    return 'welcome';
  });

  const [registeredEmail, setRegisteredEmail] = useState<string>('');

  // Handle password recovery flag from AuthContext
  useEffect(() => {
    if (isPasswordRecovery) {
      setAuthRoute('reset-password');
    }
  }, [isPasswordRecovery]);

  // Workspace Navigation State
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

  // 1. Initial Session Loading Screen (Apple-minimalist splash)
  if (loading) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-4">
        <div className="flex flex-col items-center space-y-4">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="w-12 h-12 rounded-2xl bg-[#111111] text-white flex items-center justify-center font-bold text-lg tracking-wider relative shadow-md"
          >
            <span>X</span>
            <span className="w-2 h-2 rounded-full bg-[#87CEEB] absolute top-2 right-2 animate-pulse" />
          </motion.div>
          <div className="text-center space-y-1">
            <span className="font-bold text-sm text-[#111111] tracking-tight block">XOS</span>
            <span className="text-xs text-neutral-400 font-normal block">Initializing secure workspace...</span>
          </div>
        </div>
      </div>
    );
  }

  // 2. Unauthenticated Routes (Unless exploring as Demo Guest)
  const isAuthenticatedOrDemo = Boolean(user || isDemoUser);

  if (!isAuthenticatedOrDemo || authRoute === 'callback' || authRoute === 'reset-password') {
    return (
      <AnimatePresence mode="wait">
        {authRoute === 'welcome' && (
          <WelcomeView 
            key="welcome" 
            onNavigate={(route) => setAuthRoute(route)} 
          />
        )}

        {authRoute === 'login' && (
          <LoginView
            key="login"
            onNavigate={(route) => setAuthRoute(route)}
            onSuccess={() => setAuthRoute('welcome')}
          />
        )}

        {authRoute === 'signup' && (
          <SignUpView
            key="signup"
            onNavigate={(route) => setAuthRoute(route)}
            onSuccess={() => setAuthRoute('welcome')}
            onSetRegisteredEmail={setRegisteredEmail}
          />
        )}

        {authRoute === 'magic-link' && (
          <MagicLinkView
            key="magic-link"
            onNavigate={(route) => setAuthRoute(route)}
          />
        )}

        {authRoute === 'forgot-password' && (
          <ForgotPasswordView
            key="forgot-password"
            onNavigate={(route) => setAuthRoute(route)}
          />
        )}

        {authRoute === 'reset-password' && (
          <ResetPasswordView
            key="reset-password"
            onSuccess={() => setAuthRoute('welcome')}
            onNavigateLogin={() => setAuthRoute('login')}
          />
        )}

        {authRoute === 'verify-email' && (
          <VerifyEmailView
            key="verify-email"
            email={registeredEmail}
            onNavigateLogin={() => setAuthRoute('login')}
          />
        )}

        {authRoute === 'callback' && (
          <AuthCallbackView
            key="callback"
            onSuccess={() => setAuthRoute('welcome')}
            onPasswordRecovery={() => setAuthRoute('reset-password')}
            onNavigateLogin={() => setAuthRoute('login')}
          />
        )}
      </AnimatePresence>
    );
  }

  // 3. Authenticated / Demo Workspace (All 10 Sections Preserved)
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

export default function App() {
  return (
    <AuthProvider>
      <XOSApplication />
    </AuthProvider>
  );
}
