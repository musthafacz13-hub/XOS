import React, { useState, useEffect } from 'react';
import { Target, Plus, CheckCircle2, Clock, Trash2, Edit3, Search, X } from 'lucide-react';
import { useXOSData } from '../../hooks/useXOSData';
import { Goal, GoalCategory, GoalPriority, GoalStatus } from '../../types';
import { formatCurrency, formatHumanDate } from '../../utils/formatters';
import { EmptyState } from '../common/EmptyState';
import { ConfirmDialog } from '../common/ConfirmDialog';

export const GoalsView: React.FC = () => {
  const data = useXOSData();

  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'completed'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Confirmation dialog state
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form Fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<GoalCategory>('Personal');
  const [targetAmount, setTargetAmount] = useState('');
  const [progressPercentage, setProgressPercentage] = useState('0');
  const [status, setStatus] = useState<GoalStatus>('In Progress');
  const [targetDate, setTargetDate] = useState('');
  const [priority, setPriority] = useState<GoalPriority>('Medium');

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
    setEditingGoal(null);
    setFormError(null);
    setIsSubmitting(false);
    setTitle('');
    setDescription('');
    setCategory('Personal');
    setTargetAmount('');
    setProgressPercentage('0');
    setStatus('In Progress');
    setTargetDate('');
    setPriority('Medium');
    setIsModalOpen(true);
  };

  const openEditModal = (g: Goal) => {
    setEditingGoal(g);
    setFormError(null);
    setIsSubmitting(false);
    setTitle(g.title);
    setDescription(g.description || '');
    setCategory(g.category);
    setTargetAmount(g.targetAmount !== undefined ? String(g.targetAmount) : '');
    setProgressPercentage(String(g.progressPercentage ?? 0));
    setStatus(g.status);
    setTargetDate(g.targetDate || '');
    setPriority(g.priority);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || isSubmitting) return;

    const parsedTarget = parseFloat(targetAmount);
    if (isNaN(parsedTarget) || parsedTarget <= 0) {
      setFormError('Target amount is required and must be greater than zero.');
      return;
    }

    setFormError(null);
    setIsSubmitting(true);
    try {
      if (editingGoal) {
        await data.updateGoal(editingGoal.id, {
          title: title.trim(),
          description: description.trim(),
          category,
          targetAmount: parsedTarget,
          targetDate: targetDate || undefined,
          priority,
          status
        });
      } else {
        await data.addGoal({
          title: title.trim(),
          description: description.trim(),
          category,
          targetAmount: parsedTarget,
          targetDate: targetDate || undefined,
          priority
        });
      }
      setIsModalOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save goal.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleComplete = async (g: Goal) => {
    setActionError(null);
    const isComp = g.status === 'Completed';
    try {
      await data.updateGoal(g.id, {
        status: isComp ? 'In Progress' : 'Completed'
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update goal status.');
    }
  };

  const handleDelete = (id: string) => {
    setDeleteError(null);
    setDeleteTargetId(id);
  };

  const filteredGoals = data.goals.filter(g => {
    if (activeTab === 'active' && g.status === 'Completed') return false;
    if (activeTab === 'completed' && g.status !== 'Completed') return false;
    if (selectedCategory !== 'all' && g.category !== selectedCategory) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return g.title.toLowerCase().includes(q) || g.description.toLowerCase().includes(q);
    }
    return true;
  });

  const categories = ['Financial', 'Career', 'Health', 'Travel', 'Learning', 'Life', 'Personal'];

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-black/[0.06]">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-[#111111] tracking-tight">
            Goals & Dreams
          </h2>
          <p className="text-xs sm:text-sm text-neutral-500 font-normal mt-0.5">
            Organize actionable milestones, targets, and personal aspirations.
          </p>
        </div>

        <button
          onClick={openCreateModal}
          type="button"
          className="self-start sm:self-auto flex items-center gap-1.5 px-3.5 py-2 bg-[#111111] text-white text-xs font-semibold rounded-xl hover:bg-black transition-colors shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
        >
          <Plus className="w-4 h-4 text-[#87CEEB]" />
          <span>New Goal</span>
        </button>
      </div>

      {actionError && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center justify-between gap-2">
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-rose-700 hover:text-rose-900 font-semibold cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Summary & Quick Actions Dashboard Header */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        {/* Main Metric: Active Goals */}
        <div className="p-5 rounded-2xl bg-[#111111] text-white shadow-xs flex flex-col justify-between">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Active Milestones
            </span>
            <div className="text-3xl font-extrabold font-mono tracking-tight text-white mt-1 tabular-nums">
              {data.goals.filter(g => g.status !== 'Completed').length}
            </div>
            <p className="text-xs text-neutral-400 mt-1">
              Out of {data.goals.length} total target records
            </p>
          </div>
        </div>

        {/* Completion Rate */}
        <div className="p-5 rounded-2xl bg-white border border-black/[0.08] shadow-xs flex flex-col justify-between">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              Overall Completion Progress
            </span>
            <div className="text-3xl font-bold font-mono text-emerald-600 mt-1 tabular-nums">
              {data.goals.length > 0 ? Math.round((data.goals.filter(g => g.status === 'Completed').length / data.goals.length) * 100) : 0}%
            </div>
            <p className="text-xs text-neutral-400 mt-1">
              {data.goals.filter(g => g.status === 'Completed').length} targets accomplished
            </p>
          </div>
        </div>

        {/* Quick Actions Card */}
        <div className="p-5 rounded-2xl bg-white border border-black/[0.08] shadow-xs flex flex-col justify-between space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            Goal Quick Actions
          </span>
          <div className="flex flex-col gap-2">
            <button
              onClick={openCreateModal}
              type="button"
              className="w-full py-2 bg-[#111111] text-white text-xs font-semibold rounded-xl hover:bg-black transition-colors cursor-pointer text-center"
            >
              + Create New Goal
            </button>
            <button
              onClick={() => setActiveTab(activeTab === 'completed' ? 'all' : 'completed')}
              type="button"
              className="w-full py-2 bg-neutral-100 text-[#111111] border border-neutral-200 text-xs font-semibold rounded-xl hover:bg-neutral-200 transition-colors cursor-pointer text-center"
            >
              {activeTab === 'completed' ? 'View All Goals' : 'View Completed Goals'}
            </button>
          </div>
        </div>
      </div>

      {/* Tabs & Search Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 bg-neutral-50 p-2 rounded-2xl border border-neutral-200">
        {/* Segmented Tab Filter */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0">
          {[
            { id: 'all', label: 'All Targets' },
            { id: 'active', label: 'In Progress' },
            { id: 'completed', label: 'Completed' }
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as 'all' | 'active' | 'completed')}
              type="button"
              className={`px-3 py-1.5 text-xs font-medium rounded-xl transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === t.id
                  ? 'bg-white text-[#111111] shadow-xs font-semibold'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Category & Search Filter */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
          <div className="relative flex-1 min-w-[160px] md:w-48">
            <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search goals..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full min-h-[40px] pl-8 pr-3 py-2 text-xs border border-neutral-200 rounded-lg bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
            />
          </div>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full sm:w-auto min-h-[40px] px-2.5 py-2 text-xs border border-neutral-200 rounded-lg bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
          >
            <option value="all">All Categories</option>
            {categories.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Goal Cards Grid or Empty State */}
      {filteredGoals.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No goals yet. Create your first goal."
          description={
            searchQuery || selectedCategory !== 'all' || activeTab !== 'all'
              ? 'No targets match your current filters. Try resetting the filters.'
              : 'Keep track of what truly matters by defining your first milestone.'
          }
          actionLabel="Create First Goal"
          onAction={openCreateModal}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {filteredGoals.map((goal) => {
            const isCompleted = goal.status === 'Completed';
            const hasAmount = goal.targetAmount !== undefined && goal.targetAmount > 0;
            const progressPct = Math.max(0, Math.min(100, Math.round(goal.progressPercentage ?? 0)));

            return (
              <div
                key={goal.id}
                className={`p-5 rounded-2xl border bg-white transition-all shadow-xs flex flex-col justify-between space-y-4 ${
                  isCompleted ? 'border-neutral-200 bg-neutral-50/50' : 'border-black/[0.08] hover:border-black/20'
                }`}
              >
                {/* Card Top */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-neutral-500 font-medium">
                    <span className="uppercase tracking-wider text-[10px]">
                      {goal.category} · {goal.status}
                    </span>
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-700">
                      {goal.priority}
                    </span>
                  </div>

                  {/* Title & Complete Check */}
                  <div className="flex items-start justify-between gap-3">
                    <h3 className={`font-bold text-base text-[#111111] leading-snug break-words ${
                      isCompleted ? 'line-through text-neutral-400' : ''
                    }`}>
                      {goal.title}
                    </h3>

                    <button
                      onClick={() => handleToggleComplete(goal)}
                      type="button"
                      title={isCompleted ? 'Mark as In Progress' : 'Mark as Completed'}
                      className={`p-1 rounded-lg transition-colors shrink-0 cursor-pointer ${
                        isCompleted ? 'text-[#111111] bg-neutral-100' : 'text-neutral-300 hover:text-black'
                      }`}
                    >
                      <CheckCircle2 className="w-5 h-5" />
                    </button>
                  </div>

                  {goal.description && (
                    <p className="text-xs text-neutral-600 leading-relaxed line-clamp-2">
                      {goal.description}
                    </p>
                  )}

                  <div className="p-3 rounded-xl bg-neutral-50 border border-neutral-100 space-y-1.5">
                    <div className="flex justify-between text-xs font-mono font-medium tabular-nums">
                      <span className="text-neutral-700">
                        {hasAmount
                          ? `Target: ${formatCurrency(goal.targetAmount!, data.settings.currency)}`
                          : 'Progress'}
                      </span>
                      <span className="text-neutral-700 font-bold">{progressPct}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-neutral-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${isCompleted ? 'bg-emerald-500' : 'bg-[#87CEEB]'}`}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Card Bottom Meta */}
                <div className="pt-3 border-t border-black/[0.06] flex items-center justify-between text-xs text-neutral-400">
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{goal.targetDate ? formatHumanDate(goal.targetDate) : 'Open deadline'}</span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEditModal(goal)}
                      type="button"
                      className="p-1.5 text-neutral-400 hover:text-black transition-colors cursor-pointer"
                      title="Edit Goal"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(goal.id)}
                      type="button"
                      className="p-1.5 text-neutral-400 hover:text-rose-600 transition-colors cursor-pointer"
                      title="Delete Goal"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Create / Edit Goal */}
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
                {editingGoal ? 'Edit Goal' : 'New Goal'}
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
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl font-medium">
                  {formError}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Build emergency reserve fund"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">Description (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="Why is this important?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  >
                    {categories.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Status</label>
                  <select
                    value={status}
                    onChange={(e) => {
                      const next = e.target.value as GoalStatus;
                      setStatus(next);
                      if (next === 'Completed') setProgressPercentage('100');
                    }}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  >
                    <option value="Not Started">Not Started</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Paused">Paused</option>
                    <option value="Completed">Completed</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Target Amount (Optional)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="e.g. 5000"
                    value={targetAmount}
                    onChange={(e) => setTargetAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Progress (0–100%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={progressPercentage}
                    onChange={(e) => setProgressPercentage(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Target Date (Optional)</label>
                  <input
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">Priority</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as GoalPriority)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </select>
                </div>
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
                  {isSubmitting ? 'Saving...' : 'Save Goal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Accessible Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteTargetId !== null}
        title="Delete Goal"
        message="Are you sure you want to permanently delete this goal? Any progress tracked will be lost."
        confirmLabel="Delete Goal"
        isLoading={isDeleting}
        error={deleteError}
        onConfirm={async () => {
          if (!deleteTargetId || isDeleting) return;
          setIsDeleting(true);
          setDeleteError(null);
          try {
            await data.deleteGoal(deleteTargetId);
            setDeleteTargetId(null);
          } catch (err) {
            setDeleteError(err instanceof Error ? err.message : 'Failed to delete goal.');
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
