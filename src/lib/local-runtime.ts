'use client';

import {
  findModel,
  fitsTogether,
  poolBudgetMB,
  poolOf,
  poolPeakMB,
  sessionPeakMB,
  useModelRuntime,
  type Backend,
  type LocalModel,
  type ModelDtype,
  type ModelSource,
} from './engines';
import { describeError } from './errors';
import {
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
): number {
  if (!isolated) return 1;
  const usable = Math.max(1, Math.floor(cores) - 1);
  // Decoding keeps a KV cache and per-thread arenas alive, so a 4-thread text
  // session can need several gigabytes where an embedding one needs tens of
  // megabytes. Two threads is the point where the extra speed stops paying
  // for the extra memory. When a decoder is already loaded the embedder drops
  // to the same cap: the pair has to fit one heap.
  const cap = task === 'text' || sharing ? 2 : 4;
  return Math.min(usable, cap);
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
  report?: boolean;
};

const pipelines = new Map<string, Promise<unknown>>();
const backends = new Map<string, Backend>();

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

type Resident = {
  modelId: string;
  repo: string;
  task: 'embedding' | 'text';
  key: string;
  backend: Backend;
  threads: number;
  peakMB: number;
};

/**
 * Loaded sessions, one per task. A decoder and an embedder can share the wasm
 * heap when the budget allows it — that is what makes local retrieval work
 * next to a local writer. A second session of the same task always evicts the
 * first, and a pair that does not fit evicts the older side.
 */
let residents: Resident[] = [];

/**
 * WebGPU runs fp16, never fp32. The fp32 graph for these repos is a 0.6MB
 * topology plus a 2.1GB external-data file, which is both a much larger
 * download and past the point where a single ArrayBuffer can be wrapped in a
 * Response — that is the RangeError the runtime used to throw.
 */
export function dtypeFor(model: LocalModel, backend: Backend): ModelDtype {
  return backend === 'webgpu' ? 'fp16' : model.dtype;
}

async function dispose(pipe: unknown): Promise<void> {
  const candidate = pipe as { dispose?: () => Promise<void> | void };
  try {
    await candidate.dispose?.();
  } catch {
    // an already-released session is not an error worth surfacing
  }
}

export function residentModelId(): string | null {
  return residents[0]?.modelId ?? null;
}

export function residentModelIds(): string[] {
  return residents.map((row) => row.modelId);
}

export function isResident(modelId: string): boolean {
  return residents.some((row) => row.modelId === modelId);
}

/**
 * Drops one session: its pipeline promise (which may still be in flight), its
 * cache entries and its card state. The wasm heap itself cannot shrink, but
 * releasing the session stops it from growing with the next token.
 */
async function release(entry: Resident): Promise<void> {
  residents = residents.filter((row) => row.modelId !== entry.modelId);
  backends.delete(entry.modelId);
  const pending = pipelines.get(entry.key);
  pipelines.delete(entry.key);

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
    const target = residents.find((row) => row.modelId === modelId);
    if (target) await release(target);
    return;
  }

  const pending = Array.from(pipelines.values());
  pipelines.clear();
  residents = [];
  backends.clear();
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
 * Frees room for one more session. Same-task sessions go first because two
 * decoders never fit; across tasks the older one goes only when the budget
 * says the pair does not fit, so text + a small embedder normally coexist.
 */
function recordResident(next: Resident): void {
  residents = [...residents.filter((row) => row.task !== next.task), next];
  useModelRuntime.getState().setResident({
    modelId: next.modelId,
    task: next.task,
    backend: next.backend,
    threads: next.threads,
    peakMB: next.peakMB,
  });
}

