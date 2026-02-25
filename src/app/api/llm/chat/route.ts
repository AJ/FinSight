import { getServerClient } from '@/lib/llm/index';
import { LLMProvider } from '@/lib/llm/types';
import { validateOllamaUrl } from '@/lib/store/settingsStore';

export async function POST(request: Request) {
  try {
    const { message, context, history, model, ollamaUrl, provider } = await request.json();
    const urlParam = (ollamaUrl as string) || 'http://localhost:11434';
    const llmProvider = (provider as LLMProvider) || 'ollama';

    // Validate URL to prevent SSRF
    const validation = validateOllamaUrl(urlParam);
    if (!validation.valid) {
      return new Response(
        JSON.stringify({ error: validation.error || 'Invalid URL' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const baseUrl = validation.sanitized;

    const client = getServerClient(llmProvider);

    // Resolve model
    let selectedModel = model as string | undefined;
    if (!selectedModel) {
      const models = await client.listModels(baseUrl);
      selectedModel = models[0];
    }
    if (!selectedModel) {
      return new Response(
        JSON.stringify({ error: 'No AI model available. Pull a model in Ollama first.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Build conversation
    const systemPrompt = `You are a helpful financial assistant. You have access to the user's bank statement data below. Answer questions accurately and concisely.

${context || 'No statement data available yet.'}

Guidelines:
- Be concise and precise with numbers.
- Format currency amounts properly.
- If asked for calculations, show your work briefly.
- If the data doesn't contain enough info, say so.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...((history || []) as { role: string; content: string }[]).map(
        (m) => ({ role: m.role, content: m.content })
      ),
      { role: 'user', content: message },
    ];

    // Stream from LLM
    const llmStream = await client.chatStream(baseUrl, selectedModel, messages);

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // For LM Studio (OpenAI-compatible), pass through SSE directly
    // For Ollama, transform NDJSON to SSE
    const transformed = new ReadableStream({
      async start(controller) {
        const reader = llmStream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const text = decoder.decode(value, { stream: true });

            if (llmProvider === 'lmstudio') {
              // LM Studio already returns SSE format, pass through
              controller.enqueue(value);
            } else {
              // Ollama returns NDJSON, transform to SSE
              const lines = text.split('\n').filter((l) => l.trim());

              for (const line of lines) {
                try {
                  const json = JSON.parse(line);
                  if (json.message?.content) {
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ content: json.message.content })}\n\n`
                      )
                    );
                  }
                  if (json.done) {
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                  }
                } catch {
                  /* skip malformed lines */
                }
              }
            }
          }
        } catch (err) {
          controller.error(err);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(transformed, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[LLM Chat]', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Chat failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
