'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Segmented } from '@/components/ui/controls';
import { Panel } from '@/components/studio/workbench';
import { SchedulingCard } from '@/components/studio/scheduling-card';
import { ModelGroup } from '@/components/studio/model-list';
import { CloudEndpointForm } from '@/components/studio/cloud-endpoint-form';
import { VaultPanel } from '@/components/studio/vault-panel';
import { residentCap, threadCap } from '@/lib/scheduling';
import { toast } from '@/components/ui/toast';
import {
  ALL_LOCAL_MODELS,
  LOCAL_EMBEDDINGS,
  LOCAL_TEXT,
  POOL_LABEL,
  RETIRED_MODELS,
  findModel,
  formatBytes,
  poolBudgetMB,
  poolOf,
  poolPeakMB,
  // `roomFor` already means "disk space" in this file; the memory question is
  // a different one and gets its own name.
  roomFor as memoryRoomFor,
  canRun,
  dtypeFor,
  sizeFor,
  usedPools,
  useEngines,
  useModelRuntime,
  type Backend,
  type EnginePrefs,
  type GpuPrecision,
  type LocalModel,
  type ModelRuntimeState,
  type ResidentPool,
  type ResidentInfo,
} from '@/lib/engines';
import {
  backendLabel,
  loadModel,
  recoverInterruptedLoad,
  removeModel,
  runtimeInfo,
  scanModelCache,
  threadCount,
  unloadModel,
  type CacheStats,
} from '@/lib/local-runtime';
import { activeEmbedder, type EmbedderInfo } from '@/lib/memory';
import { persistentStorageGranted } from '@/lib/model-cache';
import { useEndpoints } from '@/lib/endpoint-store';
import { hasKey, type Endpoint } from '@/lib/providers';
import { probeEndpoint } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { roomFor, storageUsage, type StorageUsage } from '@/lib/storage';
import { cn } from '@/lib/cn';

type RuntimeFacts = { cores: number; isolated: boolean; threads: number; deviceMemory?: number };

