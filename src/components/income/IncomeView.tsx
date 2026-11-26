import React, { useState, useMemo, useRef } from 'react';
import { TrendingUp, Plus, Trash2, Edit3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useXOSData } from '../../hooks/useXOSData';
import { Income, IncomeSource } from '../../types';
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

const BAR_COLORS = ['#0071e3', '#1f7a4c', '#1d1d1f', '#5ac8fa', '#6e6e73', '#aeaeb2'];

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
  const isSubmittingRef = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form Fields
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState<IncomeSource>(() => data.settings.customIncomeSources[0] || 'Other');
  const [date, setDate] = useState(getTodayString());
  const [time, setTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [notes, setNotes] = useState('');

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
    if (isSubmittingRef.current || isSubmitting) return;

    if (!title.trim()) {
      setFormError('Income title is required.');
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
      if (import.meta.env?.DEV) {
        console.error('Failed to save income:', err);
      }
      setFormError(sanitizeDatabaseErrorMessage(err, 'Database error: Could not save income.'));
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleDelete = (id: string) => {
    setDeleteError(null);
    setDeleteTargetId(id);
  };

  const syncedPayoutIds = useMemo(
    () => new Set(data.salaryPayouts.map(p => p.id)),
    [data.salaryPayouts]
  );

  const filteredIncomes = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return data.incomes.filter(i => {
      if (selectedSource !== 'all' && i.source !== selectedSource) return false;
      if (q) {
        return i.title.toLowerCase().includes(q) || (i.notes && i.notes.toLowerCase().includes(q));
      }
      return true;
    });
  }, [data.incomes, selectedSource, searchQuery]);

  const totalIncomeSum = useMemo(
    () => filteredIncomes.reduce((sum, i) => sum + i.amount, 0),
    [filteredIncomes]
  );

  const sourceChartData = useMemo(() => {
    const sourceMap: Record<string, number> = {};
    filteredIncomes.forEach(i => {
      sourceMap[i.source] = (sourceMap[i.source] || 0) + i.amount;
    });

    return Object.entries(sourceMap)
      .map(([name, value]) => ({
        name,
        amount: Number(value.toFixed(2))
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [filteredIncomes]);

  const incomeSourceOptions = useMemo(() => {
    const base = (data.settings.customIncomeSources || []).filter(Boolean);
    return base.length > 0 ? Array.from(new Set(base)) : ['Other'];
  }, [data.settings.customIncomeSources]);

  const filterSourceOptions = useMemo(() => {
    const merged = new Set(incomeSourceOptions);
    data.incomes.forEach(inc => {
      if (inc.source) merged.add(inc.source);
    });
    return Array.from(merged);
  }, [incomeSourceOptions, data.incomes]);

  const modalSourceOptions = useMemo(() => {
    if (source && !incomeSourceOptions.includes(source)) {
      return [source, ...incomeSourceOptions];
    }
    return incomeSourceOptions;
  }, [incomeSourceOptions, source]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Income"
        description="Track salaries, freelance earnings, investments, and other revenue streams."
        actions={
          <button
            onClick={openCreateModal}
            type="button"
            className={PRIMARY_BUTTON_CLASS}
          >
            <Plus className="w-4 h-4" />
            <span>Log Income</span>
          </button>
        }
      />

      {/* Unified Summary & Chart Stage */}
      <section aria-label="Revenue Overview" className="rounded-3xl bg-[#f5f5f7] p-4 sm:p-5">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
          <div className="lg:col-span-4 rounded-2xl bg-white border border-black/[0.06] p-5 sm:p-6 flex flex-col justify-between gap-4">
            <span className="text-xs font-medium text-[#6e6e73]">Total Revenue</span>
            <div>
              <div className="text-[28px] sm:text-[32px] font-semibold font-mono tabular-nums tracking-[-0.03em] text-[#1f7a4c] leading-tight">
                {formatCurrency(totalIncomeSum, data.settings.currency)}
              </div>
              <p className="mt-1.5 text-xs text-[#86868b]">
                {filteredIncomes.length} {filteredIncomes.length === 1 ? 'entry' : 'entries'} · {sourceChartData.length} {sourceChartData.length === 1 ? 'source' : 'sources'}
              </p>
            </div>
          </div>

          <SectionCard
            title="Revenue by Source"
            subtitle="Earnings across income categories"
            className="lg:col-span-8"
          >
            {sourceChartData.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-xs text-[#86868b]">
                No revenue entries logged yet. Log income to view breakdown by source.
              </div>
            ) : (
              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sourceChartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6e6e73' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#6e6e73' }} axisLine={false} tickLine={false} />
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
                    <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                      {sourceChartData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </SectionCard>
        </div>
      </section>

      {/* Filters */}
      <FilterBar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search income descriptions or notes…"
        searchAriaLabel="Search income"
        filters={
          <select
            value={selectedSource}
            onChange={(e) => setSelectedSource(e.target.value)}
            aria-label="Filter by income source"
            className={`${SELECT_CLASS} sm:w-52`}
          >
            <option value="all">All Income Sources</option>
            {filterSourceOptions.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        }
      />

      {/* Data Presentation */}
      {filteredIncomes.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          iconName="income"
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
          {/* Mobile List */}
          <div className="md:hidden divide-y divide-black/[0.06] bg-white rounded-2xl border border-black/[0.08] overflow-hidden">
            {filteredIncomes.map((inc) => {
              const isSynced = Boolean(inc.salaryPayoutId && syncedPayoutIds.has(inc.salaryPayoutId));
              return (
                <div key={inc.id} className="cv-auto p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="font-medium text-sm text-[#1d1d1f] block truncate">{inc.title}</span>
                      <span className="text-xs text-[#6e6e73] block truncate mt-0.5">
                        {inc.source}
                        {isSynced ? ' · Payout Synced' : ''}
                      </span>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-mono font-semibold text-sm text-[#1f7a4c] block tabular-nums">
                        +{formatCurrency(inc.amount, data.settings.currency)}
                      </span>
                      <span className="text-[11px] text-[#86868b] font-mono tabular-nums block">
                        {formatHumanDate(inc.date)}{inc.time ? ` · ${inc.time}` : ''}
                      </span>
                    </div>
                  </div>

                  {inc.notes && (
                    <p className="text-xs text-[#6e6e73] leading-relaxed">
                      {inc.notes}
                    </p>
                  )}

                  <div className="flex items-center justify-end pt-1 text-xs text-[#86868b]">
                    {isSynced ? (
                      <span className="text-xs text-[#6e6e73]">Managed via Salary Payout</span>
                    ) : (
                      <div className="flex items-center gap-1 -mr-1">
                        <ActionIconButton
                          icon={Edit3}
                          label="Edit income"
                          variant="edit"
                          onClick={() => openEditModal(inc)}
                        />
                        <ActionIconButton
                          icon={Trash2}
                          label="Delete income"
                          variant="delete"
                          onClick={() => handleDelete(inc.id)}
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
                  <th className="py-3 px-4">Title &amp; Details</th>
                  <th className="py-3 px-4">Source</th>
                  <th className="py-3 px-4">Date Received</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06] text-[13px] text-[#1d1d1f]">
                {filteredIncomes.map((inc) => {
                  const isSynced = Boolean(inc.salaryPayoutId && syncedPayoutIds.has(inc.salaryPayoutId));
                  return (
                    <tr key={inc.id} className="hover:bg-[#f5f5f7]/60 transition-colors">
                      <td className="py-3 px-4">
                        <span className="font-medium text-[#1d1d1f] block">
                          {inc.title}
                          {isSynced && (
                            <span className="ml-2 text-xs font-normal text-[#0071e3]">· Payout Synced</span>
                          )}
                        </span>
                        {inc.notes && <span className="text-xs text-[#6e6e73] block mt-0.5">{inc.notes}</span>}
                      </td>
                      <td className="py-3 px-4 text-[#1d1d1f]">
                        {inc.source}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-[#6e6e73] tabular-nums">
                        {formatHumanDate(inc.date)} {inc.time ? `· ${inc.time}` : ''}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-[#1f7a4c] tabular-nums">
                        +{formatCurrency(inc.amount, data.settings.currency)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {isSynced ? (
                          <span
                            className="text-xs text-[#86868b]"
                            title="Manage or delete this payout inside the Salary section"
                          >
                            Managed in Salary
                          </span>
                        ) : (
                          <div className="inline-flex items-center justify-end gap-0.5">
                            <ActionIconButton
                              icon={Edit3}
                              label="Edit income"
                              variant="edit"
                              onClick={() => openEditModal(inc)}
                            />
                            <ActionIconButton
                              icon={Trash2}
                              label="Delete income"
                              variant="delete"
                              onClick={() => handleDelete(inc.id)}
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

      {/* Modal Add / Edit Income */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => { if (!isSubmitting) setIsModalOpen(false); }}
        disableClose={isSubmitting}
        title={editingIncome ? 'Edit Income' : 'Log Income'}
        subtitle="Record received earnings and revenue source."
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
              form="income-form"
              disabled={isSubmitting}
              className={PRIMARY_BUTTON_CLASS}
            >
              {isSubmitting ? 'Saving…' : (editingIncome ? 'Update Income' : 'Save Income')}
            </button>
          </>
        }
      >
        <form id="income-form" onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="p-3 text-xs bg-[#fef2f2] border border-[#c92a2a]/20 text-[#991b1b] rounded-xl font-medium">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className={LABEL_CLASS}>Title *</label>
              <input
                type="text"
                required
                placeholder="e.g. Monthly Salary"
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
              <label className={LABEL_CLASS}>Source</label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className={SELECT_CLASS}
              >
                {modalSourceOptions.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLASS}>Date Received</label>
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

          <div>
            <label className={LABEL_CLASS}>Notes</label>
            <input
              type="text"
              placeholder="Optional details"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        </form>
      </Modal>

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
            if (import.meta.env?.DEV) {
              console.error('Delete income failed:', err);
            }
            setDeleteError(sanitizeDatabaseErrorMessage(err, 'Failed to delete income record.'));
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
