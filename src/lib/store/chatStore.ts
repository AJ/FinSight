import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { ChatMessage } from '@/types';

interface ChatStore {
  messages: ChatMessage[];
  statementContext: string | null;
  selectedModel: string | null;

  setContext: (context: string) => void;
  addMessage: (msg: ChatMessage) => void;
  updateMessage: (id: string, content: string) => void;
  setModel: (model: string) => void;
  clearMessages: () => void;
  clearAll: () => void;
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set) => ({
      messages: [],
      statementContext: null,
      selectedModel: null,

      setContext: (context) => set({ statementContext: context }),

      addMessage: (msg) =>
        set((state) => ({ messages: [...state.messages, msg] })),

      updateMessage: (id, content) =>
        set((state) => ({
          messages: state.messages.map((m) =>
            m.id === id ? { ...m, content } : m
          ),
        })),

      setModel: (model) => set({ selectedModel: model }),

      clearMessages: () => set({ messages: [] }),

      clearAll: () =>
        set({ messages: [], statementContext: null, selectedModel: null }),
    }),
    {
      name: 'chat-storage',
      storage: createJSONStorage(() => sessionStorage),
    }
  )
);
