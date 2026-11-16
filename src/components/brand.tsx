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

export function Wordmark({
  className,
  compact = false,
  tone = 'ink',
  size = 'md',
  showMark = true,
}: {
  className?: string;
  compact?: boolean;
  tone?: 'ink' | 'light';
  /** `sm` is for the workspace rail, where vertical room belongs to the nav. */
  size?: 'md' | 'sm';
  /** The workspace uses the wordmark without the square glyph. */
  showMark?: boolean;
}) {
  const light = tone === 'light';
  const small = size === 'sm';
  return (
    <span
      className={cn(
        'flex items-center gap-3',
        light ? 'text-[#F2EEEA]' : 'text-ink',
        className,
      )}
    >
      {showMark ? <Mark className={small ? 'h-[22px] w-[22px]' : 'h-[28px] w-[28px]'} /> : null}
      <span className="flex flex-col leading-none">
        <span className={cn('font-serif tracking-[0.08em]', small ? 'text-[14px]' : 'text-[16px]')}>
          织境
        </span>
        {compact ? null : (
          <span
            className={cn(
              'mt-1 font-mono uppercase',
              small ? 'text-[7.5px] tracking-[0.28em]' : 'text-[9px] tracking-[0.32em]',
              light ? 'text-[#F2EEEA]/50' : 'text-muted/85',
            )}
          >
            Loomscape
          </span>
        )}
      </span>
    </span>
  );
}
