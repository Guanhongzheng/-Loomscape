'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[loomscape]', error.message);
  }, [error]);

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[rgb(var(--paper))] px-6">
      <div className="max-w-md text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.36em] text-muted">interrupted</p>
        <h1 className="mt-4 font-serif text-[24px] text-ink">这一步没有走完</h1>
        <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
          页面在渲染时中断了。已经写入本地的作品不受影响，可以重试这一步。
        </p>
        <div className="mt-7 flex justify-center gap-2">
          <Button variant="primary" size="md" onClick={reset}>
            重试
          </Button>
          <Button variant="ghost" size="md" onClick={() => window.location.assign('/')}>
            回到首页
          </Button>
        </div>
      </div>
    </main>
  );
}
