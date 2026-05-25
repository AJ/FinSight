import { describe, it, expect, vi } from 'vitest';

import { PDFCurrencyNormalizer } from '@/lib/utils/pdfCurrencyNormalizer.js';

describe('PDFCurrencyNormalizer', () => {
  describe('detectCurrency', () => {
    const normalizer = new PDFCurrencyNormalizer();

    it('detects INR from NEFT keyword', () => {
      expect(normalizer.detectCurrency('NEFT-HDFC0001234 C 5000')).toBe('INR');
    });

    it('detects INR from "lakh" keyword', () => {
      expect(normalizer.detectCurrency('Amount: 5 lakh')).toBe('INR');
    });

    it('detects INR from "ICICI" bank name', () => {
      expect(normalizer.detectCurrency('ICICI Bank Statement')).toBe('INR');
    });

    it('detects PHP from "BDO" bank name', () => {
      expect(normalizer.detectCurrency('BDO Unibank Statement')).toBe('PHP');
    });

    it('detects THB from "Bangkok Bank"', () => {
      expect(normalizer.detectCurrency('Bangkok Bank Transaction')).toBe('THB');
    });

    it('detects KRW from "Shinhan" bank', () => {
      expect(normalizer.detectCurrency('Shinhan Bank withdrawal')).toBe('KRW');
    });

    it('detects TRY from "Garanti" bank', () => {
      expect(normalizer.detectCurrency('Garanti BBVA hesap')).toBe('TRY');
    });

    it('detects JPY from "MUFG" bank', () => {
      expect(normalizer.detectCurrency('MUFG withdrawal')).toBe('JPY');
    });

    it('detects EUR from "SEPA" keyword', () => {
      expect(normalizer.detectCurrency('SEPA transfer 500 EUR')).toBe('EUR');
    });

    it('detects GBP from "Barclays" bank', () => {
      expect(normalizer.detectCurrency('Barclays current account')).toBe('GBP');
    });

    it('detects MYR from "ringgit"', () => {
      expect(normalizer.detectCurrency('1000 ringgit')).toBe('MYR');
    });

    it('detects IDR from "BCA" bank', () => {
      expect(normalizer.detectCurrency('BCA transfer')).toBe('IDR');
    });

    it('detects VND from "Vietcombank"', () => {
      expect(normalizer.detectCurrency('Vietcombank statement')).toBe('VND');
    });

    it('detects CNY from "ICBC" bank', () => {
      expect(normalizer.detectCurrency('ICBC transfer 5000')).toBe('CNY');
    });

    it('detects BDT from "taka"', () => {
      expect(normalizer.detectCurrency('500 taka')).toBe('BDT');
    });

    it('returns null for non-financial text', () => {
      expect(normalizer.detectCurrency('The quick brown fox jumps')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(normalizer.detectCurrency('')).toBeNull();
    });

    it('first-match-wins: INR detected before EUR when both keywords present', () => {
      const text = 'NEFT transfer to Deutsche Bank EUR 500';
      expect(normalizer.detectCurrency(text)).toBe('INR');
    });

    it('is case-insensitive for "rupee"', () => {
      expect(normalizer.detectCurrency('RUPEE amount')).toBe('INR');
    });
  });

  describe('Phase 1 — Safe replacements', () => {
    const normalizer = new PDFCurrencyNormalizer();

    it('fixes UTF-8 misread â‚¹ → ₹ (INR)', () => {
      const result = normalizer.normalize('Balance â‚¹50,000');
      expect(result.text).toContain('₹');
      expect(result.text).not.toContain('â‚¹');
    });

    it('fixes UTF-8 misread â‚¬ → € (EUR)', () => {
      const result = normalizer.normalize('Amount â‚¬100');
      expect(result.text).toContain('€');
    });

    it('fixes UTF-8 misread â‚± → ₱ (PHP)', () => {
      const result = normalizer.normalize('Total â‚±5,000');
      expect(result.text).toContain('₱');
    });

    it('fixes UTF-8 misread â‚º → ₺ (TRY)', () => {
      const result = normalizer.normalize('Balance â‚º2000');
      expect(result.text).toContain('₺');
    });

    it('fixes UTF-8 misread â‚© → ₩ (KRW)', () => {
      const result = normalizer.normalize('Amount â‚©50000');
      expect(result.text).toContain('₩');
    });

    it('fixes Â£ → £ (GBP misread)', () => {
      const result = normalizer.normalize('Total Â£250');
      expect(result.text).toContain('£');
    });

    it('fixes Â¥ → ¥ (JPY misread)', () => {
      const result = normalizer.normalize('Amount Â¥10000');
      expect(result.text).toContain('¥');
    });

    it('fixes ISO code INR before digit', () => {
      const result = normalizer.normalize('INR 5000 debited');
      expect(result.text).toContain('₹');
      expect(result.text).not.toContain('INR');
    });

    it('does NOT replace INR in "INR/USD" (no digit after)', () => {
      const result = normalizer.normalize('INR/USD exchange rate');
      expect(result.text).toContain('INR');
    });

    it('fixes EUR before digit', () => {
      const result = normalizer.normalize('EUR 100 payment');
      expect(result.text).toContain('€');
    });

    it('fixes JPY before digit', () => {
      const result = normalizer.normalize('JPY 5000');
      expect(result.text).toContain('¥');
    });

    it('fixes Rs. written abbreviation', () => {
      const result = normalizer.normalize('Rs. 500 debited');
      expect(result.text).toContain('₹');
    });

    it('fixes Php written abbreviation', () => {
      const result = normalizer.normalize('Php 1000 payment');
      expect(result.text).toContain('₱');
    });

    it('fixes Baht written abbreviation', () => {
      const result = normalizer.normalize('Baht 5000 transfer');
      expect(result.text).toContain('฿');
    });

    it('fixes ¬ before digit (€ corruption)', () => {
      const result = normalizer.normalize('¬ 200');
      expect(result.text).toContain('€');
    });

    it('does NOT replace ¬ without following digit', () => {
      const result = normalizer.normalize('¬ is a logical NOT');
      expect(result.text).toContain('¬');
    });
  });

  describe('Phase 1b — Lakh pattern', () => {
    const normalizer = new PDFCurrencyNormalizer();

    it('replaces C before lakh-formatted number', () => {
      const result = normalizer.normalize('Balance C 1,23,456.78');
      expect(result.text).toContain('₹1,23,456.78');
    });

    it('handles crore pattern (1,23,45,678)', () => {
      const result = normalizer.normalize('Amount C 1,23,45,678');
      expect(result.text).toContain('₹1,23,45,678');
    });

    it('does NOT apply when applyLakhPatternAlways=false', () => {
      const noLakh = new PDFCurrencyNormalizer({ applyLakhPatternAlways: false });
      const result = noLakh.normalize('Balance C 1,23,456');
      expect(result.text).toBe('Balance C 1,23,456');
    });
  });

  describe('Phase 2 — Context-aware fixes', () => {
    it('INR: replaces C before number when INR detected', () => {
      const normalizer = new PDFCurrencyNormalizer({ forceCurrency: 'INR' });
      const result = normalizer.normalize('C 5,000 debited');
      expect(result.text).toContain('₹5,000');
    });

    it('INR: replaces C before lakh-formatted number', () => {
      const normalizer = new PDFCurrencyNormalizer({ forceCurrency: 'INR' });
      const result = normalizer.normalize('C 1,23,456');
      expect(result.text).toContain('₹1,23,456');
    });

    it('PHP: replaces P before number when PHP detected', () => {
      const normalizer = new PDFCurrencyNormalizer({ forceCurrency: 'PHP' });
      const result = normalizer.normalize('P 1,000 payment');
      expect(result.text).toContain('₱1,000');
    });

    it('THB: replaces B before number when THB detected', () => {
      const normalizer = new PDFCurrencyNormalizer({ forceCurrency: 'THB' });
      const result = normalizer.normalize('B 5,000 transfer');
      expect(result.text).toContain('฿5,000');
    });

    it('KRW: replaces W before number when KRW detected', () => {
      const normalizer = new PDFCurrencyNormalizer({ forceCurrency: 'KRW' });
      const result = normalizer.normalize('W 50,000');
      expect(result.text).toContain('₩50,000');
    });

    it('TRY: replaces TL before number when TRY detected', () => {
      const normalizer = new PDFCurrencyNormalizer({ forceCurrency: 'TRY' });
      const result = normalizer.normalize('TL 1.234,56');
      expect(result.text).toContain('₺');
    });

    it('JPY: replaces backslash before number when JPY detected', () => {
      const normalizer = new PDFCurrencyNormalizer({ forceCurrency: 'JPY' });
      const result = normalizer.normalize('\\ 10,000');
      expect(result.text).toContain('¥10,000');
    });

    it('GBP: replaces # before number when GBP detected', () => {
      const normalizer = new PDFCurrencyNormalizer({ forceCurrency: 'GBP' });
      const result = normalizer.normalize('# 2,500.00');
      expect(result.text).toContain('£2,500.00');
    });

    it('does NOT replace C before number without currency context', () => {
      const normalizer = new PDFCurrencyNormalizer({ forceCurrency: null });
      const result = normalizer.normalize('C 5000 something unrelated text');
      // Phase 2 shouldn't fire since no currency detected
      expect(result.text).toContain('C');
    });

    it('does NOT replace B in non-THB context', () => {
      const normalizer = new PDFCurrencyNormalizer({ forceCurrency: 'INR' });
      const result = normalizer.normalize('B 5000 text');
      // INR context fix only targets C, not B
      expect(result.text).toContain('B');
    });
  });

  describe('forceCurrency option', () => {
    it('bypasses auto-detection', () => {
      const normalizer = new PDFCurrencyNormalizer({ forceCurrency: 'THB' });
      const result = normalizer.normalize('C 5000 debited');
      // With THB forced, Phase 2 targets B not C
      expect(result.currency).toBe('THB');
    });

    it('is case-insensitive', () => {
      const normalizer = new PDFCurrencyNormalizer({ forceCurrency: 'inr' });
      const result = normalizer.normalize('C 5000');
      expect(result.currency).toBe('INR');
    });
  });

  describe('return values', () => {
    it('returns fixed=true when substitution made', () => {
      const normalizer = new PDFCurrencyNormalizer();
      const result = normalizer.normalize('â‚¹5,000');
      expect(result.fixed).toBe(true);
    });

    it('returns fixed=false when no substitution needed', () => {
      const normalizer = new PDFCurrencyNormalizer();
      const result = normalizer.normalize('Hello world no currency');
      expect(result.fixed).toBe(false);
    });

    it('handles non-string input gracefully', () => {
      const normalizer = new PDFCurrencyNormalizer();
      // @ts-expect-error testing invalid input
      const result = normalizer.normalize(12345);
      expect(result.text).toBe(12345);
      expect(result.fixed).toBe(false);
    });

    it('handles empty string input', () => {
      const normalizer = new PDFCurrencyNormalizer();
      const result = normalizer.normalize('');
      expect(result.text).toBe('');
      expect(result.fixed).toBe(false);
    });

    it('preserves non-currency text unchanged', () => {
      const normalizer = new PDFCurrencyNormalizer();
      const result = normalizer.normalize('Transaction dated 15-Jan-2024 for groceries');
      expect(result.text).toBe('Transaction dated 15-Jan-2024 for groceries');
    });

    it('detects currency in returned result', () => {
      const normalizer = new PDFCurrencyNormalizer({ forceCurrency: 'INR' });
      const result = normalizer.normalize('some text');
      expect(result.currency).toBe('INR');
    });
  });

  describe('adversarial / edge cases', () => {
    it('does not corrupt "AMAZON ACCESSORY STORE" when INR forced', () => {
      const normalizer = new PDFCurrencyNormalizer({ forceCurrency: 'INR' });
      const result = normalizer.normalize('AMAZON ACCESSORY STORE');
      // "C" in ACCESSORY should NOT be replaced (not followed by a number)
      expect(result.text).toBe('AMAZON ACCESSORY STORE');
    });

    it('does not replace ISO code in "EUR/USD trading"', () => {
      const normalizer = new PDFCurrencyNormalizer();
      const result = normalizer.normalize('EUR/USD trading pair');
      expect(result.text).toContain('EUR');
    });

    it('handles multiple currency corruptions in one string', () => {
      const normalizer = new PDFCurrencyNormalizer({ forceCurrency: 'INR' });
      const result = normalizer.normalize('C 5,000 and C 10,000');
      expect(result.text).toContain('₹5,000');
      expect(result.text).toContain('₹10,000');
    });

    it('lakh pattern does not match Western grouping', () => {
      const normalizer = new PDFCurrencyNormalizer();
      // 1,234 is Western grouping (3-digit), not lakh (2-digit middle group)
      const result = normalizer.normalize('C 1,234');
      // Lakh pattern requires ,\d{2})+, — 1,234 has ,\d{3} so it won't match lakh
      // But with INR context fix, C 1,234 WILL be replaced by Phase 2 INR rule
      expect(result.text).not.toContain('₹1,234'); // no INR detected so Phase 2 doesn't fire
    });

    it('handles string with only whitespace', () => {
      const normalizer = new PDFCurrencyNormalizer();
      const result = normalizer.normalize('   ');
      expect(result.fixed).toBe(false);
    });

    it('multiple safe replacements apply in one pass', () => {
      const normalizer = new PDFCurrencyNormalizer();
      const result = normalizer.normalize('â‚¹5000 and Â£100 and â‚¬200');
      expect(result.text).toContain('₹');
      expect(result.text).toContain('£');
      expect(result.text).toContain('€');
      expect(result.fixed).toBe(true);
    });

    it('logs warning when logUnknown is true and no currency detected', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const normalizer = new PDFCurrencyNormalizer({ logUnknown: true });
      normalizer.normalize('plain text with no currency indicators');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Currency undetected'),
      );
      warnSpy.mockRestore();
    });

    it('does not warn when logUnknown is false', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const normalizer = new PDFCurrencyNormalizer({ logUnknown: false });
      normalizer.normalize('plain text with no currency indicators');
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('normalizeDocument', () => {
    it('returns per-page results for a multi-page document', async () => {
      const normalizer = new PDFCurrencyNormalizer();
      const mockPage = (text: string) => ({
        getTextContent: vi.fn().mockResolvedValue({ items: [{ str: text }] }),
      });
      const pdfDoc = {
        numPages: 2,
        getPage: vi.fn()
          .mockResolvedValueOnce(mockPage('NEFT C 5,000'))
          .mockResolvedValueOnce(mockPage('another page text')),
      };

      const results = await normalizer.normalizeDocument(pdfDoc as never);
      expect(results).toHaveLength(2);
      expect(results[0].pageNumber).toBe(1);
      expect(results[1].pageNumber).toBe(2);
    });
  });
});
