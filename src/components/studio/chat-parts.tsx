'use client';

import type { Message } from 'ai';

/** Flattens both v5 `parts` and legacy `content` into displayable text. */
export function textOf(message: Message): string {
  const fromParts = (message.parts ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => (part as { text: string }).text)
    .join('');
  return fromParts || message.content || '';
}

export function ToolBadges({ message }: { message: Message }) {
  const calls = (message.parts ?? []).filter((part) => part.type === 'tool-invocation');
  if (!calls.length) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {calls.map((part) => {
        const invocation = (
          part as { toolInvocation: { toolCallId: string; toolName: string; state: string } }
        ).toolInvocation;
        return (
          <span
            key={invocation.toolCallId}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[9.5px] tracking-wide text-muted shadow-[var(--shadow-inset-sm)]"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--copper))]/70" />
            {invocation.toolName}
            <span className="text-muted/60">
              {invocation.state === 'result' ? 'done' : 'running'}
            </span>
          </span>
        );
      })}
    </div>
  );
}
