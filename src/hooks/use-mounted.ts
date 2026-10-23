'use client';

import { useEffect, useState } from 'react';

/** True only after the first client render, for values that differ per session. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
