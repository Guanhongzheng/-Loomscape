'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

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
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => {
      const focusable = panelRef.current?.querySelector<HTMLElement>(
        'input, textarea, select, button, [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    }, 80);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      window.clearTimeout(timer);
    };
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-5">
          <motion.div
            className="absolute inset-0 bg-[rgba(28,35,46,0.22)] backdrop-blur-[6px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn(
              'relative w-full rounded-[26px] bg-[rgb(var(--paper))] p-7',
              'shadow-[0_40px_90px_-24px_rgba(28,38,54,0.45),inset_0_1px_0_rgba(255,255,255,0.9)]',
              width,
            )}
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.985 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
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
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
