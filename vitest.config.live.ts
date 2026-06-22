import { defineConfig } from 'vitest/config';
import path from 'path';

// Live-LLM test config. Separate from the unit config (which excludes tests/live/**) so
// these tests never run in CI / `npm run test:unit` — they need a real local LLM and are
// gated on LIVE_LLM_URL via tests/live/helpers.ts. Run with:
//   LIVE_LLM_URL=http://localhost:1234 LIVE_LLM_MODEL=<model> npm run test:live
// Node environment (no DOM): these tests exercise fs, fetch, and the real adapter wire path.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/live/**/*.spec.{ts,tsx}'],
    passWithNoTests: true,
    // Real-LLM tests are slow: a single full transaction extraction can take 5-10 min on a
    // small local model. 10 min is the sane default; tests that do multiple sequential
    // extractions override this with a larger explicit timeout.
    testTimeout: 600_000,
    // Run serially. A single local LLM cannot serve multiple test files concurrently without
    // KV-cache exhaustion and connection saturation (observed: fetch failures, 10x latency).
    // Within-file tests are already sequential by default; this also serializes across files.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tests': path.resolve(__dirname, './tests'),
    },
  },
});
