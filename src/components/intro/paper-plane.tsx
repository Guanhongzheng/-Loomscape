'use client';

import { motion, useTransform, type MotionValue } from 'framer-motion';

/**
 * Decorative flight path across the entry page. Position is driven by the
 * pager's scroll progress, so it stays in sync with the snap animation rather
 * than with a timeline of its own. `left` / `top` percentages resolve against
 * the viewport for fixed elements, which keeps it correct at any window size.
 */
export function PaperPlane({ progress }: { progress: MotionValue<number> }) {
  const stops = [0, 0.24, 0.48, 0.74, 1];

  const left = useTransform(progress, stops, ['7%', '28%', '50%', '76%', '90%']);
  const top = useTransform(progress, stops, ['80%', '84%', '85%', '70%', '16%']);
  const rotate = useTransform(progress, [0, 0.3, 0.62, 1], [-5, 3, -7, 2]);
  const scale = useTransform(progress, [0, 0.5, 1], [1, 0.82, 0.6]);
  const opacity = useTransform(progress, [0, 0.88, 0.97, 1], [1, 1, 0.55, 0]);

  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none absolute z-30 h-12 w-12 will-change-transform"
      style={{ left, top, rotate, scale, opacity }}
    >
      <div className="animate-float">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <defs>
            <linearGradient id="plane-face" x1="8" y1="34" x2="40" y2="10" gradientUnits="userSpaceOnUse">
              <stop stopColor="#f8fafc" />
              <stop offset="1" stopColor="#dee4ec" />
            </linearGradient>
            <filter id="plane-shadow" x="-40%" y="-40%" width="180%" height="180%">
              <feDropShadow dx="1.5" dy="3" stdDeviation="2.4" floodColor="#2b3648" floodOpacity="0.2" />
            </filter>
          </defs>
          <g filter="url(#plane-shadow)">
            <path d="M5 22.4 43 7.2 28.6 41.2 22.1 27.6 5 22.4Z" fill="url(#plane-face)" />
            <path d="M22.1 27.6 43 7.2 25.9 24.9 22.1 27.6Z" fill="#eef2f7" />
            <path
              d="M5 22.4 43 7.2 28.6 41.2 22.1 27.6 5 22.4Z"
              stroke="#8d9aab"
              strokeOpacity="0.55"
              strokeWidth="0.9"
              strokeLinejoin="round"
            />
            <path d="M22.1 27.6 25.9 24.9" stroke="#8d9aab" strokeOpacity="0.5" strokeWidth="0.8" />
          </g>
        </svg>
      </div>
    </motion.div>
  );
}

export function FlightPath({ progress }: { progress: MotionValue<number> }) {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <motion.path
        d="M7 80 C 30 90, 58 89, 72 66 S 86 33, 90 16"
        fill="none"
        stroke="#5c6b80"
        strokeOpacity="0.28"
        strokeWidth="1"
        strokeDasharray="2 6"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        style={{ pathLength: progress }}
        pathLength={1}
      />
    </svg>
  );
}
