'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

const EXIT_MS = 220;

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  width = 'max-w-md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  width?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [present, setPresent] = useState(open);
  const panelRef = useRef<HTMLDivElement>(null);

  // Callers pass an inline arrow, so this identity changes on every keystroke.
  // Keeping it in a ref lets the setup effect depend on `open` alone: it used
  // to re-run on each render and, 80ms later, pull focus onto the close button,
  // which is why a controlled input accepted exactly one character.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => setMounted(true), []);

  /**
   * AnimatePresence used to own the unmount and it could stall: when the
   * consumer's tree changed in the same commit as `open: true → false` — which
   * a successful login does exactly — the panel faded to opacity 0 but was
   * never removed. What stayed behind was a full-screen backdrop with
   * `pointer-events: auto` that swallowed every later click, so the app looked
   * frozen. A timer owns the unmount now, so a missed animation callback cannot
   * leave a ghost.
   */
  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    const timer = window.setTimeout(() => setPresent(false), EXIT_MS + 40);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => {
      // Prefer a field over the close button that happens to come first in DOM order.
      const field = panelRef.current?.querySelector<HTMLElement>(
        'input:not([type="hidden"]), textarea, select, [data-autofocus]',
      );
      (field ?? panelRef.current)?.focus();
    }, 80);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      window.clearTimeout(timer);
    };
  }, [open]);

  if (!mounted || !present) return null;

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-[90] flex items-center justify-center p-5',
        !open && 'pointer-events-none',
      )}
      aria-hidden={!open}
    >
      <motion.div
        className="absolute inset-0 bg-[rgba(28,35,46,0.22)] backdrop-blur-[6px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: open ? 1 : 0 }}
        transition={{ duration: open ? 0.25 : EXIT_MS / 1000 }}
        onClick={onClose}
      />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'relative w-full rounded-[26px] bg-[rgb(var(--paper))] p-7 outline-none',
          'shadow-[0_40px_90px_-24px_rgba(28,38,54,0.45),inset_0_1px_0_rgba(255,255,255,0.9)]',
          width,
        )}
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={open ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 10, scale: 0.985 }}
        transition={{ duration: open ? 0.32 : EXIT_MS / 1000, ease: [0.22, 1, 0.36, 1] }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="absolute right-5 top-5 grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-[rgb(var(--sunken))] hover:text-ink"
        >
          <X size={15} strokeWidth={1.7} />
        </button>
        <h2 className="pr-10 font-serif text-[22px] tracking-tight text-ink">{title}</h2>
        {description ? (
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{description}</p>
        ) : null}
        <div className="mt-6">{children}</div>
      </motion.div>
    </div>,
    document.body,
  );
}
