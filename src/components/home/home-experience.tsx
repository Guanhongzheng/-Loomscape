'use client';

import { useCallback, useEffect, useRef } from 'react';
import { IntroExperience } from '@/components/intro/intro-experience';
import { StudioShell } from '@/components/studio/shell';
import { StudioOverview } from '@/components/studio/overview';

/**
 * Two screens on one page: the intro pages sideways, the workspace sits one
 * screen below and is reached by a vertical snap rather than a route change.
 */
export function HomeExperience() {
  const rootRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);

  const enterWorkspace = useCallback(() => {
    const root = rootRef.current;
    const target = workspaceRef.current;
    if (!root || !target) return;
    root.scrollTo({ top: target.offsetTop, behavior: 'smooth' });
  }, []);

  const backToIntro = useCallback(() => {
    rootRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const jump = () => {
      const target = workspaceRef.current;
      const root = rootRef.current;
      if (!target || !root) return;
      root.scrollTo({ top: target.offsetTop, behavior: 'auto' });
    };

    if (window.location.hash === '#workspace') jump();

    const onHash = () => {
      if (window.location.hash === '#workspace') jump();
      if (window.location.hash === '#intro') rootRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div
      ref={rootRef}
      className="h-[100dvh] w-full snap-y snap-mandatory overflow-y-auto overflow-x-hidden bg-[rgb(var(--paper))]"
    >
      <section id="intro" className="h-[100dvh] w-full snap-start snap-always">
        <IntroExperience onEnter={enterWorkspace} />
      </section>

      <section
        ref={workspaceRef}
        id="workspace"
        className="h-[100dvh] w-full snap-start snap-always"
      >
        <StudioShell overviewHref="#workspace" homeHref="#intro" onHome={backToIntro}>
          <StudioOverview />
        </StudioShell>
      </section>
    </div>
  );
}
