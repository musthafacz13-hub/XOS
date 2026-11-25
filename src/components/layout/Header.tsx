import React from 'react';
import { Plus } from 'lucide-react';
import { DateFilterPreset, DateRangeFilter, UserSettings } from '../../types';
import { ActiveTab, NAV_ITEMS } from './Sidebar';
import { XOSLogo } from '../common/XOSLogo';
import { JarvisLogo } from '../ai/JarvisLogo';
import { SegmentedControl } from '../ui/SegmentedControl';

interface HeaderProps {
  activeTab: ActiveTab;
  dateFilter: DateRangeFilter;
  setDateFilter: React.Dispatch<React.SetStateAction<DateRangeFilter>>;
  onOpenQuickAction: () => void;
  settings: UserSettings;
}

const PRESET_OPTIONS: { id: DateFilterPreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'this_month', label: 'This Month' },
  { id: 'last_month', label: 'Last Month' },
  { id: 'this_year', label: 'This Year' }
];

export const Header: React.FC<HeaderProps> = React.memo(({
  activeTab,
  dateFilter,
  setDateFilter,
  onOpenQuickAction
}) => {
  const isJarvisAi = activeTab === 'ai-agent';
  const activeNavItem = NAV_ITEMS.find(item => item.id === activeTab);
  const title = isJarvisAi
    ? 'Jarvis AI'
    : activeTab === 'savings'
      ? 'Goals & Savings'
      : (activeNavItem ? activeNavItem.label : 'Dashboard');

  const todayStr = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });

  const handlePresetChange = (preset: DateFilterPreset) => {
    setDateFilter(prev => ({
      ...prev,
      preset
    }));
  };

  const showDateFilter = activeTab === 'dashboard';

  return (
    <header className="pt-[env(safe-area-inset-top,0px)] min-h-[calc(4rem+env(safe-area-inset-top,0px))] border-b border-black/[0.06] liquid-glass px-4 sm:px-6 flex items-center justify-between gap-3 sticky top-0 z-20">
      {/* Title & Section Identity */}
      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
        {isJarvisAi ? (
          <JarvisLogo size="sm" />
        ) : (
          <XOSLogo size="xs" className="md:hidden" />
        )}
        <h1 className="text-[17px] sm:text-lg font-semibold text-[#1d1d1f] tracking-[-0.015em] truncate leading-none">
          {title}
        </h1>
        {!isJarvisAi && (
          <span className="hidden lg:inline-block text-xs text-[#86868b] font-normal pl-2 border-l border-black/[0.08]">
            {todayStr}
          </span>
        )}
      </div>

      {/* Date Filter & Quick Action (omitted on Jarvis AI header) */}
      {!isJarvisAi && (
        <div className="flex items-center gap-2.5 shrink-0">
          {showDateFilter && (
            <>
              <div className="md:hidden">
                <select
                  value={dateFilter.preset}
                  onChange={(e) => handlePresetChange(e.target.value as DateFilterPreset)}
                  className="min-h-[40px] max-w-[140px] px-2.5 py-1.5 text-base sm:text-xs font-medium text-[#1d1d1f] bg-[#f5f5f7] border border-transparent rounded-xl focus:outline-none focus:bg-white focus:border-[#0284c7]"
                  aria-label="Filter timeline"
                >
                  {PRESET_OPTIONS.map(opt => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="hidden md:block">
                <SegmentedControl
                  options={PRESET_OPTIONS}
                  value={dateFilter.preset}
                  onChange={handlePresetChange}
                  ariaLabel="Dashboard date range"
                  size="sm"
                />
              </div>
            </>
          )}

          <button
            onClick={() => onOpenQuickAction()}
            type="button"
            className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 sm:px-4 rounded-xl bg-[#1d1d1f] text-white text-[13px] font-medium hover:bg-black transition-colors shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0284c7]"
            aria-label="Log New Activity"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Log Activity</span>
            <span className="sm:hidden">Log</span>
          </button>
        </div>
      )}
    </header>
  );
});
