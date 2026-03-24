/**
 * @fileoverview PDF Currency Symbol Normalizer
 *
 * Fixes currency symbol corruption caused by incomplete or missing ToUnicode
 * CMaps in PDF fonts. Any library built on pdfjs-dist (pdf-parse, unpdf,
 * pdf.js-extract) has the same bug — this is a property of the PDF file,
 * not the OS, browser, or library version.
 *
 * Two distinct corruption types:
 *   1. Wrong character  — ₹→C, €→¬, £→#, ¥→\, ₱→P, ฿→B
 *   2. Missing entirely — ₩ and ₺ often produce blank or ?
 *      These cannot be reconstructed from text alone; only ISO codes help.
 *
 * Two-phase approach:
 *   Phase 1 — Safe fixes: always applied. Zero false-positive risk.
 *             Covers UTF-8/Latin-1 misreads, ISO 4217 codes, unambiguous
 *             character corruptions (¬, Rs., Php, Baht).
 *   Phase 2 — Context-aware fixes: applied only after currency detection.
 *             Targets characters that appear legitimately in text (C, P, B,
 *             #, \). Blindly replacing these without knowing the document
 *             currency will corrupt data.
 *
 * Usage:
 *   import { PDFCurrencyNormalizer } from './pdfCurrencyNormalizer.js';
 *
 *   const normalizer = new PDFCurrencyNormalizer();
 *   const page = await pdfDoc.getPage(1);
 *   const content = await page.getTextContent();
 *   const rawText = content.items.map(i => i.str).join(' ');
 *   const { text, currency } = normalizer.normalize(rawText);
 */

// ---------------------------------------------------------------------------
// Phase 1 — Safe replacements (always applied, zero false-positive risk)
// ---------------------------------------------------------------------------

/**
 * These patterns are safe to apply unconditionally because:
 * - UTF-8 misread sequences (â‚¹ etc.) never appear in valid text
 * - ISO 4217 codes before a digit are unambiguous in financial documents
 * - ¬ (NOT SIGN, U+00AC) does not appear in financial text
 * - Rs. and Php are unambiguous written-out abbreviations
 */
const SAFE_REPLACEMENTS = [
  // --- UTF-8 bytes misread as Latin-1 (Windows-1252 fallback encoding bug) ---
  // This is a separate bug from ToUnicode failure but common in the same PDFs.
  // Bytes 0xE2 0x82 0xXX are the UTF-8 encoding for currency symbols U+20XX.
  // When read as Latin-1, they produce the â‚X garbage sequence.
  [/â‚¹/g,  '₹'],  // INR  U+20B9
  [/â‚¬/g,  '€'],  // EUR  U+20AC
  [/â‚±/g,  '₱'],  // PHP  U+20B1
  [/â‚º/g,  '₺'],  // TRY  U+20BA
  [/â‚©/g,  '₩'],  // KRW  U+20A9
  [/Â£/g,   '£'],  // GBP  U+00A3 misread
  [/Â¥/g,   '¥'],  // JPY  U+00A5 misread

  // --- ISO 4217 codes used as text fallbacks in some PDF generators ---
  // Pattern: ISO code followed by whitespace and a digit.
  // "EUR/USD" or "USD index" won't match — safe.
  [/\bINR\s+(?=\d)/g,  '₹'],
  [/\bEUR\s+(?=\d)/g,  '€'],
  [/\bGBP\s+(?=\d)/g,  '£'],
  [/\bJPY\s+(?=\d)/g,  '¥'],
  [/\bKRW\s+(?=\d)/g,  '₩'],
  [/\bTRY\s+(?=\d)/g,  '₺'],
  [/\bTHB\s+(?=\d)/g,  '฿'],
  [/\bPHP\s+(?=\d)/g,  '₱'],
  [/\bUSD\s+(?=\d)/g,  '$'],
  [/\bAUD\s+(?=\d)/g,  'A$'],
  [/\bCAD\s+(?=\d)/g,  'CA$'],
  [/\bSGD\s+(?=\d)/g,  'S$'],
  [/\bHKD\s+(?=\d)/g,  'HK$'],
  [/\bMYR\s+(?=\d)/g,  'RM'],
  [/\bIDR\s+(?=\d)/g,  'Rp'],
  [/\bVND\s+(?=\d)/g,  '₫'],
  [/\bCNY\s+(?=\d)/g,  '¥'],
  [/\bBDT\s+(?=\d)/g,  '৳'],
  [/\bPKR\s+(?=\d)/g,  '₨'],
  [/\bNPR\s+(?=\d)/g,  'Rs.'],  // Nepalese Rupee has no unique symbol
  [/\bLKR\s+(?=\d)/g,  'Rs.'],  // Sri Lankan Rupee

  // --- Unambiguous written-out currency abbreviations ---
  [/\bRs\.\s*/g,    '₹'],   // Indian/Pakistani Rupee legacy notation
  [/\bPhp\s+(?=\d)/gi, '₱'], // Philippine Peso written out
  [/\bBaht\s+(?=\d)/gi, '฿'], // Thai Baht written out

  // --- Unambiguous single-character corruptions ---
  // ¬ (NOT SIGN, U+00AC) is not present in financial documents legitimately.
  // Root cause: € is 0x80 in Windows-1252; when mapped to Latin-1, 0xAC = ¬.
  [/¬\s*(?=\d)/g, '€'],
];

