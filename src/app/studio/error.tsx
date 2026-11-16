'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { RotateCcw } from 'lucide-react';

/**
 * The workbench renders inside the studio shell, so an uncaught error used to
 * unmount the page subtree and leave an empty white canvas next to the rail.
 * This boundary keeps the shell, names the failure and offers a retry.
 */
export default function StudioError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaced in the console so the dev log keeps the real cause.
    console.error('[studio] page failed to render', error);
  }, [error]);

  return (
    <div className="grid h-full place-items-center px-6 py-16">
      <div className="w-[min(92vw,420px)] rounded-2xl border border-white/60 bg-white/70 p-6 text-center backdrop-blur-xl">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted/70">
          page error
        </p>
        <h2 className="mt-3 text-[18px] font-semibold text-ink">这页没加载出来</h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
          {error.message ? error.message.slice(0, 120) : '页面渲染时出了点问题。'}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#232b45] px-4 text-[12px] text-white"
          >
            <RotateCcw size={13} />
            重试
          </button>
          <Link
            href="/studio"
            className="inline-flex h-9 items-center rounded-full border border-black/10 px-4 text-[12px] text-muted transition-colors hover:text-ink"
          >
            回到总览
          </Link>
        </div>
      </div>
    </div>
  );
}
