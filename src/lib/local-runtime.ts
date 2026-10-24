'use client';

import { useModelRuntime, type Backend, type LocalModel, type ModelSource } from './engines';
import { describeError } from './errors';

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
export function threadCount(cores: number, isolated: boolean, task: 'text' | 'embedding' = 'embedding'): number {
  if (!isolated) return 1;
  const usable = Math.max(1, Math.floor(cores) - 1);
  // Decoding keeps a KV cache and per-thread arenas alive, so a 4-thread text
  // session can need several gigabytes where an embedding one needs tens of
  // megabytes. Two threads is the point where the extra speed stops paying
  // for the extra memory.
  const cap = task === 'text' ? 2 : 4;
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
 * Auto mode stays on WASM with quantized weights: the WebGPU provider needs
 * fp32 weights, which quadruples the download for a half-billion parameter
 * model. WebGPU stays available as an explicit choice for people who want the
 * faster path and can afford the bandwidth.
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

type Resident = {
  modelId: string;
  repo: string;
  task: 'embedding' | 'text';
  key: string;
  backend: Backend;
  threads: number;
};

/**
 * A resident model owns the whole on-device budget: its ONNX session, its
 * weights and the WASM heap it grew. Loading a second one without releasing
 * the first is what makes a phone tab die, so the module keeps exactly one and
 * evicts it before starting another.
 */
let resident: Resident | null = null;

function dtypeFor(model: LocalModel, backend: Backend): string {
  return backend === 'webgpu' ? 'fp32' : model.dtype;
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
  return resident?.modelId ?? null;
}

export function isResident(modelId: string): boolean {
  return resident?.modelId === modelId;
}

/**
 * Releases the loaded model. Pending loads are disposed as soon as they land,
 * which lets the caller evict while a download is still in flight without
 * leaving an orphan session behind.
 */
export async function unloadModel(): Promise<void> {
  const entries = Array.from(pipelines.values());
  pipelines.clear();
  resident = null;
  backends.clear();
  useModelRuntime.getState().clearResident();

  await Promise.all(
    entries.map(async (entry) => {
      try {
        await dispose(await entry);
      } catch {
        // the load itself failed; nothing to release
      }
    }),
  );
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
  const threads = threadCount(runtimeInfo().cores, runtimeInfo().isolated, model.task);
  const key = `${pipelineTask(model.task)}:${model.repo}:${dtype}:${backend}:${threads}`;

  const wasmBackend = mod.env.backends.onnx.wasm;
  if (wasmBackend) wasmBackend.numThreads = threads;

  backends.set(model.id, backend);
  if (resident && resident.key !== key) await unloadModel();
  if (pipelines.has(key)) {
    return { pipe: await pipelines.get(key)!, backend };
  }

  const runtimeStore = useModelRuntime.getState();
  if (options.report) runtimeStore.set(model.id, { state: 'downloading', progress: 0, backend });

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
    // Anything previously marked ready is gone: only one model lives at a time.
    const store = useModelRuntime.getState();
    Object.entries(store.models).forEach(([id, state]) => {
      if (id !== model.id && state.state === 'ready') store.reset(id);
    });

    resident = {
      modelId: model.id,
      repo: model.repo,
      task: model.task,
      key,
      backend,
      threads,
    };
    store.setResident({ modelId: model.id, backend, threads });

    if (options.report) {
      runtimeStore.set(model.id, { state: 'ready', progress: 1, backend, total: 0, loaded: 0 });
    }
    return { pipe, backend };
  } catch (error) {
    pipelines.delete(key);
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
export function weightFile(dtype: 'q8' | 'q4'): string {
  return dtype === 'q4' ? 'model_q4.onnx' : 'model_quantized.onnx';
}

export function isWeightRequest(url: string, repo: string, dtype: 'q8' | 'q4' = 'q8'): boolean {
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
  /** The weight file this dtype needs is present. */
  weights: boolean;
};

/**
 * Reads the cache once for every model instead of once per model. Sizes come
 * from the stored `content-length`; responses without it are counted but not
 * measured, which is why `bytes` can be lower than the model card claims.
 */
export async function scanModelCache(models: LocalModel[]): Promise<Record<string, CacheStats>> {
  const result: Record<string, CacheStats> = {};
  for (const model of models) result[model.id] = { files: 0, bytes: 0, weights: false };

  if (typeof caches === 'undefined') return result;

  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    for (const request of keys) {
      for (const model of models) {
        if (!request.url.includes(model.repo)) continue;
        const row = result[model.id];
        row.files += 1;
        if (isWeightRequest(request.url, model.repo, model.dtype)) row.weights = true;

        const response = await cache.match(request);
        const length = Number(response?.headers.get('content-length') ?? 0);
        if (Number.isFinite(length) && length > 0) row.bytes += length;
      }
    }
  } catch {
    // a blocked cache is the same as an empty one for the caller
  }

  return result;
}

/** Any file for this repo, including weights from a different quantisation. */
export async function hasRepoCache(repo: string): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    return keys.some((request) => request.url.includes(repo));
  } catch {
    return false;
  }
}

export async function isModelCached(repo: string, dtype: 'q8' | 'q4' = 'q8'): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    return keys.some((request) => isWeightRequest(request.url, repo, dtype));
  } catch {
    return false;
  }
}

export async function removeModel(repo: string): Promise<number> {
  if (resident?.repo === repo) await unloadModel();
  if (typeof caches === 'undefined') return 0;
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  const hits = keys.filter((request) => request.url.includes(repo));
  await Promise.all(hits.map((request) => cache.delete(request)));
  return hits.length;
}

export async function cachedModels(): Promise<string[]> {
  if (typeof caches === 'undefined') return [];
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    return Array.from(new Set(keys.map((request) => request.url)));
  } catch {
    return [];
  }
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
  const output = await run(texts, { pooling, normalize: true });
  const rows = typeof output.tolist === 'function' ? output.tolist() : output;
  return { vectors: rows as number[][], backend };
}

function chatPrompt(system: string, turns: Array<{ role: string; content: string }>): string {
  const blocks = [`<|im_start|>system\n${system}<|im_end|>`];
  for (const turn of turns) {
    blocks.push(`<|im_start|>${turn.role}\n${turn.content}<|im_end|>`);
  }
  blocks.push('<|im_start|>assistant\n');
  return blocks.join('\n');
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

  const streamer = new mod.TextStreamer(runner.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (chunk: string) => {
      if (options.signal?.aborted) throw new Error('已停止');
      produced += chunk;
      options.onToken(chunk);
    },
  });

  await runner(chatPrompt(options.system, options.turns), {
    max_new_tokens: options.maxTokens ?? 512,
    do_sample: true,
    temperature: options.temperature ?? 0.7,
    top_p: 0.9,
    repetition_penalty: 1.05,
    streamer,
  });

  backends.set(options.model.id, backend);
  return produced;
}

export function forgetPipeline(repo: string) {
  const stale = Array.from(pipelines.entries()).filter(([key]) => key.includes(repo));
  stale.forEach(([key, entry]) => {
    pipelines.delete(key);
    void entry.then(dispose).catch(() => undefined);
  });
  if (resident?.repo === repo) {
    resident = null;
    useModelRuntime.getState().clearResident();
  }
}

export function lastBackend(modelId: string): Backend | undefined {
  return backends.get(modelId);
}
