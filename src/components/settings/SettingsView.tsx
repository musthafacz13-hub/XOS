import React, { useState, useEffect, useCallback } from 'react';
import { 
  User, 
  DollarSign, 
  Calendar, 
  Briefcase, 
  Tags, 
  FileText, 
  RefreshCw, 
  Check, 
  AlertCircle, 
  Loader2, 
  ShieldCheck, 
  LogOut, 
  Trash2, 
  Plus 
} from 'lucide-react';
import { useXOSData } from '../../hooks/useXOSData';
import { CURRENCIES, formatCurrency } from '../../utils/formatters';
import { CurrencyCode, DateFormat, WeekStartDay, SalaryConfig } from '../../types';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { PDFExportModal } from '../modals/PDFExportModal';
import { useAuth } from '../../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../../services/supabase';

type ConnectionStatus = 'connected' | 'checking' | 'unavailable' | 'signed_out';

export const SettingsView: React.FC = () => {
  const data = useXOSData();
  const { user, isDemoUser, signOut, exitDemoMode } = useAuth();

  // Connection & Initial Data Loading State
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    user ? 'checking' : isDemoUser ? 'signed_out' : 'unavailable'
  );
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState<boolean>(true);

  // Form State
  const [profileName, setProfileName] = useState<string>('');
  const [profileOccupation, setProfileOccupation] = useState<string>('');
  const [profileTagline, setProfileTagline] = useState<string>('');

  // Primary Currency: fallback to INR if no saved preference exists
  const [currency, setCurrency] = useState<CurrencyCode>('INR');
  const [dateFormat, setDateFormat] = useState<DateFormat>('YYYY-MM-DD');
  const [weekStartDay, setWeekStartDay] = useState<WeekStartDay>('Monday');

  // Salary Settings
  const [salaryConfig, setSalaryConfig] = useState<SalaryConfig>(data.settings.salaryConfig);

  // Categories
  const [expenseCategories, setExpenseCategories] = useState<string[]>(data.settings.customExpenseCategories);
  const [newCatName, setNewCatName] = useState<string>('');

  const [incomeSources, setIncomeSources] = useState<string[]>(data.settings.customIncomeSources);
  const [newIncName, setNewIncName] = useState<string>('');

  // Save feedback state
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);

  // Modals & Dialogs
  const [isSignOutModalOpen, setIsSignOutModalOpen] = useState<boolean>(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState<boolean>(false);
  const [isPDFModalOpen, setIsPDFModalOpen] = useState<boolean>(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  // 1. Initial Load: Read real values from Supabase tables or local state fallback
  const loadSavedSettings = useCallback(async () => {
    setIsLoadingSettings(true);
    setConnectionError(null);

    // Initial fallback from memory/local defaults
    const local = data.settings;
    setProfileName(local.profile.name || user?.user_metadata?.full_name || '');
    setProfileOccupation(local.profile.occupation || '');
    setProfileTagline(local.profile.tagline || '');
    setCurrency(local.currency || 'INR');
    setDateFormat(local.dateFormat || 'YYYY-MM-DD');
    setWeekStartDay(local.weekStartDay || 'Monday');
    setSalaryConfig(local.salaryConfig);
    setExpenseCategories(local.customExpenseCategories || []);
    setIncomeSources(local.customIncomeSources || []);

    if (!user) {
      setConnectionStatus(isDemoUser ? 'signed_out' : 'unavailable');
      setIsLoadingSettings(false);
      return;
    }

    if (!isSupabaseConfigured) {
      setConnectionStatus('unavailable');
      setConnectionError('Supabase environment variables not configured.');
      setIsLoadingSettings(false);
      return;
    }

    setConnectionStatus('checking');

    try {
      // Safe, read-only parallel query to existing user-owned tables respecting RLS
      const [profileRes, settingsRes, salaryRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('display_name, occupation, tagline')
          .eq('id', user.id)
          .maybeSingle(),
        supabase
          .from('user_settings')
          .select('currency, date_format, week_start_day, custom_expense_categories, custom_income_sources')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('salary_configs')
          .select('daily_base_salary, standard_working_hours, extra_hour_rate, salary_type, base_amount')
          .eq('user_id', user.id)
          .maybeSingle()
      ]);

      if (profileRes.error || settingsRes.error || salaryRes.error) {
        const err = profileRes.error || settingsRes.error || salaryRes.error;
        console.warn('Supabase settings query warning:', err?.message);
        setConnectionStatus('unavailable');
        setConnectionError(err?.message || 'Database query failed.');
      } else {
        setConnectionStatus('connected');
      }

      // Populate Profile
      if (profileRes.data) {
        setProfileName(profileRes.data.display_name || user?.user_metadata?.full_name || '');
        setProfileOccupation(profileRes.data.occupation || '');
        setProfileTagline(profileRes.data.tagline || '');
      }

      // Populate User Settings (respecting existing saved currency or defaulting cleanly to INR)
      if (settingsRes.data) {
        if (settingsRes.data.currency) {
          setCurrency(settingsRes.data.currency as CurrencyCode);
        } else {
          setCurrency('INR');
        }

        if (settingsRes.data.date_format) {
          setDateFormat(settingsRes.data.date_format as DateFormat);
        }
        if (settingsRes.data.week_start_day) {
          setWeekStartDay(settingsRes.data.week_start_day as WeekStartDay);
        }
        if (Array.isArray(settingsRes.data.custom_expense_categories) && settingsRes.data.custom_expense_categories.length > 0) {
          setExpenseCategories(settingsRes.data.custom_expense_categories);
        }
        if (Array.isArray(settingsRes.data.custom_income_sources) && settingsRes.data.custom_income_sources.length > 0) {
          setIncomeSources(settingsRes.data.custom_income_sources);
        }
      }

      // Populate Salary Config
      const salData = salaryRes.data;
      if (salData) {
        setSalaryConfig(prev => ({
          ...prev,
          dailyBaseSalary: Number(salData.daily_base_salary) || prev.dailyBaseSalary,
          standardWorkingHours: Number(salData.standard_working_hours) || prev.standardWorkingHours,
          extraHourRate: Number(salData.extra_hour_rate) || prev.extraHourRate,
          salaryType: salData.salary_type || prev.salaryType,
          baseAmount: Number(salData.base_amount) || prev.baseAmount
        }));
      }

      // Sync local repository state so other sections reflect real database settings
      data.saveSettings({
        ...data.settings,
        profile: {
          name: profileRes.data?.display_name || user?.user_metadata?.full_name || local.profile.name,
          email: user.email || '',
          occupation: profileRes.data?.occupation || local.profile.occupation,
          tagline: profileRes.data?.tagline || local.profile.tagline
        },
        currency: (settingsRes.data?.currency as CurrencyCode) || local.currency || 'INR',
        dateFormat: (settingsRes.data?.date_format as DateFormat) || local.dateFormat,
        weekStartDay: (settingsRes.data?.week_start_day as WeekStartDay) || local.weekStartDay,
        customExpenseCategories: settingsRes.data?.custom_expense_categories || local.customExpenseCategories,
        customIncomeSources: settingsRes.data?.custom_income_sources || local.customIncomeSources,
        salaryConfig: salData ? {
          ...local.salaryConfig,
          dailyBaseSalary: Number(salData.daily_base_salary) || local.salaryConfig.dailyBaseSalary,
          standardWorkingHours: Number(salData.standard_working_hours) || local.salaryConfig.standardWorkingHours,
          extraHourRate: Number(salData.extra_hour_rate) || local.salaryConfig.extraHourRate
        } : local.salaryConfig
      });
    } catch (err) {
      console.error('Error loading Supabase settings:', err);
      setConnectionStatus('unavailable');
      setConnectionError(err instanceof Error ? err.message : 'Connection check failed.');
    } finally {
      setIsLoadingSettings(false);
    }
  }, [user, isDemoUser, isSupabaseConfigured]);

  useEffect(() => {
    loadSavedSettings();
  }, [loadSavedSettings]);

  // 2. Save Settings Handler: Persists to Supabase tables, then synchronizes local repository
  const handleSaveSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSaving) return;

    setIsSaving(true);
    setSaveSuccessMessage(null);
    setSaveErrorMessage(null);

    try {
      if (user && isSupabaseConfigured) {
        // A. Update profiles table
        const { error: profileError } = await supabase
          .from('profiles')
          .upsert({
            id: user.id,
            display_name: profileName.trim(),
            occupation: profileOccupation.trim(),
            tagline: profileTagline.trim(),
            updated_at: new Date().toISOString()
          });

        if (profileError) throw profileError;

        // B. Update user_settings table
        const { error: settingsError } = await supabase
          .from('user_settings')
          .upsert({
            user_id: user.id,
            currency,
            date_format: dateFormat,
            week_start_day: weekStartDay,
            custom_expense_categories: expenseCategories,
            custom_income_sources: incomeSources,
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id' });

        if (settingsError) throw settingsError;

        // C. Update salary_configs table
        const { error: salaryError } = await supabase
          .from('salary_configs')
          .upsert({
            user_id: user.id,
            daily_base_salary: salaryConfig.dailyBaseSalary,
            standard_working_hours: salaryConfig.standardWorkingHours,
            extra_hour_rate: salaryConfig.extraHourRate,
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id' });

        if (salaryError) throw salaryError;
      }

      // Synchronize local workspace state
      data.saveSettings({
        ...data.settings,
        profile: {
          name: profileName.trim(),
          email: user?.email || data.settings.profile.email,
          occupation: profileOccupation.trim(),
          tagline: profileTagline.trim()
        },
        currency,
        dateFormat,
        weekStartDay,
        salaryConfig,
        customExpenseCategories: expenseCategories,
        customIncomeSources: incomeSources
      });

      setSaveSuccessMessage('Settings saved successfully.');
      setTimeout(() => setSaveSuccessMessage(null), 3500);
    } catch (err) {
      console.error('Failed to save settings to Supabase:', err);
      const msg = err instanceof Error ? err.message : 'Database update failed. Please try again.';
      setSaveErrorMessage(`Error saving settings: ${msg}`);
      setTimeout(() => setSaveErrorMessage(null), 6000);
    } finally {
      setIsSaving(false);
    }
  };

  // Category helpers
  const handleAddCategory = () => {
    const trimmed = newCatName.trim();
    if (!trimmed || expenseCategories.some(c => c.toLowerCase() === trimmed.toLowerCase())) return;
    setExpenseCategories([...expenseCategories, trimmed]);
    setNewCatName('');
  };

  const handleRemoveCategory = (cat: string) => {
    if (expenseCategories.length <= 1) return;
    setExpenseCategories(expenseCategories.filter(c => c !== cat));
  };

  const handleAddIncomeSource = () => {
    const trimmed = newIncName.trim();
    if (!trimmed || incomeSources.some(s => s.toLowerCase() === trimmed.toLowerCase())) return;
    setIncomeSources([...incomeSources, trimmed]);
    setNewIncName('');
  };

  const handleRemoveIncomeSource = (src: string) => {
    if (incomeSources.length <= 1) return;
    setIncomeSources(incomeSources.filter(s => s !== src));
  };

  // Reset workspace: clears local temporary UI state without deleting Supabase cloud records
  const executeResetWorkspace = () => {
    data.clearAllData();
    setBannerMessage('Local workspace view reset. Your Supabase cloud records remain securely preserved.');
    setTimeout(() => setBannerMessage(null), 4000);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* 1. Header Bar with Single Primary Save Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-black/[0.06]">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-[#111111] tracking-tight">
            Settings & Personalization
          </h2>
          <p className="text-xs sm:text-sm text-neutral-500 font-normal mt-0.5">
            Manage your account, regional preferences, salary parameters, and categories.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {saveSuccessMessage && (
            <span className="text-xs text-emerald-700 flex items-center gap-1 font-semibold animate-in fade-in duration-150">
              <Check className="w-4 h-4 text-emerald-600" />
              <span>{saveSuccessMessage}</span>
            </span>
          )}
          {saveErrorMessage && (
            <span className="text-xs text-rose-700 flex items-center gap-1 font-semibold animate-in fade-in duration-150">
              <AlertCircle className="w-4 h-4 text-rose-600" />
              <span>{saveErrorMessage}</span>
            </span>
          )}

          <button
            onClick={() => handleSaveSettings()}
            type="button"
            disabled={isSaving || isLoadingSettings}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#111111] text-white text-xs font-semibold rounded-xl hover:bg-black transition-colors shadow-xs disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#87CEEB]" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5 text-[#87CEEB]" />
                <span>Save Settings</span>
              </>
            )}
          </button>
        </div>
      </div>

      {bannerMessage && (
        <div className="p-3 bg-neutral-50 border border-neutral-200 text-neutral-800 rounded-xl text-xs flex items-center justify-between animate-in fade-in duration-200">
          <span>{bannerMessage}</span>
          <button
            onClick={() => setBannerMessage(null)}
            type="button"
            className="text-neutral-500 hover:text-black text-xs cursor-pointer ml-3 font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 2. SECTION A: Account & Session Information */}
      <div className="p-5 rounded-2xl bg-white border border-black/[0.08] space-y-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-black/[0.06] pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#87CEEB]" />
            <h3 className="font-bold text-sm text-[#111111]">Account & Authentication</h3>
          </div>

          {/* Real Connection Status Indicator */}
          <div className="flex items-center gap-2 text-xs">
            {connectionStatus === 'connected' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold text-[11px] border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Connected
              </span>
            )}
            {connectionStatus === 'checking' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-neutral-100 text-neutral-600 font-medium text-[11px]">
                <Loader2 className="w-3 h-3 animate-spin text-[#87CEEB]" />
                Checking connection...
              </span>
            )}
            {connectionStatus === 'unavailable' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 font-medium text-[11px] border border-amber-200">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                Connection unavailable
              </span>
            )}
            {connectionStatus === 'signed_out' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-neutral-100 text-neutral-600 font-medium text-[11px]">
                Signed out
              </span>
            )}
          </div>
        </div>

        {connectionError && (
          <div className="p-3 bg-amber-50/80 border border-amber-200 text-amber-900 text-xs rounded-xl flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <span className="leading-relaxed">Database notice: {connectionError}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          {/* Account Email */}
          <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-100 space-y-1">
            <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider block">
              Account Email
            </span>
            <div className="font-semibold text-neutral-900 truncate">
              {user?.email || (isDemoUser ? 'Guest User (Demo Session)' : 'Not signed in')}
            </div>
          </div>

          {/* Profile Name */}
          <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-100 space-y-1">
            <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider block">
              Display Name
            </span>
            <div className="font-semibold text-neutral-900 truncate">
              {profileName.trim() || user?.user_metadata?.full_name || 'Personal Workspace'}
            </div>
          </div>

          {/* Session & Sign Out */}
          <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-100 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider block">
                Session Action
              </span>
              <span className="text-neutral-600 font-medium">
                {user ? 'Authenticated' : isDemoUser ? 'Demo' : 'Local'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsSignOutModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:text-rose-700 bg-white border border-rose-200 hover:border-rose-300 rounded-lg transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{isDemoUser ? 'Exit Demo' : 'Sign Out'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 3. SECTION B: Preferences (Currency, Date, Week) */}
      <div className="p-5 rounded-2xl bg-white border border-black/[0.08] space-y-4 shadow-xs">
        <div className="flex items-center justify-between border-b border-black/[0.06] pb-3">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-[#87CEEB]" />
            <h3 className="font-bold text-sm text-[#111111]">Regional Preferences</h3>
          </div>
          <span className="text-xs text-neutral-500 font-medium">
            Preview: <span className="font-bold font-mono text-[#111111]">{formatCurrency(100000, currency)}</span>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Primary Currency */}
          <div className="space-y-1.5 text-left">
            <label htmlFor="currency-select" className="block text-xs font-semibold text-neutral-700">
              Primary Currency
            </label>
            <select
              id="currency-select"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
              className="w-full px-3 py-2 text-xs sm:text-sm border border-neutral-300 rounded-xl bg-white font-medium text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB] cursor-pointer"
            >
              {Object.entries(CURRENCIES).map(([code, info]) => (
                <option key={code} value={code}>
                  {info.name} ({info.symbol})
                </option>
              ))}
            </select>
            <span className="text-[11px] text-neutral-400 block">
              Default is INR (₹) with Indian number formatting.
            </span>
          </div>

          {/* Date Format */}
          <div className="space-y-1.5 text-left">
            <label htmlFor="date-format-select" className="block text-xs font-semibold text-neutral-700">
              Date Format
            </label>
            <select
              id="date-format-select"
              value={dateFormat}
              onChange={(e) => setDateFormat(e.target.value as DateFormat)}
              className="w-full px-3 py-2 text-xs sm:text-sm border border-neutral-300 rounded-xl bg-white font-medium text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB] cursor-pointer"
            >
              <option value="YYYY-MM-DD">YYYY-MM-DD (Standard ISO)</option>
              <option value="DD/MM/YYYY">DD/MM/YYYY (Day / Month / Year)</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY (Month / Day / Year)</option>
            </select>
            <span className="text-[11px] text-neutral-400 block">
              Used across transaction history and attendance.
            </span>
          </div>

          {/* Week Start Day */}
          <div className="space-y-1.5 text-left">
            <label htmlFor="week-start-select" className="block text-xs font-semibold text-neutral-700">
              Week Starts On
            </label>
            <select
              id="week-start-select"
              value={weekStartDay}
              onChange={(e) => setWeekStartDay(e.target.value as WeekStartDay)}
              className="w-full px-3 py-2 text-xs sm:text-sm border border-neutral-300 rounded-xl bg-white font-medium text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB] cursor-pointer"
            >
              <option value="Monday">Monday</option>
              <option value="Sunday">Sunday</option>
            </select>
            <span className="text-[11px] text-neutral-400 block">
              Aligns the work attendance calendar grid.
            </span>
          </div>
        </div>

        {/* Profile Details (Editable Display Name, Occupation, Tagline) */}
        <div className="pt-3 border-t border-neutral-100 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1 text-left">
            <label htmlFor="profile-name" className="block text-xs font-semibold text-neutral-700">
              Profile Name
            </label>
            <input
              id="profile-name"
              type="text"
              placeholder="e.g. Rahul Sharma"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              className="w-full px-3 py-2 text-xs sm:text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
            />
          </div>

          <div className="space-y-1 text-left">
            <label htmlFor="profile-occupation" className="block text-xs font-semibold text-neutral-700">
              Occupation / Role
            </label>
            <input
              id="profile-occupation"
              type="text"
              placeholder="e.g. Software Engineer"
              value={profileOccupation}
              onChange={(e) => setProfileOccupation(e.target.value)}
              className="w-full px-3 py-2 text-xs sm:text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
            />
          </div>

          <div className="space-y-1 text-left">
            <label htmlFor="profile-tagline" className="block text-xs font-semibold text-neutral-700">
              Personal Headline
            </label>
            <input
              id="profile-tagline"
              type="text"
              placeholder="e.g. Master time & financial clarity"
              value={profileTagline}
              onChange={(e) => setProfileTagline(e.target.value)}
              className="w-full px-3 py-2 text-xs sm:text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
            />
          </div>
        </div>
      </div>

      {/* 4. SECTION C: Salary Settings */}
      <div className="p-5 rounded-2xl bg-white border border-black/[0.08] space-y-4 shadow-xs">
        <div className="flex items-center justify-between border-b border-black/[0.06] pb-3">
          <div className="flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-[#87CEEB]" />
            <h3 className="font-bold text-sm text-[#111111]">Salary Configuration</h3>
          </div>
          <span className="text-xs text-neutral-500 font-medium">
            Contract: <span className="font-semibold text-neutral-800 capitalize">{(salaryConfig.salaryType || 'daily_wage').replace('_', ' ')}</span>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Daily Base Salary */}
          <div className="space-y-1.5 text-left">
            <label htmlFor="daily-base-salary" className="block text-xs font-semibold text-neutral-700">
              Daily Base Salary ({CURRENCIES[currency]?.symbol || '₹'})
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-400">
                {CURRENCIES[currency]?.symbol || '₹'}
              </span>
              <input
                id="daily-base-salary"
                type="number"
                min="0"
                step="any"
                value={salaryConfig.dailyBaseSalary ?? 500}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setSalaryConfig(prev => ({ ...prev, dailyBaseSalary: isNaN(val) ? 0 : val }));
                }}
                className="w-full pl-8 pr-3 py-2 text-xs sm:text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
              />
            </div>
            <span className="text-[11px] text-neutral-400 block">
              Earned for standard working day check-in.
            </span>
          </div>

          {/* Standard Working Hours */}
          <div className="space-y-1.5 text-left">
            <label htmlFor="standard-hours" className="block text-xs font-semibold text-neutral-700">
              Standard Working Hours (Hours/Day)
            </label>
            <input
              id="standard-hours"
              type="number"
              min="1"
              max="24"
              step="0.5"
              value={salaryConfig.standardWorkingHours ?? 8}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setSalaryConfig(prev => ({ ...prev, standardWorkingHours: isNaN(val) ? 8 : val }));
              }}
              className="w-full px-3 py-2 text-xs sm:text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
            />
            <span className="text-[11px] text-neutral-400 block">
              Hours required before overtime begins.
            </span>
          </div>

          {/* Extra Hour Rate */}
          <div className="space-y-1.5 text-left">
            <label htmlFor="extra-hour-rate" className="block text-xs font-semibold text-neutral-700">
              Extra Hour Rate ({CURRENCIES[currency]?.symbol || '₹'}/hr)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-400">
                {CURRENCIES[currency]?.symbol || '₹'}
              </span>
              <input
                id="extra-hour-rate"
                type="number"
                min="0"
                step="any"
                value={salaryConfig.extraHourRate ?? 100}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setSalaryConfig(prev => ({ ...prev, extraHourRate: isNaN(val) ? 0 : val }));
                }}
                className="w-full pl-8 pr-3 py-2 text-xs sm:text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
              />
            </div>
            <span className="text-[11px] text-neutral-400 block">
              Additional earnings per hour beyond standard.
            </span>
          </div>
        </div>
      </div>

      {/* 5. SECTION D: Categories Management */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        {/* Expense Categories */}
        <div className="p-5 rounded-2xl bg-white border border-black/[0.08] space-y-3.5 shadow-xs">
          <div className="flex items-center justify-between border-b border-black/[0.06] pb-2.5">
            <div className="flex items-center gap-2">
              <Tags className="w-4 h-4 text-[#87CEEB]" />
              <h3 className="font-bold text-sm text-[#111111]">Expense Categories</h3>
            </div>
            <span className="text-xs text-neutral-500 font-medium">
              {expenseCategories.length} active
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-1">
            {expenseCategories.map((cat) => (
              <div 
                key={cat} 
                className="flex items-center gap-1.5 px-2.5 py-1 bg-neutral-100 text-neutral-800 text-xs font-medium rounded-lg"
              >
                <span>{cat}</span>
                <button 
                  type="button" 
                  onClick={() => handleRemoveCategory(cat)} 
                  disabled={expenseCategories.length <= 1}
                  className="text-neutral-400 hover:text-rose-600 disabled:opacity-30 cursor-pointer"
                  aria-label={`Remove category ${cat}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-2 pt-2 border-t border-neutral-100">
            <input
              type="text"
              placeholder="Add expense category..."
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddCategory();
                }
              }}
              className="flex-1 px-3 py-1.5 text-xs border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
            />
            <button
              type="button"
              onClick={handleAddCategory}
              className="px-3.5 py-1.5 bg-[#111111] text-white text-xs font-semibold rounded-xl hover:bg-black transition-colors cursor-pointer"
            >
              Add
            </button>
          </div>
        </div>

        {/* Income Sources */}
        <div className="p-5 rounded-2xl bg-white border border-black/[0.08] space-y-3.5 shadow-xs">
          <div className="flex items-center justify-between border-b border-black/[0.06] pb-2.5">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-600" />
              <h3 className="font-bold text-sm text-[#111111]">Income Sources</h3>
            </div>
            <span className="text-xs text-neutral-500 font-medium">
              {incomeSources.length} active
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-1">
            {incomeSources.map((src) => (
              <div 
                key={src} 
                className="flex items-center gap-1.5 px-2.5 py-1 bg-neutral-100 text-neutral-800 text-xs font-medium rounded-lg"
              >
                <span>{src}</span>
                <button 
                  type="button" 
                  onClick={() => handleRemoveIncomeSource(src)} 
                  disabled={incomeSources.length <= 1}
                  className="text-neutral-400 hover:text-rose-600 disabled:opacity-30 cursor-pointer"
                  aria-label={`Remove income source ${src}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-2 pt-2 border-t border-neutral-100">
            <input
              type="text"
              placeholder="Add income source..."
              value={newIncName}
              onChange={(e) => setNewIncName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddIncomeSource();
                }
              }}
              className="flex-1 px-3 py-1.5 text-xs border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
            />
            <button
              type="button"
              onClick={handleAddIncomeSource}
              className="px-3.5 py-1.5 bg-[#111111] text-white text-xs font-semibold rounded-xl hover:bg-black transition-colors cursor-pointer"
            >
              Add
            </button>
          </div>
        </div>
      </div>

      {/* 6. SECTION E: Data & Workspace Management (PDF Export & Local Reset) */}
      <div className="p-5 sm:p-6 rounded-2xl bg-white border border-black/[0.08] space-y-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 border-b border-black/[0.06] pb-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#87CEEB]" />
            <h3 className="font-bold text-sm text-[#111111]">Data Export & Workspace Controls</h3>
          </div>
          <span className="text-xs text-neutral-500 font-medium">
            Export real audit reports or clear local temporary state
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Export PDF Report */}
          <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-200/80 space-y-2 flex flex-col justify-between">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-[#111111] block">Export PDF Report</span>
                <span className="text-[9px] font-mono uppercase bg-[#87CEEB]/20 text-[#111111] px-1.5 py-0.5 rounded font-bold">
                  PDF Engine
                </span>
              </div>
              <p className="text-[11px] text-neutral-500 leading-relaxed font-normal">
                Generate a verified, multi-page financial statement and attendance audit directly from your active records.
              </p>
            </div>
            <button
              onClick={() => setIsPDFModalOpen(true)}
              type="button"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-[#111111] hover:bg-black text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer self-start"
            >
              <FileText className="w-3.5 h-3.5 text-[#87CEEB]" />
              <span>Configure & Export PDF</span>
            </button>
          </div>

          {/* Reset Local Workspace */}
          <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-200/80 space-y-2 flex flex-col justify-between">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-rose-700 block">Reset Local Session</span>
                <span className="text-[9px] font-mono uppercase bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded font-bold border border-rose-200">
                  Local View
                </span>
              </div>
              <p className="text-[11px] text-neutral-500 leading-relaxed font-normal">
                Clears active local view state and unsaved changes. (Note: Cloud records in Supabase are safely protected and will not be deleted).
              </p>
            </div>
            <button
              onClick={() => setIsResetModalOpen(true)}
              type="button"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 hover:border-rose-300 text-xs font-semibold rounded-xl transition-colors cursor-pointer self-start"
            >
              <RefreshCw className="w-3.5 h-3.5 text-rose-600" />
              <span>Reset Local Workspace</span>
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog for Reset Local Workspace */}
      <ConfirmDialog
        isOpen={isResetModalOpen}
        title="Reset Local Workspace View?"
        message="This will clear your local view state and unsaved scratchpad data. Your persistent Supabase cloud database records are securely protected and will NOT be deleted."
        confirmLabel="Reset Local View"
        isDestructive={true}
        onConfirm={() => {
          executeResetWorkspace();
          setIsResetModalOpen(false);
        }}
        onCancel={() => setIsResetModalOpen(false)}
      />

      {/* Confirmation Dialog for Sign Out */}
      <ConfirmDialog
        isOpen={isSignOutModalOpen}
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
          setIsSignOutModalOpen(false);
        }}
        onCancel={() => setIsSignOutModalOpen(false)}
      />

      {/* PDF Export Modal */}
      <PDFExportModal
        isOpen={isPDFModalOpen}
        onClose={() => setIsPDFModalOpen(false)}
        defaultPreset="all"
      />
    </div>
  );
};
