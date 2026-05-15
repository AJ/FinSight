import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.spec.ts'],
    exclude: ['node_modules/**'],
    testTimeout: 120_000, // LLM calls can be slow
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '..', '..', 'src'),
      '@tests': path.resolve(__dirname, '..', '..'),
    },
  },
});
