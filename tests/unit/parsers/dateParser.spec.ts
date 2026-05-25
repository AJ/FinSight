import { describe, it, expect } from 'vitest';
import { parseDate, extractDateFromText, detectDateOrder, excelSerialToDate } from '@/lib/parsers/dateParser';

describe('parseDate — standard formats', () => {
  it('parses ISO format YYYY-MM-DD', () => {
    const result = parseDate('2024-01-15');
    expect(result).toEqual(new Date(2024, 0, 15));
  });

  it('parses DD-Mon-YYYY', () => {
    const result = parseDate('15-Jan-2024');
    expect(result).toEqual(new Date(2024, 0, 15));
  });

  it('parses Mon DD YYYY', () => {
    const result = parseDate('Jan 15 2024');
    expect(result).toEqual(new Date(2024, 0, 15));
  });

  it('parses DD/MM/YYYY', () => {
    const result = parseDate('15/01/2024');
    expect(result).toEqual(new Date(2024, 0, 15));
  });

  it('parses DD.MM.YYYY', () => {
    const result = parseDate('15.01.2024');
    expect(result).toEqual(new Date(2024, 0, 15));
  });

  it('parses DD-MM-YYYY', () => {
    const result = parseDate('15-01-2024');
    expect(result).toEqual(new Date(2024, 0, 15));
  });

  it('parses compact YYYYMMDD', () => {
    const result = parseDate('20240115');
    expect(result).toEqual(new Date(2024, 0, 15));
  });
});

describe('parseDate — noise cleanup', () => {
  it('removes day-of-week prefix', () => {
    const result = parseDate('Mon, 15 Jan 2024');
    expect(result).toEqual(new Date(2024, 0, 15));
  });

  it('removes ordinal suffixes', () => {
    const result = parseDate('15th Jan 2024');
    expect(result).toEqual(new Date(2024, 0, 15));
  });

  it('removes trailing time component', () => {
    const result = parseDate('15/01/2024 14:30:00');
    expect(result).toEqual(new Date(2024, 0, 15));
  });
});

describe('parseDate — disambiguation', () => {
  it('interprets with DMY when first value > 12', () => {
    const result = parseDate('15/01/2024');
    expect(result).toEqual(new Date(2024, 0, 15));
  });

  it('interprets with MDY when second value > 12', () => {
    const result = parseDate('01/15/2024');
    expect(result).toEqual(new Date(2024, 0, 15));
  });

  it('uses DMY preference for ambiguous dates', () => {
    const result = parseDate('05/01/2024', 'DMY');
    expect(result).toEqual(new Date(2024, 0, 5));
  });

  it('uses MDY preference for ambiguous dates', () => {
    const result = parseDate('05/01/2024', 'MDY');
    expect(result).toEqual(new Date(2024, 4, 1));
  });
});

describe('parseDate — rejection', () => {
  it('returns null for overflow dates (Feb 30)', () => {
    expect(parseDate('30/02/2024')).toBeNull();
  });

  it('returns null for year < 1990', () => {
    expect(parseDate('15/01/1980')).toBeNull();
  });

  it('returns null for year > 2100', () => {
    expect(parseDate('15/01/2150')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseDate('')).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(parseDate('abcdef')).toBeNull();
  });
});

describe('parseDate — 2-digit years', () => {
  it('expands years < 50 to 20XX', () => {
    const result = parseDate('15/01/24');
    expect(result).toEqual(new Date(2024, 0, 15));
  });

  it('expands years >= 50 to 19XX but rejects if outside 1990-2100 range', () => {
    // expandYear converts 80 → 1980, but parseDate rejects year < 1990
    expect(parseDate('15/01/80')).toBeNull();
    // Year 95 → 1995 is within range
    const result = parseDate('15/01/95');
    expect(result).toEqual(new Date(1995, 0, 15));
  });
});

describe('detectDateOrder', () => {
  it('detects DMY from unambiguous dates', () => {
    expect(detectDateOrder(['15/01/2024', '20/02/2024'])).toBe('DMY');
  });

  it('detects MDY from unambiguous dates', () => {
    expect(detectDateOrder(['01/15/2024', '02/20/2024'])).toBe('MDY');
  });

  it('defaults to DMY for ambiguous dates', () => {
    expect(detectDateOrder(['01/02/2024'])).toBe('DMY');
  });

  it('returns DMY for empty array', () => {
    expect(detectDateOrder([])).toBe('DMY');
  });
});

describe('extractDateFromText', () => {
  it('extracts date from mixed content', () => {
    const result = extractDateFromText('Transaction on 15/01/2024');
    expect(result).toEqual(new Date(2024, 0, 15));
  });

  it('returns null when no date present', () => {
    expect(extractDateFromText('No date here')).toBeNull();
  });
});

