'use client';

import { useEffect } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  DEFAULT_EMBED_PRICE,
  formatCost,
  formatDuration,
  isLocalEmbedder,
  useEmbeddingGate,
} from '@/lib/embedding-gate';

/**
 * Two-step guard for embedder changes.
 *
 * Step 1 names the consequence and defaults to "just switch"; rebuilding costs
 * money and time, so it needs a second, deliberately red confirmation with the
 * estimate in front of it.
 */
export function EmbeddingGate() {
  const open = useEmbeddingGate((state) => state.open);
  const phase = useEmbeddingGate((state) => state.phase);
  const label = useEmbeddingGate((state) => state.label);
  const estimate = useEmbeddingGate((state) => state.estimate);
  const progress = useEmbeddingGate((state) => state.progress);
  const error = useEmbeddingGate((state) => state.error);
  const price = useEmbeddingGate((state) => state.price);
  const close = useEmbeddingGate((state) => state.close);
  const switchOnly = useEmbeddingGate((state) => state.switchOnly);
  const goWarning = useEmbeddingGate((state) => state.goWarning);
  const back = useEmbeddingGate((state) => state.back);
  const rebuild = useEmbeddingGate((state) => state.rebuild);
  const stop = useEmbeddingGate((state) => state.stop);
  const savePrice = useEmbeddingGate((state) => state.savePrice);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (phase === 'running') return;
      event.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, phase, close]);

  if (!open) return null;

  const local = estimate ? isLocalEmbedder(estimate.targetTag) : false;
  const percent =
    progress && progress.totalChunks > 0
      ? Math.round((progress.doneChunks / progress.totalChunks) * 100)
      : 0;

  return (
    <div
      className="modal-scrim fixed inset-0 z-[340] grid place-items-center bg-[rgb(var(--paper))]/30 px-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="切换嵌入模型"
    >
      <div className="modal-card w-[min(94vw,440px)] rounded-2xl border border-white/70 bg-white/85 p-5 shadow-[0_40px_90px_-40px_rgba(61,54,72,0.7)] backdrop-blur-xl">
        {phase === 'confirm' ? (
          <>
            <p className="font-mono text-[9.5px] uppercase tracking-[0.24em] text-muted/60">
              embedding
            </p>
            <h2 className="mt-2 font-serif text-[19px] text-ink">切换嵌入模型</h2>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
              即将切换到「{label}」。库里
              {estimate ? ` ${estimate.docs} 篇资料（${estimate.chunks} 段）` : '部分资料'}
              是别的模型建的，切换后它们会暂时无法被检索——原文不会删除，切回来就恢复。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => void switchOnly()}
                className="h-9 rounded-full border border-[rgb(var(--ink))]/12 px-4 text-[12px] text-ink transition-colors hover:bg-white/70"
              >
                仅切换
              </button>
              <button
                type="button"
                onClick={goWarning}
                className="h-9 rounded-full border border-[rgb(var(--accent))]/25 bg-white/65 px-4 text-[12px] font-medium text-[rgb(var(--accent))] transition-colors hover:bg-white/85"
              >
                切换并重建
              </button>
            </div>
          </>
        ) : null}

        {phase === 'warning' ? (
          <>
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-[#B4453A]/12 text-[#B4453A]">
                <AlertTriangle size={16} />
              </span>
              <h2 className="font-serif text-[19px] text-ink">确认重建索引</h2>
            </div>

            <dl className="mt-4 space-y-2 rounded-xl border border-[rgb(var(--ink))]/10 bg-white/55 p-3 text-[12px]">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted">待重建</dt>
                <dd className="text-ink">
                  {estimate?.docs ?? 0} 篇 · {estimate?.chunks ?? 0} 段 ·{' '}
                  {(estimate?.chars ?? 0).toLocaleString()} 字
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted">预计花费</dt>
                <dd className="text-ink">{formatCost(estimate?.tokens ?? 0, local ? 0 : price)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted">预计耗时</dt>
                <dd className="text-ink">{formatDuration(estimate?.chunks ?? 0, local)}</dd>
              </div>
            </dl>

            <label className="mt-3 flex items-center justify-between gap-3 text-[11.5px] text-muted">
              <span>
                单价（元 / 百万 token）
                <span className="ml-1 text-muted/60">
                  {local ? '本地模型免费' : `默认 ${DEFAULT_EMBED_PRICE}`}
                </span>
              </span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={Number.isFinite(price) ? price : DEFAULT_EMBED_PRICE}
                onChange={(event) => void savePrice(Number(event.target.value))}
                className="h-8 w-20 rounded-lg border border-[rgb(var(--ink))]/12 bg-white/70 px-2 text-right text-[12px] text-ink outline-none focus:border-[rgb(var(--accent))]/50"
              />
            </label>

            <p className="mt-3 text-[11px] leading-relaxed text-muted/80">
              重建期间会逐篇重算向量，完成前旧资料检索不到；原文始终保留。失败可重试，已完成的部分不会重跑。
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                autoFocus
                onClick={back}
                className="h-9 rounded-full border border-[rgb(var(--ink))]/12 px-4 text-[12px] text-ink transition-colors hover:bg-white/70"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void rebuild()}
                className="h-9 rounded-full bg-[#B4453A] px-4 text-[12px] font-medium text-white shadow-[0_10px_22px_-14px_rgba(180,69,58,0.8)] transition-colors hover:bg-[#9E3A31]"
              >
                我确认，开始重建
              </button>
            </div>
          </>
        ) : null}

        {phase === 'running' ? (
          <>
            <div className="flex items-center gap-2">
              <Loader2 size={16} className="animate-spin text-[rgb(var(--accent))]" />
              <h2 className="font-serif text-[19px] text-ink">正在重建索引</h2>
            </div>
            <p className="mt-2 text-[12px] text-muted">
              {progress ? `${progress.doneDocs} / ${progress.totalDocs} 篇` : '准备中'}
              {progress ? ` · ${progress.doneChunks} / ${progress.totalChunks} 段` : ''}
            </p>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[rgb(var(--ink))]/8">
              <div
                className="h-full rounded-full bg-[rgb(var(--accent))] transition-[width] duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={stop}
                className="h-9 rounded-full border border-[rgb(var(--ink))]/12 px-4 text-[12px] text-muted transition-colors hover:text-ink"
              >
                停止
              </button>
            </div>
          </>
        ) : null}

        {phase === 'done' ? (
          <>
            <h2 className="font-serif text-[19px] text-ink">重建完成</h2>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
              已重建 {progress?.doneDocs ?? 0} 篇 / {progress?.doneChunks ?? 0} 段，现在可以用新模型检索了。
            </p>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                autoFocus
                onClick={close}
                className="h-9 rounded-full bg-[rgb(var(--accent))] px-4 text-[12px] text-white"
              >
                完成
              </button>
            </div>
          </>
        ) : null}

        {phase === 'error' ? (
          <>
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-[#B4453A]/12 text-[#B4453A]">
                <AlertTriangle size={16} />
              </span>
              <h2 className="font-serif text-[19px] text-ink">重建没有全部完成</h2>
            </div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
              {error ?? '未知错误'}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="h-9 rounded-full border border-[rgb(var(--ink))]/12 px-4 text-[12px] text-ink transition-colors hover:bg-white/70"
              >
                关闭
              </button>
              <button
                type="button"
                onClick={() => void rebuild()}
                className="h-9 rounded-full border border-[rgb(var(--accent))]/25 bg-white/65 px-4 text-[12px] font-medium text-[rgb(var(--accent))]"
              >
                继续重试
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
