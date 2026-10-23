'use client';

import { forwardRef } from 'react';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const fieldBase =
  'w-full rounded-xl bg-[rgb(var(--sunken))] px-3.5 text-sm text-ink placeholder:text-muted/55 ' +
  'shadow-[var(--shadow-inset-sm)] outline-none transition-shadow duration-300 ' +
  'focus:shadow-[var(--shadow-inset),0_0_0_2px_rgba(38,62,92,0.18)]';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(fieldBase, 'h-11', className)} {...props} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(fieldBase, 'resize-none py-3 leading-relaxed', className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(fieldBase, 'h-11 appearance-none pr-9', className)}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5 6 6.5 11 1.5' fill='none' stroke='%236a7484' stroke-width='1.4' stroke-linecap='round'/%3E%3C/svg%3E\")",
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 0.9rem center',
        }}
        {...props}
      >
        {children}
      </select>
    );
  },
);

export function Label({ children, className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('mb-2 block text-[12px] font-medium tracking-wide text-muted', className)}
      {...props}
    >
      {children}
    </label>
  );
}

export function Hint({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('mt-2 text-[11.5px] leading-relaxed text-muted/80', className)}>{children}</p>;
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      {children}
      {hint ? <Hint>{hint}</Hint> : null}
    </div>
  );
}
