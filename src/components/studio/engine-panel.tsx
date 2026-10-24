'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Cpu,
  Download,
  Loader2,
  Plug,
  Power,
  Trash2,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Segmented } from '@/components/ui/controls';
import { toast } from '@/components/ui/toast';
import {
  ALL_LOCAL_MODELS,
  formatBytes,
  useEngines,
  useModelRuntime,
  type LocalModel,
} from '@/lib/engines';
import {
  backendLabel,
  loadModel,
  removeModel,
  runtimeInfo,
  scanModelCache,
  unloadModel,
  type CacheStats,
} from '@/lib/local-runtime';
import { activeEmbedder, type EmbedderInfo } from '@/lib/memory';
import { useEndpoints } from '@/lib/endpoint-store';
import { PRESETS, hasKey, type Endpoint } from '@/lib/providers';
import { probeEndpoint } from '@/lib/api';
import { describeError, looksLikeMemoryPressure } from '@/lib/errors';
import { roomFor, storageUsage, type StorageUsage } from '@/lib/storage';
import { cn } from '@/lib/cn';

type RuntimeFacts = { cores: number; isolated: boolean; threads: number };

export function EnginePanel() {
  const prefs = useEngines((state) => state.prefs);
  const patch = useEngines((state) => state.patch);
  const loaded = useEngines((state) => state.loaded);
  const load = useEngines((state) => state.load);

  const models = useModelRuntime((state) => state.models);
  const resident = useModelRuntime((state) => state.resident);
  const setModel = useModelRuntime((state) => state.set);
  const resetModel = useModelRuntime((state) => state.reset);

  const endpoints = useEndpoints((state) => state.endpoints);
  const storeEndpoint = useEndpoints((state) => state.store);

  const [draft, setDraft] = useState<Endpoint>(endpoints.text);
  const [testing, setTesting] = useState(false);
  const [cache, setCache] = useState<Record<string, CacheStats>>({});
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [embedder, setEmbedder] = useState<EmbedderInfo | null>(null);
  const [facts, setFacts] = useState<RuntimeFacts | null>(null);

  const refresh = useCallback(async () => {
    setCache(await scanModelCache(ALL_LOCAL_MODELS));
    setUsage(await storageUsage());
    setEmbedder(await activeEmbedder());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setFacts(runtimeInfo());
  }, []);

  useEffect(() => {
    if (!loaded) return;
    void refresh();
  }, [loaded, prefs, resident, refresh]);

  useEffect(() => {
    setDraft(endpoints.text);
  }, [endpoints.text]);

  const applyPreset = (presetId: string) => {
    const preset = PRESETS.text.find((item) => item.id === presetId);
    if (!preset) return;
    setDraft((current) => ({
      ...current,
      preset: preset.id,
      label: preset.label,
      baseUrl: preset.baseUrl,
      shape: preset.shape,
      model: preset.models[0] ?? current.model,
    }));
  };

  const saveCloud = async () => {
    try {
      await storeEndpoint(draft);
      await patch({ textMode: 'api' });
      toast(`已保存 ${draft.label}`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : '保存失败', 'error');
    }
  };

  const testCloud = async () => {
    if (!hasKey(draft)) {
      toast('先填写服务地址与密钥', 'error');
      return;
    }
    setTesting(true);
    try {
      const reply = await probeEndpoint(draft);
      toast(reply ? `连接正常 · ${reply.slice(0, 12)}` : '已连通，但没有返回内容', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : '连接失败', 'error');
    } finally {
      setTesting(false);
    }
  };

  /**
   * Loading is the selection: the model that is in memory is the one the
   * workbenches use, so there is no separate "set as current" step. Because
   * only one model can stay resident, the other task drops back to its
   * non-local path instead of leaving a preference that would evict it later.
   */
  const activate = async (model: LocalModel) => {
    const previous = ALL_LOCAL_MODELS.find((item) => item.id === resident?.modelId);

    // Only the weights that are not on disk need room; a cached model just
    // needs to be parsed into memory.
    if (!cache[model.id]?.weights) {
      const now = await storageUsage();
      const need = model.sizeMB * 1024 * 1024;
      if (!roomFor(now, need)) {
        const detail = now
          ? `已用 ${formatBytes(now.used)} / 配额 ${formatBytes(now.quota)}，还差约 ${formatBytes(
              Math.max(need - now.free, 0),
            )}`
          : '浏览器没有报告可用空间';
        const message = `存储空间不足：${detail}。先清理旧权重或删掉不用的模型。`;
        setModel(model.id, { state: 'error', progress: 0, message });
        toast(`${model.label} 未开始下载：空间不足`, 'error');
        return;
      }
    }

    setModel(model.id, { state: 'downloading', progress: 0, message: undefined });
    try {
      await loadModel(model, {
        source: prefs.source,
        backendPreference: prefs.backend,
        report: true,
      });

      await patch(
        model.task === 'text'
          ? {
              textMode: 'local',
              textModelId: model.id,
              ...(prefs.embeddingMode === 'local' ? { embeddingMode: 'hash' as const } : {}),
            }
          : {
              embeddingMode: 'local',
              embeddingModelId: model.id,
              ...(prefs.textMode === 'local' ? { textMode: 'api' as const } : {}),
            },
      );

      await refresh();
      // Cache writes land slightly after the session resolves; a second scan
      // stops the card from flashing 旧权重 for files it just downloaded.
      window.setTimeout(() => void refresh(), 1200);
      const info = runtimeInfo();
      const backend = useModelRuntime.getState().resident?.backend;
      const replaced = previous && previous.id !== model.id ? `，已卸载 ${previous.label}` : '';
      toast(
        `已加载 ${model.label} · ${backendLabel(backend)} ${info.threads} 线程${replaced}`,
        'success',
      );
    } catch (error) {
      const message = describeError(error);
      setModel(model.id, { state: 'error', progress: 0, message });
      toast(`${model.label} 加载失败：${message}`, 'error');
    }
  };

  const unload = async () => {
    await unloadModel();
    await refresh();
    toast('已卸载本地模型，内存已释放', 'info');
  };

  const drop = async (model: LocalModel) => {
    const removed = await removeModel(model.repo);
    resetModel(model.id);
    await refresh();
    toast(removed > 0 ? `已删除 ${removed} 个缓存文件` : '没有找到缓存文件', 'info');
  };

  /** A truncated weight file survives as a cache hit; clearing it is the fix. */
  const clearAndRetry = async (model: LocalModel) => {
    await removeModel(model.repo);
    resetModel(model.id);
    await refresh();
    await activate(model);
  };

  const chooseMode = async (task: 'text' | 'embedding', next: string) => {
    if (task === 'text') {
      if (next === 'api') {
        await patch({ textMode: 'api' });
        return;
      }
      await patch({ textMode: 'local' });
      const model = ALL_LOCAL_MODELS.find((item) => item.task === 'text' && item.id === prefs.textModelId);
      if (model && resident?.modelId !== model.id && cache[model.id]?.weights) await activate(model);
      return;
    }

    const mode = next as 'hash' | 'local' | 'api';
    await patch({ embeddingMode: mode });
    if (mode !== 'local') return;
    const model = ALL_LOCAL_MODELS.find(
      (item) => item.task === 'embedding' && item.id === prefs.embeddingModelId,
    );
    if (model && resident?.modelId !== model.id && cache[model.id]?.weights) await activate(model);
  };

  const preset = PRESETS.text.find((item) => item.id === draft.preset);
  const textReady = cache[prefs.textModelId]?.weights;
  const cloudReady = hasKey(draft);
  const loadingModel = ALL_LOCAL_MODELS.find((item) => models[item.id]?.state === 'downloading');
  const usedPercent = usage && usage.quota > 0 ? Math.round(usage.ratio * 100) : 0;
  const loadingState = loadingModel ? models[loadingModel.id] : undefined;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl p-4 shadow-[var(--shadow-inset-sm)]">
          <div className="mb-2 flex items-center gap-2 text-[11.5px] text-muted">
            <Cpu size={13} />
            文本引擎
          </div>
          <Segmented
            size="sm"
            value={prefs.textMode}
            onChange={(next) => void chooseMode('text', next)}
            options={[
              { value: 'api', label: '云端 API' },
              { value: 'local', label: '本地模型' },
            ]}
          />
          <p className="mt-3 text-[10.5px] leading-relaxed text-muted/70">
            {prefs.textMode === 'api'
              ? cloudReady
                ? `走 ${draft.label} · ${draft.model}，支持工具调用与多步生成。`
                : '尚未填写密钥，选好服务商后填入 Key。'
              : resident?.modelId === prefs.textModelId
                ? '已在内存中，断网可用；不支持工具调用。'
                : textReady
                  ? '权重已缓存，加载后即可在浏览器内推理。'
                  : '本地权重尚未下载，去下方「下载并加载」。'}
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
            onChange={(next) => void chooseMode('embedding', next)}
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

      {prefs.textMode === 'api' ? (
        <div className="rounded-xl p-4 shadow-[var(--shadow-inset-sm)]">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[11.5px] text-muted">
              <Plug size={13} />
              云端 API
            </div>
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted/55">
              {draft.shape.replace('-chat', '')}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="mb-1.5 block text-[10.5px] text-muted">服务商</label>
              <Select
                value={draft.preset}
                onChange={(event) => applyPreset(event.target.value)}
                className="h-9 text-[11.5px]"
              >
                {PRESETS.text.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="mb-1.5 block text-[10.5px] text-muted">模型</label>
              {preset && preset.models.length > 0 ? (
                <Select
                  value={preset.models.includes(draft.model) ? draft.model : preset.models[0]}
                  onChange={(event) => setDraft((c) => ({ ...c, model: event.target.value }))}
                  className="h-9 text-[11.5px]"
                >
                  {preset.models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  value={draft.model}
                  onChange={(event) => setDraft((c) => ({ ...c, model: event.target.value }))}
                  placeholder="model-id"
                  className="h-9 font-mono text-[11px]"
                  spellCheck={false}
                />
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-[10.5px] text-muted">API Key</label>
              <Input
                type="password"
                value={draft.apiKey}
                onChange={(event) => setDraft((c) => ({ ...c, apiKey: event.target.value }))}
                placeholder={draft.shape === 'anthropic-chat' ? 'sk-ant-...' : 'sk-...'}
                className="h-9 font-mono text-[11px]"
                spellCheck={false}
                autoComplete="off"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[10.5px] text-muted">Base URL</label>
              <Input
                value={draft.baseUrl}
                onChange={(event) => setDraft((c) => ({ ...c, baseUrl: event.target.value }))}
                placeholder="https://api.example.com/v1"
                className="h-9 font-mono text-[11px]"
                spellCheck={false}
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" onClick={saveCloud}>
              <Check size={12} />
              保存并使用
            </Button>
            <Button variant="ghost" size="sm" onClick={testCloud} disabled={testing || !cloudReady}>
              {testing ? <Loader2 size={11} className="animate-spin" /> : null}
              测试连接
            </Button>
            <span className="text-[10.5px] text-muted/60">
              密钥只写进本机 IndexedDB，请求经 /api/chat 转发，不落盘。
            </span>
          </div>
        </div>
      ) : null}

      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-[12.5px] font-medium text-ink/85">本地模型</h3>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted/55">
            {prefs.source === 'modelscope' ? 'modelscope' : 'huggingface'} · single resident
          </span>
        </div>

        <div
          data-resident={resident?.modelId ?? ''}
          className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-4 py-3 shadow-[var(--shadow-inset-sm)]"
        >
          <span className="flex items-center gap-2 text-[11.5px] text-muted">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                resident ? 'bg-[#4d7a5c]' : 'bg-[rgb(var(--copper))]/70',
              )}
            />
            驻留模型
          </span>
          <span className="text-[12px] text-ink/85">
            {loadingModel
              ? `加载中 · ${loadingModel.label} ${Math.round((loadingState?.progress ?? 0) * 100)}%`
              : resident
                ? ALL_LOCAL_MODELS.find((item) => item.id === resident.modelId)?.label ?? '未知'
                : '无'}
          </span>
          {resident ? (
            <span className="font-mono text-[10px] text-muted/65">
              {backendLabel(resident.backend)} · {resident.threads} 线程
            </span>
          ) : null}
          {resident ? (
            <Button variant="ghost" size="sm" onClick={() => void unload()} className="ml-auto">
              <Power size={11} />
              卸载
            </Button>
          ) : null}
          <span className="w-full text-[10.5px] leading-relaxed text-muted/65">
            同一时间只驻留一个模型，加载另一个会先卸载当前的。当前环境：{facts?.cores ?? '—'} 核 ·
            WASM {facts?.threads ?? 1} 线程
            {facts && !facts.isolated ? '（未开启跨源隔离，只能单线程）' : ''}。
            {usage ? (
              <>
                {' '}
                本机存储已用 {formatBytes(usage.used)} / {formatBytes(usage.quota)}（{usedPercent}%）
                {usage.ratio > 0.9 ? '，空间紧张，先清理旧权重' : ''}。
              </>
            ) : null}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {ALL_LOCAL_MODELS.map((model) => {
            const state = models[model.id];
            const stats = cache[model.id];
            const loadedNow = resident?.modelId === model.id;
            // A just-loaded model is ready even if the cache scan ran a beat
            // too early to see its weight file.
            const ready = (stats?.weights ?? false) || loadedNow;
            const leftovers = !ready && (stats?.files ?? 0) > 0;
            const size = stats?.bytes ?? 0;
            const loading = state?.state === 'downloading';
            const percent = Math.round((state?.progress ?? 0) * 100);

            return (
              <div
                key={model.id}
                data-model={model.id}
                data-loaded={loadedNow ? 'true' : 'false'}
                className={cn(
                  'rounded-xl p-4 shadow-[var(--shadow-inset-sm)]',
                  loadedNow && 'ring-1 ring-[rgb(var(--accent))]/25',
                )}
              >
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

                  {loadedNow ? (
                    <span className="flex shrink-0 items-center gap-1 text-[10px] text-[#3f6b4f]">
                      <Check size={11} />
                      已加载
                    </span>
                  ) : ready ? (
                    <span className="shrink-0 font-mono text-[9px] tracking-wide text-muted/55">
                      已下载{size > 0 ? ` · ${formatBytes(size)}` : ''}
                    </span>
                  ) : leftovers ? (
                    <span className="shrink-0 font-mono text-[9px] tracking-wide text-muted/45">
                      旧权重{size > 0 ? ` · ${formatBytes(size)}` : ''}
                    </span>
                  ) : null}
                </div>

                {loading ? (
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
                  <div className="mt-3 space-y-2">
                    <div className="flex items-start gap-1.5 text-[10px] leading-relaxed text-[#8c3b32]">
                      <TriangleAlert size={11} className="mt-0.5 shrink-0" />
                      <span className="min-w-0 break-words">{state.message ?? '加载失败'}</span>
                    </div>
                    {looksLikeMemoryPressure(state.message ?? '') ? (
                      <p className="text-[10px] leading-relaxed text-[#8c3b32]/75">
                        更像内存或存储不足：先关掉占用大的标签页，再删掉缓存重试。
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button variant="ghost" size="sm" onClick={() => void activate(model)}>
                        重试
                      </Button>
                      {ready ? (
                        <Button variant="ghost" size="sm" onClick={() => void clearAndRetry(model)}>
                          删除缓存并重试
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  {loadedNow ? (
                    <Button variant="ghost" size="sm" onClick={() => void unload()} disabled={loading}>
                      <Power size={11} />
                      卸载
                    </Button>
                  ) : (
                    <Button
                      variant={ready ? 'ghost' : 'primary'}
                      size="sm"
                      onClick={() => void activate(model)}
                      disabled={loading}
                    >
                      {loading ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <Download size={11} />
                      )}
                      {loading ? '加载中' : ready ? '加载' : '下载并加载'}
                    </Button>
                  )}

                  {ready && !loadedNow ? (
                    <Button variant="ghost" size="sm" onClick={() => void drop(model)}>
                      <Trash2 size={11} />
                      删除下载
                    </Button>
                  ) : null}

                  {leftovers ? (
                    <Button variant="ghost" size="sm" onClick={() => void drop(model)}>
                      <Trash2 size={11} />
                      清理旧权重
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-3 text-[10.5px] leading-relaxed text-muted/65">
          权重保存在本机浏览器缓存，不会上传。加载即选用，不需另设当前模型；加载另一个会先释放内存中的这一个。
          换过量化版本后，旧权重会标成「旧权重」，可以直接清掉。更换嵌入引擎后，旧记忆片段不参与召回，需要重新入库。
        </p>
      </div>
    </div>
  );
}
