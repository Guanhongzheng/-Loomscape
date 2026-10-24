'use client';

import { useModelRuntime, type Backend, type LocalModel, type ModelSource } from './engines';

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
    backends: { onnx: { wasm?: { wasmPaths?: string } } };
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
  if (wasmBackend) wasmBackend.wasmPaths = '/runtime/';

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

function dtypeFor(model: LocalModel, backend: Backend): string {
  return backend === 'webgpu' ? 'fp32' : model.dtype;
}

async function loadPipeline(model: LocalModel, options: LoadOptions): Promise<{ pipe: any; backend: Backend }> {
  const mod = await runtime(options.source);
  const backend = await detectBackend(options.backendPreference);
  const dtype = dtypeFor(model, backend);
  const key = `${pipelineTask(model.task)}:${model.repo}:${dtype}:${backend}`;

  backends.set(model.id, backend);
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
    });
    return pipe;
  })();

  pipelines.set(key, task);

  try {
    const pipe = await task;
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
        message: error instanceof Error ? error.message : '模型加载失败',
      });
    }
    throw error;
  }
}

export async function loadModel(model: LocalModel, options: LoadOptions) {
  return loadPipeline(model, options);
}

const CACHE_NAME = 'transformers-cache';

export async function isModelCached(repo: string): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    return keys.some((request) => request.url.includes(repo));
  } catch {
    return false;
  }
}

export async function removeModel(repo: string): Promise<number> {
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
  Array.from(pipelines.keys())
    .filter((key) => key.includes(repo))
    .forEach((key) => pipelines.delete(key));
}

export function lastBackend(modelId: string): Backend | undefined {
  return backends.get(modelId);
}
