'use client';

import { MotionConfig } from 'framer-motion';

/**
 * Respects `prefers-reduced-motion`. Every spring and layout animation in the
 * app goes through framer-motion, so one provider covers them: with the OS
 * setting on, transforms and layout shifts are skipped while opacity is kept.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
