'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Bot } from 'lucide-react';

interface TypingIndicatorProps {
  modelName?: string | null;
}

export function TypingIndicator({ modelName }: TypingIndicatorProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (s: number) => {
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Model badge + status */}
      <div className="flex items-center gap-2">
        <motion.div
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="flex items-center gap-1.5"
        >
          <Bot className="w-3 h-3 text-primary" />
          <span className="text-xs font-medium text-primary">
            {modelName || 'AI'}
          </span>
        </motion.div>
        <span className="text-[10px] text-muted-foreground">
          is thinking…
        </span>
      </div>

      {/* Animated dots */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-primary/60"
              animate={{ y: [0, -4, 0], opacity: [0.3, 1, 0.3] }}
              transition={{
                duration: 0.8,
                repeat: Infinity,
                delay: i * 0.15,
                ease: 'easeInOut',
              }}
            />
          ))}
        </div>
        {elapsed >= 3 && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-[10px] text-muted-foreground tabular-nums"
          >
            {formatTime(elapsed)}
          </motion.span>
        )}
      </div>
    </div>
  );
}
