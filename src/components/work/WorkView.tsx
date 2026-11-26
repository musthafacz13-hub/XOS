import React, { useState, useMemo, useRef } from 'react';
import { CalendarCheck, Plus, ChevronLeft, ChevronRight, Trash2, Edit3, AlertCircle } from 'lucide-react';
import { useXOSData } from '../../hooks/useXOSData';
import { AttendanceRecord, AttendanceStatus } from '../../types';
import { calculateAttendanceStats } from '../../utils/calculations';
import {
  formatHumanDate,
  getIstTodayString,
  calculateWorkingHours,
  getShiftSpanMinutes,
  isOvernightShift
} from '../../utils/formatters';
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
  SectionCard
} from '../ui';

const STATUS_TEXT_TONE: Record<AttendanceStatus, string> = {
  Present: 'text-[#1f7a4c]',
  Absent: 'text-[#c92a2a]',
  Leave: 'text-[#a16207]',
  Holiday: 'text-[#0071e3]'
};

export const WorkView: React.FC = () => {
  const data = useXOSData();

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
  const [status, setStatus] = useState<AttendanceStatus>('Present');
  const [checkInTime, setCheckInTime] = useState('');
  const [checkOutTime, setCheckOutTime] = useState('');
  const [breakDurationMinutes, setBreakDurationMinutes] = useState('');
  const [notes, setNotes] = useState('');

  const currentMonthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
  const monthName = new Date(currentYear, currentMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const monthlyStats = useMemo(
    () =>
      calculateAttendanceStats(
        data.attendance,
        currentMonthStr,
        data.settings.salaryConfig.standardWorkingHours
      ),
    [data.attendance, currentMonthStr, data.settings.salaryConfig.standardWorkingHours]
  );

  const attendanceByDate = useMemo(
    () => new Map(data.attendance.map(r => [r.date, r])),
    [data.attendance]
  );

  const sortedAttendance = useMemo(
    () => [...data.attendance].sort((a, b) => b.date.localeCompare(a.date)),
    [data.attendance]
  );

  const openLogModalForDate = (dStr: string) => {
    const currentIstToday = getIstTodayString();
    if (dStr > currentIstToday) {
      setPageError('Attendance cannot be logged for future dates.');
      return;
    }
    setPageError(null);
    setFormError(null);
    setIsSubmitting(false);
    const existing = attendanceByDate.get(dStr);
    if (existing) {
      setEditingRecord(existing);
      setDate(existing.date);
      setStatus(existing.status);
      setCheckInTime(existing.checkInTime || '');
      setCheckOutTime(existing.checkOutTime || '');
      setBreakDurationMinutes(
        typeof existing.breakDurationMinutes === 'number' ? String(existing.breakDurationMinutes) : ''
      );
      setNotes(existing.notes || '');
    } else {
      setEditingRecord(null);
      setDate(dStr);
      setStatus('Present');
      setCheckInTime('');
      setCheckOutTime('');
      setBreakDurationMinutes('');
      setNotes('');
    }
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || isSubmitting) return;
    const currentIstToday = getIstTodayString();
    if (date > currentIstToday) {
      setFormError('Attendance cannot be logged for future dates.');
      return;
    }
    let hours = 0;
    const rawBreak = breakDurationMinutes.trim();
    const parsedBreak = status === 'Present' ? (rawBreak === '' ? 0 : Number(rawBreak)) : 0;
    if (status === 'Present') {
      if (!checkInTime || !checkOutTime) {
        setFormError('Please enter both Check-In and Check-Out times.');
        return;
      }
      if (!Number.isFinite(parsedBreak) || parsedBreak < 0) {
        setFormError('Break duration must be zero or a positive number.');
        return;
      }
      const shiftMins = getShiftSpanMinutes(checkInTime, checkOutTime);
      if (parsedBreak >= shiftMins) {
        setFormError('Break duration must be shorter than total shift duration.');
        return;
      }
      hours = calculateWorkingHours(checkInTime, checkOutTime, parsedBreak);
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
        checkInTime: status === 'Present' ? checkInTime : undefined,
        checkOutTime: status === 'Present' ? checkOutTime : undefined,
        breakDurationMinutes: status === 'Present' ? parsedBreak : 0,
        calculatedHours: hours,
        dailyBaseSalary: targetExisting?.dailyBaseSalary,
        addonSalary: targetExisting?.addonSalary,
        addonEnabled: targetExisting?.addonEnabled,
        extraHourRate: targetExisting?.extraHourRate,
        overtimeEnabled: targetExisting?.overtimeEnabled,
        salaryOverrideEnabled: status === 'Present' ? targetExisting?.salaryOverrideEnabled : false,
        salaryOverrideAmount: status === 'Present' ? targetExisting?.salaryOverrideAmount : undefined,
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
        description="Log daily shifts, track working hours, and review monthly schedules."
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

      {/* Today Check-In & Monthly Counters Stage */}
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
                    {todayRecord.status}
                  </div>
                  {todayRecord.status === 'Present' && (
                    <p className="text-xs text-[#6e6e73] font-mono tabular-nums">
                      {todayRecord.checkInTime} – {todayRecord.checkOutTime} · {todayRecord.calculatedHours}h
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="text-lg font-semibold text-[#1d1d1f]">Not marked</div>
                  <p className="text-xs text-[#6e6e73]">Record today&apos;s shift details.</p>
                </>
              )}
            </div>

            <button
              onClick={() => openLogModalForDate(todayStr)}
              type="button"
              className="w-full min-h-[40px] py-2 px-3.5 bg-[#1d1d1f] hover:bg-black text-white text-xs font-medium rounded-full transition-colors cursor-pointer"
            >
              {todayRecord ? 'Edit Today' : 'Log Today'}
            </button>
          </div>

          <div className="lg:col-span-8 rounded-2xl bg-white border border-black/[0.06] grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-black/[0.06] overflow-hidden">
            <div className="p-4 sm:p-5 flex flex-col justify-between gap-1">
              <span className="text-xs font-medium text-[#6e6e73]">Working Days</span>
              <div className="text-2xl font-semibold font-mono tabular-nums text-[#1d1d1f]">
                {monthlyStats.presentDays}
              </div>
              <span className="text-[11px] text-[#86868b]">Present in {monthName}</span>
            </div>

            <div className="p-4 sm:p-5 flex flex-col justify-between gap-1">
              <span className="text-xs font-medium text-[#6e6e73]">Total Hours</span>
              <div className="text-2xl font-semibold font-mono tabular-nums text-[#1d1d1f]">
                {monthlyStats.totalHours}h
              </div>
              <span className="text-[11px] text-[#86868b]">Recorded work time</span>
            </div>

            <div className="p-4 sm:p-5 flex flex-col justify-between gap-1">
              <span className="text-xs font-medium text-[#6e6e73]">Leaves</span>
              <div className="text-2xl font-semibold font-mono tabular-nums text-[#1d1d1f]">
                {monthlyStats.leaveDays}
              </div>
              <span className="text-[11px] text-[#86868b]">Time-off days</span>
            </div>

            <div className="p-4 sm:p-5 flex flex-col justify-between gap-1">
              <span className="text-xs font-medium text-[#6e6e73]">Off / Absent</span>
              <div className="text-2xl font-semibold font-mono tabular-nums text-[#1d1d1f]">
                {monthlyStats.absentDays} / {monthlyStats.holidayDays}
              </div>
              <span className="text-[11px] text-[#86868b]">Absent / Holidays</span>
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
                    {rec.status}
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
          description="Log daily check-in times to automatically track total hours, leaves, and salary earnings."
          actionLabel="Log Today's Attendance"
          onAction={() => openLogModalForDate(todayStr)}
        />
      ) : (
        <>
          {/* Mobile List */}
          <div className="md:hidden divide-y divide-black/[0.06] bg-white rounded-2xl border border-black/[0.08] overflow-hidden">
            {sortedAttendance.map((rec) => (
              <div key={rec.id} className="cv-auto p-4 space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono font-medium text-sm text-[#1d1d1f] tabular-nums">
                    {formatHumanDate(rec.date)}
                  </span>
                  <span className={`text-xs font-medium ${STATUS_TEXT_TONE[rec.status]}`}>
                    {rec.status}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs text-[#6e6e73] font-mono tabular-nums">
                  <span>{rec.checkInTime && rec.checkOutTime ? `${rec.checkInTime} – ${rec.checkOutTime}` : 'Shift open'}</span>
                  <span className="font-semibold text-[#1d1d1f]">
                    {rec.status === 'Present' && typeof rec.calculatedHours === 'number' ? `${rec.calculatedHours}h` : '—'}
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
            ))}
          </div>

          {/* Desktop Table */}
          <SectionCard title="Attendance Log" padding="none" className="hidden md:block overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#fbfbfd] border-b border-black/[0.06] text-[11px] font-medium text-[#6e6e73]">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Check-In / Out</th>
                  <th className="py-3 px-4 text-center">Hours</th>
                  <th className="py-3 px-4">Notes</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06] text-[13px] text-[#1d1d1f]">
                {sortedAttendance.map((rec) => (
                  <tr key={rec.id} className="hover:bg-[#f5f5f7]/60 transition-colors">
                    <td className="py-3 px-4 font-mono font-medium text-[#1d1d1f] tabular-nums">
                      {formatHumanDate(rec.date)}
                    </td>
                    <td className={`py-3 px-4 font-medium ${STATUS_TEXT_TONE[rec.status]}`}>
                      {rec.status}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-[#6e6e73] tabular-nums">
                      {rec.checkInTime && rec.checkOutTime ? `${rec.checkInTime} – ${rec.checkOutTime}` : '—'}
                    </td>
                    <td className="py-3 px-4 text-center font-mono font-semibold text-[#1d1d1f] tabular-nums">
                      {rec.status === 'Present' && typeof rec.calculatedHours === 'number' ? `${rec.calculatedHours}h` : '—'}
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
                ))}
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
        title={editingRecord ? 'Edit Attendance Record' : 'Log Attendance'}
        subtitle="Record daily shift status and working hours."
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
                  setDate(nextDate);
                  const existingForDate = attendanceByDate.get(nextDate) || null;
                  setEditingRecord(existingForDate);
                  if (existingForDate) {
                    setStatus(existingForDate.status);
                    setCheckInTime(existingForDate.checkInTime || '');
                    setCheckOutTime(existingForDate.checkOutTime || '');
                    setBreakDurationMinutes(
                      typeof existingForDate.breakDurationMinutes === 'number'
                        ? String(existingForDate.breakDurationMinutes)
                        : ''
                    );
                    setNotes(existingForDate.notes || '');
                  } else {
                    setStatus('Present');
                    setCheckInTime('');
                    setCheckOutTime('');
                    setBreakDurationMinutes('');
                    setNotes('');
                  }
                }}
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className={LABEL_CLASS}>Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as AttendanceStatus)}
                className={SELECT_CLASS}
              >
                <option value="Present">Present</option>
                <option value="Absent">Absent</option>
                <option value="Leave">Leave</option>
                <option value="Holiday">Holiday</option>
              </select>
            </div>
          </div>

          {status === 'Present' && (
            <div className="space-y-3 p-3.5 bg-[#f5f5f7] rounded-2xl">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="min-w-0">
                  <label className={LABEL_CLASS}>Check-In</label>
                  <input
                    type="time"
                    value={checkInTime}
                    onChange={(e) => setCheckInTime(e.target.value)}
                    className={MONO_INPUT_CLASS}
                  />
                </div>
                <div className="min-w-0">
                  <label className={LABEL_CLASS}>Check-Out</label>
                  <input
                    type="time"
                    value={checkOutTime}
                    onChange={(e) => setCheckOutTime(e.target.value)}
                    className={MONO_INPUT_CLASS}
                  />
                </div>
                <div className="min-w-0">
                  <label className={LABEL_CLASS}>Break (min)</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={breakDurationMinutes}
                    onChange={(e) => setBreakDurationMinutes(e.target.value)}
                    className={MONO_INPUT_CLASS}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#6e6e73]">
                <span>
                  {!checkInTime || !checkOutTime
                    ? 'Enter check-in and check-out times to calculate hours'
                    : isOvernightShift(checkInTime, checkOutTime)
                      ? `Overnight shift (+1 day) · Net: ${calculateWorkingHours(checkInTime, checkOutTime, Math.max(0, parseInt(breakDurationMinutes, 10) || 0))}h`
                      : `Net working hours: ${calculateWorkingHours(checkInTime, checkOutTime, Math.max(0, parseInt(breakDurationMinutes, 10) || 0))}h`}
                </span>
                {editingRecord?.extraHours !== undefined && (
                  <span>Saved extra hours stay preserved unless hours change</span>
                )}
              </div>
            </div>
          )}

          <div>
            <label className={LABEL_CLASS}>Notes</label>
            <input
              type="text"
              placeholder="e.g. Worked on client release"
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
        message="Are you sure you want to delete this attendance entry? Working hours and stats will be recalculated."
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
