import React, { useState, useEffect } from 'react';
import { TrendingUp, Plus, Search, Trash2, Edit3, Banknote, ShieldCheck, X } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useXOSData } from '../../hooks/useXOSData';
import { Income, IncomeSource } from '../../types';
import { formatCurrency, formatHumanDate, getTodayString } from '../../utils/formatters';
import { EmptyState } from '../common/EmptyState';
import { ConfirmDialog } from '../common/ConfirmDialog';

const BAR_COLORS = ['#87CEEB', '#111111', '#525252', '#737373', '#A3A3A3', '#38BDF8'];

export const IncomeView: React.FC = () => {
  const data = useXOSData();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSource, setSelectedSource] = useState<string>('all');

  // Confirmation dialog state
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIncome, setEditingIncome] = useState<Income | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form Fields
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState<IncomeSource>(() => data.settings.customIncomeSources[0] || 'Other');
  const [date, setDate] = useState(getTodayString());
  const [time, setTime] = useState(() => new Date().toTimeString().slice(0, 5));
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

  const openCreateModal = () => {
    setEditingIncome(null);
    setFormError(null);
    setIsSubmitting(false);
    setTitle('');
    setAmount('');
    setSource(data.settings.customIncomeSources[0] || 'Other');
    setDate(getTodayString());
    setTime(new Date().toTimeString().slice(0, 5));
    setNotes('');
    setIsModalOpen(true);
  };

  const openEditModal = (inc: Income) => {
    setEditingIncome(inc);
    setFormError(null);
    setIsSubmitting(false);
    setTitle(inc.title);
    setAmount(String(inc.amount));
    setSource(inc.source);
    setDate(inc.date);
    setTime(inc.time || '12:00');
    setNotes(inc.notes || '');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !amount) return;

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setFormError('Amount must be greater than zero.');
      return;
    }

    setFormError(null);
    setIsSubmitting(true);

    const payload = {
      title: title.trim(),
      amount: numAmount,
      source,
      date,
      time,
      notes: notes.trim()
    };

    try {
      if (editingIncome) {
        await data.updateIncome(editingIncome.id, payload);
      } else {
        await data.addIncome(payload);
      }
      setIsModalOpen(false);
    } catch (err: any) {
      console.error('Failed to save income:', err);
      setFormError(err?.message || 'Database error: Could not save income.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = (id: string) => {
    setDeleteError(null);
    setDeleteTargetId(id);
  };

  const filteredIncomes = data.incomes.filter(i => {
    if (selectedSource !== 'all' && i.source !== selectedSource) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return i.title.toLowerCase().includes(q) || (i.notes && i.notes.toLowerCase().includes(q));
    }
    return true;
  });

  const totalIncomeSum = filteredIncomes.reduce((sum, i) => sum + i.amount, 0);

  const sourceMap: Record<string, number> = {};
  filteredIncomes.forEach(i => {
    sourceMap[i.source] = (sourceMap[i.source] || 0) + i.amount;
  });

  const sourceChartData = Object.entries(sourceMap).map(([name, value]) => ({
    name,
    amount: Number(value.toFixed(2))
  })).sort((a, b) => b.amount - a.amount);

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-black/[0.06]">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-[#111111] tracking-tight">
            Income
          </h2>
          <p className="text-xs sm:text-sm text-neutral-500 font-normal mt-0.5">
            Track salaries, freelance earnings, investments, and other revenue streams.
          </p>
        </div>

        <button
          onClick={openCreateModal}
          type="button"
          className="self-start sm:self-auto flex items-center gap-1.5 px-3.5 py-2 bg-[#111111] text-white text-xs font-semibold rounded-xl hover:bg-black transition-colors shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
        >
          <Plus className="w-4 h-4 text-[#87CEEB]" />
          <span>Log Income</span>
        </button>
      </div>

      {/* Main Dashboard Summary Area */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Prominent Dark Summary Panel */}
        <div className="p-5 rounded-2xl bg-[#111111] text-white flex flex-col justify-between space-y-4 shadow-xs">
          <div>
            <div className="flex items-center justify-between text-neutral-400">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Total Revenue</span>
              <span className="text-[11px] font-mono text-[#87CEEB] tabular-nums">{filteredIncomes.length} entries</span>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-extrabold font-mono tracking-tight text-white tabular-nums">
                {formatCurrency(totalIncomeSum, data.settings.currency)}
              </div>
              <p className="text-xs text-neutral-400 mt-1">
                Across {sourceChartData.length} active revenue sources
              </p>
            </div>
          </div>

          <button
            onClick={openCreateModal}
            type="button"
            className="w-full py-2.5 bg-[#87CEEB] text-[#111111] text-xs font-bold rounded-xl hover:bg-sky-300 transition-colors text-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Log Revenue Entry</span>
          </button>
        </div>

        {/* Revenue Streams Breakdown Chart */}
        <div className="lg:col-span-3 p-5 rounded-2xl bg-white border border-black/[0.08] space-y-3 shadow-xs">
          <div className="flex items-center justify-between border-b border-black/[0.06] pb-2.5">
            <h3 className="font-bold text-sm text-[#111111] flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#87CEEB]" />
              Revenue Streams Breakdown by Source
            </h3>
            <span className="text-xs text-neutral-400">By Income Source</span>
          </div>

          {sourceChartData.length === 0 ? (
            <div className="h-36 flex items-center justify-center text-xs text-neutral-400">
              No revenue entries logged yet. Click "Log Revenue Entry" above to record income.
            </div>
          ) : (
            <div className="h-36 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sourceChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(val: any) => [formatCurrency(Number(val || 0), data.settings.currency), 'Amount']}
                    contentStyle={{ backgroundColor: '#111111', color: '#ffffff', borderRadius: '12px', fontSize: '12px', border: 'none' }}
                  />
                  <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                    {sourceChartData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Controls Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-neutral-50 p-2.5 rounded-2xl border border-neutral-200">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search income descriptions or notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-neutral-200 rounded-lg bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
          />
        </div>

        <select
          value={selectedSource}
          onChange={(e) => setSelectedSource(e.target.value)}
          className="px-2.5 py-1.5 text-xs border border-neutral-200 rounded-lg bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
        >
          <option value="all">All Income Sources</option>
          {data.settings.customIncomeSources.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Data Presentation: Desktop Table vs Mobile Cards */}
      {filteredIncomes.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="No income records yet"
          description={
            searchQuery || selectedSource !== 'all'
              ? 'No revenue records match the active search criteria.'
              : 'Add your salary payments, freelance invoices, or other earnings to calculate your net cash flow.'
          }
          actionLabel="Log Income"
          onAction={openCreateModal}
        />
      ) : (
        <>
          {/* Mobile Card List (widths < 768px: 320px, 360px, 375px, 390px, etc.) */}
          <div className="md:hidden space-y-2.5">
            {filteredIncomes.map((inc) => (
              <div key={inc.id} className="p-4 rounded-2xl border border-black/[0.08] bg-white space-y-2.5 shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-semibold text-sm text-[#111111] block truncate">{inc.title}</span>
                    <span className="text-[11px] text-neutral-500 block truncate">
                      {inc.source}
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-mono font-bold text-sm text-[#111111] block tabular-nums">
                      +{formatCurrency(inc.amount, data.settings.currency)}
                    </span>
                    <span className="text-[10px] text-neutral-400 font-mono block">
                      {formatHumanDate(inc.date)} {inc.time ? `· ${inc.time}` : ''}
                    </span>
                  </div>
                </div>

                {inc.salaryPayoutId && data.salaryPayouts.some(p => p.id === inc.salaryPayoutId) && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-neutral-100 text-neutral-700 border border-neutral-200 font-mono">
                    <Banknote className="w-3 h-3 text-[#87CEEB]" /> Payout Synced
                  </span>
                )}

                {inc.notes && (
                  <p className="text-xs text-neutral-500 bg-neutral-50 p-2 rounded-lg font-normal">
                    {inc.notes}
                  </p>
                )}

                <div className="pt-2 border-t border-neutral-100 flex items-center justify-end gap-2 text-xs text-neutral-400">
                  <button
                    onClick={() => openEditModal(inc)}
                    className="p-1 text-neutral-500 hover:text-black cursor-pointer"
                    title="Edit"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(inc.id)}
                    className="p-1 text-neutral-500 hover:text-rose-600 cursor-pointer"
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
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-neutral-50/80 border-b border-black/[0.06] text-[11px] font-bold text-neutral-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Title & Details</th>
                  <th className="py-3 px-4">Source</th>
                  <th className="py-3 px-4">Date Received</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06] text-xs text-neutral-700">
                {filteredIncomes.map((inc) => (
                  <tr key={inc.id} className="hover:bg-neutral-50/70 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[#111111] block">{inc.title}</span>
                        {inc.salaryPayoutId && data.salaryPayouts.some(p => p.id === inc.salaryPayoutId) && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-neutral-100 text-neutral-700 border border-neutral-200 font-semibold flex items-center gap-1">
                            <Banknote className="w-3 h-3 text-[#87CEEB]" /> Payout Synced
                          </span>
                        )}
                      </div>
                      {inc.notes && <span className="text-[11px] text-neutral-400 block">{inc.notes}</span>}
                    </td>
                    <td className="py-3 px-4 font-medium text-neutral-800">
                      {inc.source}
                    </td>
                    <td className="py-3 px-4 font-mono text-neutral-600 tabular-nums">
                      {formatHumanDate(inc.date)} {inc.time ? `(${inc.time})` : ''}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-[#111111] tabular-nums">
                      +{formatCurrency(inc.amount, data.settings.currency)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => openEditModal(inc)}
                          className="p-1 text-neutral-400 hover:text-black cursor-pointer"
                          title="Edit"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(inc.id)}
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

      {/* Modal Add / Edit Income */}
      {isModalOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => { if (!isSubmitting) setIsModalOpen(false); }}
          role="dialog"
          aria-modal="true"
        >
          <div 
            className="bg-white rounded-2xl max-w-lg w-full border border-black/[0.08] shadow-2xl p-5 sm:p-6 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
              <h3 className="font-bold text-base sm:text-lg text-[#111111]">
                {editingIncome ? 'Edit Income Record' : 'Log Income Entry'}
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
                <div className="p-3 text-xs bg-rose-50 border border-rose-200 text-rose-700 rounded-xl font-medium">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Title *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Monthly Salary"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Amount ({data.settings.currency}) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Source</label>
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  >
                    {data.settings.customIncomeSources.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Date Received</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Time (HH:mm)</label>
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Notes</label>
                <input
                  type="text"
                  placeholder="Optional details"
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
                  {isSubmitting ? 'Saving to Database...' : (editingIncome ? 'Update Income' : 'Save Income')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Accessible Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteTargetId !== null}
        title="Delete Income Record"
        message="Are you sure you want to permanently delete this income entry from your records?"
        confirmLabel="Delete Income"
        isLoading={isDeleting}
        error={deleteError}
        onConfirm={async () => {
          if (!deleteTargetId || isDeleting) return;
          setIsDeleting(true);
          setDeleteError(null);
          try {
            await data.deleteIncome(deleteTargetId);
            setDeleteTargetId(null);
          } catch (err) {
            console.error('Delete income failed:', err);
            setDeleteError(err instanceof Error ? err.message : 'Failed to delete income record.');
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
