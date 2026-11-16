'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'soft' | 'ghost' | 'inset';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const variants: Record<Variant, string> = {
  primary:
    'border border-[rgb(var(--accent))]/25 bg-white/65 text-[rgb(var(--accent))] shadow-[0_12px_28px_-20px_rgba(116,103,151,0.45)] backdrop-blur-md hover:bg-white/85 active:translate-y-px',
  soft: 'neu neu-press text-ink',
  ghost: 'text-muted hover:text-ink hover:bg-[rgb(var(--surface))]/70',
  inset: 'neu-inset-sm text-ink',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-[13px] gap-1.5 rounded-xl',
  md: 'h-11 px-5 text-[13.5px] gap-2 rounded-xl',
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
