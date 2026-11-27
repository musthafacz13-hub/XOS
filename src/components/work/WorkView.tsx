import React, { useState, useMemo, useRef } from 'react';
import { CalendarCheck, Plus, ChevronLeft, ChevronRight, Trash2, Edit3, AlertCircle } from 'lucide-react';
import { useXOSData } from '../../hooks/useXOSData';
import {
  AttendanceDayType,
  AttendanceRecord,
  AttendanceStatus,
  SelectableAttendanceStatus
} from '../../types';
import {
  calculateAttendanceStats,
  calculateDailyEarnedSalary,
  isSalaryConfigured,
  resolveAttendanceDayType,
  resolveAttendanceRecordSalary
} from '../../utils/calculations';
import { formatCurrency, formatHumanDate, getIstTodayString } from '../../utils/formatters';
import { EmptyState } from '../common/EmptyState';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { sanitizeDatabaseErrorMessage } from '../../utils/authValidation';
import {
  ActionIconButton,
  INPUT_CLASS,
  LABEL_CLASS,
  Modal,
  PRIMARY_BUTTON_CLASS,
  PageHeader,
  SECONDARY_BUTTON_CLASS,
  SELECT_CLASS,
  SectionCard,
  SegmentedControl
} from '../ui';

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

function formatAttendanceStatusLabel(rec: AttendanceRecord): string {
  if (rec.status === 'Present') {
    return resolveAttendanceDayType(rec) === 'half_day' ? 'Present · Half Day' : 'Present · Full Day';
  }
  if (rec.status === 'Leave') {
    return 'Leave (Legacy)';
  }
  return rec.status;
}

