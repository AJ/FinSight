import { describe, it, expect, beforeEach } from 'vitest';

import { useChatStore } from '@/lib/store/chatStore';

beforeEach(() => {
  useChatStore.getState().clearAll();
});

function makeMsg(id: string, content: string, role: 'user' | 'assistant' = 'user') {
  return { id, content, role, timestamp: new Date().toISOString() };
}

describe('chatStore', () => {
  describe('addMessage', () => {
    it('appends messages without mutating existing array', () => {
      const msg1 = makeMsg('1', 'Hello');
      useChatStore.getState().addMessage(msg1);
      const first = useChatStore.getState().messages;
      expect(first).toHaveLength(1);

      const msg2 = makeMsg('2', 'World');
      useChatStore.getState().addMessage(msg2);
      expect(useChatStore.getState().messages).toHaveLength(2);
      // Original reference should be different (immutability)
      expect(useChatStore.getState().messages).not.toBe(first);
    });

    it('preserves insertion order', () => {
      useChatStore.getState().addMessage(makeMsg('a', 'first'));
      useChatStore.getState().addMessage(makeMsg('b', 'second'));
      useChatStore.getState().addMessage(makeMsg('c', 'third'));

      const msgs = useChatStore.getState().messages;
      expect(msgs.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('updateMessage', () => {
    it('updates only the matching message', () => {
      useChatStore.getState().addMessage(makeMsg('1', 'original'));
      useChatStore.getState().addMessage(makeMsg('2', 'keep me'));
      useChatStore.getState().updateMessage('1', 'updated');

      const msgs = useChatStore.getState().messages;
      expect(msgs[0].content).toBe('updated');
      expect(msgs[1].content).toBe('keep me');
    });

    it('is a no-op when id does not exist', () => {
      useChatStore.getState().addMessage(makeMsg('1', 'unchanged'));
      useChatStore.getState().updateMessage('nonexistent', 'ignored');

      expect(useChatStore.getState().messages[0].content).toBe('unchanged');
      expect(useChatStore.getState().messages).toHaveLength(1);
    });

    it('does not change other fields on the message', () => {
      useChatStore.getState().addMessage(makeMsg('1', 'original'));
      const originalTimestamp = useChatStore.getState().messages[0].timestamp;
      useChatStore.getState().updateMessage('1', 'new content');

      expect(useChatStore.getState().messages[0].timestamp).toBe(originalTimestamp);
      expect(useChatStore.getState().messages[0].role).toBe('user');
    });
  });

  describe('setModel', () => {
    it('updates selectedModel', () => {
      useChatStore.getState().setModel('llama3');
      expect(useChatStore.getState().selectedModel).toBe('llama3');
    });

    it('can be changed multiple times', () => {
      useChatStore.getState().setModel('model-a');
      useChatStore.getState().setModel('model-b');
      expect(useChatStore.getState().selectedModel).toBe('model-b');
    });
  });

  describe('clearMessages', () => {
    it('clears messages but preserves selectedModel', () => {
      useChatStore.getState().addMessage(makeMsg('1', 'hello'));
      useChatStore.getState().setModel('llama3');
      useChatStore.getState().clearMessages();

      expect(useChatStore.getState().messages).toHaveLength(0);
      expect(useChatStore.getState().selectedModel).toBe('llama3');
    });
  });

  describe('clearAll', () => {
    it('resets both messages and selectedModel', () => {
      useChatStore.getState().addMessage(makeMsg('1', 'hello'));
      useChatStore.getState().setModel('llama3');
      useChatStore.getState().clearAll();

      expect(useChatStore.getState().messages).toHaveLength(0);
      expect(useChatStore.getState().selectedModel).toBeNull();
    });
  });
});
