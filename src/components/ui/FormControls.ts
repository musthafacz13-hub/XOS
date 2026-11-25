/**
 * Shared Apple-style Form & Control Class Tokens for XOS
 * Guarantees >=44px mobile touch targets, 16px mobile input font (prevents iOS zoom),
 * consistent hairline borders, and unified sky-blue focus rings.
 */

export const LABEL_CLASS =
  'block text-xs font-medium text-[#6e6e73] mb-1.5';

export const INPUT_CLASS =
  'w-full min-h-[44px] sm:min-h-[40px] px-3.5 py-2 text-base sm:text-sm text-[#1d1d1f] bg-white border border-black/[0.12] rounded-xl placeholder:text-[#86868b] transition-colors focus:outline-none focus:border-[#0284c7] focus:ring-2 focus:ring-[#0284c7]/15 disabled:bg-[#f5f5f7] disabled:text-[#86868b]';

export const MONO_INPUT_CLASS =
  'w-full min-h-[44px] sm:min-h-[40px] px-3.5 py-2 text-base sm:text-sm font-mono tabular-nums text-[#1d1d1f] bg-white border border-black/[0.12] rounded-xl placeholder:text-[#86868b] transition-colors focus:outline-none focus:border-[#0284c7] focus:ring-2 focus:ring-[#0284c7]/15 disabled:bg-[#f5f5f7] disabled:text-[#86868b]';

export const SELECT_CLASS =
  'w-full min-h-[44px] sm:min-h-[40px] px-3.5 py-2 text-base sm:text-sm text-[#1d1d1f] bg-white border border-black/[0.12] rounded-xl transition-colors focus:outline-none focus:border-[#0284c7] focus:ring-2 focus:ring-[#0284c7]/15 disabled:bg-[#f5f5f7] disabled:text-[#86868b]';

export const TEXTAREA_CLASS =
  'w-full px-3.5 py-2.5 text-base sm:text-sm text-[#1d1d1f] bg-white border border-black/[0.12] rounded-xl placeholder:text-[#86868b] transition-colors focus:outline-none focus:border-[#0284c7] focus:ring-2 focus:ring-[#0284c7]/15 resize-none';

export const PRIMARY_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-[40px] px-4 py-2 text-[13px] font-medium text-white bg-[#1d1d1f] hover:bg-black rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0284c7] disabled:opacity-50 disabled:cursor-not-allowed';

export const ACCENT_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-[40px] px-4 py-2 text-[13px] font-medium text-white bg-[#0284c7] hover:bg-[#0369a1] rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0284c7] disabled:opacity-50 disabled:cursor-not-allowed';

export const SECONDARY_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-[40px] px-4 py-2 text-[13px] font-medium text-[#1d1d1f] bg-white hover:bg-[#f5f5f7] border border-black/[0.12] rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0284c7] disabled:opacity-50 disabled:cursor-not-allowed';

export const SUBTLE_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-[40px] px-3.5 py-2 text-[13px] font-medium text-[#1d1d1f] bg-[#f5f5f7] hover:bg-[#e8e8ed] rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0284c7] disabled:opacity-50 disabled:cursor-not-allowed';

export const DANGER_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-[40px] px-4 py-2 text-[13px] font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50 disabled:cursor-not-allowed';
