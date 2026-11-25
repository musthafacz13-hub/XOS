import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Target,
  Wallet,
  Briefcase,
  MoreHorizontal,
  CreditCard,
  TrendingUp,
  PiggyBank,
  Banknote,
  BarChart3,
  Settings,
  X,
  ChevronRight,
  HandCoins,
  LogOut,
  AudioLines,
  StickyNote
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { ActiveTab } from './Sidebar';
import { UserSettings } from '../../types';
import { ConfirmDialog } from '../common/ConfirmDialog';
import {
  sheetBackdropVariants,
  sheetContentVariants,
  submenuContainerVariants,
  submenuItemVariants
} from '../../utils/motion';
import { useAuth } from '../../context/AuthContext';

interface MobileBottomNavProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  settings: UserSettings;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = React.memo(({
  activeTab,
  setActiveTab
}) => {
  const { signOut } = useAuth();
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isMoneySheetOpen, setIsMoneySheetOpen] = useState(false);
  const [isSignOutOpen, setIsSignOutOpen] = useState(false);

  const isMoneyActive = ['expenses', 'income', 'debt'].includes(activeTab);
  const isWorkActive = ['attendance'].includes(activeTab);
  const isMoreActive = ['salary', 'savings', 'reports', 'notes', 'ai-agent', 'settings'].includes(activeTab);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMoreOpen(false);
        setIsMoneySheetOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Lock background document scroll when either mobile sheet is open
  useEffect(() => {
    if (!isMoreOpen && !isMoneySheetOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMoreOpen, isMoneySheetOpen]);

  const handleSelectTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    setIsMoreOpen(false);
    setIsMoneySheetOpen(false);
  };

  const moreItems: Array<{
    tab: ActiveTab;
    label: string;
    subtitle: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { tab: 'notes', label: 'Notes', subtitle: 'Purchase plans, shopping lists & reminders', icon: StickyNote },
    { tab: 'ai-agent', label: 'Jarvis AI', subtitle: 'Personal voice assistant in English & Malayalam', icon: AudioLines },
    { tab: 'salary', label: 'Salary Management', subtitle: 'Rules, overtime multiplier, allowances & payouts', icon: Banknote },
    { tab: 'savings', label: 'Goals & Reserves', subtitle: 'Connected goal funds, deposits & withdrawals', icon: PiggyBank },
    { tab: 'reports', label: 'Reports & Analytics', subtitle: 'Cash flow trends, categories & work breakdown', icon: BarChart3 },
    { tab: 'settings', label: 'System & Settings', subtitle: 'Profile, currency, PDF export & backups', icon: Settings }
  ];

  return (
    <>
      {/* Money Quick Selection Submenu Sheet */}
      <AnimatePresence>
        {isMoneySheetOpen && (
          <motion.div
            variants={sheetBackdropVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 z-50 md:hidden bg-black/35 backdrop-blur-xs flex flex-col justify-end"
            onClick={() => setIsMoneySheetOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Money Navigation"
          >
            <motion.div
              variants={sheetContentVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="liquid-glass-sheet rounded-t-3xl p-5 shadow-2xl border-t border-black/[0.08] max-h-[75vh] overflow-y-auto pb-[max(1.25rem,env(safe-area-inset-bottom,0px))]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1 rounded-full bg-black/15 mx-auto mb-4" />

              <div className="flex items-center justify-between pb-3 mb-4 border-b border-black/[0.06]">
                <div>
                  <h3 className="font-semibold text-base text-[#1d1d1f] tracking-[-0.015em]">
                    Money
                  </h3>
                  <p className="text-xs text-[#6e6e73] mt-0.5">
                    Spending, inflows, and debt ledgers
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMoneySheetOpen(false)}
                  className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-[#86868b] hover:text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors cursor-pointer"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <motion.div
                variants={submenuContainerVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="grid grid-cols-3 gap-2.5 py-1"
              >
                {[
                  { tab: 'expenses' as ActiveTab, label: 'Expenses', icon: CreditCard },
                  { tab: 'income' as ActiveTab, label: 'Income', icon: TrendingUp },
                  { tab: 'debt' as ActiveTab, label: 'Debt', icon: HandCoins }
                ].map(({ tab, label, icon: Icon }) => {
                  const selected = activeTab === tab;
                  return (
                    <motion.div key={tab} variants={submenuItemVariants}>
                      <button
                        type="button"
                        onClick={() => handleSelectTab(tab)}
                        className={`w-full flex flex-col items-center justify-center gap-2 p-3.5 rounded-2xl border text-center cursor-pointer min-h-[88px] transition-colors ${
                          selected
                            ? 'border-[#0284c7]/30 bg-[#e0f2fe]/60 text-[#0284c7]'
                            : 'border-black/[0.06] bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e8e8ed]'
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                        <span className="text-xs font-medium">{label}</span>
                      </button>
                    </motion.div>
                  );
                })}
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Slide-Up "More" Sheet */}
      <AnimatePresence>
        {isMoreOpen && (
          <motion.div
            variants={sheetBackdropVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 z-50 md:hidden bg-black/35 backdrop-blur-xs flex flex-col justify-end"
            onClick={() => setIsMoreOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Application Modules"
          >
            <motion.div
              variants={sheetContentVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="liquid-glass-sheet rounded-t-3xl p-5 shadow-2xl border-t border-black/[0.08] max-h-[85vh] overflow-y-auto pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1 rounded-full bg-black/15 mx-auto mb-4" />

              <div className="flex items-center justify-between pb-3 mb-4 border-b border-black/[0.06]">
                <div>
                  <h3 className="font-semibold text-base text-[#1d1d1f] tracking-[-0.015em]">
                    More Modules
                  </h3>
                  <p className="text-xs text-[#6e6e73] mt-0.5">
                    Notes, Jarvis AI, payroll, analytics &amp; settings
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMoreOpen(false)}
                  className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-[#86868b] hover:text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors cursor-pointer"
                  aria-label="Close menu"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <motion.div
                variants={submenuContainerVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="rounded-2xl border border-black/[0.06] bg-white divide-y divide-black/[0.05] overflow-hidden"
              >
                {moreItems.map(({ tab, label, subtitle, icon: Icon }) => {
                  const selected = activeTab === tab;
                  return (
                    <motion.div key={tab} variants={submenuItemVariants}>
                      <button
                        type="button"
                        onClick={() => handleSelectTab(tab)}
                        className={`w-full flex items-center justify-between px-4 py-3.5 text-left cursor-pointer min-h-[58px] transition-colors ${
                          selected ? 'bg-[#e0f2fe]/45' : 'hover:bg-[#f5f5f7]'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                              selected ? 'bg-[#0284c7] text-white' : 'bg-[#f5f5f7] text-[#1d1d1f]'
                            }`}
                          >
                            <Icon className="w-4.5 h-4.5" />
                          </div>
                          <div className="min-w-0">
                            <div className={`text-[13px] font-semibold leading-snug truncate ${selected ? 'text-[#0284c7]' : 'text-[#1d1d1f]'}`}>
                              {label}
                            </div>
                            <div className="text-[11px] text-[#6e6e73] truncate">
                              {subtitle}
                            </div>
                          </div>
                        </div>
                        <ChevronRight className={`w-4 h-4 shrink-0 ${selected ? 'text-[#0284c7]' : 'text-[#86868b]'}`} />
                      </button>
                    </motion.div>
                  );
                })}
              </motion.div>

              <button
                type="button"
                onClick={() => {
                  setIsMoreOpen(false);
                  setIsSignOutOpen(true);
                }}
                className="mt-3 w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-[#f5f5f7] hover:bg-[#e8e8ed] text-[#1d1d1f] text-left cursor-pointer min-h-[52px] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <LogOut className="w-4 h-4 text-[#6e6e73]" />
                  <span className="text-[13px] font-medium">Sign Out of Workspace</span>
                </div>
                <ChevronRight className="w-4 h-4 text-[#86868b]" />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fixed Mobile Bottom Navigation Bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 md:hidden liquid-glass-dock border-t border-black/[0.08] px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))]"
        aria-label="Mobile Navigation"
      >
        <div className="flex items-center justify-around h-13 max-w-md mx-auto">
          <button
            onClick={() => handleSelectTab('dashboard')}
            type="button"
            className={`flex-1 flex flex-col items-center justify-center h-full py-1 cursor-pointer select-none min-h-[44px] transition-colors ${
              activeTab === 'dashboard' ? 'text-[#0284c7] font-semibold' : 'text-[#86868b] hover:text-[#1d1d1f]'
            }`}
            aria-label="Home Dashboard"
          >
            <LayoutDashboard className="w-5 h-5" />
            <span className="text-[10px] mt-1 leading-none">Home</span>
          </button>

          <button
            onClick={() => handleSelectTab('goals')}
            type="button"
            className={`flex-1 flex flex-col items-center justify-center h-full py-1 cursor-pointer select-none min-h-[44px] transition-colors ${
              activeTab === 'goals' ? 'text-[#0284c7] font-semibold' : 'text-[#86868b] hover:text-[#1d1d1f]'
            }`}
            aria-label="Goals & Dreams"
          >
            <Target className="w-5 h-5" />
            <span className="text-[10px] mt-1 leading-none">Goals</span>
          </button>

          <button
            onClick={() => setIsMoneySheetOpen(true)}
            type="button"
            className={`flex-1 flex flex-col items-center justify-center h-full py-1 cursor-pointer select-none min-h-[44px] transition-colors ${
              isMoneyActive ? 'text-[#0284c7] font-semibold' : 'text-[#86868b] hover:text-[#1d1d1f]'
            }`}
            aria-label="Money - Expenses, Income and Debt"
          >
            <Wallet className="w-5 h-5" />
            <span className="text-[10px] mt-1 leading-none">
              {activeTab === 'expenses' ? 'Expenses' : activeTab === 'income' ? 'Income' : activeTab === 'debt' ? 'Debt' : 'Money'}
            </span>
          </button>

          <button
            onClick={() => handleSelectTab('attendance')}
            type="button"
            className={`flex-1 flex flex-col items-center justify-center h-full py-1 cursor-pointer select-none min-h-[44px] transition-colors ${
              isWorkActive ? 'text-[#0284c7] font-semibold' : 'text-[#86868b] hover:text-[#1d1d1f]'
            }`}
            aria-label="Work Attendance"
          >
            <Briefcase className="w-5 h-5" />
            <span className="text-[10px] mt-1 leading-none">Work</span>
          </button>

          <button
            onClick={() => setIsMoreOpen(true)}
            type="button"
            className={`flex-1 flex flex-col items-center justify-center h-full py-1 cursor-pointer select-none min-h-[44px] transition-colors ${
              isMoreActive || isMoreOpen ? 'text-[#0284c7] font-semibold' : 'text-[#86868b] hover:text-[#1d1d1f]'
            }`}
            aria-label="More Features"
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[10px] mt-1 leading-none">More</span>
          </button>
        </div>
      </nav>

      <ConfirmDialog
        isOpen={isSignOutOpen}
        title="Sign Out of Workspace?"
        message="Are you sure you want to sign out of your XOS workspace? Your active session will be securely terminated."
        confirmLabel="Sign Out"
        isDestructive={false}
        onConfirm={() => {
          signOut();
          setIsSignOutOpen(false);
        }}
        onCancel={() => setIsSignOutOpen(false)}
      />
    </>
  );
});
