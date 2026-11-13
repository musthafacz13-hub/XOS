import React, { useState, useEffect } from 'react';
import { CreditCard, Plus, Search, Trash2, Edit3, PieChart as PieChartIcon, X } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { useXOSData } from '../../hooks/useXOSData';
import { Expense, ExpenseCategory, PaymentMethod, RecurrenceFrequency } from '../../types';
import { formatCurrency, formatHumanDate, getTodayString } from '../../utils/formatters';
import { EmptyState } from '../common/EmptyState';
import { ConfirmDialog } from '../common/ConfirmDialog';

const CHART_COLORS = ['#87CEEB', '#111111', '#525252', '#737373', '#A3A3A3', '#D4D4D4', '#38BDF8'];

export const ExpensesView: React.FC = () => {
  const data = useXOSData();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('all');

  // Confirmation dialog state
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form fields
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>(() => data.settings.customExpenseCategories[0] || 'Other');
  const [date, setDate] = useState(getTodayString());
  const [time, setTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Credit Card');
  const [notes, setNotes] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringFrequency, setRecurringFrequency] = useState<RecurrenceFrequency>('Monthly');

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
    setEditingExpense(null);
    setFormError(null);
    setIsSubmitting(false);
    setTitle('');
    setAmount('');
    setCategory(data.settings.customExpenseCategories[0] || 'Other');
    setDate(getTodayString());
    setTime(new Date().toTimeString().slice(0, 5));
    setPaymentMethod('Credit Card');
    setNotes('');
    setIsRecurring(false);
    setRecurringFrequency('Monthly');
    setIsModalOpen(true);
  };

  const openEditModal = (exp: Expense) => {
    setEditingExpense(exp);
    setFormError(null);
    setIsSubmitting(false);
    setTitle(exp.title);
    setAmount(String(exp.amount));
    setCategory(exp.category);
    setDate(exp.date);
    setTime(exp.time || '12:00');
    setPaymentMethod(exp.paymentMethod);
    setNotes(exp.notes || '');
    setIsRecurring(!!exp.isRecurring);
    setRecurringFrequency(
      exp.recurringFrequency && exp.recurringFrequency !== 'None' ? exp.recurringFrequency : 'Monthly'
    );
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
      category,
      date,
      time,
      paymentMethod,
      notes: notes.trim(),
      isRecurring,
      recurringFrequency: isRecurring ? recurringFrequency : 'None'
    };

    try {
      if (editingExpense) {
        await data.updateExpense(editingExpense.id, payload);
      } else {
        await data.addExpense(payload);
      }
      setIsModalOpen(false);
    } catch (err: any) {
      console.error('Failed to save expense:', err);
      setFormError(err?.message || 'Database error: Could not save expense.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = (id: string) => {
    setDeleteError(null);
    setDeleteTargetId(id);
  };

  const filteredExpenses = data.expenses.filter(e => {
    if (selectedCategory !== 'all' && e.category !== selectedCategory) return false;
    if (selectedPaymentMethod !== 'all' && e.paymentMethod !== selectedPaymentMethod) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return e.title.toLowerCase().includes(q) || (e.notes && e.notes.toLowerCase().includes(q));
    }
    return true;
  });

  const totalExpenseSum = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

  const categoryMap: Record<string, number> = {};
  filteredExpenses.forEach(e => {
    categoryMap[e.category] = (categoryMap[e.category] || 0) + e.amount;
  });

  const categoryChartData = Object.entries(categoryMap).map(([name, value]) => ({
    name,
    value: Number(value.toFixed(2))
  })).sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-black/[0.06]">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-[#111111] tracking-tight">
            Expenses
          </h2>
          <p className="text-xs sm:text-sm text-neutral-500 font-normal mt-0.5">
            Log, categorize, and analyze your personal expenditures.
          </p>
        </div>

        <button
          onClick={openCreateModal}
          type="button"
          className="self-start sm:self-auto flex items-center gap-1.5 px-3.5 py-2 bg-[#111111] text-white text-xs font-semibold rounded-xl hover:bg-black transition-colors shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
        >
          <Plus className="w-4 h-4 text-[#87CEEB]" />
          <span>Add Expense</span>
        </button>
      </div>

      {/* Main Dashboard Summary Area */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Prominent Dark Summary Panel */}
        <div className="p-5 rounded-2xl bg-[#111111] text-white flex flex-col justify-between space-y-4 shadow-xs">
          <div>
            <div className="flex items-center justify-between text-neutral-400">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Total Expenses</span>
              <span className="text-[11px] font-mono text-[#87CEEB] tabular-nums">{filteredExpenses.length} transactions</span>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-extrabold font-mono tracking-tight text-white tabular-nums">
                {formatCurrency(totalExpenseSum, data.settings.currency)}
              </div>
              <p className="text-xs text-neutral-400 mt-1">
                Across {categoryChartData.length} active spending categories
              </p>
            </div>
          </div>

          <button
            onClick={openCreateModal}
            type="button"
            className="w-full py-2.5 bg-[#87CEEB] text-[#111111] text-xs font-bold rounded-xl hover:bg-sky-300 transition-colors text-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Log New Expense</span>
          </button>
        </div>

        {/* Category Spending Breakdown Chart */}
        <div className="lg:col-span-3 p-5 rounded-2xl bg-white border border-black/[0.08] space-y-3 shadow-xs">
          <div className="flex items-center justify-between border-b border-black/[0.06] pb-2.5">
            <h3 className="font-bold text-sm text-[#111111] flex items-center gap-2">
              <PieChartIcon className="w-4 h-4 text-[#87CEEB]" />
              Expense Distribution by Category
            </h3>
            <span className="text-xs text-neutral-400">Visual Breakdown</span>
          </div>

          {categoryChartData.length === 0 ? (
            <div className="h-36 flex items-center justify-center text-xs text-neutral-400">
              No expense transactions logged yet. Click "Log New Expense" above to get started.
            </div>
          ) : (
            <div className="h-36 w-full flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={35}
                    outerRadius={55}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {categoryChartData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(val: any) => [formatCurrency(Number(val || 0), data.settings.currency), 'Amount']}
                    contentStyle={{ backgroundColor: '#111111', color: '#ffffff', borderRadius: '12px', fontSize: '12px', border: 'none' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                </PieChart>
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
            placeholder="Search expense titles or notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-neutral-200 rounded-lg bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-neutral-200 rounded-lg bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
          >
            <option value="all">All Categories</option>
            {data.settings.customExpenseCategories.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <select
            value={selectedPaymentMethod}
            onChange={(e) => setSelectedPaymentMethod(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-neutral-200 rounded-lg bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
          >
            <option value="all">All Payment Methods</option>
            <option value="Cash">Cash</option>
            <option value="Credit Card">Credit Card</option>
            <option value="Debit Card">Debit Card</option>
            <option value="Bank Transfer">Bank Transfer</option>
            <option value="Digital Wallet">Digital Wallet</option>
          </select>
        </div>
      </div>

      {/* Data Presentation: Desktop Table vs Mobile Cards */}
      {filteredExpenses.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="No expenses recorded yet"
          description={
            searchQuery || selectedCategory !== 'all' || selectedPaymentMethod !== 'all'
              ? 'No transactions found with the active filters.'
              : 'Keep track of where your money goes by recording your first expense entry.'
          }
          actionLabel="Log Expense"
          onAction={openCreateModal}
        />
      ) : (
        <>
          {/* Mobile Card List (widths < 768px: 320px, 360px, 375px, 390px, etc.) */}
          <div className="md:hidden space-y-2.5">
            {filteredExpenses.map((exp) => (
              <div key={exp.id} className="p-4 rounded-2xl border border-black/[0.08] bg-white space-y-2.5 shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-semibold text-sm text-[#111111] block truncate">{exp.title}</span>
                    <span className="text-[11px] text-neutral-500 block truncate">
                      {exp.category} · {exp.paymentMethod}
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-mono font-bold text-sm text-[#111111] block tabular-nums">
                      {formatCurrency(exp.amount, data.settings.currency)}
                    </span>
                    <span className="text-[10px] text-neutral-400 font-mono block">
                      {formatHumanDate(exp.date)} {exp.time ? `· ${exp.time}` : ''}
                    </span>
                  </div>
                </div>

                {exp.notes && (
                  <p className="text-xs text-neutral-500 bg-neutral-50 p-2 rounded-lg font-normal">
                    {exp.notes}
                  </p>
                )}

                <div className="pt-2 border-t border-neutral-100 flex items-center justify-between text-xs text-neutral-400">
                  <span>{exp.isRecurring ? `Recurring (${exp.recurringFrequency})` : 'One-time'}</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEditModal(exp)}
                      className="p-1 text-neutral-500 hover:text-black cursor-pointer"
                      title="Edit"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(exp.id)}
                      className="p-1 text-neutral-500 hover:text-rose-600 cursor-pointer"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table (widths >= 768px) */}
          <div className="hidden md:block bg-white rounded-2xl border border-black/[0.08] overflow-hidden shadow-xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-neutral-50/80 border-b border-black/[0.06] text-[11px] font-bold text-neutral-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Title & Notes</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Payment Method</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06] text-xs text-neutral-700">
                {filteredExpenses.map((exp) => (
                  <tr key={exp.id} className="hover:bg-neutral-50/70 transition-colors">
                    <td className="py-3 px-4">
                      <span className="font-semibold text-[#111111] block">{exp.title}</span>
                      {exp.notes && <span className="text-[11px] text-neutral-400 block">{exp.notes}</span>}
                    </td>
                    <td className="py-3 px-4 font-medium text-neutral-800">
                      {exp.category}
                      {exp.isRecurring && (
                        <span className="ml-1.5 text-[10px] text-neutral-600 bg-neutral-100 px-1.5 py-0.5 rounded font-mono">
                          {exp.recurringFrequency}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-neutral-600 tabular-nums">
                      {formatHumanDate(exp.date)} {exp.time ? `(${exp.time})` : ''}
                    </td>
                    <td className="py-3 px-4 text-neutral-600">
                      {exp.paymentMethod}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-[#111111] tabular-nums">
                      {formatCurrency(exp.amount, data.settings.currency)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => openEditModal(exp)}
                          className="p-1 text-neutral-400 hover:text-black cursor-pointer"
                          title="Edit"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(exp.id)}
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

      {/* Modal Add / Edit Expense */}
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
                {editingExpense ? 'Edit Expense Record' : 'Log New Expense'}
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
                    placeholder="e.g. Grocery supplies"
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
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  >
                    {data.settings.customExpenseCategories.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Date</label>
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Payment Method</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  >
                    <option value="Cash">Cash</option>
                    <option value="Credit Card">Credit Card</option>
                    <option value="Debit Card">Debit Card</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Digital Wallet">Digital Wallet</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Notes</label>
                  <input
                    type="text"
                    placeholder="Optional memo"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
              </div>

              <div className="flex items-center gap-4 pt-1">
                <label className="flex items-center gap-2 text-xs font-medium text-neutral-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isRecurring}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setIsRecurring(checked);
                      if (checked && recurringFrequency === 'None') {
                        setRecurringFrequency('Monthly');
                      }
                    }}
                    className="rounded text-[#111111] focus:ring-[#87CEEB]"
                  />
                  <span>Recurring Payment</span>
                </label>

                {isRecurring && (
                  <select
                    value={recurringFrequency}
                    onChange={(e) => setRecurringFrequency(e.target.value as RecurrenceFrequency)}
                    className="px-2.5 py-1 text-xs border border-neutral-300 rounded-lg bg-white"
                  >
                    <option value="Daily">Daily</option>
                    <option value="Weekly">Weekly</option>
                    <option value="Monthly">Monthly</option>
                    <option value="Yearly">Yearly</option>
                  </select>
                )}
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
                  {isSubmitting ? 'Saving to Database...' : (editingExpense ? 'Update Expense' : 'Save Expense')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Accessible Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteTargetId !== null}
        title="Delete Expense Record"
        message="Are you sure you want to permanently delete this expense from your records?"
        confirmLabel="Delete Expense"
        isLoading={isDeleting}
        error={deleteError}
        onConfirm={async () => {
          if (!deleteTargetId || isDeleting) return;
          setIsDeleting(true);
          setDeleteError(null);
          try {
            await data.deleteExpense(deleteTargetId);
            setDeleteTargetId(null);
          } catch (err) {
            console.error('Delete expense failed:', err);
            setDeleteError(err instanceof Error ? err.message : 'Failed to delete expense record.');
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
