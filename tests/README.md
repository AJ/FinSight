# FinSight Test Suite

## Setup Instructions

### 1. Install Dependencies
```bash
npm install --save-dev @playwright/test
npx playwright install chromium firefox
```

### 2. Run Tests
```bash
# Run all tests
npm run test:all

# Run specific layers
npm run test:unit        # Unit tests (JSON parsing, merge logic)
npm run test:integration # Integration tests (pipeline, retry engine)
npm run test:e2e         # E2E browser tests (upload flow, storage resilience)

# Run with UI
npm run test:ui
```

### 3. Enable Mocks
Mocks are enabled by default in E2E tests via `tests/mocks/llmMocker.ts`.
No local LLM server is required for test execution.

---

## Test Data Strategy

### Realistic Statements
- `tests/fixtures/bank_statement_valid.csv` - Standard HDFC/ICICI bank format
- `tests/fixtures/cc_statement_valid.csv` - Credit card with rewards points

### Synthetic Edge Cases
- `tests/fixtures/bank_clean.csv` - Clean bank statement for pipeline tests
- `tests/fixtures/bank_noisy.csv` - Bank statement with messy/ambiguous data
- `tests/fixtures/bank_broken.csv` - Intentionally broken bank statement
- `tests/fixtures/cc_clean.csv` - Clean credit card statement
- `tests/fixtures/cc_rewards_misclassified.csv` - Rewards that may be misclassified as transactions

### LLM Mock Fixtures (JSON)
- `tests/fixtures/llm_valid_transactions.json` - Valid transaction array response
- `tests/fixtures/llm_valid_bank_summary.json` - Valid CC summary response
- `tests/fixtures/llm_valid_rewards.json` - Valid rewards response
- `tests/fixtures/llm_valid_cc_summary.json` - Valid CC summary response
- `tests/fixtures/llm_wrong_summary_schema.json` - Valid JSON but wrong types
- `tests/fixtures/llm_wrong_categorization.json` - Incorrect categorization response
- `tests/fixtures/llm_malformed.json` - Malformed JSON (trailing commas, missing quotes)
- `tests/fixtures/llm_partial.json` - Partial/cut-off output

### Edge Case Coverage
- Negative amounts in debit columns
- Dual currency columns (Original + Local)
- Missing description fields
- Overlapping transactions across chunks
- Zero-amount refunds and cashback
- Rewards points mistakenly classified as transactions

---

## Architecture

```
tests/
├── unit/                              # Critical failure hotspots
│   └── parseLLMJsonResponse.spec.ts   # JSON parsing: markdown stripping, broken JSON
│
├── integration/                       # Pipeline & retry logic
│   ├── helpers/
│   │   └── pipelineHelpers.ts         # Fixture loading, schema validation, silent-failure detection
│   └── retryEngine.spec.ts            # Retry logic under partial LLM failures
│
├── e2e/                               # Full browser flows
│   ├── helpers/
│   │   └── e2eHelpers.ts              # Test context setup, file upload, dialog closing, UI verification
│   ├── uploadPipeline.spec.ts         # Bank statement upload + LLM response handling
│   ├── uploadFullPipeline.spec.ts     # End-to-end: bank & CC upload with schema validation
│   ├── creditCardLogic.spec.ts        # Credit card rewards, refunds, zero-amount handling
│   ├── rulesEngine.spec.ts            # Rule-based categorization overrides & persistence
│   ├── llmFailureScenarios.spec.ts    # Timeout, malformed, empty, and partial LLM responses
│   └── dataIntegrity.spec.ts          # UI/storage consistency, duplicate upload prevention
│
├── fixtures/                          # Realistic & synthetic test data
│   ├── bank_*.csv                     # Bank statement variants (clean, noisy, broken)
│   ├── cc_*.csv                       # Credit card statement variants
│   └── llm_*.json                     # Pre-baked LLM response fixtures
│
├── mocks/                             # LLM route interception
│   └── llmMocker.ts                   # Intercepts Ollama/LM Studio endpoints with scenario responses
│
└── utils/                             # Shared test utilities
    └── storageHelpers.ts              # localStorage read/write, transaction validation
```

---

## LLM Mocking Layer

Located in `tests/mocks/llmMocker.ts`. Intercepts `http://localhost:11434/**` (Ollama) and `http://localhost:1234/**` (LM Studio) requests.

**Supported Scenarios:**
| Scenario | Description |
|---|---|
| `valid_summary` | Correct CC summary schema |
| `valid_transactions` | Correct transaction array |
| `malformed_json` | Trailing commas, missing quotes |
| `wrong_schema` | Valid JSON but wrong types (amount as string) |
| `partial_output` | Cut off mid-stream |
| `empty_response` | Empty transaction array |
| `timeout` | Network timeout simulation |

**Usage:**
```typescript
import { mockLLMResponse } from '@tests/mocks/llmMocker';

test('should handle malformed JSON', async ({ page }) => {
  const mocker = await mockLLMResponse(page, 'malformed_json');
  // ... trigger upload ...

  // Optionally inspect captured prompts
  const prompts = mocker.getCapturedPrompts();
});
```

---

## Test Helpers

### E2E Helpers (`tests/e2e/helpers/e2eHelpers.ts`)
- `setupTestContext()` — Bypasses onboarding wizard, pre-configures LM Studio settings
- `uploadFile()` — Handles file picker, dialog submission, and cleanup
- `waitForUploadCompletion()` — Waits for navigation to `/review`
- `mockCategorizationAPI()` — Mocks server-side categorization endpoint
- `verifyUIMatchesStorage()` — Compares rendered rows vs localStorage

### Pipeline Helpers (`tests/integration/helpers/pipelineHelpers.ts`)
- `loadFixture()` / `loadJsonFixture<T>()` — Load test data files
- `validateTransactionSchema()` — Validate individual transaction objects
- `validateSummarySchema()` — Validate statement summary objects (bank vs credit card)
- `detectSilentFailures()` — Detect data dropped without warnings

### Storage Utilities (`tests/utils/storageHelpers.ts`)
- `getLocalStorage()` / `setLocalStorage()` — Page-level storage access
- `getTransactionsFromStorage()` — Read parsed transactions from localStorage
- `validateTransactionShape()` — Runtime transaction validation for tests
- `clearAllStorage()` — Wipe cookies, localStorage, and sessionStorage

---

## Known Issues

- `tests/unit/verification/mergeEngine.spec.ts` re-tests
  `validateCCCrossSection`/`validateBankCrossSection` from
  `verificationEngine` instead of testing merge-specific logic.
- Zustand store tests (`transactionStore`, `budgetStore`, `settingsStore`)
  share state via persist middleware writing to jsdom `localStorage`.
  Assertions use `toBeGreaterThanOrEqual` instead of exact counts.
  Each test should reset the store before running.
- `tests/unit/parserNeutralizationBoundary.spec.ts` uses Playwright
  imports but is excluded from vitest config. Verify it runs under
  Playwright or move it to `tests/integration/`.
- E2E tests upload CSV files with LLM mocks set up, but CSV parsing
  bypasses the LLM entirely. The mocks are never exercised.
- Several source modules lack unit coverage: `csvParser`, `xlsParser`,
  `transactionChunking`, `typeDetection`, `pipeline.ts`,
  `columnDetection`, `merchantRuleService`, `postImportJobService`,
  `llmClient`.