export function EnginePanel() {
  const prefs = useEngines((state) => state.prefs);
  const patch = useEngines((state) => state.patch);
  const loaded = useEngines((state) => state.loaded);
  const load = useEngines((state) => state.load);

  const models = useModelRuntime((state) => state.models);
  const residents = useModelRuntime((state) => state.residents);
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
  const [persisted, setPersisted] = useState(false);

  const refresh = useCallback(async () => {
    // Retired repos are scanned too, otherwise their weights sit in the cache
    // with no card left to delete them from.
    setCache(await scanModelCache([...ALL_LOCAL_MODELS, ...RETIRED_MODELS]));
    setUsage(await storageUsage());
    setEmbedder(await activeEmbedder());
    setPersisted(await persistentStorageGranted());
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
  }, [loaded, prefs, residents, refresh]);

  useEffect(() => {
    setDraft(endpoints.text);
  }, [endpoints.text]);

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
  const precision = prefs.gpuPrecision;

  /**
   * Loading is the selection: the model that is in memory is the one the
   * workbenches use, so there is no separate "set as current" step. Because
   * only one model can stay resident, the other task drops back to its
   * non-local path instead of leaving a preference that would evict it later.
   */
  const activate = async (model: LocalModel) => {
    // A double click used to queue two loads: the gate serialised them, but
    // both would then patch preferences and toast. The state is written
    // synchronously, so the second click sees it.
    if (useModelRuntime.getState().models[model.id]?.state === 'downloading') return;
    if (!canRun(model, backend)) {
      toast(`${model.label} 需要 WebGPU：int8 权重超出 wasm 堆，先在下方把后端切过去`, 'info');
      return;
    }

    const before = useModelRuntime.getState().residents;
    const dtype = dtypeFor(model, backend, precision);

    const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
    if (model.minMemoryGB && memory && memory < model.minMemoryGB) {
      toast(
        `${model.label} 建议 ${model.minMemoryGB}GB 内存，本机只报告 ${memory}GB；可以先试，崩了就换小一档`,
        'info',
      );
    }

    // Say it before the download starts, not after: a big embedder will push
    // the decoder out, and finding that out at 543MB is too late.
    const other = residents.find(
      (row) => row.task !== model.task && poolOf(row.backend) === poolOf(backend),
    );
    const otherModel = other ? findModel(other.modelId) : undefined;
    // Two ways this load evicts the other side: the pool has no room, or the
    // profile only allows one session per pool. The second one used to be
    // silent — `lean` dropped the decoder without a word.
    const pool = poolOf(backend);
    const overCap = residents.filter((row) => poolOf(row.backend) === pool).length >= residentCap(
      prefs.profile,
      pool,
    );
    // Charge the session for the threads it will actually open; the estimate
    // now includes one arena per worker, so this matches what `makeRoom` sees.
    const plannedThreads = threadCount(
      facts?.cores ?? 4,
      facts?.isolated ?? false,
      model.task,
      false,
      threadCap(prefs.profile, model.task),
    );
    const hasRoom = memoryRoomFor(residents, model, backend, prefs.gpuPrecision, plannedThreads);
    // Sessions only compete inside one pool: a GPU decoder and a WASM embedder
    // are budgeted separately, so they never evict each other.
    if (other && otherModel && (overCap || !hasRoom)) {
      toast(
        overCap && hasRoom
          ? `加载 ${model.label} 会先卸载 ${otherModel.label}：当前策略每个${
              pool === 'gpu' ? '显存池' : '内存池'
            }只留一个会话`
          : `加载 ${model.label} 会先卸载 ${otherModel.label}：两个会话合计超出${
              pool === 'gpu' ? '显存' : ' WASM 内存'
            }`,
        'info',
      );
    }

    // Only the weights that are not on disk need room; a cached model just
    // needs to be parsed into memory.
    if (!cache[model.id]?.[dtype]) {
      const now = await storageUsage();
      const need = sizeFor(model, backend, precision) * 1024 * 1024;
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
        precision: prefs.gpuPrecision,
        report: true,
      });

      // Preferences follow what is actually in memory. A session evicted for
      // budget must not stay marked "local": the next message would load it
      // back, evict the other side, and the pair would thrash.
      const after = useModelRuntime.getState().residents;
      const dropped = before.filter(
        (row) => row.modelId !== model.id && !after.some((next) => next.modelId === row.modelId),
      );
      const nextPrefs: Partial<EnginePrefs> =
        model.task === 'text'
          ? { textMode: 'local', textModelId: model.id }
          : { embeddingMode: 'local', embeddingModelId: model.id };
      if (dropped.some((row) => row.task === 'embedding')) nextPrefs.embeddingMode = 'hash';
      if (dropped.some((row) => row.task === 'text')) nextPrefs.textMode = 'api';
      await patch(nextPrefs);

      await refresh();
      setReleased(false);
      // Cache writes land slightly after the session resolves; a second scan
      // stops the row from flashing 旧权重 for files it just downloaded.
      window.setTimeout(() => void refresh(), 1200);
      // The resident record knows the thread count the session was opened
      // with; `runtimeInfo()` would report the embedding budget for a
      // decoder, which is capped lower.
      const session = after.find((row) => row.modelId === model.id);
      const replaced = dropped
        .map((row) => findModel(row.modelId)?.label ?? row.modelId)
        .join('、');
      const reason = dropped.length
        ? `（${dropped[0].backend === 'webgpu' ? '显存' : 'WASM 内存'}预算不足，${
            dropped.some((row) => row.task === 'text') ? '文本已切回云端' : '嵌入已切回哈希'
          }）`
        : '';
      toast(
        `已加载 ${model.label} · ${backendLabel(session?.backend)} ${session?.threads ?? '?'} 线程${
          replaced ? `，已卸载 ${replaced}${reason}` : ''
        }`,
        'success',
      );
    } catch (error) {
      const message = describeError(error);
      setModel(model.id, { state: 'error', progress: 0, message });
      toast(`${model.label} 加载失败：${message}`, 'error');
    }
  };

  const unload = async (modelId?: string, label?: string) => {
    await unloadModel(modelId);
    await refresh();
    const left = useModelRuntime.getState().residents.length;
    setReleased(left === 0);
    toast(
      label ? `已卸载 ${label}` : '已卸载全部模型；WASM 内存要刷新页面才还给系统',
      'info',
    );
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
      if (model && !residents.some((row) => row.modelId === model.id) && cache[model.id]?.[dtypeFor(model, backend, precision)]) {
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
    if (model && !residents.some((row) => row.modelId === model.id) && cache[model.id]?.[dtypeFor(model, backend, precision)]) {
      await activate(model);
    }
  };

  const textModel = ALL_LOCAL_MODELS.find((item) => item.id === prefs.textModelId);
  // A loaded session counts even when the cache scan ran before the weights
  // were flushed, otherwise a just-loaded model still offers "去下载".
  const textReady =
    residents.some((row) => row.modelId === prefs.textModelId) ||
    (textModel ? (cache[textModel.id]?.[dtypeFor(textModel, backend, precision)] ?? false) : false);
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
        : endpoints.text.sealed
          ? '云端 · 密钥已加密，待解锁'
          : '云端 · 还没填密钥'
      : `${textModel?.label ?? '未选择'}${
          residents.some((row) => row.modelId === prefs.textModelId)
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
    residents,
    backend,
    precision,
    onActivate: activate,
    onUnload: (model: LocalModel) => unload(model.id, model.label),
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
            <CloudEndpointForm
              draft={draft}
              onChange={setDraft}
              onSave={() => void saveCloud()}
              onTest={() => void testCloud()}
              testing={testing}
              ready={cloudReady}
            />
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
        hint="下载后点「加载」即选用；文本与嵌入可同时驻留，只有同一个内存池装不下才会卸掉另一侧"
        className="scroll-mt-24"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div
              data-resident={residents.map((row) => row.modelId).join(' ')}
              className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted"
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    residents.length > 0 ? 'bg-[#4d7a5c]' : 'bg-[rgb(var(--copper))]/70',
                  )}
                />
                内存中
              </span>

              {loadingModel ? (
                <span className="text-ink/80">
                  {loadingModel.label} · 加载中{' '}
                  {Math.round((loadingState?.progress ?? 0) * 100)}%
                  {loadingState?.total ? (
                    <span className="ml-1.5 font-mono text-[10px] text-muted/65">
                      {formatBytes(loadingState.loaded ?? 0)} / {formatBytes(loadingState.total)}
                    </span>
                  ) : null}
                  {/* External data arrives as `_data` shards, one after
                      another; naming the phase stops a 2GB leg from looking
                      like a stalled graph download. */}
                  {loadingState?.file?.includes('_data') ? (
                    <span className="ml-1.5 text-[10px] text-muted/60">权重分片</span>
                  ) : null}
                </span>
              ) : null}

              {residents.length === 0 && !loadingModel ? <span className="text-ink/80">无</span> : null}

              {residents.map((row) => {
                const model = findModel(row.modelId);
                return (
                  <span key={row.modelId} className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted/50">
                      {row.task === 'text' ? '文本' : '嵌入'}
                    </span>
                    <span className="text-ink/80">{model?.label ?? row.modelId}</span>
                    <span className="font-mono text-[10px] text-muted/60">
                      {backendLabel(row.backend)} · {row.threads} 线程
                    </span>
                    <button
                      type="button"
                      onClick={() => void unload(row.modelId, model?.label)}
                      className="text-[11px] text-muted underline-offset-2 transition-colors hover:text-ink hover:underline"
                    >
                      卸载
                    </button>
                  </span>
                );
              })}

              {residents.length > 0 ? (
                // One figure per pool: a GPU session does not consume the wasm
                // heap, so a single "x / 3.3 GB" would read as an overload.
                <span className="ml-auto flex flex-wrap items-center gap-x-3 font-mono text-[10px] text-muted/55">
                  {usedPools(residents).map((pool) => (
                    <span
                      key={pool}
                      title={
                        pool === 'gpu'
                          ? 'WebGPU 会话的权重与激活在 GPU 缓冲里，与本机 WASM 堆分开计算'
                          : 'WASM 会话共享 wasm32 的 4GB 线性内存，已为页面留出余量'
                      }
                    >
                      {POOL_LABEL[pool]} {formatBytes(poolPeakMB(residents, pool) * 1024 * 1024)} /{' '}
                      {(poolBudgetMB(pool) / 1024).toFixed(1)} GB
                    </span>
                  ))}
                </span>
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
                <option value="webgpu">后端 · WebGPU</option>
                <option value="wasm">后端 · WASM</option>
              </Select>
              {/* Only meaningful where there is a choice: WASM has one int8
                  path, and `q4` is bigger than int8 on these repos. */}
              {backend === 'webgpu' ? (
                <Select
                  aria-label="WebGPU 精度"
                  value={prefs.gpuPrecision}
                  onChange={(event) =>
                    void patch({ gpuPrecision: event.target.value as GpuPrecision })
                  }
                  className="h-8 w-full text-[11.5px] sm:w-[176px]"
                >
                  <option value="fp16">精度 · fp16</option>
                  <option value="q4f16">精度 · 4 位（省一半）</option>
                </Select>
              ) : null}
            </div>
          </div>

          {backend === 'webgpu' && prefs.gpuPrecision === 'q4f16' ? (
            <p className="text-[10.5px] leading-relaxed text-muted/60">
              4 位只作用于文本模型，省一半显存；嵌入模型仍走 fp16——BGE 的 4 位会话在 WebGPU
              上建不起来（ONNX Runtime 1151160272），而它本来就只有百兆级。
            </p>
          ) : null}

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
            ? ` 存储已用 ${formatBytes(usage.used)} / ${formatBytes(usage.quota)}（${usedPercent}%）${
                persisted ? '，已获持久存储' : ''
              }。`
            : ''}
          {facts
            ? ` 当前环境 ${facts.cores} 核${facts.deviceMemory ? ` · ${facts.deviceMemory} GB 内存` : ''} · WASM 最多 ${facts.threads} 线程${facts.isolated ? '' : '（未开启跨源隔离，只能单线程）'}。`
            : ''}
        </p>
        </div>
      </Panel>

      <VaultPanel />
      <SchedulingCard />
    </>
  );
}
