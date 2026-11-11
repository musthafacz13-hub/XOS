import React, { useState, useEffect } from 'react';
import { User, DollarSign, Trash2, Database, Sparkles, RefreshCw, Check, FileText } from 'lucide-react';
import { useXOSData } from '../../hooks/useXOSData';
import { CURRENCIES } from '../../utils/formatters';
import { CurrencyCode, DateFormat, UserProfile, WeekStartDay } from '../../types';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { PDFExportModal } from '../modals/PDFExportModal';

export const SettingsView: React.FC = () => {
  const data = useXOSData();

  const [profile, setProfile] = useState<UserProfile>(data.settings.profile);
  const [currency, setCurrency] = useState<CurrencyCode>(data.settings.currency);
  const [dateFormat, setDateFormat] = useState<DateFormat>(data.settings.dateFormat);
  const [weekStartDay, setWeekStartDay] = useState<WeekStartDay>(data.settings.weekStartDay);

  const [expenseCategories, setExpenseCategories] = useState<string[]>(data.settings.customExpenseCategories);
  const [newCatName, setNewCatName] = useState('');

  const [incomeSources, setIncomeSources] = useState<string[]>(data.settings.customIncomeSources);
  const [newIncName, setNewIncName] = useState('');

  const [savedNotification, setSavedNotification] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  // In-app confirmation dialog state
  const [confirmAction, setConfirmAction] = useState<'demo' | 'clear' | null>(null);

  // Sync state if settings updated externally
  useEffect(() => {
    setProfile(data.settings.profile);
    setCurrency(data.settings.currency);
    setDateFormat(data.settings.dateFormat);
    setWeekStartDay(data.settings.weekStartDay);
    setExpenseCategories(data.settings.customExpenseCategories);
    setIncomeSources(data.settings.customIncomeSources);
  }, [data.settings]);

  const handleSaveProfileAndPrefs = (e: React.FormEvent) => {
    e.preventDefault();
    data.saveSettings({
      ...data.settings,
      profile,
      currency,
      dateFormat,
      weekStartDay,
      customExpenseCategories: expenseCategories,
      customIncomeSources: incomeSources
    });
    setSavedNotification(true);
    setTimeout(() => setSavedNotification(false), 3000);
  };

  const handleAddCategory = () => {
    if (!newCatName.trim() || expenseCategories.includes(newCatName.trim())) return;
    const updated = [...expenseCategories, newCatName.trim()];
    setExpenseCategories(updated);
    setNewCatName('');
  };

  const handleRemoveCategory = (cat: string) => {
    if (expenseCategories.length <= 1) return;
    setExpenseCategories(expenseCategories.filter(c => c !== cat));
  };

  const handleAddIncomeSource = () => {
    if (!newIncName.trim() || incomeSources.includes(newIncName.trim())) return;
    const updated = [...incomeSources, newIncName.trim()];
    setIncomeSources(updated);
    setNewIncName('');
  };

  const handleRemoveIncomeSource = (src: string) => {
    if (incomeSources.length <= 1) return;
    setIncomeSources(incomeSources.filter(s => s !== src));
  };

  const handleLoadDemoData = () => {
    setConfirmAction('demo');
  };

  const handleClearAllData = () => {
    setConfirmAction('clear');
  };

  const executeLoadDemo = () => {
    data.loadDemoData();
    setBannerMessage('Sample test dataset loaded successfully.');
    setTimeout(() => setBannerMessage(null), 3500);
  };

  const executeClearAll = () => {
    data.clearAllData();
    setBannerMessage('All workspace records have been cleared to a clean state.');
    setTimeout(() => setBannerMessage(null), 3500);
  };

  const [isPDFModalOpen, setIsPDFModalOpen] = useState(false);

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-black/[0.06]">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-[#111111] tracking-tight">
            Settings & Personalization
          </h2>
          <p className="text-xs sm:text-sm text-neutral-500 font-normal mt-0.5">
            Configure profile, currency, date formatting, and local data backups.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {savedNotification && (
            <span className="text-xs text-neutral-700 flex items-center gap-1 font-medium">
              <Check className="w-3.5 h-3.5 text-emerald-600" /> Preferences applied
            </span>
          )}
          <button
            onClick={handleSaveProfileAndPrefs}
            type="button"
            className="flex items-center gap-1.5 px-4 py-2 bg-[#111111] text-white text-xs font-semibold rounded-xl hover:bg-black transition-colors shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
          >
            <span>Save Settings</span>
          </button>
        </div>
      </div>

      {/* Prominent Section Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Prominent Dark Summary Panel (Left Column) */}
        <div className="lg:col-span-1 p-5 sm:p-6 rounded-2xl bg-[#111111] text-white flex flex-col justify-between space-y-4 shadow-xs">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Workspace Profile</span>
              <User className="w-5 h-5 text-[#87CEEB]" />
            </div>
            <div>
              <div className="text-lg font-bold text-white truncate">
                {profile.name.trim() || 'Session User'}
              </div>
              <p className="text-xs text-neutral-400 mt-0.5 truncate">
                {profile.occupation.trim() || 'Independent Operator'}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <button
              onClick={handleSaveProfileAndPrefs}
              type="button"
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-[#87CEEB] text-[#111111] text-xs font-bold rounded-xl hover:bg-[#70c2e3] transition-colors cursor-pointer"
            >
              <Check className="w-3.5 h-3.5 text-[#111111]" />
              <span>Save Settings</span>
            </button>
            <div className="p-2.5 bg-neutral-900 rounded-xl border border-neutral-800 text-[11px] text-neutral-400 flex items-center justify-between">
              <span>Cloud Status</span>
              <span className="text-emerald-400 font-medium">In-Memory Active</span>
            </div>
          </div>
        </div>

        {/* Section Secondary Key Metric Cards (Right 3 Columns) */}
        <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <div className="p-5 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-2 shadow-xs">
            <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Primary Currency</span>
            <div className="text-2xl font-bold font-mono text-[#111111]">
              {currency} ({CURRENCIES[currency]?.symbol || '$'})
            </div>
            <span className="text-[11px] text-neutral-400">{CURRENCIES[currency]?.name || currency}</span>
          </div>

          <div className="p-5 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-2 shadow-xs">
            <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Date & Week Formatting</span>
            <div className="text-lg font-bold font-mono text-[#111111]">
              {dateFormat}
            </div>
            <span className="text-[11px] text-neutral-400">Starts on {weekStartDay}</span>
          </div>

          <div className="p-5 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-2 shadow-xs">
            <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Configured Categories</span>
            <div className="text-2xl font-bold font-mono text-[#111111]">
              {expenseCategories.length + incomeSources.length}
            </div>
            <span className="text-[11px] text-neutral-400">
              {expenseCategories.length} Expense · {incomeSources.length} Revenue
            </span>
          </div>
        </div>
      </div>

      <form onSubmit={handleSaveProfileAndPrefs} className="space-y-6">
        {/* Profile & Regional Settings */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {/* User Profile Card */}
          <div className="p-5 rounded-2xl bg-white border border-black/[0.08] space-y-4 shadow-xs">
            <h3 className="font-bold text-sm text-[#111111] border-b border-black/[0.06] pb-2.5 flex items-center gap-2">
              <User className="w-4 h-4 text-[#87CEEB]" />
              Personal Profile
            </h3>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Display Name</label>
                <input
                  type="text"
                  placeholder="e.g. Jordan Miller"
                  value={profile.name}
                  onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Occupation / Headline</label>
                <input
                  type="text"
                  placeholder="e.g. Independent Consultant"
                  value={profile.occupation}
                  onChange={(e) => setProfile({ ...profile, occupation: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Personal Motto</label>
                <input
                  type="text"
                  placeholder="e.g. Master your time and achieve financial clarity."
                  value={profile.tagline}
                  onChange={(e) => setProfile({ ...profile, tagline: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>
            </div>
          </div>

          {/* Regional Preferences Card */}
          <div className="p-5 rounded-2xl bg-white border border-black/[0.08] space-y-4 shadow-xs">
            <h3 className="font-bold text-sm text-[#111111] border-b border-black/[0.06] pb-2.5 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-[#87CEEB]" />
              Formatting & Salary Rates
            </h3>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Primary Currency</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                >
                  {Object.entries(CURRENCIES).map(([code, info]) => (
                    <option key={code} value={code}>{info.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Date Format</label>
                  <select
                    value={dateFormat}
                    onChange={(e) => setDateFormat(e.target.value as DateFormat)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  >
                    <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                    <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                    <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Week Start Day</label>
                  <select
                    value={weekStartDay}
                    onChange={(e) => setWeekStartDay(e.target.value as WeekStartDay)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  >
                    <option value="Monday">Monday</option>
                    <option value="Sunday">Sunday</option>
                  </select>
                </div>
              </div>

              <div className="pt-2 border-t border-neutral-100 grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-neutral-700 mb-1">Daily Base Rate</label>
                  <input
                    type="number"
                    value={data.settings.salaryConfig.dailyBaseSalary || 500}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      data.saveSettings({
                        ...data.settings,
                        salaryConfig: { ...data.settings.salaryConfig, dailyBaseSalary: val }
                      });
                    }}
                    className="w-full px-2 py-1.5 text-xs font-mono border border-neutral-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-neutral-700 mb-1">Standard Hours</label>
                  <input
                    type="number"
                    value={data.settings.salaryConfig.standardWorkingHours || 8}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 8;
                      data.saveSettings({
                        ...data.settings,
                        salaryConfig: { ...data.settings.salaryConfig, standardWorkingHours: val }
                      });
                    }}
                    className="w-full px-2 py-1.5 text-xs font-mono border border-neutral-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-neutral-700 mb-1">Extra Hr Rate</label>
                  <input
                    type="number"
                    value={data.settings.salaryConfig.extraHourRate || 100}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      data.saveSettings({
                        ...data.settings,
                        salaryConfig: { ...data.settings.salaryConfig, extraHourRate: val }
                      });
                    }}
                    className="w-full px-2 py-1.5 text-xs font-mono border border-neutral-300 rounded-lg"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Custom Categories Manager */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {/* Custom Expense Categories */}
          <div className="p-5 rounded-2xl bg-white border border-black/[0.08] space-y-4 shadow-xs">
            <h3 className="font-bold text-sm text-[#111111] border-b border-black/[0.06] pb-2.5">
              Expense Categories
            </h3>

            <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1">
              {expenseCategories.map((cat) => (
                <div key={cat} className="flex items-center gap-1.5 px-2.5 py-1 bg-neutral-100 text-neutral-800 text-xs font-medium rounded-lg">
                  <span>{cat}</span>
                  <button type="button" onClick={() => handleRemoveCategory(cat)} className="text-neutral-400 hover:text-rose-600 cursor-pointer">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-2 pt-2 border-t border-neutral-100">
              <input
                type="text"
                placeholder="New category"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                className="flex-1 px-3 py-1.5 text-xs border border-neutral-300 rounded-xl"
              />
              <button
                type="button"
                onClick={handleAddCategory}
                className="px-3.5 py-1.5 bg-[#111111] text-white text-xs font-semibold rounded-xl hover:bg-black cursor-pointer"
              >
                Add
              </button>
            </div>
          </div>

          {/* Custom Income Sources */}
          <div className="p-5 rounded-2xl bg-white border border-black/[0.08] space-y-4 shadow-xs">
            <h3 className="font-bold text-sm text-[#111111] border-b border-black/[0.06] pb-2.5">
              Income Sources
            </h3>

            <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1">
              {incomeSources.map((src) => (
                <div key={src} className="flex items-center gap-1.5 px-2.5 py-1 bg-neutral-100 text-neutral-800 text-xs font-medium rounded-lg">
                  <span>{src}</span>
                  <button type="button" onClick={() => handleRemoveIncomeSource(src)} className="text-neutral-400 hover:text-rose-600 cursor-pointer">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-2 pt-2 border-t border-neutral-100">
              <input
                type="text"
                placeholder="New income source"
                value={newIncName}
                onChange={(e) => setNewIncName(e.target.value)}
                className="flex-1 px-3 py-1.5 text-xs border border-neutral-300 rounded-xl"
              />
              <button
                type="button"
                onClick={handleAddIncomeSource}
                className="px-3.5 py-1.5 bg-[#111111] text-white text-xs font-semibold rounded-xl hover:bg-black cursor-pointer"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* Session Data & Export Management Section */}
      <div className="p-5 sm:p-6 rounded-2xl bg-[#111111] text-white space-y-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 border-b border-neutral-800 pb-3">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-[#87CEEB]" />
            <h3 className="font-bold text-sm sm:text-base text-white">Session Workspace Data & PDF Export</h3>
          </div>
          <span className="text-[11px] font-medium text-emerald-400 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Active In-Memory Session
          </span>
        </div>

        {/* Backend Cloud Persistence Status Notice */}
        <div className="p-3.5 rounded-xl bg-neutral-900 border border-neutral-800 text-xs text-neutral-300 flex items-start gap-2.5">
          <div className="w-2 h-2 rounded-full bg-[#87CEEB] mt-1 shrink-0" />
          <div className="space-y-0.5">
            <span className="font-semibold text-white block">Backend Status: Cloud Sync Pending (In-Memory Session Active)</span>
            <p className="text-neutral-400 text-[11px] leading-relaxed">
              XOS operates in responsive in-memory mode. All activities and financial records are actively tracked for this session. Multi-device synchronization and permanent cloud storage will be activated when the production backend database is connected.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Sample Data Button */}
          <button
            onClick={handleLoadDemoData}
            type="button"
            className="p-4 rounded-xl bg-neutral-900 hover:bg-neutral-800 transition-colors text-left space-y-2 border border-neutral-800 cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-[#87CEEB]" />
            <span className="font-bold text-xs text-white block">Load Sample Data</span>
            <span className="text-[11px] text-neutral-400 block">Populate test records for evaluation</span>
          </button>

          {/* Export PDF Report */}
          <button
            onClick={() => setIsPDFModalOpen(true)}
            type="button"
            className="p-4 rounded-xl bg-neutral-900 hover:bg-neutral-800 transition-colors text-left space-y-2 border border-neutral-800 cursor-pointer group"
          >
            <div className="flex items-center justify-between">
              <FileText className="w-4 h-4 text-[#87CEEB] group-hover:scale-110 transition-transform" />
              <span className="text-[9px] font-mono uppercase bg-[#87CEEB]/20 text-[#87CEEB] px-1.5 py-0.5 rounded font-bold">PDF</span>
            </div>
            <span className="font-bold text-xs text-white block">Export PDF Report</span>
            <span className="text-[11px] text-neutral-400 block">Generate audit-grade workspace summary</span>
          </button>

          {/* Clear Workspace */}
          <button
            onClick={handleClearAllData}
            type="button"
            className="p-4 rounded-xl bg-neutral-900 hover:bg-rose-950/60 transition-colors text-left space-y-2 border border-neutral-800 cursor-pointer group"
          >
            <RefreshCw className="w-4 h-4 text-rose-400 group-hover:rotate-180 transition-transform duration-300" />
            <span className="font-bold text-xs text-white block">Reset Workspace</span>
            <span className="text-[11px] text-neutral-400 block">Clear active session records to start fresh</span>
          </button>
        </div>

        {bannerMessage && (
          <div className="p-3 bg-neutral-900 border border-[#87CEEB]/40 text-white rounded-xl text-xs flex items-center justify-between animate-in fade-in duration-200">
            <span>{bannerMessage}</span>
            <button
              onClick={() => setBannerMessage(null)}
              className="text-neutral-400 hover:text-white text-xs cursor-pointer ml-3"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Accessible Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmAction !== null}
        title={confirmAction === 'demo' ? 'Load Sample Test Dataset?' : 'Reset Workspace to Empty Slate?'}
        message={
          confirmAction === 'demo'
            ? 'This will populate sample goals, expenses, income, and attendance records for testing purposes. Any existing data will be replaced by the demo dataset.'
            : 'Are you sure you want to permanently clear ALL workspace records? This action cannot be undone.'
        }
        confirmLabel={confirmAction === 'demo' ? 'Load Test Data' : 'Reset Everything'}
        isDestructive={confirmAction === 'clear'}
        onConfirm={() => {
          if (confirmAction === 'demo') {
            executeLoadDemo();
          } else if (confirmAction === 'clear') {
            executeClearAll();
          }
          setConfirmAction(null);
        }}
        onCancel={() => setConfirmAction(null)}
      />

      {/* PDF Export Options & Generator Modal */}
      <PDFExportModal
        isOpen={isPDFModalOpen}
        onClose={() => setIsPDFModalOpen(false)}
        defaultPreset="all"
      />
    </div>
  );
};
