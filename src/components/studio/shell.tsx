'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useEndpoints } from '@/lib/endpoint-store';
import { cn } from '@/lib/cn';
import { Wordmark } from '@/components/brand';
import { DOCK } from '@/lib/workbenches';

/**
 * The workspace splits its navigation in two: a thin top bar carrying the
 * mark, the current location and the account, and a dock along the bottom
 * edge for switching workbenches. Keeping the switch at thumb height leaves
 * the whole width to the workbench itself.
 */
export function StudioShell({
  children,
  overviewHref = '/#workspace',
  homeHref = '/',
  onHome,
}: {
  children: React.ReactNode;
  overviewHref?: string;
  homeHref?: string;
  onHome?: () => void;
}) {
  const pathname = usePathname();
  const { user, ready, hydrate, logout, enterAsGuest } = useAuth();
  const load = useEndpoints((state) => state.load);
  const loaded = useEndpoints((state) => state.loaded);
  const health = useEndpoints((state) => state.health);
  const bootstrapped = useRef(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!ready || user || bootstrapped.current) return;
    bootstrapped.current = true;
    void enterAsGuest();
  }, [ready, user, enterAsGuest]);

  const online = health.text || health.image || health.speech;
  const current = DOCK.find((item) =>
    item.href === '/studio' ? pathname === '/studio' : pathname.startsWith(item.href),
  );
  const home = overviewHref.startsWith('#') ? overviewHref : homeHref;

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[rgb(var(--paper))]">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[rgb(var(--line))]/55 px-4 md:h-16 md:px-8">
        <Link href={home} onClick={() => onHome?.()} className="shrink-0">
          <span className="md:hidden">
            <Wordmark compact />
          </span>
          <span className="hidden md:block">
            <Wordmark />
          </span>
        </Link>

        <span className="hidden h-4 w-px bg-[rgb(var(--line))] md:block" />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[13px] text-ink/85">{current?.title ?? '工作台'}</span>
            <span className="hidden truncate font-mono text-[9.5px] uppercase tracking-[0.24em] text-muted/55 sm:block">
              {current ? `workbench ${current.index}` : 'workspace'}
            </span>
          </div>
        </div>

        <span className="hidden items-center gap-2 md:flex">
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              online ? 'bg-[#4d7a5c]' : 'bg-[rgb(var(--copper))]',
            )}
          />
          <span className="text-[11px] text-muted/80">
            {loaded ? (online ? '服务已连接' : '离线演示') : '正在读取配置'}
          </span>
        </span>

        <Link
          href={home}
          onClick={() => onHome?.()}
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11.5px] text-muted transition-colors hover:text-ink"
        >
          <ArrowLeft size={12.5} strokeWidth={1.8} />
          <span className="hidden sm:inline">返回首页</span>
        </Link>

        <span className="hidden h-4 w-px bg-[rgb(var(--line))] sm:block" />

        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[rgb(var(--sunken))] font-mono text-[11px] text-ink/70 shadow-[var(--shadow-inset-sm)]">
            {user ? user.handle.slice(0, 1).toUpperCase() : '·'}
          </span>
          <div className="hidden min-w-0 leading-tight lg:block">
            <div className="truncate text-[12px] text-ink/85">{user?.handle ?? '未登录'}</div>
            <div className="truncate font-mono text-[9px] tracking-wider text-muted/60">
              {user?.uid ?? '—'}
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            aria-label="退出登录"
            className="grid h-7 w-7 place-items-center rounded-lg text-muted/70 transition-colors hover:bg-[rgb(var(--sunken))] hover:text-ink"
          >
            <LogOut size={13.5} strokeWidth={1.7} />
          </button>
        </div>
      </header>

      <motion.main
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto w-full max-w-[1720px] px-4 py-6 md:px-8 md:py-8">{children}</div>
      </motion.main>

      <footer className="shrink-0 border-t border-[rgb(var(--line))]/55 bg-[rgb(var(--paper))]/95 px-3 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2.5 md:px-6">
        <nav
          aria-label="工作台切换"
          className="no-scrollbar mx-auto flex w-full max-w-[1720px] items-stretch gap-1 overflow-x-auto"
        >
          {DOCK.map((item) => {
            const href = item.href === '/studio' ? overviewHref : item.href;
            const active =
              item.href === '/studio'
                ? pathname === '/studio' || overviewHref.startsWith('#')
                : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group relative flex min-w-[68px] flex-1 shrink-0 flex-col items-center gap-1 rounded-xl px-2 py-2 transition-all duration-300 ease-weave',
                  active
                    ? 'bg-[rgb(var(--surface))] text-ink shadow-[var(--shadow-neu-sm)]'
                    : 'text-muted hover:bg-[rgb(var(--surface))]/55 hover:text-ink',
                )}
              >
                <Icon
                  size={16}
                  strokeWidth={1.7}
                  className={cn(active ? 'text-[rgb(var(--accent))]' : 'text-muted/75')}
                />
                <span className="text-[10.5px] leading-none tracking-wide">{item.title}</span>
                {active ? (
                  <motion.span
                    layoutId="dock-rail"
                    className="absolute inset-x-3 -top-[2px] h-[2px] rounded-full bg-[rgb(var(--copper))]"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                ) : null}
              </Link>
            );
          })}
        </nav>
      </footer>
    </div>
  );
}
