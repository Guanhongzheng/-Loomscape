'use client';

import { useEffect } from 'react';
import { cn } from '@/lib/cn';
import { useEndpoints, channelReady, needsVaultUnlock } from '@/lib/endpoint-store';
import { useStudioTitle } from '@/lib/studio-title';
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
  const setStudioTitle = useStudioTitle((state) => state.setTitle);

  useEffect(() => {
    setStudioTitle(title);
    return () => setStudioTitle('');
  }, [setStudioTitle, title]);

  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-4 md:mb-5">
      <div>
        <div className="flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.3em] text-muted/70">
          <span>{index}</span>
          <span className="h-px w-6 bg-[rgb(var(--line))]" />
          <span>workbench</span>
        </div>
        <h1 className="sr-only">{title}</h1>
        <p className="mt-1.5 max-w-[78ch] text-[12px] leading-relaxed text-muted">{description}</p>
      </div>
      {actions ? <div className="mt-0.5 flex items-center gap-2">{actions}</div> : null}
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
        <header className="flex items-center justify-between gap-3 border-b border-[rgb(var(--line))]/70 px-5 py-4 md:px-6">
          <div>
            <h2 className="text-[14px] font-medium tracking-wide text-ink">{title}</h2>
            {hint ? <p className="mt-1 text-[11.5px] leading-relaxed text-muted/80">{hint}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      <div className={cn('p-5 md:p-6', bodyClassName)}>{children}</div>
    </section>
  );
}

export function ChannelBadge({ channel, className }: { channel: Channel; className?: string }) {
  const endpoints = useEndpoints((state) => state.endpoints);
  const health = useEndpoints((state) => state.health);
  const ready = channelReady({ endpoints, health }, channel);
  const locked = needsVaultUnlock({ endpoints, health }, channel);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--line))]/70 px-2.5 py-1 text-[11px] tracking-wide',
        ready ? 'text-[#3f6b4f]' : 'text-muted',
        'shadow-[var(--shadow-inset-sm)]',
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', ready ? 'bg-[rgb(var(--accent))]' : 'bg-[rgb(var(--copper))]')} />
      {ready ? '已连接' : locked ? '待解锁' : '离线草稿'}
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
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/70 bg-white/30 px-6 py-10 text-center backdrop-blur-md">
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-6 w-[3px] rounded-full bg-[rgb(var(--copper))]/45"
            style={{ opacity: 0.55 + i * 0.15 }}
          />
        ))}
      </div>
      <h3 className="mt-4 font-serif text-[18px] text-ink/90">{title}</h3>
      <p className="mt-2 max-w-[42ch] text-[12.5px] leading-relaxed text-muted">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
