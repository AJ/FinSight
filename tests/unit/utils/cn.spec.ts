import { describe, it, expect } from 'vitest';

import { cn } from '@/lib/utils';

describe('cn', () => {
  it('merges conflicting tailwind classes (last wins)', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2');
  });

  it('keeps non-conflicting classes', () => {
    expect(cn('p-4', 'text-red-500')).toBe('p-4 text-red-500');
  });

  it('handles conditional classes via clsx', () => {
    expect(cn('base', false && 'hidden', 'visible')).toBe('base visible');
  });

  it('handles undefined and null inputs', () => {
    expect(cn('base', undefined, null, 'extra')).toBe('base extra');
  });

  it('handles empty input', () => {
    expect(cn()).toBe('');
  });

  it('merges responsive variants correctly', () => {
    expect(cn('text-sm md:text-base', 'md:text-lg')).toBe('text-sm md:text-lg');
  });

  it('deduplicates identical classes', () => {
    expect(cn('p-4', 'p-4')).toBe('p-4');
  });
});
