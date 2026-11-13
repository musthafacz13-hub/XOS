import React, { useState, useId } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  FileText, 
  Download, 
  X, 
  Calendar, 
  Check, 
  Loader2, 
  TrendingUp, 
  CreditCard, 
  Scale, 
  CalendarCheck, 
  Banknote, 
  PiggyBank, 
  Target
} from 'lucide-react';
import { useXOSData } from '../../hooks/useXOSData';
import { generateXOSReportPDF, PDFExportOptions } from '../../services/pdfExport';
import { WaterRippleContainer } from '../common/WaterRipple';
import { modalBackdropVariants, modalContentVariants } from '../../utils/motion';
import { DateFilterPreset } from '../../types';
import { getTodayString } from '../../utils/formatters';

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

  // Section options
  const [includeFinancial, setIncludeFinancial] = useState(true);
  const [includeDebt, setIncludeDebt] = useState(true);
  const [includeAttendance, setIncludeAttendance] = useState(true);
  const [includeSalary, setIncludeSalary] = useState(true);
  const [includeSavings, setIncludeSavings] = useState(true);
  const [includeGoals, setIncludeGoals] = useState(true);

  // Download state
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Compute date range for export based on preset
  const getDateBounds = (): { start?: string; end?: string } => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const toYMD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    if (datePreset === 'all') {
      return {};
    }
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
    setIsGenerating(true);
    setErrorMessage(null);
    setIsSuccess(false);

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

      // Trigger native download
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
      }, 1600);
    } catch (err) {
      console.error('PDF export failed:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to generate PDF. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Live item counter
  const totalFinancialRecords = data.incomes.length + data.expenses.length;
  const totalDebtRecords = data.debts.length;
  const totalAttendanceRecords = data.attendance.length;
  const totalGoals = data.goals.length;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          variants={modalBackdropVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            variants={modalContentVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="bg-white rounded-2xl max-w-lg w-full border border-black/[0.08] shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-black/[0.06] bg-neutral-50/60">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#111111] flex items-center justify-center text-[#87CEEB] shadow-xs">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="font-bold text-sm sm:text-base text-[#111111]">Export PDF Report</h2>
                  <p className="text-[11px] text-neutral-500 font-normal">
                    Generate an audit-grade executive PDF summary
                  </p>
                </div>
              </div>

              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={onClose}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-black hover:bg-neutral-100 transition-colors cursor-pointer"
                aria-label="Close dialog"
              >
                <X className="w-4 h-4" />
              </motion.button>
            </div>

            {/* Scrollable Content Body */}
            <div className="p-4 sm:p-5 overflow-y-auto space-y-4 text-xs">
              {/* Date Scope Selector */}
              <div>
                <label className="block text-xs font-semibold text-neutral-800 mb-1.5">
                  Select Date Scope
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 bg-neutral-100 p-1.5 rounded-xl border border-black/[0.04]">
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
                        className={`py-1.5 px-2 rounded-lg font-semibold text-[11px] transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[#111111] text-white shadow-xs'
                            : 'text-neutral-600 hover:text-black hover:bg-white/60'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>

                {datePreset === 'custom' && (
                  <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-neutral-100">
                    <div>
                      <label htmlFor={startDateId} className="block text-[10px] text-neutral-500 mb-1 font-medium">
                        Start Date
                      </label>
                      <input
                        id={startDateId}
                        type="date"
                        value={customStartDate}
                        onChange={(e) => setCustomStartDate(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-neutral-50 border border-neutral-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[#87CEEB]"
                      />
                    </div>
                    <div>
                      <label htmlFor={endDateId} className="block text-[10px] text-neutral-500 mb-1 font-medium">
                        End Date
                      </label>
                      <input
                        id={endDateId}
                        type="date"
                        value={customEndDate}
                        onChange={(e) => setCustomEndDate(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-neutral-50 border border-neutral-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[#87CEEB]"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Modules to Include */}
              <div>
                <label className="block text-xs font-semibold text-neutral-800 mb-1.5">
                  Included Modules
                </label>
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
                      count: `${data.savingsGoals.length} goals`,
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
                        className={`flex items-center justify-between p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                          mod.checked
                            ? 'bg-neutral-50 border-neutral-300'
                            : 'bg-white border-neutral-200 opacity-60'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Icon className={`w-3.5 h-3.5 ${mod.checked ? 'text-[#111111]' : 'text-neutral-400'}`} />
                          <div>
                            <span className="font-semibold text-neutral-800 block text-[11px]">{mod.label}</span>
                            <span className="text-[10px] text-neutral-500 block">{mod.count}</span>
                          </div>
                        </div>
                        <div
                          className={`w-4 h-4 rounded-md flex items-center justify-center transition-colors ${
                            mod.checked ? 'bg-[#111111] text-white' : 'border border-neutral-300 bg-white'
                          }`}
                        >
                          {mod.checked && <Check className="w-2.5 h-2.5 text-[#87CEEB]" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Format & Privacy Summary */}
              <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200/80 space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-neutral-500">Document Format:</span>
                  <span className="font-mono font-medium text-neutral-800">Vector PDF (A4 Portrait)</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-neutral-500">Active Currency:</span>
                  <span className="font-mono font-medium text-neutral-800">{data.settings.currency}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-neutral-500">Privacy Status:</span>
                  <span className="font-medium text-emerald-600">Client-Side Generated (Private)</span>
                </div>
              </div>

              {errorMessage && (
                <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                  {errorMessage}
                </div>
              )}
            </div>

            {/* Footer Buttons */}
            <div className="p-4 border-t border-black/[0.06] bg-neutral-50/50 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={onClose}
                disabled={isGenerating}
                className="px-3.5 py-2 text-xs font-semibold text-neutral-600 hover:text-black hover:bg-neutral-100 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <WaterRippleContainer className="rounded-xl overflow-hidden">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  type="button"
                  onClick={handleExportPDF}
                  disabled={isGenerating}
                  className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl transition-all shadow-xs cursor-pointer ${
                    isSuccess
                      ? 'bg-emerald-600 text-white'
                      : 'bg-[#111111] hover:bg-black text-white'
                  }`}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 text-[#87CEEB] animate-spin" />
                      <span>Compiling PDF...</span>
                    </>
                  ) : isSuccess ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-white" />
                      <span>Downloaded Successfully!</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-3.5 h-3.5 text-[#87CEEB]" />
                      <span>Download PDF</span>
                    </>
                  )}
                </motion.button>
              </WaterRippleContainer>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
