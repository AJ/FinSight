import { describe, it, expect, vi } from 'vitest';
import { AbortManager } from '@/lib/utils/AbortManager';

/**
 * Tests for the AbortManager signal-wiring pattern used by ChatPanel.
 *
 * ChatPanel does:
 *   const streamSignal = activeStreamControllerRef.current.signal();
 *   client.chatStream(url, model, msgs, { signal: streamSignal, ... });
 *
 * And for stop:
 *   activeStreamControllerRef.current.abortAll('User clicked stop');
 *
 * The previous bug was that signal() was called without capturing the return
 * value, and a separate AbortController.signal was passed to chatStream instead.
 * These tests verify the contract that signal() returns an AbortSignal that
 * abortAll() actually aborts.
 */
describe('AbortManager signal-wiring pattern (ChatPanel contract)', () => {
  it('signal returned by signal() is aborted by abortAll()', () => {
    const manager = new AbortManager();
    const capturedSignal = manager.signal();

    expect(capturedSignal.aborted).toBe(false);

    manager.abortAll('User clicked stop');

    expect(capturedSignal.aborted).toBe(true);
  });

  it('signal passed to a mock function is aborted by abortAll()', async () => {
    const manager = new AbortManager();
    const mockChatStream = vi.fn().mockResolvedValue(undefined);

    // Simulate the ChatPanel pattern
    const streamSignal = manager.signal();
    mockChatStream({ signal: streamSignal });

    // Verify the mock received the signal
    const receivedSignal = mockChatStream.mock.calls[0][0].signal;
    expect(receivedSignal).toBe(streamSignal);
    expect(receivedSignal.aborted).toBe(false);

    // Simulate stop button
    manager.abortAll('User clicked stop');

    // The signal passed to chatStream is now aborted
    expect(receivedSignal.aborted).toBe(true);
  });

  it('only the AbortManager signal is aborted, not an unrelated AbortController', () => {
    const manager = new AbortManager();
    const unrelated = new AbortController();

    // This was the bug: creating a separate controller
    const correctSignal = manager.signal();

    manager.abortAll();

    expect(correctSignal.aborted).toBe(true);
    expect(unrelated.signal.aborted).toBe(false);
  });

  it('signal can be used as AbortSignal for fetch-like APIs', () => {
    const manager = new AbortManager();
    const signal = manager.signal();

    // AbortSignal is the correct type
    expect(signal).toBeInstanceOf(AbortSignal);

    // Can be used with RequestInit
    const init: RequestInit = { signal };
    expect(init.signal).toBe(signal);
  });

  it('multiple streams from same manager all abort together', () => {
    const manager = new AbortManager();
    const signal1 = manager.signal();
    const signal2 = manager.signal();

    manager.abortAll('stop');

    expect(signal1.aborted).toBe(true);
    expect(signal2.aborted).toBe(true);
  });

  it('signal from previous session is not affected by new abortAll', () => {
    const manager = new AbortManager();

    // First stream session
    const oldSignal = manager.signal();
    manager.abortAll('stream ended');
    expect(oldSignal.aborted).toBe(true);

    // Second stream session
    const newSignal = manager.signal();
    expect(newSignal.aborted).toBe(false);
    expect(newSignal).not.toBe(oldSignal);
  });
});
