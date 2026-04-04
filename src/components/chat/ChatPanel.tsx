'use client';

import {
  useRef,
  useEffect,
  useState,
  useCallback,
  type FormEvent,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { MarkdownRenderer } from '@/components/chat/MarkdownRenderer';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { useChatStore } from '@/lib/store/chatStore';
import { useSettingsStore } from '@/lib/store/settingsStore';
import { useTransactionStore } from '@/lib/store/transactionStore';
import { buildChatContextForQuestion } from '@/lib/chat/contextBuilder';
import { buildChatOptimizationPlan } from '@/lib/llm/chatOptimization';
import { ChatMessage } from '@/types';
import { AbortManager } from '@/lib/utils/AbortManager';
import {
  Bot,
  Send,
  Trash2,
  Sparkles,
  User,
  ArrowDown,
  Square,
} from 'lucide-react';
import { getBrowserClient } from '@/lib/llm/index';
import { debugError } from '@/lib/utils/debug';

const messageVariants = {
  hidden: (isUser: boolean) => ({
    opacity: 0,
    x: isUser ? 20 : -20,
    y: 8,
    scale: 0.95,
  }),
  visible: {
    opacity: 1,
    x: 0,
    y: 0,
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 350, damping: 30 },
  },
};

const suggestVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.15 + i * 0.08, type: 'spring' as const, stiffness: 300, damping: 24 },
  }),
};

const SUGGESTIONS = [
  'What was my highest expense?',
  'Summarise my spending',
  'How much did I earn vs spend?',
];

