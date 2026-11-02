'use client';

import { useEffect } from 'react';

/**
 * Registers the offline shell. Production only: a service worker in `next dev`
 * serves yesterday's chunks after a rebuild, which looks like a broken build.
 *
 * The version rides along in the query string so every release installs a new
 * worker and clears the previous shell; without it `sw.js` is byte-identical
 * across deploys and the browser keeps the old cache name.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const version = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev';
    const register = () => {
      navigator.serviceWorker
        .register(`/sw.js?v=${encodeURIComponent(version)}`, { scope: '/' })
        .catch(() => {
          // An offline shell is a bonus; a blocked registration must not
          // surface as an error in a run that otherwise works.
        });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
