import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright Configuration for FinSight
 * 
 * Supports:
 * - Unit/Integration via local Next.js dev server
 * - E2E browser tests with Chromium & Firefox
 * - Route mocking for LLM endpoints
 */
export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/unit/**', '**/parserNeutralizationBoundary.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : 3,
  reporter: 'html',
  
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3001',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npx next dev --port 3001',
    url: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3001',
    reuseExistingServer: true,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120000,
  },
});