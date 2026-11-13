import { CurrencyCode, DateFormat } from '../types';

export const CURRENCIES: Record<CurrencyCode, { symbol: string; name: string }> = {
  USD: { symbol: '$', name: 'US Dollar ($)' },
  EUR: { symbol: '€', name: 'Euro (€)' },
  GBP: { symbol: '£', name: 'British Pound (£)' },
  INR: { symbol: '₹', name: 'Indian Rupee (₹)' },
  JPY: { symbol: '¥', name: 'Japanese Yen (¥)' },
  AUD: { symbol: 'A$', name: 'Australian Dollar (A$)' },
  CAD: { symbol: 'C$', name: 'Canadian Dollar (C$)' },
  SGD: { symbol: 'S$', name: 'Singapore Dollar (S$)' },
  AED: { symbol: 'AED', name: 'UAE Dirham (AED)' },
  BRL: { symbol: 'R$', name: 'Brazilian Real (R$)' }
};

export function formatCurrency(amount: number, currencyCode: CurrencyCode = 'INR'): string {
  const currency = CURRENCIES[currencyCode] || CURRENCIES.INR;
  const isINR = currencyCode === 'INR';
  const hasDecimals = (amount || 0) % 1 !== 0;
  const formattedNumber = new Intl.NumberFormat(isINR ? 'en-IN' : 'en-US', {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amount || 0);

  return `${currency.symbol}${formattedNumber}`;
}

export function parseCalendarDate(dateInput: string | Date): Date {
  if (dateInput instanceof Date) return dateInput;
  const trimmed = dateInput.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const localDate = new Date(year, month, day);
    if (
      localDate.getFullYear() === year &&
      localDate.getMonth() === month &&
      localDate.getDate() === day
    ) {
      return localDate;
    }
    return new Date(NaN);
  }
  return new Date(trimmed);
}

export function formatDate(dateStr: string | Date | undefined, format: DateFormat = 'YYYY-MM-DD'): string {
  if (!dateStr) return '';
  const d = parseCalendarDate(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');

  switch (format) {
    case 'MM/DD/YYYY':
      return `${month}/${day}/${year}`;
    case 'DD/MM/YYYY':
      return `${day}/${month}/${year}`;
    case 'YYYY-MM-DD':
    default:
      return `${year}-${month}-${day}`;
  }
}

export function formatHumanDate(dateStr: string | Date | undefined): string {
  if (!dateStr) return '';
  const d = parseCalendarDate(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);

  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

export function getTodayString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getMonthString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function calculateWorkingHours(checkIn?: string, checkOut?: string, breakMins: number = 0): number {
  if (!checkIn || !checkOut) return 0;
  const [inH, inM] = checkIn.split(':').map(Number);
  const [outH, outM] = checkOut.split(':').map(Number);

  if (isNaN(inH) || isNaN(inM) || isNaN(outH) || isNaN(outM)) return 0;

  const startMinutes = inH * 60 + inM;
  let endMinutes = outH * 60 + outM;

  if (endMinutes < startMinutes) {
    // Overnight shift
    endMinutes += 24 * 60;
  }

  const durationMinutes = Math.max(0, endMinutes - startMinutes - (breakMins || 0));
  return Number((durationMinutes / 60).toFixed(2));
}

export function getPayoutDateForMonth(yearMonth: string, paymentDay: number = 1): string {
  if (!yearMonth || !yearMonth.includes('-')) return getTodayString();
  const [yStr, mStr] = yearMonth.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) return getTodayString();
  const daysInMonth = new Date(year, month, 0).getDate();
  const clampedDay = Math.min(Math.max(1, Math.round(paymentDay || 1)), daysInMonth);
  return `${year}-${String(month).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

export function normalizeDbTime(time?: string | null): string | null {
  if (!time) return null;
  const trimmed = time.trim();
  if (!trimmed) return null;
  if (/^\d{2}:\d{2}$/.test(trimmed)) return `${trimmed}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(trimmed)) return trimmed;
  return trimmed;
}

/**
 * Formats a Date as YYYY-MM-DD in local calendar time, or at a specified
 * fixed UTC offset in minutes (e.g. +330 for IST UTC+05:30).
 */
