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
npm run test:unit              # Unit tests (Vitest, jsdom)
npm run test:unit:watch        # Unit tests in watch mode
npm run test:unit:coverage     # Unit tests with v8 coverage
npm run test:integration       # Integration tests (Playwright)
npm run test:e2e               # E2E browser tests — mocked + live (auto-skip)
npm run test:ui                # Playwright interactive UI

# Run single test files
npx vitest run tests/unit/parsers/dateParser.spec.ts
npx playwright test tests/e2e/uploadPipeline.spec.ts
npx playwright test tests/e2e/balanceReconciliationLive.spec.ts --timeout=600000
```

### 3. Enable Mocks
Mocks are enabled by default in E2E tests via `tests/mocks/llmMocker.ts`.
No local LLM server is required for standard E2E test execution.

---

## Live-LLM E2E Tests

Real LLM tests that exercise the full pipeline without mocks. Auto-skip when `LIVE_LLM_URL` is unset.

### Quick Start
```bash
# All live tests (requires LM Studio running)
LIVE_LLM_URL=http://localhost:1234 npx playwright test tests/e2e/*Live.spec.ts --timeout=600000

# Individual live tests (fastest to slowest)

## Chat Streaming — verifies progressive token delivery and no-transaction guard
LIVE_LLM_URL=http://localhost:1234 npx playwright test tests/e2e/chatWithDataLive.spec.ts --timeout=120000

## Insights Generation — validates structure, types, severities, and references to real data
LIVE_LLM_URL=http://localhost:1234 npx playwright test tests/e2e/insightsLive.spec.ts --timeout=120000

## File Upload Lifecycle — full upload→review→edit→confirm→save→re-upload→rule-learned cycle + invalid file rejection
LIVE_LLM_URL=http://localhost:1234 npx playwright test tests/e2e/fileUploadLifecycleLive.spec.ts --timeout=600000

## Transactions Lifecycle — AI categorization produces valid categories/sources, edits persist after reload
LIVE_LLM_URL=http://localhost:1234 npx playwright test tests/e2e/transactionsLifecycleLive.spec.ts --timeout=360000

## Rules Engine — learned merchant rules override AI categorization on re-upload, multi-edit preservation
LIVE_LLM_URL=http://localhost:1234 npx playwright test tests/e2e/rulesEngineLive.spec.ts --timeout=600000

## Credit Card Pipeline — CC 3-pass extraction with valid dates, amounts, categories, and summary fields
LIVE_LLM_URL=http://localhost:1234 npx playwright test tests/e2e/creditCardLogicLive.spec.ts --timeout=600000

## PDF Password — encrypted PDF extraction, wrong password error, retry with correct password
LIVE_LLM_URL=http://localhost:1234 npx playwright test tests/e2e/pdfPasswordLive.spec.ts --timeout=600000

## Balance Reconciliation — bank + CC verification reports, reconciliation must pass (known failure)
LIVE_LLM_URL=http://localhost:1234 npx playwright test tests/e2e/balanceReconciliationLive.spec.ts --timeout=600000

