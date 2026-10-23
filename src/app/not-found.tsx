import Link from 'next/link';
import { Mark } from '@/components/brand';

export default function NotFound() {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[rgb(var(--paper))] px-6">
      <div className="text-center">
        <Mark className="mx-auto h-10 w-10 text-ink/70" />
        <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.36em] text-muted">404</p>
        <h1 className="mt-4 font-serif text-[26px] text-ink">这一页还没有被织出来</h1>
        <p className="mt-3 text-[12.5px] text-muted">链接可能已经移动，或者从来没存在过。</p>
        <Link
          href="/"
          className="mt-8 inline-flex h-11 items-center rounded-2xl bg-[rgb(var(--accent))] px-6 text-[13px] text-[rgb(var(--paper))] shadow-[0_10px_24px_rgba(38,62,92,0.26)]"
        >
          回到首页
        </Link>
      </div>
    </main>
  );
}
