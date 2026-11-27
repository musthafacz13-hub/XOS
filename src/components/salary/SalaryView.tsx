import React, { useState, useMemo, useRef } from 'react';
import { Calculator, Plus, Trash2, Check, AlertCircle, Edit3 } from 'lucide-react';
import { useXOSData } from '../../hooks/useXOSData';
import {
  AttendanceDayType,
  AttendanceRecord,
  AttendanceStatus,
  SelectableAttendanceStatus
} from '../../types';
import {
  calculateDailyEarnedSalary,
  calculateMonthlySalarySummary,
  isSalaryConfigured,
  resolveAttendanceDayType,
  resolveAttendanceRecordSalary
} from '../../utils/calculations';
import { formatCurrency, formatHumanDate, getIstTodayString, getMonthString } from '../../utils/formatters';
import { EmptyState } from '../common/EmptyState';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { sanitizeDatabaseErrorMessage } from '../../utils/authValidation';
import {
  ActionIconButton,
  INPUT_CLASS,
  LABEL_CLASS,
  MetricCard,
  Modal,
  PRIMARY_BUTTON_CLASS,
  PageHeader,
  SECONDARY_BUTTON_CLASS,
  SELECT_CLASS,
  SectionCard,
  SegmentedControl
} from '../ui';

type SalaryTab = 'summary' | 'daily';

const STATUS_TEXT_TONE: Record<AttendanceStatus, string> = {
  Present: 'text-[#1f7a4c]',
  Absent: 'text-[#c92a2a]',
  Leave: 'text-[#a16207]',
  Holiday: 'text-[#0071e3]'
};

const DAY_TYPE_OPTIONS: { id: AttendanceDayType; label: string }[] = [
  { id: 'full_day', label: 'Full Day' },
  { id: 'half_day', label: 'Half Day' }
];

