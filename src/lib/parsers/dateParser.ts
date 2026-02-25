/**
 * Universal date parser that handles dozens of date formats from banks around the world.
 * Returns a Date object or null if the string cannot be parsed.
 */

const MONTH_MAP: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

interface DatePattern {
  regex: RegExp;
  extract: (
    m: RegExpMatchArray,
  ) => { day: number; month: number; year: number } | null;
}

/**
 * All patterns we recognise. They are tried in order; the first match wins.
 * Month in result is 0-based (JS Date convention).
 */
const DATE_PATTERNS: DatePattern[] = [
  // ISO: 2024-01-15 or 2024/01/15
  {
    regex: /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/,
    extract: (m) => ({ year: +m[1], month: +m[2] - 1, day: +m[3] }),
  },
  // DD-Mon-YYYY or DD Mon YYYY  (e.g. "15-Jan-2024", "15 Jan 2024")
  {
    regex: /^(\d{1,2})[-/\s]([A-Za-z]{3,9})[-/\s,]*(\d{2,4})$/,
    extract: (m) => {
      const mo = MONTH_MAP[m[2].toLowerCase()];
      if (mo === undefined) return null;
      return { day: +m[1], month: mo, year: expandYear(+m[3]) };
    },
  },
  // Mon DD, YYYY  (e.g. "Jan 15, 2024", "January 15 2024")
  {
    regex: /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s*(\d{2,4})$/,
    extract: (m) => {
      const mo = MONTH_MAP[m[1].toLowerCase()];
      if (mo === undefined) return null;
      return { day: +m[2], month: mo, year: expandYear(+m[3]) };
    },
  },
  // DD/MM/YYYY or DD-MM-YYYY (most of the world)
  {
    regex: /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/,
    extract: (m) => ({ day: +m[1], month: +m[2] - 1, year: +m[3] }),
  },
  // DD/MM/YY or DD-MM-YY
  {
    regex: /^(\d{1,2})[-/](\d{1,2})[-/](\d{2})$/,
    extract: (m) => ({ day: +m[1], month: +m[2] - 1, year: expandYear(+m[3]) }),
  },
  // MM/DD/YYYY (US) — handled as ambiguous, see disambiguation below
  // YYYY.MM.DD (some European)
  {
    regex: /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/,
    extract: (m) => ({ year: +m[1], month: +m[2] - 1, day: +m[3] }),
  },
  // DD.MM.YYYY (German/Swiss/Russian etc.)
  {
    regex: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/,
    extract: (m) => ({ day: +m[1], month: +m[2] - 1, year: +m[3] }),
  },
  // DD.MM.YY
  {
    regex: /^(\d{1,2})\.(\d{1,2})\.(\d{2})$/,
    extract: (m) => ({ day: +m[1], month: +m[2] - 1, year: expandYear(+m[3]) }),
  },
  // YYYYMMDD (compact)
  {
    regex: /^(\d{4})(\d{2})(\d{2})$/,
    extract: (m) => ({ year: +m[1], month: +m[2] - 1, day: +m[3] }),
  },
];

function expandYear(y: number): number {
  if (y >= 100) return y;
  return y < 50 ? 2000 + y : 1900 + y;
}

/**
 * Parse a single date string into a Date object.
 * Tries all known patterns. Returns null on failure.
 */
export function parseDate(raw: string): Date | null {
  if (!raw) return null;

  // Clean up common noise
  let cleaned = raw.trim();
  // Remove day-of-week prefixes: "Mon, ", "Monday "
  cleaned = cleaned.replace(
    /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*[,.]?\s*/i,
    "",
  );
  // Remove trailing time components that sometimes appear
  cleaned = cleaned.replace(
    /\s+\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM|am|pm)?.*$/,
    "",
  );
  // Remove ordinal suffixes (1st, 2nd, 3rd, 4th...)
  cleaned = cleaned.replace(/(\d)(st|nd|rd|th)\b/gi, "$1");

  for (const pattern of DATE_PATTERNS) {
    const match = cleaned.match(pattern.regex);
    if (!match) continue;

    const parts = pattern.extract(match);
    if (!parts) continue;

    const { day, month, year } = parts;

    // Validate ranges
    if (month < 0 || month > 11) continue;
    if (day < 1 || day > 31) continue;
    if (year < 1990 || year > 2100) continue;

    const d = new Date(year, month, day);
    // Verify the date didn't overflow (e.g. Feb 30)
    if (
      d.getFullYear() === year &&
      d.getMonth() === month &&
      d.getDate() === day
    ) {
      return d;
    }
  }

  // Last-resort: try native Date constructor
  const native = new Date(cleaned);
  if (
    !isNaN(native.getTime()) &&
    native.getFullYear() >= 1990 &&
    native.getFullYear() <= 2100
  ) {
    return native;
  }

  return null;
}

/**
 * Extract a Date from a string that may contain other text.
 * E.g. "Transaction on 15/01/2024 at 14:30" → Date(2024, 0, 15)
 */
export function extractDateFromText(text: string): Date | null {
  if (!text) return null;

  // Try the string itself first
  const direct = parseDate(text);
  if (direct) return direct;

  // Try to find a date substring using common patterns
  const dateRegexes = [
    /\d{4}[-/]\d{1,2}[-/]\d{1,2}/, // YYYY-MM-DD
    /\d{1,2}[-/]\d{1,2}[-/]\d{4}/, // DD/MM/YYYY
    /\d{1,2}[-/]\d{1,2}[-/]\d{2}(?!\d)/, // DD/MM/YY
    /\d{1,2}[-/\s][A-Za-z]{3,9}[-/\s,]*\d{2,4}/, // DD-Mon-YYYY
    /[A-Za-z]{3,9}\s+\d{1,2},?\s*\d{2,4}/, // Mon DD, YYYY
    /\d{1,2}\.\d{1,2}\.\d{2,4}/, // DD.MM.YYYY
  ];

  for (const re of dateRegexes) {
    const match = text.match(re);
    if (match) {
      const result = parseDate(match[0]);
      if (result) return result;
    }
  }

  return null;
}

/**
 * Given a batch of date strings, detect whether the format is DD/MM or MM/DD.
 * Useful for disambiguating numeric-only dates.
 * Returns 'DMY' or 'MDY'.
 */
export function detectDateOrder(dateStrings: string[]): "DMY" | "MDY" {
  let dmyScore = 0;
  let mdyScore = 0;

  for (const ds of dateStrings) {
    const match = ds.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
    if (!match) continue;

    const a = parseInt(match[1], 10);
    const b = parseInt(match[2], 10);

    // If a > 12, it MUST be a day → DMY
    if (a > 12 && a <= 31) dmyScore += 5;
    // If b > 12, it MUST be a day → MDY
    if (b > 12 && b <= 31) mdyScore += 5;
  }

  // Default to DMY (used by most of the world)
  return mdyScore > dmyScore ? "MDY" : "DMY";
}

/**
 * Handle Excel serial date numbers (days since 1900-01-01 with the Lotus 1-2-3 bug).
 */
export function excelSerialToDate(serial: number): Date | null {
  if (serial < 1 || serial > 100000) return null;
  // Excel epoch is Jan 1, 1900, but it thinks 1900 was a leap year (Lotus bug).
  // Day 1 = Jan 1, 1900; Day 60 = Feb 29, 1900 (doesn't exist). Day 61 = Mar 1, 1900.
  const epoch = new Date(1899, 11, 30); // Dec 30, 1899
  const d = new Date(epoch.getTime() + serial * 86400000);
  if (d.getFullYear() < 1990 || d.getFullYear() > 2100) return null;
  return d;
}
