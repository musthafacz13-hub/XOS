/**
 * XOS PDF Export Service Test
 * Validates:
 * 1. Empty dataset handling without errors
 * 2. Complete populated report generation
 * 3. Multi-page table generation with large datasets
 * 4. Proper PDF header signature (%PDF)
 */

import { generateXOSReportPDF, PDFExportData } from '../services/pdfExport';
import { DEFAULT_USER_SETTINGS } from '../data/initialData';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runPDFTests() {
  console.log('--- Running PDF Export Automated Verification ---');

  // Case 1: Empty Dataset (Clean Slate)
  console.log('Test 1: Generating PDF with empty session dataset...');
  const emptyData: PDFExportData = {
    settings: { ...DEFAULT_USER_SETTINGS, currency: 'USD' },
    incomes: [],
    expenses: [],
    debts: [],
    debtRepayments: [],
    attendance: [],
    salaryPayouts: [],
    savingsGoals: [],
    savingsTransactions: [],
    goals: []
  };

  const emptyBlob = await generateXOSReportPDF(emptyData, { datePreset: 'all' });
  assert(emptyBlob.size > 1000, `Empty PDF size must be valid (>1KB), got ${emptyBlob.size} bytes`);
  const emptyArrayBuffer = await emptyBlob.arrayBuffer();
  const emptyPdfText = new TextDecoder('latin1').decode(new Uint8Array(emptyArrayBuffer));
  assert(emptyPdfText.startsWith('%PDF'), `PDF header must be %PDF, got ${emptyPdfText.slice(0, 8)}`);
  assert(
    /\/MediaBox \[0 0 595\.2[78]\d* 841\.8[89]\d*\]/.test(emptyPdfText),
    'PDF page size must be standard A4 portrait (210 x 297 mm / 595.28 x 841.89 pt)'
  );
  // Ensure no legacy sky-blue (135, 206, 235 -> 0.529 0.808 0.922) or green/red colored fills/text exist
  assert(!emptyPdfText.includes('0.529 0.808 0.922'), 'PDF must not contain decorative sky-blue accents');
  console.log(`✓ Test 1 passed: Empty PDF generated cleanly as A4 (${emptyBlob.size} bytes).`);

  // Case 2: Populated Dataset (Normal Session)
  console.log('Test 2: Generating PDF with representative session records...');
  const populatedData: PDFExportData = {
    settings: { ...DEFAULT_USER_SETTINGS, currency: 'EUR', dateFormat: 'DD/MM/YYYY' },
    incomes: [
      { id: 'i1', title: 'Consulting Retainer', amount: 3500, source: 'Business', date: '2026-05-01', createdAt: '2026-05-01' },
      { id: 'i2', title: 'Product Royalty', amount: 750, source: 'Investments', date: '2026-05-15', createdAt: '2026-05-15' }
    ],
    expenses: [
      { id: 'e1', title: 'Office Studio Rent', amount: 1200, category: 'Housing', date: '2026-05-02', paymentMethod: 'Bank Transfer', createdAt: '2026-05-02' },
      { id: 'e2', title: 'Cloud Infrastructure', amount: 240, category: 'Other', date: '2026-05-10', paymentMethod: 'Credit Card', createdAt: '2026-05-10' }
    ],
    debts: [
      { id: 'd1', person_name: 'Marcus Vance', original_amount: 500, remaining_amount: 300, lent_date: '2026-05-05', status: 'partially_paid', created_at: '2026-05-05' },
      { id: 'd2', person_name: 'Metro Leasing', original_amount: 1500, remaining_amount: 1500, lent_date: '2026-05-01', status: 'outstanding', created_at: '2026-05-01' }
    ],
    debtRepayments: [
      { id: 'dr1', debt_id: 'd1', amount: 200, repayment_date: '2026-05-12', created_at: '2026-05-12' }
    ],
    attendance: [
      { id: 'a1', date: '2026-05-01', status: 'Present', calculatedHours: 8, checkInTime: '09:00', checkOutTime: '17:30' },
      { id: 'a2', date: '2026-05-02', status: 'Present', calculatedHours: 8.5, checkInTime: '08:30', checkOutTime: '17:30' },
      { id: 'a3', date: '2026-05-03', status: 'Leave' }
    ],
    salaryPayouts: [
      {
        id: 'sp1',
        periodStart: '2026-04-01',
        periodEnd: '2026-04-30',
        amountPaid: 4100,
        paidAt: '2026-05-01',
        notes: 'April Salary Payout'
      }
    ],
    savingsGoals: [
      { id: 'sg1', name: 'Emergency Reserve', targetAmount: 10000, currentAmount: 3500, createdAt: '2026-01-01' }
    ],
    savingsTransactions: [
      { id: 'st1', savingsGoalId: 'sg1', amount: 500, type: 'deposit', date: '2026-05-01', createdAt: '2026-05-01' }
    ],
    goals: [
      { id: 'g1', title: 'Complete Frontend Audit', description: 'Audit all views', category: 'Career', targetDate: '2026-05-31', progressPercentage: 95, targetAmount: 100, status: 'In Progress', priority: 'High', createdAt: '2026-05-01', savingsGoalId: 'sg1' }
    ]
  };

  const populatedBlob = await generateXOSReportPDF(populatedData, { datePreset: 'all' });
  assert(populatedBlob.size > 2000, `Populated PDF size must be >2KB, got ${populatedBlob.size} bytes`);
  console.log(`✓ Test 2 passed: Populated PDF generated successfully (${populatedBlob.size} bytes).`);

  // Case 3: Large Dataset (Multi-page stress test)
  console.log('Test 3: Generating PDF with 100+ multi-page records...');
  const largeData: PDFExportData = {
    ...populatedData,
    expenses: Array.from({ length: 60 }, (_, i) => ({
      id: `e_large_${i}`,
      title: `Expense Item #${i + 1}`,
      amount: Math.round(20 + (i * 7.5)),
      category: i % 2 === 0 ? 'Food & Groceries' : 'Transport',
      date: `2026-05-${String((i % 28) + 1).padStart(2, '0')}`,
      paymentMethod: 'Credit Card',
      createdAt: '2026-05-01'
    })),
    incomes: Array.from({ length: 30 }, (_, i) => ({
      id: `i_large_${i}`,
      title: `Invoice #${1000 + i}`,
      amount: 400 + (i * 25),
      source: 'Freelance',
      date: `2026-05-${String((i % 28) + 1).padStart(2, '0')}`,
      createdAt: '2026-05-01'
    })),
    attendance: Array.from({ length: 31 }, (_, i) => ({
      id: `att_large_${i}`,
      date: `2026-05-${String(i + 1).padStart(2, '0')}`,
      status: i % 7 === 0 ? ('Leave' as const) : ('Present' as const),
      calculatedHours: 8,
      checkInTime: '09:00',
      checkOutTime: '17:30'
    }))
  };

  const largeBlob = await generateXOSReportPDF(largeData, { datePreset: 'all' });
  assert(largeBlob.size > 8000, `Large dataset PDF size must be >8KB, got ${largeBlob.size} bytes`);
  const largePdfText = new TextDecoder('latin1').decode(new Uint8Array(await largeBlob.arrayBuffer()));
  assert(largePdfText.includes('Page 1 of '), 'Multi-page PDF must include Page X of Y numbering');
  assert(largePdfText.includes('Page 2 of '), 'Multi-page PDF must include Page 2 of Y numbering');
  console.log(`✓ Test 3 passed: Multi-page stress PDF generated with page numbering (${largeBlob.size} bytes).`);

  // Case 4: Single-page INR export omits page numbers and avoids WinAnsi ₹ corruption
  console.log('Test 4: Verifying single-page INR export & page-number omission...');
  const singlePageBlob = await generateXOSReportPDF(
    {
      ...populatedData,
      settings: { ...DEFAULT_USER_SETTINGS, currency: 'INR', dateFormat: 'DD/MM/YYYY' }
    },
    {
      datePreset: 'all',
      includeFinancial: false,
      includeDebt: true,
      includeAttendance: false,
      includeSalary: false,
      includeSavings: false,
      includeGoals: false
    }
  );
  const singlePageText = new TextDecoder('latin1').decode(new Uint8Array(await singlePageBlob.arrayBuffer()));
  assert(!singlePageText.includes('Page 1 of 1'), 'Single-page PDF must omit Page 1 of 1');
  assert(singlePageText.includes('INR 1,500'), 'INR amounts must render cleanly as INR in built-in Helvetica');
  assert(!singlePageText.includes('¹1,500'), 'PDF must not contain garbled WinAnsi Rupee character');
  console.log('✓ Test 4 passed: Single-page INR PDF cleanly formatted without page numbers or glyph corruption.');

  console.log('\n--- ALL PDF EXPORT TESTS PASSED SUCCESSFULLY! ---');
}

runPDFTests().catch(err => {
  console.error('PDF Test Failure:', err);
  process.exit(1);
});
