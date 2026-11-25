import React, { useState } from 'react';
import {
  LayoutDashboard,
  Target,
  CreditCard,
  TrendingUp,
  CalendarCheck,
  Banknote,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  LucideIcon,
  HandCoins,
  LogOut,
  AudioLines,
  StickyNote
} from 'lucide-react';
import { UserSettings } from '../../types';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { useAuth } from '../../context/AuthContext';
import { XOSLogo } from '../common/XOSLogo';

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
  | 'notes'
  | 'ai-agent'
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
  category: 'core' | 'finance' | 'work' | 'assistant' | 'settings';
}

export const NAV_ITEMS: NavItemConfig[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, category: 'core' },
  { id: 'goals', label: 'Goals & Savings', icon: Target, category: 'core' },
  { id: 'notes', label: 'Notes', icon: StickyNote, category: 'core' },
  { id: 'expenses', label: 'Expenses', icon: CreditCard, category: 'finance' },
  { id: 'income', label: 'Income', icon: TrendingUp, category: 'finance' },
  { id: 'debt', label: 'Debt Management', icon: HandCoins, category: 'finance' },
  { id: 'salary', label: 'Salary Management', icon: Banknote, category: 'finance' },
  { id: 'attendance', label: 'Work Attendance', icon: CalendarCheck, category: 'work' },
  { id: 'reports', label: 'Reports & Analytics', icon: BarChart3, category: 'work' },
  { id: 'ai-agent', label: 'Jarvis AI', icon: AudioLines, category: 'assistant' },
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
  },
  {
    name: 'Intelligence',
    items: NAV_ITEMS.filter(item => item.category === 'assistant')
  }
];

export const Sidebar: React.FC<SidebarProps> = React.memo(({
  activeTab,
  setActiveTab,
  collapsed,
  setCollapsed,
  settings
}) => {
  const { user, signOut } = useAuth();
  const [isSignOutDialogOpen, setIsSignOutDialogOpen] = useState(false);

  const userName = settings.profile.name.trim() || 'My Workspace';
  const avatarLetter = (userName.charAt(0) || 'X').toUpperCase();

  return (
    <aside
      className={`hidden md:flex flex-col bg-[#fbfbfd] border-r border-black/[0.06] transition-[width] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] shrink-0 relative z-30 ${
        collapsed ? 'w-[72px]' : 'w-60'
      }`}
      aria-label="Primary Desktop Navigation"
    >
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-black/[0.06]">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="shrink-0">
            <XOSLogo size="md" />
          </div>
          {!collapsed && (
            <div className="flex flex-col min-w-0">
              <span className="font-semibold text-[15px] text-[#1d1d1f] tracking-[-0.015em] leading-none truncate">
                XOS
              </span>
              <span className="text-[11px] text-[#86868b] font-normal mt-1 truncate">
                Personal OS
              </span>
            </div>
          )}
        </div>

        <button
          onClick={() => setCollapsed(!collapsed)}
          type="button"
          className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-[#86868b] hover:text-[#1d1d1f] hover:bg-black/[0.04] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0284c7] cursor-pointer"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation Sections */}
      <nav className="flex-1 py-4 px-2.5 space-y-5 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group.name} className="space-y-1">
            {!collapsed ? (
              <div className="px-2.5 pb-1 text-[11px] font-medium text-[#86868b]">
                {group.name}
              </div>
            ) : (
              <div className="h-px bg-black/[0.05] mx-2 my-2" aria-hidden="true" />
            )}

            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive =
                  activeTab === item.id ||
                  (item.id === 'goals' && activeTab === 'savings');

                return (
                  <div key={item.id} className="relative group">
                    <button
                      onClick={() => setActiveTab(item.id)}
                      type="button"
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] cursor-pointer text-left transition-colors ${
                        isActive
                          ? 'bg-[#e8e8ed]/85 text-[#1d1d1f] font-semibold'
                          : 'text-[#6e6e73] font-medium hover:text-[#1d1d1f] hover:bg-black/[0.03]'
                      } ${collapsed ? 'justify-center px-0 min-h-[40px]' : ''}`}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <Icon
                        className={`w-4 h-4 shrink-0 transition-colors ${
                          isActive
                            ? 'text-[#0284c7]'
                            : 'text-[#86868b] group-hover:text-[#1d1d1f]'
                        }`}
                      />
                      {!collapsed && (
                        <span className="truncate flex-1 tracking-[-0.005em]">
                          {item.label}
                        </span>
                      )}
                    </button>

                    {collapsed && (
                      <div
                        role="tooltip"
                        className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2.5 z-50 px-2.5 py-1 rounded-lg bg-[#1d1d1f] text-white text-[11px] font-medium whitespace-nowrap shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                      >
                        {item.label}
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
      <div className="p-2.5 border-t border-black/[0.06] space-y-1">
        <div className="relative group">
          <button
            onClick={() => setActiveTab('settings')}
            type="button"
            className={`w-full flex items-center gap-2.5 p-2 rounded-xl cursor-pointer text-left transition-colors ${
              activeTab === 'settings'
                ? 'bg-[#e8e8ed]/85 text-[#1d1d1f]'
                : 'hover:bg-black/[0.03] text-[#1d1d1f]'
            } ${collapsed ? 'justify-center p-1.5' : ''}`}
            aria-label="Account Settings"
          >
            <div
              className={`w-8 h-8 rounded-full font-semibold text-xs flex items-center justify-center shrink-0 transition-colors ${
                activeTab === 'settings'
                  ? 'bg-[#0284c7] text-white'
                  : 'bg-[#1d1d1f] text-white'
              }`}
            >
              {avatarLetter}
            </div>

            {!collapsed && (
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[13px] font-medium text-[#1d1d1f] truncate leading-tight">
                  {userName}
                </span>
                <span className="text-[11px] text-[#86868b] truncate mt-0.5">
                  {user?.email || 'Account Settings'}
                </span>
              </div>
            )}

            {!collapsed && (
              <Settings
                className={`w-4 h-4 shrink-0 ${
                  activeTab === 'settings' ? 'text-[#0284c7]' : 'text-[#86868b] group-hover:text-[#1d1d1f]'
                }`}
              />
            )}
          </button>

          {collapsed && (
            <div
              role="tooltip"
              className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2.5 z-50 px-2.5 py-1 rounded-lg bg-[#1d1d1f] text-white text-[11px] font-medium whitespace-nowrap shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150"
            >
              Settings &amp; Profile
            </div>
          )}
        </div>

        {!collapsed && (
          <button
            type="button"
            onClick={() => setIsSignOutDialogOpen(true)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-[#6e6e73] hover:text-[#1d1d1f] rounded-xl transition-colors cursor-pointer hover:bg-black/[0.03]"
          >
            <span>Sign Out</span>
            <LogOut className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <ConfirmDialog
        isOpen={isSignOutDialogOpen}
        title="Sign Out of Workspace?"
        message="Are you sure you want to sign out of your XOS workspace? Your active session will be securely terminated."
        confirmLabel="Sign Out"
        isDestructive={false}
        onConfirm={() => {
          signOut();
          setIsSignOutDialogOpen(false);
        }}
        onCancel={() => setIsSignOutDialogOpen(false)}
      />
    </aside>
  );
});
