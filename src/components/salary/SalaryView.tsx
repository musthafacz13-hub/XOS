import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Calculator,
  Plus,
  Trash2,
  Banknote,
  Check,
  AlertCircle,
  Edit3,
  ShieldCheck
} from 'lucide-react';
import { useXOSData } from '../../hooks/useXOSData';
import { AttendanceRecord, AttendanceStatus } from '../../types';
import {
  calculateDailyEarnedSalary,
  calculateMonthlySalarySummary,
  getMonthDateBounds,
  isSalaryConfigured,
  payoutMatchesMonth
} from '../../utils/calculations';
import { formatCurrency, formatHumanDate, getIstTodayString, getMonthString, getTodayString } from '../../utils/formatters';
import { EmptyState } from '../common/EmptyState';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { sanitizeDatabaseErrorMessage } from '../../utils/authValidation';
import {
  ActionIconButton,
  INPUT_CLASS,
  LABEL_CLASS,
  MONO_INPUT_CLASS,
  MetricCard,
  Modal,
  PRIMARY_BUTTON_CLASS,
  PageHeader,
  SECONDARY_BUTTON_CLASS,
  SELECT_CLASS,
  SUBTLE_BUTTON_CLASS,
  SectionCard,
  SegmentedControl
} from '../ui';

type SalaryTab = 'summary' | 'daily' | 'payments' | 'settings';

