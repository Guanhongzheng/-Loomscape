'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, Loader2, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useEndpoints } from '@/lib/endpoint-store';
import { ALL_LOCAL_MODELS, findModel, useEngines, useModelRuntime } from '@/lib/engines';
import { describeError } from '@/lib/errors';
import { detectBackend, dtypeFor, isModelCached, loadModel } from '@/lib/local-runtime';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { Wordmark } from '@/components/brand';
import { DOCK } from '@/lib/workbenches';

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

  const prefs = useEngines((state) => state.prefs);
  const prefsLoaded = useEngines((state) => state.loaded);
  const loadEngines = useEngines((state) => state.load);
  const resident = useModelRuntime((state) => state.resident);
  const models = useModelRuntime((state) => state.models);
  const active = useModelRuntime((state) =>
    ALL_LOCAL_MODELS.find((model) => state.models[model.id]?.state === 'downloading'),
  );
  const autoLoaded = useRef(false);

  useEffect(() => {
    void loadEngines();
  }, [loadEngines]);

  /**
   * Entering the workspace brings back whichever local engine the settings
   * point at, but only if its weights are already on disk: starting a 490MB
   * download because someone scrolled past the intro would be rude.
   */
  useEffect(() => {
    if (!prefsLoaded || resident || autoLoaded.current) return;
    autoLoaded.current = true;

    const candidate =
      prefs.textMode === 'local'
        ? findModel(prefs.textModelId)
        : prefs.embeddingMode === 'local'
          ? findModel(prefs.embeddingModelId)
          : undefined;
    if (!candidate) return;

    void (async () => {
      // The precision depends on the backend that will actually run, not on
      // the preference: a WebGPU pick needs fp16, and downloading it silently
      // on entry is exactly what this guard exists to avoid.
      const backend = await detectBackend(prefs.backend);
      if (!(await isModelCached(candidate.repo, dtypeFor(candidate, backend)))) return;

      // A decoder session peaks in the gigabytes. On a 4GB device that is the
      // difference between a workspace and a crashed tab, so leave it to an
      // explicit click there.
      const deviceMemory = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
      if (candidate.task === 'text' && deviceMemory && deviceMemory <= 4) {
        toast(`${candidate.label} 需要较多内存，设备报告 ${deviceMemory}GB，请在设置里手动加载`, 'info');
        return;
      }

      try {
        await loadModel(candidate, {
          source: prefs.source,
          backendPreference: prefs.backend,
          report: true,
        });
      } catch (error) {
        toast(`自动加载 ${candidate.label} 失败：${describeError(error)}`, 'error');
      }
    })();
  }, [prefsLoaded, resident, prefs]);

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

  const online = health.text || health.image || health.speech;
  const progress = active ? Math.round((models[active.id]?.progress ?? 0) * 100) : 0;
  const current = DOCK.find((item) =>
    item.href === '/studio' ? pathname === '/studio' : pathname.startsWith(item.href),
  );
  const home = overviewHref.startsWith('#') ? overviewHref : homeHref;

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[rgb(var(--paper))]">
      <header
        data-loading-model={active?.id ?? ''}
        className="relative flex h-14 shrink-0 items-center gap-3 border-b border-[rgb(var(--line))]/55 px-4 md:h-16 md:px-8"
      >
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

        {active ? (
          <span className="flex shrink-0 items-center gap-1.5 text-[10.5px] text-muted">
            <Loader2 size={11} className="animate-spin" />
            <span className="hidden md:inline">加载 {active.label}</span>
            <span className="tabular-nums">{progress}%</span>
          </span>
        ) : (
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
        )}

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
              className="h-full bg-[rgb(var(--accent))] transition-[width] duration-300 ease-out"
              style={{ width: `${Math.max(progress, 2)}%` }}
            />
          </div>
        ) : null}
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
