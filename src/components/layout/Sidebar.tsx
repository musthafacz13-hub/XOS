import React, { useState } from 'react';
import { 
  LayoutDashboard, 
  Target, 
  CreditCard, 
  TrendingUp, 
  CalendarCheck, 
  Banknote, 
  PiggyBank, 
  BarChart3, 
  Settings, 
  ChevronLeft, 
  ChevronRight,
  Sparkles,
  LucideIcon,
  HandCoins,
  LogOut
} from 'lucide-react';
import { motion } from 'motion/react';
import { UserSettings } from '../../types';
import { WaterRippleContainer } from '../common/WaterRipple';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { MOTION_SPRINGS } from '../../utils/motion';
import { useAuth } from '../../context/AuthContext';

export type ActiveTab = 
  | 'dashboard' 
  | 'goals' 
  | 'expenses' 
  | 'income' 
  | 'debt'
  | 'attendance' 
  | 'salary' 
  | 'savings' 
  | 'reports' 
  | 'settings';

interface SidebarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  settings: UserSettings;
}

export interface NavItemConfig {
  id: ActiveTab;
  label: string;
  icon: LucideIcon;
  category: 'core' | 'finance' | 'work' | 'settings';
}

export const NAV_ITEMS: NavItemConfig[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, category: 'core' },
  { id: 'goals', label: 'Goals & Dreams', icon: Target, category: 'core' },
  { id: 'expenses', label: 'Expenses', icon: CreditCard, category: 'finance' },
  { id: 'income', label: 'Income', icon: TrendingUp, category: 'finance' },
  { id: 'debt', label: 'Debt Management', icon: HandCoins, category: 'finance' },
  { id: 'salary', label: 'Salary Management', icon: Banknote, category: 'finance' },
  { id: 'savings', label: 'Savings', icon: PiggyBank, category: 'finance' },
  { id: 'attendance', label: 'Work Attendance', icon: CalendarCheck, category: 'work' },
  { id: 'reports', label: 'Reports & Analytics', icon: BarChart3, category: 'work' },
  { id: 'settings', label: 'Settings', icon: Settings, category: 'settings' }
];

