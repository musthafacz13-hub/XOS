import React, { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import {
  Check,
  AlertCircle,
  Loader2,
  ChevronDown,
  X,
  RotateCcw,
  ShieldCheck
} from 'lucide-react';
import { useXOSData } from '../../hooks/useXOSData';
import { CURRENCIES, formatCurrency } from '../../utils/formatters';
import { CurrencyCode, DateFormat, WeekStartDay, SalaryConfig } from '../../types';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { PWAInstallButton } from '../common/PWAInstallButton';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { useAuth } from '../../context/AuthContext';
import { SettingsBundleSaveError, SettingsBundleSection } from '../../services/repository';

const PDFExportModal = lazy(() =>
  import('../modals/PDFExportModal').then(m => ({ default: m.PDFExportModal }))
);

const INPUT_CLASS =
  'w-full h-10 px-3 text-sm text-[#111111] bg-white border border-neutral-200 rounded-lg transition-colors placeholder:text-neutral-400 hover:border-neutral-300 focus-visible:outline-none focus-visible:border-[#111111] focus-visible:ring-2 focus-visible:ring-[#111111]/10';

const SELECT_CLASS =
  'w-full h-10 pl-3 pr-9 text-sm text-[#111111] bg-white border border-neutral-200 rounded-lg appearance-none cursor-pointer transition-colors hover:border-neutral-300 focus-visible:outline-none focus-visible:border-[#111111] focus-visible:ring-2 focus-visible:ring-[#111111]/10';

export const SettingsView: React.FC = () => {
  const data = useXOSData();
  const { user, isDemoUser, signOut, exitDemoMode } = useAuth();

  const resolvedProfileName = data.settings.profile.name || user?.user_metadata?.full_name || '';
  const resolvedCurrency = (data.settings.currency || 'INR') as CurrencyCode;
  const resolvedDateFormat = (data.settings.dateFormat || 'YYYY-MM-DD') as DateFormat;
  const resolvedWeekStartDay = (data.settings.weekStartDay || 'Monday') as WeekStartDay;
  const resolvedExpenseCategories = data.settings.customExpenseCategories || [];
  const resolvedIncomeSources = data.settings.customIncomeSources || [];
  const resolvedSalaryConfig = data.settings.salaryConfig;

  // Stable snapshot key so re-renders from local typing never overwrite unsaved user edits
  const settingsSnapshotKey = useMemo(
    () =>
      JSON.stringify({
        name: resolvedProfileName,
        currency: resolvedCurrency,
        dateFormat: resolvedDateFormat,
        weekStartDay: resolvedWeekStartDay,
        customExpenseCategories: resolvedExpenseCategories,
        customIncomeSources: resolvedIncomeSources,
        dailyBaseSalary: resolvedSalaryConfig.dailyBaseSalary,
        addonSalary: resolvedSalaryConfig.addonSalary,
        addonEnabled: resolvedSalaryConfig.addonEnabled,
        standardWorkingHours: resolvedSalaryConfig.standardWorkingHours,
        extraHourRate: resolvedSalaryConfig.extraHourRate,
        overtimeEnabled: resolvedSalaryConfig.overtimeEnabled,
        salaryCurrency: resolvedSalaryConfig.currency
      }),
    [
      resolvedProfileName,
      resolvedCurrency,
      resolvedDateFormat,
      resolvedWeekStartDay,
      resolvedExpenseCategories,
      resolvedIncomeSources,
      resolvedSalaryConfig.dailyBaseSalary,
      resolvedSalaryConfig.addonSalary,
      resolvedSalaryConfig.addonEnabled,
      resolvedSalaryConfig.standardWorkingHours,
      resolvedSalaryConfig.extraHourRate,
      resolvedSalaryConfig.overtimeEnabled,
      resolvedSalaryConfig.currency
    ]
  );

  // Form state
  const [profileName, setProfileName] = useState<string>(resolvedProfileName);
  const [currency, setCurrency] = useState<CurrencyCode>(resolvedCurrency);
  const [dateFormat, setDateFormat] = useState<DateFormat>(resolvedDateFormat);
  const [weekStartDay, setWeekStartDay] = useState<WeekStartDay>(resolvedWeekStartDay);

  // String numeric inputs prevent mid-typing snap-back when clearing or editing numbers
  const [dailyBaseSalaryInput, setDailyBaseSalaryInput] = useState<string>(
    String(resolvedSalaryConfig.dailyBaseSalary ?? 500)
  );
  const [addonSalaryInput, setAddonSalaryInput] = useState<string>(
    String(resolvedSalaryConfig.addonSalary ?? 0)
  );
  const [addonEnabled, setAddonEnabled] = useState<boolean>(
    Boolean(resolvedSalaryConfig.addonEnabled)
  );
  const [standardHoursInput, setStandardHoursInput] = useState<string>(
    String(resolvedSalaryConfig.standardWorkingHours ?? 8)
  );
  const [extraHourRateInput, setExtraHourRateInput] = useState<string>(
    String(resolvedSalaryConfig.extraHourRate ?? 100)
  );
  const [overtimeEnabled, setOvertimeEnabled] = useState<boolean>(
    resolvedSalaryConfig.overtimeEnabled !== undefined
      ? Boolean(resolvedSalaryConfig.overtimeEnabled)
      : true
  );

  const [expenseCategories, setExpenseCategories] = useState<string[]>(resolvedExpenseCategories);
  const [newCatName, setNewCatName] = useState<string>('');
  const [catFeedback, setCatFeedback] = useState<string | null>(null);

  const [incomeSources, setIncomeSources] = useState<string[]>(resolvedIncomeSources);
  const [newIncName, setNewIncName] = useState<string>('');
  const [incFeedback, setIncFeedback] = useState<string | null>(null);

  // Save & section failure tracking
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const failedSectionsRef = useRef<Set<SettingsBundleSection>>(new Set());
  const lastSyncedKeyRef = useRef<string>(settingsSnapshotKey);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Modals & reset state
  const [isSignOutModalOpen, setIsSignOutModalOpen] = useState<boolean>(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState<boolean>(false);
  const [isResetting, setIsResetting] = useState<boolean>(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const isResettingRef = useRef<boolean>(false);
  const [isSalaryResetModalOpen, setIsSalaryResetModalOpen] = useState<boolean>(false);
  const [isResettingSalary, setIsResettingSalary] = useState<boolean>(false);
  const [salaryResetError, setSalaryResetError] = useState<string | null>(null);
  const [isPDFModalOpen, setIsPDFModalOpen] = useState<boolean>(false);
  const [hasOpenedPDFModal, setHasOpenedPDFModal] = useState<boolean>(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const { isInstallable, isInstalled, isIOS } = usePWAInstall();

  // Clear timers on unmount
  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    };
  }, []);

  // Sync local form state ONLY when underlying repository values actually change
  useEffect(() => {
    if (isSaving) return;
    if (settingsSnapshotKey === lastSyncedKeyRef.current) return;
    lastSyncedKeyRef.current = settingsSnapshotKey;

    if (!failedSectionsRef.current.has('profiles')) {
      setProfileName(resolvedProfileName);
    }
    if (!failedSectionsRef.current.has('user_settings')) {
      setCurrency(resolvedCurrency);
      setDateFormat(resolvedDateFormat);
      setWeekStartDay(resolvedWeekStartDay);
      setExpenseCategories(resolvedExpenseCategories);
      setIncomeSources(resolvedIncomeSources);
    }
    if (!failedSectionsRef.current.has('salary_configs')) {
      setDailyBaseSalaryInput(String(resolvedSalaryConfig.dailyBaseSalary ?? 500));
      setAddonSalaryInput(String(resolvedSalaryConfig.addonSalary ?? 0));
      setAddonEnabled(Boolean(resolvedSalaryConfig.addonEnabled));
      setStandardHoursInput(String(resolvedSalaryConfig.standardWorkingHours ?? 8));
      setExtraHourRateInput(String(resolvedSalaryConfig.extraHourRate ?? 100));
      setOvertimeEnabled(
        resolvedSalaryConfig.overtimeEnabled !== undefined
          ? Boolean(resolvedSalaryConfig.overtimeEnabled)
          : true
      );
    }
  }, [
    isSaving,
    settingsSnapshotKey,
    resolvedProfileName,
    resolvedCurrency,
    resolvedDateFormat,
    resolvedWeekStartDay,
    resolvedExpenseCategories,
    resolvedIncomeSources,
    resolvedSalaryConfig.dailyBaseSalary,
    resolvedSalaryConfig.addonSalary,
    resolvedSalaryConfig.addonEnabled,
    resolvedSalaryConfig.standardWorkingHours,
    resolvedSalaryConfig.extraHourRate,
    resolvedSalaryConfig.overtimeEnabled
  ]);

  const parsedDailyBase = Number(dailyBaseSalaryInput.trim());
  const parsedAddonSalary =
    addonSalaryInput.trim() === ''
      ? (resolvedSalaryConfig.addonSalary ?? 0)
      : Number(addonSalaryInput.trim());
  const parsedStandardHours = Number(standardHoursInput.trim());
  const parsedExtraHourRate =
    extraHourRateInput.trim() === ''
      ? (resolvedSalaryConfig.extraHourRate ?? 100)
      : Number(extraHourRateInput.trim());

  const hasUnsavedChanges = useMemo(() => {
    return (
      profileName.trim() !== resolvedProfileName.trim() ||
      currency !== resolvedCurrency ||
      dateFormat !== resolvedDateFormat ||
      weekStartDay !== resolvedWeekStartDay ||
      dailyBaseSalaryInput.trim() === '' ||
      (addonEnabled && addonSalaryInput.trim() === '') ||
      standardHoursInput.trim() === '' ||
      (overtimeEnabled && extraHourRateInput.trim() === '') ||
      parsedDailyBase !== resolvedSalaryConfig.dailyBaseSalary ||
      parsedAddonSalary !== (resolvedSalaryConfig.addonSalary ?? 0) ||
      addonEnabled !== Boolean(resolvedSalaryConfig.addonEnabled) ||
      parsedStandardHours !== resolvedSalaryConfig.standardWorkingHours ||
      parsedExtraHourRate !== resolvedSalaryConfig.extraHourRate ||
      overtimeEnabled !==
        (resolvedSalaryConfig.overtimeEnabled !== undefined
          ? Boolean(resolvedSalaryConfig.overtimeEnabled)
          : true) ||
      JSON.stringify(expenseCategories) !== JSON.stringify(resolvedExpenseCategories) ||
      JSON.stringify(incomeSources) !== JSON.stringify(resolvedIncomeSources)
    );
  }, [
    profileName,
    resolvedProfileName,
    currency,
    resolvedCurrency,
    dateFormat,
    resolvedDateFormat,
    weekStartDay,
    resolvedWeekStartDay,
    dailyBaseSalaryInput,
    addonSalaryInput,
    addonEnabled,
    standardHoursInput,
    extraHourRateInput,
    overtimeEnabled,
    parsedDailyBase,
    parsedAddonSalary,
    parsedStandardHours,
    parsedExtraHourRate,
    resolvedSalaryConfig.dailyBaseSalary,
    resolvedSalaryConfig.addonSalary,
    resolvedSalaryConfig.addonEnabled,
    resolvedSalaryConfig.standardWorkingHours,
    resolvedSalaryConfig.extraHourRate,
    resolvedSalaryConfig.overtimeEnabled,
    expenseCategories,
    resolvedExpenseCategories,
    incomeSources,
    resolvedIncomeSources
  ]);

  const settingsFetchErrors = data.fetchErrors.filter(
    e => e.table === 'user_settings' || e.table === 'profiles' || e.table === 'salary_configs'
  );
  const connectionError =
    settingsFetchErrors.length > 0
      ? settingsFetchErrors.map(e => `${e.table}: ${e.message}`).join(' · ')
      : null;

  const currencySymbol = CURRENCIES[currency]?.symbol || '₹';

  const handleDiscardChanges = () => {
    failedSectionsRef.current.clear();
    setSaveErrorMessage(null);
    setSaveSuccessMessage(null);
    setCatFeedback(null);
    setIncFeedback(null);
    setProfileName(resolvedProfileName);
    setCurrency(resolvedCurrency);
    setDateFormat(resolvedDateFormat);
    setWeekStartDay(resolvedWeekStartDay);
    setDailyBaseSalaryInput(String(resolvedSalaryConfig.dailyBaseSalary ?? 500));
    setAddonSalaryInput(String(resolvedSalaryConfig.addonSalary ?? 0));
    setAddonEnabled(Boolean(resolvedSalaryConfig.addonEnabled));
    setStandardHoursInput(String(resolvedSalaryConfig.standardWorkingHours ?? 8));
    setExtraHourRateInput(String(resolvedSalaryConfig.extraHourRate ?? 100));
    setOvertimeEnabled(
      resolvedSalaryConfig.overtimeEnabled !== undefined
        ? Boolean(resolvedSalaryConfig.overtimeEnabled)
        : true
    );
    setExpenseCategories(resolvedExpenseCategories);
    setIncomeSources(resolvedIncomeSources);
    setNewCatName('');
    setNewIncName('');
  };

  const executeResetSalaryDefaults = async () => {
    if (isResettingSalary || isSaving) return;
    setSalaryResetError(null);
    setIsResettingSalary(true);
    try {
      const defaultSalaryConfig: SalaryConfig = {
        dailyBaseSalary: 500,
        addonSalary: 0,
        addonEnabled: false,
        standardWorkingHours: 8,
        extraHourRate: 100,
        overtimeEnabled: true,
        currency
      };
      await data.persistSalaryConfig(defaultSalaryConfig);
      setDailyBaseSalaryInput('500');
      setAddonSalaryInput('0');
      setAddonEnabled(false);
      setStandardHoursInput('8');
      setExtraHourRateInput('100');
      setOvertimeEnabled(true);
      setIsSalaryResetModalOpen(false);
      setBannerMessage('Salary defaults restored (₹500 base / ₹0 add-on / 8h / ₹100 overtime). Past attendance records were not altered.');
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = setTimeout(() => setBannerMessage(null), 5000);
    } catch (err) {
      setSalaryResetError(err instanceof Error ? err.message : 'Could not reset salary defaults.');
    } finally {
      setIsResettingSalary(false);
    }
  };

  // Persist to user_settings, salary_configs, and profiles via repository
  const handleSaveSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSaving || isResetting) return;

    setSaveSuccessMessage(null);
    setSaveErrorMessage(null);

    if (
      dailyBaseSalaryInput.trim() === '' ||
      !Number.isFinite(parsedDailyBase) ||
      parsedDailyBase < 0
    ) {
      setSaveErrorMessage('Daily base salary must be zero or a positive number.');
      return;
    }

    if (
      (addonEnabled && addonSalaryInput.trim() === '') ||
      !Number.isFinite(parsedAddonSalary) ||
      parsedAddonSalary < 0
    ) {
      setSaveErrorMessage('Add-on salary must be zero or a positive number.');
      return;
    }

    if (
      standardHoursInput.trim() === '' ||
      !Number.isFinite(parsedStandardHours) ||
      parsedStandardHours <= 0 ||
      parsedStandardHours > 24
    ) {
      setSaveErrorMessage('Standard working hours must be between 0.5 and 24 hours.');
      return;
    }

    if (
      (overtimeEnabled && extraHourRateInput.trim() === '') ||
      !Number.isFinite(parsedExtraHourRate) ||
      parsedExtraHourRate < 0
    ) {
      setSaveErrorMessage('Extra hour rate must be zero or a positive number.');
      return;
    }

    if (expenseCategories.length === 0) {
      setSaveErrorMessage('Keep at least one expense category.');
      return;
    }

    if (incomeSources.length === 0) {
      setSaveErrorMessage('Keep at least one income source.');
      return;
    }

    failedSectionsRef.current.clear();
    setIsSaving(true);

    try {
      const nextSalaryConfig: SalaryConfig = {
        dailyBaseSalary: parsedDailyBase,
        addonSalary: parsedAddonSalary,
        addonEnabled,
        standardWorkingHours: parsedStandardHours,
        extraHourRate: parsedExtraHourRate,
        overtimeEnabled,
        currency
      };

      await data.persistSettingsBundle({
        displayName: profileName.trim(),
        currency,
        dateFormat,
        weekStartDay,
        customExpenseCategories: expenseCategories,
        customIncomeSources: incomeSources,
        widgets: data.settings.widgets,
        salaryConfig: nextSalaryConfig
      });

      failedSectionsRef.current.clear();
      setDailyBaseSalaryInput(String(nextSalaryConfig.dailyBaseSalary));
      setAddonSalaryInput(String(nextSalaryConfig.addonSalary));
      setAddonEnabled(nextSalaryConfig.addonEnabled);
      setStandardHoursInput(String(nextSalaryConfig.standardWorkingHours));
      setExtraHourRateInput(String(nextSalaryConfig.extraHourRate));
      setOvertimeEnabled(nextSalaryConfig.overtimeEnabled);
      setSaveSuccessMessage('Settings saved');

      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => setSaveSuccessMessage(null), 3500);
    } catch (err) {
      console.error('Failed to save settings:', err);
      if (err instanceof SettingsBundleSaveError) {
        failedSectionsRef.current = new Set(err.failedSections.map(f => f.section));
        setSaveErrorMessage(err.message);
      } else {
        failedSectionsRef.current = new Set(['user_settings', 'salary_configs', 'profiles']);
        const msg = err instanceof Error ? err.message : 'Unable to save settings. Please try again.';
        setSaveErrorMessage(msg);
      }
    } finally {
      setIsSaving(false);
    }
  };

  // Category helpers
  const handleAddCategory = () => {
    const trimmed = newCatName.trim();
    if (!trimmed) return;
    if (expenseCategories.some(c => c.toLowerCase() === trimmed.toLowerCase())) {
      setCatFeedback(`"${trimmed}" already exists.`);
      return;
    }
    setCatFeedback(null);
    setExpenseCategories(prev => [...prev, trimmed]);
    setNewCatName('');
  };

  const handleRemoveCategory = (cat: string) => {
    if (expenseCategories.length <= 1) {
      setCatFeedback('At least one expense category is required.');
      return;
    }
    setCatFeedback(null);
    setExpenseCategories(prev => prev.filter(c => c !== cat));
  };

  const handleAddIncomeSource = () => {
    const trimmed = newIncName.trim();
    if (!trimmed) return;
    if (incomeSources.some(s => s.toLowerCase() === trimmed.toLowerCase())) {
      setIncFeedback(`"${trimmed}" already exists.`);
      return;
    }
    setIncFeedback(null);
    setIncomeSources(prev => [...prev, trimmed]);
    setNewIncName('');
  };

  const handleRemoveIncomeSource = (src: string) => {
    if (incomeSources.length <= 1) {
      setIncFeedback('At least one income source is required.');
      return;
    }
    setIncFeedback(null);
    setIncomeSources(prev => prev.filter(s => s !== src));
  };

  // Reset all app data via Supabase xos_reset_user_data() RPC (or local demo clear in demo mode)
  const executeResetAccountData = async () => {
    if (isResettingRef.current || isResetting) return;

    isResettingRef.current = true;
    setIsResetting(true);
    setResetError(null);

    try {
      await data.resetUserData();
      failedSectionsRef.current.clear();
      lastSyncedKeyRef.current = '';
      setSaveErrorMessage(null);
      setSaveSuccessMessage(null);
      setCatFeedback(null);
      setIncFeedback(null);
      setNewCatName('');
      setNewIncName('');
      setIsResetModalOpen(false);
      setBannerMessage(
        isDemoUser
          ? 'Demo data has been cleared and default settings restored.'
          : 'All app data has been permanently reset and default settings restored.'
      );
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = setTimeout(() => setBannerMessage(null), 6000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to reset app data. Please try again.';
      setResetError(msg);
    } finally {
      isResettingRef.current = false;
      setIsResetting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto bg-white text-[#111111]">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6">
        <div className="min-w-0">
          <h2 className="text-xl sm:text-2xl font-semibold text-[#111111] tracking-tight">
            Settings
          </h2>
          <p className="text-sm text-neutral-500 mt-1">
            Manage your account, preferences, salary rates, categories, and data.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {saveSuccessMessage && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span>{saveSuccessMessage}</span>
            </span>
          )}
          {!saveSuccessMessage && hasUnsavedChanges && !saveErrorMessage && (
            <span className="text-xs text-neutral-500">Unsaved changes</span>
          )}

          <button
            type="button"
            onClick={() => handleSaveSettings()}
            disabled={isSaving || isResetting}
            className="inline-flex items-center justify-center gap-2 h-10 px-4 bg-[#111111] hover:bg-black text-white text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <span>Save Settings</span>
            )}
          </button>
        </div>
      </div>

      {/* Inline Feedback Banners */}
      {saveErrorMessage && (
        <div
          role="alert"
          className="mb-6 p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs sm:text-sm flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
            <span>{saveErrorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveErrorMessage(null)}
            className="text-rose-700 hover:text-rose-900 p-0.5 cursor-pointer shrink-0"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {bannerMessage && (
        <div
          role="status"
          className="mb-6 p-3.5 rounded-lg bg-neutral-50 border border-neutral-200 text-neutral-800 text-xs sm:text-sm flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2.5">
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{bannerMessage}</span>
          </div>
          <button
            onClick={() => setBannerMessage(null)}
            type="button"
            className="text-neutral-500 hover:text-[#111111] text-xs font-medium cursor-pointer shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {connectionError && (
        <div
          role="alert"
          className="mb-6 p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs sm:text-sm flex items-start gap-2.5"
        >
          <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <span>Some settings could not load from the server: {connectionError}</span>
        </div>
      )}

      <form onSubmit={handleSaveSettings} noValidate>
        {/* A. Account */}
        <section aria-labelledby="settings-account-heading" className="grid grid-cols-1 md:grid-cols-12 gap-5 md:gap-10 py-7 border-t border-neutral-200/80">
          <div className="md:col-span-4 space-y-1">
            <h3 id="settings-account-heading" className="text-[15px] font-semibold text-[#111111]">
              Account
            </h3>
            <p className="text-xs text-neutral-500 leading-relaxed">
              Your sign-in email, display name, and session controls.
            </p>
          </div>

          <div className="md:col-span-8 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Account Email */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-neutral-700">
                  Account Email
                </label>
                <div className="h-10 px-3 flex items-center rounded-lg bg-neutral-50 border border-neutral-200/80 text-sm text-neutral-700 truncate">
                  {user?.email || (isDemoUser ? 'Guest demo session' : 'Not signed in')}
                </div>
                <p className="text-xs text-neutral-500">
                  {isDemoUser ? 'Changes in demo mode are temporary.' : 'Managed by your sign-in account.'}
                </p>
              </div>

              {/* Display Name */}
              <div className="space-y-1.5">
                <label htmlFor="profile-name" className="block text-xs font-medium text-neutral-700">
                  Display Name
                </label>
                <input
                  id="profile-name"
                  type="text"
                  placeholder="Enter your name"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  className={INPUT_CLASS}
                />
                <p className="text-xs text-neutral-500">
                  Shown on your dashboard and PDF reports.
                </p>
              </div>
            </div>

            {/* Sign Out Row */}
            <div className="pt-4 border-t border-neutral-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-[#111111]">
                  {isDemoUser ? 'Demo session' : 'Sign out'}
                </p>
                <p className="text-xs text-neutral-500">
                  {isDemoUser
                    ? 'Return to the welcome screen and end this guest preview.'
                    : 'End your current session on this device.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSignOutModalOpen(true)}
                className="inline-flex items-center justify-center h-9 px-3.5 text-xs font-medium text-neutral-700 hover:text-[#111111] bg-white hover:bg-neutral-50 border border-neutral-200 hover:border-neutral-300 rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]/15"
              >
                {isDemoUser ? 'Exit Demo' : 'Sign Out'}
              </button>
            </div>
          </div>
        </section>

        {/* B. Preferences */}
        <section aria-labelledby="settings-preferences-heading" className="grid grid-cols-1 md:grid-cols-12 gap-5 md:gap-10 py-7 border-t border-neutral-200/80">
          <div className="md:col-span-4 space-y-1">
            <h3 id="settings-preferences-heading" className="text-[15px] font-semibold text-[#111111]">
              Preferences
            </h3>
            <p className="text-xs text-neutral-500 leading-relaxed">
              Regional formatting for currency, dates, and weekly calendars.
            </p>
          </div>

          <div className="md:col-span-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Primary Currency */}
            <div className="space-y-1.5">
              <label htmlFor="currency-select" className="block text-xs font-medium text-neutral-700">
                Primary Currency
              </label>
              <div className="relative">
                <select
                  id="currency-select"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                  className={SELECT_CLASS}
                >
                  {Object.entries(CURRENCIES).map(([code, info]) => (
                    <option key={code} value={code}>
                      {info.name} ({info.symbol})
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-neutral-400 pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
              </div>
              <p className="text-xs text-neutral-500">
                Defaults to INR (₹).
              </p>
            </div>

            {/* Date Format */}
            <div className="space-y-1.5">
              <label htmlFor="date-format-select" className="block text-xs font-medium text-neutral-700">
                Date Format
              </label>
              <div className="relative">
                <select
                  id="date-format-select"
                  value={dateFormat}
                  onChange={(e) => setDateFormat(e.target.value as DateFormat)}
                  className={SELECT_CLASS}
                >
                  <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                  <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                  <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                </select>
                <ChevronDown className="w-4 h-4 text-neutral-400 pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
              </div>
              <p className="text-xs text-neutral-500">
                Used across logs and reports.
              </p>
            </div>

            {/* Week Starts On */}
            <div className="space-y-1.5">
              <label htmlFor="week-start-select" className="block text-xs font-medium text-neutral-700">
                Week Starts On
              </label>
              <div className="relative">
                <select
                  id="week-start-select"
                  value={weekStartDay}
                  onChange={(e) => setWeekStartDay(e.target.value as WeekStartDay)}
                  className={SELECT_CLASS}
                >
                  <option value="Monday">Monday</option>
                  <option value="Sunday">Sunday</option>
                </select>
                <ChevronDown className="w-4 h-4 text-neutral-400 pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
              </div>
              <p className="text-xs text-neutral-500">
                Aligns the attendance calendar.
              </p>
            </div>
          </div>
        </section>

        {/* C. Salary Configuration */}
        <section aria-labelledby="settings-salary-heading" className="grid grid-cols-1 md:grid-cols-12 gap-5 md:gap-10 py-7 border-t border-neutral-200/80">
          <div className="md:col-span-4 space-y-2">
            <h3 id="settings-salary-heading" className="text-[15px] font-semibold text-[#111111]">
              Salary Configuration
            </h3>
            <p className="text-xs text-neutral-500 leading-relaxed">
              Default daily salary rates and overtime rules applied to new attendance entries.
            </p>
            <button
              type="button"
              onClick={() => {
                setSalaryResetError(null);
                setIsSalaryResetModalOpen(true);
              }}
              disabled={isSaving || isResetting || isResettingSalary}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 text-xs font-medium text-neutral-600 hover:text-[#111111] bg-neutral-50 hover:bg-neutral-100 border border-neutral-200 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Defaults</span>
            </button>
          </div>

          <div className="md:col-span-8 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Daily Base Salary */}
              <div className="space-y-1.5">
                <label htmlFor="daily-base-salary" className="block text-xs font-medium text-neutral-700">
                  Daily Base Salary
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-neutral-400 pointer-events-none">
                    {currencySymbol}
                  </span>
                  <input
                    id="daily-base-salary"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={dailyBaseSalaryInput}
                    onChange={(e) => setDailyBaseSalaryInput(e.target.value)}
                    className={`${INPUT_CLASS} pl-8 font-mono tabular-nums`}
                  />
                </div>
                <p className="text-xs text-neutral-500">
                  Base pay earned for a standard workday.
                </p>
              </div>

              {/* Daily Add-on Salary */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="addon-salary" className="block text-xs font-medium text-neutral-700">
                    Additional / Add-on Salary
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={addonEnabled}
                      onChange={(e) => setAddonEnabled(e.target.checked)}
                      className="rounded border-neutral-300 text-[#111111] focus:ring-[#111111]"
                    />
                    <span>Enable Add-on</span>
                  </label>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-neutral-400 pointer-events-none">
                    {currencySymbol}
                  </span>
                  <input
                    id="addon-salary"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    disabled={!addonEnabled}
                    value={addonSalaryInput}
                    onChange={(e) => setAddonSalaryInput(e.target.value)}
                    className={`${INPUT_CLASS} pl-8 font-mono tabular-nums disabled:bg-neutral-50 disabled:text-neutral-400`}
                  />
                </div>
                <p className="text-xs text-neutral-500">
                  {addonEnabled
                    ? 'Added daily on top of base pay for each Present workday.'
                    : 'Add-on pay is currently disabled.'}
                </p>
              </div>

              {/* Standard Duty Hours */}
              <div className="space-y-1.5">
                <label htmlFor="standard-hours" className="block text-xs font-medium text-neutral-700">
                  Standard Daily Duty Hours
                </label>
                <div className="relative">
                  <input
                    id="standard-hours"
                    type="number"
                    min="0.5"
                    max="24"
                    step="0.5"
                    inputMode="decimal"
                    value={standardHoursInput}
                    onChange={(e) => setStandardHoursInput(e.target.value)}
                    className={`${INPUT_CLASS} pr-10 font-mono tabular-nums`}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400 pointer-events-none">
                    hrs
                  </span>
                </div>
                <p className="text-xs text-neutral-500">
                  Daily shift duration before overtime applies.
                </p>
              </div>

              {/* Extra Working Hour Rate */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="extra-hour-rate" className="block text-xs font-medium text-neutral-700">
                    Extra Working Hour Rate
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={overtimeEnabled}
                      onChange={(e) => setOvertimeEnabled(e.target.checked)}
                      className="rounded border-neutral-300 text-[#111111] focus:ring-[#111111]"
                    />
                    <span>Overtime</span>
                  </label>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-neutral-400 pointer-events-none">
                    {currencySymbol}
                  </span>
                  <input
                    id="extra-hour-rate"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    disabled={!overtimeEnabled}
                    value={extraHourRateInput}
                    onChange={(e) => setExtraHourRateInput(e.target.value)}
                    className={`${INPUT_CLASS} pl-8 pr-9 font-mono tabular-nums disabled:bg-neutral-50 disabled:text-neutral-400`}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400 pointer-events-none">
                    /hr
                  </span>
                </div>
                <p className="text-xs text-neutral-500">
                  {overtimeEnabled
                    ? 'Paid per hour worked beyond standard daily hours.'
                    : 'Overtime calculation disabled for new entries.'}
                </p>
              </div>

              {/* Salary Currency (Synced with Primary Currency) */}
              <div className="space-y-1.5 sm:col-span-2">
                <label htmlFor="salary-currency-select" className="block text-xs font-medium text-neutral-700">
                  Salary Currency
                </label>
                <div className="relative">
                  <select
                    id="salary-currency-select"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                    className={SELECT_CLASS}
                  >
                    {Object.entries(CURRENCIES).map(([code, info]) => (
                      <option key={code} value={code}>
                        {code} — {info.symbol}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-neutral-400 pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
                </div>
                <p className="text-xs text-neutral-500">
                  Synced with workspace regional currency.
                </p>
              </div>
            </div>

            {/* Live Daily Pay Preview */}
            <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200/80 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#111111]">Live Daily Pay Preview</span>
                <span className="text-[11px] font-mono text-neutral-500 tabular-nums">
                  ≈ {formatCurrency(
                    Number.isFinite(parsedDailyBase) && Number.isFinite(parsedStandardHours) && parsedStandardHours > 0
                      ? parsedDailyBase / parsedStandardHours
                      : 0,
                    currency
                  )}/hr base
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div className="p-2.5 rounded-lg bg-white border border-neutral-200/70 flex items-center justify-between">
                  <span className="text-neutral-600">
                    Standard ({Number.isFinite(parsedStandardHours) && parsedStandardHours > 0 ? parsedStandardHours : 8}h)
                  </span>
                  <span className="font-mono font-semibold text-[#111111] tabular-nums">
                    {formatCurrency(
                      (Number.isFinite(parsedDailyBase) && parsedDailyBase >= 0 ? parsedDailyBase : 0) +
                        (addonEnabled && Number.isFinite(parsedAddonSalary) && parsedAddonSalary >= 0
                          ? parsedAddonSalary
                          : 0),
                      currency
                    )}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-white border border-neutral-200/70 flex items-center justify-between">
                  <span className="text-neutral-600">
                    +2h Overtime ({(Number.isFinite(parsedStandardHours) && parsedStandardHours > 0 ? parsedStandardHours : 8) + 2}h)
                  </span>
                  <span className="font-mono font-semibold text-[#111111] tabular-nums">
                    {formatCurrency(
                      (Number.isFinite(parsedDailyBase) && parsedDailyBase >= 0 ? parsedDailyBase : 0) +
                        (addonEnabled && Number.isFinite(parsedAddonSalary) && parsedAddonSalary >= 0
                          ? parsedAddonSalary
                          : 0) +
                        2 *
                          (overtimeEnabled && Number.isFinite(parsedExtraHourRate) && parsedExtraHourRate >= 0
                            ? parsedExtraHourRate
                            : 0),
                      currency
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Historical Protection */}
            <div className="p-3.5 rounded-xl bg-white border border-neutral-200/80 space-y-1.5 text-xs text-neutral-600">
              <div className="flex items-center gap-1.5 font-medium text-[#111111]">
                <ShieldCheck className="w-3.5 h-3.5 text-[#0284C7] shrink-0" />
                <span>Historical Record Protection</span>
              </div>
              <p className="leading-relaxed">
                Past attendance &amp; salary records store their own base, add-on, overtime, and manual override snapshot. Updating these defaults only applies to new entries.
              </p>
            </div>
          </div>
        </section>

        {/* D. Categories */}
        <section aria-labelledby="settings-categories-heading" className="grid grid-cols-1 md:grid-cols-12 gap-5 md:gap-10 py-7 border-t border-neutral-200/80">
          <div className="md:col-span-4 space-y-1">
            <h3 id="settings-categories-heading" className="text-[15px] font-semibold text-[#111111]">
              Categories
            </h3>
            <p className="text-xs text-neutral-500 leading-relaxed">
              Manage labels for expense tracking and income entries.
            </p>
          </div>

          <div className="md:col-span-8 space-y-6">
            {/* Expense Categories */}
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <label htmlFor="new-expense-category" className="text-xs font-medium text-neutral-700">
                  Expense Categories
                </label>
                <span className="text-xs text-neutral-400 font-mono tabular-nums">
                  {expenseCategories.length}
                </span>
              </div>

              <div className="flex gap-2">
                <input
                  id="new-expense-category"
                  type="text"
                  placeholder="New expense category..."
                  value={newCatName}
                  onChange={(e) => {
                    setNewCatName(e.target.value);
                    if (catFeedback) setCatFeedback(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCategory();
                    }
                  }}
                  className={INPUT_CLASS}
                />
                <button
                  type="button"
                  onClick={handleAddCategory}
                  disabled={!newCatName.trim()}
                  className="h-10 px-4 text-xs font-medium text-[#111111] bg-neutral-100 hover:bg-neutral-200 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]/15"
                >
                  Add
                </button>
              </div>

              {catFeedback && (
                <p className="text-xs text-rose-600">{catFeedback}</p>
              )}

              <div className="flex flex-wrap gap-1.5">
                {expenseCategories.map((cat) => (
                  <span
                    key={cat}
                    className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 bg-neutral-50 border border-neutral-200/80 text-neutral-800 text-xs rounded-md"
                  >
                    <span>{cat}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCategory(cat)}
                      disabled={expenseCategories.length <= 1}
                      className="p-0.5 rounded text-neutral-400 hover:text-[#111111] hover:bg-neutral-200/60 disabled:opacity-25 cursor-pointer disabled:cursor-not-allowed transition-colors"
                      aria-label={`Remove expense category ${cat}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Income Sources */}
            <div className="space-y-3 pt-5 border-t border-neutral-100">
              <div className="flex items-baseline justify-between">
                <label htmlFor="new-income-source" className="text-xs font-medium text-neutral-700">
                  Income Sources
                </label>
                <span className="text-xs text-neutral-400 font-mono tabular-nums">
                  {incomeSources.length}
                </span>
              </div>

              <div className="flex gap-2">
                <input
                  id="new-income-source"
                  type="text"
                  placeholder="New income source..."
                  value={newIncName}
                  onChange={(e) => {
                    setNewIncName(e.target.value);
                    if (incFeedback) setIncFeedback(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddIncomeSource();
                    }
                  }}
                  className={INPUT_CLASS}
                />
                <button
                  type="button"
                  onClick={handleAddIncomeSource}
                  disabled={!newIncName.trim()}
                  className="h-10 px-4 text-xs font-medium text-[#111111] bg-neutral-100 hover:bg-neutral-200 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]/15"
                >
                  Add
                </button>
              </div>

              {incFeedback && (
                <p className="text-xs text-rose-600">{incFeedback}</p>
              )}

              <div className="flex flex-wrap gap-1.5">
                {incomeSources.map((src) => (
                  <span
                    key={src}
                    className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 bg-neutral-50 border border-neutral-200/80 text-neutral-800 text-xs rounded-md"
                  >
                    <span>{src}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveIncomeSource(src)}
                      disabled={incomeSources.length <= 1}
                      className="p-0.5 rounded text-neutral-400 hover:text-[#111111] hover:bg-neutral-200/60 disabled:opacity-25 cursor-pointer disabled:cursor-not-allowed transition-colors"
                      aria-label={`Remove income source ${src}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Bottom Form Save Actions (helpful after scrolling on mobile/desktop) */}
            {hasUnsavedChanges && (
              <div className="pt-4 border-t border-neutral-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={handleDiscardChanges}
                  disabled={isSaving || isResetting}
                  className="h-9 px-3.5 text-xs font-medium text-neutral-600 hover:text-[#111111] bg-white hover:bg-neutral-50 border border-neutral-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  Discard
                </button>
                <button
                  type="submit"
                  disabled={isSaving || isResetting}
                  className="inline-flex items-center justify-center gap-2 h-9 px-4 bg-[#111111] hover:bg-black text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Save Settings</span>
                  )}
                </button>
              </div>
            )}
          </div>
        </section>
      </form>

      {/* E. Data & Privacy */}
      <section aria-labelledby="settings-data-heading" className="grid grid-cols-1 md:grid-cols-12 gap-5 md:gap-10 py-7 border-t border-neutral-200/80">
        <div className="md:col-span-4 space-y-1">
          <h3 id="settings-data-heading" className="text-[15px] font-semibold text-[#111111]">
            Data & Privacy
          </h3>
          <p className="text-xs text-neutral-500 leading-relaxed">
            Export your financial records or permanently reset your app data.
          </p>
        </div>

        <div className="md:col-span-8">
          <div className="border border-neutral-200/80 rounded-xl divide-y divide-neutral-200/80 bg-white">
            {/* Install App Row (shown when browser supports install or iOS Safari non-standalone) */}
            {!isInstalled && (isInstallable || isIOS) && (
              <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h4 className="text-sm font-medium text-[#111111]">
                    Install XOS on Device
                  </h4>
                  <p className="text-xs text-neutral-500 leading-relaxed max-w-md">
                    {isIOS
                      ? 'Add XOS to your iPhone Home Screen for a full-screen standalone app experience.'
                      : 'Install XOS for quick Home Screen launch and offline asset caching.'}
                  </p>
                </div>
                <PWAInstallButton variant="row" className="self-start sm:self-center" />
              </div>
            )}

            {/* Export PDF Report */}
            <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h4 className="text-sm font-medium text-[#111111]">
                  Export PDF Report
                </h4>
                <p className="text-xs text-neutral-500 leading-relaxed max-w-md">
                  Download a formatted multi-page PDF statement covering your income, expenses, attendance, savings, and goals.
                </p>
              </div>
              <button
                onClick={() => {
                  setHasOpenedPDFModal(true);
                  setIsPDFModalOpen(true);
                }}
                type="button"
                className="inline-flex items-center justify-center h-10 px-4 text-xs sm:text-sm font-medium text-[#111111] bg-white hover:bg-neutral-50 border border-neutral-200 hover:border-neutral-300 rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]/15"
              >
                Export PDF Report
              </button>
            </div>

            {/* Reset All App Data */}
            <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h4 className="text-sm font-medium text-rose-700">
                  Reset All App Data
                </h4>
                <p className="text-xs text-neutral-500 leading-relaxed max-w-md">
                  {isDemoUser
                    ? 'Clears all temporary demo records in this session and restores default settings.'
                    : 'Permanently deletes your signed-in XOS records (expenses, income, attendance, debts, goals, savings, and payouts) and restores default settings. Your account, profile, and active sign-in session are preserved.'}
                </p>
              </div>
              <button
                onClick={() => {
                  setResetError(null);
                  setIsResetModalOpen(true);
                }}
                disabled={isResetting || isSaving}
                type="button"
                className="inline-flex items-center justify-center gap-2 h-10 px-4 text-xs sm:text-sm font-medium text-rose-700 bg-white hover:bg-rose-50 border border-rose-200 hover:border-rose-300 rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-center cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/30"
              >
                {isResetting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Resetting...</span>
                  </>
                ) : (
                  <span>Reset All App Data</span>
                )}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Confirmation Dialog for Salary Defaults Reset */}
      <ConfirmDialog
        isOpen={isSalaryResetModalOpen}
        title="Reset Salary Defaults?"
        message="This will restore your default daily salary configuration (500 base, 8 hours duty, 100/hr overtime). Previously recorded attendance and salary entries will retain their saved values."
        confirmLabel="Restore Defaults"
        isDestructive={false}
        isLoading={isResettingSalary}
        error={salaryResetError}
        onConfirm={executeResetSalaryDefaults}
        onCancel={() => {
          if (!isResettingSalary) {
            setSalaryResetError(null);
            setIsSalaryResetModalOpen(false);
          }
        }}
      />

      {/* Confirmation Dialog for Reset All App Data */}
      <ConfirmDialog
        isOpen={isResetModalOpen}
        title={isDemoUser ? 'Reset Demo App Data?' : 'Reset All App Data?'}
        message={
          isDemoUser
            ? 'This will clear all temporary demo records and restore default settings.'
            : 'This will permanently delete all your XOS application data (expenses, income, attendance, debts, goals, savings, and payouts) and restore default settings. Your account, profile, and active sign-in session will remain preserved.'
        }
        confirmLabel={isDemoUser ? 'Reset Demo Data' : 'Reset All App Data'}
        isDestructive={true}
        tone="danger"
        isLoading={isResetting}
        error={resetError}
        onConfirm={executeResetAccountData}
        onCancel={() => {
          if (!isResetting) {
            setResetError(null);
            setIsResetModalOpen(false);
          }
        }}
      />

      {/* Confirmation Dialog for Sign Out */}
      <ConfirmDialog
        isOpen={isSignOutModalOpen}
        title={isDemoUser ? 'Exit Demo Session?' : 'Sign Out?'}
        message={
          isDemoUser
            ? 'Are you sure you want to exit the demo session? You will return to the welcome screen.'
            : 'Are you sure you want to sign out of XOS on this device?'
        }
        confirmLabel={isDemoUser ? 'Exit Demo' : 'Sign Out'}
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

      {/* PDF Export Modal (lazy-loaded on demand) */}
      {hasOpenedPDFModal && (
        <Suspense fallback={null}>
          <PDFExportModal
            isOpen={isPDFModalOpen}
            onClose={() => setIsPDFModalOpen(false)}
            defaultPreset="all"
          />
        </Suspense>
      )}
    </div>
  );
};
