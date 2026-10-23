import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type CardProps = HTMLAttributes<HTMLDivElement> & {
  inset?: boolean;
  tone?: 'raised' | 'flat';
};

export function Card({ className, inset = false, tone = 'raised', ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl',
        inset ? 'neu-inset' : tone === 'flat' ? 'neu-flat' : 'neu',
        className,
      )}
      {...props}
    />
  );
}

export function SectionLabel({ className, children }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'font-mono text-[10px] uppercase tracking-[0.32em] text-muted/80',
        className,
      )}
    >
      {children}
    </div>
  );
}
