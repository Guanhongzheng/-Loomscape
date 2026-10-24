'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Cpu,
  Download,
  Loader2,
  Trash2,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { Segmented } from '@/components/ui/controls';
import { toast } from '@/components/ui/toast';
import {
  ALL_LOCAL_MODELS,
  formatBytes,
  useEngines,
  useModelRuntime,
  type LocalModel,
} from '@/lib/engines';
import { isModelCached, loadModel, removeModel } from '@/lib/local-runtime';
import { activeEmbedder, type EmbedderInfo } from '@/lib/memory';
import { useEndpoints } from '@/lib/endpoint-store';
import { cn } from '@/lib/cn';

export function EnginePanel() {
  const prefs = useEngines((state) => state.prefs);
  const patch = useEngines((state) => state.patch);
  const loaded = useEngines((state) => state.loaded);
  const load = useEngines((state) => state.load);

  const models = useModelRuntime((state) => state.models);
  const setModel = useModelRuntime((state) => state.set);
  const resetModel = useModelRuntime((state) => state.reset);

  const endpoints = useEndpoints((state) => state.endpoints);
  const [cached, setCached] = useState<Record<string, boolean>>({});
  const [embedder, setEmbedder] = useState<EmbedderInfo | null>(null);

  const refresh = useCallback(async () => {
    const rows = await Promise.all(
      ALL_LOCAL_MODELS.map(async (model) => [model.id, await isModelCached(model.repo)] as const),
    );
    setCached(Object.fromEntries(rows));
    setEmbedder(await activeEmbedder());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!loaded) return;
    void refresh();
  }, [loaded, prefs, refresh]);

  const download = async (model: LocalModel) => {
    setModel(model.id, { state: 'downloading', progress: 0, message: undefined });
    try {
      await loadModel(model, {
        source: prefs.source,
        backendPreference: prefs.backend,
        report: true,
      });
      await refresh();
      toast(`${model.label} 已就绪`, 'success');
    } catch (error) {
      setModel(model.id, {
        state: 'error',
        progress: 0,
        message: error instanceof Error ? error.message : '下载失败',
      });
      toast(error instanceof Error ? error.message : '下载失败', 'error');
    }
  };

  const drop = async (model: LocalModel) => {
    const removed = await removeModel(model.repo);
    resetModel(model.id);
    await refresh();
    toast(removed > 0 ? `已删除 ${removed} 个缓存文件` : '没有找到缓存文件', 'info');
  };

  const textReady = cached[prefs.textModelId];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl p-4 shadow-[var(--shadow-inset-sm)]">
          <div className="mb-2 flex items-center gap-2 text-[11.5px] text-muted">
            <Cpu size={13} />
            文本引擎
          </div>
          <Segmented
            size="sm"
            value={prefs.textMode}
            onChange={(next) => void patch({ textMode: next })}
            options={[
              { value: 'api', label: '云端 API' },
              { value: 'local', label: '本地模型' },
            ]}
          />
          <p className="mt-3 text-[10.5px] leading-relaxed text-muted/70">
            {prefs.textMode === 'api'
              ? `走 ${endpoints.text.model || '未配置端点'}，支持工具调用与多步生成。`
              : textReady
                ? '在浏览器内推理，断网可用；不支持工具调用。'
                : '本地权重尚未下载，去下方下载后可用。'}
          </p>
        </div>

        <div className="rounded-xl p-4 shadow-[var(--shadow-inset-sm)]">
          <div className="mb-2 flex items-center gap-2 text-[11.5px] text-muted">
            <Zap size={13} />
            嵌入引擎
          </div>
          <Segmented
            size="sm"
            value={prefs.embeddingMode}
            onChange={(next) => void patch({ embeddingMode: next })}
            options={[
              { value: 'hash', label: '哈希' },
              { value: 'local', label: '本地' },
              { value: 'api', label: 'API' },
            ]}
          />
          <p className="mt-3 text-[10.5px] leading-relaxed text-muted/70">
            当前：{embedder?.label ?? '读取中'}
            {embedder?.dims ? ` · ${embedder.dims} 维` : ''}
          </p>
        </div>

        <div className="rounded-xl p-4 shadow-[var(--shadow-inset-sm)]">
          <div className="mb-2 flex items-center gap-2 text-[11.5px] text-muted">
            <Download size={13} />
            下载源与后端
          </div>
          <div className="space-y-2">
            <Select
              value={prefs.source}
              onChange={(event) =>
                void patch({ source: event.target.value as 'modelscope' | 'huggingface' })
              }
              className="h-9 text-[11.5px]"
            >
              <option value="modelscope">阿里巴巴 ModelScope（国内）</option>
              <option value="huggingface">HuggingFace（官方）</option>
            </Select>
            <Select
              value={prefs.backend}
              onChange={(event) =>
                void patch({ backend: event.target.value as 'auto' | 'webgpu' | 'wasm' })
              }
              className="h-9 text-[11.5px]"
            >
              <option value="auto">自动 · WASM 量化（体积最小）</option>
              <option value="webgpu">WebGPU · fp32（更快，约 4 倍体积）</option>
              <option value="wasm">WASM · 量化</option>
            </Select>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[12.5px] font-medium text-ink/85">本地模型</h3>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted/55">
            {prefs.source === 'modelscope' ? 'modelscope' : 'huggingface'} ·{' '}
            {prefs.backend === 'auto' ? 'auto backend' : prefs.backend}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {ALL_LOCAL_MODELS.map((model) => {
            const state = models[model.id];
            const ready = cached[model.id];
            const downloading = state?.state === 'downloading';
            const percent = Math.round((state?.progress ?? 0) * 100);

            return (
              <div key={model.id} className="rounded-xl p-4 shadow-[var(--shadow-inset-sm)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-[13px] font-medium text-ink/90">{model.label}</h4>
                      <span className="rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted/70 shadow-[var(--shadow-inset-sm)]">
                        {model.task === 'text' ? 'text' : 'embed'}
                      </span>
                    </div>
                    <p className="mt-1 text-[10.5px] leading-relaxed text-muted/75">{model.note}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[9.5px] text-muted/55">
                      <span>{model.repo}</span>
                      <span>·</span>
                      <span>约 {model.sizeMB} MB</span>
                      <span>·</span>
                      <span>{model.languages}</span>
                    </div>
                  </div>

                  {ready ? (
                    <span className="flex shrink-0 items-center gap-1 text-[10px] text-[#3f6b4f]">
                      <Check size={11} />
                      就绪
                    </span>
                  ) : null}
                </div>

                {downloading ? (
                  <div className="mt-3">
                    <div className="mb-1.5 flex items-center justify-between font-mono text-[9.5px] text-muted/70">
                      <span className="truncate pr-3">{state?.file ?? '准备中'}</span>
                      <span className="tabular-nums">{percent}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full shadow-[var(--shadow-inset-sm)]">
                      <div
                        className="h-full rounded-full bg-[rgb(var(--accent))]/70 transition-[width] duration-300"
                        style={{ width: `${Math.max(percent, 2)}%` }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between font-mono text-[9px] text-muted/50">
                      <span>
                        {formatBytes(state?.loaded)} / {formatBytes(state?.total)}
                      </span>
                      <span>{state?.backend === 'webgpu' ? 'WebGPU' : 'WASM'}</span>
                    </div>
                  </div>
                ) : null}

                {state?.state === 'error' ? (
                  <div className="mt-3 flex items-start gap-1.5 text-[10px] leading-relaxed text-[#8c3b32]">
                    <TriangleAlert size={11} className="mt-0.5 shrink-0" />
                    {state.message ?? '下载失败'}
                  </div>
                ) : null}

                <div className="mt-3 flex gap-2">
                  <Button
                    variant={ready ? 'ghost' : 'primary'}
                    size="sm"
                    onClick={() => download(model)}
                    disabled={downloading}
                  >
                    {downloading ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                    {downloading ? '下载中' : ready ? '重新加载' : '下载'}
                  </Button>
                  {ready ? (
                    <Button variant="ghost" size="sm" onClick={() => drop(model)}>
                      <Trash2 size={11} />
                      删除
                    </Button>
                  ) : null}
                  {model.task === 'embedding' && ready ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void patch({ embeddingMode: 'local', embeddingModelId: model.id })}
                      className={cn(prefs.embeddingModelId === model.id && prefs.embeddingMode === 'local' && 'text-[rgb(var(--accent))]')}
                    >
                      设为当前
                    </Button>
                  ) : null}
                  {model.task === 'text' && ready ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void patch({ textMode: 'local', textModelId: model.id })}
                    >
                      设为当前
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-3 text-[10.5px] leading-relaxed text-muted/65">
          权重通过浏览器缓存保存在本机，不会上传。切换下载源后需要重新下载；更换嵌入引擎会让旧记忆片段暂不参与召回。
        </p>
      </div>
    </div>
  );
}
