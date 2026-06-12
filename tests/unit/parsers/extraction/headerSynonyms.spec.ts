import { describe, it, expect } from 'vitest';
import { matchConcept, countDistinctConcepts, HEADER_CONCEPTS } from '@/lib/parsers/extraction/headerSynonyms';

describe('matchConcept', () => {
  it('matches exact synonyms', () => {
    expect(matchConcept('Date')).toBe('date');
    expect(matchConcept('Narration')).toBe('description');
    expect(matchConcept('Withdrawal')).toBe('debit');
    expect(matchConcept('Cr')).toBe('credit');
  });

  it('matches case-insensitively', () => {
    expect(matchConcept('DATE')).toBe('date');
    expect(matchConcept('description')).toBe('description');
    expect(matchConcept('WITHDRAWAL')).toBe('debit');
  });

  it('matches prefixes like "Withdrawal (Dr.)"', () => {
    expect(matchConcept('Withdrawal (Dr.)')).toBe('debit');
    expect(matchConcept('Deposit (Cr.)')).toBe('credit');
  });

  it('matches "Txn Date"', () => {
    expect(matchConcept('Txn Date')).toBe('date');
    expect(matchConcept('Value Date')).toBe('date');
    expect(matchConcept('Posting Date')).toBe('date');
  });

  it('returns null for non-matching text', () => {
    expect(matchConcept('Amazon Purchase')).toBeNull();
    expect(matchConcept('01-Jan-2026')).toBeNull();
    expect(matchConcept('5,000.00')).toBeNull();
  });
});

describe('countDistinctConcepts', () => {
  it('counts distinct concepts across header items', () => {
    const result = countDistinctConcepts(['Date', 'Description', 'Withdrawal', 'Deposit', 'Balance']);
    expect(result.count).toBe(5);
    expect(result.concepts.get(0)).toBe('date');
    expect(result.concepts.get(1)).toBe('description');
    expect(result.concepts.get(2)).toBe('debit');
    expect(result.concepts.get(3)).toBe('credit');
    expect(result.concepts.get(4)).toBe('balance');
  });

  it('does not double-count same concept from two synonyms', () => {
    const result = countDistinctConcepts(['Date', 'Txn Date', 'Description']);
    expect(result.count).toBe(2);
  });

  it('returns 0 for non-header text', () => {
    const result = countDistinctConcepts(['Amazon', '5,000.00', '01-Jan']);
    expect(result.count).toBe(0);
  });
});

describe('HEADER_CONCEPTS', () => {
  it('has all expected concept names', () => {
    const names = HEADER_CONCEPTS.map(c => c.name);
    expect(names).toContain('date');
    expect(names).toContain('description');
    expect(names).toContain('debit');
    expect(names).toContain('credit');
    expect(names).toContain('amount');
    expect(names).toContain('balance');
    expect(names).toContain('reference');
  });
});
