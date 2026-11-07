'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion, useScroll } from 'framer-motion';
import { ArrowLeft, Loader2, LogIn, LogOut, Plus } from 'lucide-react';
import { useAuth, wasSignedOut } from '@/lib/auth';
import { useEndpoints } from '@/lib/endpoint-store';
import {
  ALL_LOCAL_MODELS,
  useEngines,
  useModelRuntime,
} from '@/lib/engines';
import { describeError } from '@/lib/errors';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { Wordmark } from '@/components/brand';
import { DOCK } from '@/lib/workbenches';
import { unreadTotal, useUnread } from '@/lib/unread';
import { AuthDialog } from '@/components/intro/auth-dialog';
import { Button } from '@/components/ui/button';

/** Failures that come from hitting a browser limit rather than from our code. */
const RUNTIME_LIMIT = /Response|ArrayBuffer|supported range|out of memory|RangeError|WebAssembly/i;

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
  const mainRef = useRef<HTMLElement | null>(null);
  const { scrollYProgress } = useScroll({ container: mainRef });
  const reduceMotion = useReducedMotion();
  const { user, ready, hydrate, logout, enterAsGuest } = useAuth();
  const load = useEndpoints((state) => state.load);
  const loaded = useEndpoints((state) => state.loaded);
  const health = useEndpoints((state) => state.health);
  const bootstrapped = useRef(false);
  const [authOpen, setAuthOpen] = useState(false);
  const unread = useUnread((state) => unreadTotal(state));
  const loadUnread = useUnread((state) => state.load);

  useEffect(() => {
    loadUnread();
  }, [loadUnread]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * A first visit gets a guest identity so the workbenches are usable without a
   * form. After an explicit sign-out that must not happen: silently creating a
   * new guest is why logging in again looked broken — the app never stayed in
   * the signed-out state the login form needs.
   */
  useEffect(() => {
    if (!ready || user || bootstrapped.current) return;
    if (wasSignedOut()) return;
    bootstrapped.current = true;
    void enterAsGuest().catch((error) => toast(describeError(error), 'error'));
  }, [ready, user, enterAsGuest]);

  const loadEngines = useEngines((state) => state.load);
  const models = useModelRuntime((state) => state.models);
  const active = useModelRuntime((state) =>
    ALL_LOCAL_MODELS.find((model) => state.models[model.id]?.state === 'downloading'),
  );

  useEffect(() => {
    void loadEngines();
  }, [loadEngines]);

  /**
   * onnxruntime spawns async work of its own, so a hard failure can surface as
   * a rejection nothing in our call stack awaits — that is how a RangeError
   * from inside the bundle ended up as a full-page overlay. Catch the ones
   * that mean "this model cannot run here" and say so in place.
   */
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      const text = describeError(event.reason);
      if (!RUNTIME_LIMIT.test(text)) return;
      console.error('[loomscape] local runtime rejected', event.reason);
      event.preventDefault();
      toast(`本地模型运行时出错：${text}`, 'error');
    };
    window.addEventListener('unhandledrejection', onRejection);
    return () => window.removeEventListener('unhandledrejection', onRejection);
  }, []);

  const continueAsGuest = async () => {
    try {
      await enterAsGuest();
    } catch (error) {
      toast(describeError(error), 'error');
    }
  };

  const gated = ready && !user;
  const online = health.text || health.image || health.speech;
  const progress = active ? Math.round((models[active.id]?.progress ?? 0) * 100) : 0;
  const current = DOCK.find((item) =>
    item.href === '/studio' ? pathname === '/studio' : pathname.startsWith(item.href),
  );
  const home = overviewHref.startsWith('#') ? overviewHref : homeHref;
  const isActive = (href: string) =>
    href === '/studio'
      ? pathname === '/studio' || overviewHref.startsWith('#')
      : pathname.startsWith(href);
  const initial = user ? user.handle.slice(0, 1).toUpperCase() : '·';

  return (
    <div className="studio-bg grain relative flex h-[100dvh] w-full overflow-hidden">
      <div aria-hidden="true" className="studio-aurora z-0" />
      {/*
        Desktop gets a real navigation column. A five-item dock is the right
        pattern on a phone, where the thumb lives; on a 1440px studio it left
        the workbench floating in one long undifferentiated page. The dark rail
        also gives the warm paper content a hard edge to sit against.
      */}
      <aside
        data-shell-nav=""
        className="relative z-10 hidden w-[232px] shrink-0 flex-col border-r border-white/15 bg-[#172421]/[0.88] text-[#f6f2ea] shadow-[18px_0_60px_-38px_rgba(18,28,24,0.75)] backdrop-blur-2xl xl:flex"
      >
        <div className="px-5 pb-5 pt-6">
          <Link href={home} onClick={() => onHome?.()}>
            <Wordmark tone="light" />
          </Link>
          <p className="mt-4 text-[10.5px] leading-relaxed text-[#f6f2ea]/40">
            本地优先的多模态创作台
          </p>
        </div>

        <div className="px-4">
          <Link
            href="/studio/create"
            className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2.5 text-[12.5px] text-[#f6f2ea]/85 transition-colors hover:bg-white/[0.09]"
          >
            <span>新建创作</span>
            <Plus size={14} strokeWidth={1.8} />
          </Link>
        </div>

        <nav aria-label="工作台切换" className="mt-7 flex-1 space-y-1 overflow-y-auto px-3">
          <p className="px-3 pb-2 font-mono text-[9px] uppercase tracking-[0.28em] text-[#f6f2ea]/30">
            工作台
          </p>
          {DOCK.map((item) => {
            const href = item.href === '/studio' ? overviewHref : item.href;
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group relative flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-[13px] transition-colors duration-200',
                  active
                    ? 'text-[#172421]'
                    : 'text-[#f6f2ea]/55 hover:bg-white/[0.06] hover:text-[#f6f2ea]',
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="rail-active"
                    className="absolute inset-0 rounded-xl bg-[#f6f2ea] shadow-[0_10px_24px_-16px_rgba(0,0,0,0.6)]"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                ) : null}
                <span className="relative z-10 flex min-w-0 flex-1 items-center gap-3">
                  <Icon size={17} strokeWidth={1.7} className="shrink-0" />
                  <span className="truncate">{item.title}</span>
                  {item.href === '/studio/social' && unread > 0 ? (
                    <span
                      aria-label={`${unread} 条未读`}
                      className="ml-auto grid h-[17px] min-w-[17px] place-items-center rounded-full bg-[#b4453a] px-1 font-mono text-[9px] leading-none text-white"
                    >
                      {unread > 99 ? '99+' : unread}
                    </span>
                  ) : active ? (
                    <motion.span
                      layoutId="rail-dot"
                      className="ml-auto h-1.5 w-1.5 rounded-full bg-[rgb(var(--copper))]"
                    />
                  ) : null}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="space-y-3 border-t border-white/10 px-4 py-5">
          <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3">
            <div className="flex items-center gap-2 text-[11.5px] text-[#f6f2ea]/75">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  online ? 'bg-[#7fae8a]' : 'bg-[rgb(var(--copper))]',
                )}
              />
              {loaded ? (online ? '服务已连接' : '离线可用') : '正在读取配置'}
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-[#f6f2ea]/35">
              数据与权重留在这台设备
            </p>
          </div>

          <div
            className="flex items-center gap-2.5"
            data-uid={user?.uid ?? ''}
            data-user-id={user?.id ?? ''}
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 font-mono text-[11.5px] text-[#f6f2ea]/85">
              {initial}
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[12.5px] text-[#f6f2ea]/90">
                {user?.handle ?? '未登录'}
              </div>
              <div className="truncate font-mono text-[9.5px] tracking-wider text-[#f6f2ea]/40">
                {user?.uid ?? '—'}
              </div>
            </div>
            {user ? (
              <button
                type="button"
                onClick={() => {
                  useUnread.getState().reset();
                  logout();
                }}
                aria-label="退出登录"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[#f6f2ea]/50 transition-colors hover:bg-white/10 hover:text-[#f6f2ea]"
              >
                <LogOut size={13.5} strokeWidth={1.7} />
              </button>
            ) : null}
          </div>

          {user?.guest ? (
            <button
              type="button"
              onClick={() => setAuthOpen(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2 text-[11.5px] text-[#f6f2ea]/65 transition-colors hover:bg-white/[0.06] hover:text-[#f6f2ea]"
            >
              <LogIn size={12.5} strokeWidth={1.8} />
              登录 / 注册
            </button>
          ) : null}
        </div>
      </aside>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header
          data-loading-model={active?.id ?? ''}
          className="relative hidden h-14 shrink-0 items-center gap-4 border-b border-white/45 bg-white/45 px-6 backdrop-blur-2xl xl:flex"
        >
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted/60">
            <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--copper))]" />
            <span>工作台</span>
            <span className="text-muted/30">/</span>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={current?.title ?? '总览'}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
                className="text-ink/80"
              >
                {current?.title ?? '总览'}
              </motion.span>
            </AnimatePresence>
            {current ? (
              <span className="text-muted/40">{current.index}</span>
            ) : null}
          </div>

          <span className="h-4 w-px bg-[rgb(var(--line))]" />

          {active ? (
            <span className="flex items-center gap-1.5 text-[11px] text-muted">
              <Loader2 size={11} className="animate-spin" />
              加载 {active.label}
              <span className="tabular-nums">{progress}%</span>
            </span>
          ) : (
            <span className="flex items-center gap-2 text-[11px] text-muted/80">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  online ? 'bg-[#4d7a5c]' : 'bg-[rgb(var(--copper))]',
                )}
              />
              {loaded ? (online ? '服务已连接' : '离线演示') : '正在读取配置'}
            </span>
          )}

          <div className="ml-auto flex items-center gap-3">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted/45">
              local-first
            </span>
            <span className="h-4 w-px bg-[rgb(var(--line))]" />
            <Link
              href={home}
              onClick={() => onHome?.()}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] text-muted transition-colors hover:bg-[rgb(var(--sunken))]/60 hover:text-ink"
            >
              <ArrowLeft size={12.5} strokeWidth={1.8} />
              返回首页
            </Link>
          </div>

          {active ? (
            <div
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${active.label} 加载进度`}
              className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden bg-[rgb(var(--line))]/45"
            >
              <div
                className="h-full w-full origin-left bg-[rgb(var(--accent))] transition-transform duration-300 ease-out"
                style={{ transform: `scaleX(${Math.max(progress, 2) / 100})` }}
              />
            </div>
          ) : (
            <motion.div
              aria-hidden
              style={{ scaleX: scrollYProgress }}
              className="absolute inset-x-0 bottom-0 h-[1.5px] origin-left bg-[rgb(var(--accent))]/35"
            />
          )}
        </header>

        <header
          data-loading-model={active?.id ?? ''}
          className="relative flex h-14 shrink-0 items-center gap-3 border-b border-white/45 bg-white/45 px-4 backdrop-blur-2xl xl:hidden"
        >
          <Link href={home} onClick={() => onHome?.()} className="shrink-0">
            <Wordmark compact />
          </Link>

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="h-1 w-1 shrink-0 rounded-full bg-[rgb(var(--copper))]" />
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={current?.title ?? '工作台'}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18 }}
                  className="truncate text-[13.5px] text-ink/90"
                >
                  {current?.title ?? '工作台'}
                </motion.span>
              </AnimatePresence>
            </div>
          </div>

          {active ? (
            <span className="flex shrink-0 items-center gap-1.5 text-[10.5px] text-muted">
              <Loader2 size={11} className="animate-spin" />
              <span className="tabular-nums">{progress}%</span>
            </span>
          ) : (
            <span className="hidden items-center gap-2 sm:flex">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  online ? 'bg-[#4d7a5c]' : 'bg-[rgb(var(--copper))]',
                )}
              />
              <span className="text-[11px] text-muted/85">
                {loaded ? (online ? '服务已连接' : '离线演示') : '正在读取配置'}
              </span>
            </span>
          )}

          {user?.guest ? (
            <button
              type="button"
              onClick={() => setAuthOpen(true)}
              className="flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[11.5px] text-muted transition-colors hover:text-ink"
            >
              <LogIn size={12.5} strokeWidth={1.8} />
              <span className="hidden sm:inline">登录</span>
            </button>
          ) : null}

          {user ? (
            <button
              type="button"
              onClick={() => {
                useUnread.getState().reset();
                logout();
              }}
              aria-label="退出登录"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted/70 transition-colors hover:bg-[rgb(var(--sunken))] hover:text-ink"
            >
              <LogOut size={13.5} strokeWidth={1.7} />
            </button>
          ) : null}

          {active ? (
            <div
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${active.label} 加载进度`}
              className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden bg-[rgb(var(--line))]/45"
            >
              <div
                className="h-full w-full origin-left bg-[rgb(var(--accent))] transition-transform duration-300 ease-out"
                style={{ transform: `scaleX(${Math.max(progress, 2) / 100})` }}
              />
            </div>
          ) : (
            <motion.div
              aria-hidden
              style={{ scaleX: scrollYProgress }}
              className="absolute inset-x-0 bottom-0 h-[1.5px] origin-left bg-[rgb(var(--accent))]/35"
            />
          )}
        </header>

      <motion.main
        ref={mainRef}
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {gated ? (
          <div className="mx-auto flex min-h-[58vh] w-full max-w-[480px] flex-col justify-center px-4">
            <div
              data-auth-gate=""
              className="rounded-2xl bg-[rgb(var(--surface))] p-7 shadow-[var(--shadow-neu)]"
            >
              <h2 className="font-serif text-[21px] text-ink">先建立一个身份</h2>
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                账户、密钥与作品都保存在这台设备的浏览器里，不经过服务器。登录后回到原来的作品；
                访客身份也能用，但数据按访客单独存放。
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Button variant="primary" size="md" onClick={() => setAuthOpen(true)}>
                  <LogIn size={14} />
                  登录 / 注册
                </Button>
                <Button variant="ghost" size="md" onClick={() => void continueAsGuest()}>
                  以访客身份继续
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={pathname}
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
              transition={{
                duration: reduceMotion ? 0 : 0.3,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-8 md:py-8 xl:px-10"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        )}
      </motion.main>

      <footer className="shrink-0 bg-gradient-to-t from-[rgb(var(--paper))] via-[rgb(var(--paper))]/85 to-transparent px-3 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2 md:px-6 xl:hidden">
        <nav
          aria-label="工作台切换"
          className="nav-surface no-scrollbar mx-auto flex w-full max-w-[760px] items-stretch gap-1 overflow-x-auto rounded-[1.25rem] p-1.5"
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
                  'group relative flex min-w-[64px] flex-1 shrink-0 flex-col items-center gap-1 rounded-xl px-2 py-2 transition-[transform,color] duration-300 ease-weave hover:-translate-y-0.5',
                  active ? 'text-[rgb(var(--surface))]' : 'text-muted hover:text-ink',
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="dock-active"
                    className="absolute inset-0 rounded-xl bg-[rgb(var(--accent))] shadow-[var(--shadow-accent)]"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                ) : null}
                <span className="relative z-10 flex flex-col items-center gap-1">
                  <span className="relative">
                    <Icon
                      size={17}
                      strokeWidth={1.7}
                      className={cn(
                        'transition-transform duration-300 group-hover:-translate-y-0.5',
                        active ? 'text-[rgb(var(--surface))]' : 'text-muted/80',
                      )}
                    />
                    {item.href === '/studio/social' && unread > 0 ? (
                      <span
                        aria-label={`${unread} 条未读`}
                        className="absolute -right-2 -top-1.5 grid h-[15px] min-w-[15px] place-items-center rounded-full bg-[#b4453a] px-1 font-mono text-[8.5px] leading-none text-white"
                      >
                        {unread > 99 ? '99+' : unread}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[11px] leading-none tracking-wide">{item.title}</span>
                </span>
              </Link>
            );
          })}
        </nav>
      </footer>
      </div>

      <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}
