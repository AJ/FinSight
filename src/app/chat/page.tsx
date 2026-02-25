'use client';

import { ChatPanel } from '@/components/chat/ChatPanel';
import { MessageSquare, Sparkles } from 'lucide-react';

export default function ChatPage() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Page Header */}
      <div className="border-b border-border bg-card shrink-0">
        <div className="px-6 py-4 flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shrink-0">
            <MessageSquare className="w-3.5 h-3.5 text-primary" />
          </div>
          <h1 className="text-xl font-bold text-foreground">
            Chat with your Statement
          </h1>
          <div className="ml-auto hidden sm:flex items-center gap-1 text-xs text-muted-foreground">
            <Sparkles className="w-3 h-3" />
            AI Powered
          </div>
        </div>
      </div>

      {/* Chat panel fills remaining height */}
      <div className="flex-1 overflow-hidden relative">
        <ChatPanel />
      </div>
    </div>
  );
}
