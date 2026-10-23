'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useScroll, useTransform } from 'framer-motion';
import { ArrowRight, LogIn } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Mark } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { WeaveCanvas } from './weave-canvas';
import { FlightPath, PaperPlane } from './paper-plane';
import { SlideAbout, SlideCapabilities, SlideHero, SlideProcess } from './slides';
import { AuthDialog } from './auth-dialog';

const SECTIONS = [
  { id: 'intro', label: '简介' },
  { id: 'capability', label: '能力' },
  { id: 'workflow', label: '织法' },
  { id: 'about', label: '关于' },
];

export function IntroExperience() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [authOpen, setAuthOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const router = useRouter();
  const { user, hydrate, ready } = useAuth();

  const { scrollXProgress } = useScroll({ container: scrollerRef, axis: 'x' });
  // Progress is NaN before the container is measured; keep the flight path stable.
  const flight = useTransform(scrollXProgress, (value) =>
    Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0,
  );

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const panels = useCallback(
    () => Array.from(scrollerRef.current?.children ?? []) as HTMLElement[],
    [],
  );

  const goTo = useCallback(
    (target: number) => {
      const el = scrollerRef.current;
      const list = panels();
      if (!el || !list[target]) return;
      el.scrollTo({ left: list[target].offsetLeft, behavior: 'smooth' });
    },
    [panels],
  );

  // Vertical wheel becomes horizontal paging; one gesture moves one panel.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    let accumulated = 0;
    let lastAt = 0;
    let lockedUntil = 0;

    const onWheel = (event: WheelEvent) => {
      const vertical = Math.abs(event.deltaY) >= Math.abs(event.deltaX);
      if (vertical) event.preventDefault();

      const delta = vertical ? event.deltaY : event.deltaX;
      const now = performance.now();
      if (now - lastAt > 240) accumulated = 0;
      lastAt = now;
      accumulated += delta;

      if (now < lockedUntil) return;
      if (Math.abs(accumulated) < 40) return;

      const list = Array.from(el.children) as HTMLElement[];
      let current = 0;
      let distance = Number.POSITIVE_INFINITY;
      list.forEach((node, i) => {
        const gap = Math.abs(node.offsetLeft - el.scrollLeft);
        if (gap < distance) {
          distance = gap;
          current = i;
        }
      });

      const next = Math.min(Math.max(current + (accumulated > 0 ? 1 : -1), 0), SECTIONS.length - 1);
      accumulated = 0;
      lockedUntil = now + 640;
      if (list[next]) el.scrollTo({ left: list[next].offsetLeft, behavior: 'smooth' });
    };

    const onScroll = () => {
      const list = Array.from(el.children) as HTMLElement[];
      let current = 0;
      let distance = Number.POSITIVE_INFINITY;
      list.forEach((node, i) => {
        const gap = Math.abs(node.offsetLeft - el.scrollLeft);
        if (gap < distance) {
          distance = gap;
          current = i;
        }
      });
      setIndex(current);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const list = Array.from(el.children) as HTMLElement[];
      let current = 0;
      let distance = Number.POSITIVE_INFINITY;
      list.forEach((node, i) => {
        const gap = Math.abs(node.offsetLeft - el.scrollLeft);
        if (gap < distance) {
          distance = gap;
          current = i;
        }
      });
      const next = Math.min(
        Math.max(current + (event.key === 'ArrowRight' ? 1 : -1), 0),
        SECTIONS.length - 1,
      );
      if (list[next]) el.scrollTo({ left: list[next].offsetLeft, behavior: 'smooth' });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const enterStudio = useCallback(() => {
    setLeaving(true);
    window.setTimeout(() => router.push('/studio'), 640);
  }, [router]);

  const requestEnter = useCallback(() => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    enterStudio();
  }, [enterStudio, user]);

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-[rgb(var(--paper))]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_18%_12%,rgba(255,255,255,0.9),transparent_58%),radial-gradient(90%_70%_at_88%_82%,rgba(176,122,74,0.07),transparent_62%)]" />
      <WeaveCanvas className="pointer-events-none absolute inset-0 z-0 opacity-90" />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-40">
        <div className="pointer-events-auto mx-auto flex max-w-[1320px] items-center justify-between px-6 py-5 md:px-9 md:py-6">
          <button type="button" onClick={() => goTo(0)} className="flex items-center gap-3 text-ink">
            <Mark className="h-[26px] w-[26px]" />
            <span className="flex items-baseline gap-2.5">
              <span className="font-serif text-[16px] tracking-[0.06em]">织境</span>
              <span className="hidden font-mono text-[9.5px] uppercase tracking-[0.34em] text-muted sm:inline">
                Loomscape
              </span>
            </span>
          </button>

          <nav className="hidden items-center gap-1 md:flex">
            {SECTIONS.map((section, i) => (
              <button
                key={section.id}
                type="button"
                onClick={() => goTo(i)}
                className={cn(
                  'relative rounded-full px-4 py-2 text-[12.5px] transition-colors duration-300',
                  index === i ? 'text-ink' : 'text-muted hover:text-ink/80',
                )}
              >
                {index === i ? (
                  <motion.span
                    layoutId="intro-nav-pill"
                    className="absolute inset-0 rounded-full bg-[rgb(var(--surface))] shadow-[var(--shadow-neu-sm)]"
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  />
                ) : null}
                <span className="relative">{section.label}</span>
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.24em] text-muted/70 sm:inline">
              本地优先
            </span>
            <span className="font-mono text-[10px] tabular-nums text-muted/70">
              {String(index + 1).padStart(2, '0')}
              <span className="mx-1 text-muted/40">/</span>
              {String(SECTIONS.length).padStart(2, '0')}
            </span>
          </div>
        </div>
      </header>

      <div
        ref={scrollerRef}
        className="pager no-scrollbar relative z-10 flex h-[100dvh] w-full overflow-x-auto overflow-y-hidden"
      >
        <section className="pager-slide relative h-full w-full shrink-0 overflow-y-auto pb-28 pt-28 md:overflow-hidden">
          <SlideHero onEnter={requestEnter} onBrowse={() => goTo(1)} />
        </section>
        <section className="pager-slide relative h-full w-full shrink-0 overflow-y-auto pb-28 pt-28 md:overflow-hidden">
          <SlideCapabilities />
        </section>
        <section className="pager-slide relative h-full w-full shrink-0 overflow-y-auto pb-28 pt-28 md:overflow-hidden">
          <SlideProcess />
        </section>
        <section className="pager-slide relative h-full w-full shrink-0 overflow-y-auto pb-28 pt-28 md:overflow-hidden">
          <SlideAbout onEnter={requestEnter} />
        </section>
      </div>

      <FlightPath progress={flight} />
      <PaperPlane progress={flight} />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center pb-5 md:pb-6">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-[rgb(var(--paper))]/85 p-2 pl-3 shadow-[0_18px_44px_-18px_rgba(30,42,60,0.4),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-md md:gap-3">
          {user ? (
            <div className="flex items-center gap-2.5 pr-1">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-[rgb(var(--sunken))] font-mono text-[10px] text-ink/70 shadow-[var(--shadow-inset-sm)]">
                {user.handle.slice(0, 1).toUpperCase()}
              </span>
              <span className="max-w-[7rem] truncate text-[12px] text-ink/80">{user.handle}</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAuthOpen(true)}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] text-muted transition-colors hover:text-ink"
            >
              <LogIn size={13} strokeWidth={1.8} />
              登录
              {ready ? null : <span className="h-1 w-1 animate-pulse rounded-full bg-muted/50" />}
            </button>
          )}

          <span className="h-5 w-px bg-[rgb(var(--line))]" />

          <div className="hidden items-center gap-1.5 sm:flex">
            {SECTIONS.map((section, i) => (
              <button
                key={section.id}
                type="button"
                aria-label={`前往${section.label}`}
                onClick={() => goTo(i)}
                className="group grid h-6 w-6 place-items-center"
              >
                <span
                  className={cn(
                    'h-1.5 rounded-full transition-all duration-500 ease-weave',
                    index === i
                      ? 'w-5 bg-[rgb(var(--accent))]'
                      : 'w-1.5 bg-[rgb(var(--line))] group-hover:bg-muted/50',
                  )}
                />
              </button>
            ))}
          </div>

          <span className="hidden h-5 w-px bg-[rgb(var(--line))] sm:block" />

          <Button variant="primary" size="sm" onClick={requestEnter} className="rounded-full px-4">
            进入工作台
            <ArrowRight size={13} strokeWidth={2} />
          </Button>
        </div>
      </div>

      <motion.div
        aria-hidden="true"
        className="absolute bottom-0 left-0 z-40 h-[2px] origin-left bg-[rgb(var(--accent))]/35"
        style={{ scaleX: flight, width: '100%' }}
      />

      <AuthDialog
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSuccess={() => {
          setAuthOpen(false);
          enterStudio();
        }}
      />

      <AnimatePresence>
        {leaving ? (
          <motion.div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgb(var(--paper))]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.42, ease: [0.4, 0, 0.2, 1] }}
          >
            <div className="flex flex-col items-center gap-5">
              <Mark className="h-10 w-10 text-ink/80" />
              <span className="font-mono text-[10px] uppercase tracking-[0.42em] text-muted">
                coming through
              </span>
              <span className="h-px w-24 overflow-hidden bg-[rgb(var(--line))]">
                <motion.span
                  className="block h-full bg-[rgb(var(--accent))]"
                  initial={{ x: '-100%' }}
                  animate={{ x: '100%' }}
                  transition={{ duration: 0.9, ease: 'easeInOut' }}
                />
              </span>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </main>
  );
}
