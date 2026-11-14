import React, { useState, useEffect, useMemo } from 'react';
import { CalendarCheck, Plus, ChevronLeft, ChevronRight, CheckCircle2, Trash2, Edit3, X, AlertCircle } from 'lucide-react';
import { useXOSData } from '../../hooks/useXOSData';
import { AttendanceRecord, AttendanceStatus } from '../../types';
import { calculateAttendanceStats } from '../../utils/calculations';
import { formatHumanDate, getTodayString, calculateWorkingHours } from '../../utils/formatters';
import { EmptyState } from '../common/EmptyState';
import { ConfirmDialog } from '../common/ConfirmDialog';

export const WorkView: React.FC = () => {
  const data = useXOSData();

  const todayStr = getTodayString();
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());

  // Confirmation dialog state
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form Fields
  const [date, setDate] = useState(todayStr);
  const [status, setStatus] = useState<AttendanceStatus>('Present');
  const [checkInTime, setCheckInTime] = useState('09:00');
  const [checkOutTime, setCheckOutTime] = useState('17:30');
  const [breakDurationMinutes, setBreakDurationMinutes] = useState('30');
  const [notes, setNotes] = useState('');

  // Escape key handler for modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isModalOpen && !isSubmitting) {
        setIsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, isSubmitting]);

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
    if (dStr > todayStr) {
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
      setCheckInTime(existing.checkInTime || '09:00');
      setCheckOutTime(existing.checkOutTime || '17:30');
      setBreakDurationMinutes(String(existing.breakDurationMinutes || 30));
      setNotes(existing.notes || '');
    } else {
      setEditingRecord(null);
      setDate(dStr);
      setStatus('Present');
      setCheckInTime('09:00');
      setCheckOutTime('17:30');
      setBreakDurationMinutes('30');
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
    if (isSubmitting) return;
    let hours = 0;
    const parsedBreak = status === 'Present' ? parseInt(breakDurationMinutes, 10) || 0 : 0;
    if (status === 'Present') {
      if (parsedBreak < 0) {
        setFormError('Break duration cannot be negative.');
        return;
      }
      hours = calculateWorkingHours(checkInTime, checkOutTime, parsedBreak);
    }

    setFormError(null);
    setIsSubmitting(true);
    try {
      await data.upsertAttendanceRecord({
        id: editingRecord?.id,
        date,
        status,
        checkInTime: status === 'Present' ? checkInTime : undefined,
        checkOutTime: status === 'Present' ? checkOutTime : undefined,
        breakDurationMinutes: status === 'Present' ? parsedBreak : 0,
        calculatedHours: hours,
        dailyBaseSalary: editingRecord?.dailyBaseSalary,
        addonSalary: editingRecord?.addonSalary,
        addonEnabled: editingRecord?.addonEnabled,
        extraHourRate: editingRecord?.extraHourRate,
        overtimeEnabled: editingRecord?.overtimeEnabled,
        salaryOverrideEnabled: status === 'Present' ? editingRecord?.salaryOverrideEnabled : false,
        salaryOverrideAmount: status === 'Present' ? editingRecord?.salaryOverrideAmount : undefined,
        notes: notes.trim()
      });

      setIsModalOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save attendance record.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = (id: string) => {
    setDeleteError(null);
    setDeleteTargetId(id);
  };

  // Calendar Days Grid respecting configured weekStartDay ('Sunday' vs 'Monday')
  const isMondayStart = data.settings.weekStartDay === 'Monday';

  const calendarCells = useMemo(() => {
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const rawFirstDayOfWeek = new Date(currentYear, currentMonth, 1).getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
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
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-black/[0.06]">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-[#111111] tracking-tight">
            Work & Attendance
          </h2>
          <p className="text-xs sm:text-sm text-neutral-500 font-normal mt-0.5">
            Log daily attendance, track hours worked, and monitor monthly working schedules.
          </p>
        </div>

        <button
          onClick={() => openLogModalForDate(todayStr)}
          type="button"
          className="self-start sm:self-auto flex items-center gap-1.5 px-3.5 py-2 bg-[#111111] text-white text-xs font-semibold rounded-xl hover:bg-black transition-colors shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
        >
          <Plus className="w-4 h-4 text-[#87CEEB]" />
          <span>Mark Attendance</span>
        </button>
      </div>

      {pageError && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{pageError}</span>
          </div>
          <button
            type="button"
            onClick={() => setPageError(null)}
            className="text-rose-700 hover:text-rose-900 font-semibold cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Today Quick Status Box & Monthly Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Today Status Widget */}
        <div className="p-5 rounded-2xl bg-[#111111] text-white flex flex-col justify-between space-y-4 shadow-xs">
          <div>
            <div className="flex items-center justify-between text-neutral-400">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Today's Check-In</span>
              <span className="text-[11px] font-mono text-[#87CEEB] tabular-nums">{todayStr}</span>
            </div>
            <div className="mt-3">
              {todayRecord ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#87CEEB]" />
                    <span className="text-xl font-bold text-white">{todayRecord.status}</span>
                  </div>
                  {todayRecord.status === 'Present' && (
                    <p className="text-xs text-neutral-300 font-mono tabular-nums">
                      {todayRecord.checkInTime} - {todayRecord.checkOutTime} ({todayRecord.calculatedHours}h)
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <span className="text-sm font-semibold text-neutral-200 block">Not marked yet</span>
                  <p className="text-xs text-neutral-400 mt-1">Tap below to record today's shift.</p>
                </div>
              )}
            </div>
          </div>

          <button
            onClick={() => openLogModalForDate(todayStr)}
            type="button"
            className="w-full py-2.5 bg-[#87CEEB] text-[#111111] text-xs font-bold rounded-xl hover:bg-sky-300 transition-colors text-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {todayRecord ? 'Update Today' : 'Log Today'}
          </button>
        </div>

        {/* Monthly Attendance Counters */}
        <div className="lg:col-span-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
          <div className="p-4 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-1.5 shadow-xs">
            <span className="text-[11px] font-semibold text-neutral-500 uppercase">Working Days</span>
            <div className="text-2xl sm:text-3xl font-extrabold font-mono text-[#111111] tabular-nums">
              {monthlyStats.presentDays}
            </div>
            <span className="text-[11px] text-neutral-400">Present in {monthName}</span>
          </div>

          <div className="p-4 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-1.5 shadow-xs">
            <span className="text-[11px] font-semibold text-neutral-500 uppercase">Total Hours</span>
            <div className="text-2xl sm:text-3xl font-extrabold font-mono text-[#111111] tabular-nums">
              {monthlyStats.totalHours}h
            </div>
            <span className="text-[11px] text-neutral-400">Recorded time</span>
          </div>

          <div className="p-4 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-1.5 shadow-xs">
            <span className="text-[11px] font-semibold text-neutral-500 uppercase">Leaves</span>
            <div className="text-2xl sm:text-3xl font-extrabold font-mono text-[#111111] tabular-nums">
              {monthlyStats.leaveDays}
            </div>
            <span className="text-[11px] text-neutral-400">Time-off days</span>
          </div>

          <div className="p-4 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-1.5 shadow-xs">
            <span className="text-[11px] font-semibold text-neutral-500 uppercase">Off / Absent</span>
            <div className="text-2xl sm:text-3xl font-extrabold font-mono text-neutral-600 tabular-nums">
              {monthlyStats.absentDays} / {monthlyStats.holidayDays}
            </div>
            <span className="text-[11px] text-neutral-400">Absent / Holidays</span>
          </div>
        </div>
      </div>

      {/* Monthly Attendance Calendar Grid */}
      <div className="p-4 sm:p-5 rounded-2xl bg-white border border-black/[0.08] space-y-3.5 shadow-xs">
        {/* Month Navigation */}
        <div className="flex items-center justify-between pb-3 border-b border-black/[0.06]">
          <div className="flex items-center gap-2">
            <CalendarCheck className="w-4 h-4 text-[#87CEEB]" />
            <h3 className="font-bold text-sm text-[#111111]">{monthName} Calendar</h3>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handlePrevMonth}
              type="button"
              className="p-1 rounded-lg border border-neutral-200 hover:bg-neutral-100 transition-colors text-neutral-600 cursor-pointer"
              aria-label="Previous month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-semibold text-neutral-800 font-mono px-1">{monthName}</span>
            <button
              onClick={handleNextMonth}
              type="button"
              className="p-1 rounded-lg border border-neutral-200 hover:bg-neutral-100 transition-colors text-neutral-600 cursor-pointer"
              aria-label="Next month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Calendar Day Labels */}
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] sm:text-xs font-semibold text-neutral-400 uppercase">
          {dayLabels.map(label => (
            <div key={label}>{label}</div>
          ))}
        </div>

        {/* Calendar Grid Cells (Responsive: fits 320px - 1440px) */}
        <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
          {calendarCells.map((dStr, idx) => {
            if (!dStr) {
              return <div key={`blank_${idx}`} className="h-12 sm:h-16 bg-neutral-50/50 rounded-xl" />;
            }

            const dayNum = parseInt(dStr.split('-')[2]);
            const rec = attendanceByDate.get(dStr);
            const isToday = dStr === todayStr;
            const isFuture = dStr > todayStr;

            return (
              <button
                key={dStr}
                onClick={() => openLogModalForDate(dStr)}
                disabled={isFuture}
                type="button"
                className={`h-12 sm:h-16 p-1 sm:p-2 rounded-xl border text-left flex flex-col justify-between transition-colors ${
                  isFuture
                    ? 'border-neutral-100 bg-neutral-100/50 text-neutral-300 cursor-not-allowed'
                    : isToday 
                    ? 'ring-2 ring-[#87CEEB] border-[#87CEEB] bg-neutral-50 cursor-pointer' 
                    : 'border-black/[0.06] hover:border-black/20 bg-white cursor-pointer'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className={`text-[11px] sm:text-xs font-bold font-mono ${isToday ? 'text-black' : 'text-neutral-800'}`}>
                    {dayNum}
                  </span>
                  {rec && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#87CEEB]" />
                  )}
                </div>

                {rec ? (
                  <div className="w-full truncate">
                    <span className="text-[9px] sm:text-[10px] font-semibold block text-neutral-700 truncate">
                      {rec.status}
                    </span>
                  </div>
                ) : (
                  <span className="hidden sm:block text-[9px] text-neutral-300 opacity-0 hover:opacity-100">
                    + Log
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Attendance History Records */}
      {data.attendance.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="No attendance records yet"
          description="Log daily check-in times to automatically track total hours, leaves, and salary earnings."
          actionLabel="Log Today's Attendance"
          onAction={() => openLogModalForDate(todayStr)}
        />
      ) : (
        <>
          {/* Mobile Card List for Attendance (widths < 768px: 320px, 360px, etc.) */}
          <div className="md:hidden space-y-2.5">
            <div className="text-xs font-bold text-neutral-500 uppercase tracking-wider px-1">
              Attendance Records
            </div>
            {sortedAttendance.map((rec) => (
              <div key={rec.id} className="cv-auto p-4 rounded-2xl border border-black/[0.08] bg-white space-y-2 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-sm text-[#111111]">
                    {formatHumanDate(rec.date)}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-neutral-100 text-neutral-800">
                    {rec.status}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs text-neutral-500 font-mono">
                  <span>{rec.checkInTime && rec.checkOutTime ? `${rec.checkInTime} - ${rec.checkOutTime}` : 'Shift open'}</span>
                  <span className="font-bold text-[#111111]">{rec.calculatedHours ? `${rec.calculatedHours} hrs` : '—'}</span>
                </div>

                {rec.notes && (
                  <p className="text-xs text-neutral-500 bg-neutral-50 p-2 rounded-lg font-normal">
                    {rec.notes}
                  </p>
                )}

                <div className="pt-2 border-t border-neutral-100 flex items-center justify-end gap-2">
                  <button
                    onClick={() => openLogModalForDate(rec.date)}
                    className="p-1 text-neutral-400 hover:text-black cursor-pointer"
                    title="Edit"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(rec.id)}
                    className="p-1 text-neutral-400 hover:text-rose-600 cursor-pointer"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table (widths >= 768px) */}
          <div className="hidden md:block bg-white rounded-2xl border border-black/[0.08] overflow-hidden shadow-xs">
            <div className="p-4 border-b border-black/[0.06] font-bold text-sm text-[#111111]">
              Attendance Log
            </div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-neutral-50/80 border-b border-black/[0.06] text-[11px] font-bold text-neutral-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Check-In / Out</th>
                  <th className="py-3 px-4 text-center">Hours</th>
                  <th className="py-3 px-4">Notes</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06] text-xs text-neutral-700">
                {sortedAttendance.map((rec) => (
                  <tr key={rec.id} className="hover:bg-neutral-50/70 transition-colors">
                    <td className="py-3 px-4 font-mono font-semibold text-[#111111] tabular-nums">
                      {formatHumanDate(rec.date)}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-neutral-100 text-neutral-800">
                        {rec.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-neutral-600 tabular-nums">
                      {rec.checkInTime && rec.checkOutTime ? `${rec.checkInTime} - ${rec.checkOutTime}` : '—'}
                    </td>
                    <td className="py-3 px-4 text-center font-mono font-bold text-[#111111] tabular-nums">
                      {rec.calculatedHours ? `${rec.calculatedHours}h` : '—'}
                    </td>
                    <td className="py-3 px-4 text-neutral-500">
                      {rec.notes || '—'}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => openLogModalForDate(rec.date)}
                          className="p-1 text-neutral-400 hover:text-black cursor-pointer"
                          title="Edit"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(rec.id)}
                          className="p-1 text-neutral-400 hover:text-rose-600 cursor-pointer"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Modal Attendance Logger */}
      {isModalOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => { if (!isSubmitting) setIsModalOpen(false); }}
          role="dialog"
          aria-modal="true"
        >
          <div 
            className="bg-white rounded-2xl max-w-md w-full border border-black/[0.08] shadow-2xl p-5 sm:p-6 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
              <h3 className="font-bold text-base sm:text-lg text-[#111111]">
                {editingRecord ? 'Edit Attendance Record' : 'Log Attendance'}
              </h3>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-black cursor-pointer disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{formError}</span>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Date</label>
                  <input
                    type="date"
                    required
                    max={todayStr}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as AttendanceStatus)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  >
                    <option value="Present">Present</option>
                    <option value="Absent">Absent</option>
                    <option value="Leave">Leave</option>
                    <option value="Holiday">Holiday</option>
                  </select>
                </div>
              </div>

              {status === 'Present' && (
                <div className="grid grid-cols-3 gap-2 p-3 bg-neutral-50 rounded-xl border border-neutral-200">
                  <div>
                    <label className="block text-[11px] font-semibold text-neutral-700 mb-1">Check-In</label>
                    <input
                      type="time"
                      value={checkInTime}
                      onChange={(e) => setCheckInTime(e.target.value)}
                      className="w-full px-2 py-1.5 text-xs font-mono border border-neutral-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-neutral-700 mb-1">Check-Out</label>
                    <input
                      type="time"
                      value={checkOutTime}
                      onChange={(e) => setCheckOutTime(e.target.value)}
                      className="w-full px-2 py-1.5 text-xs font-mono border border-neutral-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-neutral-700 mb-1">Break (m)</label>
                    <input
                      type="number"
                      value={breakDurationMinutes}
                      onChange={(e) => setBreakDurationMinutes(e.target.value)}
                      className="w-full px-2 py-1.5 text-xs font-mono border border-neutral-300 rounded-lg"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Notes</label>
                <input
                  type="text"
                  placeholder="e.g. Worked on client release"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-neutral-100">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-xs font-semibold bg-[#111111] text-white rounded-xl hover:bg-black transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Save Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Accessible Confirmation Dialog */}
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
            setDeleteError(err instanceof Error ? err.message : 'Failed to delete attendance record.');
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
