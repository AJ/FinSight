import Papa from 'papaparse';

//
// TYPES
//

export interface StructuredRow {
  readonly rowIndex: number;
  readonly cells: Record<string, string>;
  readonly raw: string;
}

export interface StructuredParseResult {
  readonly headers: string[];
  readonly rows: StructuredRow[];
  readonly delimiter: string;
}

//
// COLUMN NAME NORMALIZATION
//

const HEADER_PATTERNS: Array<{ canonical: string; pattern: RegExp }> = [
  { canonical: 'date', pattern: /^(date|txn[\s._-]?date|transaction[\s._-]?date|value[\s._-]?date|dt)$/i },
  { canonical: 'description', pattern: /^(description|narration|particulars|details|remarks)$/i },
  { canonical: 'debit', pattern: /^(debit|withdrawal|dr|debit[\s(].*|withdrawal[\s(].*)$/i },
  { canonical: 'credit', pattern: /^(credit|deposit|cr|credit[\s(].*|deposit[\s(].*)$/i },
  { canonical: 'amount', pattern: /^(amount|amt|amount[\s(].*)$/i },
  { canonical: 'balance', pattern: /^(balance|bal|closing[\s._-]?balance|balance[\s(].*)$/i },
  { canonical: 'ref', pattern: /^(ref|chq|cheque|ref[\s._-]?no|chq[\s._-]?no)$/i },
];

const HEADER_KEYWORDS = new Set(['date', 'description', 'debit', 'credit', 'amount', 'balance']);

function normalizeColumnName(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  for (const { canonical, pattern } of HEADER_PATTERNS) {
    if (pattern.test(trimmed)) return canonical;
  }
  return null;
}

//
// DELIMITER DETECTION
//

function countDelimiter(text: string, delimiter: string): number {
  if (delimiter === '||') {
    let count = 0;
    let idx = 0;
    while ((idx = text.indexOf('||', idx)) !== -1) {
      count++;
      idx += 2;
    }
    return count;
  }
  return text.split(delimiter).length - 1;
}

function detectDelimiter(lines: string[]): { delimiter: string; consistency: number } | null {
  // Minimum lines with delimiter to consider it valid.
  // || is unambiguous (never appears in natural text), so 1 line suffices.
  // Comma and tab need ≥3 lines to avoid false positives from prose text.
  const MIN_LINES: Record<string, number> = { '||': 1, ',': 3, '\t': 3 };
  const candidates = ['||', ',', '\t'];
  let best: { delimiter: string; consistency: number } | null = null;

  for (const delimiter of candidates) {
    const counts = lines
      .map(line => countDelimiter(line, delimiter))
      .filter(c => c > 0);

    if (counts.length < (MIN_LINES[delimiter] ?? 3)) continue;

    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    if (mean < 2) continue;

    const variance = counts.reduce((s, c) => s + Math.pow(c - mean, 2), 0) / counts.length;
    const stdDev = Math.sqrt(variance);
    const consistency = mean > 0 ? 1 - stdDev / mean : 0;

    if (!best || consistency > best.consistency) {
      best = { delimiter, consistency };
    }
  }

  return best;
}

//
// CSV PARSING (papaparse for comma, split for || and tab)
//

function parseCsvText(text: string, delimiter: string): string[][] {
  if (delimiter === ',') {
    const result = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true });
    return result.data;
  }
  if (delimiter === '||') {
    return text
      .split('\n')
      .filter(l => l.trim() && !l.trim().startsWith('--- PAGE BREAK'))
      .map(line => line.split('||'));
  }
  // Tab
  return text
    .split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('--- PAGE BREAK'))
    .map(line => line.split('\t'));
}

//
// HEADER DETECTION
//

function isHeaderRow(cells: string[]): boolean {
  const normalized = cells
    .map(c => normalizeColumnName(c))
    .filter((c): c is string => c !== null);
  const uniqueKeywords = new Set(normalized.filter(c => HEADER_KEYWORDS.has(c)));
  return uniqueKeywords.size >= 3;
}

//
// PUBLIC ENTRY
//

export function parseStructuredRows(rawText: string): StructuredParseResult | null {
  const lines = rawText
    .split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('--- PAGE BREAK'));

  if (lines.length < 2) return null;

  const detected = detectDelimiter(lines);
  if (!detected || detected.consistency < 0.5) return null;

  const parsedLines = parseCsvText(rawText, detected.delimiter)
    .filter(cells => cells.some(c => c.trim()));

  let headerIdx = -1;
  let canonicalHeaders: string[] = [];

  for (let i = 0; i < parsedLines.length; i++) {
    if (isHeaderRow(parsedLines[i])) {
      headerIdx = i;
      canonicalHeaders = parsedLines[i].map(
        c => normalizeColumnName(c) ?? c.trim().toLowerCase()
      );
      break;
    }
  }

  if (headerIdx === -1) return null;

  const dataRows = parsedLines.slice(headerIdx + 1)
    .filter(cells => cells.some(c => c.trim()));

  if (dataRows.length < 1) return null;

  const rows: StructuredRow[] = dataRows.map((cells, idx) => {
    const cellMap: Record<string, string> = {};
    for (let ci = 0; ci < canonicalHeaders.length; ci++) {
      cellMap[canonicalHeaders[ci]] = (cells[ci] ?? '').trim();
    }
    return {
      rowIndex: idx,
      cells: cellMap,
      raw: cells.join(detected.delimiter === '||' ? '||' : detected.delimiter),
    };
  });

  return { headers: canonicalHeaders, rows, delimiter: detected.delimiter };
}

//
// CELL VALUE UTILITIES
//

export function parseCellAmount(value: string): number {
  const cleaned = value.trim();
  if (!cleaned) return NaN;

  const stripped = cleaned.replace(/^\+\s*/, '');
  const noSuffix = stripped.replace(/\s*[Cc][Rr]\s*$/, '');
  const noCommas = noSuffix.replace(/,/g, '');

  const num = Number(noCommas);
  return Number.isFinite(num) ? num : NaN;
}

export function determineTypeFromColumns(
  cells: Record<string, string>,
  amount: number,
): 'debit' | 'credit' | null {
  const debitVal = parseCellAmount(cells['debit'] ?? '');
  const creditVal = parseCellAmount(cells['credit'] ?? '');
  const amountVal = parseCellAmount(cells['amount'] ?? '');

  // Case A: separate debit/credit columns
  const debitMatches = !isNaN(debitVal) && Math.abs(debitVal - amount) < 0.01;
  const creditMatches = !isNaN(creditVal) && Math.abs(creditVal - amount) < 0.01;

  if (debitMatches && !creditMatches) return 'debit';
  if (creditMatches && !debitMatches) return 'credit';
  if (debitMatches && creditMatches) return null;

  // Case B: single amount column
  if (!isNaN(amountVal) && Math.abs(amountVal - amount) < 0.01) {
    const raw = cells['amount'] ?? '';
    if (/^\+\s*/.test(raw.trim())) return 'credit';
    if (/\s*[Cc][Rr]\s*$/.test(raw.trim())) return 'credit';
    const typeCol = cells['type'] ?? cells['cr_dr'] ?? '';
    if (/cr|credit/i.test(typeCol)) return 'credit';
    if (/dr|debit/i.test(typeCol)) return 'debit';
    return 'debit';
  }

  return null;
}
