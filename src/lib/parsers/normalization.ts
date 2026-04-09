/**
 * Statement text normalization.
 *
 * Converts broken PDF text into structured, readable text for LLM extraction.
 *
 * Layers:
 * 1. Character-level cleanup (unicode, line endings, non-printable)
 * 2. Currency symbol normalization (fix PDF font encoding issues)
 * 3. Whitespace and numeric repair
 * 4. Structural noise removal (headers, footers, disclaimers)
 * 5. Transaction row reconstruction
 */

import { PDFCurrencyNormalizer } from '@/lib/utils/pdfCurrencyNormalizer';

export function normalizeStatementText(raw: string): string {
  let text = raw;

  // Layer 1: Character-level cleanup
  text = normalizeUnicode(text);
  text = normalizeLineEndings(text);
  text = removeNonPrintable(text);

  // Layer 2: Currency symbol normalization (fix PDF font encoding issues)
  // This fixes "C 60,734.87" → "₹60,734.87" → "60734.87"
  const normalizer = new PDFCurrencyNormalizer({ applyLakhPatternAlways: true });
  const currencyResult = normalizer.normalize(text);
  text = currencyResult.text;

  // Layer 3: Whitespace and numeric repair
  // Replace pipe characters with spaces — PDF column separators that the LLM
  // misinterprets as part of data (e.g. "2025-10-04|00:00" → "2025-10-04 00:00")
  text = text.replace(/\|/g, ' ');

  text = normalizeWhitespace(text);
  text = fixBrokenNumbers(text);

  // Layer 4: Structural noise removal - DISABLED
  // These pattern-matching approaches are too fragile for production use
  // Different banks use different formats, and LLMs can handle raw text well
  // text = removeHeadersFooters(text);
  // text = removeNoiseSections(text);

  // Layer 5: Transaction row reconstruction - DISABLED
  // The date-pattern matching is too aggressive and strips valid transactions
  // text = reconstructTransactions(text);

  return text.trim();
}

function normalizeUnicode(text: string): string {
  return text.normalize('NFKC');
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function removeNonPrintable(text: string): string {
  // Preserves tabs, newlines, ₹, non-breaking space, dashes
  return text.replace(
    /[^\x09\x0A\x0D\x20-\x7E\u00A0\u20B9\u2013\u2014]/g,
    ''
  );
}

function normalizeWhitespace(text: string): string {
  return text
    // Collapse multiple spaces/tabs into single space
    .replace(/[ \t]+/g, ' ')
    // Collapse multiple newlines into max 2 (preserve paragraph breaks)
    .replace(/\n{3,}/g, '\n\n')
    // Trim leading/trailing whitespace from each line
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .trim();
}

function fixBrokenNumbers(text: string): string {
  return text
    // Fix spaces inside comma-separated numbers
    .replace(/(\d)\s*,\s*(\d)/g, '$1,$2')
    // Fix decimal splits
    .replace(/(\d)\s*\.\s*(\d{2})(?!\d)/g, '$1.$2')
    // Fix negative sign spacing
    .replace(/-\s+(\d)/g, '-$1')
    // Remove ₹ symbol (preserve the number)
    .replace(/₹\s*/g, '');
}

// Disabled - too fragile for production use
// These functions are kept for reference but not called from normalizeStatementText()

/*
function removeHeadersFooters(text: string): string {
  const lines = text.split('\n');
  const patterns = [
    /^page\s+\d+(\s+of\s+\d+)?$/i,
    /statement\s+generated/i,
    /customer\s+care/i,
    /this\s+is\s+a\s+system\s+generated/i,
    /confidential/i,
    /do\s+not\s+share/i
  ];

  return lines
    .filter(line => !patterns.some(p => p.test(line.trim())))
    .join('\n');
}

function removeNoiseSections(text: string): string {
  const noiseSectionPatterns = [
    /^Important\s+Information/i,
    /^Terms\s+and\s+Conditions/i,
    /^Reward\s+Redemption\s+Terms/i,
    /^Interest\s+Calculation\s+(Method|Details)/i,
    /^Grievance\s+Redressal/i,
    /^Disclaimer/i
  ];

  const sectionBoundaryPatterns = [
    /^Reward\s+Points\s+Summary/i,
    /^Transaction\s+(Details|Summary|History)/i,
    /^Account\s+Summary/i,
    /^Payment\s+Summary/i,
    /^Cashback\s+Summary/i
  ];

  const lines = text.split('\n');
  const result: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Check for boundary patterns FIRST - these stop skipping
    if (sectionBoundaryPatterns.some(p => p.test(trimmed))) {
      skipping = false;
      result.push(line);  // Keep the boundary line
      continue;
    }

    // Check for noise patterns - these start skipping
    if (noiseSectionPatterns.some(p => p.test(trimmed))) {
      skipping = true;
      continue;  // Don't keep the noise line
    }

    // Only add line if not skipping
    if (!skipping) {
      result.push(line);
    }
  }

  return result.join('\n');
}

function reconstructTransactions(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let buffer: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      if (buffer.length) {
        result.push(buffer.join(' '));
        buffer = [];
      }
      continue;
    }

    if (isTransactionStart(trimmed)) {
      if (buffer.length) {
        result.push(buffer.join(' '));
      }
      buffer = [trimmed];
    } else if (buffer.length > 0) {
      buffer.push(trimmed);
    } else {
      result.push(trimmed);
    }
  }

  if (buffer.length) {
    result.push(buffer.join(' '));
  }

  return result.join('\n');
}

function isTransactionStart(line: string): boolean {
  // Matches various date formats found in Indian bank/CC statements
  const datePattern = /^\d{1,2}[\s\-][A-Za-z]{3}|\d{1,2}\/\d{2}\/\d{2,4}|\d{1,2}-\d{2}-\d{4}|\d{1,2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2}|[A-Za-z]{3}\s+\d{1,2},?\s+\d{4}|\d{1,2}-[A-Za-z]{3}-\d{4}/;
  return datePattern.test(line);
}
*/
