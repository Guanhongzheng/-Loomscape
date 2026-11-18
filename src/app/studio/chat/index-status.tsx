'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { indexHealth, type IndexHealth } from '@/lib/memory';
import { useEmbeddingGate } from '@/lib/embedding-gate';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';

/**
 * "Can the library be searched right now?" — visible at all times, because a
 * stale index is otherwise only noticed when a citation goes missing. The
 * rebuild button stays available for the cases a model switch never covers:
 * an interrupted run, a legacy mix, or a model whose weights changed in place.
 */
export function IndexStatus({ refreshKey }: { refreshKey: number }) {
  const user = useAuth((state) => state.user);
  const owner = user?.id ?? 'local';
  const [health, setHealth] = useState<IndexHealth | null>(null);
  const [busy, setBusy] = useState(false);
  const open = useEmbeddingGate((state) => state.open);
  const phase = useEmbeddingGate((state) => state.phase);
  const requestRebuildManual = useEmbeddingGate((state) => state.requestRebuildManual);

  useEffect(() => {
    let alive = true;
    void indexHealth(owner)
      .then((next) => {
        if (alive) setHealth(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [owner, refreshKey, open, phase]);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const opened = await requestRebuildManual();
      if (!opened) toast('索引已一致，无需重建', 'info');
    } finally {
      setBusy(false);
    }
  };

  const pending = health?.pendingDocs ?? 0;
  const stale = pending > 0;

  return (
    <div className="mt-3 flex items-center justify-between gap-3 border-t border-[rgb(var(--line))]/60 pt-3">
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
        <span
          aria-hidden="true"
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            stale ? 'bg-[#B4453A]' : 'bg-[rgb(var(--accent))]',
          )}
        />
        <span className="truncate">
          {health
            ? stale
              ? `待重建 ${health.pendingDocs} 篇 · ${health.pendingChars.toLocaleString()} 字`
              : health.totalDocs === 0
                ? '暂无资料'
                : `索引正常 · ${health.totalDocs} 篇`
            : '检查索引…'}
        </span>
      </span>
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="shrink-0 text-[11px] text-muted underline-offset-2 transition-colors hover:text-ink hover:underline disabled:opacity-50"
      >
        {busy ? '检查…' : '重建索引'}
      </button>
    </div>
  );
}
