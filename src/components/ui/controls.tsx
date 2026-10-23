'use client';

import { useId } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  size = 'md',
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const id = useId();

  return (
    <div
      role="tablist"
      className={cn('neu-inset-sm inline-flex rounded-full p-1', className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'relative rounded-full font-medium transition-colors duration-300',
              size === 'sm' ? 'h-7 px-3 text-[11.5px]' : 'h-8 px-4 text-[12.5px]',
              active ? 'text-ink' : 'text-muted hover:text-ink/80',
            )}
          >
            {active ? (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-full bg-[rgb(var(--paper))] shadow-[2px_2px_6px_rgba(158,172,192,0.4),-2px_-2px_5px_rgba(255,255,255,0.9)]"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            ) : null}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-ink">{label}</div>
        {description ? (
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-7 w-12 shrink-0 rounded-full transition-all duration-300 ease-weave',
          checked ? 'neu-inset-sm' : 'neu-sm',
        )}
      >
        <motion.span
          className="absolute top-1 h-5 w-5 rounded-full bg-[rgb(var(--paper))] shadow-[1px_1px_4px_rgba(150,164,184,0.6),-1px_-1px_3px_rgba(255,255,255,0.9)]"
          animate={{ left: checked ? 24 : 4 }}
          transition={{ type: 'spring', stiffness: 520, damping: 32 }}
        >
          <span
            className={cn(
              'absolute inset-[7px] rounded-full transition-colors duration-300',
              checked ? 'bg-[rgb(var(--accent))]' : 'bg-muted/35',
            )}
          />
        </motion.span>
      </button>
    </div>
  );
}

export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  label,
  display,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (next: number) => void;
  label: string;
  display?: string;
}) {
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-[12px] font-medium tracking-wide text-muted">{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-ink/70">{display ?? value}</span>
      </div>
      <input
        type="range"
        className="range w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}
