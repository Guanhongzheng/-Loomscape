import { cn } from '@/lib/cn';

export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 26 26" className={className} fill="none" aria-hidden="true">
      <rect x="0.5" y="0.5" width="25" height="25" rx="7" stroke="currentColor" strokeOpacity="0.22" />
      <path d="M7 7.5v11M13 7.5v11M19 7.5v11" stroke="currentColor" strokeWidth="0.9" strokeOpacity="0.35" />
      <path
        d="M5.2 10.6c2-.9 2.8 1.2 4.6 0.9s2.4 1.6 4.4 0.8 2.6 1.4 5.2 0.4"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
      />
      <path
        d="M5.2 15.4c2 .9 2.8-1.2 4.6-0.9s2.4-1.6 4.4-0.8 2.6-1.4 5.2-0.4"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
        strokeOpacity="0.55"
      />
    </svg>
  );
}

export function Wordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('flex items-center gap-3 text-ink', className)}>
      <Mark className="h-[26px] w-[26px]" />
      <span className="flex flex-col leading-none">
        <span className="font-serif text-[15px] tracking-[0.08em]">织境</span>
        {compact ? null : (
          <span className="mt-1 font-mono text-[8.5px] uppercase tracking-[0.32em] text-muted/80">
            Loomscape
          </span>
        )}
      </span>
    </span>
  );
}