export const WorkView: React.FC = () => {
  const data = useXOSData();
  const salaryConfig = data.settings.salaryConfig;
  const currency = data.settings.currency;
  const salaryConfigured = isSalaryConfigured(salaryConfig);

  const todayStr = getIstTodayString();
  const [currentYear, setCurrentYear] = useState(() => Number(todayStr.slice(0, 4)));
  const [currentMonth, setCurrentMonth] = useState(() => Number(todayStr.slice(5, 7)) - 1);

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [date, setDate] = useState(todayStr);
  const [status, setStatus] = useState<SelectableAttendanceStatus>('Present');
  const [dayType, setDayType] = useState<AttendanceDayType>('full_day');
  const [notes, setNotes] = useState('');

  const currentMonthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
  const monthName = new Date(currentYear, currentMonth, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric'
  });

  const monthlyStats = useMemo(
    () => calculateAttendanceStats(data.attendance, currentMonthStr),
    [data.attendance, currentMonthStr]
  );

  const attendanceByDate = useMemo(
    () => new Map(data.attendance.map(r => [r.date, r])),
    [data.attendance]
  );

  const sortedAttendance = useMemo(
    () => [...data.attendance].sort((a, b) => b.date.localeCompare(a.date)),
    [data.attendance]
  );

  const applyRecordToForm = (existing: AttendanceRecord | null, targetDate: string) => {
    setEditingRecord(existing);
    setDate(targetDate);
    if (existing) {
      setStatus(existing.status === 'Leave' ? 'Absent' : existing.status);
      setDayType(resolveAttendanceDayType(existing));
      setNotes(existing.notes || '');
    } else {
      setStatus('Present');
      setDayType('full_day');
      setNotes('');
    }
  };

  const openLogModalForDate = (dStr: string) => {
    const currentIstToday = getIstTodayString();
    if (dStr > currentIstToday) {
      setPageError('Attendance cannot be logged for future dates.');
      return;
    }
    setPageError(null);
    setFormError(null);
    setIsSubmitting(false);
    applyRecordToForm(attendanceByDate.get(dStr) || null, dStr);
    setIsModalOpen(true);
  };

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const effectiveDailyRate =
    typeof editingRecord?.dailyBaseSalary === 'number'
      ? editingRecord.dailyBaseSalary
      : salaryConfig.dailyBaseSalary;

  const previewEarned = useMemo(
    () =>
      calculateDailyEarnedSalary(status, dayType, {
        dailyBaseSalary: effectiveDailyRate
      }).dailyEarnedSalary,
    [status, dayType, effectiveDailyRate]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || isSubmitting) return;
    const currentIstToday = getIstTodayString();
    if (date > currentIstToday) {
      setFormError('Attendance cannot be logged for future dates.');
      return;
    }

    const targetExisting = attendanceByDate.get(date) || null;
    isSubmittingRef.current = true;
    setFormError(null);
    setIsSubmitting(true);
    try {
      await data.upsertAttendanceRecord({
        id: targetExisting?.id,
        date,
        status,
        dayType: status === 'Present' ? dayType : undefined,
        dailyBaseSalary: targetExisting?.dailyBaseSalary,
        salaryOverrideEnabled: false,
        salaryOverrideAmount: undefined,
        notes: notes.trim()
      });

      setIsModalOpen(false);
    } catch (err) {
      setFormError(sanitizeDatabaseErrorMessage(err, 'Failed to save attendance record.'));
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleDelete = (id: string) => {
    setDeleteError(null);
    setDeleteTargetId(id);
  };

  const isMondayStart = data.settings.weekStartDay === 'Monday';

  const calendarCells = useMemo(() => {
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const rawFirstDayOfWeek = new Date(currentYear, currentMonth, 1).getDay();
    const leadingBlankCount = isMondayStart ? (rawFirstDayOfWeek + 6) % 7 : rawFirstDayOfWeek;

    const cells: (string | null)[] = [];
    for (let i = 0; i < leadingBlankCount; i++) {
      cells.push(null);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      cells.push(dStr);
    }
    return cells;
  }, [currentYear, currentMonth, isMondayStart]);

  const dayLabels = isMondayStart
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const todayRecord = attendanceByDate.get(todayStr);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Work & Attendance"
        description="Mark daily attendance as Present (Full Day or Half Day), Absent, or Holiday."
        actions={
          <button
            onClick={() => openLogModalForDate(todayStr)}
            type="button"
            className={PRIMARY_BUTTON_CLASS}
          >
            <Plus className="w-4 h-4" />
            <span>{todayRecord ? 'Update Today' : 'Mark Attendance'}</span>
          </button>
        }
      />

      {pageError && (
        <div className="p-3.5 bg-[#fef2f2] border border-[#c92a2a]/20 text-[#991b1b] text-xs rounded-2xl flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#c92a2a]" />
            <span>{pageError}</span>
          </div>
          <button
            type="button"
            onClick={() => setPageError(null)}
            className="text-[#991b1b] hover:text-[#1d1d1f] font-medium cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Today & Monthly Counters Stage */}
      <section aria-label="Attendance Summary" className="rounded-3xl bg-[#f5f5f7] p-4 sm:p-5">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
          <div className="lg:col-span-4 rounded-2xl p-5 bg-white border border-black/[0.06] flex flex-col justify-between gap-3">
            <div className="space-y-1.5">
              <span className="block text-[11px] font-medium text-[#6e6e73]">
                Today · <span className="font-mono tabular-nums">{todayStr}</span>
              </span>
              {todayRecord ? (
                <>
                  <div className={`text-xl font-semibold tracking-tight ${STATUS_TEXT_TONE[todayRecord.status]}`}>
                    {formatAttendanceStatusLabel(todayRecord)}
                  </div>
                  <p className="text-xs text-[#6e6e73] font-mono tabular-nums">
                    Earned: {formatCurrency(resolveAttendanceRecordSalary(todayRecord, salaryConfig).earnedSalary, currency)}
                  </p>
                </>
              ) : (
                <>
                  <div className="text-lg font-semibold text-[#1d1d1f]">Not marked</div>
                  <p className="text-xs text-[#6e6e73]">Mark today as Present, Absent, or Holiday.</p>
                </>
              )}
            </div>

            <button
              onClick={() => openLogModalForDate(todayStr)}
              type="button"
              className="w-full min-h-[40px] py-2 px-3.5 bg-[#1d1d1f] hover:bg-black text-white text-xs font-medium rounded-full transition-colors cursor-pointer"
            >
              {todayRecord ? 'Edit Today' : 'Mark Today'}
            </button>
          </div>

          <div className="lg:col-span-8 rounded-2xl bg-white border border-black/[0.06] grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-black/[0.06] overflow-hidden">
            <div className="p-4 sm:p-5 flex flex-col justify-between gap-1">
              <span className="text-xs font-medium text-[#6e6e73]">Full Days</span>
              <div className="text-2xl font-semibold font-mono tabular-nums text-[#1d1d1f]">
                {monthlyStats.fullDays}
              </div>
              <span className="text-[11px] text-[#86868b]">100% daily salary</span>
            </div>

            <div className="p-4 sm:p-5 flex flex-col justify-between gap-1">
              <span className="text-xs font-medium text-[#6e6e73]">Half Days</span>
              <div className="text-2xl font-semibold font-mono tabular-nums text-[#1d1d1f]">
                {monthlyStats.halfDays}
              </div>
              <span className="text-[11px] text-[#86868b]">50% daily salary</span>
            </div>

            <div className="p-4 sm:p-5 flex flex-col justify-between gap-1">
              <span className="text-xs font-medium text-[#6e6e73]">Absent</span>
              <div className="text-2xl font-semibold font-mono tabular-nums text-[#1d1d1f]">
                {monthlyStats.absentDays}
              </div>
              <span className="text-[11px] text-[#86868b]">
                {monthlyStats.leaveDays > 0 ? `+ ${monthlyStats.leaveDays} legacy leave` : 'Unpaid absent days'}
              </span>
            </div>

            <div className="p-4 sm:p-5 flex flex-col justify-between gap-1">
              <span className="text-xs font-medium text-[#6e6e73]">Holidays</span>
              <div className="text-2xl font-semibold font-mono tabular-nums text-[#1d1d1f]">
                {monthlyStats.holidayDays}
              </div>
              <span className="text-[11px] text-[#86868b]">{monthName}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Monthly Attendance Calendar */}
      <SectionCard
        title={`${monthName} Calendar`}
        action={
          <div className="flex items-center gap-1.5">
            <button
              onClick={handlePrevMonth}
              type="button"
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl border border-black/[0.08] bg-white hover:bg-[#f5f5f7] transition-colors text-[#1d1d1f] cursor-pointer"
              aria-label="Previous month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-medium text-[#1d1d1f] font-mono px-2 tabular-nums hidden sm:inline">
              {monthName}
            </span>
            <button
              onClick={handleNextMonth}
              type="button"
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl border border-black/[0.08] bg-white hover:bg-[#f5f5f7] transition-colors text-[#1d1d1f] cursor-pointer"
              aria-label="Next month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-medium text-[#86868b] mb-2">
          {dayLabels.map(label => (
            <div key={label}>{label}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
          {calendarCells.map((dStr, idx) => {
            if (!dStr) {
              return <div key={`blank_${idx}`} className="h-12 sm:h-16 bg-[#fbfbfd] rounded-xl" />;
            }

            const dayNum = parseInt(dStr.split('-')[2], 10);
            const rec = attendanceByDate.get(dStr);
            const isToday = dStr === todayStr;
            const isFuture = dStr > todayStr;

            const calendarLabel = rec
              ? rec.status === 'Present'
                ? resolveAttendanceDayType(rec) === 'half_day'
                  ? 'Half Day'
                  : 'Full Day'
                : rec.status
              : '';

            return (
              <button
                key={dStr}
                onClick={() => openLogModalForDate(dStr)}
                disabled={isFuture}
                type="button"
                className={`h-12 sm:h-16 p-1.5 sm:p-2 rounded-xl border text-left flex flex-col justify-between transition-colors ${
                  isFuture
                    ? 'border-black/[0.04] bg-[#fbfbfd] text-[#d2d2d7] cursor-not-allowed'
                    : isToday
                      ? 'ring-2 ring-[#0071e3] border-[#0071e3] bg-[#e8f2ff]/60 cursor-pointer'
                      : 'border-black/[0.07] hover:border-black/20 hover:bg-[#f5f5f7]/60 bg-white cursor-pointer'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className={`text-[11px] sm:text-xs font-semibold font-mono tabular-nums ${isToday ? 'text-[#0071e3]' : isFuture ? 'text-[#86868b]' : 'text-[#1d1d1f]'}`}>
                    {dayNum}
                  </span>
                </div>

                {rec ? (
                  <span className={`text-[9px] sm:text-[10px] font-medium block truncate ${STATUS_TEXT_TONE[rec.status]}`}>
                    {calendarLabel}
                  </span>
                ) : (
                  <span className="hidden sm:block text-[10px] text-[#86868b] opacity-0 hover:opacity-100">
                    + Log
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </SectionCard>

      {/* Attendance Log */}
      {data.attendance.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          iconName="attendance"
          title="No attendance records yet"
          description="Mark daily attendance as Present (Full Day or Half Day), Absent, or Holiday to track your monthly salary."
          actionLabel="Mark Today's Attendance"
          onAction={() => openLogModalForDate(todayStr)}
        />
      ) : (
        <>
          {/* Mobile List */}
          <div className="md:hidden divide-y divide-black/[0.06] bg-white rounded-2xl border border-black/[0.08] overflow-hidden">
            {sortedAttendance.map((rec) => {
              const resolved = resolveAttendanceRecordSalary(rec, salaryConfig);
              return (
                <div key={rec.id} className="cv-auto p-4 space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono font-medium text-sm text-[#1d1d1f] tabular-nums">
                      {formatHumanDate(rec.date)}
                    </span>
                    <span className={`text-xs font-medium ${STATUS_TEXT_TONE[rec.status]}`}>
                      {formatAttendanceStatusLabel(rec)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-[#6e6e73] font-mono tabular-nums">
                    <span>
                      {rec.status === 'Present'
                        ? resolved.dayType === 'half_day'
                          ? '50% daily pay'
                          : '100% daily pay'
                        : 'Unpaid day'}
                    </span>
                    <span className="font-semibold text-[#1d1d1f]">
                      {formatCurrency(resolved.earnedSalary, currency)}
                    </span>
                  </div>

                  {rec.notes && (
                    <p className="text-xs text-[#6e6e73] leading-relaxed">{rec.notes}</p>
                  )}

                  <div className="flex items-center justify-end gap-1 -mr-1 pt-1">
                    <ActionIconButton
                      icon={Edit3}
                      label="Edit attendance"
                      variant="edit"
                      onClick={() => openLogModalForDate(rec.date)}
                    />
                    <ActionIconButton
                      icon={Trash2}
                      label="Delete attendance"
                      variant="delete"
                      onClick={() => handleDelete(rec.id)}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Table */}
          <SectionCard title="Attendance Log" padding="none" className="hidden md:block overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#fbfbfd] border-b border-black/[0.06] text-[11px] font-medium text-[#6e6e73]">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Day Type</th>
                  <th className="py-3 px-4 text-right">Earned</th>
                  <th className="py-3 px-4">Notes</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06] text-[13px] text-[#1d1d1f]">
                {sortedAttendance.map((rec) => {
                  const resolved = resolveAttendanceRecordSalary(rec, salaryConfig);
                  return (
                    <tr key={rec.id} className="hover:bg-[#f5f5f7]/60 transition-colors">
                      <td className="py-3 px-4 font-mono font-medium text-[#1d1d1f] tabular-nums">
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
                      <td className="py-3 px-4 text-right font-mono font-semibold text-[#1d1d1f] tabular-nums">
                        {formatCurrency(resolved.earnedSalary, currency)}
                      </td>
                      <td className="py-3 px-4 text-[#6e6e73]">
                        {rec.notes || '—'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-0.5">
                          <ActionIconButton
                            icon={Edit3}
                            label="Edit attendance"
                            variant="edit"
                            onClick={() => openLogModalForDate(rec.date)}
                          />
                          <ActionIconButton
                            icon={Trash2}
                            label="Delete attendance"
                            variant="delete"
                            onClick={() => handleDelete(rec.id)}
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

      {/* Modal Attendance Logger */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => { if (!isSubmitting) setIsModalOpen(false); }}
        disableClose={isSubmitting}
        maxWidth="md"
        title={editingRecord ? 'Edit Attendance Record' : 'Mark Attendance'}
        subtitle="Select attendance status and day type."
        footer={
          <>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => setIsModalOpen(false)}
              className={SECONDARY_BUTTON_CLASS}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="attendance-form"
              disabled={isSubmitting}
              className={PRIMARY_BUTTON_CLASS}
            >
              {isSubmitting ? 'Saving…' : 'Save Record'}
            </button>
          </>
        }
      >
        <form id="attendance-form" onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="p-3 bg-[#fef2f2] border border-[#c92a2a]/20 text-[#991b1b] text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-[#c92a2a]" />
              <span>{formError}</span>
            </div>
          )}

          {editingRecord?.status === 'Leave' && (
            <div className="p-3 bg-[#fefce8] border border-[#a16207]/20 text-[#854d0e] text-xs rounded-xl">
              Legacy Leave record — saving will update this entry to Present, Absent, or Holiday.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className={LABEL_CLASS}>Date</label>
              <input
                type="date"
                required
                max={todayStr}
                value={date}
                onChange={(e) => {
                  const nextDate = e.target.value;
                  applyRecordToForm(attendanceByDate.get(nextDate) || null, nextDate);
                }}
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className={LABEL_CLASS}>Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as SelectableAttendanceStatus)}
                className={SELECT_CLASS}
              >
                <option value="Present">Present</option>
                <option value="Absent">Absent</option>
                <option value="Holiday">Holiday</option>
              </select>
            </div>
          </div>

          {status === 'Present' && (
            <div className="space-y-2.5 p-3.5 bg-[#f5f5f7] rounded-2xl">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#6e6e73]">Day Type</span>
                <span className="text-xs font-mono font-semibold text-[#1d1d1f] tabular-nums">
                  {salaryConfigured || typeof effectiveDailyRate === 'number'
                    ? formatCurrency(previewEarned, currency)
                    : 'Set Daily Salary in Settings'}
                </span>
              </div>
              <SegmentedControl
                options={DAY_TYPE_OPTIONS}
                value={dayType}
                onChange={setDayType}
                ariaLabel="Attendance day type"
                fullWidth
                size="md"
              />
              <p className="text-[11px] text-[#6e6e73]">
                {dayType === 'full_day' ? 'Full Day earns 100% of daily salary.' : 'Half Day earns 50% of daily salary.'}
              </p>
            </div>
          )}

          {status !== 'Present' && (
            <div className="p-3 bg-[#f5f5f7] rounded-xl text-xs text-[#6e6e73] flex items-center justify-between">
              <span>Earned for {status}</span>
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
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={deleteTargetId !== null}
        title="Delete Attendance Record"
        message="Are you sure you want to delete this attendance entry? Monthly salary and attendance totals will update automatically."
        confirmLabel="Delete Record"
        isLoading={isDeleting}
        error={deleteError}
        onConfirm={async () => {
          if (!deleteTargetId || isDeleting) return;
          setIsDeleting(true);
          setDeleteError(null);
          try {
            await data.deleteAttendanceRecord(deleteTargetId);
            setDeleteTargetId(null);
          } catch (err) {
            setDeleteError(sanitizeDatabaseErrorMessage(err, 'Failed to delete attendance record.'));
          } finally {
            setIsDeleting(false);
          }
        }}
        onCancel={() => {
          setDeleteError(null);
          setDeleteTargetId(null);
        }}
      />
    </div>
  );
};
