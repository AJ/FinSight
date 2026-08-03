import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClient } from '@/lib/llm/client';

/**
 * Gap-filler for chat streaming coverage.
 *
 * The live e2e (chatStreamProgressiveLive.spec.ts) verifies Layer 1 — the real LLM streams
 * multiple chunks over the wire. The retired DOM-sampling e2e tried to verify Layer 4 (the
 * screen paints progressively) but was racy. This test covers Layer 3 — the app's OWN stream
 * processing — deterministically: given a stream that emits chunks one at a time, chatStream
 * must yield each chunk separately (not buffer/coalesce them into one). Combined with the
 * Layer-1 e2e and ChatPanel's per-chunk append (for-await → updateMessage), this proves
 * progressive rendering end-to-end without racy screen sampling.
 */
// Build a mocked SSE Response that emits the given content deltas one per chunk (with a small
// delay between each, mimicking real token streaming), then the [DONE] sentinel.
function mockSSEStream(deltas: string[], delayMs = 15): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const delta of deltas) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`),
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('client.chatStream — progressive (per-chunk) yielding', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('yields each streamed chunk separately, not buffered into one', async () => {
    const deltas = ['Hello', ' world', '!'];
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(mockSSEStream(deltas)) as unknown as typeof globalThis.fetch;

    const client = createClient('lmstudio');
    const collected: string[] = [];
    const timestamps: number[] = [];
    for await (const chunk of client.chatStream('http://x', 'm', [{ role: 'user', content: 'hi' }], {
      temperature: 0,
      responseFormat: 'text',
      signal: new AbortController().signal,
    })) {
      if (chunk.delta) {
        collected.push(chunk.delta);
        timestamps.push(Date.now());
      }
    }

    // Per-chunk yielding: each stream delta surfaces as its own chunk (no coalescing/buffering).
    expect(collected).toEqual(deltas);
    // Progressive timing: chunks arrived spread over time, not all in one tick. The mock emits
    // them ~delayMs apart; a buffering bug would yield them all at the end (~0 spread).
    expect(timestamps).toHaveLength(deltas.length);
    expect(timestamps[timestamps.length - 1] - timestamps[0], 'chunks should not all arrive in the same tick').toBeGreaterThan(0);
  });
});
