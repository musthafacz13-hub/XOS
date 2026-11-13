import React, { useState, useEffect, useMemo } from 'react';
import { 
  HandCoins, 
  Plus, 
  Search, 
  ArrowUpRight, 
  Calendar, 
  Clock, 
  CheckCircle2, 
  Trash2, 
  Edit3, 
  History, 
  X, 
  AlertCircle
} from 'lucide-react';
import { useXOSData } from '../../hooks/useXOSData';
import { Debt, DebtStatus } from '../../types';
import { calculateDebtOutstanding, calculateTotalRepaid } from '../../utils/calculations';
import { formatCurrency, formatHumanDate, getTodayString } from '../../utils/formatters';
import { EmptyState } from '../common/EmptyState';
import { ConfirmDialog } from '../common/ConfirmDialog';

export const DebtView: React.FC = () => {
  const data = useXOSData();

  // Filters: 'all' | 'active' | 'recovered'
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'recovered'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [isDebtModalOpen, setIsDebtModalOpen] = useState(false);
  const [editingDebt, setEditingDebt] = useState<Debt | null>(null);

  const [repaymentTargetDebt, setRepaymentTargetDebt] = useState<Debt | null>(null);
  const [historyTargetDebt, setHistoryTargetDebt] = useState<Debt | null>(null);

  // Deletion targets
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeletingDebt, setIsDeletingDebt] = useState(false);
  const [deleteDebtError, setDeleteDebtError] = useState<string | null>(null);

  // Form Fields - Record Debt Lent
  const [personName, setPersonName] = useState('');
  const [originalAmount, setOriginalAmount] = useState('');
  const [transactionDate, setTransactionDate] = useState(getTodayString());
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [debtFormError, setDebtFormError] = useState<string | null>(null);
  const [isSubmittingDebt, setIsSubmittingDebt] = useState(false);

  // Form Fields - Repayment
  const [repaymentAmount, setRepaymentAmount] = useState('');
  const [repaymentDate, setRepaymentDate] = useState(getTodayString());
  const [repaymentNotes, setRepaymentNotes] = useState('');
  const [repaymentError, setRepaymentError] = useState<string | null>(null);
  const [isSubmittingRepayment, setIsSubmittingRepayment] = useState(false);

  // History modal delete state
  const [deletingRepaymentId, setDeletingRepaymentId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Escape key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmittingDebt && !isSubmittingRepayment) {
        setIsDebtModalOpen(false);
        setRepaymentTargetDebt(null);
        setHistoryTargetDebt(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSubmittingDebt, isSubmittingRepayment]);

  // Filter only 'lent' debts (Money Owed to Me)
  const lentDebts = useMemo(() => {
    return data.debts.filter(d => d.type === 'lent');
  }, [data.debts]);

  // Calculations for summary cards
  const totalLentAmount = useMemo(() => {
    return lentDebts.reduce((sum, d) => sum + d.original_amount, 0);
  }, [lentDebts]);

  const totalRepaidAmount = useMemo(() => {
    return lentDebts.reduce((sum, d) => sum + calculateTotalRepaid(d.id, data.debtRepayments), 0);
  }, [lentDebts, data.debtRepayments]);

  const totalOutstandingReceivable = Math.max(0, totalLentAmount - totalRepaidAmount);

  // Filtered debts list
  const filteredDebts = useMemo(() => {
    return lentDebts.filter(d => {
      const outstanding = calculateDebtOutstanding(d, data.debtRepayments);
      const isRecovered = outstanding <= 0.0001;

      if (statusFilter === 'active' && isRecovered) return false;
      if (statusFilter === 'recovered' && !isRecovered) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesPerson = d.person_name.toLowerCase().includes(q);
        const matchesDesc = d.description ? d.description.toLowerCase().includes(q) : false;
        const matchesNotes = d.notes ? d.notes.toLowerCase().includes(q) : false;
        if (!matchesPerson && !matchesDesc && !matchesNotes) return false;
      }
      return true;
    }).sort((a, b) => (b.transaction_date > a.transaction_date ? 1 : -1));
  }, [lentDebts, statusFilter, searchQuery, data.debtRepayments]);

  // Autocomplete names
  const existingPeople = useMemo(() => {
    const names = new Set<string>();
    lentDebts.forEach(d => {
      if (d.person_name) names.add(d.person_name.trim());
    });
    return Array.from(names).sort();
  }, [lentDebts]);

  // Open Create Modal
  const openCreateModal = (prefillPerson?: string) => {
    setEditingDebt(null);
    setPersonName(prefillPerson || '');
    setOriginalAmount('');
    setTransactionDate(getTodayString());
    setDueDate('');
    setDescription('');
    setNotes('');
    setDebtFormError(null);
    setIsDebtModalOpen(true);
  };

  // Open Edit Modal
  const openEditModal = (debt: Debt) => {
    setEditingDebt(debt);
    setPersonName(debt.person_name);
    setOriginalAmount(String(debt.original_amount));
    setTransactionDate(debt.transaction_date);
    setDueDate(debt.due_date || '');
    setDescription(debt.description || '');
    setNotes(debt.notes || '');
    setDebtFormError(null);
    setIsDebtModalOpen(true);
  };

  // Handle Save Debt
  const handleSaveDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingDebt) return;

    if (!personName.trim()) {
      setDebtFormError("Please enter the borrower's name.");
      return;
    }
    const parsedAmount = parseFloat(originalAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setDebtFormError('Please enter a valid amount greater than 0.');
      return;
    }
    if (!transactionDate) {
      setDebtFormError('Please select a valid date.');
      return;
    }

    setDebtFormError(null);
    setIsSubmittingDebt(true);

    try {
      if (editingDebt) {
        await data.updateDebt(editingDebt.id, {
          person_name: personName.trim(),
          type: 'lent',
          original_amount: parsedAmount,
          transaction_date: transactionDate,
          due_date: dueDate.trim() || undefined,
          description: description.trim() || undefined,
          notes: notes.trim() || undefined
        });
      } else {
        await data.addDebt({
          person_name: personName.trim(),
          type: 'lent',
          original_amount: parsedAmount,
          transaction_date: transactionDate,
          due_date: dueDate.trim() || undefined,
          description: description.trim() || undefined,
          notes: notes.trim() || undefined
        });
      }

      setIsDebtModalOpen(false);
    } catch (err) {
      setDebtFormError(err instanceof Error ? err.message : 'Database error: Could not save loan record.');
    } finally {
      setIsSubmittingDebt(false);
    }
  };

  // Open Repayment Modal
  const openRepaymentModal = (debt: Debt) => {
    setRepaymentTargetDebt(debt);
    const outstanding = calculateDebtOutstanding(debt, data.debtRepayments);
    setRepaymentAmount(String(outstanding));
    setRepaymentDate(getTodayString());
    setRepaymentNotes('');
    setRepaymentError(null);
  };

  // Handle Save Repayment
  const handleSaveRepayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repaymentTargetDebt || isSubmittingRepayment) return;

    const parsedAmount = parseFloat(repaymentAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setRepaymentError('Please enter a valid positive repayment amount.');
      return;
    }

    const outstanding = calculateDebtOutstanding(repaymentTargetDebt, data.debtRepayments);
    if (parsedAmount > outstanding + 0.001) {
      setRepaymentError(`Repayment cannot exceed remaining balance of ${formatCurrency(outstanding, data.settings.currency)}.`);
      return;
    }

    setRepaymentError(null);
    setIsSubmittingRepayment(true);

    try {
      await data.addDebtRepayment({
        debt_id: repaymentTargetDebt.id,
        amount: parsedAmount,
        repayment_date: repaymentDate || getTodayString(),
        notes: repaymentNotes.trim() || undefined
      });
      setRepaymentTargetDebt(null);
    } catch (err) {
      setRepaymentError(err instanceof Error ? err.message : 'Database error: Could not save repayment.');
    } finally {
      setIsSubmittingRepayment(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-black/[0.06]">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-[#111111] tracking-tight">
            Money Owed to Me (Receivables)
          </h2>
          <p className="text-xs sm:text-sm text-neutral-500 font-normal mt-0.5">
            Track money lent to friends, colleagues, or family and monitor incoming repayments.
          </p>
        </div>

        <button
          onClick={() => openCreateModal()}
          type="button"
          className="self-start sm:self-auto flex items-center gap-1.5 px-3.5 py-2 bg-[#111111] text-white text-xs font-semibold rounded-xl hover:bg-black transition-colors shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
        >
          <Plus className="w-4 h-4 text-[#87CEEB]" />
          <span>Record Money Lent</span>
        </button>
      </div>

      {/* Main Dashboard Summary Area */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Prominent Dark Summary Panel */}
        <div className="p-5 rounded-2xl bg-[#111111] text-white flex flex-col justify-between space-y-4 shadow-xs">
          <div>
            <div className="flex items-center justify-between text-neutral-400">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Outstanding Receivables</span>
              <span className="text-[11px] font-mono text-[#87CEEB] tabular-nums">{lentDebts.length} active loans</span>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-extrabold font-mono tracking-tight text-white tabular-nums">
                {formatCurrency(totalOutstandingReceivable, data.settings.currency)}
              </div>
              <p className="text-xs text-neutral-400 mt-1">
                Money remaining to be recovered
              </p>
            </div>
          </div>

          <button
            onClick={() => openCreateModal()}
            type="button"
            className="w-full py-2.5 bg-[#87CEEB] text-[#111111] text-xs font-bold rounded-xl hover:bg-sky-300 transition-colors text-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Record Money Lent</span>
          </button>
        </div>

        {/* Key Metrics Grid */}
        <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
          <div className="p-4 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-1.5 shadow-xs">
            <span className="text-[11px] font-semibold text-neutral-500 uppercase">Total Money Recovered</span>
            <div className="text-2xl sm:text-3xl font-bold font-mono text-emerald-600 tabular-nums">
              {formatCurrency(totalRepaidAmount, data.settings.currency)}
            </div>
            <span className="text-[11px] text-neutral-400">
              {totalLentAmount > 0 ? `${Math.round((totalRepaidAmount / totalLentAmount) * 100)}% recovery rate` : 'No loans recorded'}
            </span>
          </div>

          <div className="p-4 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-1.5 shadow-xs">
            <span className="text-[11px] font-semibold text-neutral-500 uppercase">People Who Owe Money</span>
            <div className="text-2xl sm:text-3xl font-bold font-mono text-[#111111] tabular-nums">
              {existingPeople.length}
            </div>
            <span className="text-[11px] text-neutral-400">Borrowers tracked</span>
          </div>

          <div className="p-4 rounded-2xl bg-white border border-black/[0.08] flex flex-col justify-between space-y-1.5 shadow-xs">
            <span className="text-[11px] font-semibold text-neutral-500 uppercase">Total Principal Lent</span>
            <div className="text-2xl sm:text-3xl font-bold font-mono text-neutral-700 tabular-nums">
              {formatCurrency(totalLentAmount, data.settings.currency)}
            </div>
            <span className="text-[11px] text-neutral-400">Lifetime principal sum</span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-neutral-50 p-2.5 rounded-2xl border border-neutral-200">
        <div className="flex items-center gap-1.5 p-1 bg-white rounded-xl border border-neutral-200 self-start">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              statusFilter === 'all' ? 'bg-[#111111] text-white' : 'text-neutral-600 hover:text-black'
            }`}
          >
            All Loans ({lentDebts.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('active')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              statusFilter === 'active' ? 'bg-[#111111] text-white' : 'text-neutral-600 hover:text-black'
            }`}
          >
            Active / Outstanding
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('recovered')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              statusFilter === 'recovered' ? 'bg-[#111111] text-white' : 'text-neutral-600 hover:text-black'
            }`}
          >
            Fully Recovered
          </button>
        </div>

        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search borrower name, details, or notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-neutral-200 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
          />
        </div>
      </div>

      {/* Debt List */}
      {filteredDebts.length === 0 ? (
        <EmptyState
          icon={HandCoins}
          title="No receivable loans found"
          description={
            searchQuery || statusFilter !== 'all'
              ? 'No lent records match the selected filter criteria.'
              : 'Record money you have lent out to keep track of balances and repayments.'
          }
          actionLabel="Record Money Lent"
          onAction={() => openCreateModal()}
        />
      ) : (
        <div className="space-y-3">
          {filteredDebts.map(debt => {
            const totalRepaid = calculateTotalRepaid(debt.id, data.debtRepayments);
            const outstanding = calculateDebtOutstanding(debt, data.debtRepayments);
            const isRecovered = outstanding <= 0.0001;
            const percentRepaid = debt.original_amount > 0 ? Math.min(100, Math.round((totalRepaid / debt.original_amount) * 100)) : 0;
            const repayments = data.debtRepayments.filter(r => r.debt_id === debt.id);

            return (
              <div
                key={debt.id}
                className="p-4 sm:p-5 rounded-2xl bg-white border border-black/[0.08] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="flex items-start gap-3.5 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-[#87CEEB]/20 text-[#111111] flex items-center justify-center shrink-0">
                    <ArrowUpRight className="w-5 h-5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-base text-[#111111] truncate">
                        {debt.person_name}
                      </span>

                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${
                        isRecovered 
                          ? 'bg-emerald-100 text-emerald-800' 
                          : totalRepaid > 0
                          ? 'bg-[#87CEEB]/30 text-neutral-900 font-semibold'
                          : 'bg-amber-100 text-amber-900'
                      }`}>
                        {isRecovered ? 'Fully Recovered' : totalRepaid > 0 ? 'Partial Repayment' : 'Pending'}
                      </span>
                    </div>

                    {debt.description && (
                      <p className="text-xs text-neutral-600 mt-1 font-medium">
                        {debt.description}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-400 mt-2">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-neutral-400" />
                        <span>Lent on {formatHumanDate(debt.transaction_date)}</span>
                      </span>

                      {debt.due_date && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-neutral-400" />
                          <span className={debt.due_date < getTodayString() && !isRecovered ? 'text-rose-600 font-semibold' : ''}>
                            Expected {formatHumanDate(debt.due_date)}
                          </span>
                        </span>
                      )}

                      {repayments.length > 0 && (
                        <span className="font-mono text-[11px] text-neutral-500">
                          {repayments.length} repayment{repayments.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>

                    {/* Recovery Progress Bar */}
                    <div className="mt-3 max-w-sm">
                      <div className="flex justify-between text-[11px] font-mono text-neutral-500 mb-1">
                        <span>Recovered: {formatCurrency(totalRepaid, data.settings.currency)} ({percentRepaid}%)</span>
                        <span>Remaining: {formatCurrency(outstanding, data.settings.currency)}</span>
                      </div>
                      <div className="w-full h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                        <div 
                          className={`h-full transition-all duration-300 ${isRecovered ? 'bg-emerald-500' : 'bg-[#111111]'}`}
                          style={{ width: `${percentRepaid}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-row md:flex-col items-center md:items-end justify-between gap-3 shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-neutral-100">
                  <div className="text-left md:text-right">
                    <div className="text-xs text-neutral-400 font-medium">
                      Remaining Balance
                    </div>
                    <div className="text-lg sm:text-xl font-bold font-mono text-[#111111] tracking-tight">
                      {formatCurrency(outstanding, data.settings.currency)}
                    </div>
                    <div className="text-[11px] font-mono text-neutral-400">
                      Original Lent: {formatCurrency(debt.original_amount, data.settings.currency)}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {!isRecovered && (
                      <button
                        type="button"
                        onClick={() => openRepaymentModal(debt)}
                        className="h-8 px-3 rounded-lg bg-[#111111] text-white text-xs font-semibold hover:bg-black transition-colors cursor-pointer shadow-xs"
                      >
                        Record Repayment
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setHistoryError(null);
                        setHistoryTargetDebt(debt);
                      }}
                      className="p-1.5 rounded-lg text-neutral-600 hover:text-black hover:bg-neutral-100 transition-colors cursor-pointer"
                      title="Repayment History"
                    >
                      <History className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => openEditModal(debt)}
                      className="p-1.5 rounded-lg text-neutral-600 hover:text-black hover:bg-neutral-100 transition-colors cursor-pointer"
                      title="Edit Loan Record"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setDeleteDebtError(null);
                        setDeleteTargetId(debt.id);
                      }}
                      className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                      title="Delete Record"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* RECORD / EDIT LENT DEBT MODAL */}
      {isDebtModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs"
          onClick={() => setIsDebtModalOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-black/[0.08] p-5 sm:p-6 overflow-hidden max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-black/[0.06]">
              <div>
                <h3 className="font-bold text-base text-[#111111] tracking-tight">
                  {editingDebt ? 'Edit Loan Record' : 'Record Money Lent'}
                </h3>
                <p className="text-xs text-neutral-500">
                  Money you lent to someone that they owe back to you.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDebtModalOpen(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-neutral-900 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {debtFormError && (
              <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{debtFormError}</span>
              </div>
            )}

            <form onSubmit={handleSaveDebt} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Borrower Person Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Alex Johnson"
                  value={personName}
                  onChange={(e) => setPersonName(e.target.value)}
                  list="borrower-suggestions"
                  className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
                <datalist id="borrower-suggestions">
                  {existingPeople.map(p => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Amount Lent ({data.settings.currency}) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="0.00"
                    value={originalAmount}
                    onChange={(e) => setOriginalAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Date Lent *
                  </label>
                  <input
                    type="date"
                    required
                    value={transactionDate}
                    onChange={(e) => setTransactionDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Expected Target Date (Optional)
                  </label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Description / Purpose (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Travel booking reimbursement"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Additional terms or notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-neutral-100">
                <button
                  type="button"
                  disabled={isSubmittingDebt}
                  onClick={() => setIsDebtModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingDebt}
                  className="px-5 py-2 text-xs font-semibold bg-[#111111] text-white rounded-xl hover:bg-black transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingDebt ? 'Saving...' : 'Save Loan Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* REPAYMENT MODAL */}
      {repaymentTargetDebt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs"
          onClick={() => setRepaymentTargetDebt(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-black/[0.08] p-5 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-black/[0.06]">
              <div>
                <h3 className="font-bold text-base text-[#111111] tracking-tight">
                  Record Repayment
                </h3>
                <p className="text-xs text-neutral-500">
                  Received from <span className="font-semibold text-neutral-900">{repaymentTargetDebt.person_name}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRepaymentTargetDebt(null)}
                className="p-1 rounded-lg text-neutral-400 hover:text-neutral-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {repaymentError && (
              <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{repaymentError}</span>
              </div>
            )}

            <form onSubmit={handleSaveRepayment} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Repayment Amount ({data.settings.currency}) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={repaymentAmount}
                  onChange={(e) => setRepaymentAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
                <p className="text-[11px] text-neutral-400 mt-1 font-mono">
                  Max remaining: {formatCurrency(calculateDebtOutstanding(repaymentTargetDebt, data.debtRepayments), data.settings.currency)}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Repayment Date *
                </label>
                <input
                  type="date"
                  required
                  value={repaymentDate}
                  onChange={(e) => setRepaymentDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Notes / Payment Ref (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Bank transfer, Cash, UPI reference"
                  value={repaymentNotes}
                  onChange={(e) => setRepaymentNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-neutral-100">
                <button
                  type="button"
                  disabled={isSubmittingRepayment}
                  onClick={() => setRepaymentTargetDebt(null)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingRepayment}
                  className="px-5 py-2 text-xs font-semibold bg-[#111111] text-white rounded-xl hover:bg-black transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingRepayment ? 'Saving...' : 'Save Repayment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* REPAYMENT HISTORY MODAL */}
      {historyTargetDebt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs"
          onClick={() => setHistoryTargetDebt(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-black/[0.08] p-5 sm:p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-black/[0.06]">
              <div>
                <h3 className="font-bold text-base text-[#111111]">
                  Repayment History
                </h3>
                <p className="text-xs text-neutral-500">
                  {historyTargetDebt.person_name} · Original Lent: {formatCurrency(historyTargetDebt.original_amount, data.settings.currency)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryTargetDebt(null)}
                className="p-1 rounded-lg text-neutral-400 hover:text-neutral-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {historyError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{historyError}</span>
              </div>
            )}

            {data.debtRepayments.filter(r => r.debt_id === historyTargetDebt.id).length === 0 ? (
              <p className="text-xs text-neutral-400 text-center py-6">
                No repayments logged yet for this loan.
              </p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {data.debtRepayments
                  .filter(r => r.debt_id === historyTargetDebt.id)
                  .sort((a, b) => (b.repayment_date > a.repayment_date ? 1 : -1))
                  .map(rep => (
                    <div key={rep.id} className="p-3 bg-neutral-50 rounded-xl border border-neutral-200 flex items-center justify-between text-xs">
                      <div>
                        <span className="font-mono font-bold text-[#111111] block">
                          +{formatCurrency(rep.amount, data.settings.currency)}
                        </span>
                        <span className="text-[11px] text-neutral-400 font-mono">
                          {formatHumanDate(rep.repayment_date)} {rep.notes ? `· ${rep.notes}` : ''}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={deletingRepaymentId === rep.id}
                        onClick={async () => {
                          setHistoryError(null);
                          setDeletingRepaymentId(rep.id);
                          try {
                            await data.deleteDebtRepayment(rep.id);
                          } catch (err) {
                            setHistoryError(err instanceof Error ? err.message : 'Could not delete repayment.');
                          } finally {
                            setDeletingRepaymentId(null);
                          }
                        }}
                        className="p-1 text-neutral-400 hover:text-rose-600 transition-colors cursor-pointer disabled:opacity-50"
                        title="Delete repayment"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setHistoryTargetDebt(null)}
                className="px-4 py-2 text-xs font-semibold bg-[#111111] text-white rounded-xl hover:bg-black cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={deleteTargetId !== null}
        title="Delete Loan Record"
        message="Are you sure you want to permanently delete this lent debt record and its repayment history?"
        confirmLabel="Delete Loan"
        isLoading={isDeletingDebt}
        error={deleteDebtError}
        onConfirm={async () => {
          if (!deleteTargetId || isDeletingDebt) return;
          setDeleteDebtError(null);
          setIsDeletingDebt(true);
          try {
            await data.deleteDebt(deleteTargetId);
            setDeleteTargetId(null);
          } catch (err) {
            setDeleteDebtError(err instanceof Error ? err.message : 'Database error: Could not delete loan.');
          } finally {
            setIsDeletingDebt(false);
          }
        }}
        onCancel={() => {
          setDeleteDebtError(null);
          setDeleteTargetId(null);
        }}
      />
    </div>
  );
};
