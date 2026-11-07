'use client';

import { cn } from '@/lib/cn';
import { useEndpoints, channelReady, needsVaultUnlock } from '@/lib/endpoint-store';
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
    <div className="mb-9 flex flex-wrap items-start justify-between gap-5 md:mb-10">
      <div>
        <div className="flex items-center gap-2.5 font-mono text-[10.5px] uppercase tracking-[0.3em] text-muted/75">
          <span>{index}</span>
          <span className="h-px w-7 bg-[rgb(var(--line))]" />
          <span>workbench</span>
        </div>
        <h1 className="mt-3 font-serif text-[30px] leading-tight tracking-[0.01em] text-ink md:text-[34px]">
          {title}
        </h1>
        <p className="mt-2.5 max-w-[68ch] text-[13.5px] leading-relaxed text-muted">{description}</p>
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
      <span className={cn('h-1.5 w-1.5 rounded-full', ready ? 'bg-[#4d7a5c]' : 'bg-[rgb(var(--copper))]')} />
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
