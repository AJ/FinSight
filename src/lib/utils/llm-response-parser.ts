/**
 * Parses LLM JSON responses that may be wrapped in markdown code blocks.
 * Handles variations like:
 * - Raw JSON: `{"key": "value"}`
 * - Markdown: ` ```json\n{"key": "value"}\n``` `
 */
export function parseLLMJsonResponse<T = unknown>(raw: string): T {
  let cleaned = raw.trim();
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }
  return JSON.parse(cleaned) as T;
}
