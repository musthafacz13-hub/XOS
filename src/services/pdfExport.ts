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
  DateFilterPreset
} from '../types';
import { formatCurrency, formatDate } from '../utils/formatters';
import { calculateDebtSummary } from '../utils/calculations';

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

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 14;
  let currentY = 14;

  const currencyCode = data.settings.currency || 'USD';
  const dateFormat = data.settings.dateFormat || 'YYYY-MM-DD';

  // Apply date filters if not 'all'
  const filterByDate = datePreset !== 'all' && (startDate || endDate);
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
    ? data.debts.filter(d => isDateInRange(d.transaction_date, startDate, endDate))
    : data.debts;
  const filteredPayouts = filterByDate
    ? data.salaryPayouts.filter(p => isDateInRange(p.paymentDate, startDate, endDate))
    : data.salaryPayouts;

  // Key Totals
  const totalIncome = filteredIncomes.reduce((acc, i) => acc + (Number(i.amount) || 0), 0);
  const totalExpenses = filteredExpenses.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
  const netCashFlow = totalIncome - totalExpenses;

  // Debt calculations using unified calculateDebtSummary
  const debtSummary = calculateDebtSummary(filteredDebts, data.debtRepayments);
  const totalLent = debtSummary.totalLent;
  const totalBorrowed = debtSummary.totalBorrowed;
  const outstandingReceivable = debtSummary.outstandingReceivable;
  const outstandingPayable = debtSummary.outstandingPayable;

  // Savings total
  const totalSavings = data.savingsGoals.reduce((acc, g) => acc + (Number(g.currentAmount) || 0), 0);

  // Helper to ensure enough vertical space for next section header
  const ensureSpace = (neededHeight: number = 30) => {
    if (currentY + neededHeight > pageHeight - 18) {
      doc.addPage();
      currentY = 18;
    }
  };

  // Helper for Section Titles
  const drawSectionHeader = (title: string, badge?: string) => {
    ensureSpace(24);
    
    // Top subtle bar
    doc.setFillColor(244, 244, 245);
    doc.roundedRect(marginX, currentY, pageWidth - marginX * 2, 8, 1.5, 1.5, 'F');

    // Sky blue accent pip
    doc.setFillColor(135, 206, 235);
    doc.roundedRect(marginX + 2, currentY + 1.8, 2.5, 4.4, 0.6, 0.6, 'F');

    // Section title text
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(17, 17, 17);
    doc.text(title.toUpperCase(), marginX + 7, currentY + 5.5);

    if (badge) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(badge, pageWidth - marginX - 4, currentY + 5.5, { align: 'right' });
    }

    currentY += 11;
  };

  // ==========================================
  // PAGE 1: DOCUMENT HEADER & BRAND BANNER
  // ==========================================
  doc.setFillColor(17, 17, 17);
  doc.rect(marginX, currentY, pageWidth - marginX * 2, 28, 'F');

  // Sky Blue Top Accent Line
  doc.setFillColor(135, 206, 235);
  doc.rect(marginX, currentY, pageWidth - marginX * 2, 2, 'F');

  // Title inside banner
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text('XOS — PERSONAL LIFE OPERATING SYSTEM', marginX + 6, currentY + 10);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(200, 200, 200);
  const profileName = data.settings.profile?.name?.trim() || 'Workspace Master';
  const occupation = data.settings.profile?.occupation?.trim() || 'Personal Audit';
  doc.text(`Executive Summary Report | Prepared for: ${profileName} (${occupation})`, marginX + 6, currentY + 16);

  // Date and Scope badge in header banner
  const todayFormatted = new Date().toISOString().split('T')[0];
  const dateRangeLabel = datePreset === 'all'
    ? 'All Time (Complete History)'
    : startDate && endDate
      ? `${startDate} to ${endDate}`
      : datePreset.replace('_', ' ').toUpperCase();

  doc.setFontSize(7.5);
  doc.setTextColor(135, 206, 235);
  doc.text(`Generated: ${todayFormatted}  |  Scope: ${dateRangeLabel}  |  Base Currency: ${currencyCode}`, marginX + 6, currentY + 22);

  currentY += 32;

  // ==========================================
  // EXECUTIVE SUMMARY KPI TILES (6-Card Grid)
  // ==========================================
  const cardWidth = (pageWidth - marginX * 2 - 10) / 3;
  const cardHeight = 16;
  const kpis = [
    { label: 'Total Income', value: formatCurrency(totalIncome, currencyCode), color: [17, 17, 17] },
    { label: 'Total Expenses', value: formatCurrency(totalExpenses, currencyCode), color: [17, 17, 17] },
    { label: 'Net Cash Flow', value: (netCashFlow >= 0 ? '+' : '') + formatCurrency(netCashFlow, currencyCode), color: netCashFlow >= 0 ? [16, 120, 70] : [180, 40, 40] },
    { label: 'Money Lent (Receivable)', value: formatCurrency(outstandingReceivable, currencyCode), color: [17, 17, 17] },
    { label: 'Money Borrowed (Payable)', value: formatCurrency(outstandingPayable, currencyCode), color: [180, 40, 40] },
    { label: 'Total Savings Saved', value: formatCurrency(totalSavings, currencyCode), color: [16, 120, 70] }
  ];

  kpis.forEach((kpi, idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const x = marginX + col * (cardWidth + 5);
    const y = currentY + row * (cardHeight + 4);

    // Card background
    doc.setFillColor(250, 250, 250);
    doc.setDrawColor(228, 228, 231);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, cardWidth, cardHeight, 1.5, 1.5, 'FD');

    // Mini sky-blue left pill
    doc.setFillColor(135, 206, 235);
    doc.rect(x, y + 2, 1.2, cardHeight - 4, 'F');

    // KPI Label
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(115, 115, 115);
    doc.text(kpi.label.toUpperCase(), x + 3.5, y + 5);

    // KPI Value
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.text(kpi.value, x + 3.5, y + 11.5);
  });

  currentY += (cardHeight + 4) * 2 + 5;

  // ==========================================
  // SECTION 1: FINANCIAL RECORDS — INCOMES
  // ==========================================
  if (includeFinancial) {
    drawSectionHeader('Financial Records — Income', `${filteredIncomes.length} records`);

    const incomeRows = filteredIncomes.length > 0
      ? filteredIncomes.map(item => [
          formatDate(item.date, dateFormat),
          item.source || 'General',
          item.title,
          item.notes || '—',
          formatCurrency(Number(item.amount) || 0, currencyCode)
        ])
      : [['—', '—', 'No income records found for this period.', '—', formatCurrency(0, currencyCode)]];

    // Append total row if records exist
    if (filteredIncomes.length > 0) {
      incomeRows.push([
        'TOTAL',
        '',
        '',
        `${filteredIncomes.length} Transactions`,
        formatCurrency(totalIncome, currencyCode)
      ]);
    }

    const autoTableFn = (autoTable as unknown as { default?: typeof autoTable }).default || autoTable;
    autoTableFn(doc, {
      startY: currentY,
      margin: { left: marginX, right: marginX },
      head: [['Date', 'Source', 'Title', 'Notes', 'Amount']],
      body: incomeRows,
      theme: 'grid',
      styles: {
        fontSize: 7.5,
        cellPadding: 2,
        textColor: [20, 20, 20],
        lineColor: [230, 230, 230],
        lineWidth: 0.15
      },
      headStyles: {
        fillColor: [17, 17, 17],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.5
      },
      columnStyles: {
        0: { cellWidth: 24 },
        1: { cellWidth: 28 },
        2: { cellWidth: 50 },
        3: { cellWidth: 46 },
        4: { cellWidth: 34, halign: 'right', fontStyle: 'bold' }
      },
      didParseCell: (hookData) => {
        if (hookData.section === 'body' && hookData.row.index === incomeRows.length - 1 && filteredIncomes.length > 0) {
          hookData.cell.styles.fontStyle = 'bold';
          hookData.cell.styles.fillColor = [245, 245, 245];
        }
      }
    });

    currentY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  // ==========================================
  // SECTION 2: FINANCIAL RECORDS — EXPENSES
  // ==========================================
  if (includeFinancial) {
    drawSectionHeader('Financial Records — Expenses', `${filteredExpenses.length} records`);

    const expenseRows = filteredExpenses.length > 0
      ? filteredExpenses.map(item => [
          formatDate(item.date, dateFormat),
          item.category || 'General',
          item.title,
          item.paymentMethod || 'Other',
          formatCurrency(Number(item.amount) || 0, currencyCode)
        ])
      : [['—', '—', 'No expense records found for this period.', '—', formatCurrency(0, currencyCode)]];

    if (filteredExpenses.length > 0) {
      expenseRows.push([
        'TOTAL',
        '',
        '',
        `${filteredExpenses.length} Transactions`,
        formatCurrency(totalExpenses, currencyCode)
      ]);
    }

    const autoTableFn = (autoTable as unknown as { default?: typeof autoTable }).default || autoTable;
    autoTableFn(doc, {
      startY: currentY,
      margin: { left: marginX, right: marginX },
      head: [['Date', 'Category', 'Description', 'Payment Method', 'Amount']],
      body: expenseRows,
      theme: 'grid',
      styles: {
        fontSize: 7.5,
        cellPadding: 2,
        textColor: [20, 20, 20],
        lineColor: [230, 230, 230],
        lineWidth: 0.15
      },
      headStyles: {
        fillColor: [17, 17, 17],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.5
      },
      columnStyles: {
        0: { cellWidth: 24 },
        1: { cellWidth: 32 },
        2: { cellWidth: 50 },
        3: { cellWidth: 42 },
        4: { cellWidth: 34, halign: 'right', fontStyle: 'bold' }
      },
      didParseCell: (hookData) => {
        if (hookData.section === 'body' && hookData.row.index === expenseRows.length - 1 && filteredExpenses.length > 0) {
          hookData.cell.styles.fontStyle = 'bold';
          hookData.cell.styles.fillColor = [245, 245, 245];
        }
      }
    });

    currentY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  // ==========================================
  // SECTION 3: DEBT MANAGEMENT & LEDGER
  // ==========================================
  if (includeDebt) {
    drawSectionHeader('Debt Management Ledger', `${filteredDebts.length} active records`);

    const debtRows = filteredDebts.length > 0
      ? filteredDebts.map(d => {
          const repaymentsForDebt = data.debtRepayments
            .filter(r => r.debt_id === d.id)
            .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
          const remaining = Math.max(0, (Number(d.original_amount) || 0) - repaymentsForDebt);
          const typeLabel = d.type === 'lent' ? 'Lent (Receivable)' : 'Borrowed (Payable)';

          return [
            formatDate(d.transaction_date, dateFormat),
            d.person_name,
            typeLabel,
            formatCurrency(d.original_amount, currencyCode),
            formatCurrency(repaymentsForDebt, currencyCode),
            formatCurrency(remaining, currencyCode),
            d.due_date ? formatDate(d.due_date, dateFormat) : 'None',
            d.status
          ];
        })
      : [['—', '—', 'No debt records logged.', '—', '—', '—', '—', '—']];

    const autoTableFn = (autoTable as unknown as { default?: typeof autoTable }).default || autoTable;
    autoTableFn(doc, {
      startY: currentY,
      margin: { left: marginX, right: marginX },
      head: [['Date', 'Person', 'Direction', 'Original', 'Repaid', 'Balance', 'Due Date', 'Status']],
      body: debtRows,
      theme: 'grid',
      styles: {
        fontSize: 7,
        cellPadding: 1.8,
        textColor: [20, 20, 20],
        lineColor: [230, 230, 230],
        lineWidth: 0.15
      },
      headStyles: {
        fillColor: [17, 17, 17],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7
      },
      columnStyles: {
        0: { cellWidth: 20 },
        1: { cellWidth: 28 },
        2: { cellWidth: 28 },
        3: { cellWidth: 22, halign: 'right' },
        4: { cellWidth: 20, halign: 'right' },
        5: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
        6: { cellWidth: 22 },
        7: { cellWidth: 20, halign: 'center' }
      }
    });

    currentY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  // ==========================================
  // SECTION 4: WORK ATTENDANCE & HOURS
  // ==========================================
  if (includeAttendance) {
    drawSectionHeader('Work Attendance & Duty History', `${filteredAttendance.length} days logged`);

    const attRows = filteredAttendance.length > 0
      ? filteredAttendance.map(a => [
          formatDate(a.date, dateFormat),
          a.status,
          a.checkInTime || '—',
          a.checkOutTime || '—',
          a.calculatedHours ? `${a.calculatedHours} hrs` : '—',
          a.notes || '—'
        ])
      : [['—', 'No attendance records recorded for this period.', '—', '—', '—', '—']];

    const autoTableFn = (autoTable as unknown as { default?: typeof autoTable }).default || autoTable;
    autoTableFn(doc, {
      startY: currentY,
      margin: { left: marginX, right: marginX },
      head: [['Date', 'Status', 'Check In', 'Check Out', 'Hours', 'Notes']],
      body: attRows,
      theme: 'grid',
      styles: {
        fontSize: 7.2,
        cellPadding: 1.8,
        textColor: [20, 20, 20],
        lineColor: [230, 230, 230],
        lineWidth: 0.15
      },
      headStyles: {
        fillColor: [17, 17, 17],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.2
      },
      columnStyles: {
        0: { cellWidth: 26 },
        1: { cellWidth: 26, halign: 'center' },
        2: { cellWidth: 24 },
        3: { cellWidth: 24 },
        4: { cellWidth: 24, halign: 'right' },
        5: { cellWidth: 58 }
      }
    });

    currentY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  // ==========================================
  // SECTION 5: SALARY INFORMATION & PAYOUTS
  // ==========================================
  if (includeSalary) {
    const salaryCfg = data.settings.salaryConfig;
    const salarySubtitle = salaryCfg
      ? `Model: ${(salaryCfg.salaryType || 'daily_wage').replace('_', ' ').toUpperCase()} | Base: ${formatCurrency(salaryCfg.baseAmount || 0, currencyCode)}`
      : undefined;

    drawSectionHeader('Salary Information & Payout Records', salarySubtitle);

    const salaryRows = filteredPayouts.length > 0
      ? filteredPayouts.map(p => [
          p.periodMonth,
          formatDate(p.paymentDate, dateFormat),
          formatCurrency(p.grossSalary, currencyCode),
          formatCurrency(p.totalAllowances, currencyCode),
          formatCurrency(p.totalDeductions, currencyCode),
          formatCurrency(p.netSalary, currencyCode),
          p.status
        ])
      : [['—', '—', 'No recorded salary payout slips.', '—', '—', '—', '—']];

    const autoTableFn = (autoTable as unknown as { default?: typeof autoTable }).default || autoTable;
    autoTableFn(doc, {
      startY: currentY,
      margin: { left: marginX, right: marginX },
      head: [['Period', 'Payment Date', 'Gross', 'Allowances', 'Deductions', 'Net Salary', 'Status']],
      body: salaryRows,
      theme: 'grid',
      styles: {
        fontSize: 7.2,
        cellPadding: 1.8,
        textColor: [20, 20, 20],
        lineColor: [230, 230, 230],
        lineWidth: 0.15
      },
      headStyles: {
        fillColor: [17, 17, 17],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.2
      },
      columnStyles: {
        0: { cellWidth: 24 },
        1: { cellWidth: 26 },
        2: { cellWidth: 28, halign: 'right' },
        3: { cellWidth: 26, halign: 'right' },
        4: { cellWidth: 26, halign: 'right' },
        5: { cellWidth: 30, halign: 'right', fontStyle: 'bold' },
        6: { cellWidth: 22, halign: 'center' }
      }
    });

    currentY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  // ==========================================
  // SECTION 6: SAVINGS GOALS & TRANSACTIONS
  // ==========================================
  if (includeSavings) {
    drawSectionHeader('Savings & Wealth Accumulation', `${data.savingsGoals.length} goals`);

    const savingsRows = data.savingsGoals.length > 0
      ? data.savingsGoals.map(g => {
          const target = Number(g.targetAmount) || 0;
          const current = Number(g.currentAmount) || 0;
          const percent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 100;
          return [
            g.name,
            formatCurrency(target, currencyCode),
            formatCurrency(current, currencyCode),
            `${percent}%`,
            g.targetDate ? formatDate(g.targetDate, dateFormat) : 'Ongoing',
            g.description || '—'
          ];
        })
      : [['—', 'No savings goals registered.', '—', '—', '—', '—']];

    const autoTableFn = (autoTable as unknown as { default?: typeof autoTable }).default || autoTable;
    autoTableFn(doc, {
      startY: currentY,
      margin: { left: marginX, right: marginX },
      head: [['Goal Name', 'Target Amount', 'Current Saved', 'Progress', 'Target Date', 'Notes']],
      body: savingsRows,
      theme: 'grid',
      styles: {
        fontSize: 7.2,
        cellPadding: 1.8,
        textColor: [20, 20, 20],
        lineColor: [230, 230, 230],
        lineWidth: 0.15
      },
      headStyles: {
        fillColor: [17, 17, 17],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.2
      },
      columnStyles: {
        0: { cellWidth: 36 },
        1: { cellWidth: 28, halign: 'right' },
        2: { cellWidth: 28, halign: 'right', fontStyle: 'bold' },
        3: { cellWidth: 20, halign: 'center' },
        4: { cellWidth: 26 },
        5: { cellWidth: 44 }
      }
    });

    currentY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  // ==========================================
  // SECTION 7: GOALS & DREAMS
  // ==========================================
  if (includeGoals) {
    drawSectionHeader('Goals & Dreams Roadmap', `${data.goals.length} active roadmap items`);

    const goalRows = data.goals.length > 0
      ? data.goals.map(g => [
          g.title,
          g.type === 'dream' ? 'Dream' : 'Goal',
          g.category || 'General',
          g.priority,
          g.status,
          g.targetDate ? formatDate(g.targetDate, dateFormat) : 'Open',
          g.targetAmount ? formatCurrency(g.targetAmount, currencyCode) : '—'
        ])
      : [['—', 'No life goals or dreams recorded.', '—', '—', '—', '—', '—']];

    const autoTableFn = (autoTable as unknown as { default?: typeof autoTable }).default || autoTable;
    autoTableFn(doc, {
      startY: currentY,
      margin: { left: marginX, right: marginX },
      head: [['Title', 'Type', 'Category', 'Priority', 'Status', 'Target Date', 'Target Value']],
      body: goalRows,
      theme: 'grid',
      styles: {
        fontSize: 7.2,
        cellPadding: 1.8,
        textColor: [20, 20, 20],
        lineColor: [230, 230, 230],
        lineWidth: 0.15
      },
      headStyles: {
        fillColor: [17, 17, 17],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.2
      },
      columnStyles: {
        0: { cellWidth: 42 },
        1: { cellWidth: 18, halign: 'center' },
        2: { cellWidth: 26 },
        3: { cellWidth: 20, halign: 'center' },
        4: { cellWidth: 24, halign: 'center' },
        5: { cellWidth: 24 },
        6: { cellWidth: 28, halign: 'right' }
      }
    });

    currentY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  // ==========================================
  // RUNNING HEADERS & FOOTERS ON ALL PAGES
  // ==========================================
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    // Running Header (pages 2 and up)
    if (i > 1) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(120, 120, 120);
      doc.text('XOS — PERSONAL LIFE OPERATING SYSTEM', marginX, 10);
      doc.text('AUDIT & EXECUTIVE REPORT', pageWidth - marginX, 10, { align: 'right' });

      // Subtle divider line
      doc.setDrawColor(228, 228, 231);
      doc.setLineWidth(0.2);
      doc.line(marginX, 12, pageWidth - marginX, 12);
    }

    // Running Footer (all pages)
    doc.setDrawColor(228, 228, 231);
    doc.setLineWidth(0.2);
    doc.line(marginX, pageHeight - 12, pageWidth - marginX, pageHeight - 12);

    // Sky blue accent dot on bottom
    doc.setFillColor(135, 206, 235);
    doc.circle(marginX + 1.5, pageHeight - 7.5, 0.8, 'F');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(130, 130, 130);
    doc.text(
      `Private & Confidential  |  Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`,
      marginX + 4,
      pageHeight - 6.5
    );

    doc.setFont('helvetica', 'bold');
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - marginX, pageHeight - 6.5, { align: 'right' });
  }

  return doc.output('blob');
}