export const SalaryView: React.FC = () => {
  const data = useXOSData();
  const todayStr = getTodayString();
  const istTodayStr = getIstTodayString();

  const [activeTab, setActiveTab] = useState<SalaryTab>('summary');
  const [selectedMonth, setSelectedMonth] = useState(getMonthString());

  // Deletion targets
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeletingPayout, setIsDeletingPayout] = useState(false);
  const [deletePayoutError, setDeletePayoutError] = useState<string | null>(null);

  const [deleteDailyTargetId, setDeleteDailyTargetId] = useState<string | null>(null);
  const [isDeletingDaily, setIsDeletingDaily] = useState(false);
  const [deleteDailyError, setDeleteDailyError] = useState<string | null>(null);

  // Rate Settings form
  const [dailyBaseSalaryInput, setDailyBaseSalaryInput] = useState(() =>
    typeof data.settings.salaryConfig.dailyBaseSalary === 'number'
      ? String(data.settings.salaryConfig.dailyBaseSalary)
      : ''
  );
  const [addonSalaryInput, setAddonSalaryInput] = useState(() =>
    String(data.settings.salaryConfig.addonSalary ?? 0)
  );
  const [addonEnabled, setAddonEnabled] = useState(
    Boolean(data.settings.salaryConfig.addonEnabled)
  );
  const [standardWorkingHoursInput, setStandardWorkingHoursInput] = useState(() =>
    typeof data.settings.salaryConfig.standardWorkingHours === 'number'
      ? String(data.settings.salaryConfig.standardWorkingHours)
      : ''
  );
  const [extraHourRateInput, setExtraHourRateInput] = useState(() =>
    typeof data.settings.salaryConfig.extraHourRate === 'number'
      ? String(data.settings.salaryConfig.extraHourRate)
      : ''
  );
  const [overtimeEnabled, setOvertimeEnabled] = useState(
    Boolean(data.settings.salaryConfig.overtimeEnabled)
  );
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const isSavingSettingsRef = useRef(false);
  const [savedSettingsNotif, setSavedSettingsNotif] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // Daily Salary Customization Modal State
  const [isDailyModalOpen, setIsDailyModalOpen] = useState(false);
  const [dailyDate, setDailyDate] = useState(istTodayStr);
  const [dailyStatus, setDailyStatus] = useState<AttendanceStatus>('Present');
  const [dailyHoursInput, setDailyHoursInput] = useState(() =>
    typeof data.settings.salaryConfig.standardWorkingHours === 'number'
      ? String(data.settings.salaryConfig.standardWorkingHours)
      : ''
  );
  const [dailyCustomBaseInput, setDailyCustomBaseInput] = useState(() =>
    typeof data.settings.salaryConfig.dailyBaseSalary === 'number'
      ? String(data.settings.salaryConfig.dailyBaseSalary)
      : ''
  );
  const [dailyCustomAddonEnabled, setDailyCustomAddonEnabled] = useState(
    Boolean(data.settings.salaryConfig.addonEnabled)
  );
  const [dailyCustomAddonInput, setDailyCustomAddonInput] = useState(() =>
    String(data.settings.salaryConfig.addonSalary ?? 0)
  );
  const [dailyCustomOvertimeEnabled, setDailyCustomOvertimeEnabled] = useState(
    Boolean(data.settings.salaryConfig.overtimeEnabled)
  );
  const [dailyCustomExtraRateInput, setDailyCustomExtraRateInput] = useState(() =>
    typeof data.settings.salaryConfig.extraHourRate === 'number'
      ? String(data.settings.salaryConfig.extraHourRate)
      : ''
  );
  const [useDirectEarnedOverride, setUseDirectEarnedOverride] = useState(false);
  const [directEarnedSalaryInput, setDirectEarnedSalaryInput] = useState('');
  const [dailyNotes, setDailyNotes] = useState('');
  const [isSavingDaily, setIsSavingDaily] = useState(false);
  const isSavingDailyRef = useRef(false);
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
  const isSubmittingPaymentRef = useRef(false);

  useEffect(() => {
    setDailyBaseSalaryInput(
      typeof data.settings.salaryConfig.dailyBaseSalary === 'number'
        ? String(data.settings.salaryConfig.dailyBaseSalary)
        : ''
    );
    setAddonSalaryInput(String(data.settings.salaryConfig.addonSalary ?? 0));
    setAddonEnabled(Boolean(data.settings.salaryConfig.addonEnabled));
    setStandardWorkingHoursInput(
      typeof data.settings.salaryConfig.standardWorkingHours === 'number'
        ? String(data.settings.salaryConfig.standardWorkingHours)
        : ''
    );
    setExtraHourRateInput(
      typeof data.settings.salaryConfig.extraHourRate === 'number'
        ? String(data.settings.salaryConfig.extraHourRate)
        : ''
    );
    setOvertimeEnabled(Boolean(data.settings.salaryConfig.overtimeEnabled));
  }, [data.settings.salaryConfig]);

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
      ? 0
      : Number(addonSalaryInput.trim());
  const parsedSettingsHours = Number(standardWorkingHoursInput.trim());
  const parsedSettingsExtraRate =
    extraHourRateInput.trim() === ''
      ? (typeof data.settings.salaryConfig.extraHourRate === 'number' ? data.settings.salaryConfig.extraHourRate : 0)
      : Number(extraHourRateInput.trim());

  const hasRateSettingsChanges = useMemo(() => {
    const cfg = data.settings.salaryConfig;
    const savedConfigured = isSalaryConfigured(cfg);
    if (!savedConfigured) {
      return (
        dailyBaseSalaryInput.trim() !== '' ||
        standardWorkingHoursInput.trim() !== '' ||
        extraHourRateInput.trim() !== '' ||
        addonEnabled !== Boolean(cfg.addonEnabled) ||
        overtimeEnabled !== Boolean(cfg.overtimeEnabled) ||
        (addonSalaryInput.trim() !== '' && Number(addonSalaryInput.trim()) !== (cfg.addonSalary ?? 0))
      );
    }
    const savedOvertimeEnabled = Boolean(cfg.overtimeEnabled);
    return (
      dailyBaseSalaryInput.trim() === '' ||
      (addonEnabled && addonSalaryInput.trim() === '') ||
      standardWorkingHoursInput.trim() === '' ||
      (overtimeEnabled && extraHourRateInput.trim() === '') ||
      parsedSettingsBase !== cfg.dailyBaseSalary ||
      parsedSettingsAddon !== (cfg.addonSalary ?? 0) ||
      addonEnabled !== Boolean(cfg.addonEnabled) ||
      parsedSettingsHours !== cfg.standardWorkingHours ||
      parsedSettingsExtraRate !== (cfg.extraHourRate ?? 0) ||
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
    const cfg = data.settings.salaryConfig;
    setDailyBaseSalaryInput(typeof cfg.dailyBaseSalary === 'number' ? String(cfg.dailyBaseSalary) : '');
    setAddonSalaryInput(String(cfg.addonSalary ?? 0));
    setAddonEnabled(Boolean(cfg.addonEnabled));
    setStandardWorkingHoursInput(typeof cfg.standardWorkingHours === 'number' ? String(cfg.standardWorkingHours) : '');
    setExtraHourRateInput(typeof cfg.extraHourRate === 'number' ? String(cfg.extraHourRate) : '');
    setOvertimeEnabled(Boolean(cfg.overtimeEnabled));
    setSettingsError(null);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingSettingsRef.current || isSavingSettings) return;
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
      parsedSettingsHours < 0.5 ||
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

    isSavingSettingsRef.current = true;
    setIsSavingSettings(true);
    const updatedSalaryConfig = {
      currency: data.settings.currency || data.settings.salaryConfig.currency || 'INR',
      dailyBaseSalary: parsedSettingsBase,
      addonSalary: parsedSettingsAddon,
      addonEnabled,
      standardWorkingHours: parsedSettingsHours,
      extraHourRate: parsedSettingsExtraRate,
      overtimeEnabled,
      isConfigured: true
    };

    try {
      await data.persistSalaryConfig(updatedSalaryConfig);
      setSavedSettingsNotif('Saved');
      setTimeout(() => setSavedSettingsNotif(null), 3000);
    } catch (err) {
      setSettingsError(sanitizeDatabaseErrorMessage(err, 'Failed to save salary rate settings.'));
    } finally {
      isSavingSettingsRef.current = false;
      setIsSavingSettings(false);
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
          : Boolean(cfg.overtimeEnabled);
      const recHours = typeof existing.calculatedHours === 'number' ? existing.calculatedHours : cfg.standardWorkingHours;
      const formulaRes = calculateDailyEarnedSalary('Present', recHours ?? 0, {
        ...cfg,
        dailyBaseSalary: recBase,
        addonSalary: recAddon,
        addonEnabled: recAddonEnabled,
        extraHourRate: recRate,
        overtimeEnabled: recOvertimeEnabled
      });
      const hasOverrideFlag = existing.status === 'Present' && Boolean(existing.salaryOverrideEnabled);

      setDailyStatus(existing.status);
      setDailyHoursInput(typeof recHours === 'number' ? String(recHours) : '');
      setDailyCustomBaseInput(typeof recBase === 'number' ? String(recBase) : '');
      setDailyCustomAddonEnabled(recAddonEnabled);
      setDailyCustomAddonInput(String(recAddon));
      setDailyCustomOvertimeEnabled(recOvertimeEnabled);
      setDailyCustomExtraRateInput(typeof recRate === 'number' ? String(recRate) : '');
      setUseDirectEarnedOverride(hasOverrideFlag);
      setDirectEarnedSalaryInput(
        hasOverrideFlag
          ? String(existing.salaryOverrideAmount ?? existing.dailyEarnedSalary ?? formulaRes.dailyEarnedSalary)
          : String(formulaRes.dailyEarnedSalary)
      );
      setDailyNotes(existing.notes || '');
    } else {
      const defaultAddonEnabled = Boolean(cfg.addonEnabled);
      const defaultOvertimeEnabled = Boolean(cfg.overtimeEnabled);
      const defaultHours = typeof cfg.standardWorkingHours === 'number' ? cfg.standardWorkingHours : undefined;
      const defaultFormula =
        defaultHours !== undefined && isSalaryConfigured(cfg)
          ? calculateDailyEarnedSalary('Present', defaultHours, cfg)
          : null;

      setDailyStatus('Present');
      setDailyHoursInput(defaultHours !== undefined ? String(defaultHours) : '');
      setDailyCustomBaseInput(typeof cfg.dailyBaseSalary === 'number' ? String(cfg.dailyBaseSalary) : '');
      setDailyCustomAddonEnabled(defaultAddonEnabled);
      setDailyCustomAddonInput(String(cfg.addonSalary ?? 0));
      setDailyCustomOvertimeEnabled(defaultOvertimeEnabled);
      setDailyCustomExtraRateInput(typeof cfg.extraHourRate === 'number' ? String(cfg.extraHourRate) : '');
      setUseDirectEarnedOverride(false);
      setDirectEarnedSalaryInput(defaultFormula ? String(defaultFormula.dailyEarnedSalary) : '');
      setDailyNotes('');
    }
  };

  const openDailyCustomizeModal = (targetDate?: string) => {
    const currentIstToday = getIstTodayString();
    const fallbackDate = currentIstToday.startsWith(selectedMonth)
      ? currentIstToday
      : `${selectedMonth}-01` <= currentIstToday
      ? `${selectedMonth}-01`
      : currentIstToday;
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
        standardWorkingHours: data.settings.salaryConfig.standardWorkingHours,
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
    if (isSavingDailyRef.current || isSavingDaily) return;

    if (!dailyDate) {
      setDailyFormError('Please select a date.');
      return;
    }
    if (dailyDate > getIstTodayString()) {
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
        ? (existing?.extraHourRate ?? cfg.extraHourRate ?? 0)
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

    isSavingDailyRef.current = true;
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
      setDailyFormError(sanitizeDatabaseErrorMessage(err, 'Failed to save daily salary customization.'));
    } finally {
      isSavingDailyRef.current = false;
      setIsSavingDaily(false);
    }
  };

  const openPaymentModal = () => {
    setPaymentAmount(monthlySummary.remainingSalary > 0 ? String(monthlySummary.remainingSalary) : '');
    setPaymentDate(todayStr);
    setPaymentNotes('');
    setIsSyncingToIncome(true);
    setAllowReplace(false);
    setPaymentError(null);
    isSubmittingPaymentRef.current = false;
    setIsSubmittingPayment(false);
    setIsPaymentModalOpen(true);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingPaymentRef.current || isSubmittingPayment) return;
    const parsedAmount = parseFloat(paymentAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setPaymentError('Please enter a valid salary payment amount greater than 0.');
      return;
    }
    if (!paymentDate) {
      setPaymentError('Please select a payment date.');
      return;
    }

    const { periodStart, periodEnd } = getMonthDateBounds(selectedMonth);

    isSubmittingPaymentRef.current = true;
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
      setPaymentError(sanitizeDatabaseErrorMessage(err, 'Failed to record salary payment.'));
    } finally {
      isSubmittingPaymentRef.current = false;
      setIsSubmittingPayment(false);
    }
  };

  const isRecordCustomized = (rec: AttendanceRecord): boolean => {
    if (rec.status !== 'Present') return false;
    const cfg = data.settings.salaryConfig;
    const baseDiffers =
      typeof rec.dailyBaseSalary === 'number' &&
      (typeof cfg.dailyBaseSalary !== 'number'
        ? rec.dailyBaseSalary > 0
        : Math.abs(rec.dailyBaseSalary - cfg.dailyBaseSalary) > 0.01);
    const addonFlagDiffers =
      typeof rec.addonEnabled === 'boolean' && rec.addonEnabled !== Boolean(cfg.addonEnabled);
    const addonDiffers =
      typeof rec.addonSalary === 'number' && Math.abs(rec.addonSalary - (cfg.addonSalary ?? 0)) > 0.01;
    const overtimeFlagDiffers =
      typeof rec.overtimeEnabled === 'boolean' && rec.overtimeEnabled !== Boolean(cfg.overtimeEnabled);
    const rateDiffers =
      typeof rec.extraHourRate === 'number' &&
      (typeof cfg.extraHourRate !== 'number'
        ? rec.extraHourRate > 0
        : Math.abs(rec.extraHourRate - cfg.extraHourRate) > 0.01);
    return (
      Boolean(rec.salaryOverrideEnabled) ||
      baseDiffers ||
      addonFlagDiffers ||
      addonDiffers ||
      overtimeFlagDiffers ||
      rateDiffers
    );
  };

  const salaryConfigured = isSalaryConfigured(data.settings.salaryConfig);

  const tabOptions = useMemo(
    () => [
      { id: 'summary' as const, label: 'Summary' },
      { id: 'daily' as const, label: `Daily Ledger (${monthDailyRecords.length})` },
      { id: 'payments' as const, label: `Payouts (${monthPayouts.length})` },
      { id: 'settings' as const, label: 'Rate Settings' }
    ],
    [monthDailyRecords.length, monthPayouts.length]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Daily Salary & Earnings"
        description="Track monthly earnings, customize individual day rates or bonuses, and record salary payouts."
        actions={
          <SegmentedControl
            options={tabOptions}
            value={activeTab}
            onChange={setActiveTab}
            ariaLabel="Salary section views"
          />
        }
      />

      {/* MONTHLY SUMMARY TAB */}
      {activeTab === 'summary' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Calculator className="w-4 h-4 text-[#0284c7]" />
              <span className="text-sm font-medium text-[#1d1d1f]">Daily Earnings Period</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                aria-label="Select salary month"
                className="min-h-[40px] px-3 py-1.5 text-sm sm:text-xs font-mono font-medium border border-black/[0.12] rounded-xl bg-white focus:outline-none focus:border-[#0284c7] focus:ring-2 focus:ring-[#0284c7]/15"
              />
              <button
                type="button"
                onClick={() => openDailyCustomizeModal()}
                className={SECONDARY_BUTTON_CLASS}
              >
                <Edit3 className="w-3.5 h-3.5 text-[#0284c7]" />
                <span>Customize Daily Pay</span>
              </button>
              <button
                onClick={openPaymentModal}
                type="button"
                className={PRIMARY_BUTTON_CLASS}
              >
                <Banknote className="w-4 h-4" />
                <span>Record Payout</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <MetricCard
              variant="focal"
              label={`Earned Salary (${selectedMonth})`}
              value={formatCurrency(monthlySummary.earnedSalary, data.settings.currency)}
              sublabel={
                !salaryConfigured && monthlySummary.presentDays === 0
                  ? 'Configure rates in Rate Settings'
                  : monthlySummary.customizedDaysCount > 0
                    ? `${monthlySummary.presentDays} days · ${monthlySummary.customizedDaysCount} customized`
                    : `${monthlySummary.presentDays} present days`
              }
            />

            <MetricCard
              label="Salary Received"
              tone="positive"
              value={formatCurrency(monthlySummary.salaryReceived, data.settings.currency)}
              sublabel={`${monthPayouts.length} payout ${monthPayouts.length === 1 ? 'record' : 'records'}`}
            />

            <MetricCard
              label="Remaining Salary Due"
              value={
                !salaryConfigured && monthlySummary.presentDays === 0 && monthlySummary.earnedSalary === 0 && monthlySummary.salaryReceived === 0 ? (
                  <span className="text-lg font-medium text-[#6e6e73] font-sans">Not configured</span>
                ) : (
                  formatCurrency(monthlySummary.remainingSalary, data.settings.currency)
                )
              }
              sublabel={
                !salaryConfigured && monthlySummary.presentDays === 0 && monthlySummary.earnedSalary === 0 && monthlySummary.salaryReceived === 0
                  ? 'Set rates in Rate Settings'
                  : monthlySummary.overpaidAmount > 0
                    ? `Overpaid by ${formatCurrency(monthlySummary.overpaidAmount, data.settings.currency)}`
                    : 'Balance to be paid'
              }
            />

            <MetricCard
              label="Total Hours"
              value={`${monthlySummary.totalWorkingHours}h`}
              sublabel={`Includes ${monthlySummary.totalExtraHours}h extra hours`}
            />
          </div>

          <SectionCard
            title="Attendance & Extra Hours Breakdown"
            action={
              <button
                type="button"
                onClick={() => setActiveTab('daily')}
                className="text-xs font-medium text-[#0284c7] hover:underline cursor-pointer"
              >
                View Daily Ledger →
              </button>
            }
          >
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricCard
                  variant="subtle"
                  label="Present Days"
                  value={monthlySummary.presentDays}
                  sublabel="Logged workdays"
                />
                <MetricCard
                  variant="subtle"
                  label="Working Hours"
                  value={`${monthlySummary.totalWorkingHours}h`}
                  sublabel="Total logged"
                />
                <MetricCard
                  variant="subtle"
                  label="Extra Hours"
                  value={`${monthlySummary.totalExtraHours}h`}
                  sublabel={
                    typeof data.settings.salaryConfig.standardWorkingHours === 'number'
                      ? `Over ${data.settings.salaryConfig.standardWorkingHours}h/day`
                      : 'Standard hours unset'
                  }
                />
                <MetricCard
                  variant="subtle"
                  label="Leave / Absent"
                  value={monthlySummary.leaveDays + monthlySummary.absentDays}
                  sublabel={`${formatCurrency(0, data.settings.currency)} on off days`}
                />
              </div>

              <div className="p-4 bg-[#f5f5f7] rounded-2xl text-xs space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
                  <span className="font-semibold text-[#1d1d1f]">Active Default Rate Formula</span>
                  {!salaryConfigured && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('settings')}
                      className="text-xs font-medium text-[#0284c7] hover:underline cursor-pointer"
                    >
                      Configure Salary Rates →
                    </button>
                  )}
                </div>
                {salaryConfigured ? (
                  <div className="space-y-1 text-[#6e6e73] font-mono tabular-nums">
                    <p>
                      · Present Day Base: {formatCurrency(data.settings.salaryConfig.dailyBaseSalary ?? 0, data.settings.currency)} for up to {data.settings.salaryConfig.standardWorkingHours} hours.
                    </p>
                    <p>
                      · Daily Add-on:{' '}
                      {data.settings.salaryConfig.addonEnabled
                        ? `+${formatCurrency(data.settings.salaryConfig.addonSalary ?? 0, data.settings.currency)}/day.`
                        : `Disabled (${formatCurrency(data.settings.salaryConfig.addonSalary ?? 0, data.settings.currency)} configured).`}
                    </p>
                    <p>
                      · Extra Hours:{' '}
                      {data.settings.salaryConfig.overtimeEnabled
                        ? `+${formatCurrency(data.settings.salaryConfig.extraHourRate ?? 0, data.settings.currency)}/hour beyond ${data.settings.salaryConfig.standardWorkingHours}h.`
                        : `Overtime disabled (${formatCurrency(data.settings.salaryConfig.extraHourRate ?? 0, data.settings.currency)}/hr configured).`}
                    </p>
                    <p>
                      · Leave / Absent / Holiday: {formatCurrency(0, data.settings.currency)} (past snapshots &amp; overrides stay preserved).
                    </p>
                  </div>
                ) : (
                  <p className="text-[#6e6e73]">
                    Not configured yet. Open Rate Settings to define your daily base salary, standard working hours, and optional overtime or add-on rates.
                  </p>
                )}
              </div>
            </div>
          </SectionCard>
        </div>
      )}

      {/* DAILY LEDGER & CUSTOMIZATION TAB */}
      {activeTab === 'daily' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                aria-label="Filter daily ledger by month"
                className="min-h-[40px] px-3 py-1.5 text-sm sm:text-xs font-mono font-medium border border-black/[0.12] rounded-xl bg-white focus:outline-none focus:border-[#0284c7] focus:ring-2 focus:ring-[#0284c7]/15"
              />
              <span className="text-xs text-[#6e6e73]">
                {monthlySummary.customizedDaysCount > 0
                  ? `${monthlySummary.customizedDaysCount} customized day${monthlySummary.customizedDaysCount > 1 ? 's' : ''}`
                  : 'Using saved daily snapshots'}
              </span>
            </div>

            <button
              type="button"
              onClick={() => openDailyCustomizeModal()}
              className={PRIMARY_BUTTON_CLASS}
            >
              <Plus className="w-4 h-4" />
              <span>Customize / Add Day</span>
            </button>
          </div>

          {dailyBannerMessage && (
            <div className="p-3.5 rounded-2xl bg-[#f5f5f7] text-xs text-[#1d1d1f] flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{dailyBannerMessage}</span>
              </span>
              <button
                type="button"
                onClick={() => setDailyBannerMessage(null)}
                className="text-[#6e6e73] hover:text-[#1d1d1f] font-medium cursor-pointer"
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
              {/* Mobile Cards */}
              <div className="md:hidden divide-y divide-black/[0.06] bg-white rounded-2xl border border-black/[0.08] overflow-hidden">
                {monthDailyRecords.map((rec) => {
                  const customized = isRecordCustomized(rec);
                  return (
                    <div key={rec.id} className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="font-mono font-medium text-sm text-[#1d1d1f] block tabular-nums">
                            {formatHumanDate(rec.date)}
                          </span>
                          <span className="text-xs text-[#6e6e73] block mt-0.5">
                            {rec.status}
                            {customized ? ' · Custom' : ''}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-semibold font-mono text-[#1d1d1f] tabular-nums block">
                            {formatCurrency(rec.dailyEarnedSalary || 0, data.settings.currency)}
                          </span>
                          {rec.status === 'Present' && (
                            <span className="text-[11px] font-mono text-[#6e6e73] tabular-nums">
                              {rec.calculatedHours || 0}h{rec.extraHours ? ` (+${rec.extraHours}h OT)` : ''}
                            </span>
                          )}
                        </div>
                      </div>

                      {rec.status === 'Present' && (
                        <div className="text-xs text-[#6e6e73] font-mono tabular-nums flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span>Base {formatCurrency(rec.dailyBaseSalary ?? data.settings.salaryConfig.dailyBaseSalary ?? 0, data.settings.currency)}</span>
                          {rec.addonEnabled && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>Add-on +{formatCurrency(rec.addonSalary ?? 0, data.settings.currency)}</span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          <span>
                            OT {rec.overtimeEnabled === false ? 'Off' : `${formatCurrency(rec.extraHourRate ?? data.settings.salaryConfig.extraHourRate ?? 0, data.settings.currency)}/hr`}
                          </span>
                        </div>
                      )}

                      {rec.notes && (
                        <p className="text-xs text-[#6e6e73]">{rec.notes}</p>
                      )}

                      <div className="flex items-center justify-end gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={() => openDailyCustomizeModal(rec.date)}
                          className="min-h-[40px] px-3 text-xs font-medium text-[#1d1d1f] bg-[#f5f5f7] hover:bg-[#e8e8ed] rounded-xl inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Customize</span>
                        </button>
                        <ActionIconButton
                          icon={Trash2}
                          label={`Delete record for ${rec.date}`}
                          variant="delete"
                          onClick={() => {
                            setDeleteDailyError(null);
                            setDeleteDailyTargetId(rec.id);
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Table */}
              <div className="hidden md:block bg-white rounded-2xl border border-black/[0.08] overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#fbfbfd] border-b border-black/[0.06] text-[11px] font-medium text-[#6e6e73]">
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-center">Hours (OT)</th>
                      <th className="py-3 px-4 text-right">Applied Rates</th>
                      <th className="py-3 px-4 text-right">Earned Salary</th>
                      <th className="py-3 px-4">Notes</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.06] text-[13px] text-[#1d1d1f]">
                    {monthDailyRecords.map((rec) => {
                      const customized = isRecordCustomized(rec);
                      return (
                        <tr key={rec.id} className="hover:bg-[#f5f5f7]/60 transition-colors">
                          <td className="py-3 px-4 font-mono font-medium text-[#1d1d1f] whitespace-nowrap tabular-nums">
                            {formatHumanDate(rec.date)}
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-[#1d1d1f]">{rec.status}</span>
                            {customized && (
                              <span className="ml-1.5 text-xs font-medium text-[#0284c7]">· Custom</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center font-mono tabular-nums">
                            {rec.status === 'Present'
                              ? `${rec.calculatedHours || 0}h${rec.extraHours ? ` (+${rec.extraHours}h)` : ''}`
                              : '—'}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-xs text-[#6e6e73] tabular-nums whitespace-nowrap">
                            {rec.status === 'Present'
                              ? `${formatCurrency(rec.dailyBaseSalary ?? data.settings.salaryConfig.dailyBaseSalary ?? 0, data.settings.currency)}${rec.addonEnabled ? ` + ${formatCurrency(rec.addonSalary ?? 0, data.settings.currency)}` : ''} · ${rec.overtimeEnabled === false ? 'OT Off' : `${formatCurrency(rec.extraHourRate ?? data.settings.salaryConfig.extraHourRate ?? 0, data.settings.currency)}/h`}`
                              : '—'}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-semibold text-[#1d1d1f] tabular-nums whitespace-nowrap">
                            {formatCurrency(rec.dailyEarnedSalary || 0, data.settings.currency)}
                          </td>
                          <td className="py-3 px-4 text-[#6e6e73] max-w-[200px] truncate">
                            {rec.notes || '—'}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => openDailyCustomizeModal(rec.date)}
                                className="min-h-[34px] px-3 text-xs font-medium text-[#1d1d1f] bg-[#f5f5f7] hover:bg-[#e8e8ed] rounded-xl transition-colors cursor-pointer"
                              >
                                Customize
                              </button>
                              <ActionIconButton
                                icon={Trash2}
                                label="Delete entry"
                                variant="delete"
                                onClick={() => {
                                  setDeleteDailyError(null);
                                  setDeleteDailyTargetId(rec.id);
                                }}
                              />
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
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[#6e6e73] font-mono tabular-nums">Period: {selectedMonth}</span>
            <button
              type="button"
              onClick={openPaymentModal}
              className={PRIMARY_BUTTON_CLASS}
            >
              <Plus className="w-4 h-4" />
              <span>Record Salary Payout</span>
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
              {/* Mobile Cards */}
              <div className="md:hidden divide-y divide-black/[0.06] bg-white rounded-2xl border border-black/[0.08] overflow-hidden">
                {monthPayouts.map((pay) => {
                  const isSynced = syncedPayoutIncomeIds.has(pay.id);
                  return (
                    <div key={pay.id} className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="font-mono font-medium text-sm text-[#1d1d1f] block tabular-nums">
                            {formatHumanDate(pay.paidAt)}
                          </span>
                          <span className="text-xs font-mono text-[#6e6e73] tabular-nums">
                            {pay.periodStart} → {pay.periodEnd}
                          </span>
                        </div>
                        <span className="font-mono font-semibold text-base text-emerald-700 tabular-nums">
                          {formatCurrency(pay.amountPaid, data.settings.currency)}
                        </span>
                      </div>

                      {pay.notes && (
                        <p className="text-xs text-[#6e6e73]">{pay.notes}</p>
                      )}

                      <div className="flex items-center justify-between pt-1">
                        <span className={`text-xs font-medium ${isSynced ? 'text-emerald-700' : 'text-[#86868b]'}`}>
                          {isSynced ? 'Synced to Income' : 'Unsynced'}
                        </span>
                        <ActionIconButton
                          icon={Trash2}
                          label="Delete Payout"
                          variant="delete"
                          onClick={() => setDeleteTargetId(pay.id)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Table */}
              <div className="hidden md:block bg-white rounded-2xl border border-black/[0.08] overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#fbfbfd] border-b border-black/[0.06] text-[11px] font-medium text-[#6e6e73]">
                      <th className="py-3 px-4">Payment Date</th>
                      <th className="py-3 px-4">Period</th>
                      <th className="py-3 px-4 text-right">Amount Paid</th>
                      <th className="py-3 px-4">Notes</th>
                      <th className="py-3 px-4 text-center">Income Sync</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.06] text-[13px] text-[#1d1d1f]">
                    {monthPayouts.map((pay) => {
                      const isSynced = syncedPayoutIncomeIds.has(pay.id);
                      return (
                        <tr key={pay.id} className="hover:bg-[#f5f5f7]/60 transition-colors">
                          <td className="py-3 px-4 font-mono font-medium text-[#1d1d1f] tabular-nums">
                            {formatHumanDate(pay.paidAt)}
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-[#6e6e73] tabular-nums">
                            {pay.periodStart} → {pay.periodEnd}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-semibold text-emerald-700 tabular-nums">
                            {formatCurrency(pay.amountPaid, data.settings.currency)}
                          </td>
                          <td className="py-3 px-4 text-[#6e6e73]">
                            {pay.notes || 'Salary Payment'}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className={`text-xs font-medium ${isSynced ? 'text-emerald-700' : 'text-[#86868b]'}`}>
                              {isSynced ? 'Synced' : 'Unsynced'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <ActionIconButton
                              icon={Trash2}
                              label="Delete Payout"
                              variant="delete"
                              onClick={() => setDeleteTargetId(pay.id)}
                            />
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
        <SectionCard
          title="Daily Salary Rate Settings"
          subtitle="Configure your default daily wage, duty hours, and overtime calculation rate."
          action={
            <div className="flex items-center gap-2">
              {savedSettingsNotif && (
                <span className="text-xs text-emerald-700 font-medium flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> {savedSettingsNotif}
                </span>
              )}
              {!salaryConfigured && (
                <span className="text-xs font-medium text-[#86868b]">Not configured</span>
              )}
            </div>
          }
          className="max-w-2xl"
        >
          <form onSubmit={handleSaveSettings} className="space-y-5">
            {settingsError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{settingsError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="salary-rate-base" className={LABEL_CLASS}>
                  Daily Base Salary ({data.settings.currency})
                </label>
                <input
                  id="salary-rate-base"
                  type="number"
                  required
                  min="0"
                  step="any"
                  inputMode="decimal"
                  placeholder="Not configured"
                  value={dailyBaseSalaryInput}
                  onChange={(e) => setDailyBaseSalaryInput(e.target.value)}
                  className={MONO_INPUT_CLASS}
                />
                <p className="text-xs text-[#86868b] mt-1">
                  Earned for working standard daily hours.
                </p>
              </div>

              <div>
                <label htmlFor="salary-rate-hours" className={LABEL_CLASS}>
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
                  placeholder="Not configured"
                  value={standardWorkingHoursInput}
                  onChange={(e) => setStandardWorkingHoursInput(e.target.value)}
                  className={MONO_INPUT_CLASS}
                />
                <p className="text-xs text-[#86868b] mt-1">
                  Hours per day before overtime rate applies.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="salary-rate-addon" className="text-xs font-medium text-[#6e6e73]">
                    Daily Add-on Salary ({data.settings.currency})
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1d1d1f] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={addonEnabled}
                      onChange={(e) => setAddonEnabled(e.target.checked)}
                      className="rounded border-black/20 text-[#0284c7] focus:ring-[#0284c7]"
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
                  placeholder="0"
                  disabled={!addonEnabled}
                  value={addonSalaryInput}
                  onChange={(e) => setAddonSalaryInput(e.target.value)}
                  className={MONO_INPUT_CLASS}
                />
                <p className="text-xs text-[#86868b] mt-1">
                  {addonEnabled
                    ? 'Added to daily base salary on Present workdays.'
                    : 'Add-on salary disabled for new entries.'}
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="salary-rate-extra" className="text-xs font-medium text-[#6e6e73]">
                    Extra-Hour Rate ({data.settings.currency}/hour)
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1d1d1f] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={overtimeEnabled}
                      onChange={(e) => setOvertimeEnabled(e.target.checked)}
                      className="rounded border-black/20 text-[#0284c7] focus:ring-[#0284c7]"
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
                  placeholder="Not configured"
                  disabled={!overtimeEnabled}
                  value={extraHourRateInput}
                  onChange={(e) => setExtraHourRateInput(e.target.value)}
                  className={MONO_INPUT_CLASS}
                />
                <p className="text-xs text-[#86868b] mt-1">
                  {overtimeEnabled
                    ? 'Additional rate paid per hour beyond standard daily duty hours.'
                    : 'Overtime calculation disabled for new entries.'}
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-[#f5f5f7] flex items-start gap-2.5 text-xs text-[#6e6e73]">
              <ShieldCheck className="w-4 h-4 text-[#0284c7] shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                Saved daily entries preserve their historical rates and custom earnings. Updating these defaults affects future records only.
              </p>
            </div>

            <div className="pt-3 border-t border-black/[0.06] flex items-center justify-end gap-2">
              {hasRateSettingsChanges && (
                <button
                  type="button"
                  onClick={handleCancelRateChanges}
                  disabled={isSavingSettings}
                  className={SECONDARY_BUTTON_CLASS}
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={isSavingSettings || !hasRateSettingsChanges}
                className={PRIMARY_BUTTON_CLASS}
              >
                {isSavingSettings ? 'Saving…' : 'Save Rate Settings'}
              </button>
            </div>
          </form>
        </SectionCard>
      )}

      {/* DAILY SALARY CUSTOMIZATION MODAL */}
      <Modal
        isOpen={isDailyModalOpen}
        onClose={() => { if (!isSavingDaily) setIsDailyModalOpen(false); }}
        disableClose={isSavingDaily}
        maxWidth="md"
        labelledById="daily-salary-modal-title"
        title="Customize Daily Salary"
        subtitle="Adjust rates, hours, or final earned salary for a specific date."
        footer={
          <>
            <button
              type="button"
              disabled={isSavingDaily}
              onClick={() => setIsDailyModalOpen(false)}
              className={SECONDARY_BUTTON_CLASS}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="daily-salary-form"
              disabled={isSavingDaily}
              className={PRIMARY_BUTTON_CLASS}
            >
              {isSavingDaily ? 'Saving…' : 'Save Day Salary'}
            </button>
          </>
        }
      >
        {dailyFormError && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{dailyFormError}</span>
          </div>
        )}

        <form id="daily-salary-form" onSubmit={handleSaveDailyCustomization} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label htmlFor="daily-custom-date" className={LABEL_CLASS}>Date *</label>
              <input
                id="daily-custom-date"
                type="date"
                required
                max={istTodayStr}
                value={dailyDate}
                onChange={(e) => handleDailyDateChange(e.target.value)}
                className={MONO_INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="daily-custom-status" className={LABEL_CLASS}>Status *</label>
              <select
                id="daily-custom-status"
                value={dailyStatus}
                onChange={(e) => setDailyStatus(e.target.value as AttendanceStatus)}
                className={SELECT_CLASS}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label htmlFor="daily-custom-hours" className={LABEL_CLASS}>Hours Worked *</label>
                  <input
                    id="daily-custom-hours"
                    type="number"
                    step="0.25"
                    min="0"
                    max="24"
                    required
                    value={dailyHoursInput}
                    onChange={(e) => setDailyHoursInput(e.target.value)}
                    className={MONO_INPUT_CLASS}
                  />
                </div>
                <div>
                  <label htmlFor="daily-custom-base" className={LABEL_CLASS}>
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
                    className={MONO_INPUT_CLASS}
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="daily-custom-addon" className="text-xs font-medium text-[#6e6e73]">
                    Day Add-on Salary ({data.settings.currency})
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1d1d1f] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={dailyCustomAddonEnabled}
                      onChange={(e) => setDailyCustomAddonEnabled(e.target.checked)}
                      className="rounded border-black/20 text-[#0284c7]"
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
                  className={MONO_INPUT_CLASS}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="daily-custom-ot-rate" className="text-xs font-medium text-[#6e6e73]">
                    Day Overtime Rate ({data.settings.currency}/hr)
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1d1d1f] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={dailyCustomOvertimeEnabled}
                      onChange={(e) => setDailyCustomOvertimeEnabled(e.target.checked)}
                      className="rounded border-black/20 text-[#0284c7]"
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
                  className={MONO_INPUT_CLASS}
                />
              </div>

              <div className="p-3.5 bg-[#f5f5f7] rounded-2xl space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[#6e6e73]">
                    Formula Pay ({dailyFormulaPreview.workingHours}h, {dailyFormulaPreview.extraHours}h OT)
                  </span>
                  <span className="font-mono font-semibold text-[#1d1d1f] tabular-nums">
                    {formatCurrency(dailyFormulaPreview.dailyEarnedSalary, data.settings.currency)}
                  </span>
                </div>

                <label className="flex items-center gap-2 pt-2 border-t border-black/[0.06] font-medium text-[#1d1d1f] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useDirectEarnedOverride}
                    onChange={(e) => {
                      setUseDirectEarnedOverride(e.target.checked);
                      if (e.target.checked && !directEarnedSalaryInput) {
                        setDirectEarnedSalaryInput(String(dailyFormulaPreview.dailyEarnedSalary));
                      }
                    }}
                    className="rounded border-black/20 text-[#0284c7]"
                  />
                  <span>Override final earned amount (bonus, add-on, or adjustment)</span>
                </label>

                {useDirectEarnedOverride && (
                  <div>
                    <label htmlFor="daily-direct-earned" className={LABEL_CLASS}>
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
                      className={MONO_INPUT_CLASS}
                    />
                  </div>
                )}
              </div>
            </>
          )}

          <div>
            <label htmlFor="daily-custom-notes" className={LABEL_CLASS}>Notes (Optional)</label>
            <input
              id="daily-custom-notes"
              type="text"
              placeholder="e.g. Shift bonus +100 or holiday cover"
              value={dailyNotes}
              onChange={(e) => setDailyNotes(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        </form>
      </Modal>

      {/* RECORD PAYMENT MODAL */}
      <Modal
        isOpen={isPaymentModalOpen}
        onClose={() => { if (!isSubmittingPayment) setIsPaymentModalOpen(false); }}
        disableClose={isSubmittingPayment}
        maxWidth="md"
        title="Record Salary Payout"
        subtitle={`Period: ${selectedMonth}`}
        footer={
          <>
            <button
              type="button"
              disabled={isSubmittingPayment}
              onClick={() => setIsPaymentModalOpen(false)}
              className={SECONDARY_BUTTON_CLASS}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="salary-payout-form"
              disabled={isSubmittingPayment}
              className={PRIMARY_BUTTON_CLASS}
            >
              {isSubmittingPayment ? 'Saving…' : 'Record Salary Payment'}
            </button>
          </>
        }
      >
        {paymentError && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{paymentError}</span>
          </div>
        )}

        <form id="salary-payout-form" onSubmit={handleRecordPayment} className="space-y-4">
          <div>
            <label className={LABEL_CLASS}>Payout Amount ({data.settings.currency}) *</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              placeholder="0.00"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
              className={MONO_INPUT_CLASS}
            />
            <p className="text-xs text-[#6e6e73] mt-1 font-mono tabular-nums">
              Earned: {formatCurrency(monthlySummary.earnedSalary, data.settings.currency)} · Remaining: {formatCurrency(monthlySummary.remainingSalary, data.settings.currency)}
              {monthlySummary.overpaidAmount > 0
                ? ` · Overpaid: ${formatCurrency(monthlySummary.overpaidAmount, data.settings.currency)}`
                : ''}
            </p>
          </div>

          <div>
            <label className={LABEL_CLASS}>Payment Date *</label>
            <input
              type="date"
              required
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <label className={LABEL_CLASS}>Notes / Payment Reference (Optional)</label>
            <input
              type="text"
              placeholder="e.g. Bank deposit reference"
              value={paymentNotes}
              onChange={(e) => setPaymentNotes(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>

          <div className="p-3.5 bg-[#f5f5f7] rounded-2xl space-y-2.5">
            <label className="flex items-center gap-2 text-xs text-[#1d1d1f] font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={isSyncingToIncome}
                onChange={(e) => setIsSyncingToIncome(e.target.checked)}
                className="rounded border-black/20 text-[#0284c7]"
              />
              <span>Automatically sync to Income Module</span>
            </label>

            {monthPayouts.length > 0 && (
              <div className="space-y-1 pt-2 border-t border-black/[0.06]">
                <label className="flex items-center gap-2 text-xs text-[#1d1d1f] font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowReplace}
                    onChange={(e) => setAllowReplace(e.target.checked)}
                    className="rounded border-black/20 text-[#0284c7]"
                  />
                  <span>Replace existing payout for {selectedMonth}</span>
                </label>
                <p className="text-xs text-[#6e6e73] pl-6">
                  Only 1 payout slip per month is stored. Enabling replace overwrites the current{' '}
                  {formatCurrency(
                    monthPayouts.reduce((sum, p) => sum + (p.amountPaid || 0), 0),
                    data.settings.currency
                  )}{' '}
                  slip — enter the combined monthly total if adding another payment.
                </p>
              </div>
            )}
          </div>
        </form>
      </Modal>

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
            setDeletePayoutError(sanitizeDatabaseErrorMessage(err, 'Failed to delete salary payout.'));
          } finally {
            setIsDeletingPayout(false);
          }
        }}
        onCancel={() => {
          setDeletePayoutError(null);
          setDeleteTargetId(null);
        }}
      />

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
            setDeleteDailyError(sanitizeDatabaseErrorMessage(err, 'Failed to delete daily entry.'));
          } finally {
            setIsDeletingDaily(false);
          }
        }}
        onCancel={() => {
          setDeleteDailyError(null);
          setDeleteDailyTargetId(null);
        }}
      />
    </div>
  );
};
