'use client';

import { useEffect, useRef, useState } from 'react';
import { Mark } from '@/components/brand';
import { preloadCursorGemma } from '@/lib/cursor/home-model';

const COLORS = {
  sage: '#4d7a5c',
  plum: '#8b6b83',
} as const;

type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };
type Phase = 'preloading' | 'leaving' | 'drawing' | 'ready';

const STEPS = [
  { key: 'header', color: COLORS.sage, duration: 900, delay: 0, direction: 'ltr' as const },
  { key: 'pager', color: COLORS.plum, duration: 620, delay: 90, direction: 'rtl' as const },
];

const CURSOR_PATH = 'M3.5 2.5 19 11.5l-7 1.9L9.5 21 3.5 2.5Z';

const easeInOut = (value: number) =>
  value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;

function CursorSvg() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={CURSOR_PATH} fill="currentColor" />
      <path d="M4.5 4.8 8.7 17l1.8-4.3 4.2-1.1L4.5 4.8Z" fill="rgb(255 255 255 / 0.6)" />
    </svg>
  );
}

export function IntroChromeBuild() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const skipRef = useRef<() => void>(() => {});
  const sageRef = useRef<HTMLDivElement>(null);
  const plumRef = useRef<HTMLDivElement>(null);
  const headerBoxRef = useRef<HTMLDivElement>(null);
  const pagerBoxRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('preloading');
  const [progress, setProgress] = useState(6);
  const [modelStage, setModelStage] = useState('');

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const main = root?.closest('main');
    const sage = sageRef.current;
    const plum = plumRef.current;
    const headerBox = headerBoxRef.current;
    const pagerBox = pagerBoxRef.current;
    if (!root || !canvas || !main || !sage || !plum || !headerBox || !pagerBox) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cancelled = false;
    let rootRect = root.getBoundingClientRect();
    const timers = new Set<number>();
    const cancels = new Set<() => void>();
    const positions = new Map<HTMLDivElement, Point>();
    const trails = new Map<HTMLDivElement, Point[]>();
    const cursors = { sage, plum };
    const boxes = { header: headerBox, pager: pagerBox };
    const targetFor = (key: string) =>
      main.querySelector<HTMLElement>(`[data-intro-chrome="${key}"]`);

    main.classList.add('intro-chrome-building');
    main.dataset.introChrome = 'building';
    document.documentElement.classList.add('intro-chrome-active');

    const startedAt = performance.now();
    let shownProgress = 6;
    const progressTimer = window.setInterval(() => {
      shownProgress = Math.min(90, shownProgress + Math.max(1, Math.round((92 - shownProgress) * 0.14)));
      setProgress(shownProgress);
    }, 120);

    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        const id = window.setTimeout(() => {
          timers.delete(id);
          resolve();
        }, ms);
        timers.add(id);
      });

    const fitCanvas = () => {
      rootRect = root.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rootRect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rootRect.height * dpr));
      canvas.style.width = `${rootRect.width}px`;
      canvas.style.height = `${rootRect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    };

    const drawTrails = () => {
      ctx.clearRect(0, 0, rootRect.width, rootRect.height);
      for (const [cursor, color] of [
        [sage, COLORS.sage],
        [plum, COLORS.plum],
      ] as const) {
        const points = trails.get(cursor) ?? [];
        for (let index = 1; index < points.length; index += 1) {
          const strength = index / points.length;
          ctx.globalAlpha = 0.035 + strength * 0.3;
          ctx.strokeStyle = color;
          ctx.lineWidth = 0.8 + strength * 1.1;
          ctx.beginPath();
          ctx.moveTo(points[index - 1].x, points[index - 1].y);
          ctx.lineTo(points[index].x, points[index].y);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    };

    const setCursor = (cursor: HTMLDivElement, point: Point) => {
      positions.set(cursor, point);
      cursor.style.transform = `translate3d(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px, 0)`;
    };

    const addTrail = (cursor: HTMLDivElement, point: Point) => {
      const points = trails.get(cursor) ?? [];
      points.push(point);
      while (points.length > 16) points.shift();
      trails.set(cursor, points);
      drawTrails();
    };

    const tween = (
      cursor: HTMLDivElement,
      to: Point,
      duration: number,
      onUpdate?: (point: Point) => void,
    ) =>
      new Promise<void>((resolve) => {
        const from = positions.get(cursor) ?? to;
        const start = performance.now();
        let raf = 0;
        const cancel = () => {
          window.cancelAnimationFrame(raf);
          cancels.delete(cancel);
          resolve();
        };
        cancels.add(cancel);
        const step = (now: number) => {
          if (cancelled) {
            cancel();
            return;
          }
          const progress = Math.min(1, (now - start) / duration);
          const eased = easeInOut(progress);
          const point = {
            x: from.x + (to.x - from.x) * eased,
            y: from.y + (to.y - from.y) * eased,
          };
          setCursor(cursor, point);
          addTrail(cursor, point);
          onUpdate?.(point);
          if (progress < 1) raf = window.requestAnimationFrame(step);
          else {
            cancels.delete(cancel);
            resolve();
          }
        };
        raf = window.requestAnimationFrame(step);
      });

    const rectOf = (target: HTMLElement): Rect => {
      const rect = target.getBoundingClientRect();
      const x = Math.max(4, rect.left - rootRect.left - 8);
      const y = Math.max(4, rect.top - rootRect.top - 8);
      return {
        x,
        y,
        w: Math.min(rootRect.width - x - 4, rect.width + 16),
        h: Math.min(rootRect.height - y - 4, rect.height + 16),
      };
    };

    const pulse = (point: Point, color: string) => {
      const ring = document.createElement('span');
      ring.className = 'weave-ripple';
      ring.style.setProperty('--c', color);
      ring.style.left = `${point.x}px`;
      ring.style.top = `${point.y}px`;
      root.appendChild(ring);
      window.setTimeout(() => ring.remove(), 700);
    };

    const revealAll = () => {
      for (const step of STEPS) targetFor(step.key)?.classList.add('is-revealed');
      headerBox.style.opacity = '0';
      pagerBox.style.opacity = '0';
      sage.style.opacity = '0';
      plum.style.opacity = '0';
      main.classList.remove('intro-chrome-building');
      main.dataset.introChrome = 'ready';
      window.dispatchEvent(new Event('intro-chrome-ready'));
      setPhase('ready');
    };

    const skip = () => {
      cancelled = true;
      window.clearInterval(progressTimer);
      for (const cancel of cancels) cancel();
      cancels.clear();
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
      setProgress(100);
      revealAll();
    };
    skipRef.current = skip;

    const drawStep = async (step: (typeof STEPS)[number]) => {
      const target = targetFor(step.key);
      const box = boxes[step.key as keyof typeof boxes];
      const cursor = step.key === 'header' ? sage : plum;
      if (!target || !box) return;
      const rect = rectOf(target);
      const ltr = step.direction === 'ltr';
      const from = ltr ? { x: rect.x, y: rect.y } : { x: rect.x + rect.w, y: rect.y };
      const to = ltr
        ? { x: rect.x + rect.w, y: rect.y + rect.h }
        : { x: rect.x, y: rect.y + rect.h };

      box.style.setProperty('--c', step.color);
      box.style.top = `${rect.y}px`;
      box.style.opacity = '0';
      box.style.width = '0px';
      box.style.height = '0px';
      box.style.left = `${from.x}px`;

      await tween(cursor, from, 250);
      if (cancelled) return;
      pulse(from, step.color);
      box.style.opacity = '1';
      await tween(cursor, to, step.duration, (point) => {
        if (ltr) {
          box.style.left = `${rect.x}px`;
          box.style.width = `${Math.max(0, point.x - rect.x)}px`;
        } else {
          box.style.left = `${point.x}px`;
          box.style.width = `${Math.max(0, rect.x + rect.w - point.x)}px`;
        }
        box.style.height = `${Math.max(0, point.y - rect.y)}px`;
      });
      if (cancelled) return;
      pulse(to, step.color);
      target.classList.add('is-revealed');
      await wait(200);
      cursor.style.opacity = '0';
      box.style.opacity = '0';
    };

    const preload = async () => {
      if (document.readyState !== 'complete') {
        await Promise.race([
          new Promise<void>((resolve) =>
            window.addEventListener('load', () => resolve(), { once: true }),
          ),
          wait(1200),
        ]);
      }
      await document.fonts?.ready.catch(() => undefined);
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())),
      );
      await new Promise<void>((resolve) => {
        const idle = (
          window as Window & {
            requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
          }
        ).requestIdleCallback;
        if (typeof idle === 'function') idle(() => resolve(), { timeout: 500 });
        else window.setTimeout(resolve, 180);
      });
      await wait(240);
    };

    const run = async () => {
      fitCanvas();
      setCursor(sage, { x: 18, y: 18 });
      setCursor(plum, { x: rootRect.width - 30, y: rootRect.height - 30 });
      sage.style.opacity = '1';
      plum.style.opacity = '1';
      await preload();
      if (cancelled) return;
      await preloadCursorGemma(setModelStage);
      if (cancelled) return;
      const elapsed = performance.now() - startedAt;
      if (elapsed < 1100) await wait(1100 - elapsed);
      if (cancelled) return;
      window.clearInterval(progressTimer);
      setProgress(100);
      await wait(260);
      setPhase('leaving');
      await wait(420);
      if (cancelled) return;
      setPhase('drawing');
      await wait(80);
      if (cancelled) return;

      await Promise.all(
        STEPS.map(async (step) => {
          await wait(step.delay);
          if (cancelled) return;
          await drawStep(step);
        }),
      );
      if (cancelled) return;
      await wait(140);
      main.classList.remove('intro-chrome-building');
      main.dataset.introChrome = 'ready';
      window.dispatchEvent(new Event('intro-chrome-ready'));
      setPhase('ready');
      ctx.clearRect(0, 0, rootRect.width, rootRect.height);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') skip();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', skip, { passive: true, once: true });

    const onResize = () => {
      if (main.dataset.introChrome === 'ready') {
        fitCanvas();
        drawTrails();
      } else {
        skip();
      }
    };
    window.addEventListener('resize', onResize);

    void run();

    return () => {
      cancelled = true;
      window.clearInterval(progressTimer);
      for (const cancel of cancels) cancel();
      cancels.clear();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', skip);
      window.removeEventListener('resize', onResize);
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
      main.classList.remove('intro-chrome-building');
      if (main.dataset.introChrome !== 'ready') main.dataset.introChrome = 'ready';
      sage.style.opacity = '0';
      plum.style.opacity = '0';
      headerBox.style.opacity = '0';
      pagerBox.style.opacity = '0';
      ctx.clearRect(0, 0, rootRect.width, rootRect.height);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      data-intro-chrome-layer
      className={
        phase === 'ready'
          ? 'pointer-events-none invisible absolute inset-0 z-[160] opacity-0'
          : 'absolute inset-0 z-[160]'
      }
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 h-full w-full opacity-70 mix-blend-multiply"
      />
      <div ref={headerBoxRef} aria-hidden="true" className="weave-marquee" />
      <div ref={pagerBoxRef} aria-hidden="true" className="weave-marquee" />
      <div
        ref={sageRef}
        aria-hidden="true"
        className="weave-cursor absolute left-0 top-0"
        style={{ color: COLORS.sage, opacity: 0 }}
      >
        <CursorSvg />
      </div>
      <div
        ref={plumRef}
        aria-hidden="true"
        className="weave-cursor absolute left-0 top-0"
        style={{ color: COLORS.plum, opacity: 0 }}
      >
        <CursorSvg />
      </div>
      {phase === 'preloading' || phase === 'leaving' ? (
        <div className={`home-loader${phase === 'leaving' ? ' is-out' : ''}`} role="status" aria-live="polite">
          <div className="home-loader__inner">
            <div className="home-loader__brand">
              <Mark className="h-8 w-8" />
              <span>
                织境
                <small>LOOMSCAPE / HOME</small>
              </span>
            </div>
            <div className="home-loader__percent">
              {String(progress).padStart(2, '0')}
              <span>%</span>
            </div>
            <div
              className="home-loader__bar"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="首页加载进度"
            >
              <span style={{ transform: `scaleX(${progress / 100})` }} />
            </div>
            <p>{modelStage || '正在预载首页'}</p>
            <span className="home-loader__meta">GEMMA 3 · CURSOR · LAYOUT</span>
          </div>
        </div>
      ) : null}
      {phase === 'drawing' ? (
        <button type="button" onClick={() => skipRef.current()} className="home-build-skip pointer-events-auto">
          跳过绘制
        </button>
      ) : null}
    </div>
  );
}
