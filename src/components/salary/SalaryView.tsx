import React, { useState, useEffect, useMemo } from 'react';
import {
  Calculator,
  Plus,
  Trash2,
  Banknote,
  Check,
  AlertCircle,
  Edit3,
  RotateCcw,
  ShieldCheck,
  X
} from 'lucide-react';
import { useXOSData } from '../../hooks/useXOSData';
import { AttendanceRecord, AttendanceStatus } from '../../types';
import {
  calculateDailyEarnedSalary,
  calculateMonthlySalarySummary,
  getMonthDateBounds,
  payoutMatchesMonth
} from '../../utils/calculations';
import { formatCurrency, formatHumanDate, getMonthString, getTodayString } from '../../utils/formatters';
import { EmptyState } from '../common/EmptyState';
import { ConfirmDialog } from '../common/ConfirmDialog';

type SalaryTab = 'summary' | 'daily' | 'payments' | 'settings';

export const SalaryView: React.FC = () => {
  const data = useXOSData();
  const todayStr = getTodayString();

  const [activeTab, setActiveTab] = useState<SalaryTab>('summary');
  const [selectedMonth, setSelectedMonth] = useState(getMonthString());

  // Deletion targets
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeletingPayout, setIsDeletingPayout] = useState(false);
  const [deletePayoutError, setDeletePayoutError] = useState<string | null>(null);

  const [deleteDailyTargetId, setDeleteDailyTargetId] = useState<string | null>(null);
  const [isDeletingDaily, setIsDeletingDaily] = useState(false);
  const [deleteDailyError, setDeleteDailyError] = useState<string | null>(null);

  // Rate Settings form (string state avoids mid-typing snap-back)
  const [dailyBaseSalaryInput, setDailyBaseSalaryInput] = useState(
    String(data.settings.salaryConfig.dailyBaseSalary ?? 500)
  );
  const [addonSalaryInput, setAddonSalaryInput] = useState(
    String(data.settings.salaryConfig.addonSalary ?? 0)
  );
  const [addonEnabled, setAddonEnabled] = useState(
    Boolean(data.settings.salaryConfig.addonEnabled)
  );
  const [standardWorkingHoursInput, setStandardWorkingHoursInput] = useState(
    String(data.settings.salaryConfig.standardWorkingHours ?? 8)
  );
  const [extraHourRateInput, setExtraHourRateInput] = useState(
    String(data.settings.salaryConfig.extraHourRate ?? 100)
  );
  const [overtimeEnabled, setOvertimeEnabled] = useState(
    data.settings.salaryConfig.overtimeEnabled !== undefined
      ? Boolean(data.settings.salaryConfig.overtimeEnabled)
      : true
  );
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [savedSettingsNotif, setSavedSettingsNotif] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isResetDefaultsModalOpen, setIsResetDefaultsModalOpen] = useState(false);
  const [isResettingDefaults, setIsResettingDefaults] = useState(false);
  const [resetDefaultsError, setResetDefaultsError] = useState<string | null>(null);

  // Daily Salary Customization Modal State
  const [isDailyModalOpen, setIsDailyModalOpen] = useState(false);
  const [dailyDate, setDailyDate] = useState(todayStr);
  const [dailyStatus, setDailyStatus] = useState<AttendanceStatus>('Present');
  const [dailyHoursInput, setDailyHoursInput] = useState(
    String(data.settings.salaryConfig.standardWorkingHours ?? 8)
  );
  const [dailyCustomBaseInput, setDailyCustomBaseInput] = useState(
    String(data.settings.salaryConfig.dailyBaseSalary ?? 500)
  );
  const [dailyCustomAddonEnabled, setDailyCustomAddonEnabled] = useState(
    Boolean(data.settings.salaryConfig.addonEnabled)
  );
  const [dailyCustomAddonInput, setDailyCustomAddonInput] = useState(
    String(data.settings.salaryConfig.addonSalary ?? 0)
  );
  const [dailyCustomOvertimeEnabled, setDailyCustomOvertimeEnabled] = useState(
    data.settings.salaryConfig.overtimeEnabled !== undefined
      ? Boolean(data.settings.salaryConfig.overtimeEnabled)
      : true
  );
  const [dailyCustomExtraRateInput, setDailyCustomExtraRateInput] = useState(
    String(data.settings.salaryConfig.extraHourRate ?? 100)
  );
  const [useDirectEarnedOverride, setUseDirectEarnedOverride] = useState(false);
  const [directEarnedSalaryInput, setDirectEarnedSalaryInput] = useState('');
  const [dailyNotes, setDailyNotes] = useState('');
  const [isSavingDaily, setIsSavingDaily] = useState(false);
  const [dailyFormError, setDailyFormError] = useState<string | null>(null);
  const [dailyBannerMessage, setDailyBannerMessage] = useState<string | null>(null);

  // Salary Payment Modal
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayStr);
  const [paymentNotes, setPaymentNotes] = useState('');
  const [isSyncingToIncome, setIsSyncingToIncome] = useState(true);
  const [allowReplace, setAllowReplace] = useState(false);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  useEffect(() => {
    setDailyBaseSalaryInput(String(data.settings.salaryConfig.dailyBaseSalary ?? 500));
    setAddonSalaryInput(String(data.settings.salaryConfig.addonSalary ?? 0));
    setAddonEnabled(Boolean(data.settings.salaryConfig.addonEnabled));
    setStandardWorkingHoursInput(String(data.settings.salaryConfig.standardWorkingHours ?? 8));
    setExtraHourRateInput(String(data.settings.salaryConfig.extraHourRate ?? 100));
    setOvertimeEnabled(
      data.settings.salaryConfig.overtimeEnabled !== undefined
        ? Boolean(data.settings.salaryConfig.overtimeEnabled)
        : true
    );
  }, [data.settings.salaryConfig]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isDailyModalOpen && !isSavingDaily) setIsDailyModalOpen(false);
      if (isPaymentModalOpen && !isSubmittingPayment) setIsPaymentModalOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDailyModalOpen, isSavingDaily, isPaymentModalOpen, isSubmittingPayment]);

  const attendanceByDate = useMemo(
    () => new Map(data.attendance.map(r => [r.date, r])),
    [data.attendance]
  );

  const monthDailyRecords = useMemo(
    () =>
      data.attendance
        .filter(r => r.date && r.date.startsWith(selectedMonth))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [data.attendance, selectedMonth]
  );

  // Monthly earnings summary calculation
  const monthlySummary = useMemo(
    () =>
      calculateMonthlySalarySummary(
        data.attendance,
        data.salaryPayouts,
        data.settings.salaryConfig,
        selectedMonth
      ),
    [data.attendance, data.salaryPayouts, data.settings.salaryConfig, selectedMonth]
  );

  const monthPayouts = useMemo(
    () => data.salaryPayouts.filter(p => payoutMatchesMonth(p, selectedMonth)),
    [data.salaryPayouts, selectedMonth]
  );

  const syncedPayoutIncomeIds = useMemo(() => {
    const ids = new Set<string>();
    data.incomes.forEach(i => {
      if (i.salaryPayoutId) ids.add(i.salaryPayoutId);
    });
    return ids;
  }, [data.incomes]);

  const parsedSettingsBase = Number(dailyBaseSalaryInput.trim());
  const parsedSettingsAddon =
    addonSalaryInput.trim() === ''
      ? (data.settings.salaryConfig.addonSalary ?? 0)
      : Number(addonSalaryInput.trim());
  const parsedSettingsHours = Number(standardWorkingHoursInput.trim());
  const parsedSettingsExtraRate =
    extraHourRateInput.trim() === ''
      ? (data.settings.salaryConfig.extraHourRate ?? 100)
      : Number(extraHourRateInput.trim());

  const hasRateSettingsChanges = useMemo(() => {
    const savedOvertimeEnabled =
      data.settings.salaryConfig.overtimeEnabled !== undefined
        ? Boolean(data.settings.salaryConfig.overtimeEnabled)
        : true;
    return (
      dailyBaseSalaryInput.trim() === '' ||
      (addonEnabled && addonSalaryInput.trim() === '') ||
      standardWorkingHoursInput.trim() === '' ||
      (overtimeEnabled && extraHourRateInput.trim() === '') ||
      parsedSettingsBase !== data.settings.salaryConfig.dailyBaseSalary ||
      parsedSettingsAddon !== (data.settings.salaryConfig.addonSalary ?? 0) ||
      addonEnabled !== Boolean(data.settings.salaryConfig.addonEnabled) ||
      parsedSettingsHours !== data.settings.salaryConfig.standardWorkingHours ||
      parsedSettingsExtraRate !== data.settings.salaryConfig.extraHourRate ||
      overtimeEnabled !== savedOvertimeEnabled
    );
  }, [
    dailyBaseSalaryInput,
    addonSalaryInput,
    addonEnabled,
    standardWorkingHoursInput,
    extraHourRateInput,
    overtimeEnabled,
    parsedSettingsBase,
    parsedSettingsAddon,
    parsedSettingsHours,
    parsedSettingsExtraRate,
    data.settings.salaryConfig
  ]);

  const handleCancelRateChanges = () => {
    setDailyBaseSalaryInput(String(data.settings.salaryConfig.dailyBaseSalary ?? 500));
    setAddonSalaryInput(String(data.settings.salaryConfig.addonSalary ?? 0));
    setAddonEnabled(Boolean(data.settings.salaryConfig.addonEnabled));
    setStandardWorkingHoursInput(String(data.settings.salaryConfig.standardWorkingHours ?? 8));
    setExtraHourRateInput(String(data.settings.salaryConfig.extraHourRate ?? 100));
    setOvertimeEnabled(
      data.settings.salaryConfig.overtimeEnabled !== undefined
        ? Boolean(data.settings.salaryConfig.overtimeEnabled)
        : true
    );
    setSettingsError(null);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingSettings) return;
    setSettingsError(null);
    setSavedSettingsNotif(null);

    if (dailyBaseSalaryInput.trim() === '' || !Number.isFinite(parsedSettingsBase) || parsedSettingsBase < 0) {
      setSettingsError('Daily base salary must be zero or a positive number.');
      return;
    }
    if ((addonEnabled && addonSalaryInput.trim() === '') || !Number.isFinite(parsedSettingsAddon) || parsedSettingsAddon < 0) {
      setSettingsError('Add-on salary must be zero or a positive number.');
      return;
    }
    if (
      standardWorkingHoursInput.trim() === '' ||
      !Number.isFinite(parsedSettingsHours) ||
      parsedSettingsHours <= 0 ||
      parsedSettingsHours > 24
    ) {
      setSettingsError('Standard working hours must be between 0.5 and 24.');
      return;
    }
    if (
      (overtimeEnabled && extraHourRateInput.trim() === '') ||
      !Number.isFinite(parsedSettingsExtraRate) ||
      parsedSettingsExtraRate < 0
    ) {
      setSettingsError('Extra-hour rate must be zero or a positive number.');
      return;
    }

    setIsSavingSettings(true);
    const updatedSalaryConfig = {
      currency: data.settings.currency || data.settings.salaryConfig.currency || 'INR',
      dailyBaseSalary: parsedSettingsBase,
      addonSalary: parsedSettingsAddon,
      addonEnabled,
      standardWorkingHours: parsedSettingsHours,
      extraHourRate: parsedSettingsExtraRate,
      overtimeEnabled
    };

    try {
      await data.persistSalaryConfig(updatedSalaryConfig);
      setSavedSettingsNotif('Saved');
      setTimeout(() => setSavedSettingsNotif(null), 3000);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to save salary rate settings.');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleConfirmResetDefaults = async () => {
    if (isResettingDefaults) return;
    setResetDefaultsError(null);
    setIsResettingDefaults(true);
    try {
      const defaults = {
        currency: data.settings.currency || data.settings.salaryConfig.currency || 'INR',
        dailyBaseSalary: 500,
        addonSalary: 0,
        addonEnabled: false,
        standardWorkingHours: 8,
        extraHourRate: 100,
        overtimeEnabled: true
      };
      await data.persistSalaryConfig(defaults);
      setDailyBaseSalaryInput('500');
      setAddonSalaryInput('0');
      setAddonEnabled(false);
      setStandardWorkingHoursInput('8');
      setExtraHourRateInput('100');
      setOvertimeEnabled(true);
      setIsResetDefaultsModalOpen(false);
      setSavedSettingsNotif('Defaults restored');
      setTimeout(() => setSavedSettingsNotif(null), 3500);
    } catch (err) {
      setResetDefaultsError(err instanceof Error ? err.message : 'Failed to restore salary defaults.');
    } finally {
      setIsResettingDefaults(false);
    }
  };

  const loadDayIntoModal = (targetDate: string, existing?: AttendanceRecord) => {
    const cfg = data.settings.salaryConfig;
    setDailyDate(targetDate);
    setDailyFormError(null);

    if (existing) {
      const recBase = typeof existing.dailyBaseSalary === 'number' ? existing.dailyBaseSalary : cfg.dailyBaseSalary;
      const recAddon = typeof existing.addonSalary === 'number' ? existing.addonSalary : (cfg.addonSalary ?? 0);
      const recAddonEnabled =
        typeof existing.addonEnabled === 'boolean' ? existing.addonEnabled : Boolean(cfg.addonEnabled);
      const recRate = typeof existing.extraHourRate === 'number' ? existing.extraHourRate : cfg.extraHourRate;
      const recOvertimeEnabled =
        typeof existing.overtimeEnabled === 'boolean'
          ? existing.overtimeEnabled
          : cfg.overtimeEnabled !== undefined
            ? Boolean(cfg.overtimeEnabled)
            : true;
      const recHours = typeof existing.calculatedHours === 'number' ? existing.calculatedHours : cfg.standardWorkingHours;
      const formulaRes = calculateDailyEarnedSalary(existing.status, recHours, {
        ...cfg,
        dailyBaseSalary: recBase,
        addonSalary: recAddon,
        addonEnabled: recAddonEnabled,
        extraHourRate: recRate,
        overtimeEnabled: recOvertimeEnabled
      });
      const hasOverrideFlag = existing.status === 'Present' && Boolean(existing.salaryOverrideEnabled);

      setDailyStatus(existing.status);
      setDailyHoursInput(String(recHours));
      setDailyCustomBaseInput(String(recBase));
      setDailyCustomAddonEnabled(recAddonEnabled);
      setDailyCustomAddonInput(String(recAddon));
      setDailyCustomOvertimeEnabled(recOvertimeEnabled);
      setDailyCustomExtraRateInput(String(recRate));
      setUseDirectEarnedOverride(hasOverrideFlag);
      setDirectEarnedSalaryInput(
        hasOverrideFlag
          ? String(existing.salaryOverrideAmount ?? existing.dailyEarnedSalary ?? formulaRes.dailyEarnedSalary)
          : String(formulaRes.dailyEarnedSalary)
      );
      setDailyNotes(existing.notes || '');
    } else {
      const defaultAddonEnabled = Boolean(cfg.addonEnabled);
      const defaultOvertimeEnabled =
        cfg.overtimeEnabled !== undefined ? Boolean(cfg.overtimeEnabled) : true;
      const defaultFormula = calculateDailyEarnedSalary('Present', cfg.standardWorkingHours ?? 8, cfg);

      setDailyStatus('Present');
      setDailyHoursInput(String(cfg.standardWorkingHours ?? 8));
      setDailyCustomBaseInput(String(cfg.dailyBaseSalary ?? 500));
      setDailyCustomAddonEnabled(defaultAddonEnabled);
      setDailyCustomAddonInput(String(cfg.addonSalary ?? 0));
      setDailyCustomOvertimeEnabled(defaultOvertimeEnabled);
      setDailyCustomExtraRateInput(String(cfg.extraHourRate ?? 100));
      setUseDirectEarnedOverride(false);
      setDirectEarnedSalaryInput(String(defaultFormula.dailyEarnedSalary));
      setDailyNotes('');
    }
  };

  const openDailyCustomizeModal = (targetDate?: string) => {
    const fallbackDate = todayStr.startsWith(selectedMonth)
      ? todayStr
      : `${selectedMonth}-01` <= todayStr
      ? `${selectedMonth}-01`
      : todayStr;
    const dateToUse = targetDate || fallbackDate;
    loadDayIntoModal(dateToUse, attendanceByDate.get(dateToUse));
    setIsSavingDaily(false);
    setIsDailyModalOpen(true);
  };

  const handleDailyDateChange = (nextDate: string) => {
    loadDayIntoModal(nextDate, attendanceByDate.get(nextDate));
  };

  const dailyFormulaPreview = useMemo(() => {
    const hours = Number(dailyHoursInput.trim());
    const base = Number(dailyCustomBaseInput.trim());
    const addon = Number(dailyCustomAddonInput.trim());
    const extraRate = Number(dailyCustomExtraRateInput.trim());
    return calculateDailyEarnedSalary(
      dailyStatus,
      Number.isFinite(hours) && hours >= 0 ? hours : 0,
      {
        standardWorkingHours: data.settings.salaryConfig.standardWorkingHours || 8,
        dailyBaseSalary: Number.isFinite(base) && base >= 0 ? base : 0,
        addonSalary: Number.isFinite(addon) && addon >= 0 ? addon : 0,
        addonEnabled: dailyCustomAddonEnabled,
        extraHourRate: Number.isFinite(extraRate) && extraRate >= 0 ? extraRate : 0,
        overtimeEnabled: dailyCustomOvertimeEnabled
      }
    );
  }, [
    dailyStatus,
    dailyHoursInput,
    dailyCustomBaseInput,
    dailyCustomAddonEnabled,
    dailyCustomAddonInput,
    dailyCustomOvertimeEnabled,
    dailyCustomExtraRateInput,
    data.settings.salaryConfig.standardWorkingHours
  ]);

  const handleSaveDailyCustomization = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingDaily) return;

    if (!dailyDate) {
      setDailyFormError('Please select a date.');
      return;
    }
    if (dailyDate > todayStr) {
      setDailyFormError('Salary & attendance cannot be customized for future dates.');
      return;
    }

    const existing = attendanceByDate.get(dailyDate);
    const cfg = data.settings.salaryConfig;
    const parsedHours = dailyStatus === 'Present' ? Number(dailyHoursInput.trim()) : 0;
    const parsedBase = Number(dailyCustomBaseInput.trim());
    const parsedAddon =
      dailyCustomAddonInput.trim() === ''
        ? (existing?.addonSalary ?? cfg.addonSalary ?? 0)
        : Number(dailyCustomAddonInput.trim());
    const parsedExtraRate =
      dailyCustomExtraRateInput.trim() === ''
        ? (existing?.extraHourRate ?? cfg.extraHourRate ?? 100)
        : Number(dailyCustomExtraRateInput.trim());
    const parsedDirectEarned = Number(directEarnedSalaryInput.trim());

    if (dailyStatus === 'Present') {
      if (dailyHoursInput.trim() === '' || !Number.isFinite(parsedHours) || parsedHours < 0 || parsedHours > 24) {
        setDailyFormError('Working hours must be between 0 and 24.');
        return;
      }
      if (dailyCustomBaseInput.trim() === '' || !Number.isFinite(parsedBase) || parsedBase < 0) {
        setDailyFormError('Daily base salary must be zero or positive.');
        return;
      }
      if (
        (dailyCustomAddonEnabled && dailyCustomAddonInput.trim() === '') ||
        !Number.isFinite(parsedAddon) ||
        parsedAddon < 0
      ) {
        setDailyFormError('Add-on salary must be zero or positive.');
        return;
      }
      if (
        (dailyCustomOvertimeEnabled && dailyCustomExtraRateInput.trim() === '') ||
        !Number.isFinite(parsedExtraRate) ||
        parsedExtraRate < 0
      ) {
        setDailyFormError('Overtime rate must be zero or positive.');
        return;
      }
      if (
        useDirectEarnedOverride &&
        (directEarnedSalaryInput.trim() === '' || !Number.isFinite(parsedDirectEarned) || parsedDirectEarned < 0)
      ) {
        setDailyFormError('Custom earned salary must be zero or positive.');
        return;
      }
    }

    setDailyFormError(null);
    setIsSavingDaily(true);
    try {
      const preservedCheckTimes =
        existing &&
        dailyStatus === 'Present' &&
        existing.status === 'Present' &&
        Math.abs((existing.calculatedHours ?? 0) - parsedHours) < 0.01;

      await data.upsertAttendanceRecord({
        id: existing?.id,
        date: dailyDate,
        status: dailyStatus,
        checkInTime: preservedCheckTimes ? existing?.checkInTime : undefined,
        checkOutTime: preservedCheckTimes ? existing?.checkOutTime : undefined,
        breakDurationMinutes: preservedCheckTimes ? existing?.breakDurationMinutes : 0,
        calculatedHours: parsedHours,
        dailyBaseSalary: dailyStatus === 'Present' ? parsedBase : (existing?.dailyBaseSalary ?? cfg.dailyBaseSalary),
        addonSalary: dailyStatus === 'Present' ? parsedAddon : (existing?.addonSalary ?? cfg.addonSalary),
        addonEnabled: dailyStatus === 'Present' ? dailyCustomAddonEnabled : (existing?.addonEnabled ?? cfg.addonEnabled),
        extraHourRate: dailyStatus === 'Present' ? parsedExtraRate : (existing?.extraHourRate ?? cfg.extraHourRate),
        overtimeEnabled: dailyStatus === 'Present' ? dailyCustomOvertimeEnabled : (existing?.overtimeEnabled ?? cfg.overtimeEnabled),
        salaryOverrideEnabled: dailyStatus === 'Present' ? useDirectEarnedOverride : false,
        salaryOverrideAmount:
          dailyStatus === 'Present' && useDirectEarnedOverride ? parsedDirectEarned : undefined,
        notes: dailyNotes.trim()
      });

      setSelectedMonth(dailyDate.slice(0, 7));
      setIsDailyModalOpen(false);
      setDailyBannerMessage(`Saved custom salary details for ${formatHumanDate(dailyDate)}.`);
      setTimeout(() => setDailyBannerMessage(null), 4000);
    } catch (err) {
      setDailyFormError(err instanceof Error ? err.message : 'Failed to save daily salary customization.');
    } finally {
      setIsSavingDaily(false);
    }
  };

  const openPaymentModal = () => {
    setPaymentAmount(String(monthlySummary.remainingSalary > 0 ? monthlySummary.remainingSalary : monthlySummary.earnedSalary));
    setPaymentDate(todayStr);
    setPaymentNotes('');
    setIsSyncingToIncome(true);
    setAllowReplace(false);
    setPaymentError(null);
    setIsSubmittingPayment(false);
    setIsPaymentModalOpen(true);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingPayment) return;
    const parsedAmount = parseFloat(paymentAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setPaymentError('Please enter a valid salary payment amount greater than 0.');
      return;
    }

    const { periodStart, periodEnd } = getMonthDateBounds(selectedMonth);

    setPaymentError(null);
    setIsSubmittingPayment(true);
    try {
      await data.recordSalaryPayout({
        periodStart,
        periodEnd,
        amountPaid: parsedAmount,
        paidAt: paymentDate,
        notes: paymentNotes.trim() || `Salary payment for ${selectedMonth}`
      }, isSyncingToIncome, allowReplace);

      setIsPaymentModalOpen(false);
      setActiveTab('payments');
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Failed to record salary payment.');
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  const isRecordCustomized = (rec: AttendanceRecord): boolean => {
    if (rec.status !== 'Present') return false;
    const cfg = data.settings.salaryConfig;
    const baseDiffers =
      typeof rec.dailyBaseSalary === 'number' && Math.abs(rec.dailyBaseSalary - cfg.dailyBaseSalary) > 0.01;
    const addonFlagDiffers =
      typeof rec.addonEnabled === 'boolean' && rec.addonEnabled !== Boolean(cfg.addonEnabled);
    const addonDiffers =
      typeof rec.addonSalary === 'number' && Math.abs(rec.addonSalary - (cfg.addonSalary ?? 0)) > 0.01;
    const overtimeFlagDiffers =
      typeof rec.overtimeEnabled === 'boolean' && rec.overtimeEnabled !== Boolean(cfg.overtimeEnabled);
    const rateDiffers =
      typeof rec.extraHourRate === 'number' && Math.abs(rec.extraHourRate - cfg.extraHourRate) > 0.01;
    return (
      Boolean(rec.salaryOverrideEnabled) ||
      baseDiffers ||
      addonFlagDiffers ||
      addonDiffers ||
      overtimeFlagDiffers ||
      rateDiffers
    );
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-black/[0.06]">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-[#111111] tracking-tight">
            Daily Salary &amp; Earnings
          </h2>
          <p className="text-xs sm:text-sm text-neutral-500 font-normal mt-0.5">
            Track monthly earnings, customize individual day rates or bonuses, and record salary payouts.
          </p>
        </div>

        {/* View Tabs */}
        <div className="flex items-center gap-1 bg-neutral-100 p-1 rounded-xl self-start sm:self-auto border border-neutral-200/60 overflow-x-auto max-w-full">
          <button
            type="button"
            onClick={() => setActiveTab('summary')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'summary' ? 'bg-white text-[#111111] shadow-xs' : 'text-neutral-600 hover:text-black'
            }`}
          >
            Summary
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('daily')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'daily' ? 'bg-white text-[#111111] shadow-xs' : 'text-neutral-600 hover:text-black'
            }`}
          >
            Daily Ledger ({monthDailyRecords.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('payments')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'payments' ? 'bg-white text-[#111111] shadow-xs' : 'text-neutral-600 hover:text-black'
            }`}
          >
            Payouts ({monthPayouts.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'settings' ? 'bg-white text-[#111111] shadow-xs' : 'text-neutral-600 hover:text-black'
            }`}
          >
            Rate Settings
          </button>
        </div>
      </div>

      {/* MONTHLY SUMMARY TAB */}
      {activeTab === 'summary' && (
        <div className="space-y-6">
          {/* Month Selector */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-neutral-50 rounded-2xl border border-neutral-200">
            <div className="flex items-center gap-2">
              <Calculator className="w-4 h-4 text-[#8ECFFF]" />
              <span className="font-bold text-sm text-[#111111]">Daily Earnings Period</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                aria-label="Select salary month"
                className="px-3 py-1.5 text-xs font-mono font-semibold border border-neutral-300 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF]"
              />
              <button
                type="button"
                onClick={() => openDailyCustomizeModal()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white hover:bg-neutral-100 text-[#111111] border border-neutral-300 rounded-xl transition-colors cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5 text-[#0284C7]" />
                <span>Customize Daily Pay</span>
              </button>
            </div>
          </div>

          {/* Main Dashboard Summary Area */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* Prominent Dark Summary Panel */}
            <div className="p-5 rounded-2xl bg-[#111111] text-white flex flex-col justify-between space-y-4 shadow-xs">
              <div>
                <div className="flex items-center justify-between text-neutral-400">
                  <span className="text-[11px] font-semibold uppercase tracking-wider">Earned Salary ({selectedMonth})</span>
                  <span className="text-[11px] font-mono text-[#8ECFFF] tabular-nums">{monthlySummary.presentDays} days worked</span>
                </div>
                <div className="mt-3">
                  <div className="text-3xl font-extrabold font-mono tracking-tight text-white tabular-nums">
                    {formatCurrency(monthlySummary.earnedSalary, data.settings.currency)}
                  </div>
                  <p className="text-xs text-neutral-400 mt-1">
                    {monthlySummary.customizedDaysCount > 0
                      ? `Includes ${monthlySummary.customizedDaysCount} customized day${monthlySummary.customizedDaysCount > 1 ? 's' : ''}`
                      : 'Calculated from logged attendance & saved rates'}
                  </p>
                </div>
              </div>

              <button
                onClick={openPaymentModal}
                type="button"
                className="w-full py-2.5 bg-[#8ECFFF] text-[#111318] text-xs font-bold rounded-xl hover:bg-sky-300 transition-colors text-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white flex items-center justify-center gap-1.5"
              >
                <Banknote className="w-4 h-4" />
                <span>Record Salary Payout</span>
              </button>
            </div>

            {/* Key Metrics Grid */}
            <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
              <div className="p-4 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-1.5 shadow-xs">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase">Salary Received</span>
                <div className="text-2xl sm:text-3xl font-bold font-mono text-emerald-600 tabular-nums">
                  {formatCurrency(monthlySummary.salaryReceived, data.settings.currency)}
                </div>
                <span className="text-[11px] text-neutral-400">{monthPayouts.length} payout records</span>
              </div>

              <div className="p-4 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-1.5 shadow-xs">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase">Remaining Salary Due</span>
                <div className="text-2xl sm:text-3xl font-bold font-mono text-[#111111] tabular-nums">
                  {formatCurrency(monthlySummary.remainingSalary, data.settings.currency)}
                </div>
                <span className="text-[11px] text-neutral-400">Balance to be paid</span>
              </div>

              <div className="p-4 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-1.5 shadow-xs">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase">Total Hours &amp; Extra</span>
                <div className="text-2xl sm:text-3xl font-bold font-mono text-neutral-700 tabular-nums">
                  {monthlySummary.totalWorkingHours}h
                </div>
                <span className="text-[11px] text-neutral-400">Includes {monthlySummary.totalExtraHours}h extra hours</span>
              </div>
            </div>
          </div>

          {/* Breakdown & Config Info */}
          <div className="p-5 sm:p-6 rounded-2xl bg-white border border-black/[0.08] shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 pb-3">
              <h3 className="font-bold text-sm text-[#111111]">
                Attendance &amp; Extra Hours Breakdown
              </h3>
              <button
                type="button"
                onClick={() => setActiveTab('daily')}
                className="text-xs font-semibold text-[#0284C7] hover:underline cursor-pointer"
              >
                View Daily Ledger →
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
                <span className="text-[10px] font-semibold text-neutral-500 uppercase block">Present Days</span>
                <span className="text-xl font-bold font-mono text-[#111111] block tabular-nums">{monthlySummary.presentDays}</span>
                <span className="text-[10px] text-neutral-400">Logged days</span>
              </div>

              <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
                <span className="text-[10px] font-semibold text-neutral-500 uppercase block">Total Working Hours</span>
                <span className="text-xl font-bold font-mono text-[#111111] block tabular-nums">{monthlySummary.totalWorkingHours}h</span>
                <span className="text-[10px] text-neutral-400">Logged hours</span>
              </div>

              <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
                <span className="text-[10px] font-semibold text-neutral-500 uppercase block">Extra Hours</span>
                <span className="text-xl font-bold font-mono text-[#111111] block tabular-nums">{monthlySummary.totalExtraHours}h</span>
                <span className="text-[10px] text-neutral-400">Hours over {data.settings.salaryConfig.standardWorkingHours || 8}h/day</span>
              </div>

              <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
                <span className="text-[10px] font-semibold text-neutral-500 uppercase block">Leave / Absent</span>
                <span className="text-xl font-bold font-mono text-neutral-700 block tabular-nums">{monthlySummary.leaveDays + monthlySummary.absentDays}</span>
                <span className="text-[10px] text-neutral-400">{formatCurrency(0, data.settings.currency)} earned on off days</span>
              </div>
            </div>

            <div className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 text-xs space-y-1.5 font-mono">
              <span className="font-bold text-[#111111] block">Active Default Rate Formula:</span>
              <p className="text-neutral-700">
                • Present Day Base: {formatCurrency(data.settings.salaryConfig.dailyBaseSalary ?? 500, data.settings.currency)} for up to {data.settings.salaryConfig.standardWorkingHours || 8} hours.
              </p>
              <p className="text-neutral-700">
                • Daily Add-on:{' '}
                {data.settings.salaryConfig.addonEnabled
                  ? `+${formatCurrency(data.settings.salaryConfig.addonSalary ?? 0, data.settings.currency)}/day.`
                  : `Disabled (${formatCurrency(data.settings.salaryConfig.addonSalary ?? 0, data.settings.currency)} configured).`}
              </p>
              <p className="text-neutral-700">
                • Extra Hours:{' '}
                {data.settings.salaryConfig.overtimeEnabled !== false
                  ? `+${formatCurrency(data.settings.salaryConfig.extraHourRate ?? 100, data.settings.currency)}/hour for hours over ${data.settings.salaryConfig.standardWorkingHours || 8}h.`
                  : `Overtime calculation disabled (${formatCurrency(data.settings.salaryConfig.extraHourRate ?? 100, data.settings.currency)}/hr configured).`}
              </p>
              <p className="text-neutral-700">
                • Leave / Absent / Holiday: {formatCurrency(0, data.settings.currency)} (past daily snapshots &amp; overrides always remain preserved).
              </p>
            </div>
          </div>
        </div>
      )}

      {/* DAILY LEDGER & CUSTOMIZATION TAB */}
      {activeTab === 'daily' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-neutral-50 rounded-2xl border border-neutral-200">
            <div className="flex items-center gap-3">
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                aria-label="Filter daily ledger by month"
                className="px-3 py-1.5 text-xs font-mono font-semibold border border-neutral-300 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF]"
              />
              <span className="text-xs text-neutral-600 font-medium">
                {monthlySummary.customizedDaysCount > 0
                  ? `${monthlySummary.customizedDaysCount} customized day${monthlySummary.customizedDaysCount > 1 ? 's' : ''}`
                  : 'Using saved daily snapshots'}
              </span>
            </div>

            <button
              type="button"
              onClick={() => openDailyCustomizeModal()}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-[#111111] hover:bg-black text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer self-start sm:self-auto"
            >
              <Plus className="w-4 h-4 text-[#8ECFFF]" />
              <span>Customize / Add Day</span>
            </button>
          </div>

          {dailyBannerMessage && (
            <div className="p-3 rounded-xl bg-neutral-50 border border-neutral-200 text-xs text-neutral-800 flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{dailyBannerMessage}</span>
              </span>
              <button
                type="button"
                onClick={() => setDailyBannerMessage(null)}
                className="text-neutral-500 hover:text-[#111111] font-medium cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {monthDailyRecords.length === 0 ? (
            <EmptyState
              icon={Calculator}
              title="No daily salary entries for this month"
              description="Add or customize a specific day's working hours, daily base salary, overtime rate, or direct earned pay."
              actionLabel="Customize a Day"
              onAction={() => openDailyCustomizeModal()}
            />
          ) : (
            <>
              {/* Mobile Daily Cards (< 768px) */}
              <div className="md:hidden space-y-2.5">
                {monthDailyRecords.map((rec) => {
                  const customized = isRecordCustomized(rec);
                  return (
                    <div key={rec.id} className="p-4 rounded-2xl border border-black/[0.08] bg-white space-y-2.5 shadow-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="font-mono font-bold text-sm text-[#111111] block">
                            {formatHumanDate(rec.date)}
                          </span>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-neutral-100 text-neutral-800">
                              {rec.status}
                            </span>
                            {customized && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#EAF6FF] text-[#111318] border border-[#8ECFFF]/60">
                                Custom
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-base font-extrabold font-mono text-[#111111] tabular-nums block">
                            {formatCurrency(rec.dailyEarnedSalary || 0, data.settings.currency)}
                          </span>
                          {rec.status === 'Present' && (
                            <span className="text-[11px] font-mono text-neutral-500">
                              {rec.calculatedHours || 0}h {rec.extraHours ? `(+${rec.extraHours}h OT)` : ''}
                            </span>
                          )}
                        </div>
                      </div>

                      {rec.status === 'Present' && (
                        <div className="text-[11px] text-neutral-500 font-mono flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-neutral-100">
                          <span>Base: {formatCurrency(rec.dailyBaseSalary ?? data.settings.salaryConfig.dailyBaseSalary, data.settings.currency)}</span>
                          {rec.addonEnabled && (
                            <span>Add-on: +{formatCurrency(rec.addonSalary ?? 0, data.settings.currency)}</span>
                          )}
                          <span>
                            OT:{' '}
                            {rec.overtimeEnabled === false
                              ? 'Off'
                              : `${formatCurrency(rec.extraHourRate ?? data.settings.salaryConfig.extraHourRate, data.settings.currency)}/hr`}
                          </span>
                        </div>
                      )}

                      {rec.notes && (
                        <p className="text-xs text-neutral-600 bg-neutral-50 p-2 rounded-lg">
                          {rec.notes}
                        </p>
                      )}

                      <div className="pt-2 border-t border-neutral-100 flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openDailyCustomizeModal(rec.date)}
                          className="min-h-[36px] px-3 text-xs font-semibold text-[#111111] bg-neutral-100 hover:bg-neutral-200 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Customize</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteDailyError(null);
                            setDeleteDailyTargetId(rec.id);
                          }}
                          className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                          aria-label={`Delete record for ${rec.date}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Daily Ledger Table (>= 768px) */}
              <div className="hidden md:block bg-white rounded-2xl border border-black/[0.08] overflow-hidden shadow-xs">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-neutral-50/80 border-b border-black/[0.06] text-[11px] font-bold text-neutral-500 uppercase tracking-wider">
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-center">Hours (OT)</th>
                      <th className="py-3 px-4 text-right">Applied Rates</th>
                      <th className="py-3 px-4 text-right">Earned Salary</th>
                      <th className="py-3 px-4">Notes</th>
                      <th className="py-3 px-4 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.06] text-xs text-neutral-700">
                    {monthDailyRecords.map((rec) => {
                      const customized = isRecordCustomized(rec);
                      return (
                        <tr key={rec.id} className="hover:bg-neutral-50/70 transition-colors">
                          <td className="py-3 px-4 font-mono font-semibold text-[#111111] whitespace-nowrap">
                            {formatHumanDate(rec.date)}
                          </td>
                          <td className="py-3 px-4">
                            <div className="inline-flex items-center gap-1.5">
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-neutral-100 text-neutral-800">
                                {rec.status}
                              </span>
                              {customized && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#EAF6FF] text-[#111318] border border-[#8ECFFF]/60">
                                  Custom
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-center font-mono tabular-nums">
                            {rec.status === 'Present'
                              ? `${rec.calculatedHours || 0}h${rec.extraHours ? ` (+${rec.extraHours}h)` : ''}`
                              : '—'}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-neutral-500 tabular-nums whitespace-nowrap">
                            {rec.status === 'Present'
                              ? `${formatCurrency(rec.dailyBaseSalary ?? data.settings.salaryConfig.dailyBaseSalary, data.settings.currency)}${rec.addonEnabled ? ` + ${formatCurrency(rec.addonSalary ?? 0, data.settings.currency)}` : ''} · ${rec.overtimeEnabled === false ? 'OT Off' : `${formatCurrency(rec.extraHourRate ?? data.settings.salaryConfig.extraHourRate, data.settings.currency)}/h`}`
                              : '—'}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-[#111111] tabular-nums whitespace-nowrap">
                            {formatCurrency(rec.dailyEarnedSalary || 0, data.settings.currency)}
                          </td>
                          <td className="py-3 px-4 text-neutral-500 max-w-[200px] truncate">
                            {rec.notes || '—'}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openDailyCustomizeModal(rec.date)}
                                className="px-2.5 py-1 text-[11px] font-semibold text-[#111111] bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors cursor-pointer"
                              >
                                Customize
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setDeleteDailyError(null);
                                  setDeleteDailyTargetId(rec.id);
                                }}
                                className="p-1 text-neutral-400 hover:text-rose-600 cursor-pointer"
                                title="Delete Entry"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* PAYOUT HISTORY TAB */}
      {activeTab === 'payments' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-neutral-50 rounded-2xl border border-neutral-200 text-xs">
            <span className="font-semibold text-neutral-700">Period: {selectedMonth}</span>
            <button
              type="button"
              onClick={openPaymentModal}
              className="px-3 py-1.5 bg-[#111111] text-white font-semibold rounded-xl hover:bg-black cursor-pointer"
            >
              + Record Salary Payout
            </button>
          </div>

          {monthPayouts.length === 0 ? (
            <EmptyState
              icon={Banknote}
              title="No salary payments recorded for this month"
              description={`You have earned ${formatCurrency(monthlySummary.earnedSalary, data.settings.currency)} for ${selectedMonth}. Record a payout to update your received salary.`}
              actionLabel="Record Payout"
              onAction={openPaymentModal}
            />
          ) : (
            <>
              {/* Mobile Payout Cards (< 768px) */}
              <div className="md:hidden space-y-2.5">
                {monthPayouts.map((pay) => {
                  const isSynced = syncedPayoutIncomeIds.has(pay.id);
                  return (
                    <div key={pay.id} className="p-4 rounded-2xl border border-black/[0.08] bg-white space-y-2 shadow-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="font-mono font-bold text-sm text-[#111111] block">
                            {formatHumanDate(pay.paidAt)}
                          </span>
                          <span className="text-[11px] font-mono text-neutral-500">
                            {pay.periodStart} → {pay.periodEnd}
                          </span>
                        </div>
                        <span className="font-mono font-bold text-base text-emerald-600 tabular-nums">
                          {formatCurrency(pay.amountPaid, data.settings.currency)}
                        </span>
                      </div>

                      {pay.notes && (
                        <p className="text-xs text-neutral-600">{pay.notes}</p>
                      )}

                      <div className="pt-2 border-t border-neutral-100 flex items-center justify-between">
                        {isSynced ? (
                          <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-800 font-semibold">
                            Synced to Income
                          </span>
                        ) : (
                          <span className="text-neutral-400 text-[10px]">Unsynced</span>
                        )}
                        <button
                          type="button"
                          onClick={() => setDeleteTargetId(pay.id)}
                          className="p-1.5 text-neutral-400 hover:text-rose-600 cursor-pointer"
                          aria-label="Delete Payout"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Payouts Table (>= 768px) */}
              <div className="hidden md:block bg-white rounded-2xl border border-black/[0.08] overflow-hidden shadow-xs">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-neutral-50/80 border-b border-black/[0.06] text-[11px] font-bold text-neutral-500 uppercase tracking-wider">
                      <th className="py-3 px-4">Payment Date</th>
                      <th className="py-3 px-4">Period</th>
                      <th className="py-3 px-4 text-right">Amount Paid</th>
                      <th className="py-3 px-4">Notes</th>
                      <th className="py-3 px-4 text-center">Income Sync</th>
                      <th className="py-3 px-4 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.06] text-xs text-neutral-700">
                    {monthPayouts.map((pay) => {
                      const isSynced = syncedPayoutIncomeIds.has(pay.id);
                      return (
                        <tr key={pay.id} className="hover:bg-neutral-50/70 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-[#111111]">
                            {formatHumanDate(pay.paidAt)}
                          </td>
                          <td className="py-3 px-4 font-mono text-neutral-600">
                            {pay.periodStart} → {pay.periodEnd}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600 tabular-nums">
                            {formatCurrency(pay.amountPaid, data.settings.currency)}
                          </td>
                          <td className="py-3 px-4 text-neutral-600">
                            {pay.notes || 'Salary Payment'}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {isSynced ? (
                              <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-800 font-semibold">
                                Synced
                              </span>
                            ) : (
                              <span className="text-neutral-400 text-[10px]">Unsynced</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <button
                              type="button"
                              onClick={() => setDeleteTargetId(pay.id)}
                              className="p-1 text-neutral-400 hover:text-rose-600 cursor-pointer"
                              title="Delete Payout"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* RATE SETTINGS TAB */}
      {activeTab === 'settings' && (
        <form onSubmit={handleSaveSettings} className="p-5 sm:p-6 rounded-2xl bg-white border border-black/[0.08] shadow-xs space-y-5 max-w-2xl">
          <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-black/[0.06]">
            <div>
              <h3 className="font-bold text-base text-[#111111]">Daily Salary Rate Settings</h3>
              <p className="text-xs text-neutral-500 mt-0.5">
                Configure your default daily wage, duty hours, and overtime calculation rate.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {savedSettingsNotif && (
                <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> {savedSettingsNotif}
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setResetDefaultsError(null);
                  setIsResetDefaultsModalOpen(true);
                }}
                disabled={isSavingSettings || isResettingDefaults}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:text-[#111111] bg-neutral-50 hover:bg-neutral-100 border border-neutral-200 rounded-lg cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Defaults</span>
              </button>
            </div>
          </div>

          {settingsError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{settingsError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="salary-rate-base" className="block text-xs font-semibold text-neutral-700 mb-1">
                Daily Base Salary ({data.settings.currency})
              </label>
              <input
                id="salary-rate-base"
                type="number"
                required
                min="0"
                step="any"
                inputMode="decimal"
                value={dailyBaseSalaryInput}
                onChange={(e) => setDailyBaseSalaryInput(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF]"
              />
              <p className="text-[11px] text-neutral-500 mt-1">
                Earned for working standard daily hours.
              </p>
            </div>

            <div>
              <label htmlFor="salary-rate-hours" className="block text-xs font-semibold text-neutral-700 mb-1">
                Standard Duty Hours / Day
              </label>
              <input
                id="salary-rate-hours"
                type="number"
                required
                min="0.5"
                max="24"
                step="0.5"
                inputMode="decimal"
                value={standardWorkingHoursInput}
                onChange={(e) => setStandardWorkingHoursInput(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF]"
              />
              <p className="text-[11px] text-neutral-500 mt-1">
                Hours per day before overtime rate applies.
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="salary-rate-addon" className="block text-xs font-semibold text-neutral-700">
                  Daily Add-on Salary ({data.settings.currency})
                </label>
                <label className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={addonEnabled}
                    onChange={(e) => setAddonEnabled(e.target.checked)}
                    className="rounded border-neutral-300 text-[#111111] focus:ring-[#8ECFFF]"
                  />
                  <span>Enable Add-on</span>
                </label>
              </div>
              <input
                id="salary-rate-addon"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                disabled={!addonEnabled}
                value={addonSalaryInput}
                onChange={(e) => setAddonSalaryInput(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF] disabled:bg-neutral-50 disabled:text-neutral-400"
              />
              <p className="text-[11px] text-neutral-500 mt-1">
                {addonEnabled
                  ? 'Added to daily base salary on Present workdays.'
                  : 'Add-on salary disabled for new entries.'}
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="salary-rate-extra" className="block text-xs font-semibold text-neutral-700">
                  Extra-Hour Rate ({data.settings.currency}/hour)
                </label>
                <label className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={overtimeEnabled}
                    onChange={(e) => setOvertimeEnabled(e.target.checked)}
                    className="rounded border-neutral-300 text-[#111111] focus:ring-[#8ECFFF]"
                  />
                  <span>Enable Overtime Pay</span>
                </label>
              </div>
              <input
                id="salary-rate-extra"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                disabled={!overtimeEnabled}
                value={extraHourRateInput}
                onChange={(e) => setExtraHourRateInput(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF] disabled:bg-neutral-50 disabled:text-neutral-400"
              />
              <p className="text-[11px] text-neutral-500 mt-1">
                {overtimeEnabled
                  ? 'Additional rate paid per hour beyond standard daily duty hours.'
                  : 'Overtime calculation disabled for new entries.'}
              </p>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200/80 flex items-start gap-2.5 text-xs text-neutral-600">
            <ShieldCheck className="w-4 h-4 text-[#0284C7] shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              Saved daily entries preserve their historical rates and custom earnings. Updating these defaults affects future records only.
            </p>
          </div>

          <div className="pt-3 border-t border-neutral-100 flex items-center justify-end gap-2">
            {hasRateSettingsChanges && (
              <button
                type="button"
                onClick={handleCancelRateChanges}
                disabled={isSavingSettings}
                className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 border border-neutral-200 rounded-xl cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={isSavingSettings || !hasRateSettingsChanges}
              className="px-5 py-2 text-xs font-semibold bg-[#111111] text-white rounded-xl hover:bg-black transition-colors cursor-pointer disabled:opacity-50"
            >
              {isSavingSettings ? 'Saving...' : 'Save Rate Settings'}
            </button>
          </div>
        </form>
      )}

      {/* DAILY SALARY CUSTOMIZATION MODAL */}
      {isDailyModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40"
          onClick={() => { if (!isSavingDaily) setIsDailyModalOpen(false); }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="daily-salary-modal-title"
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-black/[0.08] p-5 sm:p-6 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-black/[0.06]">
              <div>
                <h3 id="daily-salary-modal-title" className="font-bold text-base text-[#111111]">
                  Customize Daily Salary
                </h3>
                <p className="text-xs text-neutral-500">
                  Adjust rates, hours, or final earned salary for a specific date.
                </p>
              </div>
              <button
                type="button"
                disabled={isSavingDaily}
                onClick={() => setIsDailyModalOpen(false)}
                className="p-1.5 text-neutral-400 hover:text-black cursor-pointer disabled:opacity-50"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {dailyFormError && (
              <div className="mt-3 p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{dailyFormError}</span>
              </div>
            )}

            <form onSubmit={handleSaveDailyCustomization} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="daily-custom-date" className="block text-xs font-semibold text-neutral-700 mb-1">
                    Date *
                  </label>
                  <input
                    id="daily-custom-date"
                    type="date"
                    required
                    max={todayStr}
                    value={dailyDate}
                    onChange={(e) => handleDailyDateChange(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF]"
                  />
                </div>
                <div>
                  <label htmlFor="daily-custom-status" className="block text-xs font-semibold text-neutral-700 mb-1">
                    Status *
                  </label>
                  <select
                    id="daily-custom-status"
                    value={dailyStatus}
                    onChange={(e) => setDailyStatus(e.target.value as AttendanceStatus)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF]"
                  >
                    <option value="Present">Present</option>
                    <option value="Absent">Absent</option>
                    <option value="Leave">Leave</option>
                    <option value="Holiday">Holiday</option>
                  </select>
                </div>
              </div>

              {dailyStatus === 'Present' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="daily-custom-hours" className="block text-xs font-semibold text-neutral-700 mb-1">
                        Hours Worked *
                      </label>
                      <input
                        id="daily-custom-hours"
                        type="number"
                        step="0.25"
                        min="0"
                        max="24"
                        required
                        value={dailyHoursInput}
                        onChange={(e) => setDailyHoursInput(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF]"
                      />
                    </div>
                    <div>
                      <label htmlFor="daily-custom-base" className="block text-xs font-semibold text-neutral-700 mb-1">
                        Day Base Salary ({data.settings.currency}) *
                      </label>
                      <input
                        id="daily-custom-base"
                        type="number"
                        step="any"
                        min="0"
                        required
                        value={dailyCustomBaseInput}
                        onChange={(e) => setDailyCustomBaseInput(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF]"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label htmlFor="daily-custom-addon" className="block text-xs font-semibold text-neutral-700">
                        Day Add-on Salary ({data.settings.currency})
                      </label>
                      <label className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={dailyCustomAddonEnabled}
                          onChange={(e) => setDailyCustomAddonEnabled(e.target.checked)}
                          className="rounded border-neutral-300 text-[#111111]"
                        />
                        <span>Add-on</span>
                      </label>
                    </div>
                    <input
                      id="daily-custom-addon"
                      type="number"
                      step="any"
                      min="0"
                      disabled={!dailyCustomAddonEnabled}
                      value={dailyCustomAddonInput}
                      onChange={(e) => setDailyCustomAddonInput(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF] disabled:bg-neutral-50 disabled:text-neutral-400"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label htmlFor="daily-custom-ot-rate" className="block text-xs font-semibold text-neutral-700">
                        Day Overtime Rate ({data.settings.currency}/hr)
                      </label>
                      <label className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={dailyCustomOvertimeEnabled}
                          onChange={(e) => setDailyCustomOvertimeEnabled(e.target.checked)}
                          className="rounded border-neutral-300 text-[#111111]"
                        />
                        <span>Overtime</span>
                      </label>
                    </div>
                    <input
                      id="daily-custom-ot-rate"
                      type="number"
                      step="any"
                      min="0"
                      disabled={!dailyCustomOvertimeEnabled}
                      value={dailyCustomExtraRateInput}
                      onChange={(e) => setDailyCustomExtraRateInput(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF] disabled:bg-neutral-50 disabled:text-neutral-400"
                    />
                  </div>

                  <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200 space-y-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-neutral-600">
                        Formula Pay ({dailyFormulaPreview.workingHours}h, {dailyFormulaPreview.extraHours}h OT)
                      </span>
                      <span className="font-mono font-bold text-[#111111]">
                        {formatCurrency(dailyFormulaPreview.dailyEarnedSalary, data.settings.currency)}
                      </span>
                    </div>

                    <label className="flex items-center gap-2 pt-2 border-t border-neutral-200 font-medium text-[#111111] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useDirectEarnedOverride}
                        onChange={(e) => {
                          setUseDirectEarnedOverride(e.target.checked);
                          if (e.target.checked && !directEarnedSalaryInput) {
                            setDirectEarnedSalaryInput(String(dailyFormulaPreview.dailyEarnedSalary));
                          }
                        }}
                        className="rounded border-neutral-300 text-[#111111]"
                      />
                      <span>Override final earned amount (bonus, add-on, or adjustment)</span>
                    </label>

                    {useDirectEarnedOverride && (
                      <div>
                        <label htmlFor="daily-direct-earned" className="block text-[11px] font-semibold text-neutral-700 mb-1">
                          Final Earned Salary for {dailyDate} ({data.settings.currency})
                        </label>
                        <input
                          id="daily-direct-earned"
                          type="number"
                          step="any"
                          min="0"
                          required
                          value={directEarnedSalaryInput}
                          onChange={(e) => setDirectEarnedSalaryInput(e.target.value)}
                          className="w-full px-3 py-2 text-sm font-mono bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF]"
                        />
                      </div>
                    )}
                  </div>
                </>
              )}

              <div>
                <label htmlFor="daily-custom-notes" className="block text-xs font-semibold text-neutral-700 mb-1">
                  Notes (Optional)
                </label>
                <input
                  id="daily-custom-notes"
                  type="text"
                  placeholder="e.g. Shift bonus +100 or holiday cover"
                  value={dailyNotes}
                  onChange={(e) => setDailyNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF]"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-neutral-100">
                <button
                  type="button"
                  disabled={isSavingDaily}
                  onClick={() => setIsDailyModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingDaily}
                  className="px-5 py-2 text-xs font-semibold bg-[#111111] text-white rounded-xl hover:bg-black transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSavingDaily ? 'Saving...' : 'Save Day Salary'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RECORD PAYMENT MODAL */}
      {isPaymentModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40"
          onClick={() => { if (!isSubmittingPayment) setIsPaymentModalOpen(false); }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-black/[0.08] p-5 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-black/[0.06]">
              <div>
                <h3 className="font-bold text-base text-[#111111]">Record Salary Payout</h3>
                <p className="text-xs text-neutral-500 font-mono">Period: {selectedMonth}</p>
              </div>
              <button
                type="button"
                disabled={isSubmittingPayment}
                onClick={() => setIsPaymentModalOpen(false)}
                className="p-1 text-neutral-400 hover:text-black cursor-pointer disabled:opacity-50"
              >
                ✕
              </button>
            </div>

            {paymentError && (
              <div className="mt-3 p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{paymentError}</span>
              </div>
            )}

            <form onSubmit={handleRecordPayment} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Payout Amount ({data.settings.currency}) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF]"
                />
                <p className="text-[11px] text-neutral-400 mt-1 font-mono">
                  Calculated earned: {formatCurrency(monthlySummary.earnedSalary, data.settings.currency)} · Remaining: {formatCurrency(monthlySummary.remainingSalary, data.settings.currency)}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Payment Date *
                </label>
                <input
                  type="date"
                  required
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Notes / Payment Reference (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Bank deposit reference"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF]"
                />
              </div>

              <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200 space-y-2">
                <label className="flex items-center gap-2 text-xs text-neutral-800 font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isSyncingToIncome}
                    onChange={(e) => setIsSyncingToIncome(e.target.checked)}
                    className="rounded text-[#111111] focus:ring-[#8ECFFF]"
                  />
                  <span>Automatically sync to Income Module</span>
                </label>

                {monthPayouts.length > 0 && (
                  <label className="flex items-center gap-2 text-xs text-neutral-700 font-medium cursor-pointer pt-1 border-t border-neutral-200">
                    <input
                      type="checkbox"
                      checked={allowReplace}
                      onChange={(e) => setAllowReplace(e.target.checked)}
                      className="rounded text-[#111111] focus:ring-[#8ECFFF]"
                    />
                    <span>Replace existing payout for {selectedMonth}</span>
                  </label>
                )}
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-neutral-100">
                <button
                  type="button"
                  disabled={isSubmittingPayment}
                  onClick={() => setIsPaymentModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingPayment}
                  className="px-5 py-2 text-xs font-semibold bg-[#111111] text-white rounded-xl hover:bg-black transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingPayment ? 'Saving...' : 'Record Salary Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Payout Confirmation */}
      <ConfirmDialog
        isOpen={deleteTargetId !== null}
        title="Delete Salary Payout"
        message="Are you sure you want to delete this payout entry? If synced to income, the corresponding income transaction will also be removed."
        confirmLabel="Delete Payout"
        isLoading={isDeletingPayout}
        error={deletePayoutError}
        onConfirm={async () => {
          if (!deleteTargetId || isDeletingPayout) return;
          setIsDeletingPayout(true);
          setDeletePayoutError(null);
          try {
            await data.deleteSalaryPayout(deleteTargetId);
            setDeleteTargetId(null);
          } catch (err) {
            setDeletePayoutError(err instanceof Error ? err.message : 'Failed to delete salary payout.');
          } finally {
            setIsDeletingPayout(false);
          }
        }}
        onCancel={() => {
          setDeletePayoutError(null);
          setDeleteTargetId(null);
        }}
      />

      {/* Delete Daily Entry Confirmation */}
      <ConfirmDialog
        isOpen={deleteDailyTargetId !== null}
        title="Delete Daily Salary Entry"
        message="Are you sure you want to remove this day's attendance and salary entry? Monthly earnings will recalculate automatically."
        confirmLabel="Delete Entry"
        isLoading={isDeletingDaily}
        error={deleteDailyError}
        onConfirm={async () => {
          if (!deleteDailyTargetId || isDeletingDaily) return;
          setIsDeletingDaily(true);
          setDeleteDailyError(null);
          try {
            await data.deleteAttendanceRecord(deleteDailyTargetId);
            setDeleteDailyTargetId(null);
          } catch (err) {
            setDeleteDailyError(err instanceof Error ? err.message : 'Failed to delete daily entry.');
          } finally {
            setIsDeletingDaily(false);
          }
        }}
        onCancel={() => {
          setDeleteDailyError(null);
          setDeleteDailyTargetId(null);
        }}
      />

      {/* Reset Salary Defaults Confirmation */}
      <ConfirmDialog
        isOpen={isResetDefaultsModalOpen}
        title="Reset Rate Settings to Defaults?"
        message="This restores default rates (500 daily base, 8 standard hours, 100/hr overtime). Past recorded daily salary entries will not change."
        confirmLabel="Restore Defaults"
        isDestructive={false}
        isLoading={isResettingDefaults}
        error={resetDefaultsError}
        onConfirm={handleConfirmResetDefaults}
        onCancel={() => {
          if (!isResettingDefaults) {
            setResetDefaultsError(null);
            setIsResetDefaultsModalOpen(false);
          }
        }}
      />
    </div>
  );
};
