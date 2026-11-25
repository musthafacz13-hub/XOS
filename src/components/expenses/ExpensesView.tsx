import React, { useState, useMemo, useRef } from 'react';
import { CreditCard, Plus, Trash2, Edit3 } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { useXOSData } from '../../hooks/useXOSData';
import { Expense, ExpenseCategory, PaymentMethod, RecurrenceFrequency } from '../../types';
import { formatCurrency, formatHumanDate, getTodayString } from '../../utils/formatters';
import { EmptyState } from '../common/EmptyState';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { sanitizeDatabaseErrorMessage } from '../../utils/authValidation';
import {
  ActionIconButton,
  FilterBar,
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

const CHART_COLORS = ['#0284c7', '#1d1d1f', '#38bdf8', '#6e6e73', '#a1a1aa', '#0369a1', '#d2d2d7'];

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
  const isSubmittingRef = useRef(false);
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
    if (isSubmittingRef.current || isSubmitting) return;

    if (!title.trim()) {
      setFormError('Expense title is required.');
      return;
    }

    const numAmount = parseFloat(amount);
    if (!amount || isNaN(numAmount) || numAmount <= 0) {
      setFormError('Amount must be greater than zero.');
      return;
    }

    isSubmittingRef.current = true;
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
      if (import.meta.env?.DEV) {
        console.error('Failed to save expense:', err);
      }
      setFormError(sanitizeDatabaseErrorMessage(err, 'Database error: Could not save expense.'));
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleDelete = (id: string) => {
    setDeleteError(null);
    setDeleteTargetId(id);
  };

  const syncedRepaymentIds = useMemo(
    () => new Set(data.debtRepayments.map(r => r.id)),
    [data.debtRepayments]
  );

  const filteredExpenses = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return data.expenses.filter(e => {
      if (selectedCategory !== 'all' && e.category !== selectedCategory) return false;
      if (selectedPaymentMethod !== 'all' && e.paymentMethod !== selectedPaymentMethod) return false;
      if (q) {
        return (
          e.title.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          (e.notes && e.notes.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [data.expenses, selectedCategory, selectedPaymentMethod, searchQuery]);

  const totalExpenseSum = useMemo(
    () => filteredExpenses.reduce((sum, e) => sum + e.amount, 0),
    [filteredExpenses]
  );

  const categoryChartData = useMemo(() => {
    const categoryMap: Record<string, number> = {};
    filteredExpenses.forEach(e => {
      categoryMap[e.category] = (categoryMap[e.category] || 0) + e.amount;
    });

    return Object.entries(categoryMap)
      .map(([name, value]) => ({
        name,
        value: Number(value.toFixed(2))
      }))
      .sort((a, b) => b.value - a.value);
  }, [filteredExpenses]);

  const expenseCategoryOptions = useMemo(() => {
    const base = (data.settings.customExpenseCategories || []).filter(Boolean);
    return base.length > 0 ? Array.from(new Set(base)) : ['Other'];
  }, [data.settings.customExpenseCategories]);

  const filterCategoryOptions = useMemo(() => {
    const merged = new Set(expenseCategoryOptions);
    data.expenses.forEach(exp => {
      if (exp.category) merged.add(exp.category);
    });
    return Array.from(merged);
  }, [expenseCategoryOptions, data.expenses]);

  const modalCategoryOptions = useMemo(() => {
    if (category && !expenseCategoryOptions.includes(category)) {
      return [category, ...expenseCategoryOptions];
    }
    return expenseCategoryOptions;
  }, [expenseCategoryOptions, category]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        description="Log, categorize, and analyze your personal expenditures."
        actions={
          <button
            onClick={openCreateModal}
            type="button"
            className={PRIMARY_BUTTON_CLASS}
          >
            <Plus className="w-4 h-4" />
            <span>Add Expense</span>
          </button>
        }
      />

      {/* Summary & Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-stretch">
        <MetricCard
          variant="focal"
          label="Total Expenses"
          value={formatCurrency(totalExpenseSum, data.settings.currency)}
          sublabel={`${filteredExpenses.length} ${filteredExpenses.length === 1 ? 'transaction' : 'transactions'} · ${categoryChartData.length} ${categoryChartData.length === 1 ? 'category' : 'categories'}`}
        />

        <SectionCard
          title="Expense Distribution"
          subtitle="Spending breakdown by category"
          className="lg:col-span-3"
        >
          {categoryChartData.length === 0 ? (
            <div className="h-36 flex items-center justify-center text-xs text-[#86868b]">
              No expense transactions logged yet. Add an expense to view distribution.
            </div>
          ) : (
            <div className="h-40 w-full flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={38}
                    outerRadius={58}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {categoryChartData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(val: any) => [formatCurrency(Number(val || 0), data.settings.currency), 'Amount']}
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      color: '#1d1d1f',
                      borderRadius: '12px',
                      fontSize: '12px',
                      border: '1px solid rgba(0,0,0,0.08)',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.08)'
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', color: '#6e6e73' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Filters */}
      <FilterBar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search expense titles or notes…"
        searchAriaLabel="Search expenses"
        filters={
          <>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              aria-label="Filter by category"
              className={`${SELECT_CLASS} sm:w-44`}
            >
              <option value="all">All Categories</option>
              {filterCategoryOptions.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <select
              value={selectedPaymentMethod}
              onChange={(e) => setSelectedPaymentMethod(e.target.value)}
              aria-label="Filter by payment method"
              className={`${SELECT_CLASS} sm:w-48`}
            >
              <option value="all">All Payment Methods</option>
              <option value="Cash">Cash</option>
              <option value="Credit Card">Credit Card</option>
              <option value="Debit Card">Debit Card</option>
              <option value="Bank Transfer">Bank Transfer</option>
              <option value="Digital Wallet">Digital Wallet</option>
            </select>
          </>
        }
      />

      {/* Data Presentation */}
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
          {/* Mobile List */}
          <div className="md:hidden divide-y divide-black/[0.06] bg-white rounded-2xl border border-black/[0.08] overflow-hidden">
            {filteredExpenses.map((exp) => {
              const isDebtSynced = Boolean(exp.debtRepaymentId && syncedRepaymentIds.has(exp.debtRepaymentId));
              return (
                <div key={exp.id} className="cv-auto p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="font-medium text-sm text-[#1d1d1f] block truncate">{exp.title}</span>
                      <span className="text-xs text-[#6e6e73] block truncate mt-0.5">
                        {exp.category} · {exp.paymentMethod}
                        {isDebtSynced ? ' · From Debt Repayment' : ''}
                      </span>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-mono font-semibold text-sm text-[#1d1d1f] block tabular-nums">
                        {formatCurrency(exp.amount, data.settings.currency)}
                      </span>
                      <span className="text-[11px] text-[#86868b] font-mono tabular-nums block">
                        {formatHumanDate(exp.date)}{exp.time ? ` · ${exp.time}` : ''}
                      </span>
                    </div>
                  </div>

                  {exp.notes && (
                    <p className="text-xs text-[#6e6e73] leading-relaxed">
                      {exp.notes}
                    </p>
                  )}

                  <div className="flex items-center justify-between pt-1 text-xs text-[#86868b]">
                    <span>{exp.isRecurring ? `Recurring · ${exp.recurringFrequency}` : 'One-time'}</span>
                    {isDebtSynced ? (
                      <span className="text-xs text-[#6e6e73]">Managed in Debt</span>
                    ) : (
                      <div className="flex items-center gap-1 -mr-1">
                        <ActionIconButton
                          icon={Edit3}
                          label="Edit expense"
                          variant="edit"
                          onClick={() => openEditModal(exp)}
                        />
                        <ActionIconButton
                          icon={Trash2}
                          label="Delete expense"
                          variant="delete"
                          onClick={() => handleDelete(exp.id)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block bg-white rounded-2xl border border-black/[0.08] overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#fbfbfd] border-b border-black/[0.06] text-[11px] font-medium text-[#6e6e73]">
                  <th className="py-3 px-4">Title &amp; Notes</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Payment Method</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06] text-[13px] text-[#1d1d1f]">
                {filteredExpenses.map((exp) => {
                  const isDebtSynced = Boolean(exp.debtRepaymentId && syncedRepaymentIds.has(exp.debtRepaymentId));
                  return (
                    <tr key={exp.id} className="hover:bg-[#f5f5f7]/60 transition-colors">
                      <td className="py-3 px-4">
                        <span className="font-medium text-[#1d1d1f] block">
                          {exp.title}
                          {isDebtSynced && (
                            <span className="ml-2 text-xs font-normal text-[#0284c7]">· From Debt</span>
                          )}
                        </span>
                        {exp.notes && <span className="text-xs text-[#6e6e73] block mt-0.5">{exp.notes}</span>}
                      </td>
                      <td className="py-3 px-4 text-[#1d1d1f]">
                        {exp.category}
                        {exp.isRecurring && (
                          <span className="text-xs text-[#6e6e73] ml-1.5">· {exp.recurringFrequency}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-[#6e6e73] tabular-nums">
                        {formatHumanDate(exp.date)} {exp.time ? `· ${exp.time}` : ''}
                      </td>
                      <td className="py-3 px-4 text-[#6e6e73]">
                        {exp.paymentMethod}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-[#1d1d1f] tabular-nums">
                        {formatCurrency(exp.amount, data.settings.currency)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {isDebtSynced ? (
                          <span
                            className="text-xs text-[#86868b]"
                            title="Manage or delete this repayment inside the Debt section"
                          >
                            Managed in Debt
                          </span>
                        ) : (
                          <div className="inline-flex items-center justify-end gap-0.5">
                            <ActionIconButton
                              icon={Edit3}
                              label="Edit expense"
                              variant="edit"
                              onClick={() => openEditModal(exp)}
                            />
                            <ActionIconButton
                              icon={Trash2}
                              label="Delete expense"
                              variant="delete"
                              onClick={() => handleDelete(exp.id)}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Modal Add / Edit Expense */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => { if (!isSubmitting) setIsModalOpen(false); }}
        disableClose={isSubmitting}
        title={editingExpense ? 'Edit Expense' : 'Log Expense'}
        subtitle="Record transaction details and payment method."
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
              form="expense-form"
              disabled={isSubmitting}
              className={PRIMARY_BUTTON_CLASS}
            >
              {isSubmitting ? 'Saving…' : (editingExpense ? 'Update Expense' : 'Save Expense')}
            </button>
          </>
        }
      >
        <form id="expense-form" onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="p-3 text-xs bg-rose-50 border border-rose-200 text-rose-700 rounded-xl font-medium">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className={LABEL_CLASS}>Title *</label>
              <input
                type="text"
                required
                placeholder="e.g. Grocery supplies"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Amount ({data.settings.currency}) *</label>
              <input
                type="number"
                step="0.01"
                required
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={MONO_INPUT_CLASS}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div>
              <label className={LABEL_CLASS}>Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={SELECT_CLASS}
              >
                {modalCategoryOptions.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLASS}>Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Time (HH:mm)</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className={MONO_INPUT_CLASS}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className={LABEL_CLASS}>Payment Method</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                className={SELECT_CLASS}
              >
                <option value="Cash">Cash</option>
                <option value="Credit Card">Credit Card</option>
                <option value="Debit Card">Debit Card</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Digital Wallet">Digital Wallet</option>
              </select>
            </div>
            <div>
              <label className={LABEL_CLASS}>Notes</label>
              <input
                type="text"
                placeholder="Optional memo"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-[#1d1d1f] cursor-pointer min-h-[36px]">
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
                  className="rounded border-black/20 text-[#0284c7] focus:ring-[#0284c7]"
                />
                <span>Mark as recurring</span>
              </label>

              {isRecurring && (
                <select
                  value={recurringFrequency}
                  onChange={(e) => setRecurringFrequency(e.target.value as RecurrenceFrequency)}
                  className={`${SELECT_CLASS} sm:w-40`}
                >
                  <option value="Daily">Daily</option>
                  <option value="Weekly">Weekly</option>
                  <option value="Monthly">Monthly</option>
                  <option value="Yearly">Yearly</option>
                </select>
              )}
            </div>
            {isRecurring && (
              <p className="text-xs text-[#6e6e73]">
                Labels this expense with a recurring schedule for tracking; future entries are logged manually.
              </p>
            )}
          </div>
        </form>
      </Modal>

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
            if (import.meta.env?.DEV) {
              console.error('Delete expense failed:', err);
            }
            setDeleteError(sanitizeDatabaseErrorMessage(err, 'Failed to delete expense record.'));
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
