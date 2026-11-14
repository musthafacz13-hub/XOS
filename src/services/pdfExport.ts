import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  UserSettings,
  Income,
  Expense,
  Debt,
  DebtRepayment,
  AttendanceRecord,
  SalaryPayout,
  SavingsGoal,
  SavingsTransaction,
  Goal,
  DateFilterPreset,
  CurrencyCode
} from '../types';
import { formatCurrency, formatDate, getTodayString } from '../utils/formatters';
import { calculateDebtOutstanding, calculateDebtSummary } from '../utils/calculations';

export interface PDFExportOptions {
  datePreset?: DateFilterPreset | 'all';
  startDate?: string;
  endDate?: string;
  includeFinancial?: boolean;
  includeDebt?: boolean;
  includeAttendance?: boolean;
  includeSalary?: boolean;
  includeSavings?: boolean;
  includeGoals?: boolean;
}

export interface PDFExportData {
  settings: UserSettings;
  incomes: Income[];
  expenses: Expense[];
  debts: Debt[];
  debtRepayments: DebtRepayment[];
  attendance: AttendanceRecord[];
  salaryPayouts: SalaryPayout[];
  savingsGoals: SavingsGoal[];
  savingsTransactions: SavingsTransaction[];
  goals: Goal[];
}

// Color tokens: pure white surface, crisp black ink, subtle grey secondary text & hairlines
const COLOR_WHITE: [number, number, number] = [255, 255, 255];
const COLOR_BLACK: [number, number, number] = [17, 17, 17];
const COLOR_SECONDARY: [number, number, number] = [107, 114, 128];
const COLOR_MUTED: [number, number, number] = [138, 143, 152];
const COLOR_RULE_LIGHT: [number, number, number] = [226, 228, 232];
const COLOR_RULE_DARK: [number, number, number] = [24, 24, 27];

/**
 * Filter items by date string in YYYY-MM-DD
 */
function isDateInRange(dateStr?: string, startDate?: string, endDate?: string): boolean {
  if (!dateStr) return false;
  const d = dateStr.slice(0, 10);
  if (startDate && d < startDate) return false;
  if (endDate && d > endDate) return false;
  return true;
}

/**
 * Built-in Type1 Helvetica in jsPDF uses WinAnsiEncoding and cannot render U+20B9 (₹).
 * Normalize ₹ -> "INR " and strip unsupported non-WinAnsi glyphs so text spacing and
 * alignment remain crisp in all PDF viewers and print drivers.
 */
function sanitizePdfText(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  return raw
    .replace(/\u20B9/g, 'INR ')
    .replace(/\u2026/g, '...')
    .replace(/[^\x20-\xFF\u2013\u2014\u20AC]/g, '');
}

function formatPdfCurrency(amount: number, currencyCode: CurrencyCode = 'INR'): string {
  return sanitizePdfText(formatCurrency(amount, currencyCode));
}

