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

export function formatCurrency(amount: number, currencyCode: CurrencyCode = 'USD'): string {
  const currency = CURRENCIES[currencyCode] || CURRENCIES.USD;
  const formattedNumber = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount || 0);

  return `${currency.symbol}${formattedNumber}`;
}

export function formatDate(dateStr: string | Date | undefined, format: DateFormat = 'YYYY-MM-DD'): string {
  if (!dateStr) return '';
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
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
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
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