export function formatLocalCalendarDate(date: Date = new Date(), utcOffsetMinutes?: number): string {
  if (utcOffsetMinutes !== undefined) {
    const shifted = new Date(date.getTime() + utcOffsetMinutes * 60_000);
    const y = shifted.getUTCFullYear();
    const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const d = String(shifted.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Formats a Date's wall-clock time as HH:mm:ss in local time, or at a specified
 * fixed UTC offset in minutes (e.g. +330 for IST UTC+05:30).
 */
export function formatLocalTimeHMS(date: Date = new Date(), utcOffsetMinutes?: number): string {
  if (utcOffsetMinutes !== undefined) {
    const shifted = new Date(date.getTime() + utcOffsetMinutes * 60_000);
    const hh = String(shifted.getUTCHours()).padStart(2, '0');
    const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
    const ss = String(shifted.getUTCSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/**
 * Converts a stored UTC/offset timestamp (e.g. 2026-05-30T19:00:00Z) back into
 * the local YYYY-MM-DD calendar date without naive .slice(0, 10) UTC truncation.
 */
export function utcTimestampToLocalDate(timestamp?: string | null, utcOffsetMinutes?: number): string {
  if (!timestamp) return formatLocalCalendarDate(new Date(), utcOffsetMinutes);
  const trimmed = String(timestamp).trim();
  if (!trimmed) return formatLocalCalendarDate(new Date(), utcOffsetMinutes);

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) {
    const datePrefix = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
    return datePrefix ? datePrefix[1] : formatLocalCalendarDate(new Date(), utcOffsetMinutes);
  }

  return formatLocalCalendarDate(parsed, utcOffsetMinutes);
}

/**
 * Converts a local YYYY-MM-DD date (or local/offset timestamp) into a real UTC
 * ISO-8601 timestamp plus matching local calendar date and HH:mm:ss wall-clock time.
 */
export function localDateInputToUtcIso(
  paidAtInput: string,
  now: Date = new Date(),
  utcOffsetMinutes?: number
): { paidAtIso: string; localDate: string; localTime: string } {
  const trimmed = (paidAtInput || '').trim();
  if (!trimmed) {
    return {
      paidAtIso: now.toISOString(),
      localDate: formatLocalCalendarDate(now, utcOffsetMinutes),
      localTime: formatLocalTimeHMS(now, utcOffsetMinutes)
    };
  }

  // Case 1: Timestamp already includes explicit timezone (Z or +/-HH:MM or +/-HHMM)
  if (trimmed.includes('T') && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) {
      throw new Error('Invalid salary payout timestamp.');
    }
    return {
      paidAtIso: parsed.toISOString(),
      localDate: formatLocalCalendarDate(parsed, utcOffsetMinutes),
      localTime: formatLocalTimeHMS(parsed, utcOffsetMinutes)
    };
  }

  // Case 2: Local datetime without explicit timezone (YYYY-MM-DDTHH:mm[:ss])
  const localDateTimeMatch = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (localDateTimeMatch) {
    const year = Number(localDateTimeMatch[1]);
    const month = Number(localDateTimeMatch[2]);
    const day = Number(localDateTimeMatch[3]);
    const hh = Number(localDateTimeMatch[4]);
    const mm = Number(localDateTimeMatch[5]);
    const ss = Number(localDateTimeMatch[6] || '0');

    const instant = utcOffsetMinutes !== undefined
      ? new Date(Date.UTC(year, month - 1, day, hh, mm, ss, 0) - utcOffsetMinutes * 60_000)
      : new Date(year, month - 1, day, hh, mm, ss, 0);

    return {
      paidAtIso: instant.toISOString(),
      localDate: formatLocalCalendarDate(instant, utcOffsetMinutes),
      localTime: formatLocalTimeHMS(instant, utcOffsetMinutes)
    };
  }

  // Case 3: Date-only YYYY-MM-DD
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const todayLocal = formatLocalCalendarDate(now, utcOffsetMinutes);
    const nowTime = formatLocalTimeHMS(now, utcOffsetMinutes);

    if (trimmed === todayLocal) {
      return {
        paidAtIso: now.toISOString(),
        localDate: todayLocal,
        localTime: nowTime
      };
    }

    const [hh, mm, ss] = nowTime.split(':').map(Number);
    const instant = utcOffsetMinutes !== undefined
      ? new Date(Date.UTC(year, month - 1, day, hh, mm, ss, 0) - utcOffsetMinutes * 60_000)
      : new Date(year, month - 1, day, hh, mm, ss, 0);

    return {
      paidAtIso: instant.toISOString(),
      localDate: formatLocalCalendarDate(instant, utcOffsetMinutes),
      localTime: formatLocalTimeHMS(instant, utcOffsetMinutes)
    };
  }

  const fallbackParsed = new Date(trimmed);
  if (isNaN(fallbackParsed.getTime())) {
    throw new Error('Invalid salary payout date.');
  }
  return {
    paidAtIso: fallbackParsed.toISOString(),
    localDate: formatLocalCalendarDate(fallbackParsed, utcOffsetMinutes),
    localTime: formatLocalTimeHMS(fallbackParsed, utcOffsetMinutes)
  };
}

