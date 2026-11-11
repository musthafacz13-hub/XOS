import React from 'react';
import { Plus, Calendar } from 'lucide-react';
import { motion } from 'motion/react';
import { DateFilterPreset, DateRangeFilter, UserSettings } from '../../types';
import { ActiveTab, NAV_ITEMS } from './Sidebar';
import { WaterRippleContainer } from '../common/WaterRipple';
import { MOTION_SPRINGS } from '../../utils/motion';

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

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  dateFilter,
  setDateFilter,
  onOpenQuickAction
}) => {
  const activeNavItem = NAV_ITEMS.find(item => item.id === activeTab);
  const title = activeNavItem ? activeNavItem.label : 'Dashboard';

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

  const showDateFilter = ['dashboard', 'reports', 'expenses', 'income'].includes(activeTab);

  return (
    <header className="h-16 border-b border-black/[0.06] liquid-glass px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 sticky top-0 z-20">
      {/* Title & Date Breadcrumb */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <h1 className="text-base sm:text-lg font-bold text-[#111111] tracking-tight truncate">
          {title}
        </h1>
        <span className="hidden lg:inline-block text-neutral-300 font-light" aria-hidden="true">/</span>
        <div className="hidden lg:flex items-center gap-1.5 text-xs text-neutral-500 font-normal">
          <Calendar className="w-3.5 h-3.5 text-neutral-400" />
          <span>{todayStr}</span>
        </div>
        <span className="hidden xl:inline-block text-neutral-300 font-light" aria-hidden="true">/</span>
        <div 
          className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/[0.04] border border-black/[0.05] text-[11px] font-medium text-neutral-700" 
          title="Active in-memory session. Backend integration required for cross-device persistence."
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>Session Active</span>
          <span className="text-neutral-300">•</span>
          <span className="text-neutral-500 font-normal">Cloud Sync Pending</span>
        </div>
      </div>

      {/* Date Filter & Quick Action */}
      <div className="flex items-center gap-2 shrink-0">
        {showDateFilter && (
          <>
            {/* Mobile Native Select (< 768px) */}
            <div className="md:hidden">
              <select
                value={dateFilter.preset}
                onChange={(e) => handlePresetChange(e.target.value as DateFilterPreset)}
                className="h-9 px-2 text-xs font-semibold text-neutral-800 bg-white/90 border border-black/[0.08] rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                aria-label="Filter timeline"
              >
                {PRESET_OPTIONS.map(opt => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Desktop Segmented Buttons (>= 768px) with Fluid Sliding Capsule */}
            <div className="hidden md:flex items-center gap-1 bg-black/[0.04] p-1 rounded-xl border border-black/[0.04] relative">
              {PRESET_OPTIONS.map((opt) => {
                const isSelected = dateFilter.preset === opt.id;
                return (
                  <motion.button
                    key={opt.id}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handlePresetChange(opt.id)}
                    type="button"
                    className={`px-3 py-1 text-xs font-medium rounded-lg whitespace-nowrap cursor-pointer relative z-10 transition-colors duration-150 ${
                      isSelected
                        ? 'text-[#111111] font-bold'
                        : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    {isSelected && (
                      <motion.div
                        layoutId="headerDatePresetActive"
                        transition={MOTION_SPRINGS.tactile}
                        className="absolute inset-0 bg-white rounded-lg shadow-xs z-0"
                      />
                    )}
                    <span className="relative z-10">{opt.label}</span>
                  </motion.button>
                );
              })}
            </div>
          </>
        )}

        {/* Global Quick Activity Button with Tactile Ripple & Scale */}
        <WaterRippleContainer className="rounded-xl">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.95 }}
            onClick={onOpenQuickAction}
            type="button"
            className="h-9 sm:h-10 flex items-center gap-1.5 px-3.5 sm:px-4 rounded-xl bg-[#111111] text-white text-xs font-semibold hover:bg-black transition-colors shadow-xs shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
            aria-label="Log New Activity"
          >
            <Plus className="w-4 h-4 text-[#87CEEB]" />
            <span className="hidden sm:inline">Log Activity</span>
            <span className="sm:hidden">Log</span>
          </motion.button>
        </WaterRippleContainer>
      </div>
    </header>
  );
};
