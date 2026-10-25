'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Download, Loader2, Power, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Segmented } from '@/components/ui/controls';
import { Panel } from '@/components/studio/workbench';
import { toast } from '@/components/ui/toast';
import {
  ALL_LOCAL_MODELS,
  LOCAL_EMBEDDINGS,
  LOCAL_TEXT,
  RETIRED_MODELS,
  formatBytes,
  sizeFor,
  useEngines,
  useModelRuntime,
  type Backend,
  type LocalModel,
  type ModelRuntimeState,
  type ResidentInfo,
} from '@/lib/engines';
import {
  backendLabel,
  dtypeFor,
  loadModel,
  recoverInterruptedLoad,
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

type RuntimeFacts = { cores: number; isolated: boolean; threads: number; deviceMemory?: number };

const fieldLabel = 'mb-1.5 block text-[10.5px] text-muted';

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
  const [released, setReleased] = useState(false);
  const [embedder, setEmbedder] = useState<EmbedderInfo | null>(null);
  const [facts, setFacts] = useState<RuntimeFacts | null>(null);

  const refresh = useCallback(async () => {
    // Retired repos are scanned too, otherwise their weights sit in the cache
    // with no card left to delete them from.
    setCache(await scanModelCache([...ALL_LOCAL_MODELS, ...RETIRED_MODELS]));
    setUsage(await storageUsage());
    setEmbedder(await activeEmbedder());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
    setFacts({ ...runtimeInfo(), deviceMemory: memory });
    // A load that killed the renderer leaves no state behind; the marker it
    // wrote is the only record, and it belongs on the card as an error.
    recoverInterruptedLoad();
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

  // "auto" resolves to WASM, so the effective backend is known without asking
  // the adapter; this is what the download size and the cache check key off.
  const backend: Backend = prefs.backend === 'webgpu' ? 'webgpu' : 'wasm';

  /**
   * Loading is the selection: the model that is in memory is the one the
   * workbenches use, so there is no separate "set as current" step. Because
   * only one model can stay resident, the other task drops back to its
   * non-local path instead of leaving a preference that would evict it later.
   */
  const activate = async (model: LocalModel) => {
    const previous = ALL_LOCAL_MODELS.find((item) => item.id === resident?.modelId);
    const dtype = dtypeFor(model, backend);

    const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
    if (model.minMemoryGB && memory && memory < model.minMemoryGB) {
      toast(
        `${model.label} 建议 ${model.minMemoryGB}GB 内存，本机只报告 ${memory}GB；可以先试，崩了就换小一档`,
        'info',
      );
    }

    // Only the weights that are not on disk need room; a cached model just
    // needs to be parsed into memory.
    if (!cache[model.id]?.[dtype]) {
      const now = await storageUsage();
      const need = sizeFor(model, backend) * 1024 * 1024;
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
      setReleased(false);
      // Cache writes land slightly after the session resolves; a second scan
      // stops the row from flashing 旧权重 for files it just downloaded.
      window.setTimeout(() => void refresh(), 1200);
      // The resident record knows the thread count the session was opened
      // with; `runtimeInfo()` would report the embedding budget for a
      // decoder, which is capped lower.
      const session = useModelRuntime.getState().resident;
      const replaced = previous && previous.id !== model.id ? `，已卸载 ${previous.label}` : '';
      toast(
        `已加载 ${model.label} · ${backendLabel(session?.backend)} ${session?.threads ?? '?'} 线程${replaced}`,
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
    setReleased(true);
    toast('已卸载；WASM 内存要刷新页面才还给系统', 'info');
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
      if (model && resident?.modelId !== model.id && cache[model.id]?.[dtypeFor(model, backend)]) {
        await activate(model);
      }
      return;
    }

    const mode = next as 'hash' | 'local' | 'api';
    await patch({ embeddingMode: mode });
    if (mode !== 'local') return;
    const model = ALL_LOCAL_MODELS.find(
      (item) => item.task === 'embedding' && item.id === prefs.embeddingModelId,
    );
    if (model && resident?.modelId !== model.id && cache[model.id]?.[dtypeFor(model, backend)]) {
      await activate(model);
    }
  };

  const preset = PRESETS.text.find((item) => item.id === draft.preset);
  const textModel = ALL_LOCAL_MODELS.find((item) => item.id === prefs.textModelId);
  const textReady = textModel ? cache[textModel.id]?.[dtypeFor(textModel, backend)] : false;
  const cloudReady = hasKey(draft);
  const loadingModel = ALL_LOCAL_MODELS.find((model) => models[model.id]?.state === 'downloading');
  const usedPercent = usage && usage.quota > 0 ? Math.round(usage.ratio * 100) : 0;
  const loadingState = loadingModel ? models[loadingModel.id] : undefined;
  const retired = RETIRED_MODELS.filter((row) => (cache[row.id]?.files ?? 0) > 0);
  const retiredBytes = retired.reduce((sum, row) => sum + (cache[row.id]?.bytes ?? 0), 0);

  const textStatus =
    prefs.textMode === 'api'
      ? cloudReady
        ? `云端 · ${draft.model}`
        : '云端 · 还没填密钥'
      : `${textModel?.label ?? '未选择'}${
          resident?.modelId === prefs.textModelId
            ? ' · 已加载'
            : textReady
              ? ' · 已下载，未加载'
              : ' · 未下载'
        }`;

  const embedStatus =
    prefs.embeddingMode === 'local'
      ? `${embedder?.label ?? '读取中'}${embedder?.dims ? ` · ${embedder.dims} 维` : ''}`
      : prefs.embeddingMode === 'api'
        ? '云端嵌入端点'
        : `哈希 · ${embedder?.dims ?? 192} 维`;

  const dropRetired = async () => {
    for (const row of retired) await removeModel(row.repo);
    await refresh();
    toast('已清理旧版模型权重', 'info');
  };

  const rowProps = {
    runtime: models,
    cache,
    resident,
    backend,
    onActivate: activate,
    onUnload: unload,
    onDrop: drop,
    onClearAndRetry: clearAndRetry,
  };

  return (
    <>
      <Panel title="引擎" hint="文本与嵌入各自选择来源；本地权重存在浏览器里">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="w-8 shrink-0 text-[11px] text-muted">文本</span>
            <Segmented
              size="sm"
              value={prefs.textMode}
              onChange={(next) => void chooseMode('text', next)}
              options={[
                { value: 'api', label: '云端 API' },
                { value: 'local', label: '本地模型' },
              ]}
            />
            <span className="ml-auto flex items-center gap-2 text-[11px] text-muted/75">
              {textStatus}
              {prefs.textMode === 'local' && !textReady ? (
                <a href="#models" className="text-[rgb(var(--copper))] hover:underline">
                  去下载
                </a>
              ) : null}
            </span>
          </div>

          {prefs.textMode === 'api' ? (
            <div className="rounded-xl px-4 py-4 shadow-[var(--shadow-inset-sm)]">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <label className={fieldLabel}>服务商</label>
                  <Select
                    value={draft.preset}
                    onChange={(event) => applyPreset(event.target.value)}
                    className="h-9 text-[12px]"
                  >
                    {PRESETS.text.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <label className={fieldLabel}>模型</label>
                  {preset && preset.models.length > 0 ? (
                    <Select
                      value={preset.models.includes(draft.model) ? draft.model : preset.models[0]}
                      onChange={(event) => setDraft((c) => ({ ...c, model: event.target.value }))}
                      className="h-9 text-[12px]"
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
                      className="h-9 font-mono text-[11.5px]"
                      spellCheck={false}
                    />
                  )}
                </div>

                <div>
                  <label className={fieldLabel}>API Key</label>
                  <Input
                    type="password"
                    value={draft.apiKey}
                    onChange={(event) => setDraft((c) => ({ ...c, apiKey: event.target.value }))}
                    placeholder={draft.shape === 'anthropic-chat' ? 'sk-ant-...' : 'sk-...'}
                    className="h-9 font-mono text-[11.5px]"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>

                <div>
                  <label className={fieldLabel}>Base URL</label>
                  <Input
                    value={draft.baseUrl}
                    onChange={(event) => setDraft((c) => ({ ...c, baseUrl: event.target.value }))}
                    placeholder="https://api.example.com/v1"
                    className="h-9 font-mono text-[11.5px]"
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

          <div className="h-px bg-[rgb(var(--line))]/45" />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="w-8 shrink-0 text-[11px] text-muted">嵌入</span>
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
            <span className="ml-auto flex items-center gap-2 text-[11px] text-muted/75">
              {embedStatus}
              {prefs.embeddingMode === 'local' && !embedder?.tag.startsWith('local:') ? (
                <a href="#models" className="text-[rgb(var(--copper))] hover:underline">
                  去下载
                </a>
              ) : null}
            </span>
          </div>
        </div>
      </Panel>

      <Panel
        id="models"
        title="本地模型"
        hint="下载后点「加载」即选用，一次只驻留一个"
        className="scroll-mt-24"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div
              data-resident={resident?.modelId ?? ''}
              className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted"
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    resident ? 'bg-[#4d7a5c]' : 'bg-[rgb(var(--copper))]/70',
                  )}
                />
                内存中
              </span>
              <span className="text-ink/80">
                {loadingModel
                  ? `${loadingModel.label} · 加载中 ${Math.round((loadingState?.progress ?? 0) * 100)}%`
                  : resident
                    ? (ALL_LOCAL_MODELS.find((item) => item.id === resident.modelId)?.label ?? '未知')
                    : '无'}
              </span>
              {resident ? (
                <span className="font-mono text-[10px] text-muted/65">
                  {backendLabel(resident.backend)} · {resident.threads} 线程
                </span>
              ) : null}
              {resident ? (
                <button
                  type="button"
                  onClick={() => void unload()}
                  className="text-[11px] text-muted underline-offset-2 transition-colors hover:text-ink hover:underline"
                >
                  卸载
                </button>
              ) : released ? (
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="text-[11px] text-muted underline-offset-2 transition-colors hover:text-ink hover:underline"
                >
                  刷新页面归还内存
                </button>
              ) : null}
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Select
                aria-label="下载源"
                value={prefs.source}
                onChange={(event) =>
                  void patch({ source: event.target.value as 'modelscope' | 'huggingface' })
                }
                className="h-8 w-full text-[11.5px] sm:w-[178px]"
              >
                <option value="modelscope">下载源 · ModelScope</option>
                <option value="huggingface">下载源 · HuggingFace</option>
              </Select>
              <Select
                aria-label="推理后端"
                value={prefs.backend}
                onChange={(event) =>
                  void patch({ backend: event.target.value as 'auto' | 'webgpu' | 'wasm' })
                }
                className="h-8 w-full text-[11.5px] sm:w-[190px]"
              >
                <option value="auto">后端 · WASM 量化</option>
                <option value="webgpu">后端 · WebGPU fp16</option>
                <option value="wasm">后端 · WASM</option>
              </Select>
            </div>
          </div>

        <ModelGroup
          title="文本模型"
          models={LOCAL_TEXT}
          accent={prefs.textMode === 'local'}
          {...rowProps}
        />
        <ModelGroup
          title="嵌入模型"
          models={LOCAL_EMBEDDINGS}
          accent={prefs.embeddingMode === 'local'}
          {...rowProps}
        />

        {retired.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-muted">
            <span>旧版模型权重</span>
            <span className="text-[10.5px] text-muted/60">
              {retired.map((row) => row.label).join(' / ')} · {formatBytes(retiredBytes)}
            </span>
            <button
              type="button"
              onClick={() => void dropRetired()}
              className="ml-auto text-[11px] text-muted underline-offset-2 transition-colors hover:text-[#a24a3f] hover:underline"
            >
              清理
            </button>
          </div>
        ) : null}

        <p className="text-[10.5px] leading-relaxed text-muted/60">
          权重存在本机浏览器缓存，不会上传。卸载只释放内存，刷新页面才真正归还。
          {usage
            ? ` 存储已用 ${formatBytes(usage.used)} / ${formatBytes(usage.quota)}（${usedPercent}%）。`
            : ''}
          {facts
            ? ` 当前环境 ${facts.cores} 核${facts.deviceMemory ? ` · ${facts.deviceMemory} GB 内存` : ''} · WASM 最多 ${facts.threads} 线程${facts.isolated ? '' : '（未开启跨源隔离，只能单线程）'}。`
            : ''}
        </p>
        </div>
      </Panel>
    </>
  );
}

type RowProps = {
  runtime: Record<string, ModelRuntimeState>;
  cache: Record<string, CacheStats>;
  resident: ResidentInfo;
  backend: Backend;
  onActivate: (model: LocalModel) => Promise<void>;
  onUnload: () => Promise<void>;
  onDrop: (model: LocalModel) => Promise<void>;
  onClearAndRetry: (model: LocalModel) => Promise<void>;
};

/** One titled group of model rows; the title replaces the old per-card badge. */
function ModelGroup({
  title,
  models: rows,
  ...row
}: { title: string; models: LocalModel[]; accent: boolean } & RowProps) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2.5">
        <span className="text-[11px] text-muted/75">{title}</span>
        <span className="h-px flex-1 bg-[rgb(var(--line))]/45" />
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
  resident,
  backend,
  onActivate,
  onUnload,
  onDrop,
  onClearAndRetry,
}: { model: LocalModel; accent: boolean } & RowProps) {
  const state = runtime[model.id];
  const stats = cache[model.id];
  const loadedNow = resident?.modelId === model.id;
  const dtype = dtypeFor(model, backend);
  const other = dtype === 'q8' ? 'fp16' : 'q8';
  // A just-loaded model is ready even if the cache scan ran a beat too early
  // to see its weight file.
  const ready = (stats?.[dtype] ?? false) || loadedNow;
  // The other precision is on disk but this backend cannot run it.
  const otherReady = !ready && (stats?.[other] ?? false);
  const leftovers = !ready && !otherReady && (stats?.files ?? 0) > 0;
  const loading = state?.state === 'downloading';
  const failed = state?.state === 'error';
  const percent = Math.round((state?.progress ?? 0) * 100);

  return (
    <div
      data-model={model.id}
      data-loaded={loadedNow ? 'true' : 'false'}
      className={cn(
        'rounded-xl px-4 py-3.5 shadow-[var(--shadow-inset-sm)]',
        loadedNow && 'ring-1 ring-[rgb(var(--accent))]/25',
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-[13px] text-ink/90">{model.label}</h4>
            {loadedNow ? (
              <span className="flex items-center gap-1 text-[10px] text-[#3f6b4f]">
                <Check size={11} />
                已加载
              </span>
            ) : ready ? (
              <span className="text-[10px] text-muted/60">已下载</span>
            ) : otherReady ? (
              <span className="text-[10px] text-muted/55">
                仅有 {other === 'q8' ? 'int8' : 'fp16'} 权重
              </span>
            ) : leftovers ? (
              <span className="text-[10px] text-muted/50">旧权重</span>
            ) : null}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted/85">{model.note}</p>
          <p className="mt-1.5 text-[10.5px] text-muted/60">
            约 {formatBytes(sizeFor(model, backend) * 1024 * 1024)} ·{' '}
            {backend === 'webgpu' ? 'fp16' : 'int8'}
            {model.dims ? ` · ${model.dims} 维` : ` · ${model.languages}`}
            {stats && stats.bytes > 0 ? ` · 占 ${formatBytes(stats.bytes)}` : ''}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {loadedNow ? (
            <Button variant="ghost" size="sm" onClick={() => void onUnload()}>
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
              disabled={loading}
            >
              {loading ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
              {loading ? '加载中' : ready ? '加载' : '下载并加载'}
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

      {failed ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-[#8c3b32]">
            <TriangleAlert size={11} className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">{state?.message ?? '加载失败'}</span>
          </div>
          {looksLikeMemoryPressure(state?.message ?? '') ? (
            <p className="text-[10px] leading-relaxed text-[#8c3b32]/75">
              更像内存或存储不足：先关掉占用大的标签页，再重试。
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => void onActivate(model)}>
              <RefreshCw size={11} />
              重试
            </Button>
            {ready ? (
              <Button variant="ghost" size="sm" onClick={() => void onClearAndRetry(model)}>
                删除缓存并重试
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
