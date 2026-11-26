import React, { useState, useId } from 'react';
import {
  Download,
  Check,
  Loader2,
  CreditCard,
  Scale,
  CalendarCheck,
  Banknote,
  PiggyBank,
  Target
} from 'lucide-react';
import { useXOSData } from '../../hooks/useXOSData';
import { generateXOSReportPDF, PDFExportOptions } from '../../services/pdfExport';
import { DateFilterPreset } from '../../types';
import { getTodayString } from '../../utils/formatters';
import { resolveGoalsWithSavings } from '../../utils/calculations';
import { sanitizeDatabaseErrorMessage } from '../../utils/authValidation';
import {
  Modal,
  LABEL_CLASS,
  MONO_INPUT_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS
} from '../ui';

interface PDFExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultPreset?: DateFilterPreset | 'all';
}

export const PDFExportModal: React.FC<PDFExportModalProps> = ({
  isOpen,
  onClose,
  defaultPreset = 'all'
}) => {
  const data = useXOSData();
  const startDateId = useId();
  const endDateId = useId();

  const [datePreset, setDatePreset] = useState<DateFilterPreset | 'all'>(defaultPreset);
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  const [includeFinancial, setIncludeFinancial] = useState(true);
  const [includeDebt, setIncludeDebt] = useState(true);
  const [includeAttendance, setIncludeAttendance] = useState(true);
  const [includeSalary, setIncludeSalary] = useState(true);
  const [includeSavings, setIncludeSavings] = useState(true);
  const [includeGoals, setIncludeGoals] = useState(true);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const getDateBounds = (): { start?: string; end?: string } => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const toYMD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    if (datePreset === 'all') return {};
    if (datePreset === 'today') {
      const today = toYMD(now);
      return { start: today, end: today };
    }
    if (datePreset === 'this_month') {
      const start = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { start, end: toYMD(lastDay) };
    }
    if (datePreset === 'last_month') {
      const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const start = `${prevMonthDate.getFullYear()}-${pad(prevMonthDate.getMonth() + 1)}-01`;
      const lastDay = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth() + 1, 0);
      return { start, end: toYMD(lastDay) };
    }
    if (datePreset === 'this_year') {
      return {
        start: `${now.getFullYear()}-01-01`,
        end: `${now.getFullYear()}-12-31`
      };
    }
    if (datePreset === 'custom') {
      return {
        start: customStartDate || undefined,
        end: customEndDate || undefined
      };
    }
    return {};
  };

  const handleExportPDF = async () => {
    setErrorMessage(null);
    setIsSuccess(false);

    if (datePreset === 'custom') {
      if (!customStartDate && !customEndDate) {
        setErrorMessage('Please select a start date or end date for the Custom date range.');
        return;
      }
      if (customStartDate && customEndDate && customStartDate > customEndDate) {
        setErrorMessage('Start date cannot be after end date.');
        return;
      }
    }

    setIsGenerating(true);

    try {
      const bounds = getDateBounds();
      const options: PDFExportOptions = {
        datePreset,
        startDate: bounds.start,
        endDate: bounds.end,
        includeFinancial,
        includeDebt,
        includeAttendance,
        includeSalary,
        includeSavings,
        includeGoals
      };

      const pdfBlob = await generateXOSReportPDF(data, options);

      const filename = `XOS_Report_${getTodayString()}.pdf`;
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setIsSuccess(true);
      setTimeout(() => {
        setIsSuccess(false);
        onClose();
      }, 1400);
    } catch (err) {
      if (import.meta.env?.DEV) {
        console.error('PDF export failed:', err);
      }
      setErrorMessage(sanitizeDatabaseErrorMessage(err, 'Failed to generate PDF. Please try again.'));
    } finally {
      setIsGenerating(false);
    }
  };

  const totalFinancialRecords = data.incomes.length + data.expenses.length;
  const totalDebtRecords = data.debts.length;
  const totalAttendanceRecords = data.attendance.length;
  const archivedSavingsIds = new Set(
    data.goals
      .filter(g => g.status === 'Archived' && g.savingsGoalId)
      .map(g => g.savingsGoalId as string)
  );
  const totalSavingsGoalsCount = new Set(
    data.savingsGoals
      .filter(sg => sg && sg.id && !sg.isArchived && !archivedSavingsIds.has(sg.id))
      .map(sg => sg.id)
  ).size;
  const totalGoals = resolveGoalsWithSavings(data.goals, data.savingsGoals).length;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      disableClose={isGenerating}
      title="Export PDF Report"
      subtitle="Generate an executive summary generated privately on your device"
      maxWidth="lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={isGenerating}
            className={SECONDARY_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleExportPDF}
            disabled={isGenerating}
            className={
              isSuccess
                ? 'inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-[40px] px-4 py-2 text-[13px] font-medium text-white bg-[#1f7a4c] rounded-xl'
                : PRIMARY_BUTTON_CLASS
            }
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Compiling PDF…</span>
              </>
            ) : isSuccess ? (
              <>
                <Check className="w-4 h-4" />
                <span>Downloaded</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Download PDF</span>
              </>
            )}
          </button>
        </>
      }
    >
      <div className="space-y-5 text-xs">
        <div>
          <label className={LABEL_CLASS}>Date Scope</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 bg-[#f5f5f7] p-1 rounded-xl">
            {[
              { id: 'all' as const, label: 'All Time' },
              { id: 'this_month' as const, label: 'This Month' },
              { id: 'last_month' as const, label: 'Last Month' },
              { id: 'this_year' as const, label: 'This Year' },
              { id: 'today' as const, label: 'Today' },
              { id: 'custom' as const, label: 'Custom' }
            ].map((preset) => {
              const isSelected = datePreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setDatePreset(preset.id)}
                  className={`min-h-[36px] py-1.5 px-2.5 rounded-lg font-medium text-xs transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-white text-[#1d1d1f] font-semibold shadow-2xs ring-1 ring-black/[0.05]'
                      : 'text-[#6e6e73] hover:text-[#1d1d1f]'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          {datePreset === 'custom' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-black/[0.06]">
              <div>
                <label htmlFor={startDateId} className={LABEL_CLASS}>Start Date</label>
                <input
                  id={startDateId}
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className={MONO_INPUT_CLASS}
                />
              </div>
              <div>
                <label htmlFor={endDateId} className={LABEL_CLASS}>End Date</label>
                <input
                  id={endDateId}
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className={MONO_INPUT_CLASS}
                />
              </div>
            </div>
          )}
        </div>

        <div>
          <label className={LABEL_CLASS}>Included Modules</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              {
                label: 'Income & Expenses',
                count: `${totalFinancialRecords} records`,
                icon: CreditCard,
                checked: includeFinancial,
                toggle: () => setIncludeFinancial(!includeFinancial)
              },
              {
                label: 'Debt Management',
                count: `${totalDebtRecords} records`,
                icon: Scale,
                checked: includeDebt,
                toggle: () => setIncludeDebt(!includeDebt)
              },
              {
                label: 'Work & Attendance',
                count: `${totalAttendanceRecords} logged`,
                icon: CalendarCheck,
                checked: includeAttendance,
                toggle: () => setIncludeAttendance(!includeAttendance)
              },
              {
                label: 'Salary Payouts',
                count: `${data.salaryPayouts.length} slips`,
                icon: Banknote,
                checked: includeSalary,
                toggle: () => setIncludeSalary(!includeSalary)
              },
              {
                label: 'Savings Goals',
                count: `${totalSavingsGoalsCount} goals`,
                icon: PiggyBank,
                checked: includeSavings,
                toggle: () => setIncludeSavings(!includeSavings)
              },
              {
                label: 'Goals & Dreams',
                count: `${totalGoals} items`,
                icon: Target,
                checked: includeGoals,
                toggle: () => setIncludeGoals(!includeGoals)
              }
            ].map((mod, i) => {
              const Icon = mod.icon;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={mod.toggle}
                  className={`flex items-center justify-between p-3 rounded-xl border text-left transition-colors cursor-pointer min-h-[52px] ${
                    mod.checked
                      ? 'bg-[#f5f5f7] border-black/[0.08]'
                      : 'bg-white border-black/[0.06] opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className={`w-4 h-4 ${mod.checked ? 'text-[#0071e3]' : 'text-[#86868b]'}`} />
                    <div>
                      <span className="font-medium text-[#1d1d1f] block text-xs">{mod.label}</span>
                      <span className="text-[11px] text-[#6e6e73] block">{mod.count}</span>
                    </div>
                  </div>
                  <div
                    className={`w-4 h-4 rounded-md flex items-center justify-center transition-colors ${
                      mod.checked ? 'bg-[#0071e3] text-white' : 'border border-black/20 bg-white'
                    }`}
                  >
                    {mod.checked && <Check className="w-3 h-3" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-3.5 bg-[#f5f5f7] rounded-xl space-y-1.5 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="text-[#6e6e73]">Format</span>
            <span className="font-mono font-medium text-[#1d1d1f]">Vector PDF (A4 Portrait)</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#6e6e73]">Currency</span>
            <span className="font-mono font-medium text-[#1d1d1f]">{data.settings.currency}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#6e6e73]">Processing</span>
            <span className="font-medium text-[#1f7a4c]">On-Device (Private)</span>
          </div>
        </div>

        {errorMessage && (
          <div className="p-3 rounded-xl bg-[#fef2f2] border border-[#c92a2a]/20 text-[#991b1b] text-xs">
            {errorMessage}
          </div>
        )}
      </div>
    </Modal>
  );
};
