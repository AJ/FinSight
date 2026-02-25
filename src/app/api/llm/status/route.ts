import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/lib/llm/index';
import { LLMProvider } from '@/lib/llm/types';
import { validateOllamaUrl } from '@/lib/store/settingsStore';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const urlParam =
    request.nextUrl.searchParams.get('url') || 'http://localhost:11434';
  const provider = (request.nextUrl.searchParams.get('provider') || 'ollama') as LLMProvider;

  // Validate URL to prevent SSRF
  const validation = validateOllamaUrl(urlParam);
  if (!validation.valid) {
    return NextResponse.json({
      connected: false,
      error: validation.error || 'Invalid URL',
      models: [],
      selectedModel: null,
    }, { status: 400 });
  }

  const client = getServerClient(provider);

  try {
    const connected = await client.checkRunning(validation.sanitized);

    if (!connected) {
      return NextResponse.json({
        connected: false,
        models: [],
        selectedModel: null,
      });
    }

    const models = await client.listModels(validation.sanitized);

    return NextResponse.json({
      connected: true,
      models,
      selectedModel: models[0] || null,
    });
  } catch (error) {
    return NextResponse.json({
      connected: false,
      error: error instanceof Error ? error.message : 'Connection failed',
      models: [],
      selectedModel: null,
    }, { status: 500 });
  }
}
