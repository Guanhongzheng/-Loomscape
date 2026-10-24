'use client';

import { cn } from '@/lib/cn';

/**
 * Cold-start curtain for the entry page. Rendered on the server so the very
 * first paint is already a skeleton instead of a half-styled document; it
 * fades out once fonts are ready and the reveal animation can play.
 *
 * Dimensions mirror the hero grid on purpose — the swap must not move a pixel.
 */
export function IntroBootSkeleton({ visible }: { visible: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'boot-curtain fixed inset-0 z-[150] overflow-hidden bg-[rgb(var(--paper))]',
        'transition-opacity duration-500 ease-weave',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_18%_12%,rgba(255,255,255,0.95),transparent_58%),radial-gradient(90%_70%_at_88%_82%,rgba(176,122,74,0.06),transparent_62%)]" />

      <div className="absolute inset-x-0 top-0 h-[2px] overflow-hidden">
        <span className="boot-bar block h-full w-1/3 rounded-full bg-[rgb(var(--accent))]/45" />
      </div>

      {/* navigation */}
      <div className="mx-auto flex max-w-[1320px] items-center justify-between px-6 py-5 md:px-9 md:py-6">
        <div className="flex items-center gap-3">
          <div className="skeleton h-[26px] w-[26px] rounded-[7px]" />
          <div className="skeleton h-3 w-20 rounded-full" />
          <div className="skeleton hidden h-2 w-16 rounded-full sm:block" />
        </div>
        <div className="hidden items-center gap-3 md:flex">
          {[36, 28, 28, 28].map((width, index) => (
            <div
              key={index}
              className="skeleton h-3 rounded-full"
              style={{ width, animationDelay: `${index * 80}ms` }}
            />
          ))}
        </div>
        <div className="skeleton h-2.5 w-24 rounded-full" />
      </div>

      {/* hero */}
      <div className="mx-auto grid h-[calc(100dvh-88px)] w-full max-w-[1180px] grid-cols-1 items-center gap-12 px-7 pb-28 md:grid-cols-12 md:gap-14 md:px-10">
        <div className="md:col-span-7">
          <div className="flex items-center gap-3">
            <div className="skeleton h-px w-8 rounded-full" />
            <div className="skeleton h-2.5 w-44 rounded-full" />
          </div>

          <div className="mt-7 space-y-4">
            <div className="skeleton h-[clamp(2.6rem,5.2vw,4.5rem)] w-[86%] rounded-xl" />
            <div
              className="skeleton h-[clamp(2.6rem,5.2vw,4.5rem)] w-[62%] rounded-xl"
              style={{ animationDelay: '120ms' }}
            />
          </div>

          <div className="mt-8 max-w-[46ch] space-y-2.5">
            <div className="skeleton h-3 w-full rounded-full" />
            <div className="skeleton h-3 w-[92%] rounded-full" style={{ animationDelay: '60ms' }} />
            <div className="skeleton h-3 w-[74%] rounded-full" style={{ animationDelay: '120ms' }} />
          </div>

          <div className="mt-10 flex items-center gap-3">
            <div className="skeleton h-[3.25rem] w-40 rounded-2xl" />
            <div className="skeleton h-[3.25rem] w-24 rounded-2xl" style={{ animationDelay: '90ms' }} />
          </div>
        </div>

        <div className="hidden md:col-span-5 md:block">
          <div className="neu rounded-[26px] p-7">
            <div className="flex items-center justify-between">
              <div className="skeleton h-2.5 w-14 rounded-full" />
              <div className="skeleton h-2.5 w-12 rounded-full" />
            </div>
            <div className="mt-7 space-y-5">
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="flex items-center gap-4">
                  <div className="skeleton h-2.5 w-5 rounded-full" />
                  <div className="skeleton h-4 w-12 rounded-md" />
                  <div
                    className="skeleton ml-auto h-2.5 w-28 rounded-full"
                    style={{ animationDelay: `${row * 70}ms` }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-7 flex items-center gap-2 border-t border-[rgb(var(--line))]/60 pt-4">
              <div className="skeleton h-2.5 w-2.5 rounded-full" />
              <div className="skeleton h-2.5 w-40 rounded-full" />
            </div>
          </div>
        </div>
      </div>

      {/* dock */}
      <div className="absolute inset-x-0 bottom-0 flex justify-center pb-5 md:pb-6">
        <div className="flex items-center gap-3 rounded-full bg-[rgb(var(--paper))]/85 p-2 pl-3 shadow-[0_18px_44px_-18px_rgba(30,42,60,0.4)] backdrop-blur-md">
          <div className="skeleton h-7 w-20 rounded-full" />
          <span className="h-5 w-px bg-[rgb(var(--line))]" />
          <div className="hidden items-center gap-2 sm:flex">
            <div className="skeleton h-1.5 w-5 rounded-full" />
            <div className="skeleton h-1.5 w-1.5 rounded-full" />
            <div className="skeleton h-1.5 w-1.5 rounded-full" />
            <div className="skeleton h-1.5 w-1.5 rounded-full" />
          </div>
          <div className="skeleton h-9 w-28 rounded-full" />
        </div>
      </div>
    </div>
  );
}
