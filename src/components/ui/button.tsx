'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'soft' | 'ghost' | 'inset';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const variants: Record<Variant, string> = {
  primary:
    'bg-[rgb(var(--accent))] text-[rgb(var(--paper))] shadow-[0_10px_24px_rgba(38,62,92,0.28),inset_0_1px_0_rgba(255,255,255,0.18)] hover:bg-[rgb(var(--accent))]/92 active:translate-y-px',
  soft: 'neu neu-press text-ink',
  ghost: 'text-muted hover:text-ink hover:bg-[rgb(var(--surface))]/70',
  inset: 'neu-inset-sm text-ink',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-[13px] gap-1.5 rounded-xl',
  md: 'h-11 px-5 text-sm gap-2 rounded-2xl',
  lg: 'h-[3.25rem] px-7 text-[15px] gap-2.5 rounded-2xl',
  icon: 'h-10 w-10 rounded-xl justify-center',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'soft', size = 'md', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium',
        'transition-[transform,box-shadow,background-color,color] duration-300 ease-weave',
        'disabled:pointer-events-none disabled:opacity-45',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});