async function makeRoom(next: Resident): Promise<void> {
  const sameTask = residents.filter((row) => row.task === next.task && row.modelId !== next.modelId);
  for (const row of sameTask) await release(row);

  // Only the pool this session will live in decides who has to go. A GPU
  // session must never evict a WASM one: they do not compete for the same
  // memory, and adding them together is what made WebGPU look unusable.
  const pool = poolOf(next.backend);
  const budget = poolBudgetMB(pool);
  for (;;) {
    const occupants = residents.filter((row) => poolOf(row.backend) === pool);
    if (occupants.length === 0) break;
    if (poolPeakMB(residents, pool) + next.peakMB <= budget) break;
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
  const dtype = dtypeFor(model, backend);
  // An embedder loaded next to a decoder gives up half its threads: the pair
  // shares one heap, and worker arenas are the part that grows with threads.
  const sharing = model.task === 'embedding' && residents.some((row) => row.task === 'text');
  const threads = threadCount(
    runtimeInfo().cores,
    runtimeInfo().isolated,
    model.task,
    sharing,
  );
  const key = `${pipelineTask(model.task)}:${model.repo}:${dtype}:${backend}:${threads}`;
  const next: Resident = {
    modelId: model.id,
    repo: model.repo,
    task: model.task,
    key,
    backend,
    threads,
    peakMB: sessionPeakMB(model, backend),
  };

  // A session that cannot fit its own pool used to be attempted anyway: the
  // eviction loop only ran when something else was loaded, so a too-large
  // model went straight to `Aborted()` and took the tab with it. Refusing here
  // turns that into a card that says why.
  if (!fitsTogether([model], backend)) {
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

  backends.set(model.id, backend);
  if (pipelines.has(key)) {
    // Already parsed: just re-assert the record, no room keeping needed.
    recordResident(next);
    return { pipe: await pipelines.get(key)!, backend };
  }
  await makeRoom(next);

  const runtimeStore = useModelRuntime.getState();
  if (options.report) runtimeStore.set(model.id, { state: 'downloading', progress: 0, backend });
  markAttempt(model.id);
  // Weights are worthless if the browser evicts them under pressure, which is
  // exactly what would force the same download again next visit.
  void ensurePersistentStorage();

  const totals = new Map<string, { loaded: number; total: number }>();

  const onProgress = (event: {
    status: string;
    file?: string;
    loaded?: number;
    total?: number;
  }) => {
    if (!options.report) return;
    if (event.file && typeof event.total === 'number' && event.total > 0) {
      totals.set(event.file, {
        loaded: event.status === 'done' ? event.total : (event.loaded ?? 0),
        total: event.total,
      });
      let loaded = 0;
      let total = 0;
      totals.forEach((row) => {
        loaded += Math.min(row.loaded, row.total);
        total += row.total;
      });
      runtimeStore.set(model.id, {
        state: 'downloading',
        progress: total > 0 ? Math.min(loaded / total, 0.999) : 0,
        file: event.file,
        loaded,
        total,
        backend,
      });
    } else if (event.status === 'initiate' && event.file) {
      runtimeStore.set(model.id, {
        state: 'downloading',
        progress: runtimeStore.models[model.id]?.progress ?? 0,
        file: event.file,
        backend,
      });
    }
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
    recordResident(next);

    if (options.report) {
      runtimeStore.set(model.id, { state: 'ready', progress: 1, backend, total: 0, loaded: 0 });
    }
    return { pipe, backend };
  } catch (error) {
    pipelines.delete(key);
    markAttempt(null);
    if (options.report) {
      runtimeStore.set(model.id, {
        state: 'error',
        progress: 0,
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

const CACHE_NAME = 'transformers-cache';

/**
 * Which weight file a dtype resolves to. transformers.js picks the same names,
 * so checking one of them is the only way to know that *this* model can run:
 * a cached config, tokenizer, or a different quantisation would otherwise be
 * reported as ready and the load would fail on a missing ONNX file.
 */
export function weightFile(dtype: ModelDtype | 'q4'): string {
  if (dtype === 'q4') return 'model_q4.onnx';
  return dtype === 'fp16' ? 'model_fp16.onnx' : 'model_quantized.onnx';
}

export function isWeightRequest(
  url: string,
  repo: string,
  dtype: ModelDtype | 'q4' = 'q8',
): boolean {
  if (!url.includes(repo)) return false;
  try {
    return new URL(url).pathname.endsWith(`/${weightFile(dtype)}`);
  } catch {
    return false;
  }
}

export type CacheStats = {
  files: number;
  bytes: number;
  /** Weight files that are on disk, by the backend that can run them. */
  q8: boolean;
  fp16: boolean;
};

/**
 * Reads the cache once for every model instead of once per model. Sizes come
 * from the stored `content-length`; responses without it are counted but not
 * measured, which is why `bytes` can be lower than the model card claims.
 */
export async function scanModelCache(
  models: Array<{ id: string; repo: string }>,
): Promise<Record<string, CacheStats>> {
  const result: Record<string, CacheStats> = {};
  for (const model of models) result[model.id] = { files: 0, bytes: 0, q8: false, fp16: false };

  if (typeof caches === 'undefined') return result;

  try {
    const cache = await caches.open(CACHE_NAME);
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
      row.q8 = requests.some((request) => isWeightRequest(request.url, model.repo, 'q8'));
      row.fp16 = requests.some((request) => isWeightRequest(request.url, model.repo, 'fp16'));

      const previous = index[model.id];
      const stale =
        !previous ||
        !unchanged ||
        previous.bytes !== row.bytes ||
        previous.q8 !== row.q8 ||
        previous.fp16 !== row.fp16 ||
        !isFresh(previous, now);
      if (stale) {
        writes.push({
          id: model.id,
          repo: model.repo,
          files: sizes,
          bytes: row.bytes,
          q8: row.q8,
          fp16: row.fp16,
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

export async function hasWeights(repo: string): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  // One lookup answers the common case; the fallback scan is only for a cold
  // or expired index, which `scanModelCache` refreshes on the settings page.
  const indexed = (await entriesForRepo(repo)).find((entry) => isFresh(entry));
  if (indexed) return indexed.q8 || indexed.fp16;
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    return keys.some(
      (request) =>
        isWeightRequest(request.url, repo, 'q8') || isWeightRequest(request.url, repo, 'fp16'),
    );
  } catch {
    return false;
  }
}

export async function isModelCached(repo: string, dtype: ModelDtype | 'q4' = 'q8'): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  if (dtype !== 'q4') {
    const indexed = (await entriesForRepo(repo)).find((entry) => isFresh(entry));
    if (indexed) return dtype === 'fp16' ? indexed.fp16 : indexed.q8;
  }
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    return keys.some((request) => isWeightRequest(request.url, repo, dtype));
  } catch {
    return false;
  }
}

export async function removeModel(repo: string): Promise<number> {
  // The release has to wait for an in-flight load of the same repo, otherwise
  // a load that lands a moment later leaves a session nobody can see.
  await serialised(async () => {
    const holding = residents.filter((row) => row.repo === repo);
    for (const row of holding) await release(row);
  });
  if (typeof caches === 'undefined') return 0;
  const cache = await caches.open(CACHE_NAME);
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

export function chatPrompt(
  system: string,
  turns: Array<{ role: string; content: string }>,
  prefill = '',
): string {
  const blocks = [`<|im_start|>system\n${system}<|im_end|>`];
  for (const turn of turns) {
    blocks.push(`<|im_start|>${turn.role}\n${turn.content}<|im_end|>`);
  }
  blocks.push(`<|im_start|>assistant\n${prefill}`);
  return blocks.join('\n');
}

/**
 * Only the plain-text tag is listed. Qwen3's ` thinking` / `<｜end▁of▁thinking｜>` are
 * special tokens, so the streamer already drops them with skip_special_tokens;
 * matching the bare word "think" on top of that would swallow English answers
 * that happen to open with it.
 */
const OPENERS = ['<think>'];
const CLOSERS = ['</think>', '<｜end▁of▁thinking｜>'];

/**
 * Qwen3 is a hybrid-reasoning model: even with a closed think block in the
 * prompt it can open another one. Reasoning is model-internal and should not
 * reach the transcript, but the answer streams token by token, so the block
 * has to be dropped while it arrives rather than filtered from the result.
 */
export function createReasoningFilter(emit: (text: string) => void) {
  let held = '';
  let state: 'start' | 'inside' | 'answer' = 'start';
  const longestCloser = Math.max(...CLOSERS.map((closer) => closer.length));

  const drain = () => {
    for (;;) {
      if (state === 'answer') {
        if (held) {
          emit(held);
          held = '';
        }
        return;
      }

      if (state === 'start') {
        const head = held.replace(/^\s+/, '');
        if (!head) {
          held = '';
          return;
        }
        // Still short enough to become a tag: wait for more tokens.
        if ([...OPENERS, ...CLOSERS].some((tag) => tag.startsWith(head))) return;
        // A closer with no opener is the tail of the prompt's own closed block.
        const stray = CLOSERS.find((tag) => head.startsWith(tag));
        if (stray) {
          state = 'answer';
          held = head.slice(stray.length).replace(/^\s+/, '');
          continue;
        }
        const opener = OPENERS.find((item) => head.startsWith(item));
        if (!opener) {
          state = 'answer';
          continue;
        }
        state = 'inside';
        held = head.slice(opener.length);
        continue;
      }

      let cut = -1;
      let closer = '';
      for (const candidate of CLOSERS) {
        const at = held.indexOf(candidate);
        if (at !== -1 && (cut === -1 || at < cut)) {
          cut = at;
          closer = candidate;
        }
      }
      if (cut === -1) {
        // Hold back only a tail that could be the start of a closer, so a tag
        // split across tokens never leaks into the answer.
        if (held.length > longestCloser) held = held.slice(-longestCloser);
        return;
      }
      held = held.slice(cut + closer.length).replace(/^\s+/, '');
      state = 'answer';
    }
  };

  return {
    push(chunk: string) {
      held += chunk;
      drain();
    },
    /** Called once the stream ends; an unclosed block is reasoning, not answer. */
    flush() {
      if (state === 'answer' && held) emit(held);
      else if (state === 'start' && held.trim()) emit(held.replace(/^\s+/, ''));
      held = '';
    },
  };
}

export async function streamLocal(options: {
  model: LocalModel;
  source: ModelSource;
  backendPreference: 'auto' | Backend;
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
    report: true,
  });

  let produced = '';
  const runner = pipe as {
    tokenizer: unknown;
    (prompt: string, options: Record<string, unknown>): Promise<unknown>;
  };

  const filter = createReasoningFilter((text) => {
    produced += text;
    options.onToken(text);
  });

  const streamer = new mod.TextStreamer(runner.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (chunk: string) => {
      if (options.signal?.aborted) throw new Error('已停止');
      filter.push(chunk);
    },
  });

  await exclusive(options.model.id, () =>
    runner(chatPrompt(options.system, options.turns, options.model.prefill), {
      max_new_tokens: options.maxTokens ?? 512,
      do_sample: true,
      temperature: options.temperature ?? 0.7,
      top_p: 0.9,
      // 1.05 let a 0.5B model settle on a phrase and loop; 1.18 over-corrected
      // and pushed it away from tokens it had just read (digits included), so
      // the penalty sits in the middle and the n-gram guard is gone.
      repetition_penalty: 1.1,
      streamer,
    }),
  );
  filter.flush();

  backends.set(options.model.id, backend);
  return produced;
}

export function forgetPipeline(repo: string) {
  const stale = Array.from(pipelines.entries()).filter(([key]) => key.includes(repo));
  stale.forEach(([key, entry]) => {
    pipelines.delete(key);
    void entry.then(dispose).catch(() => undefined);
  });
  // Only this repo goes; a paired session of the other task stays loaded.
  residents = residents.filter((row) => {
    if (row.repo !== repo) return true;
    useModelRuntime.getState().dropResident(row.modelId);
    return false;
  });
}

export function lastBackend(modelId: string): Backend | undefined {
  return backends.get(modelId);
}
