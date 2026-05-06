'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, Plug, Cpu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LLMProvider, DEFAULT_URLS, ModelInfo } from '@/lib/llm/types';
import { useSettingsStore } from '@/lib/store/settingsStore';
import { checkLLMConnection } from '@/lib/store/llmConnectionStore';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'failed';

interface OnboardingStep1Props {
  onComplete: (provider: LLMProvider, serverUrl: string, models: string[], modelInfos: ModelInfo[]) => void;
  initialProvider: LLMProvider | null;
  initialUrl: string;
  initialConnectionStatus: ConnectionStatus;
  initialModels: string[];
  initialError: string | null;
  onConnectionStatusChange: (status: ConnectionStatus) => void;
  onModelsChange: (models: string[]) => void;
  onErrorChange: (error: string | null) => void;
}

export function OnboardingStep1({
  onComplete,
  initialProvider,
  initialUrl,
  initialConnectionStatus,
  initialModels,
  initialError,
  onConnectionStatusChange,
  onModelsChange,
  onErrorChange,
}: OnboardingStep1Props) {
  const [selectedProvider, setSelectedProvider] = useState<LLMProvider | null>(initialProvider);
  const [serverUrl, setServerUrl] = useState(initialUrl);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(initialConnectionStatus);
  const [models, setModels] = useState<string[]>(initialModels);
  const [modelInfos, setModelInfos] = useState<ModelInfo[]>([]);
  const [error, setError] = useState<string | null>(initialError);

  const setLLMProvider = useSettingsStore((state) => state.setLLMProvider);
  const setLLMServerUrl = useSettingsStore((state) => state.setLLMServerUrl);

  const testConnection = useCallback(async (url: string) => {
    if (!selectedProvider || !url) return;

    setConnectionStatus('connecting');
    onErrorChange(null);

    // Update settings
    setLLMProvider(selectedProvider);
    setLLMServerUrl(url);

    try {
      const status = await checkLLMConnection();

      if (status.connected) {
        setConnectionStatus('connected');
        const modelIds = status.models.map(m => m.id);
        setModels(modelIds);
        setModelInfos(status.models);
        onModelsChange(modelIds);
        onErrorChange(null);
        setError(null); // Clear local error on success

        // Store context length of first model if available
        if (status.models[0]?.contextLength) {
          useSettingsStore.getState().setModelContextLength(status.models[0].contextLength);
        }
      } else {
        setConnectionStatus('failed');
        const providerName = selectedProvider === 'ollama' ? 'Ollama' : 'LM Studio';
        let msg = '';

        // Check if we get models back (server running but no models loaded)
        if (status.models && status.models.length > 0) {
          msg = `Connected to ${providerName}, but no models are loaded. Please load a model and try again.`;
        } else {
          // Could be server starting up or not running at all
          msg = `Cannot reach ${providerName}. Make sure it is running and the server has fully started.`;
        }

        setError(msg);
        onErrorChange(msg);
      }
    } catch (err) {
      setConnectionStatus('failed');
      const msg = err instanceof Error ? err.message : 'Connection failed. Please check your settings and try again.';
      setError(msg);
      onErrorChange(msg);
    }
  }, [selectedProvider, setLLMProvider, setLLMServerUrl, onModelsChange, onErrorChange]);

  const handleProviderSelect = useCallback((provider: LLMProvider) => {
    setSelectedProvider(provider);
    const defaultUrl = DEFAULT_URLS[provider];
    setServerUrl(defaultUrl);
    setConnectionStatus('disconnected');
    setModels([]);
    setError(null);
    onModelsChange([]);
    onErrorChange(null);
    onConnectionStatusChange('disconnected');
  }, [onModelsChange, onErrorChange, onConnectionStatusChange]);

  const handleContinue = useCallback(() => {
    if (connectionStatus === 'connected' && selectedProvider) {
      onComplete(selectedProvider, serverUrl, models, modelInfos);
    }
  }, [connectionStatus, models, onComplete, selectedProvider, serverUrl]);

  const canContinue = connectionStatus === 'connected' && selectedProvider !== null;

  const handleUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setServerUrl(e.target.value);
    // Reset connection status when URL changes
    if (connectionStatus !== 'disconnected') {
      setConnectionStatus('disconnected');
      setModels([]);
      setError(null);
      onModelsChange([]);
      onErrorChange(null);
      onConnectionStatusChange('disconnected');
    }
  }, [connectionStatus, onModelsChange, onErrorChange, onConnectionStatusChange]);

  const handleTest = useCallback(() => {
    testConnection(serverUrl);
  }, [serverUrl, testConnection]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleTest();
    }
  }, [handleTest]);

  return (
    <div className="space-y-6">
      {/* Provider Selection */}
      <div className="grid grid-cols-2 gap-4">
        <Card
          className={cn(
            'cursor-pointer transition-all duration-200',
            selectedProvider === 'ollama'
              ? 'border-primary bg-primary/5'
              : 'hover:border-primary/50'
          )}
          onClick={() => handleProviderSelect('ollama')}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Plug className="w-5 h-5 text-primary" />
              <CardTitle className="text-lg">Ollama</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Free, open-source, runs locally
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedProvider === 'ollama' && (
              <Badge variant="default" className="mt-2">Selected</Badge>
            )}
          </CardContent>
        </Card>

        <Card
          className={cn(
            'cursor-pointer transition-all duration-200',
            selectedProvider === 'lmstudio'
              ? 'border-primary bg-primary/5'
              : 'hover:border-primary/50'
          )}
          onClick={() => handleProviderSelect('lmstudio')}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Cpu className="w-5 h-5 text-primary" />
              <CardTitle className="text-lg">LM Studio</CardTitle>
            </div>
            <CardDescription className="text-xs">
              User-friendly GUI, multiple models
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedProvider === 'lmstudio' && (
              <Badge variant="default" className="mt-2">Selected</Badge>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Server URL */}
      <div className="space-y-2">
        <Label htmlFor="serverUrl">Server URL</Label>
        <div className="flex gap-2">
          <Input
            id="serverUrl"
            value={serverUrl}
            onChange={handleUrlChange}
            onKeyDown={handleKeyDown}
            placeholder="http://localhost:11434"
            className="flex-1"
            disabled={!selectedProvider}
            title={!selectedProvider ? 'Select a provider first' : undefined}
          />
          <Button
            onClick={handleTest}
            variant="outline"
            size="sm"
            disabled={!selectedProvider || !serverUrl || connectionStatus === 'connecting'}
            title={!selectedProvider ? 'Select a provider first' : undefined}
          >
            {connectionStatus === 'connecting' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : connectionStatus === 'connected' ? (
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            ) : connectionStatus === 'failed' ? (
              <>
                <XCircle className="w-4 h-4 text-red-500" />
                Retry
              </>
            ) : (
              'Connect'
            )}
          </Button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {connectionStatus === 'connected' && models.length > 0 && (
          <p className="text-sm text-green-600">
            Connected! Found {models.length} model(s)
          </p>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-end pt-4">
        <Button onClick={handleContinue} disabled={!canContinue}>
          Continue
        </Button>
      </div>
    </div>
  );
}
