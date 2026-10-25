'use client';

import { cn } from '@/lib/cn';
import { useEndpoints, channelReady } from '@/lib/endpoint-store';
import type { Channel } from '@/lib/providers';

export function WorkbenchHeader({
  index,
  title,
  description,
  actions,
}: {
  index: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-5">
      <div>
        <div className="flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.3em] text-muted/70">
          <span>{index}</span>
          <span className="h-px w-6 bg-[rgb(var(--line))]" />
          <span>workbench</span>
        </div>
        <h1 className="mt-3 font-serif text-[26px] leading-tight tracking-[0.01em] text-ink">{title}</h1>
        <p className="mt-2 max-w-[62ch] text-[12.5px] leading-relaxed text-muted">{description}</p>
      </div>
      {actions ? <div className="mt-1 flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({
  id,
  title,
  hint,
  action,
  children,
  className,
  bodyClassName,
}: {
  id?: string;
  title?: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section id={id} className={cn('neu rounded-2xl', className)}>
      {title ? (
        <header className="flex items-center justify-between gap-3 border-b border-[rgb(var(--line))]/55 px-5 py-3.5">
          <div>
            <h2 className="text-[12.5px] font-medium tracking-wide text-ink/85">{title}</h2>
            {hint ? <p className="mt-1 text-[11px] text-muted/75">{hint}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      <div className={cn('p-4 md:p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

export function ChannelBadge({ channel, className }: { channel: Channel; className?: string }) {
  const endpoints = useEndpoints((state) => state.endpoints);
  const health = useEndpoints((state) => state.health);
  const ready = channelReady({ endpoints, health }, channel);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] tracking-wide',
        ready ? 'text-[#3f6b4f]' : 'text-muted',
        'shadow-[var(--shadow-inset-sm)]',
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', ready ? 'bg-[#4d7a5c]' : 'bg-[rgb(var(--copper))]')} />
      {ready ? '已连接' : '离线草稿'}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl px-6 py-14 text-center shadow-[var(--shadow-inset-sm)]">
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-6 w-[3px] rounded-full bg-[rgb(var(--line))]"
            style={{ opacity: 0.55 + i * 0.15 }}
          />
        ))}
      </div>
      <h3 className="mt-5 font-serif text-[17px] text-ink/85">{title}</h3>
      <p className="mt-2 max-w-[42ch] text-[12px] leading-relaxed text-muted">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
