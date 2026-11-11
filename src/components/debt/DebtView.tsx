import React, { useState, useEffect, useMemo } from 'react';
import { 
  HandCoins, 
  Plus, 
  Search, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Calendar, 
  Clock, 
  CheckCircle2, 
  Trash2, 
  Edit3, 
  History, 
  User, 
  Users, 
  ListFilter, 
  X, 
  AlertCircle,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { useXOSData } from '../../hooks/useXOSData';
import { Debt, DebtRepayment, DebtStatus, DebtType } from '../../types';
import { calculateDebtOutstanding, calculateDebtSummary, calculateTotalRepaid } from '../../utils/calculations';
import { formatCurrency, formatHumanDate, getTodayString } from '../../utils/formatters';
import { EmptyState } from '../common/EmptyState';
import { ConfirmDialog } from '../common/ConfirmDialog';

export const DebtView: React.FC = () => {
  const data = useXOSData();

  // Primary view tabs: 'records' | 'people'
  const [viewMode, setViewMode] = useState<'records' | 'people'>('records');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'lent' | 'borrowed'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | DebtStatus>('all');

  // Modals state
  const [isDebtModalOpen, setIsDebtModalOpen] = useState(false);
  const [editingDebt, setEditingDebt] = useState<Debt | null>(null);

  const [repaymentTargetDebt, setRepaymentTargetDebt] = useState<Debt | null>(null);
  const [historyTargetDebt, setHistoryTargetDebt] = useState<Debt | null>(null);

  // Confirmation state
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteRepaymentTargetId, setDeleteRepaymentTargetId] = useState<string | null>(null);

  // Form Fields - Debt
  const [personName, setPersonName] = useState('');
  const [debtType, setDebtType] = useState<DebtType>('lent');
  const [originalAmount, setOriginalAmount] = useState('');
  const [transactionDate, setTransactionDate] = useState(getTodayString());
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [debtFormError, setDebtFormError] = useState<string | null>(null);

  // Form Fields - Repayment
  const [repaymentAmount, setRepaymentAmount] = useState('');
  const [repaymentDate, setRepaymentDate] = useState(getTodayString());
  const [repaymentNotes, setRepaymentNotes] = useState('');
  const [repaymentError, setRepaymentError] = useState<string | null>(null);

  // Expanded person rows in People view
  const [expandedPerson, setExpandedPerson] = useState<string | null>(null);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsDebtModalOpen(false);
        setRepaymentTargetDebt(null);
        setHistoryTargetDebt(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Summary statistics calculated from actual records
  const summary = useMemo(() => {
    return calculateDebtSummary(data.debts, data.debtRepayments);
  }, [data.debts, data.debtRepayments]);

  // List of unique person names for autocomplete
  const existingPeople = useMemo(() => {
    const names = new Set<string>();
    data.debts.forEach(d => {
      if (d.person_name) names.add(d.person_name.trim());
    });
    return Array.from(names).sort();
  }, [data.debts]);

  // Filtered debts list
  const filteredDebts = useMemo(() => {
    return data.debts.filter(d => {
      if (typeFilter !== 'all' && d.type !== typeFilter) return false;
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesPerson = d.person_name.toLowerCase().includes(q);
        const matchesDesc = d.description ? d.description.toLowerCase().includes(q) : false;
        const matchesNotes = d.notes ? d.notes.toLowerCase().includes(q) : false;
        if (!matchesPerson && !matchesDesc && !matchesNotes) return false;
      }
      return true;
    }).sort((a, b) => (b.transaction_date > a.transaction_date ? 1 : -1));
  }, [data.debts, typeFilter, statusFilter, searchQuery]);

  // Grouped by Person ledger
  const peopleLedger = useMemo(() => {
    const map = new Map<string, {
      name: string;
      debts: Debt[];
      totalLent: number;
      totalBorrowed: number;
      receivable: number;
      payable: number;
      netBalance: number; // positive = they owe you, negative = you owe them
    }>();

    data.debts.forEach(d => {
      const key = d.person_name.trim();
      if (!map.has(key)) {
        map.set(key, {
          name: key,
          debts: [],
          totalLent: 0,
          totalBorrowed: 0,
          receivable: 0,
          payable: 0,
          netBalance: 0
        });
      }
      const entry = map.get(key)!;
      entry.debts.push(d);
      const outstanding = calculateDebtOutstanding(d, data.debtRepayments);

      if (d.type === 'lent') {
        entry.totalLent += d.original_amount;
        entry.receivable += outstanding;
      } else {
        entry.totalBorrowed += d.original_amount;
        entry.payable += outstanding;
      }
      entry.netBalance = entry.receivable - entry.payable;
    });

    let list = Array.from(map.values());
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(p => p.name.toLowerCase().includes(q));
    }
    return list.sort((a, b) => Math.abs(b.netBalance) - Math.abs(a.netBalance));
  }, [data.debts, data.debtRepayments, searchQuery]);

  // Open Create Modal
  const openCreateModal = (prefillPerson?: string, defaultType?: DebtType) => {
    setEditingDebt(null);
    setPersonName(prefillPerson || '');
    setDebtType(defaultType || 'lent');
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
    setDebtType(debt.type);
    setOriginalAmount(String(debt.original_amount));
    setTransactionDate(debt.transaction_date);
    setDueDate(debt.due_date || '');
    setDescription(debt.description || '');
    setNotes(debt.notes || '');
    setDebtFormError(null);
    setIsDebtModalOpen(true);
  };

  // Handle Save Debt
  const handleSaveDebt = (e: React.FormEvent) => {
    e.preventDefault();
    if (!personName.trim()) {
      setDebtFormError('Please enter the person\'s name.');
      return;
    }
    const parsedAmount = parseFloat(originalAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setDebtFormError('Please enter a valid amount greater than 0.');
      return;
    }
    if (!transactionDate) {
      setDebtFormError('Please select a valid transaction date.');
      return;
    }

    if (editingDebt) {
      data.updateDebt(editingDebt.id, {
        person_name: personName.trim(),
        type: debtType,
        original_amount: parsedAmount,
        transaction_date: transactionDate,
        due_date: dueDate.trim() || undefined,
        description: description.trim() || undefined,
        notes: notes.trim() || undefined
      });
    } else {
      data.addDebt({
        person_name: personName.trim(),
        type: debtType,
        original_amount: parsedAmount,
        transaction_date: transactionDate,
        due_date: dueDate.trim() || undefined,
        description: description.trim() || undefined,
        notes: notes.trim() || undefined
      });
    }

    setIsDebtModalOpen(false);
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
  const handleSaveRepayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!repaymentTargetDebt) return;

    const parsedAmount = parseFloat(repaymentAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setRepaymentError('Please enter a valid positive repayment amount.');
      return;
    }

    const outstanding = calculateDebtOutstanding(repaymentTargetDebt, data.debtRepayments);
    if (parsedAmount > outstanding + 0.0001) {
      setRepaymentError(`Repayment cannot exceed the outstanding balance of ${formatCurrency(outstanding, data.settings.currency)}.`);
      return;
    }

    data.addDebtRepayment({
      debt_id: repaymentTargetDebt.id,
      amount: parsedAmount,
      repayment_date: repaymentDate || getTodayString(),
      notes: repaymentNotes.trim() || undefined
    });

    setRepaymentTargetDebt(null);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-black/[0.06]">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-[#111111] tracking-tight">
            Debt & Loans Management
          </h2>
          <p className="text-xs sm:text-sm text-neutral-500 font-normal mt-0.5">
            Track receivables lent to individuals, payable debts borrowed, and verified repayments.
          </p>
        </div>

        <button
          onClick={() => openCreateModal()}
          type="button"
          className="self-start sm:self-auto flex items-center gap-1.5 px-3.5 py-2 bg-[#111111] text-white text-xs font-semibold rounded-xl hover:bg-black transition-colors shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
        >
          <Plus className="w-4 h-4 text-[#87CEEB]" />
          <span>Record Debt</span>
        </button>
      </div>

      {/* 4 Primary Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Outstanding Receivable */}
        <div className="p-4 sm:p-5 rounded-2xl bg-white border border-black/[0.08] shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between text-neutral-500 text-xs font-medium">
            <span>Outstanding Receivable</span>
            <div className="w-7 h-7 rounded-lg bg-[#87CEEB]/20 text-[#111111] flex items-center justify-center">
              <ArrowUpRight className="w-4 h-4 text-[#111111]" />
            </div>
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-bold font-mono text-[#111111] tracking-tight">
            {formatCurrency(summary.outstandingReceivable, data.settings.currency)}
          </div>
          <div className="mt-1 text-[11px] text-neutral-500 flex items-center gap-1">
            <span>Money lent out to collect</span>
          </div>
        </div>

        {/* Outstanding Payable */}
        <div className="p-4 sm:p-5 rounded-2xl bg-white border border-black/[0.08] shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between text-neutral-500 text-xs font-medium">
            <span>Outstanding Payable</span>
            <div className="w-7 h-7 rounded-lg bg-neutral-100 text-neutral-800 flex items-center justify-center">
              <ArrowDownLeft className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-bold font-mono text-[#111111] tracking-tight">
            {formatCurrency(summary.outstandingPayable, data.settings.currency)}
          </div>
          <div className="mt-1 text-[11px] text-neutral-500 flex items-center gap-1">
            <span>Money borrowed to repay</span>
          </div>
        </div>

        {/* Total Money Lent */}
        <div className="p-4 sm:p-5 rounded-2xl bg-white border border-black/[0.08] shadow-xs">
          <div className="flex items-center justify-between text-neutral-500 text-xs font-medium">
            <span>Total Money Lent</span>
            <HandCoins className="w-4 h-4 text-neutral-400" />
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-bold font-mono text-neutral-700 tracking-tight">
            {formatCurrency(summary.totalLent, data.settings.currency)}
          </div>
          <div className="mt-1 text-[11px] text-neutral-400">
            Lifetime original principal
          </div>
        </div>

        {/* Total Money Borrowed */}
        <div className="p-4 sm:p-5 rounded-2xl bg-white border border-black/[0.08] shadow-xs">
          <div className="flex items-center justify-between text-neutral-500 text-xs font-medium">
            <span>Total Money Borrowed</span>
            <HandCoins className="w-4 h-4 text-neutral-400" />
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-bold font-mono text-neutral-700 tracking-tight">
            {formatCurrency(summary.totalBorrowed, data.settings.currency)}
          </div>
          <div className="mt-1 text-[11px] text-neutral-400">
            Lifetime original liabilities
          </div>
        </div>
      </div>

      {/* Status Counters Strip */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-4 p-3 rounded-xl bg-neutral-50 border border-neutral-200/70 text-xs">
        <span className="font-semibold text-neutral-500 uppercase tracking-wider text-[10px]">
          Record Status Breakdown:
        </span>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          <span className="font-medium text-neutral-800">Pending:</span>
          <span className="font-mono font-bold text-[#111111]">{summary.pendingCount}</span>
        </div>
        <span className="text-neutral-300" aria-hidden="true">·</span>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#87CEEB]" />
          <span className="font-medium text-neutral-800">Partial Repayments:</span>
          <span className="font-mono font-bold text-[#111111]">{summary.partialCount}</span>
        </div>
        <span className="text-neutral-300" aria-hidden="true">·</span>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="font-medium text-neutral-800">Completed / Settled:</span>
          <span className="font-mono font-bold text-[#111111]">{summary.completedCount}</span>
        </div>
      </div>

      {/* Controls Bar: View Toggle, Search, Filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* View Mode Toggle */}
        <div className="flex items-center p-1 bg-neutral-100 rounded-xl border border-black/[0.04] self-start">
          <button
            type="button"
            onClick={() => setViewMode('records')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              viewMode === 'records'
                ? 'bg-white text-[#111111] shadow-xs'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <ListFilter className="w-3.5 h-3.5" />
            <span>All Records ({filteredDebts.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('people')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              viewMode === 'people'
                ? 'bg-white text-[#111111] shadow-xs'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>People Ledger ({peopleLedger.length})</span>
          </button>
        </div>

        {/* Search & Select Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search Box */}
          <div className="relative min-w-[200px] flex-1 sm:flex-initial">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              placeholder="Search person or note..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-neutral-200 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-800"
                aria-label="Clear search"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Direction Filter */}
          {viewMode === 'records' && (
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="h-8 px-2.5 text-xs font-medium text-neutral-800 bg-white border border-neutral-200 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
              aria-label="Filter debt direction"
            >
              <option value="all">All Types</option>
              <option value="lent">Money Lent (Receivables)</option>
              <option value="borrowed">Money Borrowed (Payables)</option>
            </select>
          )}

          {/* Status Filter */}
          {viewMode === 'records' && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="h-8 px-2.5 text-xs font-medium text-neutral-800 bg-white border border-neutral-200 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
              aria-label="Filter status"
            >
              <option value="all">All Statuses</option>
              <option value="Pending">Pending (Unpaid)</option>
              <option value="Partial">Partial</option>
              <option value="Paid">Completed</option>
            </select>
          )}
        </div>
      </div>

      {/* MAIN VIEW CONTENT */}
      {viewMode === 'records' ? (
        /* ALL RECORDS VIEW */
        filteredDebts.length === 0 ? (
          <EmptyState
            icon={HandCoins}
            title={data.debts.length === 0 ? "No debt records yet" : "No matching debt records"}
            description={
              data.debts.length === 0
                ? "Start tracking money lent to friends, personal loans, or amounts you've borrowed."
                : "No debts match your active filters or search keyword."
            }
            actionLabel="Record New Debt"
            onAction={() => openCreateModal()}
          />
        ) : (
          <div className="space-y-3">
            {filteredDebts.map(debt => {
              const totalRepaid = calculateTotalRepaid(debt.id, data.debtRepayments);
              const outstanding = calculateDebtOutstanding(debt, data.debtRepayments);
              const isPaid = outstanding <= 0.0001;
              const isLent = debt.type === 'lent';
              const percentRepaid = debt.original_amount > 0 ? Math.min(100, Math.round((totalRepaid / debt.original_amount) * 100)) : 0;
              const repaymentsCount = data.debtRepayments.filter(r => r.debt_id === debt.id).length;

              return (
                <div
                  key={debt.id}
                  className="p-4 sm:p-5 rounded-2xl bg-white border border-black/[0.08] shadow-xs hover:border-black/[0.16] transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  {/* Left Column: Person & Details */}
                  <div className="flex items-start gap-3.5 min-w-0 flex-1">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      isLent ? 'bg-[#87CEEB]/20 text-[#111111]' : 'bg-neutral-100 text-neutral-800'
                    }`}>
                      {isLent ? (
                        <ArrowUpRight className="w-5 h-5 text-[#111111]" />
                      ) : (
                        <ArrowDownLeft className="w-5 h-5 text-neutral-700" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-sm sm:text-base text-[#111111] truncate">
                          {debt.person_name}
                        </span>

                        {/* Direction & Status Tag */}
                        <span className="text-[11px] font-semibold tracking-tight text-neutral-500">
                          {isLent ? '· Lent (Receivable)' : '· Borrowed (Payable)'}
                        </span>

                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${
                          isPaid 
                            ? 'bg-emerald-100 text-emerald-800' 
                            : debt.status === 'Partial'
                            ? 'bg-[#87CEEB]/30 text-neutral-900 font-semibold'
                            : 'bg-amber-100 text-amber-900'
                        }`}>
                          {debt.status}
                        </span>
                      </div>

                      {debt.description && (
                        <p className="text-xs text-neutral-600 mt-1 font-medium">
                          {debt.description}
                        </p>
                      )}

                      {/* Metadata row */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-400 mt-2">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-neutral-400" />
                          <span>{formatHumanDate(debt.transaction_date)}</span>
                        </span>

                        {debt.due_date && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-neutral-400" />
                            <span className={debt.due_date < getTodayString() && !isPaid ? 'text-rose-600 font-semibold' : ''}>
                              Due {formatHumanDate(debt.due_date)}
                            </span>
                          </span>
                        )}

                        {repaymentsCount > 0 && (
                          <span className="text-neutral-500 font-mono text-[11px]">
                            {repaymentsCount} repayment{repaymentsCount > 1 ? 's' : ''} recorded
                          </span>
                        )}
                      </div>

                      {/* Repayment Progress Bar */}
                      <div className="mt-3 max-w-sm">
                        <div className="flex justify-between text-[11px] font-mono text-neutral-500 mb-1">
                          <span>Repaid: {formatCurrency(totalRepaid, data.settings.currency)} ({percentRepaid}%)</span>
                          <span>Remaining: {formatCurrency(outstanding, data.settings.currency)}</span>
                        </div>
                        <div className="w-full h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                          <div 
                            className={`h-full transition-all duration-300 ${isPaid ? 'bg-emerald-500' : 'bg-[#111111]'}`}
                            style={{ width: `${percentRepaid}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Amount & Actions */}
                  <div className="flex flex-row md:flex-col items-center md:items-end justify-between gap-3 shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-neutral-100">
                    <div className="text-left md:text-right">
                      <div className="text-xs text-neutral-400 font-medium">
                        {isLent ? 'Remaining to Collect' : 'Remaining to Pay'}
                      </div>
                      <div className="text-lg sm:text-xl font-bold font-mono text-[#111111] tracking-tight">
                        {formatCurrency(outstanding, data.settings.currency)}
                      </div>
                      <div className="text-[11px] font-mono text-neutral-400">
                        Original: {formatCurrency(debt.original_amount, data.settings.currency)}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {!isPaid && (
                        <button
                          type="button"
                          onClick={() => openRepaymentModal(debt)}
                          className="h-8 px-3 rounded-lg bg-[#111111] text-white text-xs font-semibold hover:bg-black transition-colors cursor-pointer shadow-xs"
                          title="Record a repayment"
                        >
                          Repay
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setHistoryTargetDebt(debt)}
                        className="p-1.5 rounded-lg text-neutral-600 hover:text-black hover:bg-neutral-100 transition-colors cursor-pointer"
                        title="View Repayment History"
                        aria-label="View Repayment History"
                      >
                        <History className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => openEditModal(debt)}
                        className="p-1.5 rounded-lg text-neutral-600 hover:text-black hover:bg-neutral-100 transition-colors cursor-pointer"
                        title="Edit Debt Record"
                        aria-label="Edit Debt Record"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setDeleteTargetId(debt.id)}
                        className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                        title="Delete Debt Record"
                        aria-label="Delete Debt Record"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* PEOPLE LEDGER VIEW */
        peopleLedger.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No contacts with debt records"
            description="When you record debts lent or borrowed, this ledger will group transactions by individual person."
            actionLabel="Record New Debt"
            onAction={() => openCreateModal()}
          />
        ) : (
          <div className="space-y-3">
            {peopleLedger.map(person => {
              const isExpanded = expandedPerson === person.name;
              const owesYou = person.netBalance > 0.0001;
              const youOwe = person.netBalance < -0.0001;
              const isSettled = !owesYou && !youOwe;

              return (
                <div 
                  key={person.name} 
                  className="rounded-2xl bg-white border border-black/[0.08] shadow-xs overflow-hidden transition-all"
                >
                  <div 
                    className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer hover:bg-neutral-50/50"
                    onClick={() => setExpandedPerson(isExpanded ? null : person.name)}
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-10 h-10 rounded-xl bg-[#111111] text-white font-bold text-sm flex items-center justify-center shrink-0">
                        {person.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-bold text-base text-[#111111] tracking-tight">
                          {person.name}
                        </h3>
                        <p className="text-xs text-neutral-500 font-normal mt-0.5">
                          {person.debts.length} debt transaction{person.debts.length > 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-5">
                      <div className="text-left sm:text-right">
                        <div className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
                          Net Outstanding
                        </div>
                        <div className="text-base sm:text-lg font-bold font-mono tracking-tight">
                          {isSettled && <span className="text-neutral-500">All Settled ($0.00)</span>}
                          {owesYou && (
                            <span className="text-[#111111]">
                              Owes You {formatCurrency(person.netBalance, data.settings.currency)}
                            </span>
                          )}
                          {youOwe && (
                            <span className="text-neutral-800">
                              You Owe {formatCurrency(Math.abs(person.netBalance), data.settings.currency)}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-neutral-400 font-mono">
                          Lent: {formatCurrency(person.receivable, data.settings.currency)} · Borrowed: {formatCurrency(person.payable, data.settings.currency)}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openCreateModal(person.name);
                          }}
                          className="h-8 px-2.5 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-[#111111] text-xs font-semibold transition-colors cursor-pointer"
                          title={`Add new debt for ${person.name}`}
                        >
                          <Plus className="w-3.5 h-3.5 inline mr-1" />
                          Add
                        </button>
                        <div className="p-1 rounded-lg text-neutral-400">
                          {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Person History */}
                  {isExpanded && (
                    <div className="border-t border-black/[0.06] bg-neutral-50/60 p-4 sm:p-5 space-y-3">
                      <div className="text-xs font-bold text-neutral-600 uppercase tracking-wider">
                        Active & Past Records with {person.name}
                      </div>

                      <div className="space-y-2">
                        {person.debts.map(d => {
                          const outstanding = calculateDebtOutstanding(d, data.debtRepayments);
                          const totalRepaid = calculateTotalRepaid(d.id, data.debtRepayments);
                          const isPaid = outstanding <= 0.0001;

                          return (
                            <div 
                              key={d.id}
                              className="p-3 bg-white rounded-xl border border-neutral-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className={`w-2 h-2 rounded-full ${d.type === 'lent' ? 'bg-[#87CEEB]' : 'bg-neutral-700'}`} />
                                <span className="font-semibold text-neutral-800">
                                  {d.type === 'lent' ? 'Lent' : 'Borrowed'}:
                                </span>
                                <span className="truncate text-neutral-600">{d.description || 'No description'}</span>
                                <span className="text-neutral-400 text-[11px]">{formatHumanDate(d.transaction_date)}</span>
                              </div>

                              <div className="flex items-center justify-between sm:justify-end gap-3">
                                <div className="text-right">
                                  <span className="font-mono font-bold text-neutral-900 mr-2">
                                    {formatCurrency(outstanding, data.settings.currency)} remaining
                                  </span>
                                  <span className="text-[11px] text-neutral-400">
                                    (of {formatCurrency(d.original_amount, data.settings.currency)})
                                  </span>
                                </div>

                                <div className="flex items-center gap-1">
                                  {!isPaid && (
                                    <button
                                      type="button"
                                      onClick={() => openRepaymentModal(d)}
                                      className="px-2 py-1 text-[11px] font-semibold bg-[#111111] text-white rounded-md hover:bg-black cursor-pointer"
                                    >
                                      Repay
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => setHistoryTargetDebt(d)}
                                    className="p-1 text-neutral-500 hover:text-black rounded"
                                    title="History"
                                  >
                                    <History className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ADD / EDIT DEBT MODAL */}
      {isDebtModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs transition-opacity duration-200"
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
                  {editingDebt ? 'Edit Debt Record' : 'Record New Debt'}
                </h3>
                <p className="text-xs text-neutral-500">
                  {debtType === 'lent' ? 'Money you gave to someone (Receivable)' : 'Money you received from someone (Payable)'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDebtModalOpen(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-neutral-900 transition-colors cursor-pointer"
                aria-label="Close"
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
              {/* Debt Type Selector */}
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1.5">
                  Debt Direction
                </label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-neutral-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setDebtType('lent')}
                    className={`py-2 px-3 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                      debtType === 'lent'
                        ? 'bg-white text-[#111111] shadow-xs'
                        : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    <ArrowUpRight className="w-4 h-4 text-[#87CEEB]" />
                    <span>I Lent Money (Receivable)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDebtType('borrowed')}
                    className={`py-2 px-3 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                      debtType === 'borrowed'
                        ? 'bg-white text-[#111111] shadow-xs'
                        : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    <ArrowDownLeft className="w-4 h-4 text-neutral-700" />
                    <span>I Borrowed (Payable)</span>
                  </button>
                </div>
              </div>

              {/* Person Name Input with autocomplete */}
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Person Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Alex Johnson"
                  value={personName}
                  onChange={(e) => setPersonName(e.target.value)}
                  list="people-suggestions"
                  className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
                <datalist id="people-suggestions">
                  {existingPeople.map(p => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
                <p className="text-[11px] text-neutral-400 mt-1">
                  Enter any person's name; no prior contact setup required.
                </p>
              </div>

              {/* Amount and Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Original Amount ({data.settings.currency}) <span className="text-rose-500">*</span>
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
                    Transaction Date <span className="text-rose-500">*</span>
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

              {/* Due Date & Description */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Due Date (Optional)
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
                    Description (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Travel booking split"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Additional Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Terms, bank account reference, or reminders..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              {/* Modal Actions */}
              <div className="pt-3 flex items-center justify-end gap-2.5 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => setIsDebtModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-semibold bg-[#111111] text-white rounded-xl hover:bg-black transition-colors cursor-pointer shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                >
                  {editingDebt ? 'Update Record' : 'Save Debt Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RECORD REPAYMENT MODAL */}
      {repaymentTargetDebt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs transition-opacity duration-200"
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
                  {repaymentTargetDebt.type === 'lent' ? `Received from ${repaymentTargetDebt.person_name}` : `Paid to ${repaymentTargetDebt.person_name}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRepaymentTargetDebt(null)}
                className="p-1 rounded-lg text-neutral-400 hover:text-neutral-900 transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick summary info */}
            <div className="mt-3 p-3 rounded-xl bg-neutral-50 border border-neutral-200 text-xs flex justify-between">
              <div>
                <span className="text-neutral-500 block">Total Principal:</span>
                <span className="font-mono font-bold text-neutral-800">
                  {formatCurrency(repaymentTargetDebt.original_amount, data.settings.currency)}
                </span>
              </div>
              <div className="text-right">
                <span className="text-neutral-500 block">Current Remaining:</span>
                <span className="font-mono font-bold text-[#111111]">
                  {formatCurrency(calculateDebtOutstanding(repaymentTargetDebt, data.debtRepayments), data.settings.currency)}
                </span>
              </div>
            </div>

            {repaymentError && (
              <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{repaymentError}</span>
              </div>
            )}

            <form onSubmit={handleSaveRepayment} className="mt-4 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-neutral-700">
                    Repayment Amount ({data.settings.currency}) <span className="text-rose-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const outstanding = calculateDebtOutstanding(repaymentTargetDebt, data.debtRepayments);
                      setRepaymentAmount(String(outstanding));
                    }}
                    className="text-[11px] font-semibold text-[#111111] hover:text-[#87CEEB] cursor-pointer"
                  >
                    Pay Remaining Full
                  </button>
                </div>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={calculateDebtOutstanding(repaymentTargetDebt, data.debtRepayments)}
                  required
                  placeholder="0.00"
                  value={repaymentAmount}
                  onChange={(e) => setRepaymentAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Repayment Date <span className="text-rose-500">*</span>
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
                  Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Bank transfer, cash settlement"
                  value={repaymentNotes}
                  onChange={(e) => setRepaymentNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2.5 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => setRepaymentTargetDebt(null)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-semibold bg-[#111111] text-white rounded-xl hover:bg-black transition-colors cursor-pointer shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                >
                  Confirm Repayment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* REPAYMENT HISTORY DRAWER / MODAL */}
      {historyTargetDebt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs transition-opacity duration-200"
          onClick={() => setHistoryTargetDebt(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-black/[0.08] p-5 sm:p-6 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-black/[0.06] shrink-0">
              <div>
                <h3 className="font-bold text-base text-[#111111] tracking-tight">
                  Repayment History
                </h3>
                <p className="text-xs text-neutral-500">
                  {historyTargetDebt.person_name} · {historyTargetDebt.type === 'lent' ? 'Lent' : 'Borrowed'} {formatCurrency(historyTargetDebt.original_amount, data.settings.currency)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryTargetDebt(null)}
                className="p-1 rounded-lg text-neutral-400 hover:text-neutral-900 transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-3 space-y-2">
              {(() => {
                const reps = data.debtRepayments.filter(r => r.debt_id === historyTargetDebt.id);
                if (reps.length === 0) {
                  return (
                    <div className="py-8 text-center text-xs text-neutral-400">
                      No repayments recorded yet for this debt.
                    </div>
                  );
                }
                return reps.map(r => (
                  <div 
                    key={r.id}
                    className="p-3 bg-neutral-50 rounded-xl border border-neutral-200/80 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-bold font-mono text-sm text-[#111111]">
                        {formatCurrency(r.amount, data.settings.currency)}
                      </div>
                      <div className="text-[11px] text-neutral-500 flex items-center gap-2 mt-0.5">
                        <span>{formatHumanDate(r.repayment_date)}</span>
                        {r.notes && <span>· {r.notes}</span>}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setDeleteRepaymentTargetId(r.id)}
                      className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                      title="Delete this repayment"
                      aria-label="Delete repayment"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ));
              })()}
            </div>

            <div className="pt-3 border-t border-black/[0.06] flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setHistoryTargetDebt(null)}
                className="px-4 py-2 text-xs font-semibold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-xl cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRMATION: DELETE DEBT */}
      <ConfirmDialog
        isOpen={deleteTargetId !== null}
        title="Delete Debt Record"
        message="Are you sure you want to permanently delete this debt record? Any recorded repayments will also be removed."
        confirmLabel="Delete Debt"
        onConfirm={() => {
          if (deleteTargetId) data.deleteDebt(deleteTargetId);
          setDeleteTargetId(null);
        }}
        onCancel={() => setDeleteTargetId(null)}
      />

      {/* CONFIRMATION: DELETE REPAYMENT */}
      <ConfirmDialog
        isOpen={deleteRepaymentTargetId !== null}
        title="Delete Repayment Record"
        message="Are you sure you want to remove this repayment? The remaining outstanding balance and debt status will be recalculated."
        confirmLabel="Delete Repayment"
        onConfirm={() => {
          if (deleteRepaymentTargetId) data.deleteDebtRepayment(deleteRepaymentTargetId);
          setDeleteRepaymentTargetId(null);
        }}
        onCancel={() => setDeleteRepaymentTargetId(null)}
      />
    </div>
  );
};
