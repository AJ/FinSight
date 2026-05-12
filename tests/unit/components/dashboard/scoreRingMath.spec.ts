import { describe, it, expect } from 'vitest';
import {
  computeRingGeometry,
  getScoreColorClass,
  getScoreLabelColorClass,
} from '@/components/dashboard/scoreRingMath';

describe('computeRingGeometry', () => {
  it('computes geometry for default values', () => {
    const result = computeRingGeometry(110, 8, 75, 100);

    expect(result.radius).toBe(51);
    expect(result.circumference).toBeCloseTo(2 * Math.PI * 51);
    expect(result.progress).toBeCloseTo(0.75 * result.circumference);
    expect(result.offset).toBeCloseTo(result.circumference - result.progress);
  });

  it('computes zero progress for score 0', () => {
    const result = computeRingGeometry(110, 8, 0, 100);

    expect(result.progress).toBe(0);
    expect(result.offset).toBe(result.circumference);
  });

  it('computes full progress for max score', () => {
    const result = computeRingGeometry(110, 8, 100, 100);

    expect(result.progress).toBeCloseTo(result.circumference);
    expect(result.offset).toBeCloseTo(0);
  });

  it('handles custom maxScore', () => {
    const result = computeRingGeometry(110, 8, 5, 10);

    expect(result.progress).toBeCloseTo(0.5 * result.circumference);
  });

  it('uses default maxScore of 100', () => {
    const explicit = computeRingGeometry(110, 8, 50, 100);
    const implicit = computeRingGeometry(110, 8, 50);

    expect(implicit.progress).toBeCloseTo(explicit.progress);
  });
});

describe('getScoreColorClass', () => {
  it('returns stroke-success for score >= 70', () => {
    expect(getScoreColorClass(70)).toBe('stroke-success');
    expect(getScoreColorClass(100)).toBe('stroke-success');
  });

  it('returns stroke-warning for score >= 40', () => {
    expect(getScoreColorClass(40)).toBe('stroke-warning');
    expect(getScoreColorClass(69)).toBe('stroke-warning');
  });

  it('returns stroke-destructive for score < 40', () => {
    expect(getScoreColorClass(39)).toBe('stroke-destructive');
    expect(getScoreColorClass(0)).toBe('stroke-destructive');
  });
});

describe('getScoreLabelColorClass', () => {
  it('returns text-success for score >= 70', () => {
    expect(getScoreLabelColorClass(70)).toBe('text-success');
  });

  it('returns text-warning for score >= 40', () => {
    expect(getScoreLabelColorClass(50)).toBe('text-warning');
  });

  it('returns text-destructive for score < 40', () => {
    expect(getScoreLabelColorClass(30)).toBe('text-destructive');
  });
});
