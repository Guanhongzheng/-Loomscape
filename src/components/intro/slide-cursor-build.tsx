'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

const COLORS = ['#4d7a5c', '#a8703f', '#526f8f', '#8b6b83', '#b28a52'] as const;
const DURATIONS = [760, 1080, 880, 1160, 820] as const;
const DELAYS = [0, 60, 120, 180, 240] as const;

const CURSOR_PATH = 'M3.5 2.5 19 11.5l-7 1.9L9.5 21 3.5 2.5Z';

type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

const easeInOut = (value: number) =>
  value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;

export function SlideCursorBuild({ active, children }: { active: boolean; children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRefs = useRef<Array<HTMLDivElement | null>>([]);
  const boxRefs = useRef<Array<HTMLDivElement | null>>([]);
  const startedRef = useRef(false);
  const finishedRef = useRef(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!active || startedRef.current) return;
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const main = root?.closest('main');
    if (!root || !canvas || !main) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-slide-reveal]')).filter(
      (target) => {
        const rect = target.getBoundingClientRect();
        return rect.width > 2 && rect.height > 2;
      },
    );
    if (targets.length === 0) {
      root.classList.remove('slide-cursor-building');
      finishedRef.current = true;
      setDone(true);
      return;
    }

    const cursors = cursorRefs.current.slice(0, 5);
    const boxes = boxRefs.current.slice(0, 5);
    if (cursors.some((cursor) => !cursor) || boxes.some((box) => !box)) return;

    let cancelled = false;
    let rootRect = root.getBoundingClientRect();
    const timers = new Set<number>();
    const cancels = new Set<() => void>();
    const positions = new Map<HTMLDivElement, Point>();
    const trails = new Map<HTMLDivElement, Point[]>();

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
      cursors.forEach((cursor, index) => {
        if (!cursor) return;
        const points = trails.get(cursor) ?? [];
        for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
          const strength = pointIndex / points.length;
          ctx.globalAlpha = 0.03 + strength * 0.27;
          ctx.strokeStyle = COLORS[index % COLORS.length];
          ctx.lineWidth = 0.8 + strength;
          ctx.beginPath();
          ctx.moveTo(points[pointIndex - 1].x, points[pointIndex - 1].y);
          ctx.lineTo(points[pointIndex].x, points[pointIndex].y);
          ctx.stroke();
        }
      });
      ctx.globalAlpha = 1;
    };

    const setCursor = (cursor: HTMLDivElement, point: Point) => {
      positions.set(cursor, point);
      cursor.style.transform = `translate3d(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px, 0)`;
    };

    const addTrail = (cursor: HTMLDivElement, point: Point) => {
      const points = trails.get(cursor) ?? [];
      points.push(point);
      while (points.length > 14) points.shift();
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
      const x = Math.max(4, rect.left - rootRect.left - 7);
      const y = Math.max(4, rect.top - rootRect.top - 7);
      return {
        x,
        y,
        w: Math.min(rootRect.width - x - 4, rect.width + 14),
        h: Math.min(rootRect.height - y - 4, rect.height + 14),
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

    const run = async () => {
      startedRef.current = true;
      root.classList.add('slide-cursor-building');
      fitCanvas();

      const drawable = targets.slice(0, 5).map((target, index) => ({
        target,
        index,
        cursor: cursors[index]!,
        box: boxes[index]!,
        color: COLORS[index % COLORS.length],
        duration: DURATIONS[index % DURATIONS.length],
        delay: DELAYS[index % DELAYS.length],
        direction: index % 2 === 0 ? ('ltr' as const) : ('rtl' as const),
      }));

      for (const item of drawable) {
        setCursor(item.cursor, {
          x: item.direction === 'ltr' ? 12 : rootRect.width - 24,
          y: rootRect.height - 26,
        });
        item.cursor.style.opacity = '1';
      }

      await wait(160);

      await Promise.all(
        drawable.map(async (item) => {
          await wait(item.delay);
          if (cancelled) return;
          const rect = rectOf(item.target);
          const ltr = item.direction === 'ltr';
          const from = ltr ? { x: rect.x, y: rect.y } : { x: rect.x + rect.w, y: rect.y };
          const to = ltr
            ? { x: rect.x + rect.w, y: rect.y + rect.h }
            : { x: rect.x, y: rect.y + rect.h };

          item.box.style.setProperty('--c', item.color);
          item.box.style.top = `${rect.y}px`;
          item.box.style.left = `${from.x}px`;
          item.box.style.width = '0px';
          item.box.style.height = '0px';
          item.box.style.opacity = '0';

          await tween(item.cursor, from, 240);
          if (cancelled) return;
          pulse(from, item.color);
          item.box.style.opacity = '1';
          await tween(item.cursor, to, item.duration, (point) => {
            if (ltr) {
              item.box.style.left = `${rect.x}px`;
              item.box.style.width = `${Math.max(0, point.x - rect.x)}px`;
            } else {
              item.box.style.left = `${point.x}px`;
              item.box.style.width = `${Math.max(0, rect.x + rect.w - point.x)}px`;
            }
            item.box.style.height = `${Math.max(0, point.y - rect.y)}px`;
          });
          if (cancelled) return;
          item.target.classList.add('is-revealed');
          pulse(to, item.color);
          await wait(180);
          // Each cursor leaves together with its own box.
          item.cursor.style.opacity = '0';
          item.box.style.opacity = '0';
        }),
      );

      if (cancelled) return;
      for (const target of targets) target.classList.add('is-revealed');
      await wait(140);
      root.classList.remove('slide-cursor-building');
      finishedRef.current = true;
      setDone(true);
      ctx.clearRect(0, 0, rootRect.width, rootRect.height);
    };

    let startTimer = 0;
    const queueStart = () => {
      startTimer = window.setTimeout(() => {
        if (!cancelled) void run();
      }, 420);
    };
    const onChromeReady = () => queueStart();
    if (main.dataset.introChrome === 'ready') {
      queueStart();
    } else {
      window.addEventListener('intro-chrome-ready', onChromeReady, { once: true });
    }

    const onResize = () => {
      if (cancelled) return;
      fitCanvas();
      drawTrails();
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelled = true;
      if (!finishedRef.current) startedRef.current = false;
      window.clearTimeout(startTimer);
      window.removeEventListener('intro-chrome-ready', onChromeReady);
      window.removeEventListener('resize', onResize);
      for (const cancel of cancels) cancel();
      cancels.clear();
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
      for (const cursor of cursors) if (cursor) cursor.style.opacity = '0';
      for (const box of boxes) if (box) box.style.opacity = '0';
      ctx.clearRect(0, 0, rootRect.width, rootRect.height);
    };
  }, [active]);

  return (
    <div
      ref={rootRef}
      data-slide-cursor-layer
      className={done ? 'relative h-full' : 'relative h-full slide-cursor-building'}
    >
      {children}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-30 h-full w-full opacity-70 mix-blend-multiply"
      />
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={`box-${index}`}
          ref={(node) => {
            boxRefs.current[index] = node;
          }}
          aria-hidden="true"
          className="weave-marquee"
        />
      ))}
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={`cursor-${index}`}
          ref={(node) => {
            cursorRefs.current[index] = node;
          }}
          aria-hidden="true"
          className="weave-cursor absolute left-0 top-0"
          style={{ color: COLORS[index % COLORS.length], opacity: 0 }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={CURSOR_PATH} fill="currentColor" />
            <path d="M4.5 4.8 8.7 17l1.8-4.3 4.2-1.1L4.5 4.8Z" fill="rgb(255 255 255 / 0.6)" />
          </svg>
        </div>
      ))}
    </div>
  );
}
