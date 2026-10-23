'use client';

import { create } from 'zustand';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Info, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';

type Tone = 'info' | 'success' | 'error';
type Toast = { id: string; message: string; tone: Tone };

const useToasts = create<{
  items: Toast[];
  push: (message: string, tone: Tone) => void;
  drop: (id: string) => void;
}>((set) => ({
  items: [],
  push: (message, tone) => {
    const id = Math.random().toString(36).slice(2, 9);
    set((state) => ({ items: [...state.items.slice(-2), { id, message, tone }] }));
    window.setTimeout(() => {
      set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
    }, 3600);
  },
  drop: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
}));

export function toast(message: string, tone: Tone = 'info') {
  useToasts.getState().push(message, tone);
}

const icons = {
  info: Info,
  success: Check,
  error: TriangleAlert,
} as const;

export function Toaster() {
  const items = useToasts((state) => state.items);

  return (
    <div className="pointer-events-none fixed bottom-7 left-1/2 z-[120] flex -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence>
        {items.map((item) => {
          const Icon = icons[item.tone];
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                'pointer-events-auto flex items-center gap-2.5 rounded-full bg-[rgb(var(--paper))] px-4 py-2.5',
                'text-[12.5px] shadow-[0_18px_40px_-12px_rgba(30,40,56,0.4),inset_0_1px_0_rgba(255,255,255,0.9)]',
                item.tone === 'error' ? 'text-[#8c3b32]' : 'text-ink',
              )}
            >
              <Icon
                size={14}
                strokeWidth={2}
                className={cn(
                  item.tone === 'success' && 'text-[#3f6b4f]',
                  item.tone === 'error' && 'text-[#a24a3f]',
                  item.tone === 'info' && 'text-muted',
                )}
              />
              {item.message}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
