'use client';

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard,
  Receipt,
  Wallet,
  CreditCard,
  RefreshCw,
  MessageSquare,
  Settings,
  Upload,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useUpload } from './UploadContext';
import { checkLLMStatus } from '@/lib/parsers/llmParser';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/transactions', label: 'Transactions', icon: Receipt },
  { href: '/budget', label: 'Budget', icon: Wallet },
  { href: '/credit-cards', label: 'Credit Cards', icon: CreditCard },
  { href: '/subscriptions', label: 'Subscriptions', icon: RefreshCw },
  { href: '/chat', label: 'Chat', icon: MessageSquare },
];

const bottomItems = [
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [llmConnected, setLlmConnected] = useState<boolean | null>(null); // null = checking
  const pathname = usePathname();
  const router = useRouter();
  const { openUpload } = useUpload();

  // Check LLM connection on mount
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const status = await checkLLMStatus();
        setLlmConnected(status.connected);
      } catch {
        setLlmConnected(false);
      }
    };
    checkConnection();
  }, []);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <aside
      className={cn(
        'flex flex-col h-screen bg-card border-r border-border transition-all duration-300',
        collapsed ? 'w-16' : 'w-56'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between h-14 px-3 border-b border-border">
        {!collapsed && (
          <Image
            src="/primary-logo.svg"
            alt="FinSight"
            width={100}
            height={24}
            style={{ width: 'auto', height: '24px', paddingLeft: '10px' }}
            priority
          />
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!collapsed)}
          className="ml-auto"
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </Button>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 px-2 py-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          const isChat = item.href === '/chat';
          const showOfflineIndicator = isChat && llmConnected === false;

          return (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                active
                  ? 'bg-primary/20 text-primary'
                  : 'text-foreground hover:bg-muted',
                collapsed && 'justify-center px-0'
              )}
              title={collapsed ? item.label : showOfflineIndicator ? 'AI is offline — check Settings' : undefined}
            >
              <div className="relative">
                <Icon className="w-5 h-5 flex-shrink-0" />
                {showOfflineIndicator && (
                  <span
                    className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full ring-2 ring-card"
                    title={!collapsed ? 'AI is offline — check Settings' : undefined}
                  />
                )}
              </div>
              {!collapsed && (
                <span className="truncate flex-1 text-left">{item.label}</span>
              )}
              {!collapsed && showOfflineIndicator && (
                <span className="text-[10px] text-red-500 font-medium">Offline</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom Section - Upload & Settings */}
      <div className="px-2 py-2 space-y-1">
        {/* Upload Button */}
        <button
          onClick={openUpload}
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
            'text-primary border border-primary/30 hover:bg-primary/10',
            collapsed && 'justify-center px-0'
          )}
          title={collapsed ? 'Upload' : undefined}
        >
          <Upload className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span className="truncate">Upload</span>}
        </button>
      </div>

      {/* Settings with top border */}
      <div className="px-2 py-2 border-t border-border space-y-1">
        {bottomItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                active
                  ? 'bg-primary/20 text-primary'
                  : 'text-foreground hover:bg-muted',
                collapsed && 'justify-center px-0'
              )}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
