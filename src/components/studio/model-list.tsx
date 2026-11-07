'use client';

import { Check, Download, Loader2, Power, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  canRun,
  dtypeFor,
  formatBytes,
  sizeFor,
  splitOf,
  type Backend,
  type GpuPrecision,
  type LocalModel,
  type ModelDtype,
  type ModelRuntimeState,
  type ResidentInfo,
} from '@/lib/engines';
import type { CacheStats } from '@/lib/local-runtime';
import { looksLikeMemoryPressure } from '@/lib/errors';
import { cn } from '@/lib/cn';

/** How each weight file is named to the user. */
export const PRECISION_LABEL: Record<ModelDtype, string> = {
  q8: 'int8',
  fp16: 'fp16',
  q4f16: '4 位',
};

type RowProps = {
  runtime: Record<string, ModelRuntimeState>;
  cache: Record<string, CacheStats>;
  residents: ResidentInfo[];
  backend: Backend;
  precision: GpuPrecision;
  onActivate: (model: LocalModel) => Promise<void>;
  onUnload: (model: LocalModel) => Promise<void>;
  onDrop: (model: LocalModel) => Promise<void>;
  onClearAndRetry: (model: LocalModel) => Promise<void>;
};

/** One titled group of model rows; the title replaces the old per-card badge. */
export function ModelGroup({
  title,
  models: rows,
  ...row
}: { title: string; models: LocalModel[]; accent: boolean } & RowProps) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2.5">
        <span className="text-[11.5px] text-muted/85">{title}</span>
        <span className="h-px flex-1 bg-[rgb(var(--line))]/60" />
      </div>
      <div className="space-y-2.5">
        {rows.map((model) => (
          <ModelRow key={model.id} model={model} {...row} />
        ))}
      </div>
    </div>
  );
}

