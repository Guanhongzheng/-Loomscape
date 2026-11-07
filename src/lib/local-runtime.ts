'use client';

import {
  MAX_FILE_MB,
  canRun,
  dtypeFor,
  exceedsWeightLimit,
  findModel,
  fitsTogether,
  poolBaseMB,
  poolBudgetMB,
  poolOf,
  poolPeakMB,
  sessionPeakMB,
  useEngines,
  useModelRuntime,
  type Backend,
  type GpuPrecision,
  type LocalModel,
  type ModelDtype,
  type ModelSource,
  type ResidentInfo,
} from './engines';
import { describeError } from './errors';
import { createDownloadProgress } from './download-progress';
import { residentCap, threadCap } from './scheduling';
import { createReasoningFilter, createStopFilter, promptFor } from './local-prompts';
import { isWeightRequest, weightFile, weightShards } from './weights';
import {
  acquireModelLock,
  claimedElsewhere,
  fitsAcrossTabs,
  releaseAllModelLocks,
  releaseModelLock,
} from './tab-claims';
import {
  MODEL_CACHE_NAME,
  dropEntriesForRepo,
  dropEntry,
  entriesForRepo,
  ensurePersistentStorage,
  isFresh,
  readEntries,
  saveEntry,
  type ModelCacheEntry,
} from './model-cache';

/**
 * The browser bundle is served from /runtime and imported natively. Bundling it
 * with webpack breaks on import.meta inside onnxruntime, so the file is copied
 * at build time and treated as an external module.
 */
type RuntimeModule = {
  env: {
    allowLocalModels: boolean;
    useBrowserCache: boolean;
    remoteHost: string;
    remotePathTemplate: string;
    backends: {
      onnx: {
        wasm?: {
          wasmPaths?: string;
          numThreads?: number;
          simd?: boolean;
          proxy?: boolean;
        };
      };
    };
  };
  pipeline: (task: string, model: string, options: Record<string, unknown>) => Promise<unknown>;
  TextStreamer: new (
    tokenizer: unknown,
    options: {
      skip_prompt?: boolean;
      skip_special_tokens?: boolean;
      callback_function?: (text: string) => void;
    },
  ) => unknown;
};

let modulePromise: Promise<RuntimeModule> | null = null;

/**
 * WASM can only use worker threads when the document is cross-origin isolated,
 * because that is the only way `SharedArrayBuffer` exists. The app sends
 * COOP/COEP for exactly this reason; behind a proxy that strips them the
 * runtime drops to a single thread instead of failing.
 *
 * One core is left to the UI, and the cap is four: transformer matmuls stop
 * scaling past that and each worker costs memory next to a half-billion
 * parameter model.
 */
export function threadCount(
  cores: number,
  isolated: boolean,
  task: 'text' | 'embedding' = 'embedding',
  sharing = false,
  /** Scheduling profile cap; the defaults below are the balanced profile. */
  cap = task === 'text' ? 2 : 4,
): number {
  if (!isolated) return 1;
  const usable = Math.max(1, Math.floor(cores) - 1);
  // Decoding keeps a KV cache and per-thread arenas alive, so a 4-thread text
  // session can need several gigabytes where an embedding one needs tens of
  // megabytes. Two threads is the point where the extra speed stops paying
  // for the extra memory. When a decoder is already loaded the embedder drops
  // to the same cap: the pair has to fit one heap — a profile may lower this,
  // never raise it.
  const effective = sharing ? Math.min(cap, 2) : cap;
  return Math.min(usable, effective);
}

