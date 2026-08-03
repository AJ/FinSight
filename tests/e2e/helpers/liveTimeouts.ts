/**
 * Shared timeout policy for live-LLM tests (tests/e2e/*Live.spec.ts).
 *
 * Live-LLM tests are subject to model speed, cold-start, and suite-wide load variance,
 * so timeouts must be generous AND consistent. Centralizing them here gives one place to
 * tune when the model or suite changes — instead of the ad-hoc per-file values that drifted
 * (30s/120s/300s/330s/360s/600s test budgets; 240s/300s/540s pipeline waits).
 *
 * Usage:
 *   - test.setTimeout(LLM_TEST_TIMEOUT) for any test that drives the LLM.
 *   - waitForUploadOrFailure(page, BANK_PIPELINE_TIMEOUT | CC_PIPELINE_TIMEOUT) for the
 *     upload → review extraction wait (CC does 3 LLM passes, so it gets longer).
 *
 * Sub-tests that do NOT hit the LLM (e.g. "without transactions" empty-state checks) keep
 * their own short budgets — they don't need the model's headroom.
 */
export const LLM_TEST_TIMEOUT = 600_000; // 10 min — whole-test budget for any live-LLM test
export const BANK_PIPELINE_TIMEOUT = 300_000; // 5 min — upload → review for a bank statement
export const CC_PIPELINE_TIMEOUT = 540_000; // 9 min — upload → review for a CC statement (3 passes)
