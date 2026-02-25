import { Transaction } from '@/types';

export function exportTransactionsToCSV(transactions: Transaction[]): void {
  if (transactions.length === 0) {
    alert('No transactions to export!');
    return;
  }

  // Create CSV header
  const header = ['Date', 'Description', 'Amount', 'Type', 'Category', 'Merchant'].join(',');

  // Create CSV rows
  const rows = transactions.map((t) => {
    const date = t.date.toISOString().split('T')[0];
    const description = `"${t.description.replace(/"/g, '""')}"`;
    const amount = t.amount.toString();
    const type = t.type;
    const category = t.category;
    const merchant = t.merchant ? `"${t.merchant.replace(/"/g, '""')}"` : '';

    return [date, description, amount, type, category, merchant].join(',');
  });

  // Combine header and rows
  const csv = [header, ...rows].join('\n');

  // Create blob and download
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `transactions_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportDebugLog(text: string, transactions: Transaction[]): void {
  const debugInfo = `
=== PDF PARSING DEBUG LOG ===
Generated: ${new Date().toISOString()}

=== EXTRACTED TEXT ===
${text}

=== PARSED TRANSACTIONS (${transactions.length}) ===
${transactions.map((t, i) => `
Transaction ${i + 1}:
  Date: ${t.date.toISOString()}
  Description: ${t.description}
  Amount: ${t.amount}
  Type: ${t.type}
  Category: ${t.category}
  Original Text: ${t.originalText}
`).join('\n')}

=== END DEBUG LOG ===
  `.trim();

  const blob = new Blob([debugInfo], { type: 'text/plain;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `pdf_debug_${new Date().toISOString().split('T')[0]}.txt`);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
