'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTransactionStore } from '@/lib/store/transactionStore';
import { useSettingsStore } from '@/lib/store/settingsStore';
import { useChatStore } from '@/lib/store/chatStore';
import { checkLLMStatus } from '@/lib/parsers/llmParser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Sparkles,
  Plug,
  Cpu,
} from 'lucide-react';

export default function SettingsPage() {
  const transactions = useTransactionStore((state) => state.transactions);
  const clearAllTransactions = useTransactionStore((state) => state.clearAll);
  const clearChat = useChatStore((state) => state.clearAll);

  // Currency settings
  const currency = useSettingsStore((state) => state.currency);
  const setCurrency = useSettingsStore((state) => state.setCurrency);
  const getAvailableCurrencies = useSettingsStore(
    (state) => state.getAvailableCurrencies
  );
  const availableCurrencies = getAvailableCurrencies();

  // LLM settings
  const llmProvider = useSettingsStore((state) => state.llmProvider);
  const ollamaUrl = useSettingsStore((state) => state.ollamaUrl);
  const llmModel = useSettingsStore((state) => state.llmModel);
  const setLLMProvider = useSettingsStore((state) => state.setLLMProvider);
  const setOllamaUrl = useSettingsStore((state) => state.setOllamaUrl);
  const setLLMModel = useSettingsStore((state) => state.setLLMModel);

  // Local state for the URL input (so we can edit before saving)
  const [urlInput, setUrlInput] = useState(ollamaUrl);
  const [models, setModels] = useState<string[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    'idle' | 'connected' | 'failed'
  >('idle');

  // Test connection on mount with saved URL
  useEffect(() => {
    testConnection(ollamaUrl, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const testConnection = useCallback(
    async (url: string, silent = false) => {
      if (!silent) setIsConnecting(true);
      setConnectionStatus('idle');

      try {
        const status = await checkLLMStatus(url, llmProvider);

        if (status.connected) {
          setConnectionStatus('connected');
          setModels(status.models);
          setOllamaUrl(url);

          // If the currently saved model isn't in the new list, auto-select first
          if (
            status.models.length > 0 &&
            (!llmModel || !status.models.includes(llmModel))
          ) {
            setLLMModel(status.models[0]);
          }
        } else {
          setConnectionStatus('failed');
          setModels([]);
        }
      } catch {
        setConnectionStatus('failed');
        setModels([]);
      } finally {
        setIsConnecting(false);
      }
    },
    [llmModel, llmProvider, setOllamaUrl, setLLMModel]
  );

  const handleClearData = () => {
    if (
      confirm(
        'Are you sure you want to clear all transactions? This cannot be undone.'
      )
    ) {
      clearAllTransactions();
      clearChat();
      alert('All data cleared successfully!');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Page Header */}
      <div className="border-b border-border bg-card">
        <div className="px-6 py-4">
          <h1 className="text-xl font-bold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage AI connection, preferences, and data
          </p>
        </div>
      </div>

      <div className="p-6 max-w-2xl space-y-6">
        {/* ─── AI Connection ─── */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <CardTitle>AI Connection</CardTitle>
              </div>
              {connectionStatus === 'connected' && (
                <Badge className="bg-green-100 text-green-800 border-green-300">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Connected
                </Badge>
              )}
              {connectionStatus === 'failed' && (
                <Badge variant="destructive">
                  <XCircle className="w-3 h-3 mr-1" />
                  Disconnected
                </Badge>
              )}
            </div>
            <CardDescription>
              Connect to {llmProvider === 'lmstudio' ? 'LM Studio' : 'Ollama'} — local or remote. Use any model
              you like (Gemma, Llama, Mistral, Phi, Qwen, etc.).
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            {/* Provider selector */}
            <div className="space-y-2">
              <Label htmlFor="provider-select">LLM Provider</Label>
              <Select
                value={llmProvider}
                onValueChange={(v) => {
                  setLLMProvider(v as 'ollama' | 'lmstudio');
                  setUrlInput(v === 'lmstudio' ? 'http://localhost:1234' : 'http://localhost:11434');
                  setConnectionStatus('idle');
                  setModels([]);
                }}
              >
                <SelectTrigger id="provider-select">
                  <SelectValue placeholder="Choose a provider…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ollama">
                    <div className="flex items-center gap-2">
                      <Cpu className="w-4 h-4" />
                      Ollama
                    </div>
                  </SelectItem>
                  <SelectItem value="lmstudio">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4" />
                      LM Studio
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {llmProvider === 'ollama'
                  ? 'Ollama uses its native API at /api/* endpoints.'
                  : 'LM Studio uses an OpenAI-compatible API at /v1/* endpoints.'}
              </p>
            </div>

            <Separator />

            {/* Server URL */}
            <div className="space-y-2">
              <Label htmlFor="llm-url">Server URL</Label>
              <div className="flex gap-2">
                <Input
                  id="llm-url"
                  placeholder={llmProvider === 'lmstudio' ? 'http://localhost:1234' : 'http://localhost:11434'}
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  className="font-mono text-sm"
                />
                <Button
                  onClick={() => testConnection(urlInput)}
                  disabled={isConnecting || !urlInput.trim()}
                >
                  {isConnecting ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Plug className="w-4 h-4 mr-2" />
                  )}
                  Connect
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Default: <code>{llmProvider === 'lmstudio' ? 'http://localhost:1234' : 'http://localhost:11434'}</code>.
                Change if {llmProvider === 'lmstudio' ? 'LM Studio' : 'Ollama'} runs on another port or machine.
              </p>
            </div>

            <Separator />

            {/* Model selector */}
            <div className="space-y-2">
              <Label htmlFor="model-select">Model</Label>
              {models.length > 0 ? (
                <Select
                  value={llmModel || ''}
                  onValueChange={(v) => setLLMModel(v)}
                >
                  <SelectTrigger id="model-select">
                    <SelectValue placeholder="Choose a model…" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                  {connectionStatus === 'failed'
                    ? `Connect to ${llmProvider === 'lmstudio' ? 'LM Studio' : 'Ollama'} first to see available models.`
                    : `No models found. ${llmProvider === 'lmstudio' ? 'Load a model in LM Studio first.' : 'Pull one with: ollama pull <model>'}`}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Any model works — smaller models (1-4 B) are faster, larger
                models are more accurate.
              </p>
            </div>

            {/* Refresh models */}
            {connectionStatus === 'connected' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => testConnection(urlInput, false)}
                disabled={isConnecting}
              >
                <RefreshCw className="w-3 h-3 mr-2" />
                Refresh models
              </Button>
            )}

            {/* Quick-start tips */}
            {connectionStatus === 'failed' && (
              <div className="rounded-md bg-muted p-4 text-sm space-y-2">
                <p className="font-medium">Quick Start</p>
                {llmProvider === 'ollama' ? (
                  <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                    <li>
                      Install Ollama →{' '}
                      <a
                        href="https://ollama.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline text-primary"
                      >
                        ollama.com
                      </a>
                    </li>
                    <li>
                      Start the server: <code>ollama serve</code>
                    </li>
                    <li>
                      Pull any model: <code>ollama pull llama3.2</code>
                    </li>
                    <li>Click &quot;Connect&quot; above</li>
                  </ol>
                ) : (
                  <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                    <li>
                      Install LM Studio →{' '}
                      <a
                        href="https://lmstudio.ai"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline text-primary"
                      >
                        lmstudio.ai
                      </a>
                    </li>
                    <li>Open LM Studio and download a model</li>
                    <li>
                      Start the local server: <code>Developer → Start Server</code> (port 1234)
                    </li>
                    <li>Enable CORS: <code>Settings → Developer → Enable CORS</code></li>
                    <li>Click &quot;Connect&quot; above</li>
                  </ol>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ─── Currency ─── */}
        <Card>
          <CardHeader>
            <CardTitle>Currency</CardTitle>
            <CardDescription>
              Select your preferred display currency (AI also auto-detects from
              statements)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Select
                value={currency.code}
                onValueChange={(code) => {
                  const sel = availableCurrencies.find((c) => c.code === code);
                  if (sel) setCurrency(sel);
                }}
              >
                <SelectTrigger id="currency">
                  <SelectValue>
                    {currency.symbol} {currency.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {availableCurrencies.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.symbol} {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* ─── Data Management ─── */}
        <Card>
          <CardHeader>
            <CardTitle>Data Management</CardTitle>
            <CardDescription>Manage your transaction data</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
              <div>
                <p className="font-medium">Transactions Loaded</p>
                <p className="text-sm text-muted-foreground">
                  {transactions.length} transactions in storage
                </p>
              </div>
            </div>

            <Button
              variant="destructive"
              onClick={handleClearData}
              className="w-full"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Clear All Data
            </Button>

            <p className="text-xs text-muted-foreground">
              All data is stored locally in your browser&apos;s localStorage (unencrypted).
              Clearing removes transactions, budgets, and chat history.
              For your privacy, clear data before using on shared computers.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
