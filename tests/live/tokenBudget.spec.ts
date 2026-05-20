/**
 * Token Budget Instrumentation Test
 *
 * Measures actual vs estimated token usage for each pipeline stage.
 * Validates our context window budgeting framework:
 *   c = context window length
 *   p = prompt tokens (system prompt + instruction template — WITHOUT the input text)
 *   y = input text tokens (normalized statement text)
 *   z = output tokens = c - p - y
 *
 * Requires a running LM Studio server with a loaded model.
 * Set LIVE_LLM_URL and LIVE_LLM_MODEL env vars or .env.test.live file.
 *
 * Usage:
 *   npx vitest run tests/live/tokenBudget.spec.ts --reporter=verbose
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import {
  CC_SUMMARY_PROMPT,
  CC_TRANSACTIONS_PROMPT,
  CC_REWARDS_PROMPT,
  BANK_SUMMARY_PROMPT,
  BANK_TRANSACTIONS_PROMPT,
  TYPE_DETECTION_PROMPT,
} from '@/lib/parsers/prompts';
import { SYSTEM_PROMPT } from '@/lib/llm/prompts';
import { normalizeStatementText } from '@/lib/parsers/normalization';

// Load .env.test.live if present (manual parse — no dotenv dependency)
const envPath = path.resolve(process.cwd(), '.env.test.live');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const val = trimmed.substring(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

const LIVE_LLM_URL = process.env.LIVE_LLM_URL || '';
const LIVE_LLM_MODEL = process.env.LIVE_LLM_MODEL || '';
const CC_PDF_PASSWORD = process.env.CC_PDF_PASSWORD || '';

// Our estimation constants (from transactionChunking.ts)
const CHARS_PER_TOKEN = 2.3;
const PROMPT_OVERHEAD_TOKENS = 2500;
const CHUNK_SIZE_DIVISOR = 2.5;
const AVG_CHARS_PER_LINE = 55;

// ── Types ──────────────────────────────────────────────────────────────────────

interface TokenActuals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface StageBudget {
  stage: string;
  statementType: 'credit_card' | 'bank';

  // Context window
  contextWindowTokens: number | undefined;

  // Input text
  normalizedTextLength: number;
  normalizedTextLines: number;
  y_estimated: number;

  // Prompt template
  templateWithRawTextLength: number;
  templateWithoutRawTextLength: number;
  p_constant: number; // PROMPT_OVERHEAD_TOKENS (global constant)
  p_precise_est: number; // system_prompt + template instructions (per-template)

  // Budget calculations
  budget_z: number | undefined;
  budget_y_max: number | undefined;

  // Actuals from API
  p_actual: number | undefined;
  z_actual: number | undefined;
  total_actual: number | undefined;

  // Error
  error?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function shouldSkip(): boolean {
  return !LIVE_LLM_URL || !LIVE_LLM_MODEL;
}

function estimateTokens(charCount: number): number {
  return Math.ceil(charCount / CHARS_PER_TOKEN);
}

async function callLLMAndMeasureTokens(
  prompt: string,
  maxTokens: number = 50,
): Promise<{ text: string; usage: TokenActuals }> {
  const body = {
    model: LIVE_LLM_MODEL,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    temperature: 0,
    max_tokens: maxTokens,
  };

  const res = await fetch(`${LIVE_LLM_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM API error (${res.status}): ${text}`);
  }

  const data = await res.json();
  const usage: TokenActuals = {
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    totalTokens: (data.usage?.prompt_tokens ?? 0) + (data.usage?.completion_tokens ?? 0),
  };

  return {
    text: data.choices?.[0]?.message?.content ?? '',
    usage,
  };
}

async function getContextWindowTokens(): Promise<number | undefined> {
  try {
    const res = await fetch(`${LIVE_LLM_URL}/api/v1/models`);
    if (!res.ok) return undefined;
    const data = await res.json();
    const models = data.models || [];
    // Find the model matching LIVE_LLM_MODEL, fall back to first loaded model
    const match = models.find((m: { key?: string; id?: string; loaded_instances?: unknown[] }) =>
      m.key === LIVE_LLM_MODEL || m.id === LIVE_LLM_MODEL
    ) ?? models.find((m: { loaded_instances?: unknown[] }) => m.loaded_instances?.length > 0) ?? models[0];
    if (!match) return undefined;
    // Prefer loaded instance config (actual context), fall back to max_context_length
    const loaded = (match as { loaded_instances?: Array<{ config?: { context_length?: number } }> }).loaded_instances?.[0];
    return loaded?.config?.context_length ?? match.max_context_length;
  } catch {
    // fall through
  }
  return undefined;
}

async function extractPdfText(pdfPath: string, password?: string): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = pdfjsLib.getDocument({
    data,
    password: password || undefined,
    useSystemFonts: true,
  });

  const doc = await loadingTask.promise;
  const pages: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Group text items by Y position into lines (same approach as documentExtraction.ts)
    const items = content.items
      .filter(
        (item) =>
          'str' in item && 'transform' in item &&
          typeof (item as { str: string }).str === 'string' &&
          (item as { str: string }).str.trim().length > 0,
      )
      .map((item) => {
        const ti = item as { str: string; transform: number[] };
        return { text: ti.str.trim(), x: Math.round(ti.transform[4]), y: Math.round(ti.transform[5]) };
      });

    const lines: { y: number; items: { text: string; x: number }[] }[] = [];
    for (const item of items) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - item.y) < 5) {
        last.items.push({ text: item.text, x: item.x });
      } else {
        lines.push({ y: item.y, items: [{ text: item.text, x: item.x }] });
      }
    }

    const pageText = lines
      .map((line) => line.items.sort((a, b) => a.x - b.x).map((i) => i.text).join(' '))
      .join('\n');
    pages.push(pageText);
  }

  return pages.join('\n\n--- PAGE BREAK ---\n');
}

interface StagePrompt {
  stage: string;
  templateWithRawText: string;
  templateWithoutRawText: string;
}

function buildStagePrompts(
  normalizedText: string,
  statementType: 'credit_card' | 'bank',
  bankName?: string | null,
): StagePrompt[] {
  const bankContext = bankName ? ` issued by ${bankName.toUpperCase()}` : '';
  const results: StagePrompt[] = [];

  if (statementType === 'credit_card') {
    const summaryTpl = CC_SUMMARY_PROMPT.replace('{BANK_CONTEXT}', bankContext);
    results.push({
      stage: 'cc_summary',
      templateWithRawText: summaryTpl.replace('{RAW_TEXT}', normalizedText),
      templateWithoutRawText: summaryTpl.replace('{RAW_TEXT}', ''),
    });

    const txTpl = CC_TRANSACTIONS_PROMPT.replace('{BANK_CONTEXT}', bankContext);
    results.push({
      stage: 'cc_transactions',
      templateWithRawText: txTpl.replace('{RAW_TEXT}', normalizedText),
      templateWithoutRawText: txTpl.replace('{RAW_TEXT}', ''),
    });

    results.push({
      stage: 'cc_rewards',
      templateWithRawText: CC_REWARDS_PROMPT.replace('{RAW_TEXT}', normalizedText),
      templateWithoutRawText: CC_REWARDS_PROMPT.replace('{RAW_TEXT}', ''),
    });
  } else {
    const summaryTpl = BANK_SUMMARY_PROMPT.replace('{BANK_CONTEXT}', bankContext);
    results.push({
      stage: 'bank_summary',
      templateWithRawText: summaryTpl.replace('{RAW_TEXT}', normalizedText),
      templateWithoutRawText: summaryTpl.replace('{RAW_TEXT}', ''),
    });

    const txTpl = BANK_TRANSACTIONS_PROMPT.replace('{BANK_CONTEXT}', bankContext);
    results.push({
      stage: 'bank_transactions',
      templateWithRawText: txTpl.replace('{RAW_TEXT}', normalizedText),
      templateWithoutRawText: txTpl.replace('{RAW_TEXT}', ''),
    });
  }

  results.push({
    stage: 'type_detection',
    templateWithRawText: TYPE_DETECTION_PROMPT.replace('{RAW_TEXT}', normalizedText),
    templateWithoutRawText: TYPE_DETECTION_PROMPT.replace('{RAW_TEXT}', ''),
  });

  return results;
}

function computeBudget(
  stage: string,
  statementType: 'credit_card' | 'bank',
  templateWithRawText: string,
  templateWithoutRawText: string,
  normalizedText: string,
  contextWindowTokens: number | undefined,
  actuals?: TokenActuals,
  error?: string,
): StageBudget {
  const normalizedTextLength = normalizedText.length;
  const normalizedTextLines = normalizedText.split('\n').length;
  const y_estimated = estimateTokens(normalizedTextLength);

  const p_constant = PROMPT_OVERHEAD_TOKENS;

  // Per-template precise estimate: system prompt + template instructions (without raw text)
  const systemPromptTokens = estimateTokens(SYSTEM_PROMPT.length);
  const templateInstructionTokens = estimateTokens(templateWithoutRawText.length);
  const p_precise_est = systemPromptTokens + templateInstructionTokens;

  let budget_z: number | undefined;
  let budget_y_max: number | undefined;

  if (contextWindowTokens) {
    budget_z = contextWindowTokens - p_precise_est - y_estimated;
    budget_y_max = Math.floor((contextWindowTokens - p_precise_est) / CHUNK_SIZE_DIVISOR);
  }

  return {
    stage,
    statementType,
    contextWindowTokens,
    normalizedTextLength,
    normalizedTextLines,
    y_estimated,
    templateWithRawTextLength: templateWithRawText.length,
    templateWithoutRawTextLength: templateWithoutRawText.length,
    p_constant,
    p_precise_est,
    budget_z,
    budget_y_max,
    p_actual: actuals?.promptTokens,
    z_actual: actuals?.completionTokens,
    total_actual: actuals?.totalTokens,
    error,
  };
}

function printBudgetTable(budgets: StageBudget[]): void {
  console.log('');
  console.log('--- TOKEN BUDGET REPORT ---');

  const c = budgets[0]?.contextWindowTokens ?? 'unknown';
  console.log(`c=${c}  chars_per_tok=${CHARS_PER_TOKEN}  overhead_const=${PROMPT_OVERHEAD_TOKENS}`);

  for (const b of budgets) {
    const pActual = b.p_actual !== undefined ? String(b.p_actual) : 'ERR';
    const pDelta = b.p_actual !== undefined
      ? `${b.p_actual - b.p_precise_est >= 0 ? '+' : ''}${b.p_actual - b.p_precise_est}`
      : 'N/A';
    const zBudget = b.budget_z !== undefined ? String(b.budget_z) : 'N/A';
    const zActual = b.z_actual !== undefined ? String(b.z_actual) : 'ERR';
    const over = b.budget_z !== undefined && b.budget_z < 0
      ? 'OVER!'
      : b.error ? 'ERROR' : 'ok';

    console.log('');
    console.log(`[${b.stage}]  (${b.statementType})`);
    console.log(`  p: const=${b.p_constant} estimated=${b.p_precise_est} actual=${pActual} delta=${pDelta}`);
    console.log(`  y: est=${b.y_estimated}tok  chars=${b.normalizedTextLength}  lines=${b.normalizedTextLines}`);
    console.log(`  z: budget=${zBudget}  actual=${zActual}  status=${over}`);
    console.log(`  template: ${b.templateWithoutRawTextLength}chars  sys_prompt: ${SYSTEM_PROMPT.length}chars  full: ${b.templateWithRawTextLength}chars`);

    if (b.error) {
      console.log(`  error: ${b.error.substring(0, 200)}`);
    }
  }

  console.log('');
  console.log('--- END REPORT ---');
  console.log('');
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe.skipIf(shouldSkip())('Token Budget Instrumentation', () => {
  let contextWindowTokens: number | undefined;
  let ccNormalizedText = '';
  let bankNormalizedText = '';

  beforeAll(async () => {
    contextWindowTokens = await getContextWindowTokens();
    console.log(`\n[Setup] Context window: ${contextWindowTokens ?? 'unknown'} tokens`);
    console.log(`[Setup] LLM URL: ${LIVE_LLM_URL}`);
    console.log(`[Setup] LLM Model: ${LIVE_LLM_MODEL}`);

    const ccPdfPath = path.resolve(process.cwd(), 'tests/fixtures/cc_statement.pdf');
    if (fs.existsSync(ccPdfPath)) {
      try {
        const ccRaw = await extractPdfText(ccPdfPath, CC_PDF_PASSWORD || undefined);
        ccNormalizedText = normalizeStatementText(ccRaw);
        console.log(`[Setup] CC statement: ${ccNormalizedText.length} chars, ${ccNormalizedText.split('\n').length} lines`);
      } catch (e: unknown) {
        console.log(`[Setup] CC PDF extraction failed: ${e instanceof Error ? e.message : e}`);
      }
    } else {
      console.log('[Setup] CC fixture not found, skipping CC stages');
    }

    const bankPdfPath = path.resolve(process.cwd(), 'tests/fixtures/bank_statement_noisy.pdf');
    if (fs.existsSync(bankPdfPath)) {
      try {
        const bankRaw = await extractPdfText(bankPdfPath);
        bankNormalizedText = normalizeStatementText(bankRaw);
        console.log(`[Setup] Bank statement: ${bankNormalizedText.length} chars, ${bankNormalizedText.split('\n').length} lines`);
      } catch (e: unknown) {
        console.log(`[Setup] Bank PDF extraction failed: ${e instanceof Error ? e.message : e}`);
      }
    } else {
      console.log('[Setup] Bank fixture not found, skipping bank stages');
    }
  }, 120_000);

  it('measures actual token usage for all pipeline stages', async () => {
    const budgets: StageBudget[] = [];

    const texts: Array<{ text: string; type: 'credit_card' | 'bank' }> = [];
    if (ccNormalizedText) texts.push({ text: ccNormalizedText, type: 'credit_card' });
    if (bankNormalizedText) texts.push({ text: bankNormalizedText, type: 'bank' });

    if (texts.length === 0) {
      console.log('[Skip] No statement text extracted from fixtures');
      return;
    }

    for (const { text, type } of texts) {
      const prompts = buildStagePrompts(text, type);
      for (const { stage, templateWithRawText, templateWithoutRawText } of prompts) {
        try {
          const { usage } = await callLLMAndMeasureTokens(templateWithRawText, 50);
          budgets.push(computeBudget(stage, type, templateWithRawText, templateWithoutRawText, text, contextWindowTokens, usage));
        } catch (e: unknown) {
          budgets.push(computeBudget(stage, type, templateWithRawText, templateWithoutRawText, text, contextWindowTokens, undefined, e instanceof Error ? e.message : String(e)));
        }
      }
    }

    printBudgetTable(budgets);

    expect(budgets.length).toBeGreaterThan(0);

    const overBudgetStages = budgets.filter(b => b.budget_z !== undefined && b.budget_z < 0);
    if (overBudgetStages.length > 0) {
      console.log('\nSTAGES OVER BUDGET (will fail with "Context size exceeded"):');
      for (const s of overBudgetStages) {
        console.log(`  - ${s.stage}: z_budget=${s.budget_z} (need ${Math.abs(s.budget_z!)} fewer tokens)`);
      }
    }
  }, 600_000);

  it('analyzes chunking threshold accuracy', async () => {
    if (!contextWindowTokens) {
      console.log('[Skip] No context window available');
      return;
    }

    const c = contextWindowTokens;
    console.log('');
    console.log('--- CHUNKING THRESHOLD ANALYSIS ---');
    console.log(`c=${c}`);

    // Current global formula
    const currentBudget = Math.max(Math.floor((c - PROMPT_OVERHEAD_TOKENS) / CHUNK_SIZE_DIVISOR), 500);
    const currentChars = Math.floor(currentBudget * CHARS_PER_TOKEN);
    const currentLines = Math.floor(currentChars / AVG_CHARS_PER_LINE);
    console.log(`\nCurrent formula (PROMPT_OVERHEAD_TOKENS=${PROMPT_OVERHEAD_TOKENS}):`);
    console.log(`  y_max_tokens = (${c} - ${PROMPT_OVERHEAD_TOKENS}) / ${CHUNK_SIZE_DIVISOR} = ${currentBudget}`);
    console.log(`  y_max_chars  = ${currentBudget} * ${CHARS_PER_TOKEN} = ${currentChars}`);
    console.log(`  y_max_lines  = ${currentChars} / ${AVG_CHARS_PER_LINE} = ${currentLines}`);

    // Per-template formulas
    const systemPromptEst = estimateTokens(SYSTEM_PROMPT.length);
    const templates = [
      { name: 'CC_TRANSACTIONS', tpl: CC_TRANSACTIONS_PROMPT },
      { name: 'CC_SUMMARY', tpl: CC_SUMMARY_PROMPT },
      { name: 'CC_REWARDS', tpl: CC_REWARDS_PROMPT },
      { name: 'BANK_TRANSACTIONS', tpl: BANK_TRANSACTIONS_PROMPT },
      { name: 'BANK_SUMMARY', tpl: BANK_SUMMARY_PROMPT },
    ];

    console.log(`\nPer-template analysis:`);
    for (const { name, tpl } of templates) {
      const tplNoRaw = tpl.replace('{RAW_TEXT}', '').replace('{BANK_CONTEXT}', '');
      const tplEst = estimateTokens(tplNoRaw.length);
      const pEst = systemPromptEst + tplEst;
      const yMaxTokens = Math.max(Math.floor((c - pEst) / CHUNK_SIZE_DIVISOR), 500);
      const yMaxChars = Math.floor(yMaxTokens * CHARS_PER_TOKEN);
      console.log(`  ${name}: template_chars=${tplNoRaw.length}, p_est=${pEst}, y_max_tokens=${yMaxTokens}, y_max_chars=${yMaxChars}`);
    }

    // Compare against actual fixtures
    for (const [label, text] of [['CC', ccNormalizedText], ['Bank', bankNormalizedText]] as const) {
      if (!text) continue;
      const chars = text.length;
      const lines = text.split('\n').length;
      console.log(`\n${label} fixture: ${chars} chars, ${lines} lines`);
      console.log(`  Current formula chunks: ${chars > currentChars || lines > currentLines ? 'YES' : 'NO'} (chars>${currentChars}=${chars > currentChars}, lines>${currentLines}=${lines > currentLines})`);

      // With template-specific threshold
      const tpl = label === 'CC' ? CC_TRANSACTIONS_PROMPT : BANK_TRANSACTIONS_PROMPT;
      const tplNoRaw = tpl.replace('{RAW_TEXT}', '').replace('{BANK_CONTEXT}', '');
      const pEst = systemPromptEst + estimateTokens(tplNoRaw.length);
      const yMaxTokens = Math.max(Math.floor((c - pEst) / CHUNK_SIZE_DIVISOR), 500);
      const yMaxChars = Math.floor(yMaxTokens * CHARS_PER_TOKEN);
      console.log(`  Template-specific formula chunks: ${chars > yMaxChars ? 'YES' : 'NO'} (y_max_chars=${yMaxChars})`);
    }

    console.log('--- END CHUNKING ANALYSIS ---');
    console.log('');
  }, 60_000);

  it('calibrates CHARS_PER_TOKEN against actual tokenizer', async () => {
    const samples = [
      // Short text
      'HDFC Bank Credit Card Statement REDACTED',
      // Medium — typical transaction row
      'REDACTED',
      // Larger — account summary section
      `Account Summary
Opening Payment/ Purchase/ Finance
Total Dues
Balance Credits Debits Charges
REDACTED`,
    ];

    console.log('');
    console.log('--- CHARS_PER_TOKEN CALIBRATION ---');

    for (const text of samples) {
      try {
        const { usage } = await callLLMAndMeasureTokens(text, 10);
        const ratio = text.length / usage.promptTokens;
        const error = ((ratio - CHARS_PER_TOKEN) / CHARS_PER_TOKEN * 100);
        console.log(`  "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
        console.log(`    chars=${text.length}, actual_tokens=${usage.promptTokens}, ratio=${ratio.toFixed(2)}, error=${error.toFixed(1)}%`);
      } catch (e: unknown) {
        console.log(`  Failed: ${e instanceof Error ? e.message : e}`);
      }
    }

    // Full CC text if available
    if (ccNormalizedText) {
      try {
        const { usage } = await callLLMAndMeasureTokens(ccNormalizedText, 10);
        const ratio = ccNormalizedText.length / usage.promptTokens;
        const error = ((ratio - CHARS_PER_TOKEN) / CHARS_PER_TOKEN * 100);
        console.log(`\n  Full CC normalized text:`);
        console.log(`    chars=${ccNormalizedText.length}, actual_tokens=${usage.promptTokens}, ratio=${ratio.toFixed(2)}, error=${error.toFixed(1)}%`);
        console.log(`    Recommended CHARS_PER_TOKEN: ${ratio.toFixed(2)}`);
      } catch (e: unknown) {
        console.log(`  Full text calibration failed: ${e instanceof Error ? e.message : e}`);
      }
    }

    console.log('--- END CALIBRATION ---');
    console.log('');
  }, 60_000);

  it('tests cc_transactions with NO max_tokens (production simulation)', async () => {
    if (!ccNormalizedText) {
      console.log('[Skip] No CC text available');
      return;
    }

    const prompts = buildStagePrompts(ccNormalizedText, 'credit_card');
    const ccTx = prompts.find(p => p.stage === 'cc_transactions');
    if (!ccTx) {
      console.log('[Skip] cc_transactions prompt not found');
      return;
    }

    // Prepend SYSTEM_PROMPT (same as client.ts does)
    const fullPrompt = `${SYSTEM_PROMPT}\n\n${ccTx.templateWithRawText}`;

    console.log('');
    console.log('--- CC_TRANSACTIONS WITHOUT max_tokens ---');
    console.log(`Prompt: ${fullPrompt.length} chars`);
    console.log(`Context window: ${contextWindowTokens ?? 'unknown'}`);

    // Test 1: WITHOUT max_tokens (what production does now)
    console.log('');
    console.log('[Test 1] Sending without max_tokens...');
    try {
      const body = {
        model: LIVE_LLM_MODEL,
        messages: [{ role: 'user', content: fullPrompt }],
        stream: false,
        temperature: 0,
      };
      const res = await fetch(`${LIVE_LLM_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        console.log(`  OK: prompt_tokens=${data.usage?.prompt_tokens} completion_tokens=${data.usage?.completion_tokens}`);
      } else {
        const text = await res.text();
        console.log(`  FAIL (${res.status}): ${text}`);
      }
    } catch (e: unknown) {
      console.log(`  ERROR: ${e instanceof Error ? e.message : e}`);
    }

    // Test 2: WITH explicit max_tokens = c - estimated_p
    if (contextWindowTokens) {
      const estimatedP = Math.ceil(fullPrompt.length / 2.36); // corrected ratio
      const safeMaxTokens = Math.max(contextWindowTokens - estimatedP - 200, 100); // 200 token margin
      console.log('');
      console.log(`[Test 2] Sending with max_tokens=${safeMaxTokens} (c=${contextWindowTokens} - est_p=${estimatedP} - 200 margin)...`);
      try {
        const body = {
          model: LIVE_LLM_MODEL,
          messages: [{ role: 'user', content: fullPrompt }],
          stream: false,
          temperature: 0,
          max_tokens: safeMaxTokens,
        };
        const res = await fetch(`${LIVE_LLM_URL}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const data = await res.json();
          console.log(`  OK: prompt_tokens=${data.usage?.prompt_tokens} completion_tokens=${data.usage?.completion_tokens}`);
        } else {
          const text = await res.text();
          console.log(`  FAIL (${res.status}): ${text}`);
        }
      } catch (e: unknown) {
        console.log(`  ERROR: ${e instanceof Error ? e.message : e}`);
      }
    }

    console.log('');
    console.log('--- END PRODUCTION SIMULATION ---');
    console.log('');
  }, 300_000);
});
