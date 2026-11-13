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
  CalendarCheck, 
  Banknote, 
  BarChart3, 
  Settings, 
  X,
  ChevronRight,
  HandCoins,
  LogOut
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { ActiveTab } from './Sidebar';
import { UserSettings } from '../../types';
import { WaterRippleContainer } from '../common/WaterRipple';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { 
  sheetBackdropVariants, 
  sheetContentVariants, 
  submenuContainerVariants, 
  submenuItemVariants,
  MOTION_SPRINGS 
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
  const { isDemoUser, signOut, exitDemoMode } = useAuth();
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isMoneySheetOpen, setIsMoneySheetOpen] = useState(false);
  const [isSignOutOpen, setIsSignOutOpen] = useState(false);

  const isMoneyActive = ['expenses', 'income', 'debt'].includes(activeTab);
  const isWorkActive = ['attendance'].includes(activeTab);
  const isMoreActive = ['salary', 'savings', 'reports', 'settings'].includes(activeTab);

  // Close sheet on Escape key
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

  const handleSelectTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    setIsMoreOpen(false);
    setIsMoneySheetOpen(false);
  };

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
            className="fixed inset-0 z-50 md:hidden bg-black/40 backdrop-blur-xs flex flex-col justify-end"
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
              className="liquid-glass-sheet rounded-t-3xl p-5 shadow-2xl border-t border-black/[0.08] max-h-[75vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drag Pill */}
              <div className="w-12 h-1 rounded-full bg-neutral-300 mx-auto mb-4" />

              <div className="flex items-center justify-between pb-3 mb-3 border-b border-black/[0.06]">
                <div>
                  <h3 className="font-bold text-sm text-[#111111] tracking-tight">
                    Financial Records
                  </h3>
                  <p className="text-[11px] text-neutral-500">Track daily spending, cash inflows, and debt ledgers</p>
                </div>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setIsMoneySheetOpen(false)}
                  className="p-1.5 rounded-xl text-neutral-400 hover:text-neutral-900 hover:bg-black/[0.04] transition-colors cursor-pointer"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </motion.button>
              </div>

              {/* Staggered Submenu Grid */}
              <motion.div 
                variants={submenuContainerVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="grid grid-cols-3 gap-2.5 py-1"
              >
                {/* Expenses */}
                <motion.div variants={submenuItemVariants}>
                  <WaterRippleContainer className="rounded-2xl h-full">
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      type="button"
                      onClick={() => handleSelectTab('expenses')}
                      className={`w-full flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl border text-center cursor-pointer min-h-[88px] transition-colors duration-150 ${
                        activeTab === 'expenses'
                          ? 'border-[#111111] bg-[#111111] text-white shadow-sm'
                          : 'border-black/[0.06] text-neutral-800 bg-white/90 hover:bg-neutral-50'
                      }`}
                    >
                      <CreditCard className={`w-5 h-5 ${activeTab === 'expenses' ? 'text-[#87CEEB]' : 'text-neutral-700'}`} />
                      <span className="text-xs font-semibold">Expenses</span>
                    </motion.button>
                  </WaterRippleContainer>
                </motion.div>

                {/* Income */}
                <motion.div variants={submenuItemVariants}>
                  <WaterRippleContainer className="rounded-2xl h-full">
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      type="button"
                      onClick={() => handleSelectTab('income')}
                      className={`w-full flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl border text-center cursor-pointer min-h-[88px] transition-colors duration-150 ${
                        activeTab === 'income'
                          ? 'border-[#111111] bg-[#111111] text-white shadow-sm'
                          : 'border-black/[0.06] text-neutral-800 bg-white/90 hover:bg-neutral-50'
                      }`}
                    >
                      <TrendingUp className={`w-5 h-5 ${activeTab === 'income' ? 'text-[#87CEEB]' : 'text-neutral-700'}`} />
                      <span className="text-xs font-semibold">Income</span>
                    </motion.button>
                  </WaterRippleContainer>
                </motion.div>

                {/* Debt */}
                <motion.div variants={submenuItemVariants}>
                  <WaterRippleContainer className="rounded-2xl h-full">
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      type="button"
                      onClick={() => handleSelectTab('debt')}
                      className={`w-full flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl border text-center cursor-pointer min-h-[88px] transition-colors duration-150 ${
                        activeTab === 'debt'
                          ? 'border-[#111111] bg-[#111111] text-white shadow-sm'
                          : 'border-black/[0.06] text-neutral-800 bg-white/90 hover:bg-neutral-50'
                      }`}
                    >
                      <HandCoins className={`w-5 h-5 ${activeTab === 'debt' ? 'text-[#87CEEB]' : 'text-neutral-700'}`} />
                      <span className="text-xs font-semibold">Debt</span>
                    </motion.button>
                  </WaterRippleContainer>
                </motion.div>
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
            className="fixed inset-0 z-50 md:hidden bg-black/40 backdrop-blur-xs flex flex-col justify-end"
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
              {/* Sheet Handle */}
              <div className="w-12 h-1 rounded-full bg-neutral-300 mx-auto mb-4" />

              <div className="flex items-center justify-between pb-3 mb-3 border-b border-black/[0.06]">
                <div>
                  <h3 className="font-bold text-sm text-[#111111] tracking-tight">
                    More Modules
                  </h3>
                  <p className="text-[11px] text-neutral-500">Access payroll, savings funds, reports, and settings</p>
                </div>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setIsMoreOpen(false)}
                  className="p-1.5 rounded-xl text-neutral-400 hover:text-neutral-900 hover:bg-black/[0.04] transition-colors cursor-pointer"
                  aria-label="Close menu"
                >
                  <X className="w-4 h-4" />
                </motion.button>
              </div>

              {/* Staggered Rows */}
              <motion.div 
                variants={submenuContainerVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="space-y-2 py-1"
              >
                {/* Salary Management */}
                <motion.div variants={submenuItemVariants}>
                  <WaterRippleContainer className="rounded-2xl">
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      type="button"
                      onClick={() => handleSelectTab('salary')}
                      className={`w-full flex items-center justify-between p-3.5 rounded-2xl border text-left cursor-pointer min-h-[56px] transition-colors duration-150 ${
                        activeTab === 'salary'
                          ? 'border-[#111111] bg-[#111111] text-white shadow-xs'
                          : 'border-black/[0.06] bg-white/90 text-neutral-800 hover:bg-neutral-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                          activeTab === 'salary' ? 'bg-white/10 text-[#87CEEB]' : 'bg-neutral-100 text-neutral-700'
                        }`}>
                          <Banknote className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="text-xs font-bold leading-snug">Salary Management</div>
                          <div className={`text-[11px] ${activeTab === 'salary' ? 'text-neutral-300' : 'text-neutral-500'}`}>
                            Rules, overtime multiplier, allowances & payslips
                          </div>
                        </div>
                      </div>
                      <ChevronRight className={`w-4 h-4 ${activeTab === 'salary' ? 'text-[#87CEEB]' : 'text-neutral-400'}`} />
                    </motion.button>
                  </WaterRippleContainer>
                </motion.div>

                {/* Savings */}
                <motion.div variants={submenuItemVariants}>
                  <WaterRippleContainer className="rounded-2xl">
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      type="button"
                      onClick={() => handleSelectTab('savings')}
                      className={`w-full flex items-center justify-between p-3.5 rounded-2xl border text-left cursor-pointer min-h-[56px] transition-colors duration-150 ${
                        activeTab === 'savings'
                          ? 'border-[#111111] bg-[#111111] text-white shadow-xs'
                          : 'border-black/[0.06] bg-white/90 text-neutral-800 hover:bg-neutral-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                          activeTab === 'savings' ? 'bg-white/10 text-[#87CEEB]' : 'bg-neutral-100 text-neutral-700'
                        }`}>
                          <PiggyBank className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="text-xs font-bold leading-snug">Savings & Reserves</div>
                          <div className={`text-[11px] ${activeTab === 'savings' ? 'text-neutral-300' : 'text-neutral-500'}`}>
                            Emergency funds, deposits & withdrawals
                          </div>
                        </div>
                      </div>
                      <ChevronRight className={`w-4 h-4 ${activeTab === 'savings' ? 'text-[#87CEEB]' : 'text-neutral-400'}`} />
                    </motion.button>
                  </WaterRippleContainer>
                </motion.div>

                {/* Reports & Analytics */}
                <motion.div variants={submenuItemVariants}>
                  <WaterRippleContainer className="rounded-2xl">
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      type="button"
                      onClick={() => handleSelectTab('reports')}
                      className={`w-full flex items-center justify-between p-3.5 rounded-2xl border text-left cursor-pointer min-h-[56px] transition-colors duration-150 ${
                        activeTab === 'reports'
                          ? 'border-[#111111] bg-[#111111] text-white shadow-xs'
                          : 'border-black/[0.06] bg-white/90 text-neutral-800 hover:bg-neutral-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                          activeTab === 'reports' ? 'bg-white/10 text-[#87CEEB]' : 'bg-neutral-100 text-neutral-700'
                        }`}>
                          <BarChart3 className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="text-xs font-bold leading-snug">Reports & Analytics</div>
                          <div className={`text-[11px] ${activeTab === 'reports' ? 'text-neutral-300' : 'text-neutral-500'}`}>
                            Cash flow chart, categories & attendance split
                          </div>
                        </div>
                      </div>
                      <ChevronRight className={`w-4 h-4 ${activeTab === 'reports' ? 'text-[#87CEEB]' : 'text-neutral-400'}`} />
                    </motion.button>
                  </WaterRippleContainer>
                </motion.div>

                {/* Settings & Profile */}
                <motion.div variants={submenuItemVariants}>
                  <WaterRippleContainer className="rounded-2xl">
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      type="button"
                      onClick={() => handleSelectTab('settings')}
                      className={`w-full flex items-center justify-between p-3.5 rounded-2xl border text-left cursor-pointer min-h-[56px] transition-colors duration-150 ${
                        activeTab === 'settings'
                          ? 'border-[#111111] bg-[#111111] text-white shadow-xs'
                          : 'border-black/[0.06] bg-white/90 text-neutral-800 hover:bg-neutral-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                          activeTab === 'settings' ? 'bg-white/10 text-[#87CEEB]' : 'bg-neutral-100 text-neutral-700'
                        }`}>
                          <Settings className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="text-xs font-bold leading-snug">System & Settings</div>
                          <div className={`text-[11px] ${activeTab === 'settings' ? 'text-neutral-300' : 'text-neutral-500'}`}>
                            Profile, currency, backup export/import & reset
                          </div>
                        </div>
                      </div>
                      <ChevronRight className={`w-4 h-4 ${activeTab === 'settings' ? 'text-[#87CEEB]' : 'text-neutral-400'}`} />
                    </motion.button>
                  </WaterRippleContainer>
                </motion.div>

                {/* Sign Out / Exit Session */}
                <motion.div variants={submenuItemVariants} className="pt-1">
                  <WaterRippleContainer className="rounded-2xl">
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      type="button"
                      onClick={() => {
                        setIsMoreOpen(false);
                        setIsSignOutOpen(true);
                      }}
                      className="w-full flex items-center justify-between p-3.5 rounded-2xl border border-black/[0.06] bg-neutral-50 text-neutral-700 hover:bg-neutral-100 text-left cursor-pointer min-h-[52px] transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-neutral-200/70 text-neutral-700">
                          <LogOut className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-xs font-bold leading-snug">
                            {isDemoUser ? 'Exit Demo Session' : 'Sign Out of Workspace'}
                          </div>
                          <div className="text-[11px] text-neutral-400">
                            Securely close your active session
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-neutral-400" />
                    </motion.button>
                  </WaterRippleContainer>
                </motion.div>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fixed Mobile Bottom Navigation Bar (Liquid Glass Dock) */}
      <nav 
        className="fixed bottom-0 left-0 right-0 z-40 md:hidden liquid-glass-dock border-t border-black/[0.08] shadow-[0_-4px_24px_rgba(0,0,0,0.05)] px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))]"
        aria-label="Mobile Navigation"
      >
        <div className="flex items-center justify-around h-13 max-w-md mx-auto">
          {/* Home */}
          <WaterRippleContainer className="flex-1 rounded-xl">
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => handleSelectTab('dashboard')}
              type="button"
              className={`w-full flex flex-col items-center justify-center h-full py-1 cursor-pointer select-none min-h-[44px] transition-colors duration-150 ${
                activeTab === 'dashboard' ? 'text-[#111111] font-bold' : 'text-neutral-400 hover:text-neutral-700'
              }`}
              aria-label="Home Dashboard"
            >
              <div className="relative flex items-center justify-center">
                <LayoutDashboard className={`w-5 h-5 transition-transform duration-200 ${activeTab === 'dashboard' ? 'text-[#111111] scale-105' : ''}`} />
                {activeTab === 'dashboard' && (
                  <motion.span 
                    layoutId="mobileActiveDot"
                    transition={MOTION_SPRINGS.tactile}
                    className="absolute -bottom-1 w-1.5 h-1.5 rounded-full bg-[#87CEEB]" 
                  />
                )}
              </div>
              <span className="text-[10px] mt-1.5 leading-none tracking-tight">Home</span>
            </motion.button>
          </WaterRippleContainer>

          {/* Goals */}
          <WaterRippleContainer className="flex-1 rounded-xl">
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => handleSelectTab('goals')}
              type="button"
              className={`w-full flex flex-col items-center justify-center h-full py-1 cursor-pointer select-none min-h-[44px] transition-colors duration-150 ${
                activeTab === 'goals' ? 'text-[#111111] font-bold' : 'text-neutral-400 hover:text-neutral-700'
              }`}
              aria-label="Goals & Dreams"
            >
              <div className="relative flex items-center justify-center">
                <Target className={`w-5 h-5 transition-transform duration-200 ${activeTab === 'goals' ? 'text-[#111111] scale-105' : ''}`} />
                {activeTab === 'goals' && (
                  <motion.span 
                    layoutId="mobileActiveDot"
                    transition={MOTION_SPRINGS.tactile}
                    className="absolute -bottom-1 w-1.5 h-1.5 rounded-full bg-[#87CEEB]" 
                  />
                )}
              </div>
              <span className="text-[10px] mt-1.5 leading-none tracking-tight">Goals</span>
            </motion.button>
          </WaterRippleContainer>

          {/* Money (Expenses, Income, Debt) */}
          <WaterRippleContainer className="flex-1 rounded-xl">
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => setIsMoneySheetOpen(true)}
              type="button"
              className={`w-full flex flex-col items-center justify-center h-full py-1 cursor-pointer select-none min-h-[44px] transition-colors duration-150 ${
                isMoneyActive ? 'text-[#111111] font-bold' : 'text-neutral-400 hover:text-neutral-700'
              }`}
              aria-label="Money - Expenses, Income and Debt"
            >
              <div className="relative flex items-center justify-center">
                <Wallet className={`w-5 h-5 transition-transform duration-200 ${isMoneyActive ? 'text-[#111111] scale-105' : ''}`} />
                {isMoneyActive && (
                  <motion.span 
                    layoutId="mobileActiveDot"
                    transition={MOTION_SPRINGS.tactile}
                    className="absolute -bottom-1 w-1.5 h-1.5 rounded-full bg-[#87CEEB]" 
                  />
                )}
              </div>
              <span className="text-[10px] mt-1.5 leading-none tracking-tight">
                {activeTab === 'expenses' ? 'Expenses' : activeTab === 'income' ? 'Income' : activeTab === 'debt' ? 'Debt' : 'Money'}
              </span>
            </motion.button>
          </WaterRippleContainer>

          {/* Work (Attendance) */}
          <WaterRippleContainer className="flex-1 rounded-xl">
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => handleSelectTab('attendance')}
              type="button"
              className={`w-full flex flex-col items-center justify-center h-full py-1 cursor-pointer select-none min-h-[44px] transition-colors duration-150 ${
                isWorkActive ? 'text-[#111111] font-bold' : 'text-neutral-400 hover:text-neutral-700'
              }`}
              aria-label="Work Attendance"
            >
              <div className="relative flex items-center justify-center">
                <Briefcase className={`w-5 h-5 transition-transform duration-200 ${isWorkActive ? 'text-[#111111] scale-105' : ''}`} />
                {isWorkActive && (
                  <motion.span 
                    layoutId="mobileActiveDot"
                    transition={MOTION_SPRINGS.tactile}
                    className="absolute -bottom-1 w-1.5 h-1.5 rounded-full bg-[#87CEEB]" 
                  />
                )}
              </div>
              <span className="text-[10px] mt-1.5 leading-none tracking-tight">Work</span>
            </motion.button>
          </WaterRippleContainer>

          {/* More */}
          <WaterRippleContainer className="flex-1 rounded-xl">
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => setIsMoreOpen(true)}
              type="button"
              className={`w-full flex flex-col items-center justify-center h-full py-1 cursor-pointer select-none min-h-[44px] transition-colors duration-150 ${
                isMoreActive || isMoreOpen ? 'text-[#111111] font-bold' : 'text-neutral-400 hover:text-neutral-700'
              }`}
              aria-label="More Features"
            >
              <div className="relative flex items-center justify-center">
                <MoreHorizontal className={`w-5 h-5 transition-transform duration-200 ${isMoreActive || isMoreOpen ? 'text-[#111111] scale-105' : ''}`} />
                {isMoreActive && (
                  <motion.span 
                    layoutId="mobileActiveDot"
                    transition={MOTION_SPRINGS.tactile}
                    className="absolute -bottom-1 w-1.5 h-1.5 rounded-full bg-[#87CEEB]" 
                  />
                )}
              </div>
              <span className="text-[10px] mt-1.5 leading-none tracking-tight">More</span>
            </motion.button>
          </WaterRippleContainer>
        </div>
      </nav>

      {/* Mobile Sign Out Confirmation Dialog */}
      <ConfirmDialog
        isOpen={isSignOutOpen}
        title={isDemoUser ? "Exit Demo Session?" : "Sign Out of Workspace?"}
        message={isDemoUser 
          ? "Are you sure you want to exit the demo session? You will be returned to the Welcome screen."
          : "Are you sure you want to sign out of your XOS workspace? Your active session will be securely terminated."
        }
        confirmLabel={isDemoUser ? "Exit Demo" : "Sign Out"}
        isDestructive={false}
        onConfirm={() => {
          if (isDemoUser) {
            exitDemoMode();
          } else {
            signOut();
          }
          setIsSignOutOpen(false);
        }}
        onCancel={() => setIsSignOutOpen(false)}
      />
    </>
  );
});