// ---------------------------------------------------------------------------
// Distinctive Indian lakh format — safe without currency detection
// ---------------------------------------------------------------------------
// Indian number system groups: 1,23,456 or 10,00,000 or 1,23,45,678
// The 2-digit middle group(s) make this unambiguous — Western grouping uses
// 3-digit groups exclusively, so this pattern cannot match legitimate text.
// Safe to apply without knowing the document currency.
//
// Breakdown: \d{1,2} (1-2 leading digits)
//            (?:,\d{2})+ (one or more 2-digit comma groups — the lakh signature)
//            ,\d{3}      (final 3-digit group)
//            (?:\.\d{1,2})? (optional decimal paise)
const LAKH_PATTERN = /\bC\s*(\d{1,2}(?:,\d{2})+,\d{3}(?:\.\d{1,2})?)\b/g;

// ---------------------------------------------------------------------------
// Currency detection
// ---------------------------------------------------------------------------
// Checked in order. First match wins. Adjust order if your use case has
// documents where multiple currencies appear (e.g. forex statements).
const CURRENCY_DETECTORS = [
  {
    currency: 'INR',
    patterns: [
      /\b(INR|rupee|rupees|paisa|paise|lakh|crore|HDFC|SBI|ICICI|Axis\s+Bank|Kotak|PNB|Canara|NEFT|IMPS|UPI|RBI)\b/i,
    ],
  },
  {
    currency: 'PHP',
    patterns: [
      /\b(PHP|peso|pesos|centavo|centavos|BDO|BPI|Metrobank|Landbank|GCash|Maya|Philippine|Philippines)\b/i,
    ],
  },
  {
    currency: 'THB',
    patterns: [
      /\b(THB|baht|satang|Kasikorn|KBank|SCB|Bangkok\s+Bank|Krungthai|TMB|Thailand|Thai)\b/i,
    ],
  },
  {
    currency: 'KRW',
    patterns: [
      /\b(KRW|원|won|jeon|Kookmin|Shinhan|Hana|Woori|IBK|Korea|Korean|대한민국)\b/i,
    ],
  },
  {
    currency: 'TRY',
    patterns: [
      /\b(TRY|lira|kuruş|kurus|Ziraat|Garanti|Akbank|İş\s+Bankas|Yapı|Turkey|Turkish|Türkiye|Turkiye)\b/i,
    ],
  },
  {
    currency: 'JPY',
    patterns: [
      /\b(JPY|yen|sen|MUFG|Mizuho|SMBC|Sumitomo|Resona|Japan|Japanese|三菱|みずほ|三井|りそな)\b/i,
    ],
  },
  {
    currency: 'EUR',
    patterns: [
      /\b(EUR|euro|euros|SEPA|IBAN|Deutsche\s+Bank|BNP|Société|Societe|UniCredit|Santander|ING|Rabobank|Commerzbank)\b/i,
    ],
  },
  {
    currency: 'GBP',
    patterns: [
      /\b(GBP|pound|pounds|sterling|pence|penny|Barclays|Lloyds|NatWest|Halifax|Nationwide|TSB|Monzo|Starling)\b/i,
    ],
  },
  {
    currency: 'MYR',
    patterns: [
      /\b(MYR|ringgit|sen|Maybank|CIMB|Public\s+Bank|RHB|Hong\s+Leong|Malaysia|Malaysian)\b/i,
    ],
  },
  {
    currency: 'IDR',
    patterns: [
      /\b(IDR|rupiah|BCA|Mandiri|BNI|BRI|Indonesia|Indonesian)\b/i,
    ],
  },
  {
    currency: 'VND',
    patterns: [
      /\b(VND|đồng|dong|Vietcombank|VietinBank|Techcombank|Vietnam|Vietnamese)\b/i,
    ],
  },
  {
    currency: 'CNY',
    patterns: [
      /\b(CNY|RMB|yuan|jiao|fen|ICBC|CCB|BOC|ABC|China|Chinese|中国|人民币|元)\b/i,
    ],
  },
  {
    currency: 'BDT',
    patterns: [
      /\b(BDT|taka|poisha|Sonali|Janata|Agrani|Bangladesh|Bangladeshi)\b/i,
    ],
  },
];