interface NavGroup {
  name: string;
  items: NavItemConfig[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    name: 'Overview',
    items: NAV_ITEMS.filter(item => item.category === 'core')
  },
  {
    name: 'Financials',
    items: NAV_ITEMS.filter(item => item.category === 'finance')
  },
  {
    name: 'Work & Insights',
    items: NAV_ITEMS.filter(item => item.category === 'work')
  }
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  collapsed,
  setCollapsed,
  settings
}) => {
  const { user, isDemoUser, signOut, exitDemoMode } = useAuth();
  const [isSignOutDialogOpen, setIsSignOutDialogOpen] = useState(false);

  const userName = settings.profile.name.trim() || 'My Workspace';
  const userRole = 'Personal System';
  const avatarLetter = (userName.charAt(0) || 'X').toUpperCase();

  return (
    <aside
      className={`hidden md:flex flex-col liquid-glass border-r border-black/[0.06] transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] shrink-0 select-none relative z-30 ${
        collapsed ? 'w-[74px]' : 'w-64'
      }`}
      aria-label="Primary Desktop Navigation"
    >
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-black/[0.06]">
        <div className="flex items-center gap-3 overflow-hidden">
          <motion.div 
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="w-8 h-8 rounded-xl bg-[#111111] text-white flex items-center justify-center font-bold text-sm tracking-wider shrink-0 relative shadow-xs"
          >
            <span>X</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#87CEEB] absolute top-1.5 right-1.5" />
          </motion.div>
          {!collapsed && (
            <motion.div 
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col min-w-0"
            >
              <span className="font-bold text-sm text-[#111111] tracking-tight leading-none truncate">
                XOS
              </span>
              <span className="text-[11px] text-neutral-400 font-normal tracking-tight mt-1 truncate">
                Personal Life OS
              </span>
            </motion.div>
          )}
        </div>

        <motion.button
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.92 }}
          onClick={() => setCollapsed(!collapsed)}
          type="button"
          className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-black/[0.04] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB] cursor-pointer"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </motion.button>
      </div>

      {/* Navigation Sections */}
      <nav className="flex-1 py-3 px-2 space-y-4 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group.name} className="space-y-1">
            {!collapsed && (
              <div className="px-3 pt-1 pb-1 text-[10px] font-semibold tracking-wider uppercase text-neutral-400">
                {group.name}
              </div>
            )}
            {collapsed && (
              <div className="h-px bg-black/[0.04] mx-2 my-2" aria-hidden="true" />
            )}

            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <div key={item.id} className="relative group">
                    <WaterRippleContainer
                      className="rounded-xl"
                      rippleColor={isActive ? 'rgba(255, 255, 255, 0.2)' : 'rgba(135, 206, 235, 0.22)'}
                    >
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setActiveTab(item.id)}
                        type="button"
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium cursor-pointer text-left relative z-10 transition-colors duration-150 ${
                          isActive
                            ? 'text-white'
                            : 'text-neutral-600 hover:text-neutral-900 hover:bg-black/[0.03]'
                        } ${collapsed ? 'justify-center px-0' : ''}`}
                        aria-current={isActive ? 'page' : undefined}
                      >
                        {/* Fluid Sliding Active Capsule Indicator */}
                        {isActive && (
                          <motion.div
                            layoutId="sidebarActiveBackground"
                            transition={MOTION_SPRINGS.tactile}
                            className="absolute inset-0 bg-[#111111] rounded-xl shadow-xs z-0"
                          />
                        )}

                        <div className="w-5 h-5 flex items-center justify-center shrink-0 relative z-10">
                          <Icon className={`w-4 h-4 transition-colors duration-200 ${isActive ? 'text-[#87CEEB]' : 'text-neutral-500 group-hover:text-neutral-800'}`} />
                        </div>
                        
                        {!collapsed && (
                          <span className="truncate flex-1 tracking-tight relative z-10">
                            {item.label}
                          </span>
                        )}

                        {!collapsed && isActive && (
                          <motion.span 
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: 'spring', damping: 20, stiffness: 400 }}
                            className="w-1.5 h-1.5 rounded-full bg-[#87CEEB] shrink-0 relative z-10" 
                            aria-hidden="true" 
                          />
                        )}
                      </motion.button>
                    </WaterRippleContainer>

                    {/* Floating tooltip on collapsed */}
                    {collapsed && (
                      <div
                        role="tooltip"
                        className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2.5 z-50 px-2.5 py-1 rounded-lg bg-[#111111] text-white text-[11px] font-medium whitespace-nowrap shadow-lg opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150"
                      >
                        {item.label}
                        <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-[#111111]" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Profile & Settings Footer */}
      <div className="p-2.5 border-t border-black/[0.06] space-y-1.5">
        {settings.isDemoMode && !collapsed && (
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-neutral-100/80 text-neutral-700 text-[11px] font-medium border border-black/[0.04]">
            <Sparkles className="w-3 h-3 text-[#87CEEB] shrink-0" />
            <span className="truncate">Sample Data Active</span>
          </div>
        )}

        {/* Profile/Settings Tile with Tactile Press & Ripple */}
        <div className="relative group">
          <WaterRippleContainer
            className="rounded-xl"
            rippleColor={activeTab === 'settings' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(135, 206, 235, 0.2)'}
          >
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => setActiveTab('settings')}
              type="button"
              className={`w-full flex items-center gap-2.5 p-2 rounded-xl cursor-pointer text-left relative z-10 transition-colors duration-150 ${
                activeTab === 'settings' 
                  ? 'text-white' 
                  : 'hover:bg-black/[0.03] text-[#111111]'
              } ${collapsed ? 'justify-center p-1.5' : ''}`}
              aria-label="Account Settings"
            >
              {activeTab === 'settings' && (
                <motion.div
                  layoutId="sidebarActiveBackground"
                  transition={MOTION_SPRINGS.tactile}
                  className="absolute inset-0 bg-[#111111] rounded-xl shadow-xs z-0"
                />
              )}

              <div className={`w-8 h-8 rounded-xl font-semibold text-xs flex items-center justify-center shrink-0 relative z-10 transition-colors duration-200 ${
                activeTab === 'settings'
                  ? 'bg-[#87CEEB] text-[#111111]'
                  : 'bg-[#111111] text-white'
              }`}>
                {avatarLetter}
              </div>

              {!collapsed && (
                <div className="flex flex-col min-w-0 flex-1 relative z-10">
                  <span className={`text-xs font-semibold truncate ${
                    activeTab === 'settings' ? 'text-white' : 'text-[#111111]'
                  }`}>
                    {userName}
                  </span>
                  <span className={`text-[11px] truncate ${
                    activeTab === 'settings' ? 'text-neutral-300' : 'text-neutral-400'
                  }`}>
                    {user?.email || userRole}
                  </span>
                </div>
              )}

              {!collapsed && (
                <Settings className={`w-4 h-4 shrink-0 relative z-10 transition-colors duration-200 ${
                  activeTab === 'settings' ? 'text-[#87CEEB]' : 'text-neutral-400 group-hover:text-neutral-700'
                }`} />
              )}
            </motion.button>
          </WaterRippleContainer>

          {collapsed && (
            <div
              role="tooltip"
              className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2.5 z-50 px-2.5 py-1 rounded-lg bg-[#111111] text-white text-[11px] font-medium whitespace-nowrap shadow-lg opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150"
            >
              Settings & Profile
              <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-[#111111]" />
            </div>
          )}
        </div>

        {/* Quick Sign Out Action */}
        {!collapsed && (
          <button
            type="button"
            onClick={() => setIsSignOutDialogOpen(true)}
            className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] text-neutral-400 hover:text-neutral-900 rounded-lg transition-colors cursor-pointer hover:bg-black/[0.03]"
          >
            <span>{isDemoUser ? 'Exit Demo Session' : 'Sign Out'}</span>
            <LogOut className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Sign Out Confirmation Dialog */}
      <ConfirmDialog
        isOpen={isSignOutDialogOpen}
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
          setIsSignOutDialogOpen(false);
        }}
        onCancel={() => setIsSignOutDialogOpen(false)}
      />
    </aside>
  );
};
