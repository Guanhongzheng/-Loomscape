'use client';

import { Check, MousePointer2 } from 'lucide-react';
import { cn } from '@/lib/cn';

const TASK_STEPS = [
  { index: '01', title: '看见', detail: '12 个可操作元素', state: 'done' },
  { index: '02', title: '找到', detail: '「整理成提纲」', state: 'done' },
  { index: '03', title: '确认', detail: '这一步等你', state: 'active' },
] as const;

/**
 * The cursor demo, drawn on the same frosted plate as the other three stages.
 * No nested card: the brief sits in a plain panel, the trace rows use the same
 * `bg-white/45` chip as the citation rows on the retrieval slide.
 */
export function HomePreview() {
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-[0.24em] text-muted/55">
          current page · 01 / brief
        </span>
        <span className="flex items-center gap-1.5 rounded-full border border-white/55 bg-white/35 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[rgb(var(--copper))]">
          <span className="h-1 w-1 rounded-full bg-[rgb(var(--copper))]" />
          cursor live
        </span>
      </div>

      <div className="mt-3 rounded-xl border border-white/55 bg-white/45 p-3.5 backdrop-blur-sm">
        <h3 className="text-[19px] font-semibold leading-[1.3] text-ink">
          这周的选题，
          <br />
          先整理成一份提纲。
        </h3>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="relative inline-flex items-center gap-2 rounded-lg border border-[rgb(var(--copper))]/45 bg-white/70 px-3 py-1.5 text-[11px] font-medium text-ink">
            <MousePointer2 size={12} strokeWidth={1.8} className="text-[rgb(var(--copper))]" />
            整理成提纲
            <span className="absolute -right-1.5 -top-1.5 h-2 w-2 rounded-full border border-[rgb(var(--paper))] bg-[rgb(var(--copper))]" />
          </span>
          <span className="inline-flex items-center rounded-lg border border-white/55 bg-white/35 px-3 py-1.5 text-[11px] text-muted">
            加入知识库
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-1 flex-col justify-center gap-1">
        {TASK_STEPS.map((step) => {
          const active = step.state === 'active';
          return (
            <div
              key={step.index}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-1.5',
                active ? 'bg-white/70 ring-1 ring-[rgb(var(--copper))]/30' : 'bg-white/45',
              )}
            >
              <span
                className={cn(
                  'grid h-4 w-4 shrink-0 place-items-center rounded-full',
                  active
                    ? 'border border-[rgb(var(--copper))]/45 text-[rgb(var(--copper))]'
                    : 'bg-[rgb(var(--accent))]/[0.12] text-[rgb(var(--accent))]',
                )}
              >
                {active ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--copper))]" />
                ) : (
                  <Check size={9} strokeWidth={2.2} />
                )}
              </span>
              <span className="font-mono text-[9px] text-muted/45">{step.index}</span>
              <span className="text-[12px] font-medium text-ink/80">{step.title}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[9.5px] text-muted/65">
                {step.detail}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-[rgb(var(--line))]/60 pt-3">
        {[
          ['3', '步动作'],
          ['1', '步等你'],
          ['0', '次自动提交'],
        ].map(([value, label]) => (
          <div key={label} className="flex items-baseline gap-1.5">
            <span className="font-mono text-[14px] text-ink">{value}</span>
            <span className="text-[10.5px] leading-tight text-muted/80">{label}</span>
          </div>
        ))}
      </div>
    </>
  );
}
