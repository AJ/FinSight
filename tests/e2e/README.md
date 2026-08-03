# E2E Tests

## Standard E2E (mocked LLM)

No external dependencies. Run against the dev server with LLM responses mocked via Playwright route interception.

```bash
npm run test:e2e
```

## Live-LLM E2E (real LM Studio)

Uploads real PDFs through the full pipeline with actual LM Studio calls. Tests skip automatically when env vars are not set.

### Quick start

```bash
# All live tests
LIVE_LLM_URL=http://localhost:1234 npx playwright test tests/e2e/*Live.spec.ts --timeout=600000

# Bank tests only (no CC PDF needed)
LIVE_LLM_URL=http://localhost:1234 npx playwright test tests/e2e/balanceReconciliationLive.spec.ts --timeout=300000

# With CC and password tests
LIVE_LLM_URL=http://localhost:1234 CC_PDF_PASSWORD=yourpassword npx playwright test tests/e2e/*Live.spec.ts --timeout=600000
```

**PowerShell** (Windows):

```powershell
$env:LIVE_LLM_URL="http://localhost:1234"; npx playwright test tests/e2e/*Live.spec.ts --timeout=600000
```

### Environment variables

Loaded from `.env.test.live` if present (see `tests/e2e/helpers/liveTestHelpers.ts`), or set manually.

| Variable | Required | Description |
|----------|----------|-------------|
| `LIVE_LLM_URL` | Yes | LM Studio base URL (e.g. `http://localhost:1234`). All tests skip if unset. |
| `LIVE_LLM_MODEL` | No | Model name (default: `qwen/qwen3-4b-2507`) |
| `CC_PDF_PASSWORD` | No | Password for `tests/fixtures/cc_statement.pdf`. Omit if the PDF has no password. |

### Live test files

| File | What it tests | Timeout |
|------|---------------|---------|
| `balanceReconciliationLive.spec.ts` | Balance reconciliation (bank + CC), verification report structure | 5–10 min |
| `fileUploadLifecycleLive.spec.ts` | Full upload → parse → review → edit → confirm → save → re-upload → rule learned | 10 min |
| `creditCardLogicLive.spec.ts` | CC 3-pass pipeline: summary, transactions, rewards, categorization | 10 min |
| `transactionsLifecycleLive.spec.ts` | AI categorization produces categories, category edits persist after reload | 6 min |
| `rulesEngineLive.spec.ts` | Learned merchant rules override AI categorization on re-upload | 10 min |
| `pdfPasswordLive.spec.ts` | Encrypted PDF extraction, wrong password error, retry flow | 10 min |
| `chatWithDataLive.spec.ts` | Chat streaming with real LLM, suggestion chips | 2 min |
| `insightsLive.spec.ts` | Financial insights generation with structural validation | 2 min |

All live tests run serially within each describe block to avoid LM Studio KV cache exhaustion.

### Fixtures

| File | Used by | Notes |
|------|---------|-------|
| `tests/fixtures/bank_statement_noisy.pdf` | Bank tests | Exists |
| `tests/fixtures/cc_statement.pdf` | CC tests | Must be provided manually. Password-protected is OK. CC tests skip if missing. |
