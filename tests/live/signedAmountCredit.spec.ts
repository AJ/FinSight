import { describe, it, expect } from 'vitest';
import { isLiveLLMAvailable, getLiveLLMUrl, getLiveLLMModel, parseJsonFromResponse } from './helpers';
import { buildTransactionsPrompt } from '@/lib/parsers/extractTransactions';
import { numberStatementLines } from '@/lib/parsers/lineNumbering';

const describeLive = isLiveLLMAvailable() ? describe : describe.skip;

/**
 * Spaced-plus amount regression (introduced by columnization, found at
 * Checkpoint 1 of the table-detection fix, 2026-08-18): when the amount cell
 * is "+ 350.39" — a plus sign followed by a SPACE — the live model reads the
 * amount as prefix-less and defaults to debit, even though the prompt's RULE 5
 * says a "+" prefix is ALWAYS a credit. The real statement's cashback row
 * ("Global Value_Cash Back", "+ 350.39") and refund row ("-10 | + 304.00")
 * both hit this.
 *
 * This test asserts DESIGN INTENT (plus sign, spaced or not, ⇒ credit) through
 * the real CC transactions prompt and the real local model. It was written
 * BEFORE the prompt fix and must be red against the unfixed prompt.
 */

interface Extracted {
  description?: string;
  amount?: number;
  type?: 'debit' | 'credit';
  sourceLine?: number;
}

// The statement's raw lines, in order — line numbers are derived from this
// array's indexes so the sourceLine assertions cannot drift.
// Money cells are GLUED ("+304.00", not "+ 304.00"): the geometry pipeline
// normalizes a leading sign separated from its number before the text reaches
// the model, so glued cells are the production shape this test must cover.
// (Run against the raw spaced form on 2026-08-18: the model read "+ 499.00"
// as prefix-less and stole the rewards "-10" as the amount sign.)
const ROWS = {
  cashback: '03/10/2025 00:00||Global Value_Cash Back||||+350.39||l',
  purchase: '20/10/2025 16:43||URBAN COMPANY LIMITEDGURUGRAM||+ 10||304.00||l',
  fruit: '20/10/2025 13:55||EDEN FRESH FRUITS ANDVBANGALORE||||227.00||l',
  refund: '20/10/2025 00:00||URBAN COMPANY LIMITEDGURUGRAM||-10||+304.00||l',
  compactPlus: '21/10/2025 19:22||AIRTEL RECHARGE||||+499.00||l',
  plainDebit: '22/10/2025 10:05||SWIGGY ORDER||||618.00||l',
};

function statementText(): string {
  const lines = [
    'SYNTHETIC CARD STATEMENT',
    'Statement Period: 03 Oct, 2025 - 02 Nov, 2025',
    '',
    'DATE & TIME||TRANSACTION DESCRIPTION||REWARDS||AMOUNT||PI',
    ROWS.cashback,
    ROWS.purchase,
    ROWS.fruit,
    ROWS.refund,
    ROWS.compactPlus,
    ROWS.plainDebit,
    '23/10/2025 11:00||BLINKIT GROCERIES||||349.10||l',
    '24/10/2025 09:30||INDIGO FLIGHT BOOKING||||3899.00||l',
  ];
  return lines.join('\n');
}

function lineIndexOf(row: string): number {
  return statementText().split('\n').indexOf(row) + 1; // numberStatementLines is 1-based
}

describeLive('Spaced-plus amount cells are credits (live model)', () => {
  // PARKED 2026-08-18: qwen3-4b (2507, temp 0) ignores the amount column's sign
  // across SIX prompt configurations — base, explicit spaced-sign rules, glued
  // "+304.00", "CR" markers, exact-input-format few-shot + sign-first
  // procedure, and thinking mode via chat_template_kwargs. It types by keyword
  // (cashback ✓) and merchant priors (everything else → debit), and attributes
  // the REWARDS column's sign to the money amount. Code-side type overrides
  // (deterministic sign → type) were proposed and rejected: no hardcoding in
  // code. Resolution requires either a larger/different model or a future
  // design the user approves. `it.fails` records the wall honestly.
  it.fails('classifies "+ 350.39" and "+ 304.00" amount cells as credit', async () => {
    const raw = statementText();
    // Experimental arm: exact-input-format few-shot examples + a sign-first
    // output scaffold, appended to the production prompt. If this arm passes
    // where the base prompt failed, the winning content moves into
    // CC_TRANSACTIONS_PROMPT.
    const scaffold = `

WORKED EXAMPLES — input row followed by the correct type (the || columns are DATE, DESCRIPTION, REWARDS, AMOUNT):

"20/10/2025 00:00||STORE NAME||-10||+304.00||" → the AMOUNT column is "+304.00" and starts with "+" → type = "credit" (the -10 is reward points, not money)
"20/10/2025 00:00||AIRTEL RECHARGE||||+499.00||" → the AMOUNT column is "+499.00" and starts with "+" → type = "credit" (the sign decides, not the merchant)
"20/10/2025 00:00||STORE NAME||+ 10||304.00||" → the AMOUNT column is "304.00" with no sign → type = "debit"
"03/10/2025 00:00||CASH BACK||||+350.39||" → the AMOUNT column starts with "+" → type = "credit"

PROCEDURE (follow for every row, in order):
1. Look ONLY at the AMOUNT column. If it starts with "+" (with or without a space) the type is "credit" — stop.
2. If it starts with "-" the type is "debit" — stop.
3. Only if it has no sign, use merchant/refund/payment context.`;
    const prompt =
      buildTransactionsPrompt(numberStatementLines(raw), 'credit_card', null) + scaffold;

    // Thinking-mode arm: qwen3-2507 variants default to thinking OFF in
    // OpenAI-compatible servers; request it explicitly. If this arm passes
    // where the non-thinking runs failed, the lever is model config, not
    // prompt content.
    const url = getLiveLLMUrl();
    const res = await fetch(`${url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: getLiveLLMModel(),
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        stream: false,
        chat_template_kwargs: { enable_thinking: true },
      }),
    });
    if (!res.ok) throw new Error(`thinking-mode request failed: ${res.status} ${res.statusText}`);
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const response = body.choices?.[0]?.message?.content ?? '';
    const parsed = parseJsonFromResponse(response) as { transactions?: Extracted[] };
    const txns = parsed.transactions ?? [];
    console.log('[signed-amount live]', JSON.stringify(txns));

    const bySourceLine = (n: number) => txns.find(t => t.sourceLine === n);

    // The regression rows: spaced-plus amounts must be credits.
    const cashback = bySourceLine(lineIndexOf(ROWS.cashback));
    expect(cashback, 'cashback row extracted').toBeDefined();
    expect(cashback!.type, `cashback "+ 350.39" must be credit, got ${cashback!.type}`).toBe('credit');

    const refund = bySourceLine(lineIndexOf(ROWS.refund));
    expect(refund, 'refund row extracted').toBeDefined();
    expect(refund!.type, `refund "-10 | + 304.00" must be credit, got ${refund!.type}`).toBe('credit');
    expect(refund!.amount).toBe(304);

    // Negative cases: the purchase twin (no prefix) stays a debit, and the
    // compact plus still credits.
    const purchase = bySourceLine(lineIndexOf(ROWS.purchase));
    expect(purchase).toBeDefined();
    expect(purchase!.type, 'prefix-less purchase stays debit').toBe('debit');

    const compactPlus = bySourceLine(lineIndexOf(ROWS.compactPlus));
    expect(compactPlus).toBeDefined();
    expect(compactPlus!.type, 'compact "+ 499.00" stays credit').toBe('credit');
  }, 600_000);
});
