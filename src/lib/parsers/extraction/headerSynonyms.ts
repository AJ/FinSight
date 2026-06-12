export interface HeaderConcept {
  name: string;
  synonyms: string[];
}

export const HEADER_CONCEPTS: HeaderConcept[] = [
  { name: 'date', synonyms: ['date', 'txn date', 'transaction date', 'posting date', 'value date'] },
  { name: 'description', synonyms: ['description', 'narration', 'particulars', 'details'] },
  { name: 'debit', synonyms: ['debit', 'withdrawal', 'dr'] },
  { name: 'credit', synonyms: ['credit', 'deposit', 'cr'] },
  { name: 'amount', synonyms: ['amount'] },
  { name: 'balance', synonyms: ['balance'] },
  { name: 'reference', synonyms: ['ref', 'chq', 'cheque'] },
];

/**
 * For a given text item, determine which header concept it matches (if any).
 * Returns the concept name or null.
 */
export function matchConcept(text: string): string | null {
  const lower = text.toLowerCase().trim();
  for (const concept of HEADER_CONCEPTS) {
    if (concept.synonyms.some(s => lower === s || lower.startsWith(s))) {
      return concept.name;
    }
  }
  return null;
}

/** Check whether a matched concept name indicates a date column. */
export function isDateConcept(conceptName: string): boolean {
  return conceptName === 'date';
}

/** Count how many distinct header concepts a line's items match. */
export function countDistinctConcepts(itemTexts: string[]): { count: number; concepts: Map<number, string> } {
  const concepts = new Map<number, string>();
  const seen = new Set<string>();
  for (let i = 0; i < itemTexts.length; i++) {
    const concept = matchConcept(itemTexts[i]);
    if (concept && !seen.has(concept)) {
      seen.add(concept);
      concepts.set(i, concept);
    }
  }
  return { count: seen.size, concepts };
}