export function ChatPanel() {
  const {
    messages,
    selectedModel: chatModel,
    addMessage,
    updateMessage,
    clearMessages,
  } = useChatStore();

  const llmProvider = useSettingsStore((state) => state.llmProvider);
  const llmServerUrl = useSettingsStore((state) => state.llmServerUrl);
  const settingsModel = useSettingsStore((state) => state.llmModel);
  const currency = useSettingsStore((state) => state.currency);
  const transactions = useTransactionStore((state) => state.transactions);
  const activeModel = settingsModel || chatModel;

  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeStreamControllerRef = useRef<AbortManager>(new AbortManager());

  /* ------------------------------------------------------------------ */
  /*  Auto-scroll                                                       */
  /* ------------------------------------------------------------------ */

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    bottomAnchorRef.current?.scrollIntoView({ behavior, block: 'end' });
  }, []);

  // Scroll on new message or content update
  useEffect(() => {
    scrollToBottom('smooth');
  }, [messages, scrollToBottom]);

  // Detect if user has scrolled up
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distFromBottom > 120);
  }, []);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => {
      activeStreamControllerRef.current.abortAll('Component unmounted');
    };
  }, []);

  /* ------------------------------------------------------------------ */
  /*  Send                                                              */
  /* ------------------------------------------------------------------ */

  const handleSend = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      const text = input.trim();
      if (!text || isStreaming) return;

      setInput('');
      inputRef.current?.focus();

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
        timestamp: new Date().toISOString(),
      };
      addMessage(userMsg);

      const assistantId = crypto.randomUUID();
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
      };
      addMessage(assistantMsg);

      setIsStreaming(true);
      const streamController = new AbortController();
      activeStreamControllerRef.current.signal(); // Register with manager
      let streamedContent = '';

      try {
        const client = getBrowserClient(llmProvider);

        // Resolve model
        let selectedModel = activeModel ?? undefined;
        if (!selectedModel) {
          const models = await client.listModels(llmServerUrl);
          selectedModel = models[0];
        }
        if (!selectedModel) {
          updateMessage(
            assistantId,
            '⚠️ No AI model available. Pull a model in Ollama first.'
          );
          return;
        }

        const optimizationPlan = buildChatOptimizationPlan(llmProvider, text, messages);

        // Build messages for LLM
        const statementContext = buildChatContextForQuestion(transactions, currency, text, {
          topK: optimizationPlan.contextTopK,
          maxChars: optimizationPlan.contextMaxChars,
        });

        const systemPrompt = `You are a helpful financial assistant. You have access to the user's bank statement data below. Answer questions accurately and concisely.

${statementContext || 'No statement data available yet.'}

Guidelines:
- Use ONLY the provided statement context for factual answers. Do not invent or assume missing transactions, balances, merchants, categories, or dates.
- Be concise and precise with numbers.
- Format currency amounts properly.
- If asked for calculations, show your work briefly.
- If the data doesn't contain enough info, say so clearly.
- When answering with amounts, trends, counts, or conclusions, mention the relevant transaction dates and/or transactions you used.
- The relevant transactions section is sampled and not exhaustive. If the sampled context is not enough to support a confident answer, say that explicitly.`;

        const chatMessages = [
          { role: 'system', content: systemPrompt },
          ...messages.slice(-optimizationPlan.historyWindow).map((m) => ({
            role: m.role,
            content: m.content,
          })),
          { role: 'user', content: text },
        ];

        // Stream directly from browser → LLM
        const stream = await client.chatStream(llmServerUrl, selectedModel, chatMessages, {
          ...optimizationPlan.requestOptions,
          signal: streamController.signal,
        });
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          if (llmProvider === 'lmstudio') {
            // LM Studio uses SSE format: process complete events and keep partials buffered.
            const events = buffer.split('\n\n');
            buffer = events.pop() ?? '';

            for (const event of events) {
              const lines = event.split('\n').filter((l) => l.trim());
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) continue;
                const data = trimmed.slice(5).trimStart();
                if (data === '[DONE]') continue;

                try {
                  const parsed = JSON.parse(data);
                  const content = parsed.choices?.[0]?.delta?.content;
                  if (content) {
                    streamedContent += content;
                    updateMessage(assistantId, streamedContent);
                  }
                } catch {
                  /* skip malformed lines */
                }
              }
            }
          } else {
            // Ollama uses NDJSON format: process complete lines and keep partial line buffered.
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const parsed = JSON.parse(line);
                if (parsed.message?.content) {
                  streamedContent += parsed.message.content;
                  updateMessage(assistantId, streamedContent);
                }
              } catch {
                /* skip malformed lines */
              }
            }
          }
        }

        // Flush any remaining buffered frame at end-of-stream.
        if (buffer.trim()) {
          if (llmProvider === 'lmstudio') {
            const lines = buffer.split('\n').filter((l) => l.trim());
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const data = trimmed.slice(5).trimStart();
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  streamedContent += content;
                  updateMessage(assistantId, streamedContent);
                }
              } catch {
                /* skip malformed lines */
              }
            }
          } else {
            try {
              const parsed = JSON.parse(buffer.trim());
              if (parsed.message?.content) {
                streamedContent += parsed.message.content;
                updateMessage(assistantId, streamedContent);
              }
            } catch {
              /* skip malformed trailing frame */
            }
          }
        }

        if (!streamedContent) {
          updateMessage(
            assistantId,
            "I couldn't generate a response. Please try rephrasing your question."
          );
        }
      } catch (err) {
        if (streamController.signal.aborted) {
          if (!streamedContent) {
            updateMessage(
              assistantId,
              'Response stopped.'
            );
          }
          return;
        }
        debugError('Chat', err);
        updateMessage(
          assistantId,
          err instanceof Error && err.message.toLowerCase().includes('timed out')
            ? '⚠️ Request timed out — the model took too long to respond.'
            : '⚠️ Connection error — check that your LLM is running and try again.'
        );
      } finally {
        if (streamController.signal.aborted) {
          return;
        }
        activeStreamControllerRef.current.abortAll();
        setIsStreaming(false);
        inputRef.current?.focus();
      }
    },
    [
      input,
      isStreaming,
      messages,
      transactions,
      currency,
      activeModel,
      llmServerUrl,
      llmProvider,
      addMessage,
      updateMessage,
    ]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStopStreaming = useCallback(() => {
    activeStreamControllerRef.current.abortAll('User clicked stop');
  }, []);

  const hasContext = transactions.length > 0;

  /* ------------------------------------------------------------------ */
  /*  Render                                                            */
  /* ------------------------------------------------------------------ */

  return (
    <div className="flex flex-col h-full">
      {/* Context banner */}
      {!hasContext && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-4 py-3 bg-warning/10 border-b text-sm text-warning-foreground flex items-center gap-2"
        >
          <Sparkles className="w-4 h-4 text-warning shrink-0" />
          <span>
            No statement loaded — upload &amp; confirm a statement first, then come
            back here to chat.
          </span>
        </motion.div>
      )}

      {/* Messages area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto scroll-smooth px-3 sm:px-4 py-6 chat-scrollbar"
      >
        {/* Empty state */}
        {messages.length === 0 && hasContext && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
            className="flex flex-col items-center justify-center gap-3 py-12 sm:py-16 text-center text-muted-foreground"
          >
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
              <Bot className="w-8 h-8 text-primary" />
            </div>
            <p className="text-lg font-semibold text-foreground">
              Ask me anything about your statement
            </p>
            <p className="text-sm max-w-md leading-relaxed">
              I can help with spending summaries, category breakdowns, highest/lowest
              transactions, monthly trends, and more.
            </p>
            <div className="flex flex-wrap justify-center gap-2 mt-4 max-w-lg">
              {SUGGESTIONS.map((q, i) => (
                <motion.div key={q} custom={i} variants={suggestVariants} initial="hidden" animate="visible">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs sm:text-sm h-auto py-2 px-3 whitespace-normal text-left hover:bg-primary/5 hover:border-primary/30 transition-all"
                    onClick={() => {
                      setInput(q);
                      setTimeout(() => handleSend(), 50);
                    }}
                  >
                    <Sparkles className="w-3 h-3 mr-1.5 shrink-0 text-primary/60" />
                    {q}
                  </Button>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Message list */}
        <div className="space-y-4 max-w-3xl mx-auto">
          <AnimatePresence initial={false}>
            {messages.map((msg) => {
              const isUser = msg.role === 'user';
              const isEmpty = !msg.content;

              return (
                <motion.div
                  key={msg.id}
                  custom={isUser}
                  variants={messageVariants}
                  initial="hidden"
                  animate="visible"
                  layout
                  className={`flex gap-2 sm:gap-3 ${
                    isUser ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {/* Bot avatar */}
                  {!isUser && (
                    <div className="shrink-0 w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center ring-1 ring-primary/10 mt-0.5">
                      <Bot className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-primary" />
                    </div>
                  )}

                  {/* Message bubble */}
                  <div
                    className={`relative max-w-[85%] sm:max-w-[80%] rounded-2xl px-3.5 py-2.5 sm:px-4 sm:py-3 text-sm leading-relaxed shadow-xs ${
                      isUser
                        ? 'bg-primary text-primary-foreground rounded-br-md'
                        : 'bg-muted/70 text-foreground rounded-bl-md border border-border/40'
                    }`}
                  >
                    {isEmpty ? (
                      <TypingIndicator modelName={activeModel} />
                    ) : isUser ? (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    ) : (
                      <MarkdownRenderer content={msg.content} />
                    )}

                    {/* Timestamp */}
                    <div
                      className={`text-[10px] mt-1.5 opacity-50 ${
                        isUser ? 'text-right' : 'text-left'
                      }`}
                    >
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>

                  {/* User avatar */}
                  {isUser && (
                    <div className="shrink-0 w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gradient-to-br from-secondary to-secondary/60 flex items-center justify-center ring-1 ring-border/30 mt-0.5">
                      <User className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>

          {/* Bottom anchor for auto-scroll */}
          <div ref={bottomAnchorRef} className="h-1" />
        </div>
      </div>

      {/* Scroll-to-bottom FAB */}
      <AnimatePresence>
        {showScrollBtn && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="absolute bottom-32 left-1/2 -translate-x-1/2 z-10"
          >
            <Button
              variant="secondary"
              size="icon"
              className="rounded-full shadow-lg h-9 w-9 border border-border/50"
              onClick={() => scrollToBottom('smooth')}
            >
              <ArrowDown className="w-4 h-4" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <Separator />

      {/* Input area */}
      <div className="shrink-0 px-3 sm:px-4 py-3 bg-background/80 backdrop-blur-sm">
        <form
          onSubmit={handleSend}
          className="flex items-end gap-2 max-w-3xl mx-auto"
        >
          <Textarea
            ref={inputRef}
            placeholder={
              hasContext
                ? 'Ask about your statement…'
                : 'Upload a statement first…'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!hasContext || isStreaming}
            rows={1}
            className="resize-none min-h-[44px] max-h-[120px] rounded-xl text-sm"
          />
          <Button
            type={isStreaming ? 'button' : 'submit'}
            size="icon"
            disabled={(!input.trim() && !isStreaming) || !hasContext}
            className="rounded-xl shrink-0 h-[44px] w-[44px] transition-all"
            onClick={isStreaming ? handleStopStreaming : undefined}
          >
            {isStreaming ? (
              <Square className="w-4 h-4" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </form>

        <div className="flex items-center justify-center gap-3 mt-2 flex-wrap">
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearMessages}
              className="text-xs text-muted-foreground h-7"
            >
              <Trash2 className="w-3 h-3 mr-1" />
              Clear chat
            </Button>
          )}

          {activeModel && (
            <Badge variant="secondary" className="text-[10px] font-normal h-5">
              {activeModel}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
