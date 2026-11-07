'use client';

import {
  Check,
  CircleDot,
  CornerDownLeft,
  LockKeyhole,
  MousePointer2,
  Sparkles,
} from 'lucide-react';

const TASK_STEPS = [
  { index: '01', title: '看见', detail: '12 个可操作元素', state: 'done' },
  { index: '02', title: '找到', detail: '「整理成提纲」', state: 'done' },
  { index: '03', title: '确认', detail: '这一步等你', state: 'active' },
] as const;

export function HomePreview() {
  return (
    <div data-hero-preview className="neu grain relative overflow-hidden rounded-[26px] p-2 md:p-2.5">
      <div className="flex items-center justify-between gap-3 px-2.5 py-1.5 md:px-3 md:py-2">
        <span className="flex items-center gap-1.5">
          {[0, 1, 2].map((dot) => (
            <span key={dot} className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--line))]" />
          ))}
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex min-w-0 items-center gap-1.5 rounded-full border border-white/55 bg-white/35 px-2.5 py-1 font-mono text-[8px] tracking-[0.04em] text-muted/70">
            <LockKeyhole size={8} strokeWidth={1.8} />
            <span className="truncate">loomscape.site / brief</span>
          </span>
          <span className="hidden shrink-0 items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.14em] text-[#4d7a5c] sm:flex">
            <span className="h-1 w-1 rounded-full bg-[#4d7a5c]" />
            cursor live
          </span>
        </span>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-white/55 bg-white/30 p-3 backdrop-blur-md md:p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-muted/60">
              current page · 01 / brief
            </div>
            <h3 className="mt-2 text-[20px] font-semibold leading-[1.25] text-ink md:text-[23px]">
              这周的选题，
              <br />
              先整理成一份提纲。
            </h3>
          </div>
          <span className="mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[rgb(var(--copper))]/25 bg-[rgb(var(--copper))]/[0.08] px-2.5 py-1.5 font-mono text-[8px] uppercase tracking-[0.12em] text-[rgb(var(--copper))]">
            <Sparkles size={9} strokeWidth={1.8} />
            AI cursor
          </span>
        </div>

        <p className="mt-3 max-w-[44ch] text-[11px] leading-[1.8] text-muted">
          光标已经在页面里。它先读出可操作的位置，再把任务拆成看得见的动作。
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="relative inline-flex items-center gap-2 rounded-lg border border-[rgb(var(--copper))]/45 bg-white/65 px-3 py-2 text-[11px] font-medium text-ink shadow-[0_8px_22px_-18px_rgba(58,58,42,0.5)]">
            <MousePointer2 size={12} strokeWidth={1.8} className="text-[rgb(var(--copper))]" />
            整理成提纲
            <span className="absolute -right-1.5 -top-1.5 h-2 w-2 rounded-full border border-[rgb(var(--paper))] bg-[rgb(var(--copper))]" />
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/55 bg-white/35 px-3 py-2 text-[11px] text-muted">
            加入知识库
          </span>
        </div>

        <div className="mt-4 rounded-xl border border-white/55 bg-white/35 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-muted/60">
              cursor trace
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.12em] text-[#4d7a5c]">
              <CircleDot size={8} />
              可暂停 / 可接管
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {TASK_STEPS.map((step) => (
              <div key={step.index} className="flex items-center gap-2.5">
                <span
                  className={
                    step.state === 'active'
                      ? 'grid h-4 w-4 shrink-0 place-items-center rounded-full border border-[rgb(var(--copper))]/45 text-[rgb(var(--copper))]'
                      : 'grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[#4d7a5c]/[0.12] text-[#4d7a5c]'
                  }
                >
                  {step.state === 'active' ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--copper))]" />
                  ) : (
                    <Check size={9} strokeWidth={2.2} />
                  )}
                </span>
                <span className="font-mono text-[8px] text-muted/45">{step.index}</span>
                <span className="text-[10.5px] font-medium text-ink/80">{step.title}</span>
                <span className="min-w-0 truncate text-[9.5px] text-muted/70">{step.detail}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-[rgb(var(--line))]/60 pt-2.5">
            <span className="flex items-center gap-1.5 text-[9px] text-muted/75">
              <LockKeyhole size={9} strokeWidth={1.8} />
              不自动提交，等你确认
            </span>
            <span className="flex items-center gap-1 font-mono text-[8px] uppercase tracking-[0.1em] text-muted/50">
              <CornerDownLeft size={8} />
              enter
            </span>
          </div>
        </div>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2 px-1.5 py-1 md:mt-2 md:px-2">
        <span className="flex min-w-0 items-center gap-1.5 truncate font-mono text-[8px] uppercase tracking-[0.15em] text-muted/60">
          <CircleDot size={9} className="shrink-0 text-[rgb(var(--copper))]" />
          当前页 · 可见动作
        </span>
        <span className="shrink-0 font-mono text-[8px] uppercase tracking-[0.12em] text-muted/45">
          one task at a time
        </span>
      </div>
    </div>
  );
}