export function runtimeInfo(): { cores: number; isolated: boolean; threads: number } {
  const cores =
    typeof navigator !== 'undefined' ? Math.max(1, navigator.hardwareConcurrency || 2) : 2;
  const isolated =
    (globalThis as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
  return { cores, isolated, threads: threadCount(cores, isolated) };
}

async function runtime(source: ModelSource): Promise<RuntimeModule> {
  if (!modulePromise) {
    const url = '/runtime/transformers.min.js';
    modulePromise = import(/* webpackIgnore: true */ url) as Promise<RuntimeModule>;
  }
  const mod = await modulePromise;

  mod.env.allowLocalModels = false;
  mod.env.useBrowserCache = true;
  mod.env.remoteHost =
    source === 'modelscope' ? 'https://modelscope.cn/models/' : 'https://huggingface.co/';
  mod.env.remotePathTemplate = '{model}/resolve/{revision}/';
  const wasmBackend = mod.env.backends.onnx.wasm;
  if (wasmBackend) {
    wasmBackend.wasmPaths = '/runtime/';
    // Set again per session below; this is the fallback for the first load.
    wasmBackend.numThreads = runtimeInfo().threads;
    wasmBackend.simd = true;
    // Worker proxies add a message hop per call; the main thread is fine here.
    wasmBackend.proxy = false;
  }

  return mod;
}

const revisionOf = (source: ModelSource) => (source === 'modelscope' ? 'master' : 'main');

/** transformers.js task names differ from our engine vocabulary. */
const pipelineTask = (task: 'embedding' | 'text') =>
  task === 'embedding' ? 'feature-extraction' : 'text-generation';

/**
 * Auto mode stays on WASM with int8 weights: it is the smallest download and
 * the most predictable across GPUs. WebGPU stays an explicit choice, and it
 * runs fp16 — see dtypeFor for why it must not ask for fp32.
 */
export async function detectBackend(preference: 'auto' | Backend): Promise<Backend> {
  if (preference === 'auto') return 'wasm';
  if (preference === 'wasm') return 'wasm';
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    if (!gpu) return 'wasm';
    const adapter = await gpu.requestAdapter();
    return adapter ? 'webgpu' : 'wasm';
  } catch {
    return 'wasm';
  }
}

export function backendLabel(backend?: Backend): string {
  if (!backend) return '未运行';
  return backend === 'webgpu' ? 'WebGPU' : 'WASM';
}

type LoadOptions = {
  source: ModelSource;
  backendPreference: 'auto' | Backend;
  /** Which WebGPU precision to run; ignored on the WASM path. */
  precision?: GpuPrecision;
  report?: boolean;
};

const pipelines = new Map<string, Promise<unknown>>();
/**
 * modelId → pipeline key. The store holds the resident *record*, but not the
 * cache key of the promise behind it, and disposing a session means finding
 * that exact entry; keeping the two side by side in one map avoids recomputing
 * a key that must match character for character.
 */
const pipelineKeys = new Map<string, string>();

/**
 * The single source of truth for "what is loaded" is the runtime store, which
 * the settings panel renders. A second array in this module used to be kept in
 * sync by hand, and every failure path had one more place to forget.
 */
const residentsOf = () => useModelRuntime.getState().residents;

/**
 * One run per session at a time. Two overlapping decodes on the same pipeline
 * double the KV cache, and two encodes double the activation buffers — inside
 * a 4GB heap that is the difference between fitting and `Aborted()`. Calls
 * queue instead of being dropped, so a fast double submit still produces two
 * answers, in order.
 */
const running = new Map<string, Promise<unknown>>();

