import { describe, it, expect } from 'vitest';
import { computeFileHash } from '@/lib/utils/fileHash';

describe('computeFileHash', () => {
  it('computes SHA-256 hex hash from File', async () => {
    const content = 'test content for hashing';
    const file = new File([content], 'test.pdf', { type: 'application/pdf' });
    const hash = await computeFileHash(file);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces same hash for same content', async () => {
    const content = 'identical content';
    const file1 = new File([content], 'file1.pdf');
    const file2 = new File([content], 'file2.pdf');
    const hash1 = await computeFileHash(file1);
    const hash2 = await computeFileHash(file2);
    expect(hash1).toBe(hash2);
  });

  it('produces different hash for different content', async () => {
    const file1 = new File(['content A'], 'file1.pdf');
    const file2 = new File(['content B'], 'file2.pdf');
    const hash1 = await computeFileHash(file1);
    const hash2 = await computeFileHash(file2);
    expect(hash1).not.toBe(hash2);
  });
});