# PowerShell (Windows)
$env:LIVE_LLM_URL="http://localhost:1234"; npx playwright test tests/e2e/*Live.spec.ts --timeout=600000

# With CC tests (requires cc_statement.pdf fixture)
LIVE_LLM_URL=http://localhost:1234 CC_PDF_PASSWORD=yourpassword npx playwright test tests/e2e/*Live.spec.ts --timeout=600000
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LIVE_LLM_URL` | Yes | LM Studio/Ollama base URL. All tests skip if unset. |
| `LIVE_LLM_MODEL` | No | Model name (default: `qwen/qwen3-4b-2507`) |
| `CC_PDF_PASSWORD` | No | Password for `tests/fixtures/cc_statement.pdf` |

### Live Test Files

| File | What it tests | Timeout | Negative cases |
|------|---------------|---------|----------------|
| `chatWithDataLive.spec.ts` | Chat streaming, progressive tokens, suggestion chips | 2 min | No-txn disabled state |
| `insightsLive.spec.ts` | Insights generation, structure validation, references real data | 2 min | No-txn disabled state |
| `fileUploadLifecycleLive.spec.ts` | Full lifecycle: upload→review→edit→save→re-upload→rule applied | 10 min | Invalid file upload error |
| `transactionsLifecycleLive.spec.ts` | AI categorization, valid category IDs/sources, edit persistence | 6 min | Adversarial category validation |
| `rulesEngineLive.spec.ts` | Learned rules override AI, multi-edit preservation | 10 min | Category must match edit |
| `creditCardLogicLive.spec.ts` | CC 3-pass pipeline, valid data, summary fields | 10 min | Date/amount/category validation |
| `pdfPasswordLive.spec.ts` | Encrypted PDF, wrong password error, retry flow | 10 min | Wrong password → error → retry |
| `balanceReconciliationLive.spec.ts` | Balance reconciliation, verification report | 15 min | Reconciliation must pass (known failure) |

All live tests run serially within each file to avoid LM Studio KV cache exhaustion.

### Known Failures

- `balanceReconciliationLive` — asserts `reconciliation.passed === true`. LLM extraction accuracy is not yet sufficient for reconciliation to pass. This is intentional — the test exposes the gap rather than hiding it.

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
│   │   ├── e2eHelpers.ts              # Test context setup, file upload, dialog closing, UI verification
│   │   └── liveTestHelpers.ts         # Live-LLM helpers: skip check, seed settings, console capture, store readers
│   ├── uploadPipeline.spec.ts         # Bank statement upload + LLM response handling
│   ├── uploadFullPipeline.spec.ts     # End-to-end: bank & CC upload with schema validation
│   ├── creditCardLogic.spec.ts        # Credit card rewards, refunds, zero-amount handling
│   ├── rulesEngine.spec.ts            # Rule-based categorization overrides & persistence
│   ├── llmFailureScenarios.spec.ts    # Timeout, malformed, empty, and partial LLM responses
│   ├── dataIntegrity.spec.ts          # UI/storage consistency, duplicate upload prevention
│   ├── chatWithDataLive.spec.ts       # [Live] Chat streaming with real LLM
│   ├── insightsLive.spec.ts           # [Live] Financial insights with structure validation
│   ├── fileUploadLifecycleLive.spec.ts # [Live] Full upload→save→re-upload lifecycle
│   ├── transactionsLifecycleLive.spec.ts # [Live] AI categorization + edit persistence
│   ├── rulesEngineLive.spec.ts        # [Live] Learned rules override AI categorization
│   ├── creditCardLogicLive.spec.ts    # [Live] CC 3-pass pipeline with valid data checks
│   ├── pdfPasswordLive.spec.ts        # [Live] Encrypted PDF extraction + wrong password
│   └── balanceReconciliationLive.spec.ts # [Live] Balance reconciliation with real LLM
│
├── live/                              # Token budget instrumentation tests
│   └── tokenBudget.spec.ts            # Measures actual token usage vs estimates
│
├── fixtures/                          # Realistic & synthetic test data
│   ├── bank_*.csv                     # Bank statement variants (clean, noisy, broken)
│   ├── bank_statement_noisy.pdf       # Bank PDF for live tests
│   ├── cc_statement.pdf               # CC PDF for live tests (user-provided, gitignored)
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

### Live Test Helpers (`tests/e2e/helpers/liveTestHelpers.ts`)
- `skipIfNoLiveLLM()` — Skips test when `LIVE_LLM_URL` is unset
- `seedLiveLLMSettings()` — Seeds localStorage with real LLM config
- `seedTransactions()` — Seeds transaction data for chat/insights tests
- `getReviewSession()` — Reads review-session from sessionStorage
- `waitForUploadOrFailure()` — Upload wait with pipeline failure detection
- `setupConsoleCapture()` — Captures console/errors/HTTP for debugging
- `dumpLogsOnFailure()` — Writes debug logs on pipeline stall
- `getTransactionsFromStore()` / `getMerchantRules()` — Read from localStorage
- `VALID_CATEGORIES` / `VALID_CATEGORY_SOURCES` — Sets for adversarial validation

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