describe('parseDate — YYYY.MM.DD pattern', () => {
  it('parses YYYY.MM.DD (European dot-separated)', () => {
    const result = parseDate('2024.01.15');
    expect(result).toEqual(new Date(2024, 0, 15));
  });
});

describe('parseDate — DD.MM.YY pattern', () => {
  it('parses DD.MM.YY with 2-digit year', () => {
    const result = parseDate('15.01.24');
    expect(result).toEqual(new Date(2024, 0, 15));
  });
});

describe('parseDate — detected order does not override unambiguous dates', () => {
  it('parses 29/02/2024 as unambiguous DMY regardless of MDY preference', () => {
    // a=29 > 12, b=2 <= 12 → unambiguous DMY. Detected order is irrelevant.
    const result = parseDate('29/02/2024', 'MDY');
    expect(result).toEqual(new Date(2024, 1, 29));
  });

  it('parses 02/29/2024 as unambiguous MDY regardless of DMY preference', () => {
    // b=29 > 12, a=2 <= 12 → unambiguous MDY. Detected order is irrelevant.
    const result = parseDate('02/29/2024', 'DMY');
    expect(result).toEqual(new Date(2024, 1, 29));
  });
});

describe('parseDate — native Date constructor fallback', () => {
  it('uses native Date constructor for date strings not matching any pattern', () => {
    // "15 Jan, 2024" with a comma — let's check if it matches patterns.
    // After cleaning: "15 Jan, 2024"
    // Pattern 2 (DD-Mon-YYYY): regex /^(\d{1,2})[-/\s]([A-Za-z]{3,9})[-/\s,]*(\d{2,4})$/
    // "15 Jan, 2024" => match with comma consumed by [-/\s,]* => hits pattern 2, not native fallback.
    //
    // We need something that passes ALL pattern checks but still parses natively.
    // A date-only ISO string with a T attached (time stripped) would work.
    // Input: "2024-01-15T00:00:00" — after time stripping, becomes "2024-01-15"
    // which matches pattern 1. Not useful.
    //
    // "2024-Jan-15" — doesn't start with digit (wait, it does: 2024).
    // Pattern 1: /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/ — "Jan" is not \d{1,2}, fails.
    // Pattern 6 (YYYY.MM.DD): dots not dashes, fails.
    // Falls through to native Date which parses it.
    const result = parseDate('2024-Jan-15');
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2024);
    expect(result!.getMonth()).toBe(0);
    expect(result!.getDate()).toBe(15);
  });
});

describe('excelSerialToDate', () => {
  it('converts valid serial (45306 → Jan 15, 2024)', () => {
    const result = excelSerialToDate(45306);
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2024);
    expect(result!.getMonth()).toBe(0); // January
    expect(result!.getDate()).toBe(15);
  });

  it('rejects serial 60 (Feb 29 1900) because year < 1990', () => {
    // The Lotus bug date is rejected by the year range check
    expect(excelSerialToDate(60)).toBeNull();
  });

  it('converts a serial within the valid year range', () => {
    // Serial for ~2024-06-01 (roughly)
    const result = excelSerialToDate(45444);
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBeGreaterThanOrEqual(1990);
    expect(result!.getFullYear()).toBeLessThanOrEqual(2100);
  });

  it('returns null for serial 0', () => {
    expect(excelSerialToDate(0)).toBeNull();
  });

  it('returns null for serial > 100000', () => {
    expect(excelSerialToDate(100001)).toBeNull();
  });
});

describe('parseDate — unambiguous dates with invalid day/month combinations', () => {
  it('returns null for Feb 29 in non-leap year (unambiguous DMY)', () => {
    // a=29 > 12 → unambiguous DMY path. Feb 29 2023 doesn't exist → null.
    const result = parseDate('29/02/2023', 'DMY');
    expect(result).toBeNull();
  });

  it('parses 31/01/2024 as unambiguous DMY regardless of MDY preference', () => {
    // a=31 > 12 → unambiguous DMY path. Jan 31 is valid.
    const result = parseDate('31/01/2024', 'MDY');
    expect(result).toEqual(new Date(2024, 0, 31));
  });
});

describe('parseDate — native fallback overflow protection', () => {
  it('rejects "30 Feb 2024" (month name with invalid day)', () => {
    expect(parseDate('30 Feb 2024')).toBeNull();
  });

  it('rejects "25-13-15" — month 13 is invalid regardless of DMY/YY-MM-DD interpretation', () => {
    expect(parseDate('25-13-15')).toBeNull();
  });

  it('rejects "32-01-15" — native fallback blocked for pattern-matched strings', () => {
    expect(parseDate('32-01-15')).toBeNull();
  });

  it('rejects "2024-02-30" (ISO with overflow)', () => {
    expect(parseDate('2024-02-30')).toBeNull();
  });
});
