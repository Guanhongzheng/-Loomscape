'use client';

import { motion, useReducedMotion, useTransform, type MotionValue } from 'framer-motion';

const CURSOR_PATH = 'M3.5 2.5 19 11.5l-7 1.9L9.5 21 3.5 2.5Z';

const STOPS = [0, 1 / 3, 2 / 3, 1];

/**
 * The persistent browser-agent pointer. Its position is driven by the pager's
 * own progress, so it glides between the four intro spreads instead of running
 * on an unrelated timeline.
 */
export function AiCursor({ progress }: { progress: MotionValue<number> }) {
  const reduceMotion = useReducedMotion();
  const left = useTransform(progress, STOPS, ['75%', '70%', '82%', '78%']);
  const top = useTransform(progress, STOPS, ['61%', '55%', '72%', '76%']);
  const rotate = useTransform(progress, STOPS, [-4, 2, -3, 1]);
  const opacity = useTransform(progress, [0, 0.96, 1], [1, 1, 0.9]);

  return (
    <motion.div
      aria-hidden="true"
      data-intro-ai-guide
      className="pointer-events-none absolute z-30 h-8 w-8 will-change-transform"
      style={{ left, top, rotate, opacity }}
    >
      <motion.div
        animate={reduceMotion ? undefined : { y: [0, -2.5, 0] }}
        transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <div className="ai-cursor relative">
          <span className="ai-cursor__ring" />
          <svg viewBox="0 0 24 24">
            <path d={CURSOR_PATH} fill="rgb(var(--copper))" />
            <path d="M4.5 4.8 8.7 17l1.8-4.3 4.2-1.1L4.5 4.8Z" fill="rgb(255 255 255 / 0.68)" />
          </svg>
          <span className="ai-cursor__tag">AI</span>
          <span className="ai-cursor__caption">browser cursor</span>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function AiCursorTrail({ progress }: { progress: MotionValue<number> }) {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <motion.path
        d="M75 61 C 72 58, 70 55, 70 55 S 77 63, 82 72 S 79 75, 78 76"
        fill="none"
        stroke="rgb(var(--copper))"
        strokeOpacity="0.3"
        strokeWidth="1"
        strokeDasharray="1 7"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        style={{ pathLength: progress }}
        pathLength={1}
      />
    </svg>
  );
}
