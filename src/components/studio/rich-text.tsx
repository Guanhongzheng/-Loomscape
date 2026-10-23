'use client';

import { Fragment } from 'react';
import { cn } from '@/lib/cn';

/**
 * Deliberately small formatter: headings, ordered lists and paragraphs are
 * enough for the drafts this workbench produces, and it renders safely while
 * tokens are still arriving.
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  const lines = text.split('\n');

  return (
    <div className={cn('space-y-3 text-[13.5px] leading-[1.95] text-ink/85', className)}>
      {lines.map((line, index) => {
        const trimmed = line.trim();

        if (!trimmed) return <Fragment key={index} />;

        if (trimmed.startsWith('## ')) {
          return (
            <h3
              key={index}
              className="pt-2 font-serif text-[15px] tracking-wide text-ink first:pt-0"
            >
              {trimmed.slice(3)}
            </h3>
          );
        }

        if (/^\d+\.\s/.test(trimmed)) {
          return (
            <div key={index} className="flex gap-2.5 text-[13px] text-ink/75">
              <span className="font-mono text-[10px] text-muted/70">{trimmed.split('.')[0]}</span>
              <span>{trimmed.replace(/^\d+\.\s/, '')}</span>
            </div>
          );
        }

        if (trimmed.startsWith('- ')) {
          return (
            <div key={index} className="flex gap-2.5 text-[13px] text-ink/75">
              <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[rgb(var(--copper))]/70" />
              <span>{trimmed.slice(2)}</span>
            </div>
          );
        }

        return (
          <p key={index} className="text-pretty">
            {trimmed}
          </p>
        );
      })}
    </div>
  );
}
