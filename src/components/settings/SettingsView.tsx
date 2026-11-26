import React, { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import {
  Check,
  AlertCircle,
  Loader2,
  ChevronDown,
  X,
  ShieldCheck,
  ExternalLink
} from 'lucide-react';
import { useXOSData } from '../../hooks/useXOSData';
import { CURRENCIES, formatCurrency } from '../../utils/formatters';
import { isSalaryConfigured } from '../../utils/calculations';
import { CurrencyCode, DateFormat, WeekStartDay, SalaryConfig } from '../../types';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { PWAInstallButton } from '../common/PWAInstallButton';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { useAuth } from '../../context/AuthContext';
import { repository, SettingsBundleSaveError, SettingsBundleSection } from '../../services/repository';
import { sanitizeDatabaseErrorMessage } from '../../utils/authValidation';
import {
  INPUT_CLASS,
  LABEL_CLASS,
  Modal,
  MONO_INPUT_CLASS,
  PageHeader,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  SELECT_CLASS,
  SUBTLE_BUTTON_CLASS
} from '../ui';

const PDFExportModal = lazy(() =>
  import('../modals/PDFExportModal').then(m => ({ default: m.PDFExportModal }))
);

const SETTINGS_SELECT_CLASS = `${SELECT_CLASS} pl-3.5 pr-9 appearance-none cursor-pointer`;

export const SettingsView: React.FC = () => {
  const data = useXOSData();
  const { user, signOut } = useAuth();

  const resolvedProfileName =
    data.settings.profile.name || user?.user_metadata?.display_name || user?.user_metadata?.full_name || '';
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

  // String numeric inputs prevent mid-typing snap-back and remain empty when unconfigured
  const [dailyBaseSalaryInput, setDailyBaseSalaryInput] = useState<string>(() =>
    typeof resolvedSalaryConfig.dailyBaseSalary === 'number' ? String(resolvedSalaryConfig.dailyBaseSalary) : ''
  );
  const [addonSalaryInput, setAddonSalaryInput] = useState<string>(() =>
    String(resolvedSalaryConfig.addonSalary ?? 0)
  );
  const [addonEnabled, setAddonEnabled] = useState<boolean>(
    Boolean(resolvedSalaryConfig.addonEnabled)
  );
  const [standardHoursInput, setStandardHoursInput] = useState<string>(() =>
    typeof resolvedSalaryConfig.standardWorkingHours === 'number'
      ? String(resolvedSalaryConfig.standardWorkingHours)
      : ''
  );
  const [extraHourRateInput, setExtraHourRateInput] = useState<string>(() =>
    typeof resolvedSalaryConfig.extraHourRate === 'number' ? String(resolvedSalaryConfig.extraHourRate) : ''
  );
  const [overtimeEnabled, setOvertimeEnabled] = useState<boolean>(
    Boolean(resolvedSalaryConfig.overtimeEnabled)
  );

  const [expenseCategories, setExpenseCategories] = useState<string[]>(resolvedExpenseCategories);
  const [newCatName, setNewCatName] = useState<string>('');
  const [catFeedback, setCatFeedback] = useState<string | null>(null);

  const [incomeSources, setIncomeSources] = useState<string[]>(resolvedIncomeSources);
  const [newIncName, setNewIncName] = useState<string>('');
  const [incFeedback, setIncFeedback] = useState<string | null>(null);

  // Save & section failure tracking
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const isSavingRef = useRef<boolean>(false);
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
  const [isPDFModalOpen, setIsPDFModalOpen] = useState<boolean>(false);
  const [hasOpenedPDFModal, setHasOpenedPDFModal] = useState<boolean>(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [activeInfoModal, setActiveInfoModal] = useState<'about' | 'privacy' | 'terms' | 'faq' | null>(null);
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
      setDailyBaseSalaryInput(
        typeof resolvedSalaryConfig.dailyBaseSalary === 'number'
          ? String(resolvedSalaryConfig.dailyBaseSalary)
          : ''
      );
      setAddonSalaryInput(String(resolvedSalaryConfig.addonSalary ?? 0));
      setAddonEnabled(Boolean(resolvedSalaryConfig.addonEnabled));
      setStandardHoursInput(
        typeof resolvedSalaryConfig.standardWorkingHours === 'number'
          ? String(resolvedSalaryConfig.standardWorkingHours)
          : ''
      );
      setExtraHourRateInput(
        typeof resolvedSalaryConfig.extraHourRate === 'number'
          ? String(resolvedSalaryConfig.extraHourRate)
          : ''
      );
      setOvertimeEnabled(Boolean(resolvedSalaryConfig.overtimeEnabled));
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
      ? 0
      : Number(addonSalaryInput.trim());
  const parsedStandardHours = Number(standardHoursInput.trim());
  const parsedExtraHourRate =
    extraHourRateInput.trim() === ''
      ? (typeof resolvedSalaryConfig.extraHourRate === 'number' ? resolvedSalaryConfig.extraHourRate : 0)
      : Number(extraHourRateInput.trim());

  const savedSalaryConfigured = isSalaryConfigured(resolvedSalaryConfig);

  const hasUnsavedChanges = useMemo(() => {
    const salaryChanged = savedSalaryConfigured
      ? (
          dailyBaseSalaryInput.trim() === '' ||
          (addonEnabled && addonSalaryInput.trim() === '') ||
          standardHoursInput.trim() === '' ||
          (overtimeEnabled && extraHourRateInput.trim() === '') ||
          parsedDailyBase !== resolvedSalaryConfig.dailyBaseSalary ||
          parsedAddonSalary !== (resolvedSalaryConfig.addonSalary ?? 0) ||
          addonEnabled !== Boolean(resolvedSalaryConfig.addonEnabled) ||
          parsedStandardHours !== resolvedSalaryConfig.standardWorkingHours ||
          parsedExtraHourRate !== (resolvedSalaryConfig.extraHourRate ?? 0) ||
          overtimeEnabled !== Boolean(resolvedSalaryConfig.overtimeEnabled)
        )
      : (
          dailyBaseSalaryInput.trim() !== '' ||
          standardHoursInput.trim() !== '' ||
          extraHourRateInput.trim() !== '' ||
          addonEnabled !== Boolean(resolvedSalaryConfig.addonEnabled) ||
          overtimeEnabled !== Boolean(resolvedSalaryConfig.overtimeEnabled) ||
          (addonSalaryInput.trim() !== '' && Number(addonSalaryInput.trim()) !== (resolvedSalaryConfig.addonSalary ?? 0))
        );

    return (
      profileName.trim() !== resolvedProfileName.trim() ||
      currency !== resolvedCurrency ||
      dateFormat !== resolvedDateFormat ||
      weekStartDay !== resolvedWeekStartDay ||
      salaryChanged ||
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
    savedSalaryConfigured,
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
  const SETTINGS_TABLE_LABELS: Record<string, string> = {
    user_settings: 'Preferences',
    profiles: 'Profile',
    salary_configs: 'Salary Settings'
  };
  const connectionError =
    settingsFetchErrors.length > 0
      ? settingsFetchErrors
          .map(e => `${SETTINGS_TABLE_LABELS[e.table] || 'Settings'}: ${sanitizeDatabaseErrorMessage(e.message, 'Unable to load section.')}`)
          .join(' · ')
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
    setDailyBaseSalaryInput(
      typeof resolvedSalaryConfig.dailyBaseSalary === 'number'
        ? String(resolvedSalaryConfig.dailyBaseSalary)
        : ''
    );
    setAddonSalaryInput(String(resolvedSalaryConfig.addonSalary ?? 0));
    setAddonEnabled(Boolean(resolvedSalaryConfig.addonEnabled));
    setStandardHoursInput(
      typeof resolvedSalaryConfig.standardWorkingHours === 'number'
        ? String(resolvedSalaryConfig.standardWorkingHours)
        : ''
    );
    setExtraHourRateInput(
      typeof resolvedSalaryConfig.extraHourRate === 'number'
        ? String(resolvedSalaryConfig.extraHourRate)
        : ''
    );
    setOvertimeEnabled(Boolean(resolvedSalaryConfig.overtimeEnabled));
    setExpenseCategories(resolvedExpenseCategories);
    setIncomeSources(resolvedIncomeSources);
    setNewCatName('');
    setNewIncName('');
  };

  // Persist to user_settings, salary_configs, and profiles via repository
  const handleSaveSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSavingRef.current || isSaving || isResetting) return;

    setSaveSuccessMessage(null);
    setSaveErrorMessage(null);

    const hasAnySalaryInput =
      dailyBaseSalaryInput.trim() !== '' ||
      standardHoursInput.trim() !== '' ||
      extraHourRateInput.trim() !== '' ||
      addonEnabled ||
      overtimeEnabled ||
      (addonSalaryInput.trim() !== '' && Number(addonSalaryInput.trim()) > 0);

    if (hasAnySalaryInput) {
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
        parsedStandardHours < 0.5 ||
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
    isSavingRef.current = true;
    setIsSaving(true);

    try {
      const nextSalaryConfig: SalaryConfig = hasAnySalaryInput
        ? {
            dailyBaseSalary: parsedDailyBase,
            addonSalary: parsedAddonSalary,
            addonEnabled,
            standardWorkingHours: parsedStandardHours,
            extraHourRate: parsedExtraHourRate,
            overtimeEnabled,
            isConfigured: true,
            currency
          }
        : {
            dailyBaseSalary: undefined,
            addonSalary: 0,
            addonEnabled: false,
            standardWorkingHours: undefined,
            extraHourRate: undefined,
            overtimeEnabled: false,
            isConfigured: false,
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
      setDailyBaseSalaryInput(
        typeof nextSalaryConfig.dailyBaseSalary === 'number'
          ? String(nextSalaryConfig.dailyBaseSalary)
          : ''
      );
      setAddonSalaryInput(String(nextSalaryConfig.addonSalary));
      setAddonEnabled(nextSalaryConfig.addonEnabled);
      setStandardHoursInput(
        typeof nextSalaryConfig.standardWorkingHours === 'number'
          ? String(nextSalaryConfig.standardWorkingHours)
          : ''
      );
      setExtraHourRateInput(
        typeof nextSalaryConfig.extraHourRate === 'number'
          ? String(nextSalaryConfig.extraHourRate)
          : ''
      );
      setOvertimeEnabled(nextSalaryConfig.overtimeEnabled);
      setSaveSuccessMessage('Settings saved');

      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => setSaveSuccessMessage(null), 3500);
    } catch (err) {
      if (import.meta.env?.DEV) {
        console.error('Failed to save settings:', err);
      }
      if (err instanceof SettingsBundleSaveError) {
        failedSectionsRef.current = new Set(err.failedSections.map(f => f.section));
        setSaveErrorMessage(err.message);
      } else {
        failedSectionsRef.current = new Set(['user_settings', 'salary_configs', 'profiles']);
        setSaveErrorMessage(sanitizeDatabaseErrorMessage(err, 'Unable to save settings. Please try again.'));
      }
    } finally {
      isSavingRef.current = false;
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

  // Reset all app data via Supabase xos_reset_user_data() RPC
  const executeResetAccountData = async () => {
    if (isResettingRef.current || isResetting) return;

    isResettingRef.current = true;
    setIsResetting(true);
    setResetError(null);

    try {
      await data.resetUserData();
      const postReset = repository.getSettings();
      const nextProfileName =
        postReset.profile.name || user?.user_metadata?.display_name || user?.user_metadata?.full_name || '';
      const nextSalary = postReset.salaryConfig;

      failedSectionsRef.current.clear();
      setProfileName(nextProfileName);
      setCurrency((postReset.currency || 'INR') as CurrencyCode);
      setDateFormat((postReset.dateFormat || 'YYYY-MM-DD') as DateFormat);
      setWeekStartDay((postReset.weekStartDay || 'Monday') as WeekStartDay);
      setExpenseCategories(postReset.customExpenseCategories || []);
      setIncomeSources(postReset.customIncomeSources || []);
      setDailyBaseSalaryInput(
        typeof nextSalary.dailyBaseSalary === 'number' ? String(nextSalary.dailyBaseSalary) : ''
      );
      setAddonSalaryInput(String(nextSalary.addonSalary ?? 0));
      setAddonEnabled(Boolean(nextSalary.addonEnabled));
      setStandardHoursInput(
        typeof nextSalary.standardWorkingHours === 'number' ? String(nextSalary.standardWorkingHours) : ''
      );
      setExtraHourRateInput(
        typeof nextSalary.extraHourRate === 'number' ? String(nextSalary.extraHourRate) : ''
      );
      setOvertimeEnabled(Boolean(nextSalary.overtimeEnabled));
      lastSyncedKeyRef.current = JSON.stringify({
        name: nextProfileName,
        currency: postReset.currency || 'INR',
        dateFormat: postReset.dateFormat || 'YYYY-MM-DD',
        weekStartDay: postReset.weekStartDay || 'Monday',
        customExpenseCategories: postReset.customExpenseCategories || [],
        customIncomeSources: postReset.customIncomeSources || [],
        dailyBaseSalary: nextSalary.dailyBaseSalary,
        addonSalary: nextSalary.addonSalary,
        addonEnabled: nextSalary.addonEnabled,
        standardWorkingHours: nextSalary.standardWorkingHours,
        extraHourRate: nextSalary.extraHourRate,
        overtimeEnabled: nextSalary.overtimeEnabled,
        salaryCurrency: nextSalary.currency
      });

      setSaveErrorMessage(null);
      setSaveSuccessMessage(null);
      setCatFeedback(null);
      setIncFeedback(null);
      setNewCatName('');
      setNewIncName('');
      setIsResetModalOpen(false);
      setBannerMessage('All app data has been permanently reset and clean settings restored.');
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = setTimeout(() => setBannerMessage(null), 6000);
    } catch (err) {
      setResetError(sanitizeDatabaseErrorMessage(err, 'Failed to reset app data. Please try again.'));
    } finally {
      isResettingRef.current = false;
      setIsResetting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto text-[#1d1d1f] space-y-6">
      <PageHeader
        title="Settings"
        description="Manage your account, preferences, salary rates, categories, and data."
        actions={
          <div className="flex items-center gap-3">
            {saveSuccessMessage && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1f7a4c]">
                <Check className="w-3.5 h-3.5 text-[#1f7a4c]" />
                <span>{saveSuccessMessage}</span>
              </span>
            )}
            {!saveSuccessMessage && hasUnsavedChanges && !saveErrorMessage && (
              <span className="text-xs text-[#6e6e73]">Unsaved changes</span>
            )}

            <button
              type="button"
              onClick={() => handleSaveSettings()}
              disabled={isSaving || isResetting}
              className={PRIMARY_BUTTON_CLASS}
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
        }
      />

      {/* Inline Feedback Banners */}
      {saveErrorMessage && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-[#fef2f2] border border-[#c92a2a]/20 text-[#991b1b] text-xs sm:text-sm flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-[#c92a2a] mt-0.5 shrink-0" />
            <span>{saveErrorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveErrorMessage(null)}
            className="text-[#c92a2a] hover:text-[#991b1b] p-1 rounded-lg cursor-pointer shrink-0"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {bannerMessage && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-[#f5f5f7] border border-black/[0.08] text-[#1d1d1f] text-xs sm:text-sm flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2.5">
            <Check className="w-4 h-4 text-[#1f7a4c] shrink-0" />
            <span>{bannerMessage}</span>
          </div>
          <button
            onClick={() => setBannerMessage(null)}
            type="button"
            className="text-[#6e6e73] hover:text-[#1d1d1f] text-xs font-medium cursor-pointer shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {connectionError && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-[#fefce8] border border-[#a16207]/20 text-[#854d0e] text-xs sm:text-sm flex items-start gap-2.5"
        >
          <AlertCircle className="w-4 h-4 text-[#a16207] mt-0.5 shrink-0" />
          <span>Some settings could not load from the server: {connectionError}</span>
        </div>
      )}

      <form onSubmit={handleSaveSettings} noValidate className="divide-y divide-black/[0.06]">
        {/* A. Account */}
        <section aria-labelledby="settings-account-heading" className="grid grid-cols-1 md:grid-cols-12 gap-5 md:gap-10 py-7 first:pt-2">
          <div className="md:col-span-4 space-y-1">
            <h3 id="settings-account-heading" className="text-[15px] font-semibold text-[#1d1d1f] tracking-[-0.01em]">
              Account
            </h3>
            <p className="text-xs text-[#6e6e73] leading-relaxed">
              Your sign-in email, display name, and session controls.
            </p>
          </div>

          <div className="md:col-span-8">
            <div className="rounded-2xl bg-white border border-black/[0.08] divide-y divide-black/[0.06]">
              <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Account Email */}
                <div>
                  <span className={LABEL_CLASS}>Account Email</span>
                  <div className="min-h-[44px] sm:min-h-[40px] px-3.5 flex items-center rounded-xl bg-[#f5f5f7] border border-black/[0.06] text-base sm:text-sm text-[#6e6e73] truncate">
                    {user?.email || 'Not signed in'}
                  </div>
                  <p className="text-xs text-[#6e6e73] mt-1.5">
                    Managed by your sign-in account.
                  </p>
                </div>

                {/* Display Name */}
                <div>
                  <label htmlFor="profile-name" className={LABEL_CLASS}>
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
                  <p className="text-xs text-[#6e6e73] mt-1.5">
                    Shown on your dashboard and PDF reports.
                  </p>
                </div>
              </div>

              {/* Sign Out Row */}
              <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-[#1d1d1f]">Sign out</p>
                  <p className="text-xs text-[#6e6e73]">
                    End your current session on this device.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSignOutModalOpen(true)}
                  className={`${SECONDARY_BUTTON_CLASS} self-start sm:self-auto`}
                >
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* B. Preferences */}
        <section aria-labelledby="settings-preferences-heading" className="grid grid-cols-1 md:grid-cols-12 gap-5 md:gap-10 py-7">
          <div className="md:col-span-4 space-y-1">
            <h3 id="settings-preferences-heading" className="text-[15px] font-semibold text-[#1d1d1f] tracking-[-0.01em]">
              Preferences
            </h3>
            <p className="text-xs text-[#6e6e73] leading-relaxed">
              Regional formatting for currency, dates, and weekly calendars.
            </p>
          </div>

          <div className="md:col-span-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Primary Currency */}
            <div>
              <label htmlFor="currency-select" className={LABEL_CLASS}>
                Primary Currency
              </label>
              <div className="relative">
                <select
                  id="currency-select"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                  className={SETTINGS_SELECT_CLASS}
                >
                  {Object.entries(CURRENCIES).map(([code, info]) => (
                    <option key={code} value={code}>
                      {info.name} ({info.symbol})
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-[#86868b] pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
              </div>
              <p className="text-xs text-[#6e6e73] mt-1.5">
                Defaults to INR (₹).
              </p>
            </div>

            {/* Date Format */}
            <div>
              <label htmlFor="date-format-select" className={LABEL_CLASS}>
                Date Format
              </label>
              <div className="relative">
                <select
                  id="date-format-select"
                  value={dateFormat}
                  onChange={(e) => setDateFormat(e.target.value as DateFormat)}
                  className={SETTINGS_SELECT_CLASS}
                >
                  <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                  <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                  <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                </select>
                <ChevronDown className="w-4 h-4 text-[#86868b] pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
              </div>
              <p className="text-xs text-[#6e6e73] mt-1.5">
                Used across logs and reports.
              </p>
            </div>

            {/* Week Starts On */}
            <div>
              <label htmlFor="week-start-select" className={LABEL_CLASS}>
                Week Starts On
              </label>
              <div className="relative">
                <select
                  id="week-start-select"
                  value={weekStartDay}
                  onChange={(e) => setWeekStartDay(e.target.value as WeekStartDay)}
                  className={SETTINGS_SELECT_CLASS}
                >
                  <option value="Monday">Monday</option>
                  <option value="Sunday">Sunday</option>
                </select>
                <ChevronDown className="w-4 h-4 text-[#86868b] pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
              </div>
              <p className="text-xs text-[#6e6e73] mt-1.5">
                Aligns the attendance calendar.
              </p>
            </div>
          </div>
        </section>

        {/* C. Salary Configuration */}
        <section aria-labelledby="settings-salary-heading" className="grid grid-cols-1 md:grid-cols-12 gap-5 md:gap-10 py-7">
          <div className="md:col-span-4 space-y-1.5">
            <h3 id="settings-salary-heading" className="text-[15px] font-semibold text-[#1d1d1f] tracking-[-0.01em]">
              Salary Configuration
            </h3>
            <p className="text-xs text-[#6e6e73] leading-relaxed">
              Daily salary rates and overtime rules applied to new attendance entries.
            </p>
            {!savedSalaryConfigured && (
              <p className="text-xs font-medium text-[#86868b]">
                Not configured yet
              </p>
            )}
          </div>

          <div className="md:col-span-8 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Daily Base Salary */}
              <div>
                <label htmlFor="daily-base-salary" className={LABEL_CLASS}>
                  Daily Base Salary
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-medium text-[#86868b] pointer-events-none">
                    {currencySymbol}
                  </span>
                  <input
                    id="daily-base-salary"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    placeholder="Not configured"
                    value={dailyBaseSalaryInput}
                    onChange={(e) => setDailyBaseSalaryInput(e.target.value)}
                    className={`${MONO_INPUT_CLASS} pl-8 placeholder:font-sans`}
                  />
                </div>
                <p className="text-xs text-[#6e6e73] mt-1.5">
                  Base pay earned for a standard workday.
                </p>
              </div>

              {/* Daily Add-on Salary */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label htmlFor="addon-salary" className="block text-xs font-medium text-[#6e6e73]">
                    Additional / Add-on Salary
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1d1d1f] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={addonEnabled}
                      onChange={(e) => setAddonEnabled(e.target.checked)}
                      className="rounded border-black/[0.2] text-[#0071e3] accent-[#0071e3] focus:ring-[#0071e3]"
                    />
                    <span>Enable Add-on</span>
                  </label>
                </div>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-medium text-[#86868b] pointer-events-none">
                    {currencySymbol}
                  </span>
                  <input
                    id="addon-salary"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    placeholder="0"
                    disabled={!addonEnabled}
                    value={addonSalaryInput}
                    onChange={(e) => setAddonSalaryInput(e.target.value)}
                    className={`${MONO_INPUT_CLASS} pl-8`}
                  />
                </div>
                <p className="text-xs text-[#6e6e73] mt-1.5">
                  {addonEnabled
                    ? 'Added daily on top of base pay for each Present workday.'
                    : 'Add-on pay is currently disabled.'}
                </p>
              </div>

              {/* Standard Duty Hours */}
              <div>
                <label htmlFor="standard-hours" className={LABEL_CLASS}>
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
                    placeholder="Not configured"
                    value={standardHoursInput}
                    onChange={(e) => setStandardHoursInput(e.target.value)}
                    className={`${MONO_INPUT_CLASS} pr-10 placeholder:font-sans`}
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-[#86868b] pointer-events-none">
                    hrs
                  </span>
                </div>
                <p className="text-xs text-[#6e6e73] mt-1.5">
                  Daily shift duration before overtime applies.
                </p>
              </div>

              {/* Extra Working Hour Rate */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label htmlFor="extra-hour-rate" className="block text-xs font-medium text-[#6e6e73]">
                    Extra Working Hour Rate
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1d1d1f] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={overtimeEnabled}
                      onChange={(e) => setOvertimeEnabled(e.target.checked)}
                      className="rounded border-black/[0.2] text-[#0071e3] accent-[#0071e3] focus:ring-[#0071e3]"
                    />
                    <span>Overtime</span>
                  </label>
                </div>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-medium text-[#86868b] pointer-events-none">
                    {currencySymbol}
                  </span>
                  <input
                    id="extra-hour-rate"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    placeholder="Not configured"
                    disabled={!overtimeEnabled}
                    value={extraHourRateInput}
                    onChange={(e) => setExtraHourRateInput(e.target.value)}
                    className={`${MONO_INPUT_CLASS} pl-8 pr-9 placeholder:font-sans`}
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-[#86868b] pointer-events-none">
                    /hr
                  </span>
                </div>
                <p className="text-xs text-[#6e6e73] mt-1.5">
                  {overtimeEnabled
                    ? 'Paid per hour worked beyond standard daily hours.'
                    : 'Overtime calculation disabled for new entries.'}
                </p>
              </div>

              {/* Salary Currency (Synced with Primary Currency) */}
              <div className="sm:col-span-2">
                <label htmlFor="salary-currency-select" className={LABEL_CLASS}>
                  Salary Currency
                </label>
                <div className="relative">
                  <select
                    id="salary-currency-select"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                    className={SETTINGS_SELECT_CLASS}
                  >
                    {Object.entries(CURRENCIES).map(([code, info]) => (
                      <option key={code} value={code}>
                        {code} — {info.symbol}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-[#86868b] pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
                </div>
                <p className="text-xs text-[#6e6e73] mt-1.5">
                  Synced with workspace regional currency.
                </p>
              </div>
            </div>

            {/* Live Daily Pay Preview */}
            <div className="p-4 rounded-2xl bg-[#f5f5f7] space-y-2.5">
              {dailyBaseSalaryInput.trim() !== '' &&
              standardHoursInput.trim() !== '' &&
              Number.isFinite(parsedDailyBase) &&
              parsedDailyBase >= 0 &&
              Number.isFinite(parsedStandardHours) &&
              parsedStandardHours > 0 ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#1d1d1f]">Live Daily Pay Preview</span>
                    <span className="text-xs font-mono text-[#6e6e73] tabular-nums">
                      ≈ {formatCurrency(parsedDailyBase / parsedStandardHours, currency)}/hr base
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1 border-t border-black/[0.06]">
                    <div className="flex items-center justify-between py-1">
                      <span className="text-[#6e6e73]">
                        Standard ({parsedStandardHours}h)
                      </span>
                      <span className="font-mono font-semibold text-[#1d1d1f] tabular-nums">
                        {formatCurrency(
                          parsedDailyBase +
                            (addonEnabled && Number.isFinite(parsedAddonSalary) && parsedAddonSalary >= 0
                              ? parsedAddonSalary
                              : 0),
                          currency
                        )}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-1 sm:border-l sm:border-black/[0.06] sm:pl-3">
                      <span className="text-[#6e6e73]">
                        +2h Overtime ({parsedStandardHours + 2}h)
                      </span>
                      <span className="font-mono font-semibold text-[#1d1d1f] tabular-nums">
                        {formatCurrency(
                          parsedDailyBase +
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
                </>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs text-[#6e6e73]">
                  <span className="font-semibold text-[#1d1d1f]">Live Daily Pay Preview</span>
                  <span>Not configured — enter daily base salary and standard hours above to preview.</span>
                </div>
              )}
            </div>

            {/* Historical Protection */}
            <div className="p-4 rounded-2xl bg-white border border-black/[0.08] space-y-1 text-xs text-[#6e6e73]">
              <div className="flex items-center gap-1.5 font-semibold text-[#1d1d1f]">
                <ShieldCheck className="w-4 h-4 text-[#0071e3] shrink-0" />
                <span>Historical Record Protection</span>
              </div>
              <p className="leading-relaxed">
                Past attendance &amp; salary records store their own base, add-on, overtime, and manual override snapshot. Updating these defaults only applies to new entries.
              </p>
            </div>
          </div>
        </section>

        {/* D. Categories */}
        <section aria-labelledby="settings-categories-heading" className="grid grid-cols-1 md:grid-cols-12 gap-5 md:gap-10 py-7">
          <div className="md:col-span-4 space-y-1">
            <h3 id="settings-categories-heading" className="text-[15px] font-semibold text-[#1d1d1f] tracking-[-0.01em]">
              Categories
            </h3>
            <p className="text-xs text-[#6e6e73] leading-relaxed">
              Manage labels for expense tracking and income entries.
            </p>
          </div>

          <div className="md:col-span-8 space-y-6">
            {/* Expense Categories */}
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <label htmlFor="new-expense-category" className="text-xs font-medium text-[#6e6e73]">
                  Expense Categories
                </label>
                <span className="text-xs text-[#86868b] font-mono tabular-nums">
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
                  className={SUBTLE_BUTTON_CLASS}
                >
                  Add
                </button>
              </div>

              {catFeedback && (
                <p className="text-xs text-[#c92a2a]">{catFeedback}</p>
              )}

              <div className="rounded-xl border border-black/[0.08] bg-white divide-y divide-black/[0.06] sm:divide-y-0 sm:grid sm:grid-cols-2">
                {expenseCategories.map((cat) => (
                  <div
                    key={cat}
                    className="flex items-center justify-between gap-2 px-3.5 py-2 sm:border-b sm:border-black/[0.06] sm:odd:border-r text-xs text-[#1d1d1f]"
                  >
                    <span className="truncate font-medium">{cat}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCategory(cat)}
                      disabled={expenseCategories.length <= 1}
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-[#86868b] hover:text-[#c92a2a] hover:bg-[#fef2f2] disabled:opacity-25 cursor-pointer disabled:cursor-not-allowed transition-colors shrink-0"
                      aria-label={`Remove expense category ${cat}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Income Sources */}
            <div className="space-y-3 pt-5 border-t border-black/[0.06]">
              <div className="flex items-baseline justify-between">
                <label htmlFor="new-income-source" className="text-xs font-medium text-[#6e6e73]">
                  Income Sources
                </label>
                <span className="text-xs text-[#86868b] font-mono tabular-nums">
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
                  className={SUBTLE_BUTTON_CLASS}
                >
                  Add
                </button>
              </div>

              {incFeedback && (
                <p className="text-xs text-[#c92a2a]">{incFeedback}</p>
              )}

              <div className="rounded-xl border border-black/[0.08] bg-white divide-y divide-black/[0.06] sm:divide-y-0 sm:grid sm:grid-cols-2">
                {incomeSources.map((src) => (
                  <div
                    key={src}
                    className="flex items-center justify-between gap-2 px-3.5 py-2 sm:border-b sm:border-black/[0.06] sm:odd:border-r text-xs text-[#1d1d1f]"
                  >
                    <span className="truncate font-medium">{src}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveIncomeSource(src)}
                      disabled={incomeSources.length <= 1}
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-[#86868b] hover:text-[#c92a2a] hover:bg-[#fef2f2] disabled:opacity-25 cursor-pointer disabled:cursor-not-allowed transition-colors shrink-0"
                      aria-label={`Remove income source ${src}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom Form Save Actions */}
            {hasUnsavedChanges && (
              <div className="pt-4 border-t border-black/[0.06] flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={handleDiscardChanges}
                  disabled={isSaving || isResetting}
                  className={SECONDARY_BUTTON_CLASS}
                >
                  Discard
                </button>
                <button
                  type="submit"
                  disabled={isSaving || isResetting}
                  className={PRIMARY_BUTTON_CLASS}
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
      <section aria-labelledby="settings-data-heading" className="grid grid-cols-1 md:grid-cols-12 gap-5 md:gap-10 py-7 border-t border-black/[0.06]">
        <div className="md:col-span-4 space-y-1">
          <h3 id="settings-data-heading" className="text-[15px] font-semibold text-[#1d1d1f] tracking-[-0.01em]">
            Data & Privacy
          </h3>
          <p className="text-xs text-[#6e6e73] leading-relaxed">
            Export your financial records or permanently reset your app data.
          </p>
        </div>

        <div className="md:col-span-8">
          <div className="border border-black/[0.08] rounded-2xl divide-y divide-black/[0.06] bg-white">
            {/* Install App Row */}
            {!isInstalled && (isInstallable || isIOS) && (
              <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h4 className="text-sm font-medium text-[#1d1d1f]">
                    Install XOS on Device
                  </h4>
                  <p className="text-xs text-[#6e6e73] leading-relaxed max-w-md">
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
                <h4 className="text-sm font-medium text-[#1d1d1f]">
                  Export PDF Report
                </h4>
                <p className="text-xs text-[#6e6e73] leading-relaxed max-w-md">
                  Download a formatted multi-page PDF statement covering your income, expenses, attendance, savings, and goals.
                </p>
              </div>
              <button
                onClick={() => {
                  setHasOpenedPDFModal(true);
                  setIsPDFModalOpen(true);
                }}
                type="button"
                className={`${SECONDARY_BUTTON_CLASS} self-start sm:self-center`}
              >
                Export PDF Report
              </button>
            </div>

            {/* Reset All App Data */}
            <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h4 className="text-sm font-medium text-[#c92a2a]">
                  Reset All App Data
                </h4>
                <p className="text-xs text-[#6e6e73] leading-relaxed max-w-md">
                  Permanently deletes your signed-in XOS records (expenses, income, attendance, debts, goals, savings, and payouts) and restores clean settings. Your account, profile, and active sign-in session are preserved.
                </p>
              </div>
              <button
                onClick={() => {
                  setResetError(null);
                  setIsResetModalOpen(true);
                }}
                disabled={isResetting || isSaving}
                type="button"
                className="inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-[40px] px-4 py-2 text-[13px] font-medium text-[#c92a2a] bg-white hover:bg-[#fef2f2] border border-[#c92a2a]/25 hover:border-[#c92a2a]/40 rounded-xl transition-colors whitespace-nowrap shrink-0 self-start sm:self-center cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c92a2a]/30"
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

      {/* F. About, Legal & Support */}
      <section aria-labelledby="settings-info-heading" className="grid grid-cols-1 md:grid-cols-12 gap-5 md:gap-10 py-7 border-t border-black/[0.06]">
        <div className="md:col-span-4 space-y-1">
          <h3 id="settings-info-heading" className="text-[15px] font-semibold text-[#1d1d1f] tracking-[-0.01em]">
            About, Legal &amp; Support
          </h3>
          <p className="text-xs text-[#6e6e73] leading-relaxed">
            Application information, open-source repository, legal terms, and frequently asked questions.
          </p>
        </div>

        <div className="md:col-span-8">
          <div className="border border-black/[0.08] rounded-2xl divide-y divide-black/[0.06] bg-white">
            {/* About XOS */}
            <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h4 className="text-sm font-medium text-[#1d1d1f]">About XOS</h4>
                <p className="text-xs text-[#6e6e73] leading-relaxed max-w-md">
                  Version, open-source developer information, and GitHub repository.
                </p>
              </div>
              <button
                onClick={() => setActiveInfoModal('about')}
                type="button"
                className={`${SECONDARY_BUTTON_CLASS} self-start sm:self-center`}
              >
                View About
              </button>
            </div>

            {/* Privacy Policy */}
            <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h4 className="text-sm font-medium text-[#1d1d1f]">Privacy Policy</h4>
                <p className="text-xs text-[#6e6e73] leading-relaxed max-w-md">
                  How your private data, Supabase RLS isolation, and session credentials are handled.
                </p>
              </div>
              <button
                onClick={() => setActiveInfoModal('privacy')}
                type="button"
                className={`${SECONDARY_BUTTON_CLASS} self-start sm:self-center`}
              >
                View Privacy Policy
              </button>
            </div>

            {/* Terms & Conditions */}
            <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h4 className="text-sm font-medium text-[#1d1d1f]">Terms &amp; Conditions</h4>
                <p className="text-xs text-[#6e6e73] leading-relaxed max-w-md">
                  Open-source software license agreement, user responsibilities, and warranty disclaimers.
                </p>
              </div>
              <button
                onClick={() => setActiveInfoModal('terms')}
                type="button"
                className={`${SECONDARY_BUTTON_CLASS} self-start sm:self-center`}
              >
                View Terms
              </button>
            </div>

            {/* Frequently Asked Questions */}
            <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h4 className="text-sm font-medium text-[#1d1d1f]">Frequently Asked Questions</h4>
                <p className="text-xs text-[#6e6e73] leading-relaxed max-w-md">
                  Answers about salary calculations, data backups, attendance, and account resets.
                </p>
              </div>
              <button
                onClick={() => setActiveInfoModal('faq')}
                type="button"
                className={`${SECONDARY_BUTTON_CLASS} self-start sm:self-center`}
              >
                View FAQs
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Confirmation Dialog for Reset All App Data */}
      <ConfirmDialog
        isOpen={isResetModalOpen}
        title="Reset All App Data?"
        message="This will permanently delete all your XOS application data (expenses, income, attendance, debts, goals, savings, and payouts) and restore clean settings. Your account, profile, and active sign-in session will remain preserved."
        confirmLabel="Reset All App Data"
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
        title="Sign Out?"
        message="Are you sure you want to sign out of XOS on this device?"
        confirmLabel="Sign Out"
        isDestructive={false}
        onConfirm={() => {
          signOut();
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

      {/* About / Legal / FAQ Modal Dialog */}
      <Modal
        isOpen={Boolean(activeInfoModal)}
        onClose={() => setActiveInfoModal(null)}
        title={
          activeInfoModal === 'about'
            ? 'About XOS'
            : activeInfoModal === 'privacy'
              ? 'Privacy Policy'
              : activeInfoModal === 'terms'
                ? 'Terms & Conditions'
                : 'Frequently Asked Questions'
        }
        maxWidth="lg"
        footer={
          <button
            onClick={() => setActiveInfoModal(null)}
            type="button"
            className={PRIMARY_BUTTON_CLASS}
          >
            Close
          </button>
        }
      >
        <div className="text-xs sm:text-sm text-[#6e6e73] leading-relaxed space-y-4">
          {activeInfoModal === 'about' && (
            <>
              <p>
                <strong className="text-[#1d1d1f]">XOS</strong> is a private Personal Life Operating System designed to help you manage everyday finances, work records, salary calculations, savings reserves, and milestone goals in a unified workspace.
              </p>
              <p>
                Developed by Musthafa CZ. Built with React 19, TypeScript, Vite, and Supabase with Row-Level Security.
              </p>
              <div className="pt-2">
                <a
                  href="https://github.com/musthafacz13-hub/XOS"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={SECONDARY_BUTTON_CLASS}
                >
                  <span>View GitHub Repository</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </>
          )}

          {activeInfoModal === 'privacy' && (
            <>
              <h4 className="font-semibold text-[#1d1d1f]">1. Information We Process</h4>
              <p>
                XOS operates entirely within your private user account secured by Supabase Authentication. We process only the financial records, attendance entries, goals, savings, and settings you explicitly enter.
              </p>
              <h4 className="font-semibold text-[#1d1d1f]">2. Data Storage &amp; Security</h4>
              <p>
                All application data is stored securely in your private Supabase database instance protected by PostgreSQL Row-Level Security (RLS), ensuring that only authenticated owners can access their records.
              </p>
              <h4 className="font-semibold text-[#1d1d1f]">3. Cookies &amp; Sessions</h4>
              <p>
                We use standard session tokens solely for authentication and keeping you signed in. We do not use third-party advertising cookies or trackers.
              </p>
              <h4 className="font-semibold text-[#1d1d1f]">4. Data Export &amp; Deletion</h4>
              <p>
                You retain full ownership of your data. You can export complete multi-page PDF reports or JSON backups at any time from Settings, or permanently reset your transactional data using the account reset utility.
              </p>
            </>
          )}

          {activeInfoModal === 'terms' && (
            <>
              <h4 className="font-semibold text-[#1d1d1f]">1. Acceptance of Terms</h4>
              <p>
                By accessing or using XOS, you agree to these terms for personal, non-commercial productivity use.
              </p>
              <h4 className="font-semibold text-[#1d1d1f]">2. Open-Source Software</h4>
              <p>
                XOS is provided as open-source software under standard licensing. It is provided &ldquo;as is&rdquo; without warranty of any kind, express or implied.
              </p>
              <h4 className="font-semibold text-[#1d1d1f]">3. User Responsibility</h4>
              <p>
                You are solely responsible for maintaining the confidentiality of your account credentials and the accuracy of the financial and attendance data you record.
              </p>
              <h4 className="font-semibold text-[#1d1d1f]">4. Availability</h4>
              <p>
                While XOS is designed for reliable daily performance, we do not guarantee uninterrupted uptime or permanent offline data retention beyond your browser and database storage state.
              </p>
            </>
          )}

          {activeInfoModal === 'faq' && (
            <div className="space-y-4">
              <div>
                <h5 className="font-semibold text-[#1d1d1f]">How does XOS protect my financial and personal data?</h5>
                <p className="mt-1">XOS uses Supabase authentication and strict PostgreSQL Row-Level Security (RLS) policies. Your records are isolated to your account and never shared or exposed publicly.</p>
              </div>
              <div>
                <h5 className="font-semibold text-[#1d1d1f]">How do I calculate my earned salary?</h5>
                <p className="mt-1">Configure your daily base salary, standard working hours, optional add-ons, and overtime rates in Salary Settings. Each attendance entry automatically computes your daily earnings.</p>
              </div>
              <div>
                <h5 className="font-semibold text-[#1d1d1f]">Can I export my data or install XOS as an app?</h5>
                <p className="mt-1">Yes. You can export comprehensive PDF reports or JSON backups from Settings, and install XOS as a Progressive Web App (PWA) on your desktop or mobile device.</p>
              </div>
              <div>
                <h5 className="font-semibold text-[#1d1d1f]">How do I reset my account data if needed?</h5>
                <p className="mt-1">You can permanently delete all transactional records (expenses, income, attendance, debts, goals) while preserving your account and settings using the &ldquo;Reset All App Data&rdquo; option in Settings.</p>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};