function exclusive<T>(modelId: string, work: () => Promise<T>): Promise<T> {
  const previous = running.get(modelId) ?? Promise.resolve();
  const run = previous.then(work, work);
  running.set(
    modelId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

const ATTEMPT_KEY = 'loomscape:model-load';

/**
 * A renderer that runs out of wasm memory dies inside the await: no catch
 * block runs, the tab reloads, and the card falls back to 「未加载」 as if the
 * click was never received. The marker is written before the pipeline starts
 * and cleared when it settles, so the next mount can explain what happened
 * instead of making the download look wasted.
 */
function markAttempt(modelId: string | null): void {
  try {
    if (modelId) {
      localStorage.setItem(ATTEMPT_KEY, JSON.stringify({ modelId, at: Date.now() }));
    } else {
      localStorage.removeItem(ATTEMPT_KEY);
    }
  } catch {
    // private mode or a full quota: the marker is a nicety, not a requirement
  }
}

/** Turns a dangling marker into a visible error on that model's card. */
export function recoverInterruptedLoad(): string | null {
  if (typeof localStorage === 'undefined') return null;

  let raw: string | null = null;
  try {
    raw = localStorage.getItem(ATTEMPT_KEY);
    if (!raw) return null;
    localStorage.removeItem(ATTEMPT_KEY);
  } catch {
    return null;
  }

  let attempt: { modelId?: string; at?: number } | null = null;
  try {
    attempt = JSON.parse(raw) as { modelId?: string; at?: number };
  } catch {
    return null;
  }

  const model = attempt?.modelId ? findModel(attempt.modelId) : undefined;
  // Stale markers are from a session the user already moved on from.
  if (!model || !attempt?.at || Date.now() - attempt.at > 30 * 60 * 1000) return null;

  useModelRuntime.getState().set(model.id, {
    state: 'error',
    progress: 0,
    message: `上次加载 ${model.label} 没有完成：页面被关闭，或者浏览器内存不足中断了推理引擎。再点一次即可；如果反复中断，这台设备可能带不动这个模型。`,
  });
  return model.id;
}

/**
 * Loaded sessions live in `useModelRuntime.residents`; a decoder and an
 * embedder can share the wasm heap when the budget allows it — that is what
 * makes local retrieval work next to a local writer. A second session of the
 * same task always evicts the first, and a pair that does not fit evicts the
 * older side.
 */
async function dispose(pipe: unknown): Promise<void> {
  const candidate = pipe as { dispose?: () => Promise<void> | void };
  try {
    await candidate.dispose?.();
  } catch {
    // an already-released session is not an error worth surfacing
  }
}

export function residentModelId(): string | null {
  return residentsOf()[0]?.modelId ?? null;
}

export function residentModelIds(): string[] {
  return residentsOf().map((row) => row.modelId);
}

export function isResident(modelId: string): boolean {
  return residentsOf().some((row) => row.modelId === modelId);
}

/**
 * Drops one session: its pipeline promise (which may still be in flight), its
 * cache entries and its card state. The wasm heap itself cannot shrink, but
 * releasing the session stops it from growing with the next token.
 */
async function release(entry: ResidentInfo): Promise<void> {
  const key = pipelineKeys.get(entry.modelId);
  pipelineKeys.delete(entry.modelId);
  releaseModelLock(entry.modelId);
  const pending = key ? pipelines.get(key) : undefined;
  if (key) pipelines.delete(key);

  const store = useModelRuntime.getState();
  store.dropResident(entry.modelId);
  store.reset(entry.modelId);

  if (!pending) return;
  try {
    await dispose(await pending);
  } catch {
    // the load itself failed; nothing to release
  }
}

/**
 * Releases one model, or everything when called without an id. Pending loads
 * are disposed as soon as they land, which lets the caller evict while a
 * download is still in flight without leaving an orphan session behind.
 */
export async function unloadModel(modelId?: string): Promise<void> {
  return serialised(() => drop(modelId));
}

async function drop(modelId?: string): Promise<void> {
  if (modelId) {
    const target = residentsOf().find((row) => row.modelId === modelId);
    if (target) await release(target);
    return;
  }

  const pending = Array.from(pipelines.values());
  pipelines.clear();
  pipelineKeys.clear();
  releaseAllModelLocks();
  const store = useModelRuntime.getState();
  store.clearResident();
  Object.keys(store.models).forEach((id) => store.reset(id));

  await Promise.all(
    pending.map(async (entry) => {
      try {
        await dispose(await entry);
      } catch {
        // the load itself failed; nothing to release
      }
    }),
  );
}

/**
 * Records a session in the store, which is the only place that answers
 * "what is loaded". The pipeline key is parked beside it so `release` can
 * dispose the exact promise without recomputing it.
 */
function recordResident(next: ResidentInfo, key: string): void {
  pipelineKeys.set(next.modelId, key);
  useModelRuntime.getState().setResident(next);
}

async function makeRoom(next: ResidentInfo): Promise<void> {
  const sameTask = residentsOf().filter(
    (row) => row.task === next.task && row.modelId !== next.modelId,
  );
  for (const row of sameTask) await release(row);

  // Only the pool this session will live in decides who has to go. A GPU
  // session must never evict a WASM one: they do not compete for the same
  // memory, and adding them together is what made WebGPU look unusable.
  const pool = poolOf(next.backend);
  const budget = poolBudgetMB(pool);
  // `lean` sets the cap to one: it would rather drop the decoder than keep an
  // embedder beside it, even when the pair still fits. Dropping is in load
  // order, so the session that has been useful the longest is the one evicted.
  const cap = residentCap(useEngines.getState().prefs.profile, pool);
  for (;;) {
    const occupants = residentsOf().filter((row) => poolOf(row.backend) === pool);
    if (occupants.length === 0) break;
    const overCap = occupants.length >= cap;
    const overBudget = poolPeakMB(occupants, pool) + next.peakMB > budget;
    if (!overCap && !overBudget) break;
    await release(occupants[0]);
  }
}

/**
 * Loads are serialised. Two clicks in quick succession used to start two
 * pipelines at once; whichever finished last won the resident slot while the
 * other stayed in memory, because the eviction check ran before the first load
 * had finished. A single gate makes the second load wait, then evict the first.
 */
let gate: Promise<unknown> = Promise.resolve();

function serialised<T>(work: () => Promise<T>): Promise<T> {
  const run = gate.then(work, work);
  gate = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function loadPipeline(model: LocalModel, options: LoadOptions): Promise<{ pipe: any; backend: Backend }> {
  return serialised(() => acquire(model, options));
}

async function acquire(model: LocalModel, options: LoadOptions): Promise<{ pipe: any; backend: Backend }> {
  const mod = await runtime(options.source);
  const backend = await detectBackend(options.backendPreference);
  const precision = options.precision ?? 'fp16';
  // A decoder whose int8 file exceeds the 4GB heap has no WASM path at all;
  // starting the download anyway would end in `Aborted()` after 1.6GB.
  if (!canRun(model, backend)) {
    const message = `${model.label} 只能在 WebGPU 上运行：int8 权重约 ${model.sizesMB.q8}MB，超出 wasm 堆`;
    if (options.report) {
      useModelRuntime.getState().set(model.id, { state: 'error', progress: 0, backend, message });
    }
    throw new Error(message);
  }
  const dtype = dtypeFor(model, backend, precision);
  // The runtime copies the fetched buffer into the wasm heap, so one file over
  // ~1.2GB fails at session creation after the whole download. Say so first.
  if (exceedsWeightLimit(model, dtype)) {
    const message = `${model.label} 的权重 ${model.sizesMB[dtype]}MB 超过单文件上限（约 ${
      MAX_FILE_MB / 1024
    }GB）：下载完成后 ONNX Runtime 会在建会话时耗尽内存`;
    if (options.report) {
      useModelRuntime.getState().set(model.id, { state: 'error', progress: 0, backend, message });
    }
    throw new Error(message);
  }
  // An embedder loaded next to a decoder gives up half its threads: the pair
  // shares one heap, and worker arenas are the part that grows with threads.
  const sharing = model.task === 'embedding' && residentsOf().some((row) => row.task === 'text');
  const profile = useEngines.getState().prefs.profile;
  const threads = threadCount(
    runtimeInfo().cores,
    runtimeInfo().isolated,
    model.task,
    sharing,
    threadCap(profile, model.task),
  );
  const key = `${pipelineTask(model.task)}:${model.repo}:${dtype}:${backend}:${threads}`;
  const next: ResidentInfo = {
    modelId: model.id,
    task: model.task,
    backend,
    threads,
    dtype,
    peakMB: sessionPeakMB(model, backend, precision, threads),
  };

  // A session that cannot fit its own pool used to be attempted anyway: the
  // eviction loop only ran when something else was loaded, so a too-large
  // model went straight to `Aborted()` and took the tab with it. Refusing here
  // turns that into a card that says why.
  if (!fitsTogether([model], backend, precision, { [model.task]: threads })) {
    const pool = poolOf(backend);
    const needGB = ((poolPeakMB([], pool) + next.peakMB) / 1024).toFixed(1);
    const capGB = (poolBudgetMB(pool) / 1024).toFixed(1);
    const message = `${model.label} 估算需要约 ${needGB}GB ${
      pool === 'gpu' ? '显存' : 'WASM 内存'
    }，超过本机上限 ${capGB}GB`;
    if (options.report) {
      useModelRuntime.getState().set(model.id, { state: 'error', progress: 0, backend, message });
    }
    throw new Error(message);
  }

  const wasmBackend = mod.env.backends.onnx.wasm;
  if (wasmBackend) wasmBackend.numThreads = threads;

  if (pipelines.has(key)) {
    // Already parsed: just re-assert the record, no room keeping needed.
    recordResident(next, key);
    return { pipe: await pipelines.get(key)!, backend };
  }

  // Another tab already holds this model. A Web Lock is atomic, so unlike the
  // previous record-only check it also closes the "both tabs start at once"
  // window. The lock is released by the browser if that tab dies.
  const pool = poolOf(backend);
  const locked = await acquireModelLock(model.id, { pool, peakMB: next.peakMB });
  if (!locked) {
    const message = `${model.label} 正在另一个标签页里使用：同一个模型不能在两处驻留。先在那一边卸载，或者关掉那个标签页再试。`;
    if (options.report) {
      useModelRuntime.getState().set(model.id, { state: 'error', progress: 0, backend, message });
    }
    throw new Error(message);
  }

  // Different models still compete for the same machine. Every tab publishes
  // what it holds; if the sum would cross this pool's ceiling, refuse before
  // the download rather than after it.
  const others = claimedElsewhere(pool);
  const own = residentsOf()
    .filter((row) => poolOf(row.backend) === pool)
    .reduce((sum, row) => sum + row.peakMB, 0);
  if (!fitsAcrossTabs(own, others, next.peakMB, poolBaseMB(pool), poolBudgetMB(pool))) {
    releaseModelLock(model.id);
    const totalGB = ((own + others + next.peakMB) / 1024).toFixed(1);
    const capGB = (poolBudgetMB(pool) / 1024).toFixed(1);
    const message = `其他标签页加上这一个合计约 ${totalGB}GB ${
      pool === 'gpu' ? '显存' : 'WASM 内存'
    }，超过本机上限 ${capGB}GB。先在另一边卸载一些模型再试。`;
    if (options.report) {
      useModelRuntime.getState().set(model.id, { state: 'error', progress: 0, backend, message });
    }
    throw new Error(message);
  }

  try {
    await makeRoom(next);
  } catch (error) {
    releaseModelLock(model.id);
    throw error;
  }

  const runtimeStore = useModelRuntime.getState();
  if (options.report) {
    // A retry starts a new attempt: drop the previous file and byte count
    // instead of showing them next to a 0% bar.
    runtimeStore.set(model.id, {
      state: 'downloading',
      progress: 0,
      file: undefined,
      loaded: undefined,
      total: undefined,
      backend,
    });
  }
  markAttempt(model.id);
  // Weights are worthless if the browser evicts them under pressure, which is
  // exactly what would force the same download again next visit.
  void ensurePersistentStorage();

  // The catalogue knows the finished weight size, which is used as a floor for
  // the denominator. Without it, a sharded model would jump back at every new
  // file ("90% → 45%") because only the files seen so far are counted.
  const tracker = createDownloadProgress(model.sizesMB[dtype] * 1024 * 1024);

  const onProgress = (event: {
    status: string;
    file?: string;
    loaded?: number;
    total?: number;
  }) => {
    if (!options.report) return;
    const snapshot = tracker.apply(event);
    if (!snapshot) return;
    runtimeStore.set(model.id, { state: 'downloading', ...snapshot, backend });
  };

  const task = (async () => {
    const pipe = await mod.pipeline(pipelineTask(model.task), model.repo, {
      dtype,
      device: backend === 'webgpu' ? 'webgpu' : 'wasm',
      revision: revisionOf(options.source),
      progress_callback: onProgress,
      // Both default to on. For a decoder they pre-allocate a planner sized by
      // the graph's peak, which is what pushes the tab towards the 4GB wasm
      // ceiling on a small machine. The allocation saving beats the small
      // reuse win here.
      session_options: {
        enableCpuMemArena: false,
        enableMemPattern: false,
      },
    });
    return pipe;
  })();

  pipelines.set(key, task);

  try {
    const pipe = await task;
    markAttempt(null);
    recordResident(next, key);

    if (options.report) {
      runtimeStore.set(model.id, {
        state: 'ready',
        progress: 1,
        backend,
        file: undefined,
        total: 0,
        loaded: 0,
      });
    }
    return { pipe, backend };
  } catch (error) {
    pipelines.delete(key);
    markAttempt(null);
    // Nothing is resident, so the cross-tab lock has to go with the failure;
    // otherwise the tab blocks its own retry.
    releaseModelLock(model.id);
    if (options.report) {
      // Keep where the transfer stopped. A card that resets to 0% throws away
      // the one number that tells the user whether retrying is cheap or means
      // another 500MB; `ready` is still the only state with progress 1.
      const snapshot = tracker.snapshot();
      runtimeStore.set(model.id, {
        state: 'error',
        progress: snapshot.progress,
        file: snapshot.file,
        loaded: snapshot.loaded,
        total: snapshot.total,
        backend,
        message: describeError(error),
      });
    }
    throw error;
  }
}

export async function loadModel(model: LocalModel, options: LoadOptions) {
  return loadPipeline(model, options);
}

export type CacheStats = {
  files: number;
  bytes: number;
  /** Weight files that are on disk, by the precision that can run them. */
  q8: boolean;
  fp16: boolean;
  q4f16: boolean;
};

/**
 * Reads the cache once for every model instead of once per model. Sizes come
 * from the stored `content-length`; responses without it are counted but not
 * measured, which is why `bytes` can be lower than the model card claims.
 */
export async function scanModelCache(
  models: Array<{ id: string; repo: string } & { weightSplit?: LocalModel['weightSplit'] }>,
): Promise<Record<string, CacheStats>> {
  const result: Record<string, CacheStats> = {};
  for (const model of models) {
    result[model.id] = { files: 0, bytes: 0, q8: false, fp16: false, q4f16: false };
  }

  if (typeof caches === 'undefined') return result;

  try {
    const cache = await caches.open(MODEL_CACHE_NAME);
    const keys = await cache.keys();
    if (keys.length === 0) {
      // A cleared browser must not be remembered as "downloaded".
      await Promise.all(models.map((model) => dropEntry(model.id)));
      return result;
    }

    const index = await readEntries();
    const now = Date.now();
    const writes: ModelCacheEntry[] = [];

    for (const model of models) {
      const requests = keys.filter((request) => request.url.includes(model.repo));
      if (requests.length === 0) {
        if (index[model.id]) await dropEntry(model.id);
        continue;
      }

      const paths = Array.from(new Set(requests.map((request) => pathOf(request.url))));
      const known = index[model.id]?.files;
      // Same files as last time: reuse the measured sizes and skip the
      // per-file `cache.match()`, which is the expensive half of this scan.
      const unchanged =
        Boolean(known) &&
        paths.length === Object.keys(known as Record<string, number>).length &&
        paths.every((path) => path in (known as Record<string, number>));

      const sizes: Record<string, number> = unchanged ? { ...(known as Record<string, number>) } : {};
      if (!unchanged) {
        for (const request of requests) {
          const path = pathOf(request.url);
          if (path in sizes) continue;
          const response = await cache.match(request);
          const length = Number(response?.headers.get('content-length') ?? 0);
          sizes[path] = Number.isFinite(length) && length > 0 ? length : 0;
        }
      }

      const row = result[model.id];
      row.files = requests.length;
      row.bytes = Object.values(sizes).reduce((sum, size) => sum + size, 0);
      // A precision counts as downloaded only when every shard is on disk.
      const expected = (dtype: ModelDtype) =>
        (model.weightSplit?.[dtype] ?? { files: 1 }).files;
      row.q8 = weightShards(paths, 'q8') >= expected('q8');
      row.fp16 = weightShards(paths, 'fp16') >= expected('fp16');
      row.q4f16 = weightShards(paths, 'q4f16') >= expected('q4f16');

      const previous = index[model.id];
      const stale =
        !previous ||
        !unchanged ||
        previous.bytes !== row.bytes ||
        previous.q8 !== row.q8 ||
        previous.fp16 !== row.fp16 ||
        previous.q4f16 !== row.q4f16 ||
        !isFresh(previous, now);
      if (stale) {
        writes.push({
          id: model.id,
          repo: model.repo,
          files: sizes,
          bytes: row.bytes,
          q8: row.q8,
          fp16: row.fp16,
          q4f16: row.q4f16,
          verifiedAt: now,
        });
      }
    }

    await Promise.all(writes.map((entry) => saveEntry(entry)));
  } catch {
    // a blocked cache is the same as an empty one for the caller
  }

  return result;
}

/** Cache keys are full URLs; the path is what stays stable across hosts. */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export async function removeModel(repo: string): Promise<number> {
  // The release has to wait for an in-flight load of the same repo, otherwise
  // a load that lands a moment later leaves a session nobody can see.
  await serialised(async () => {
    const holding = residentsOf().filter((row) => findModel(row.modelId)?.repo === repo);
    for (const row of holding) await release(row);
  });
  if (typeof caches === 'undefined') return 0;
  const cache = await caches.open(MODEL_CACHE_NAME);
  const keys = await cache.keys();
  const hits = keys.filter((request) => request.url.includes(repo));
  await Promise.all(hits.map((request) => cache.delete(request)));
  await dropEntriesForRepo(repo);
  return hits.length;
}

export async function embedTexts(
  model: LocalModel,
  texts: string[],
  options: LoadOptions,
): Promise<{ vectors: number[][]; backend: Backend }> {
  const { pipe, backend } = await loadPipeline(model, options);
  const pooling = model.repo.includes('bge') ? 'cls' : 'mean';
  const run = pipe as (input: string[], options: Record<string, unknown>) => Promise<{
    tolist?: () => number[][];
  }>;
  const output = await exclusive(model.id, () => run(texts, { pooling, normalize: true }));
  const rows = typeof output.tolist === 'function' ? output.tolist() : output;
  return { vectors: rows as number[][], backend };
}

export async function streamLocal(options: {
  model: LocalModel;
  source: ModelSource;
  backendPreference: 'auto' | Backend;
  precision?: GpuPrecision;
  system: string;
  turns: Array<{ role: string; content: string }>;
  maxTokens?: number;
  temperature?: number;
  onToken: (text: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const mod = await runtime(options.source);
  const { pipe, backend } = await loadPipeline(options.model, {
    source: options.source,
    backendPreference: options.backendPreference,
    precision: options.precision,
    report: true,
  });

  let produced = '';
  const runner = pipe as {
    tokenizer: unknown;
    (prompt: string, options: Record<string, unknown>): Promise<unknown>;
  };

  const stop = createStopFilter((text) => {
    produced += text;
    options.onToken(text);
  });
  const filter = createReasoningFilter((text) => stop.push(text));

  const streamer = new mod.TextStreamer(runner.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (chunk: string) => {
      if (options.signal?.aborted) throw new Error('已停止');
      filter.push(chunk);
    },
  });

  await exclusive(options.model.id, () =>
    runner(
      promptFor(
        runner.tokenizer as { apply_chat_template?: (m: unknown, o?: unknown) => unknown },
        options.system,
        options.turns,
        options.model.prefill ?? '',
        options.model.chatTemplate === true,
      ),
      {
        max_new_tokens: options.maxTokens ?? 512,
        do_sample: true,
        temperature: options.temperature ?? 0.7,
        top_p: 0.9,
        // 1.05 let a 0.5B model settle on a phrase and loop; 1.18 over-corrected
        // and pushed it away from tokens it had just read (digits included), so
        // the penalty sits in the middle and the n-gram guard is gone.
        repetition_penalty: 1.1,
        streamer,
      },
    ),
  );
  filter.flush();
  stop.flush();

  return produced;
}

export function forgetPipeline(repo: string) {
  const stale = Array.from(pipelines.entries()).filter(([key]) => key.includes(repo));
  stale.forEach(([key, entry]) => {
    pipelines.delete(key);
    void entry.then(dispose).catch(() => undefined);
  });
  // Only this repo goes; a paired session of the other task stays loaded.
  const store = useModelRuntime.getState();
  for (const row of residentsOf().filter((item) => findModel(item.modelId)?.repo === repo)) {
    pipelineKeys.delete(row.modelId);
    releaseModelLock(row.modelId);
    store.dropResident(row.modelId);
  }
}

export function lastBackend(modelId: string): Backend | undefined {
  return residentsOf().find((row) => row.modelId === modelId)?.backend;
}