function formatDateRangeLabel(
  datePreset: DateFilterPreset | 'all',
  startDate?: string,
  endDate?: string,
  dateFormat: UserSettings['dateFormat'] = 'YYYY-MM-DD'
): string {
  if (datePreset === 'all') return 'All Time (Complete History)';
  if (startDate && endDate) {
    return `${formatDate(startDate, dateFormat)} to ${formatDate(endDate, dateFormat)}`;
  }
  if (startDate) return `From ${formatDate(startDate, dateFormat)}`;
  if (endDate) return `Through ${formatDate(endDate, dateFormat)}`;
  return datePreset.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export async function generateXOSReportPDF(
  data: PDFExportData,
  options: PDFExportOptions = {}
): Promise<Blob> {
  const {
    datePreset = 'all',
    startDate,
    endDate,
    includeFinancial = true,
    includeDebt = true,
    includeAttendance = true,
    includeSalary = true,
    includeSavings = true,
    includeGoals = true
  } = options;

  const JsPDFClass = (jsPDF as any).default || jsPDF;
  const doc = new JsPDFClass({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 210 mm
  const pageHeight = doc.internal.pageSize.getHeight(); // 297 mm
  const marginX = 16;
  const topMargin = 20;
  const bottomMargin = 18;
  const contentWidth = pageWidth - marginX * 2; // 178 mm
  let currentY = 18;

  const currencyCode = data.settings.currency || 'INR';
  const dateFormat = data.settings.dateFormat || 'YYYY-MM-DD';

  // Apply date filters if not 'all'
  const filterByDate = datePreset !== 'all' && Boolean(startDate || endDate);
  const filteredIncomes = filterByDate
    ? data.incomes.filter(i => isDateInRange(i.date, startDate, endDate))
    : data.incomes;
  const filteredExpenses = filterByDate
    ? data.expenses.filter(e => isDateInRange(e.date, startDate, endDate))
    : data.expenses;
  const filteredAttendance = filterByDate
    ? data.attendance.filter(a => isDateInRange(a.date, startDate, endDate))
    : data.attendance;
  const filteredDebts = filterByDate
    ? data.debts.filter(d => isDateInRange(d.lent_date, startDate, endDate))
    : data.debts;
  const filteredPayouts = filterByDate
    ? data.salaryPayouts.filter(p => isDateInRange(p.paidAt, startDate, endDate))
    : data.salaryPayouts;

  // Key Totals (preserved from existing calculations)
  const totalIncome = filteredIncomes.reduce((acc, i) => acc + (Number(i.amount) || 0), 0);
  const totalExpenses = filteredExpenses.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
  const netCashFlow = totalIncome - totalExpenses;

  const debtSummary = calculateDebtSummary(filteredDebts, data.debtRepayments);
  const outstandingReceivable = debtSummary.outstandingReceivable;
  const totalRepaid = debtSummary.totalRepaid;

  const totalSavings = data.savingsGoals.reduce((acc, g) => acc + (Number(g.currentAmount) || 0), 0);

  const autoTableFn = (autoTable as unknown as { default?: typeof autoTable }).default || autoTable;

  // Ensure enough vertical space before starting a new section so headings never orphan
  const ensureSpace = (neededHeight: number = 34) => {
    if (currentY + neededHeight > pageHeight - bottomMargin) {
      doc.addPage();
      currentY = topMargin;
    }
  };

  // Clean typographic section header with thin rule
  const drawSectionHeader = (title: string, meta?: string, subtitle?: string) => {
    const subtitleLines = subtitle
      ? (doc.splitTextToSize(sanitizePdfText(subtitle), contentWidth) as string[])
      : [];
    const headerHeight = 9 + (subtitleLines.length > 0 ? subtitleLines.length * 3.8 + 1.5 : 0);

    // Reserve space for header + table head + at least one table row
    ensureSpace(headerHeight + 24);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...COLOR_BLACK);
    doc.text(sanitizePdfText(title), marginX, currentY + 4);

    if (meta) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...COLOR_SECONDARY);
      doc.text(sanitizePdfText(meta), pageWidth - marginX, currentY + 4, { align: 'right' });
    }

    currentY += 6;

    if (subtitleLines.length > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...COLOR_SECONDARY);
      doc.text(subtitleLines, marginX, currentY + 2.5);
      currentY += subtitleLines.length * 3.8 + 1.5;
    }

    doc.setDrawColor(...COLOR_RULE_DARK);
    doc.setLineWidth(0.35);
    doc.line(marginX, currentY, pageWidth - marginX, currentY);

    currentY += 3.5;
  };

  // Shared table renderer enforcing white background, aligned headers, clean hairlines, and no broken rows
  const renderStatementTable = (config: {
    head: string[];
    body: any[][];
    columnStyles: Record<number, any>;
    fontSize?: number;
    cellPaddingX?: number;
    hasTotalRow?: boolean;
  }) => {
    const fontSize = config.fontSize ?? 8;
    const padX = config.cellPaddingX ?? 2;
    const bodyLength = config.body.length;

    autoTableFn(doc, {
      startY: currentY,
      margin: { top: topMargin, right: marginX, bottom: bottomMargin, left: marginX },
      tableWidth: contentWidth,
      head: [config.head],
      body: config.body,
      theme: 'plain',
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      styles: {
        font: 'helvetica',
        fontSize,
        cellPadding: { top: 2.3, right: padX, bottom: 2.3, left: padX },
        textColor: COLOR_BLACK,
        fillColor: COLOR_WHITE,
        overflow: 'linebreak',
        valign: 'middle'
      },
      headStyles: {
        font: 'helvetica',
        fontStyle: 'bold',
        fontSize: Math.min(8, fontSize + 0.2),
        textColor: COLOR_BLACK,
        fillColor: COLOR_WHITE,
        cellPadding: { top: 2.2, right: padX, bottom: 2.4, left: padX }
      },
      columnStyles: config.columnStyles,
      didParseCell: (hookData) => {
        if (hookData.section === 'head') {
          const colStyle = config.columnStyles[hookData.column.index];
          if (colStyle?.halign) {
            hookData.cell.styles.halign = colStyle.halign;
          }
        }
        if (config.hasTotalRow && hookData.section === 'body' && hookData.row.index === bodyLength - 1) {
          hookData.cell.styles.fontStyle = 'bold';
          hookData.cell.styles.fillColor = COLOR_WHITE;
          hookData.cell.styles.textColor = COLOR_BLACK;
        }
      },
      didDrawCell: (hookData) => {
        const { cell, section, row } = hookData;
        if (section === 'head') {
          doc.setDrawColor(...COLOR_RULE_DARK);
          doc.setLineWidth(0.35);
          doc.line(cell.x, cell.y + cell.height, cell.x + cell.width, cell.y + cell.height);
        } else if (section === 'body') {
          const isTotalRow = Boolean(config.hasTotalRow) && row.index === bodyLength - 1;
          if (isTotalRow) {
            doc.setDrawColor(...COLOR_RULE_DARK);
            doc.setLineWidth(0.3);
            doc.line(cell.x, cell.y, cell.x + cell.width, cell.y);
            doc.setLineWidth(0.35);
            doc.line(cell.x, cell.y + cell.height, cell.x + cell.width, cell.y + cell.height);
          } else {
            doc.setDrawColor(...COLOR_RULE_LIGHT);
            doc.setLineWidth(0.15);
            doc.line(cell.x, cell.y + cell.height, cell.x + cell.width, cell.y + cell.height);
          }
        }
      }
    });

    currentY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 9;
  };

  // ==========================================
  // PAGE 1: CLEAN DOCUMENT HEADER (PURE WHITE)
  // ==========================================
  const profileName = sanitizePdfText(data.settings.profile?.name?.trim() || 'Workspace Master');
  const todayFormatted = formatDate(getTodayString(), dateFormat);
  const dateRangeLabel = sanitizePdfText(formatDateRangeLabel(datePreset, startDate, endDate, dateFormat));

  // Document brand & title on left, metadata on right
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...COLOR_BLACK);
  doc.text('XOS', marginX, currentY + 1);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...COLOR_SECONDARY);
  doc.text('Personal Life Operating System — Statement Report', marginX + 14.5, currentY + 1);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COLOR_SECONDARY);
  doc.text(`Generated: ${todayFormatted}`, pageWidth - marginX, currentY + 1, { align: 'right' });

  currentY += 6;

  // Prepared for / Period / Currency clean metadata line
  const metaLine = `Prepared for: ${profileName}   |   Period: ${dateRangeLabel}   |   Currency: ${currencyCode}`;
  const wrappedMeta = doc.splitTextToSize(sanitizePdfText(metaLine), contentWidth) as string[];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COLOR_SECONDARY);
  doc.text(wrappedMeta, marginX, currentY + 2);
  currentY += wrappedMeta.length * 4 + 2.5;

  // Primary header divider rule
  doc.setDrawColor(...COLOR_RULE_DARK);
  doc.setLineWidth(0.45);
  doc.line(marginX, currentY, pageWidth - marginX, currentY);

  currentY += 7;

  // ==========================================
  // EXECUTIVE SUMMARY (CLEAN TYPOGRAPHIC GRID, NO CARDS/FILLS)
  // ==========================================
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...COLOR_BLACK);
  doc.text('Executive Summary', marginX, currentY);
  currentY += 3;

  const netSign = netCashFlow > 0 ? '+' : '';
  const summaryRows = [
    [
      { label: 'TOTAL INCOME', value: formatPdfCurrency(totalIncome, currencyCode) },
      { label: 'TOTAL EXPENSES', value: formatPdfCurrency(totalExpenses, currencyCode) },
      { label: 'NET CASH FLOW', value: `${netSign}${formatPdfCurrency(netCashFlow, currencyCode)}` }
    ],
    [
      { label: 'MONEY LENT (RECEIVABLE)', value: formatPdfCurrency(outstandingReceivable, currencyCode) },
      { label: 'DEBT RECOVERED', value: formatPdfCurrency(totalRepaid, currencyCode) },
      { label: 'TOTAL SAVINGS SAVED', value: formatPdfCurrency(totalSavings, currencyCode) }
    ]
  ];

  const colWidth = contentWidth / 3;
  const rowHeight = 13;

  doc.setDrawColor(...COLOR_RULE_LIGHT);
  doc.setLineWidth(0.2);
  doc.line(marginX, currentY, pageWidth - marginX, currentY);

  summaryRows.forEach((rowItems, rowIndex) => {
    const rowTop = currentY + rowIndex * rowHeight;
    rowItems.forEach((item, colIndex) => {
      const cellX = marginX + colIndex * colWidth;
      const textX = colIndex === 0 ? cellX : cellX + 3;
      const maxTextWidth = colWidth - 5;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...COLOR_SECONDARY);
      doc.text(item.label, textX, rowTop + 4.5);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...COLOR_BLACK);
      const valLines = doc.splitTextToSize(item.value, maxTextWidth) as string[];
      doc.text(valLines[0] || item.value, textX, rowTop + 10);

      if (colIndex > 0) {
        doc.setDrawColor(...COLOR_RULE_LIGHT);
        doc.setLineWidth(0.15);
        doc.line(cellX, rowTop + 1.5, cellX, rowTop + rowHeight - 1.5);
      }
    });

    doc.setDrawColor(...COLOR_RULE_LIGHT);
    doc.setLineWidth(0.2);
    doc.line(marginX, rowTop + rowHeight, pageWidth - marginX, rowTop + rowHeight);
  });

  currentY += summaryRows.length * rowHeight + 9;

  let renderedAnySection = false;

  // ==========================================
  // SECTION 1: FINANCIAL RECORDS — INCOME
  // ==========================================
  if (includeFinancial) {
    renderedAnySection = true;
    drawSectionHeader('Financial Records — Income', `${filteredIncomes.length} records`);

    const incomeRows: any[][] = filteredIncomes.length > 0
      ? filteredIncomes.map(item => [
          sanitizePdfText(formatDate(item.date, dateFormat)),
          sanitizePdfText(item.source || 'General'),
          sanitizePdfText(item.title),
          sanitizePdfText(item.notes || '-'),
          formatPdfCurrency(Number(item.amount) || 0, currencyCode)
        ])
      : [[{
          content: 'No income records found for this period.',
          colSpan: 5,
          styles: { textColor: COLOR_SECONDARY, fontStyle: 'italic' }
        }]];

    if (filteredIncomes.length > 0) {
      incomeRows.push([
        { content: 'Total', colSpan: 3 },
        { content: `${filteredIncomes.length} transactions`, styles: { fontStyle: 'normal', textColor: COLOR_SECONDARY } },
        { content: formatPdfCurrency(totalIncome, currencyCode), styles: { halign: 'right' } }
      ]);
    }

    renderStatementTable({
      head: ['Date', 'Source', 'Title', 'Notes', 'Amount'],
      body: incomeRows,
      hasTotalRow: filteredIncomes.length > 0,
      columnStyles: {
        0: { cellWidth: 24, halign: 'left' },
        1: { cellWidth: 28, halign: 'left' },
        2: { cellWidth: 48, halign: 'left' },
        3: { cellWidth: 46, halign: 'left' },
        4: { cellWidth: 32, halign: 'right' }
      }
    });
  }

  // ==========================================
  // SECTION 2: FINANCIAL RECORDS — EXPENSES
  // ==========================================
  if (includeFinancial) {
    renderedAnySection = true;
    drawSectionHeader('Financial Records — Expenses', `${filteredExpenses.length} records`);

    const expenseRows: any[][] = filteredExpenses.length > 0
      ? filteredExpenses.map(item => [
          sanitizePdfText(formatDate(item.date, dateFormat)),
          sanitizePdfText(item.category || 'General'),
          sanitizePdfText(item.title),
          sanitizePdfText(item.paymentMethod || 'Other'),
          formatPdfCurrency(Number(item.amount) || 0, currencyCode)
        ])
      : [[{
          content: 'No expense records found for this period.',
          colSpan: 5,
          styles: { textColor: COLOR_SECONDARY, fontStyle: 'italic' }
        }]];

    if (filteredExpenses.length > 0) {
      expenseRows.push([
        { content: 'Total', colSpan: 3 },
        { content: `${filteredExpenses.length} transactions`, styles: { fontStyle: 'normal', textColor: COLOR_SECONDARY } },
        { content: formatPdfCurrency(totalExpenses, currencyCode), styles: { halign: 'right' } }
      ]);
    }

    renderStatementTable({
      head: ['Date', 'Category', 'Description', 'Payment Method', 'Amount'],
      body: expenseRows,
      hasTotalRow: filteredExpenses.length > 0,
      columnStyles: {
        0: { cellWidth: 24, halign: 'left' },
        1: { cellWidth: 30, halign: 'left' },
        2: { cellWidth: 48, halign: 'left' },
        3: { cellWidth: 44, halign: 'left' },
        4: { cellWidth: 32, halign: 'right' }
      }
    });
  }

  // ==========================================
  // SECTION 3: DEBT MANAGEMENT LEDGER
  // ==========================================
  if (includeDebt) {
    renderedAnySection = true;
    drawSectionHeader('Debt Management Ledger', `${filteredDebts.length} records`);

    const debtRows: any[][] = filteredDebts.length > 0
      ? filteredDebts.map(d => {
          const remaining = calculateDebtOutstanding(d, data.debtRepayments);
          const repaid = Math.max(0, (Number(d.original_amount) || 0) - remaining);
          const statusLabel = d.status === 'paid'
            ? 'Paid'
            : d.status === 'partially_paid'
            ? 'Partially Paid'
            : 'Outstanding';

          return [
            sanitizePdfText(formatDate(d.lent_date, dateFormat)),
            sanitizePdfText(d.person_name),
            sanitizePdfText(d.description || d.notes || '-'),
            formatPdfCurrency(d.original_amount, currencyCode),
            formatPdfCurrency(repaid, currencyCode),
            formatPdfCurrency(remaining, currencyCode),
            d.due_date ? sanitizePdfText(formatDate(d.due_date, dateFormat)) : 'None',
            statusLabel
          ];
        })
      : [[{
          content: 'No debt records logged.',
          colSpan: 8,
          styles: { textColor: COLOR_SECONDARY, fontStyle: 'italic' }
        }]];

    renderStatementTable({
      head: ['Date', 'Person', 'Description', 'Original', 'Repaid', 'Balance', 'Due Date', 'Status'],
      body: debtRows,
      fontSize: 7.4,
      cellPaddingX: 1.5,
      columnStyles: {
        0: { cellWidth: 20, halign: 'left' },
        1: { cellWidth: 25, halign: 'left' },
        2: { cellWidth: 23, halign: 'left' },
        3: { cellWidth: 24, halign: 'right' },
        4: { cellWidth: 22, halign: 'right' },
        5: { cellWidth: 24, halign: 'right', fontStyle: 'bold' },
        6: { cellWidth: 20, halign: 'left' },
        7: { cellWidth: 20, halign: 'left' }
      }
    });
  }

  // ==========================================
  // SECTION 4: WORK ATTENDANCE & HOURS
  // ==========================================
  if (includeAttendance) {
    renderedAnySection = true;
    drawSectionHeader('Work Attendance & Duty History', `${filteredAttendance.length} days logged`);

    const attRows: any[][] = filteredAttendance.length > 0
      ? filteredAttendance.map(a => [
          sanitizePdfText(formatDate(a.date, dateFormat)),
          sanitizePdfText(a.status),
          sanitizePdfText(a.checkInTime || '-'),
          sanitizePdfText(a.checkOutTime || '-'),
          a.calculatedHours ? `${a.calculatedHours} hrs` : '-',
          sanitizePdfText(a.notes || '-')
        ])
      : [[{
          content: 'No attendance records recorded for this period.',
          colSpan: 6,
          styles: { textColor: COLOR_SECONDARY, fontStyle: 'italic' }
        }]];

    renderStatementTable({
      head: ['Date', 'Status', 'Check In', 'Check Out', 'Hours', 'Notes'],
      body: attRows,
      columnStyles: {
        0: { cellWidth: 24, halign: 'left' },
        1: { cellWidth: 22, halign: 'left' },
        2: { cellWidth: 22, halign: 'left' },
        3: { cellWidth: 22, halign: 'left' },
        4: { cellWidth: 22, halign: 'right' },
        5: { cellWidth: 66, halign: 'left' }
      }
    });
  }

  // ==========================================
  // SECTION 5: SALARY INFORMATION & PAYOUTS
  // ==========================================
  if (includeSalary) {
    renderedAnySection = true;
    const salaryCfg = data.settings.salaryConfig;
    const salarySubtitle = salaryCfg
      ? `Daily Base: ${formatPdfCurrency(salaryCfg.dailyBaseSalary || 0, currencyCode)}  |  Standard Hours: ${salaryCfg.standardWorkingHours || 8}h  |  Extra Rate: ${formatPdfCurrency(salaryCfg.extraHourRate || 0, currencyCode)}/hr`
      : undefined;

    drawSectionHeader(
      'Salary Information & Payout Records',
      `${filteredPayouts.length} slips`,
      salarySubtitle
    );

    const salaryRows: any[][] = filteredPayouts.length > 0
      ? filteredPayouts.map(p => [
          sanitizePdfText(`${formatDate(p.periodStart, dateFormat)} to ${formatDate(p.periodEnd, dateFormat)}`),
          sanitizePdfText(formatDate(p.paidAt, dateFormat)),
          formatPdfCurrency(p.amountPaid, currencyCode),
          sanitizePdfText(p.notes || '-')
        ])
      : [[{
          content: 'No recorded salary payout slips.',
          colSpan: 4,
          styles: { textColor: COLOR_SECONDARY, fontStyle: 'italic' }
        }]];

    renderStatementTable({
      head: ['Pay Period', 'Paid Date', 'Amount Paid', 'Notes'],
      body: salaryRows,
      columnStyles: {
        0: { cellWidth: 48, halign: 'left' },
        1: { cellWidth: 28, halign: 'left' },
        2: { cellWidth: 32, halign: 'right', fontStyle: 'bold' },
        3: { cellWidth: 70, halign: 'left' }
      }
    });
  }

  // ==========================================
  // SECTION 6: SAVINGS & WEALTH ACCUMULATION
  // ==========================================
  if (includeSavings) {
    renderedAnySection = true;
    drawSectionHeader('Savings & Reserves', `${data.savingsGoals.length} goals`);

    const savingsRows: any[][] = data.savingsGoals.length > 0
      ? data.savingsGoals.map(g => {
          const target = Number(g.targetAmount) || 0;
          const current = Number(g.currentAmount) || 0;
          const percent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 100;
          return [
            sanitizePdfText(g.name),
            formatPdfCurrency(target, currencyCode),
            formatPdfCurrency(current, currencyCode),
            `${percent}%`,
            g.targetDate ? sanitizePdfText(formatDate(g.targetDate, dateFormat)) : 'Ongoing',
            sanitizePdfText(g.description || '-')
          ];
        })
      : [[{
          content: 'No savings goals registered.',
          colSpan: 6,
          styles: { textColor: COLOR_SECONDARY, fontStyle: 'italic' }
        }]];

    renderStatementTable({
      head: ['Goal Name', 'Target Amount', 'Current Saved', 'Progress', 'Target Date', 'Notes'],
      body: savingsRows,
      columnStyles: {
        0: { cellWidth: 36, halign: 'left' },
        1: { cellWidth: 28, halign: 'right' },
        2: { cellWidth: 28, halign: 'right', fontStyle: 'bold' },
        3: { cellWidth: 18, halign: 'right' },
        4: { cellWidth: 24, halign: 'left' },
        5: { cellWidth: 44, halign: 'left' }
      }
    });
  }

  // ==========================================
  // SECTION 7: GOALS & AMBITIONS
  // ==========================================
  if (includeGoals) {
    renderedAnySection = true;
    drawSectionHeader('Goals & Ambitions Roadmap', `${data.goals.length} items`);

    const goalRows: any[][] = data.goals.length > 0
      ? data.goals.map(g => [
          sanitizePdfText(g.title),
          sanitizePdfText(g.category || 'General'),
          sanitizePdfText(g.priority),
          sanitizePdfText(g.status),
          `${g.progressPercentage ?? 0}%`,
          g.targetDate ? sanitizePdfText(formatDate(g.targetDate, dateFormat)) : 'Open',
          g.targetAmount ? formatPdfCurrency(g.targetAmount, currencyCode) : '-'
        ])
      : [[{
          content: 'No life goals or ambitions recorded.',
          colSpan: 7,
          styles: { textColor: COLOR_SECONDARY, fontStyle: 'italic' }
        }]];

    renderStatementTable({
      head: ['Title', 'Category', 'Priority', 'Status', 'Progress', 'Target Date', 'Target Value'],
      body: goalRows,
      fontSize: 7.5,
      columnStyles: {
        0: { cellWidth: 44, halign: 'left' },
        1: { cellWidth: 26, halign: 'left' },
        2: { cellWidth: 18, halign: 'left' },
        3: { cellWidth: 24, halign: 'left' },
        4: { cellWidth: 18, halign: 'right' },
        5: { cellWidth: 22, halign: 'left' },
        6: { cellWidth: 26, halign: 'right' }
      }
    });
  }

  if (!renderedAnySection) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(...COLOR_SECONDARY);
    doc.text('No report sections were selected for export.', marginX, currentY + 4);
  }

  // ==========================================
  // RUNNING HEADERS & FOOTERS ON ALL PAGES
  // ==========================================
  const totalPages = doc.getNumberOfPages();
  const generatedHumanDate = sanitizePdfText(
    new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  );

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    // Subtle running header on continuation pages (page 2+)
    if (i > 1) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...COLOR_MUTED);
      doc.text('XOS — Statement Report', marginX, 11);
      doc.text(dateRangeLabel, pageWidth - marginX, 11, { align: 'right' });

      doc.setDrawColor(...COLOR_RULE_LIGHT);
      doc.setLineWidth(0.2);
      doc.line(marginX, 14, pageWidth - marginX, 14);
    }

    // Minimal footer divider & metadata
    doc.setDrawColor(...COLOR_RULE_LIGHT);
    doc.setLineWidth(0.2);
    doc.line(marginX, pageHeight - 13, pageWidth - marginX, pageHeight - 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLOR_MUTED);
    doc.text(
      `Private & Confidential  |  Generated ${generatedHumanDate}`,
      marginX,
      pageHeight - 8
    );

    // Add page numbers only when multiple pages are generated
    if (totalPages > 1) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...COLOR_SECONDARY);
      doc.text(`Page ${i} of ${totalPages}`, pageWidth - marginX, pageHeight - 8, { align: 'right' });
    }
  }

  return doc.output('blob');
}
