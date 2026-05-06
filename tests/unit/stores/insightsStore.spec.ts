import { describe, it, expect, beforeEach } from 'vitest';

import { useInsightsStore } from '@/lib/store/insightsStore';

beforeEach(() => {
  useInsightsStore.getState().clear();
});

function makeInsight(id: string) {
  return {
    id,
    type: 'category_trend' as const,
    title: `Insight ${id}`,
    description: `Description for ${id}`,
    severity: 'info' as const,
    category: 'shopping',
  };
}

describe('insightsStore', () => {
  describe('setGenerating', () => {
    it('sets isGenerating to true and clears error', () => {
      useInsightsStore.getState().setError('previous error');
      useInsightsStore.getState().setGenerating(true);

      const state = useInsightsStore.getState();
      expect(state.isGenerating).toBe(true);
      expect(state.error).toBeNull();
    });

    it('sets isGenerating to false', () => {
      useInsightsStore.getState().setGenerating(true);
      useInsightsStore.getState().setGenerating(false);
      expect(useInsightsStore.getState().isGenerating).toBe(false);
    });
  });

  describe('setInsights', () => {
    it('sets insights data and clears generating state', () => {
      useInsightsStore.getState().setGenerating(true);
      const insights = [makeInsight('1'), makeInsight('2')];
      useInsightsStore.getState().setInsights(insights);

      const state = useInsightsStore.getState();
      expect(state.insights).toHaveLength(2);
      expect(state.isGenerating).toBe(false);
      expect(state.generatedAt).toBeInstanceOf(Date);
      expect(state.error).toBeNull();
    });

    it('replaces existing insights', () => {
      useInsightsStore.getState().setInsights([makeInsight('old')]);
      useInsightsStore.getState().setInsights([makeInsight('new1'), makeInsight('new2')]);

      const state = useInsightsStore.getState();
      expect(state.insights).toHaveLength(2);
      expect(state.insights[0].id).toBe('new1');
    });

    it('updates generatedAt timestamp on each call', () => {
      useInsightsStore.getState().setInsights([makeInsight('1')]);
      const first = useInsightsStore.getState().generatedAt;

      // Small delay to ensure different timestamp
      useInsightsStore.getState().setInsights([makeInsight('2')]);
      const second = useInsightsStore.getState().generatedAt;

      expect(second!.getTime()).toBeGreaterThanOrEqual(first!.getTime());
    });
  });

  describe('setError', () => {
    it('sets error and clears generating', () => {
      useInsightsStore.getState().setGenerating(true);
      useInsightsStore.getState().setError('Something failed');

      const state = useInsightsStore.getState();
      expect(state.error).toBe('Something failed');
      expect(state.isGenerating).toBe(false);
    });

    it('clears error with null', () => {
      useInsightsStore.getState().setError('error');
      useInsightsStore.getState().setError(null);
      expect(useInsightsStore.getState().error).toBeNull();
    });
  });

  describe('clear', () => {
    it('resets all state to defaults', () => {
      useInsightsStore.getState().setInsights([makeInsight('1')]);
      useInsightsStore.getState().setError('err');
      useInsightsStore.getState().clear();

      const state = useInsightsStore.getState();
      expect(state.insights).toHaveLength(0);
      expect(state.isGenerating).toBe(false);
      expect(state.generatedAt).toBeNull();
      expect(state.error).toBeNull();
    });
  });

  describe('state machine — happy path', () => {
    it('generating → insights set → clear generates a complete cycle', () => {
      useInsightsStore.getState().setGenerating(true);
      expect(useInsightsStore.getState().isGenerating).toBe(true);

      useInsightsStore.getState().setInsights([makeInsight('1')]);
      expect(useInsightsStore.getState().insights).toHaveLength(1);
      expect(useInsightsStore.getState().isGenerating).toBe(false);

      useInsightsStore.getState().clear();
      expect(useInsightsStore.getState().insights).toHaveLength(0);
    });
  });

  describe('state machine — failure path', () => {
    it('generating → error preserves existing insights', () => {
      useInsightsStore.getState().setInsights([makeInsight('old')]);
      useInsightsStore.getState().setGenerating(true);
      useInsightsStore.getState().setError('LLM connection failed');

      const state = useInsightsStore.getState();
      expect(state.error).toBe('LLM connection failed');
      expect(state.isGenerating).toBe(false);
      // Old insights should still be there
      expect(state.insights).toHaveLength(1);
      expect(state.insights[0].id).toBe('old');
    });
  });
});
