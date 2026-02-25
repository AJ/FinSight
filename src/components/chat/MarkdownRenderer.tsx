'use client';

import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
  isUser?: boolean;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  isUser = false,
}: MarkdownRendererProps) {
  return (
    <div className={`chat-markdown ${isUser ? 'chat-markdown-user' : 'chat-markdown-assistant'}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Code blocks
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const isInline = !match && !className;

            if (isInline) {
              return (
                <code
                  className="px-1.5 py-0.5 rounded-[4px] bg-black/10 dark:bg-white/10 text-[0.85em] font-mono"
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <div className="my-2 rounded-lg overflow-hidden border border-border/50">
                {match && (
                  <div className="px-3 py-1.5 bg-muted/80 text-[11px] font-mono text-muted-foreground uppercase tracking-wide">
                    {match[1]}
                  </div>
                )}
                <pre className="p-3 overflow-x-auto bg-muted/40">
                  <code className={`text-[0.85em] font-mono ${className || ''}`} {...props}>
                    {children}
                  </code>
                </pre>
              </div>
            );
          },

          // Paragraphs
          p({ children }) {
            return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>;
          },

          // Lists
          ul({ children }) {
            return <ul className="mb-2 last:mb-0 pl-4 space-y-1 list-disc">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="mb-2 last:mb-0 pl-4 space-y-1 list-decimal">{children}</ol>;
          },
          li({ children }) {
            return <li className="leading-relaxed">{children}</li>;
          },

          // Headings
          h1({ children }) {
            return <h1 className="text-lg font-bold mb-2 mt-3 first:mt-0">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-sm font-bold mb-1.5 mt-2 first:mt-0">{children}</h3>;
          },

          // Blockquotes
          blockquote({ children }) {
            return (
              <blockquote className="border-l-2 border-primary/40 pl-3 my-2 italic text-muted-foreground">
                {children}
              </blockquote>
            );
          },

          // Tables
          table({ children }) {
            return (
              <div className="my-2 overflow-x-auto rounded-lg border border-border/50">
                <table className="w-full text-sm">{children}</table>
              </div>
            );
          },
          thead({ children }) {
            return <thead className="bg-muted/60">{children}</thead>;
          },
          th({ children }) {
            return (
              <th className="px-3 py-1.5 text-left font-semibold text-xs">{children}</th>
            );
          },
          td({ children }) {
            return <td className="px-3 py-1.5 border-t border-border/30">{children}</td>;
          },

          // Links
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:opacity-80 transition-opacity"
              >
                {children}
              </a>
            );
          },

          // Bold / Strong
          strong({ children }) {
            return <strong className="font-semibold">{children}</strong>;
          },

          // Horizontal rule
          hr() {
            return <hr className="my-3 border-border/50" />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
