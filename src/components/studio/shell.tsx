'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  AudioLines,
  BookOpen,
  Clapperboard,
  Frame,
  LayoutGrid,
  LogOut,
  PenLine,
  Settings2,
  Users,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useEndpoints } from '@/lib/endpoint-store';
import { cn } from '@/lib/cn';
import { Wordmark } from '@/components/brand';

const NAV = [
  { href: '/studio', label: '总览', icon: LayoutGrid, overview: true },
  { href: '/studio/text', label: '文本', icon: PenLine },
  { href: '/studio/image', label: '图像', icon: Frame },
  { href: '/studio/video', label: '影像', icon: Clapperboard },
  { href: '/studio/voice', label: '声音', icon: AudioLines },
  { href: '/studio/story', label: '故事', icon: BookOpen },
  { href: '/studio/social', label: '社交', icon: Users },
  { href: '/studio/settings', label: '设置', icon: Settings2 },
];

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

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-[rgb(var(--paper))]">
      <aside className="hidden w-[248px] shrink-0 flex-col border-r border-[rgb(var(--line))]/60 bg-[linear-gradient(180deg,rgb(var(--surface)),rgb(var(--paper)))] px-4 py-5 md:flex">
        <Link href="/" className="px-2">
          <Wordmark />
        </Link>

        <nav className="mt-9 flex flex-1 flex-col gap-1">
          <div className="mb-2 px-3 font-mono text-[9.5px] uppercase tracking-[0.3em] text-muted/60">
            Workspace
          </div>
          {NAV.map((item) => {
            const href = item.overview ? overviewHref : item.href;
            const active = item.overview
              ? pathname === '/studio' || overviewHref.startsWith('#')
              : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={href}
                className={cn(
                  'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] transition-all duration-300 ease-weave',
                  active
                    ? 'bg-[rgb(var(--surface))] text-ink shadow-[var(--shadow-neu-sm)]'
                    : 'text-muted hover:bg-[rgb(var(--surface))]/60 hover:text-ink',
                )}
              >
                <Icon
                  size={15.5}
                  strokeWidth={1.7}
                  className={cn('shrink-0', active ? 'text-[rgb(var(--accent))]' : 'text-muted/80')}
                />
                {item.label}
                {active ? (
                  <motion.span
                    layoutId="studio-nav"
                    className="absolute -left-4 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-[rgb(var(--copper))]"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="mt-4 rounded-xl px-3 py-3 shadow-[var(--shadow-inset-sm)]">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                online ? 'bg-[#4d7a5c]' : 'bg-[rgb(var(--copper))]',
              )}
            />
            <span className="text-[11px] text-ink/70">
              {loaded ? (online ? '服务已连接' : '离线演示') : '正在读取配置'}
            </span>
          </div>
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted/70">
            {online ? '请求经由本机路由转发' : '未配置端点，部分能力使用本地草稿'}
          </p>
        </div>

        <div className="mt-3 flex items-center gap-2.5 rounded-xl px-2 py-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[rgb(var(--sunken))] font-mono text-[11px] text-ink/70 shadow-[var(--shadow-inset-sm)]">
            {user ? user.handle.slice(0, 1).toUpperCase() : '·'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] text-ink/85">{user?.handle ?? '未登录'}</div>
            <div className="truncate font-mono text-[9.5px] tracking-wider text-muted/60">
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
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[rgb(var(--line))]/50 px-4 md:px-8">
          <Link href="/" className="md:hidden">
            <Wordmark compact />
          </Link>

          <nav className="no-scrollbar flex flex-1 items-center gap-1 overflow-x-auto md:hidden">
            {NAV.map((item) => {
              const href = item.overview ? overviewHref : item.href;
              const active = item.overview
                ? pathname === '/studio' || overviewHref.startsWith('#')
                : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={href}
                  className={cn(
                    'shrink-0 rounded-full px-3 py-1.5 text-[12px] transition-colors',
                    active ? 'bg-[rgb(var(--surface))] text-ink shadow-[var(--shadow-neu-sm)]' : 'text-muted',
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto hidden items-center gap-4 md:flex">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted/60">
              {user?.guest ? 'Guest session' : 'Local session'}
            </span>
            <span className="h-4 w-px bg-[rgb(var(--line))]" />
            <Link
              href={homeHref}
              onClick={() => onHome?.()}
              className="text-[12px] text-muted transition-colors hover:text-ink"
            >
              回到首页
            </Link>
          </div>
        </header>

        <motion.main
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto w-full max-w-[1680px] px-4 py-6 md:px-6 md:py-8">{children}</div>
        </motion.main>
      </div>
    </div>
  );
}
