import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ActiveTab, NAV_ITEMS, Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { MobileBottomNav } from './components/layout/MobileBottomNav';
import { WelcomeView } from './components/welcome/WelcomeView';
import { SplashScreen } from './components/common/SplashScreen';
import { OfflineIndicator } from './components/common/OfflineIndicator';

import { AuthProvider, useAuth } from './context/AuthContext';
import { useXOSData } from './hooks/useXOSData';
import { DateRangeFilter } from './types';
import { clearAuthUrlParams } from './utils/authValidation';

// Lazy-loaded Workspace Views
const DashboardView = lazy(() =>
  import('./components/dashboard/DashboardView').then(m => ({ default: m.DashboardView }))
);
const GoalsAndSavingsView = lazy(() =>
  import('./components/goals/GoalsAndSavingsView').then(m => ({ default: m.GoalsAndSavingsView }))
);
const ExpensesView = lazy(() =>
  import('./components/expenses/ExpensesView').then(m => ({ default: m.ExpensesView }))
);
const IncomeView = lazy(() =>
  import('./components/income/IncomeView').then(m => ({ default: m.IncomeView }))
);
const DebtView = lazy(() =>
  import('./components/debt/DebtView').then(m => ({ default: m.DebtView }))
);
const WorkView = lazy(() =>
  import('./components/work/WorkView').then(m => ({ default: m.WorkView }))
);
const SalaryView = lazy(() =>
  import('./components/salary/SalaryView').then(m => ({ default: m.SalaryView }))
);
const ReportsView = lazy(() =>
  import('./components/reports/ReportsView').then(m => ({ default: m.ReportsView }))
);
const SettingsView = lazy(() =>
  import('./components/settings/SettingsView').then(m => ({ default: m.SettingsView }))
);

// Lazy-loaded Auth Views (WelcomeView remains eager for immediate LCP)
const LoginView = lazy(() =>
  import('./components/auth/LoginView').then(m => ({ default: m.LoginView }))
);
const SignUpView = lazy(() =>
  import('./components/auth/SignUpView').then(m => ({ default: m.SignUpView }))
);
const MagicLinkView = lazy(() =>
  import('./components/auth/MagicLinkView').then(m => ({ default: m.MagicLinkView }))
);
const ForgotPasswordView = lazy(() =>
  import('./components/auth/ForgotPasswordView').then(m => ({ default: m.ForgotPasswordView }))
);
const ResetPasswordView = lazy(() =>
  import('./components/auth/ResetPasswordView').then(m => ({ default: m.ResetPasswordView }))
);
const VerifyEmailView = lazy(() =>
  import('./components/auth/VerifyEmailView').then(m => ({ default: m.VerifyEmailView }))
);
const AuthCallbackView = lazy(() =>
  import('./components/auth/AuthCallbackView').then(m => ({ default: m.AuthCallbackView }))
);

const QuickActionModal = lazy(() =>
  import('./components/modals/QuickActionModal').then(m => ({ default: m.QuickActionModal }))
);

export type AuthRoute = 
  | 'welcome' 
  | 'login' 
  | 'signup' 
  | 'magic-link' 
  | 'forgot-password' 
  | 'reset-password' 
  | 'verify-email' 
  | 'callback';

const AuthRouteFallback: React.FC = () => (
  <div className="min-h-screen min-h-[100dvh] bg-white flex items-center justify-center p-4" aria-busy="true">
    <div className="w-8 h-8 rounded-full border-2 border-neutral-200 border-t-[#111318] animate-spin" />
  </div>
);

const WorkspaceViewFallback: React.FC = () => (
  <div className="min-h-[60vh] space-y-6 animate-pulse" aria-busy="true">
    <div className="pb-3 border-b border-black/[0.06] space-y-2">
      <div className="h-7 w-48 bg-neutral-100 rounded-lg" />
      <div className="h-4 w-72 bg-neutral-100 rounded-lg" />
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div className="h-36 bg-neutral-100 rounded-2xl" />
      <div className="lg:col-span-3 h-36 bg-neutral-100 rounded-2xl" />
    </div>
    <div className="h-64 bg-neutral-100 rounded-2xl" />
  </div>
);

const TAB_TRANSITION = { duration: 0.14, ease: [0.16, 1, 0.3, 1] as const };

function setRobotsMeta(content: 'index, follow' | 'noindex, nofollow') {
  if (typeof document === 'undefined') return;
  let meta = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'robots';
    document.head.appendChild(meta);
  }
  if (meta.content !== content) {
    meta.content = content;
  }
}

function getAuthRouteTitle(route: AuthRoute): string {
  switch (route) {
    case 'welcome':
      return 'XOS — Personal Life Operating System';
    case 'login':
      return 'Sign In — XOS';
    case 'signup':
      return 'Create Account — XOS';
    case 'magic-link':
      return 'Magic Link Sign In — XOS';
    case 'forgot-password':
      return 'Reset Password — XOS';
    case 'reset-password':
      return 'Set New Password — XOS';
    case 'verify-email':
      return 'Verify Email — XOS';
    case 'callback':
      return 'Signing In — XOS';
  }
}