function ModelRow({
  model,
  accent,
  runtime,
  cache,
  residents,
  backend,
  precision,
  onActivate,
  onUnload,
  onDrop,
  onClearAndRetry,
}: { model: LocalModel; accent: boolean } & RowProps) {
  const state = runtime[model.id];
  const stats = cache[model.id];
  const loadedNow = residents.some((row) => row.modelId === model.id);
  // A WebGPU-only model has no file the WASM heap can take, so the row quotes
  // the 4-bit size and states the requirement instead of offering a load that
  // would abort the tab.
  const blocked = !canRun(model, backend);
  const dtype = blocked ? 'q4f16' : dtypeFor(model, backend, precision);
  // fp16 for this model is larger than the runtime can turn into a session, so
  // the loader quietly picked 4-bit; the row has to say that out loud.
  const downgraded = !blocked && precision !== 'q4f16' && dtype === 'q4f16';
  const split = splitOf(model, dtype);
  const residentDtype = residents.find((row) => row.modelId === model.id)?.dtype;
  // A just-loaded model is ready even if the cache scan ran a beat too early
  // to see its weight file.
  const ready = !blocked && ((stats?.[dtype] ?? false) || loadedNow);
  // Some other precision is on disk but this backend cannot run it.
  const alternate = (['q8', 'fp16', 'q4f16'] as ModelDtype[]).find(
    (item) => item !== dtype && (stats?.[item] ?? false),
  );
  const otherReady = !ready && Boolean(alternate);
  const leftovers = !ready && !otherReady && (stats?.files ?? 0) > 0;
  const loading = state?.state === 'downloading';
  const failed = state?.state === 'error';
  const percent = Math.round((state?.progress ?? 0) * 100);
  // A failure keeps the last byte count (P0-2). Showing it here is the
  // difference between "try again" and "another 589MB": a multi-shard model
  // reuses every file that finished, and only the file that stopped restarts.
  const loaded = state?.loaded ?? 0;
  const total = state?.total ?? 0;
  const interrupted = failed && loaded > 0 && total > 0 && loaded < total;
  const downloaded = failed && loaded > 0 && total > 0 && loaded >= total;

  return (
    <div
      data-model={model.id}
      data-loaded={loadedNow ? 'true' : 'false'}
      className={cn(
        'rounded-xl border border-white/50 bg-white/35 px-4 py-4 backdrop-blur-md',
        loadedNow && 'ring-1 ring-[rgb(var(--accent))]/20',
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-[14px] text-ink/95">{model.label}</h4>
            {blocked && !loadedNow ? (
              <span className="text-[10.5px] text-muted/70">仅 WebGPU</span>
            ) : loadedNow ? (
              <span className="flex items-center gap-1 text-[10.5px] text-[#3f6b4f]">
                <Check size={11} />
                已加载
                {residentDtype && residentDtype !== dtype
                  ? `（${PRECISION_LABEL[residentDtype]}）`
                  : ''}
              </span>
            ) : ready ? (
              <span className="text-[10.5px] text-muted/70">已下载</span>
            ) : otherReady && alternate ? (
              <span className="text-[10.5px] text-muted/65">
                仅有 {PRECISION_LABEL[alternate]} 权重
              </span>
            ) : leftovers ? (
              <span className="text-[10.5px] text-muted/60">旧权重</span>
            ) : null}
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted/90">{model.note}</p>
          <p className="mt-1.5 text-[11px] text-muted/70">
            约{' '}
            {formatBytes(
              (blocked ? model.sizesMB.q4f16 : sizeFor(model, backend, precision)) * 1024 * 1024,
            )}{' '}
            · {PRECISION_LABEL[dtype]}
            {blocked ? ' · 需 WebGPU' : downgraded ? ' · 已降到 4 位' : ''}
            {split.files > 1 ? ` · ${split.files} 个权重文件` : ''}
            {model.dims ? ` · ${model.dims} 维` : ` · ${model.languages}`}
            {stats && stats.bytes > 0 ? ` · 占 ${formatBytes(stats.bytes)}` : ''}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {/* A loaded session keeps the file it was opened from, so changing
              the precision needs a reload rather than a silent relabel. */}
          {loadedNow && residentDtype && residentDtype !== dtype ? (
            <Button variant="soft" size="sm" onClick={() => void onActivate(model)} disabled={loading}>
              <RefreshCw size={11} className={loading ? 'animate-spin' : undefined} />
              {loading ? '切换中' : `切换到 ${PRECISION_LABEL[dtype]}`}
            </Button>
          ) : null}

          {loadedNow ? (
            <Button variant="ghost" size="sm" onClick={() => void onUnload(model)}>
              <Power size={11} />
              卸载
            </Button>
          ) : (
            <Button
              // Only the engine that is actually in use gets the dark button;
              // four primaries in a column read as four equal demands.
              variant={!ready && accent ? 'primary' : 'soft'}
              size="sm"
              onClick={() => void onActivate(model)}
              disabled={loading || blocked}
              title={blocked ? 'int8 权重超出 wasm 堆，需要在设置里把后端切到 WebGPU' : undefined}
            >
              {loading ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
              {loading ? '加载中' : blocked ? '需 WebGPU' : ready ? '加载' : '下载并加载'}
            </Button>
          )}

          {!loadedNow && (ready || leftovers) ? (
            <button
              type="button"
              aria-label={leftovers ? '清理旧权重' : '删除下载'}
              title={leftovers ? '清理旧权重' : '删除下载'}
              onClick={() => void onDrop(model)}
              className="grid h-9 w-8 place-items-center rounded-lg text-muted/50 transition-colors hover:bg-[rgb(var(--surface))]/70 hover:text-[#a24a3f]"
            >
              <Trash2 size={12} />
            </button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] text-muted/75">
            <span className="truncate pr-3">{state?.file ?? '准备中'}</span>
            <span className="tabular-nums">{percent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[rgb(var(--line))]/45">
            <div
              className="h-full rounded-full bg-[rgb(var(--accent))] transition-[width] duration-300"
              style={{ width: `${Math.max(percent, 2)}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[10px] text-muted/60">
            <span>
              {formatBytes(state?.loaded)} / {formatBytes(state?.total)}
            </span>
            <span>{state?.backend === 'webgpu' ? 'WebGPU' : 'WASM'}</span>
          </div>
        </div>
      ) : null}

      {failed ? (
        <div className="mt-3 space-y-2">
          {interrupted ? (
            <div>
              <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-[#8c3b32]/80">
                <span className="truncate pr-3">{state?.file ?? '下载中断'}</span>
                <span className="tabular-nums">{percent}%</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-[rgb(var(--line))]/45">
                <div
                  className="h-full rounded-full bg-[#a24a3f]/50"
                  style={{ width: `${Math.max(percent, 2)}%` }}
                />
              </div>
              <p className="mt-1 font-mono text-[10px] text-[#8c3b32]/65">
                停在 {formatBytes(loaded)} / {formatBytes(total)}
              </p>
            </div>
          ) : null}
          {downloaded ? (
            <p className="text-[11px] leading-relaxed text-[#8c3b32]/80">
              权重已下载完成；失败发生在建会话阶段，重试会直接解析本地权重。
            </p>
          ) : null}
          <div className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-[#8c3b32]">
            <TriangleAlert size={12} className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">{state?.message ?? '加载失败'}</span>
          </div>
          {looksLikeMemoryPressure(state?.message ?? '') ? (
            <p className="text-[11px] leading-relaxed text-[#8c3b32]/80">
              更像内存或存储不足：先关掉占用大的标签页，再重试。
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => void onActivate(model)}>
              <RefreshCw size={11} />
              重试
            </Button>
            {ready || leftovers ? (
              <Button variant="ghost" size="sm" onClick={() => void onClearAndRetry(model)}>
                删除缓存并重试
              </Button>
            ) : null}
          </div>
          {!downloaded && total > 0 ? (
            <p className="text-[11px] leading-relaxed text-[#8c3b32]/70">
              {interrupted
                ? '重试会从当前文件重新下载；已完成的文件会复用缓存，不会整包重下。'
                : '重试会重新开始；已完成的文件会复用缓存，不会整包重下。'}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
