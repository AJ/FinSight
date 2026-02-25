import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Insight } from '@/lib/insights/types';

interface InsightsStore {
  insights: Insight[];
  isGenerating: boolean;
  generatedAt: Date | null;
  error: string | null;

  setGenerating: (value: boolean) => void;
  setInsights: (insights: Insight[]) => void;
  setError: (error: string | null) => void;
  clear: () => void;
}

export const useInsightsStore = create<InsightsStore>()(
  persist(
    (set) => ({
      insights: [],
      isGenerating: false,
      generatedAt: null,
      error: null,

      setGenerating: (value) => set({ isGenerating: value, error: null }),

      setInsights: (insights) =>
        set({
          insights,
          isGenerating: false,
          generatedAt: new Date(),
          error: null,
        }),

      setError: (error) =>
        set({
          error,
          isGenerating: false,
        }),

      clear: () =>
        set({
          insights: [],
          isGenerating: false,
          generatedAt: null,
          error: null,
        }),
    }),
    {
      name: 'insights-storage',
      storage: createJSONStorage(() => sessionStorage),
    }
  )
);