function XOSApplication() {
  const data = useXOSData();
  const { user, loading, initError, retryInitialization, dismissInitError, isDemoUser, isPasswordRecovery } = useAuth();

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

  // Quick Action Modal State (lazy-mounted on first open)
  const [isQuickActionOpen, setIsQuickActionOpen] = useState(false);
  const [hasOpenedQuickAction, setHasOpenedQuickAction] = useState(false);
  const [quickActionDefault, setQuickActionDefault] = useState<'expense' | 'income' | 'attendance' | 'goal' | 'savings'>('expense');

  const handleOpenQuickAction = useCallback((action: 'expense' | 'income' | 'attendance' | 'goal' | 'savings' = 'expense') => {
    setQuickActionDefault(action);
    setHasOpenedQuickAction(true);
    setIsQuickActionOpen(true);
  }, []);

  const handleCloseQuickAction = useCallback(() => {
    setIsQuickActionOpen(false);
  }, []);

  const isAuthenticatedOrDemo = Boolean(user || isDemoUser);
  const showingAuthScreen = !isAuthenticatedOrDemo || authRoute === 'callback' || authRoute === 'reset-password';

  // Clean auth URL parameters/hashes once authenticated in workspace,
  // and ensure signing out resets stale callback/verify routes back to welcome.
  useEffect(() => {
    if (isAuthenticatedOrDemo && !showingAuthScreen) {
      clearAuthUrlParams();
      if (authRoute !== 'welcome') {
        setAuthRoute('welcome');
      }
    }
  }, [isAuthenticatedOrDemo, showingAuthScreen, authRoute]);

  const navigateWelcome = useCallback(() => {
    clearAuthUrlParams();
    setAuthRoute('welcome');
  }, []);

  const navigateLogin = useCallback(() => {
    setAuthRoute('login');
  }, []);

  const navigateResetPassword = useCallback(() => {
    setAuthRoute('reset-password');
  }, []);

  // Route-accurate SEO title & robots indexability (never expose private user info)
  useEffect(() => {
    if (loading) {
      document.title = 'XOS — Personal Life Operating System';
      return;
    }
    if (showingAuthScreen) {
      document.title = getAuthRouteTitle(authRoute);
      setRobotsMeta(authRoute === 'welcome' ? 'index, follow' : 'noindex, nofollow');
      return;
    }
    const navLabel =
      activeTab === 'savings'
        ? 'Goals & Savings'
        : NAV_ITEMS.find(item => item.id === activeTab)?.label || 'Dashboard';
    document.title = `${navLabel} — XOS`;
    setRobotsMeta('noindex, nofollow');
  }, [loading, showingAuthScreen, authRoute, activeTab]);

  // 1. Initial Session Loading & Error Recovery Splash Screen
  if (loading || initError) {
    return (
      <>
        <OfflineIndicator />
        <SplashScreen
          error={initError}
          onRetry={retryInitialization}
          onContinue={dismissInitError}
        />
      </>
    );
  }

  // 2. Unauthenticated Routes (Unless exploring as Demo Guest)
  if (showingAuthScreen) {
    return (
      <>
        <OfflineIndicator />
        <Suspense fallback={<AuthRouteFallback />}>
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
              onNavigate={setAuthRoute}
              onSuccess={navigateWelcome}
            />
          )}

          {authRoute === 'signup' && (
            <SignUpView
              key="signup"
              onNavigate={setAuthRoute}
              onSuccess={navigateWelcome}
              onSetRegisteredEmail={setRegisteredEmail}
            />
          )}

          {authRoute === 'magic-link' && (
            <MagicLinkView
              key="magic-link"
              onNavigate={setAuthRoute}
            />
          )}

          {authRoute === 'forgot-password' && (
            <ForgotPasswordView
              key="forgot-password"
              onNavigate={setAuthRoute}
            />
          )}

          {authRoute === 'reset-password' && (
            <ResetPasswordView
              key="reset-password"
              onSuccess={navigateWelcome}
              onNavigateLogin={navigateLogin}
            />
          )}

          {authRoute === 'verify-email' && (
            <VerifyEmailView
              key="verify-email"
              email={registeredEmail}
              onNavigateLogin={navigateLogin}
            />
          )}

          {authRoute === 'callback' && (
            <AuthCallbackView
              key="callback"
              onSuccess={navigateWelcome}
              onPasswordRecovery={navigateResetPassword}
              onNavigateLogin={navigateLogin}
            />
          )}
        </AnimatePresence>
      </Suspense>
      </>
    );
  }

  // 3. Authenticated / Demo Workspace (All 10 Sections Preserved)
  return (
    <div className="min-h-screen min-h-[100dvh] flex bg-white text-[#111111] antialiased">
      <OfflineIndicator />
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
          onOpenQuickAction={handleOpenQuickAction}
          settings={data.settings}
        />

        {/* Workspace Body Content with Instant-Mount GPU-Composited Transitions */}
        <main className="flex-1 p-3.5 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto relative overflow-x-clip">
          <Suspense fallback={<WorkspaceViewFallback />}>
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={TAB_TRANSITION}
              className="w-full"
            >
              {activeTab === 'dashboard' && (
                <DashboardView
                  dateFilter={dateFilter}
                  onOpenQuickAction={handleOpenQuickAction}
                  onNavigateTab={setActiveTab}
                />
              )}

              {(activeTab === 'goals' || activeTab === 'savings') && <GoalsAndSavingsView />}
              {activeTab === 'expenses' && <ExpensesView />}
              {activeTab === 'income' && <IncomeView />}
              {activeTab === 'debt' && <DebtView />}
              {activeTab === 'attendance' && <WorkView />}
              {activeTab === 'salary' && <SalaryView />}
              {activeTab === 'reports' && <ReportsView />}
              {activeTab === 'settings' && <SettingsView />}
            </motion.div>
          </Suspense>
        </main>

        {/* Mobile Navigation Bar */}
        <MobileBottomNav
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          settings={data.settings}
        />

        {/* Global Quick Activity Log Modal (Lazy-loaded on first open) */}
        {hasOpenedQuickAction && (
          <Suspense fallback={null}>
            <QuickActionModal
              isOpen={isQuickActionOpen}
              onClose={handleCloseQuickAction}
              defaultAction={quickActionDefault}
            />
          </Suspense>
        )}
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