export const SalaryView: React.FC = () => {
  const data = useXOSData();
  const istTodayStr = getIstTodayString();
  const salaryConfig = data.settings.salaryConfig;
  const currency = data.settings.currency;

  const [activeTab, setActiveTab] = useState<SalaryTab>('summary');
  const [selectedMonth, setSelectedMonth] = useState(getMonthString());

  // Delete daily entry state
  const [deleteDailyTargetId, setDeleteDailyTargetId] = useState<string | null>(null);
  const [isDeletingDaily, setIsDeletingDaily] = useState(false);
  const [deleteDailyError, setDeleteDailyError] = useState<string | null>(null);

  // Add / Edit Day modal state
  const [isDailyModalOpen, setIsDailyModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [dailyDate, setDailyDate] = useState(istTodayStr);
  const [dailyStatus, setDailyStatus] = useState<SelectableAttendanceStatus>('Present');
  const [dailyDayType, setDailyDayType] = useState<AttendanceDayType>('full_day');
  const [dailyNotes, setDailyNotes] = useState('');
  const [isSavingDaily, setIsSavingDaily] = useState(false);
  const isSavingDailyRef = useRef(false);
  const [dailyFormError, setDailyFormError] = useState<string | null>(null);
  const [dailyBannerMessage, setDailyBannerMessage] = useState<string | null>(null);

  const attendanceByDate = useMemo(
    () => new Map(data.attendance.map(r => [r.date, r])),
    [data.attendance]
  );

  const monthDailyRecords = useMemo(
    () =>
      data.attendance
        .filter(r => typeof r.date === 'string' && r.date.startsWith(selectedMonth))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [data.attendance, selectedMonth]
  );

  const monthlySummary = useMemo(
    () =>
      calculateMonthlySalarySummary(
        data.attendance,
        data.salaryPayouts,
        salaryConfig,
        selectedMonth
      ),
    [data.attendance, data.salaryPayouts, salaryConfig, selectedMonth]
  );

  const salaryConfigured = isSalaryConfigured(salaryConfig);

  const loadDayIntoModal = (targetDate: string, existing?: AttendanceRecord) => {
    setEditingRecord(existing || null);
    setDailyDate(targetDate);
    setDailyFormError(null);
    if (existing) {
      setDailyStatus(existing.status === 'Leave' ? 'Absent' : existing.status);
      setDailyDayType(resolveAttendanceDayType(existing));
      setDailyNotes(existing.notes || '');
    } else {
      setDailyStatus('Present');
      setDailyDayType('full_day');
      setDailyNotes('');
    }
  };

  const openDailyModal = (targetDate?: string) => {
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

  const modalApplicableRate =
    typeof editingRecord?.dailyBaseSalary === 'number'
      ? editingRecord.dailyBaseSalary
      : salaryConfig.dailyBaseSalary;

  const modalPreviewEarned = useMemo(
    () =>
      calculateDailyEarnedSalary(dailyStatus, dailyDayType, {
        dailyBaseSalary: modalApplicableRate
      }).dailyEarnedSalary,
    [dailyStatus, dailyDayType, modalApplicableRate]
  );

  const handleSaveDailyEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingDailyRef.current || isSavingDaily) return;

    if (!dailyDate) {
      setDailyFormError('Please select a date.');
      return;
    }
    if (dailyDate > getIstTodayString()) {
      setDailyFormError('Attendance cannot be logged for future dates.');
      return;
    }

    const existing = attendanceByDate.get(dailyDate);
    isSavingDailyRef.current = true;
    setDailyFormError(null);
    setIsSavingDaily(true);

    try {
      await data.upsertAttendanceRecord({
        id: existing?.id,
        date: dailyDate,
        status: dailyStatus,
        dayType: dailyStatus === 'Present' ? dailyDayType : undefined,
        dailyBaseSalary: existing?.dailyBaseSalary,
        salaryOverrideEnabled: false,
        salaryOverrideAmount: undefined,
        notes: dailyNotes.trim()
      });

      setSelectedMonth(dailyDate.slice(0, 7));
      setIsDailyModalOpen(false);
      setDailyBannerMessage(`Saved attendance & salary for ${formatHumanDate(dailyDate)}.`);
      setTimeout(() => setDailyBannerMessage(null), 4000);
    } catch (err) {
      setDailyFormError(sanitizeDatabaseErrorMessage(err, 'Failed to save attendance entry.'));
    } finally {
      isSavingDailyRef.current = false;
      setIsSavingDaily(false);
    }
  };

  const tabOptions = useMemo(
    () => [
      { id: 'summary' as const, label: 'Summary' },
      { id: 'daily' as const, label: `Daily (${monthDailyRecords.length})` }
    ],
    [monthDailyRecords.length]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Salary"
        description="Monthly earnings calculated directly from your saved attendance records."
        actions={
          <SegmentedControl
            options={tabOptions}
            value={activeTab}
            onChange={setActiveTab}
            ariaLabel="Salary section views"
          />
        }
      />

      {/* SUMMARY TAB */}
      {activeTab === 'summary' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Calculator className="w-4 h-4 text-[#0071e3]" />
              <span className="text-sm font-medium text-[#1d1d1f]">Monthly Period</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                aria-label="Select salary month"
                className="min-h-[40px] px-3 py-1.5 text-sm sm:text-xs font-mono font-medium border border-black/[0.12] rounded-xl bg-white focus:outline-none focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/15"
              />
              <button
                type="button"
                onClick={() => openDailyModal()}
                className={PRIMARY_BUTTON_CLASS}
              >
                <Plus className="w-4 h-4" />
                <span>Add Day</span>
              </button>
            </div>
          </div>

          <section aria-label="Monthly Salary Summary" className="rounded-3xl bg-[#f5f5f7] p-4 sm:p-5 space-y-4">
            <div className="rounded-2xl bg-white border border-black/[0.06] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <span className="text-xs font-medium text-[#6e6e73]">
                  Total Earned ({selectedMonth})
                </span>
                <div className="text-[32px] font-semibold font-mono tabular-nums tracking-[-0.025em] text-[#1d1d1f]">
                  {formatCurrency(monthlySummary.earnedSalary, currency)}
                </div>
                <p className="text-xs text-[#6e6e73]">
                  {salaryConfigured
                    ? `Daily Salary: ${formatCurrency(salaryConfig.dailyBaseSalary ?? 0, currency)} · Full Day 100% / Half Day 50%`
                    : 'Set your Daily Salary in Settings → Finance Settings'}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setActiveTab('daily')}
                className={`${SECONDARY_BUTTON_CLASS} self-start sm:self-center`}
              >
                View Daily Entries →
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricCard
                label="Full Days"
                value={monthlySummary.fullDays}
                sublabel="100% daily salary"
              />
              <MetricCard
                label="Half Days"
                value={monthlySummary.halfDays}
                sublabel="50% daily salary"
              />
              <MetricCard
                label="Absent Days"
                value={monthlySummary.absentDays}
                sublabel={formatCurrency(0, currency)}
              />
              <MetricCard
                label="Holiday Days"
                value={monthlySummary.holidayDays}
                sublabel={formatCurrency(0, currency)}
              />
            </div>

            {monthlySummary.leaveDays > 0 && (
              <p className="text-xs text-[#6e6e73] px-1">
                Includes {monthlySummary.leaveDays} legacy Leave {monthlySummary.leaveDays === 1 ? 'record' : 'records'} from earlier logs.
              </p>
            )}
          </section>
        </div>
      )}

      {/* DAILY TAB */}
      {activeTab === 'daily' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                aria-label="Filter daily entries by month"
                className="min-h-[40px] px-3 py-1.5 text-sm sm:text-xs font-mono font-medium border border-black/[0.12] rounded-xl bg-white focus:outline-none focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/15"
              />
              <span className="text-xs text-[#6e6e73] font-mono tabular-nums">
                Total: {formatCurrency(monthlySummary.earnedSalary, currency)}
              </span>
            </div>

            <button
              type="button"
              onClick={() => openDailyModal()}
              className={PRIMARY_BUTTON_CLASS}
            >
              <Plus className="w-4 h-4" />
              <span>Add Day</span>
            </button>
          </div>

          {dailyBannerMessage && (
            <div className="p-3.5 rounded-2xl bg-[#f5f5f7] text-xs text-[#1d1d1f] flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Check className="w-4 h-4 text-[#1f7a4c] shrink-0" />
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
              iconName="salary"
              title="No daily entries for this month"
              description="Add a day's attendance to record Full Day, Half Day, Absent, or Holiday salary earnings."
              actionLabel="Add Day"
              onAction={() => openDailyModal()}
            />
          ) : (
            <>
              {/* Mobile List */}
              <div className="md:hidden divide-y divide-black/[0.06] bg-white rounded-2xl border border-black/[0.08] overflow-hidden">
                {monthDailyRecords.map((rec) => {
                  const resolved = resolveAttendanceRecordSalary(rec, salaryConfig);
                  const dayTypeLabel =
                    rec.status === 'Present'
                      ? resolved.dayType === 'half_day'
                        ? 'Half Day'
                        : 'Full Day'
                      : '—';
                  return (
                    <div key={rec.id} className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="font-mono font-medium text-sm text-[#1d1d1f] block tabular-nums">
                            {formatHumanDate(rec.date)}
                          </span>
                          <span className={`text-xs font-medium block mt-0.5 ${STATUS_TEXT_TONE[rec.status]}`}>
                            {rec.status === 'Leave' ? 'Leave (Legacy)' : rec.status}
                            {rec.status === 'Present' ? ` · ${dayTypeLabel}` : ''}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-semibold font-mono text-[#1d1d1f] tabular-nums block">
                            {formatCurrency(resolved.earnedSalary, currency)}
                          </span>
                          {typeof rec.dailyBaseSalary === 'number' && rec.status === 'Present' && (
                            <span className="text-[11px] font-mono text-[#6e6e73] tabular-nums">
                              Rate {formatCurrency(rec.dailyBaseSalary, currency)}/day
                            </span>
                          )}
                        </div>
                      </div>

                      {rec.notes && (
                        <p className="text-xs text-[#6e6e73]">{rec.notes}</p>
                      )}

                      <div className="flex items-center justify-end gap-1.5 pt-1">
                        <ActionIconButton
                          icon={Edit3}
                          label={`Edit record for ${rec.date}`}
                          variant="edit"
                          onClick={() => openDailyModal(rec.date)}
                        />
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
              <SectionCard title="Daily Attendance & Salary" padding="none" className="hidden md:block overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#fbfbfd] border-b border-black/[0.06] text-[11px] font-medium text-[#6e6e73]">
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Day Type</th>
                      <th className="py-3 px-4 text-right">Daily Salary</th>
                      <th className="py-3 px-4 text-right">Earned</th>
                      <th className="py-3 px-4">Notes</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.06] text-[13px] text-[#1d1d1f]">
                    {monthDailyRecords.map((rec) => {
                      const resolved = resolveAttendanceRecordSalary(rec, salaryConfig);
                      const rateSnapshot =
                        typeof rec.dailyBaseSalary === 'number'
                          ? rec.dailyBaseSalary
                          : (salaryConfig.dailyBaseSalary ?? 0);
                      return (
                        <tr key={rec.id} className="hover:bg-[#f5f5f7]/60 transition-colors">
                          <td className="py-3 px-4 font-mono font-medium text-[#1d1d1f] whitespace-nowrap tabular-nums">
                            {formatHumanDate(rec.date)}
                          </td>
                          <td className={`py-3 px-4 font-medium ${STATUS_TEXT_TONE[rec.status]}`}>
                            {rec.status === 'Leave' ? 'Leave (Legacy)' : rec.status}
                          </td>
                          <td className="py-3 px-4 text-[#6e6e73]">
                            {rec.status === 'Present'
                              ? resolved.dayType === 'half_day'
                                ? 'Half Day'
                                : 'Full Day'
                              : '—'}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-xs text-[#6e6e73] tabular-nums whitespace-nowrap">
                            {rec.status === 'Present' ? formatCurrency(rateSnapshot, currency) : '—'}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-semibold text-[#1d1d1f] tabular-nums whitespace-nowrap">
                            {formatCurrency(resolved.earnedSalary, currency)}
                          </td>
                          <td className="py-3 px-4 text-[#6e6e73]">
                            {rec.notes || '—'}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex items-center justify-end gap-0.5">
                              <ActionIconButton
                                icon={Edit3}
                                label={`Edit record for ${rec.date}`}
                                variant="edit"
                                onClick={() => openDailyModal(rec.date)}
                              />
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
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </SectionCard>
            </>
          )}
        </div>
      )}

      {/* Add / Edit Day Modal */}
      <Modal
        isOpen={isDailyModalOpen}
        onClose={() => { if (!isSavingDaily) setIsDailyModalOpen(false); }}
        disableClose={isSavingDaily}
        maxWidth="md"
        title={editingRecord ? 'Edit Daily Entry' : 'Add Day'}
        subtitle="Select attendance status and day type for this date."
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
              {isSavingDaily ? 'Saving…' : 'Save Day'}
            </button>
          </>
        }
      >
        <form id="daily-salary-form" onSubmit={handleSaveDailyEntry} className="space-y-4">
          {dailyFormError && (
            <div className="p-3 bg-[#fef2f2] border border-[#c92a2a]/20 text-[#991b1b] text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-[#c92a2a]" />
              <span>{dailyFormError}</span>
            </div>
          )}

          {editingRecord?.status === 'Leave' && (
            <div className="p-3 bg-[#fefce8] border border-[#a16207]/20 text-[#854d0e] text-xs rounded-xl">
              Legacy Leave record — saving updates it to Present, Absent, or Holiday.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className={LABEL_CLASS}>Date</label>
              <input
                type="date"
                required
                max={istTodayStr}
                value={dailyDate}
                onChange={(e) => {
                  const nextDate = e.target.value;
                  loadDayIntoModal(nextDate, attendanceByDate.get(nextDate));
                }}
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className={LABEL_CLASS}>Status</label>
              <select
                value={dailyStatus}
                onChange={(e) => setDailyStatus(e.target.value as SelectableAttendanceStatus)}
                className={SELECT_CLASS}
              >
                <option value="Present">Present</option>
                <option value="Absent">Absent</option>
                <option value="Holiday">Holiday</option>
              </select>
            </div>
          </div>

          {dailyStatus === 'Present' && (
            <div className="p-3.5 bg-[#f5f5f7] rounded-2xl space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#6e6e73]">Day Type</span>
                <span className="text-xs font-mono font-semibold text-[#1d1d1f] tabular-nums">
                  {salaryConfigured || typeof modalApplicableRate === 'number'
                    ? formatCurrency(modalPreviewEarned, currency)
                    : 'Set Daily Salary in Settings'}
                </span>
              </div>
              <SegmentedControl
                options={DAY_TYPE_OPTIONS}
                value={dailyDayType}
                onChange={setDailyDayType}
                ariaLabel="Daily salary day type"
                fullWidth
                size="md"
              />
            </div>
          )}

          {dailyStatus !== 'Present' && (
            <div className="p-3 bg-[#f5f5f7] rounded-xl text-xs text-[#6e6e73] flex items-center justify-between">
              <span>Earned for {dailyStatus}</span>
              <span className="font-mono font-semibold text-[#1d1d1f] tabular-nums">
                {formatCurrency(0, currency)}
              </span>
            </div>
          )}

          <div>
            <label className={LABEL_CLASS}>Notes</label>
            <input
              type="text"
              placeholder="Optional note"
              value={dailyNotes}
              onChange={(e) => setDailyNotes(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={deleteDailyTargetId !== null}
        title="Delete Daily Entry"
        message="Are you sure you want to delete this attendance and salary entry? Monthly salary totals will update automatically."
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
            setDeleteDailyError(sanitizeDatabaseErrorMessage(err, 'Failed to delete entry.'));
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
