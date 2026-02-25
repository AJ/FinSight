'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSettingsStore } from '@/lib/store/settingsStore';
import { checkLLMStatus } from '@/lib/parsers/llmParser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Plug,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface AIConnectionBarProps {
  /** Called whenever connection status or model changes */
  onStatusChange?: (connected: boolean, model: string | null) => void;
}

export function AIConnectionBar({ onStatusChange }: AIConnectionBarProps) {
  const llmProvider = useSettingsStore((s) => s.llmProvider);
  const ollamaUrl = useSettingsStore((s) => s.ollamaUrl);
  const llmModel = useSettingsStore((s) => s.llmModel);
  const setLLMProvider = useSettingsStore((s) => s.setLLMProvider);
  const setOllamaUrl = useSettingsStore((s) => s.setOllamaUrl);
  const setLLMModel = useSettingsStore((s) => s.setLLMModel);

  const [urlInput, setUrlInput] = useState(ollamaUrl);
  const [models, setModels] = useState<string[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connected' | 'failed'>('idle');
  const [expanded, setExpanded] = useState(false);

  const connect = useCallback(
    async (url: string, silent = false) => {
      if (!silent) setIsConnecting(true);

      try {
        const res = await checkLLMStatus(url, llmProvider);
        if (res.connected) {
          setStatus('connected');
          setModels(res.models);
          setOllamaUrl(url);

          if (res.models.length > 0 && (!llmModel || !res.models.includes(llmModel))) {
            setLLMModel(res.models[0]);
          }
          onStatusChange?.(true, llmModel || res.models[0] || null);
        } else {
          setStatus('failed');
          setModels([]);
          onStatusChange?.(false, null);
        }
      } catch {
        setStatus('failed');
        setModels([]);
        onStatusChange?.(false, null);
      } finally {
        setIsConnecting(false);
      }
    },
    [llmModel, llmProvider, setOllamaUrl, setLLMModel, onStatusChange]
  );

  // Auto-connect on mount
  useEffect(() => {
    connect(ollamaUrl, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Connected: compact bar ──
  if (status === 'connected' && !expanded) {
    return (
      <div className="flex items-center justify-center gap-2 flex-wrap">
        <Badge className="gap-1.5 px-3 py-1.5 text-xs bg-green-50 text-green-700 border-green-200">
          <CheckCircle2 className="w-3 h-3" />
          AI Connected
        </Badge>

        {models.length > 0 && (
          <Select
            value={llmModel || ''}
            onValueChange={(v) => {
              setLLMModel(v);
              onStatusChange?.(true, v);
            }}
          >
            <SelectTrigger className="w-auto h-8 text-xs gap-1.5 px-3">
              <Sparkles className="w-3 h-3 shrink-0" />
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs text-muted-foreground px-2"
          onClick={() => setExpanded(true)}
        >
          <ChevronDown className="w-3 h-3" />
        </Button>
      </div>
    );
  }

  // ── Expanded / disconnected: full bar ──
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="w-4 h-4 text-primary" />
          AI Connection
        </div>
        <div className="flex items-center gap-2">
          {status === 'connected' && (
            <Badge className="bg-green-100 text-green-800 border-green-300 text-xs">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Connected
            </Badge>
          )}
          {status === 'failed' && (
            <Badge variant="destructive" className="text-xs">
              <XCircle className="w-3 h-3 mr-1" />
              Failed
            </Badge>
          )}
          {status === 'connected' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => setExpanded(false)}
            >
              <ChevronUp className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Provider selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground shrink-0">Provider:</span>
        <Select
          value={llmProvider}
          onValueChange={(v) => {
            const newProvider = v as 'ollama' | 'lmstudio';
            setLLMProvider(newProvider);
            const newUrl = newProvider === 'lmstudio' ? 'http://localhost:1234' : 'http://localhost:11434';
            setUrlInput(newUrl);
            setStatus('idle');
            setModels([]);
          }}
        >
          <SelectTrigger className="h-8 text-xs w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ollama">Ollama</SelectItem>
            <SelectItem value="lmstudio">LM Studio</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* URL + Connect */}
      <div className="flex gap-2">
        <Input
          placeholder={llmProvider === 'lmstudio' ? 'http://localhost:1234' : 'http://localhost:11434'}
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          className="font-mono text-sm h-9"
        />
        <Button
          size="sm"
          className="h-9"
          onClick={() => connect(urlInput)}
          disabled={isConnecting || !urlInput.trim()}
        >
          {isConnecting ? (
            <Loader2 className="w-4 h-4 animate-spin mr-1" />
          ) : (
            <Plug className="w-4 h-4 mr-1" />
          )}
          Connect
        </Button>
      </div>

      {/* Model selector (after connected) */}
      {models.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0">Model:</span>
          <Select
            value={llmModel || ''}
            onValueChange={(v) => {
              setLLMModel(v);
              onStatusChange?.(true, v);
            }}
          >
            <SelectTrigger className="h-8 text-xs">
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
        </div>
      )}

      {/* Help when disconnected */}
      {status === 'failed' && (
        <div className="text-xs text-muted-foreground space-y-2 pt-1">
          <p className="font-medium text-foreground">Quick Setup:</p>
          {llmProvider === 'ollama' ? (
            <ol className="list-decimal list-inside space-y-1">
              <li>
                Install{' '}
                <a href="https://ollama.com" target="_blank" rel="noopener noreferrer" className="underline text-primary">
                  Ollama
                </a>
              </li>
              <li>
                Open Terminal and run:
                <div className="mt-1 space-y-1">
                  <code className="block bg-muted px-2 py-1 rounded text-[11px]">ollama pull llama3.2</code>
                  <code className="block bg-muted px-2 py-1 rounded text-[11px]">OLLAMA_ORIGINS=&quot;*&quot; ollama serve</code>
                </div>
              </li>
              <li>Click <strong>Connect</strong> above</li>
            </ol>
          ) : (
            <ol className="list-decimal list-inside space-y-1">
              <li>
                Install{' '}
                <a href="https://lmstudio.ai" target="_blank" rel="noopener noreferrer" className="underline text-primary">
                  LM Studio
                </a>
              </li>
              <li>Download a model and start the local server (port 1234)</li>
              <li>Enable CORS: Settings → Developer → Enable CORS</li>
              <li>Click <strong>Connect</strong> above</li>
            </ol>
          )}
          {llmProvider === 'ollama' && (
            <p className="text-[11px] opacity-70">
              The <code>OLLAMA_ORIGINS</code> flag allows your browser to connect to the local AI. On Mac, run{' '}
              <code>launchctl setenv OLLAMA_ORIGINS &quot;*&quot;</code> to make it permanent.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
