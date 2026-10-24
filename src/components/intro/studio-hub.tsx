'use client';

import Link from 'next/link';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { WORKBENCHES } from '@/lib/workbenches';
import { motion } from 'framer-motion';

export function StudioHub({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-[1560px] flex-col justify-start px-5 pb-24 pt-20 md:justify-center md:px-8 md:pb-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 font-mono text-[10.5px] uppercase tracking-[0.34em] text-muted">
            <span className="h-px w-8 bg-[rgb(var(--line))]" />
            Workspace
          </div>
          <h2 className="mt-4 font-serif text-[clamp(1.9rem,3vw,2.9rem)] leading-[1.2] text-ink">
            七个工作面，一条流水线。
          </h2>
        </div>

        <button
          type="button"
          onClick={onOpen}
          className="group inline-flex items-center gap-2 rounded-full bg-[rgb(var(--surface))] px-4 py-2.5 text-[12.5px] text-ink shadow-[var(--shadow-neu-sm)] transition-shadow duration-300 hover:shadow-[var(--shadow-neu)]"
        >
          打开完整工作台
          <ArrowRight size={14} className="transition-transform duration-300 group-hover:translate-x-0.5" />
        </button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
        {WORKBENCHES.map((tile, i) => {
          const Icon = tile.icon;
          return (
            <motion.div
              key={tile.href}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.03 * i, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className={tile.span}
            >
              <Link
                href={tile.href}
                className="neu neu-press group relative flex h-full min-h-[96px] flex-col overflow-hidden rounded-2xl p-3.5 sm:min-h-[148px] sm:p-4"
              >
                <div className="flex items-start justify-between">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-[rgb(var(--sunken))]/70 text-[rgb(var(--accent))] shadow-[var(--shadow-inset-sm)]">
                    <Icon size={15} strokeWidth={1.6} />
                  </span>
                  <span className="font-mono text-[9px] tracking-[0.2em] text-muted/45">
                    {tile.index}
                  </span>
                </div>

                <h3 className="mt-2.5 font-serif text-[15px] text-ink sm:mt-3 sm:text-[17px]">
                  {tile.title}
                </h3>
                <p className="mt-1 hidden max-w-[34ch] text-[11px] leading-[1.7] text-muted sm:block">
                  {tile.desc}
                </p>

                <div className="mt-auto hidden items-center justify-between pt-3 sm:flex">
                  <span className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-muted/50">
                    {tile.meta}
                  </span>
                  <ArrowUpRight
                    size={12}
                    className="text-muted/35 transition-all duration-300 group-hover:-translate-y-0.5 group-hover:text-[rgb(var(--copper))]"
                  />
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>

      <div className="mt-7 flex flex-wrap items-center justify-between gap-2 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted/55">
        <span>本地优先 · 无云端副本 · 密钥不出浏览器</span>
        <span>05 / 05</span>
      </div>
    </div>
  );
}