// ---------------------------------------------------------------------------
// Phase 2 — Context-aware fixes (only applied after currency detection)
// ---------------------------------------------------------------------------
// These target characters that appear legitimately in English and financial text:
// C (common letter), P (common letter), B (common letter), # (hash), \ (backslash)
// Applying these without confirmed currency detection will corrupt data.
//
// Number format notes per currency:
//   INR: 1,23,456.78  (Indian lakh/crore — 2-digit groups)
//        Some INR PDFs also use Western 1,234,567.89 — both covered.
//   PHP: 1,234,567.89 (Western grouping, dot decimal)
//   THB: 1,234,567.89 (Western grouping, dot decimal)
//   KRW: 1,234,567    (no decimals in normal usage)
//   TRY: 1.234.567,89 (dot thousands, comma decimal) — TL fallback only
//   JPY: 1,234,567    (no decimals)
//   GBP: 1,234,567.89 (Western grouping, dot decimal)
const CONTEXT_FIXES = {
  INR: [
    // Covers both Indian (1,23,456) and Western (1,234,567) grouping when INR is confirmed.
    // \d{1,3} covers amounts under 1,000 (no comma) as well.
    [/\bC\s*(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?)\b/g, '₹$1'],
  ],
  PHP: [
    // P before Western-formatted number.
    // "P" alone or "P&L" won't match — requires digit after optional space.
    [/\bP\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\b/g, '₱$1'],
  ],
  THB: [
    // B before number — highest false-positive risk of any currency.
    // Only applied when Thai document is confirmed.
    [/\bB\s*(\d{1,3}(?:,\d{3})*(?:\.\d{0,2})?)\b/g, '฿$1'],
  ],
  KRW: [
    // ₩ often produces blank — the ISO substitution in SAFE_REPLACEMENTS is
    // more reliable. This catches "W" used as a text fallback.
    [/\bW\s*(\d{1,3}(?:,\d{3})*)\b/g, '₩$1'],
  ],
  TRY: [
    // ₺ often produces blank. ISO substitution handles "TRY 1.234".
    // "TL" is a legacy text fallback for Turkish Lira.
    // Turkish format: dot as thousands, comma as decimal (1.234.567,89)
    [/\bTL\s*([\d.]+(?:,\d{1,2})?)\b/g, '₺$1'],
  ],
  JPY: [
    // \ (backslash) is the ToUnicode corruption of ¥ in JIS-encoded Japanese PDFs.
    // Only safe to replace when JPY is confirmed — backslash is common in paths,
    // regex, file names, and code blocks.
    [/\\\s*(\d{1,3}(?:,\d{3})*)\b/g, '¥$1'],
  ],
  GBP: [
    // # before a number — documented but uncommon corruption.
    [/#\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\b/g, '£$1'],
  ],
  MYR: [
    // RM is the standard symbol and almost never corrupted — ISO substitution
    // in SAFE_REPLACEMENTS is sufficient for MYR.
  ],
  IDR: [
    // Rp is the standard symbol. Indonesian PDFs rarely corrupt it.
  ],
  VND: [
    // ₫ sometimes becomes blank. ISO substitution in SAFE_REPLACEMENTS handles it.
  ],
  CNY: [
    // ¥ is shared between JPY and CNY — context detection disambiguates.
    // The \ corruption is less common for CNY since Chinese PDFs typically
    // use GB2312/GBK encoding which has better ¥ support.
    [/\\\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\b/g, '¥$1'],
  ],
};

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

export class PDFCurrencyNormalizer {
  /**
   * @param {object} [options]
   * @param {string|null} [options.forceCurrency]
   *   ISO 4217 code to bypass auto-detection entirely. Use when you know the
   *   document currency and want to skip the detection step.
   *   Example: new PDFCurrencyNormalizer({ forceCurrency: 'INR' })
   *
   * @param {boolean} [options.logUnknown]
   *   Log a warning when currency cannot be detected and context-aware fixes
   *   are skipped. Useful during development. Default: false.
   *
   * @param {boolean} [options.applyLakhPatternAlways]
   *   Apply the distinctive Indian lakh-format pattern even when currency is
   *   not detected. Safe because the pattern is unambiguous. Default: true.
   */
  constructor({ forceCurrency = null, logUnknown = false, applyLakhPatternAlways = true } = {}) {
    this.forceCurrency = forceCurrency ? forceCurrency.toUpperCase() : null;
    this.logUnknown = logUnknown;
    this.applyLakhPatternAlways = applyLakhPatternAlways;
  }

  /**
   * Detect the primary currency from document text.
   * Returns an ISO 4217 code string, or null if detection fails.
   * Detection checks each currency's patterns in order — first match wins.
   *
   * @param {string} text
   * @returns {string|null}
   */
  detectCurrency(text) {
    for (const { currency, patterns } of CURRENCY_DETECTORS) {
      if (patterns.some(p => p.test(text))) return currency;
    }
    return null;
  }

  /**
   * Normalize currency symbols in extracted PDF text.
   *
   * @param {string} text - Raw text string from pdfjs-dist getTextContent()
   * @returns {{ text: string, currency: string|null, fixed: boolean }}
   *   text     — normalized text
   *   currency — detected/forced ISO 4217 code, or null if unknown
   *   fixed    — true if any substitution was made
   */
  normalize(text) {
    if (typeof text !== 'string' || text.length === 0) {
      return { text, currency: null, fixed: false };
    }

    let result = text;

    // Phase 1 — Safe replacements
    for (const [pattern, replacement] of SAFE_REPLACEMENTS) {
      result = result.replace(pattern, replacement);
    }

    // Phase 1b — Lakh format (safe without detection)
    if (this.applyLakhPatternAlways) {
      result = result.replace(LAKH_PATTERN, '₹$1');
    }

    // Phase 2 — Context-aware replacements
    const currency = this.forceCurrency ?? this.detectCurrency(result);

    if (currency && CONTEXT_FIXES[currency]) {
      for (const [pattern, replacement] of CONTEXT_FIXES[currency]) {
        result = result.replace(pattern, replacement);
      }
    } else if (currency === null && this.logUnknown) {
      console.warn(
        '[PDFCurrencyNormalizer] Currency undetected — context-aware fixes skipped. ' +
        'Pass forceCurrency or add detection keywords to CURRENCY_DETECTORS.'
      );
    }

    return { text: result, currency, fixed: result !== text };
  }

  /**
   * Convenience: normalize all pages of a pdfjs-dist document.
   * Returns an array of normalized page texts.
   *
   * @param {import('pdfjs-dist').PDFDocumentProxy} pdfDoc
   * @returns {Promise<Array<{ pageNumber: number, text: string, currency: string|null, fixed: boolean }>>}
   *
   * @example
   * import * as pdfjsLib from 'pdfjs-dist';
   * import { PDFCurrencyNormalizer } from './pdfCurrencyNormalizer.js';
   *
   * const pdfDoc = await pdfjsLib.getDocument(arrayBuffer).promise;
   * const normalizer = new PDFCurrencyNormalizer({ logUnknown: true });
   * const pages = await normalizer.normalizeDocument(pdfDoc);
   * const fullText = pages.map(p => p.text).join('\n\n');
   */
  async normalizeDocument(pdfDoc) {
    const numPages = pdfDoc.numPages;
    const results = [];

    for (let i = 1; i <= numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const content = await page.getTextContent();
      const rawText = content.items.map(item => item.str).join(' ');
      const normalized = this.normalize(rawText);
      results.push({ pageNumber: i, ...normalized });
    }

    return results;
  }
}

// ---------------------------------------------------------------------------
// What cannot be fixed — documented here for honesty
// ---------------------------------------------------------------------------
//
// 1. Blank/missing symbols (₩, ₺ when the PDF glyph produces nothing at all)
//    pdfjs-dist emits an empty string for glyphs with no ToUnicode mapping AND
//    no encoding fallback. There is no text to match on. The ISO code
//    substitution (e.g. "KRW 1,234" → "₩1,234") is the only available fix.
//
// 2. ? substitutions (font uses the Unicode replacement character U+FFFD)
//    Indistinguishable from legitimate ? in text. Cannot be reliably fixed.
//
// 3. Multiple currencies in one document (forex, multi-currency bank accounts)
//    detectCurrency() returns the first match. If your documents have mixed
//    currencies, call normalize() per-section or pass forceCurrency explicitly.
//
// 4. PDFs with zero text layer (scanned images)
//    pdfjs-dist extracts no text at all. Use Tesseract.js as a fallback.
//    Be aware: OCR misreads on dense financial tables are common.
