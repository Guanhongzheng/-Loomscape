'use client';

import { create } from 'zustand';
import { getPref, setPref } from './db';
import {
  GPU_CEILING_MB,
  WASM_CEILING_MB,
  budgetsFor,
  type PoolBudgets,
} from './budget';
import { DEFAULT_PROFILE, isProfile, type SchedulingProfile } from './scheduling';

export type EngineTask = 'embedding' | 'text';
export type ModelSource = 'modelscope' | 'huggingface';
export type Backend = 'webgpu' | 'wasm';

/** The precision that actually ships for a backend. */
export type ModelDtype = 'q8' | 'fp16' | 'q4f16';

/**
 * The two precisions WebGPU can pick from. There is deliberately no plain `q4`
 * option: on these repos `model_q4.onnx` keeps fp32 activations and is *larger*
 * than int8 — Qwen3 0.6B is 876MB against 589MB — so it would cost more than it
 * saves. `q4f16` is the one that actually halves the footprint.
 */
export type GpuPrecision = Extract<ModelDtype, 'fp16' | 'q4f16'>;

export type LocalModel = {
  id: string;
  repo: string;
  task: EngineTask;
  label: string;
  note: string;
  /** Real weight sizes on the hub, so the card cannot promise the wrong number. */
  sizesMB: Record<ModelDtype, number>;
  /**
   * How a precision is split on the hub. Big models ship as a small graph plus
   * one or more `_data` shards; ORT mounts each shard separately, so the
   * per-file ceiling applies to the largest of them rather than the total.
   * `files` counts the graph as well, because that is what the cache scan sees
   * and what a finished download has to leave on disk. Absent means one file.
   */
  weightSplit?: Partial<Record<ModelDtype, { files: number; largestMB: number }>>;
  dims?: number;
  languages: string;
  /** ChatML prefill that closes a hybrid-reasoning model's think block. */
  prefill?: string;
  /**
   * Build the prompt with the repo's own chat template instead of the hand
   * written ChatML string. Qwen speaks ChatML, so its path is unchanged; Llama
   * needs `<|start_header_id|>` and Gemma `<start_of_turn>`, and feeding either
   * one ChatML makes the model answer and then keep generating the next turn
   * instead of stopping.
   */
  chatTemplate?: boolean;
  /** Rough free-memory floor, only used to warn before a large download. */
  minMemoryGB?: number;
  /**
   * Set when no weight file fits the WASM heap. These models still load — but
   * only on WebGPU, and the UI has to say so instead of offering a download
   * that aborts the tab at session creation.
   */
  requires?: 'webgpu';
};

/** Whether a model has a weight file this backend can actually run. */
export function canRun(model: LocalModel, backend: Backend): boolean {
  return model.requires !== 'webgpu' || backend === 'webgpu';
}

/**
 * Two limits, because the runtime fails for two different reasons.
 *
 * A single-file graph carries its weights inside the proto, and ORT parses a
 * copy of it: 1.36GB dies with `std::bad_alloc` while 1.17GB is fine. A model
 * with external data mounts each shard separately, and 2.7GB spread over 2.0GB
 * + 0.65GB shards loads — measured on Qwen3 4B, which generated text. Llama 3.2
 * 3B is the second measurement: 2.3GB in shards of 2.0GB and 0.3GB.
 *
 * The 2GB shard line is the browser's, not ours: Chrome caps a single
 * ArrayBuffer at `0x7fe00000` (2046MB) unless the allocation goes through
 * `WebAssembly.Memory`, which is what ORT does for the >2GB case. Every repo we
 * carry splits at 2.0GB for that reason, so a catalogue entry that needed more
 * would fail before ORT ever saw it.
 */
export const MAX_FILE_MB = 1200;
export const MAX_SHARD_MB = 2048;

/** Shard layout for one precision, defaulting to "one file". */
export function splitOf(model: LocalModel, dtype: ModelDtype): { files: number; largestMB: number } {
  return model.weightSplit?.[dtype] ?? { files: 1, largestMB: model.sizesMB[dtype] };
}

/**
 * The runtime fails on one file, not on the sum: a 1.36GB single file dies in
 * ORT while a 2.7GB model split into shards of 2.0GB and 0.65GB is mounted one
 * shard at a time. So the ceiling is checked against the largest file.
 */
export function exceedsWeightLimit(model: LocalModel, dtype: ModelDtype): boolean {
  const split = splitOf(model, dtype);
  return split.largestMB > (split.files > 1 ? MAX_SHARD_MB : MAX_FILE_MB);
}

/**
 * Which file a load will fetch. WASM has a single int8 path; WebGPU runs fp16
 * unless the caller asked for 4-bit, and falls back when a repo has no q4f16.
 *
 * The 4-bit path is decoder-only on purpose. ONNX Runtime's WebGPU kernels for
 * `MatMulNBits` do not cover the BGE graphs: a session for BGE Base q4f16 fails
 * to build even when nothing else is loaded (ORT 1151160272), while the same
 * model on fp16 loads fine. Since the saving is much larger on the decoder
 * anyway (1.12GB → 543MB against 194MB → 78MB), the embedder stays on fp16.
 */
export function dtypeFor(
  model: LocalModel,
  backend: 'auto' | Backend,
  precision: GpuPrecision = 'fp16',
): ModelDtype {
  if (backend !== 'webgpu') return 'q8';
  const fourBit = precision === 'q4f16' && model.task === 'text' && model.sizesMB.q4f16 > 0;
  const wanted: ModelDtype = fourBit ? 'q4f16' : 'fp16';
  // A precision has to survive two tests: the file must be small enough for ORT
  // to open, and the session must fit its pool. Qwen2.5 1.5B fails the first on
  // fp16 (2.96GB single file), Qwen3 4B fails the second (7.7GB of fp16 shards
  // against a 6GB GPU budget). Both are answered the same way: use 4-bit.
  const fits = (dtype: ModelDtype) => {
    const pool = poolOf(backend as Backend);
    return (
      !exceedsWeightLimit(model, dtype) &&
      poolBaseMB(pool) + peakForDtype(model, dtype) <= poolBudgetMB(pool)
    );
  };
  if (fits(wanted)) return wanted;
  if (wanted === 'fp16' && fits('q4f16')) return 'q4f16';
  return wanted;
}

/**
 * What a download will actually weigh. fp32 is never used: the fp32 graph for
 * these repos ships as an external-data file, which doubles the download again
 * and trips the 2GB ceiling of `new Response(buffer)`.
 */
export function sizeFor(
  model: LocalModel,
  backend: 'auto' | Backend,
  precision: GpuPrecision = 'fp16',
): number {
  return model.sizesMB[dtypeFor(model, backend, precision)];
}

export const LOCAL_EMBEDDINGS: LocalModel[] = [
  {
    id: 'bge-small-zh',
    repo: 'Xenova/bge-small-zh-v1.5',
    task: 'embedding',
    label: 'BGE Small 中文',
    note: '最小的一档：中文短句够用，23MB，切换后秒级就绪',
    sizesMB: { q8: 23, fp16: 45, q4f16: 28 },
    dims: 512,
    languages: '中文',
  },
  {
    id: 'bge-base-zh',
    repo: 'Xenova/bge-base-zh-v1.5',
    task: 'embedding',
    label: 'BGE Base 中文',
    note: '中文检索明显好于 Small，768 维，仍是百兆级',
    sizesMB: { q8: 98, fp16: 194, q4f16: 78 },
    dims: 768,
    languages: '中文',
  },
  {
    id: 'bge-m3',
    repo: 'Xenova/bge-m3',
    task: 'embedding',
    label: 'BGE-M3',
    note: '多语言长文本，召回质量最好；WebGPU 需 1.1GB，低内存设备不建议',
    sizesMB: { q8: 543, fp16: 1082, q4f16: 668 },
    dims: 1024,
    languages: '多语',
  },
];

export const LOCAL_TEXT: LocalModel[] = [
  {
    id: 'qwen3-0.6b',
    repo: 'onnx-community/Qwen3-0.6B-ONNX',
    task: 'text',
    label: 'Qwen3 0.6B',
    note: '默认档：中文问答、摘要、短句可用；长句改写仍会跑偏，算术交给计算器',
    sizesMB: { q8: 589, fp16: 1147, q4f16: 543 },
    languages: '中英等 100+',
    // The model card's own template closes the think block this way for
    // non-thinking use; without it the answer starts with a reasoning trace.
    prefill: '<think>\n\n</think>\n\n',
    minMemoryGB: 4,
  },
  {
    id: 'gemma-3-270m',
    repo: 'onnx-community/gemma-3-270m-it-ONNX',
    task: 'text',
    label: 'Gemma 3 270M',
    note: '最轻的一档：4 位权重 260MB，冷启动最快；中文能用但明显弱于 0.6B，适合短句与预览',
    sizesMB: { q8: 520, fp16: 544, q4f16: 260 },
    // Shipped as a 0.2MB graph plus one `_data` blob.
    weightSplit: {
      q8: { files: 2, largestMB: 520 },
      fp16: { files: 2, largestMB: 544 },
      q4f16: { files: 2, largestMB: 260 },
    },
    languages: '多语 140+',
    chatTemplate: true,
    minMemoryGB: 2,
    // The int8 file ships as graph + 520MB external data, and that pair fails
    // to create a session on the WASM path — the same repo loads fine on WebGPU.
    requires: 'webgpu',
  },
  {
    id: 'qwen3-4b',
    repo: 'onnx-community/Qwen3-4B-ONNX',
    task: 'text',
    label: 'Qwen3 4B',
    note: '上限档：4 位分三片、合计 2.6GB，推理明显强于 1.5B；会话约需 3.5GB 显存，只有 4 位可用',
    // No int8 file exists for this repo, and fp16 is 7.7GB of shards — the GPU
    // budget rules it out, so 4-bit is the only path.
    sizesMB: { q8: 0, fp16: 7683, q4f16: 2702 },
    weightSplit: {
      fp16: { files: 5, largestMB: 1973 },
      q4f16: { files: 3, largestMB: 1999 },
    },
    languages: '中英等 100+',
    prefill: '<think>\n\n</think>\n\n',
    requires: 'webgpu',
  },
  {
    id: 'llama-3.2-3b',
    repo: 'onnx-community/Llama-3.2-3B-Instruct',
    task: 'text',
    label: 'Llama 3.2 3B',
    note: '另一族的 3B 档：英文写作与指令跟随稳，中文解释偏浅；权重两片共 2.2GB，仅 WebGPU',
    // The repo publishes no int8 file, and fp16 is 5.9GB of shards — over the
    // GPU budget, so 4-bit is the only path here as well.
    sizesMB: { q8: 0, fp16: 5920, q4f16: 2296 },
    weightSplit: {
      fp16: { files: 4, largestMB: 1984 },
      q4f16: { files: 3, largestMB: 1999 },
    },
    languages: '英西法等 8',
    chatTemplate: true,
    minMemoryGB: 8,
    requires: 'webgpu',
  },
  {
    id: 'qwen2.5-1.5b',
    repo: 'onnx-community/Qwen2.5-1.5B-Instruct',
    task: 'text',
    label: 'Qwen2.5 1.5B',
    note: '另一族的中文档：写得更稳、更少跑题；int8 同样超出 wasm 堆，只能 WebGPU 4 位',
    sizesMB: { q8: 1506, fp16: 2961, q4f16: 1165 },
    languages: '中英等 29',
    minMemoryGB: 6,
    requires: 'webgpu',
  },
];

/**
 * Weights the catalog no longer offers. Removing the cards would otherwise
 * leave their files in Cache Storage forever, with no way to reclaim them from
 * the UI.
 */
export type RetiredModel = { id: string; label: string; repo: string; sizesMB: number };

export const RETIRED_MODELS: RetiredModel[] = [
  {
    id: 'qwen2.5-0.5b',
    label: 'Qwen2.5 0.5B',
    repo: 'onnx-community/Qwen2.5-0.5B-Instruct',
    sizesMB: 951,
  },
  {
    id: 'e5-small',
    label: 'E5 Small 多语',
    repo: 'Xenova/multilingual-e5-small',
    sizesMB: 224,
  },
];

export const ALL_LOCAL_MODELS = [...LOCAL_EMBEDDINGS, ...LOCAL_TEXT];

export function findModel(id: string): LocalModel | undefined {
  return ALL_LOCAL_MODELS.find((model) => model.id === id);
}

export type EnginePrefs = {
  textMode: 'api' | 'local';
  textModelId: string;
  embeddingMode: 'api' | 'local' | 'hash';
  embeddingModelId: string;
  source: ModelSource;
  backend: 'auto' | Backend;
  /** Only meaningful on WebGPU; WASM always runs int8. */
  gpuPrecision: GpuPrecision;
  /** Thread caps and coexistence policy; see lib/scheduling.ts. */
  profile: SchedulingProfile;
};

export const DEFAULT_ENGINE_PREFS: EnginePrefs = {
  textMode: 'api',
  textModelId: 'qwen3-0.6b',
  embeddingMode: 'hash',
  embeddingModelId: 'bge-base-zh',
  source: 'modelscope',
  backend: 'auto',
  gpuPrecision: 'fp16',
  profile: DEFAULT_PROFILE,
};

/**
 * A stored preference can name a model this build dropped. Resolving it at the
 * call sites would mean every workbench needs a `?? fallback`; normalising once
 * on load keeps them honest.
 */
export function normalisePrefs(stored?: Partial<EnginePrefs> | null): EnginePrefs {
  const merged: EnginePrefs = { ...DEFAULT_ENGINE_PREFS, ...(stored ?? {}) };
  const text = findModel(merged.textModelId);
  if (text?.task !== 'text') merged.textModelId = DEFAULT_ENGINE_PREFS.textModelId;
  const embedding = findModel(merged.embeddingModelId);
  if (embedding?.task !== 'embedding') {
    merged.embeddingModelId = DEFAULT_ENGINE_PREFS.embeddingModelId;
  }
  if (merged.textMode !== 'local' && merged.textMode !== 'api') merged.textMode = 'api';
  if (!['hash', 'local', 'api'].includes(merged.embeddingMode)) merged.embeddingMode = 'hash';
  if (!['auto', 'wasm', 'webgpu'].includes(merged.backend)) merged.backend = 'auto';
  if (merged.gpuPrecision !== 'fp16' && merged.gpuPrecision !== 'q4f16') {
    merged.gpuPrecision = 'fp16';
  }
  if (merged.source !== 'modelscope' && merged.source !== 'huggingface') {
    merged.source = 'modelscope';
  }
  if (!isProfile(merged.profile)) merged.profile = DEFAULT_PROFILE;
  return merged;
}

type EngineState = {
  prefs: EnginePrefs;
  loaded: boolean;
  load: () => Promise<void>;
  patch: (next: Partial<EnginePrefs>) => Promise<void>;
};

export const useEngines = create<EngineState>((set, get) => ({
  prefs: DEFAULT_ENGINE_PREFS,
  loaded: false,

  load: async () => {
    const stored = await getPref<EnginePrefs>('engines', DEFAULT_ENGINE_PREFS);
    const prefs = normalisePrefs(stored);
    set({ prefs, loaded: true });
    // Write back only when normalising changed something, so a renamed or
    // retired model does not keep reappearing after every reload.
    if (JSON.stringify(prefs) !== JSON.stringify({ ...DEFAULT_ENGINE_PREFS, ...stored })) {
      await setPref('engines', prefs);
    }
  },

  patch: async (next) => {
    const merged = { ...get().prefs, ...next };
    set({ prefs: merged });
    await setPref('engines', merged);
  },
}));

export type ModelRuntimeState = {
  state: 'idle' | 'downloading' | 'ready' | 'error';
  progress: number;
  file?: string;
  loaded?: number;
  total?: number;
  backend?: Backend;
  message?: string;
};

/**
 * A loaded session. At most one per task: a second decoder never fits, but a
 * decoder and an embedder can coexist — in different pools when their backends
 * differ, in the same pool when that pool has room.
 */
export type ResidentInfo = {
  modelId: string;
  task: EngineTask;
  backend: Backend;
  threads: number;
  /** Which weight file the session was opened from; optional for old records. */
  dtype?: ModelDtype;
  /** Estimated peak contribution inside its own pool, in MB. */
  peakMB: number;
};

/**
 * Sessions are budgeted per memory pool, because the two backends do not spend
 * the same memory. A WASM session lives in the 4GB wasm32 linear memory; a
 * WebGPU session uploads its weights to GPU buffers and keeps only a thin host
 * envelope behind. Summing both against one number is what made a WebGPU
 * decoder look like it could not share a machine with an embedder: 3× the fp16
 * weights (3.4GB) exceeded a budget that never described GPU memory.
 */
export type ResidentPool = 'wasm' | 'gpu';

export function poolOf(backend: Backend): ResidentPool {
  return backend === 'webgpu' ? 'gpu' : 'wasm';
}

/** How a pool is named in the status line, so every row says the same thing. */
export const POOL_LABEL: Record<ResidentPool, string> = {
  wasm: 'WASM',
  gpu: '显存',
};

/** ORT runtime, tokenizers and the JS side, charged to the wasm pool once. */
export const RUNTIME_BASE_MB = 600;
/** Buffers, staging copies and the command encoder, charged to the gpu pool once. */
export const GPU_BASE_MB = 256;

/**
 * Budgets are resolved once from `navigator.deviceMemory` (see lib/budget.ts)
 * and then cached, because every call site asks the same question many times
 * per render. `configureBudgets` exists for tests and for a future "override"
 * setting; without it the first read wins.
 */
let cachedBudgets: PoolBudgets | null = null;

export function configureBudgets(deviceMemoryGB?: number): PoolBudgets {
  cachedBudgets = budgetsFor(deviceMemoryGB);
  return cachedBudgets;
}

export function currentBudgets(): PoolBudgets {
  if (!cachedBudgets) {
    const memory =
      typeof navigator !== 'undefined'
        ? (navigator as unknown as { deviceMemory?: number }).deviceMemory
        : undefined;
    cachedBudgets = budgetsFor(memory);
  }
  return cachedBudgets;
}

/** Kept for the tests that assert a hard ceiling; the live value is dynamic. */
export const WASM_BUDGET_MB = WASM_CEILING_MB;
export const GPU_BUDGET_MB = GPU_CEILING_MB;

/**
 * Peak footprint of one session inside its pool.
 *
 * WASM: three times the weights. Calibrated on two measurements — 0.5B/int8
 * peaked at ~2.4GB of renderer memory and 1.7B/int8 aborted at the 4GB ceiling
 * — because int8 decoding keeps a dequantised copy, per-thread arenas and the
 * KV cache on the same heap as the weights.
 *
 * GPU: roughly the weights once. The tensors are uploaded as fp16 buffers and
 * stay there, so the 15% plus a fixed slab covers activations and a short KV
 * cache instead of a tripling.
 */
/** Peak of one precision, without going through `dtypeFor` (which uses it). */
function peakForDtype(model: LocalModel, dtype: ModelDtype): number {
  const weights = model.sizesMB[dtype];
  return dtype === 'q8' ? Math.round(weights * 3) : Math.round(weights * 1.15 + 128);
}

/**
 * Per-worker scratch. ORT hands every wasm thread its own arena, so a
 * four-thread decoder costs more than a two-thread one even with identical
 * weights — a fact the peak formula used to ignore, which is why switching to
 * `throughput` could overshoot the budget.
 *
 * 48MB is a conservative estimate, not a measurement: it has not been checked
 * against a real four-thread decode.
 */
export const THREAD_ARENA_MB = 48;
/** Embedders hold only activations per thread, so their arena is smaller. */
export const EMBED_THREAD_ARENA_MB = 16;

function arenaMB(task: EngineTask, threads: number): number {
  if (!Number.isFinite(threads) || threads <= 0) return 0;
  return Math.round(threads) * (task === 'text' ? THREAD_ARENA_MB : EMBED_THREAD_ARENA_MB);
}

export function sessionPeakMB(
  model: LocalModel,
  backend: 'auto' | Backend,
  precision: GpuPrecision = 'fp16',
  threads = 0,
): number {
  return peakForDtype(model, dtypeFor(model, backend, precision)) + arenaMB(model.task, threads);
}

export function poolBudgetMB(pool: ResidentPool): number {
  const budgets = currentBudgets();
  return pool === 'gpu' ? budgets.gpu : budgets.wasm;
}

export function poolBaseMB(pool: ResidentPool): number {
  return pool === 'gpu' ? GPU_BASE_MB : RUNTIME_BASE_MB;
}

/** Fill level of one pool, its base overhead included exactly once. */
export function poolPeakMB(residents: ResidentInfo[], pool: ResidentPool): number {
  return (
    poolBaseMB(pool) +
    residents
      .filter((row) => poolOf(row.backend) === pool)
      .reduce((sum, row) => sum + row.peakMB, 0)
  );
}

/** Pools currently holding a session, in a stable order for display. */
export function usedPools(residents: ResidentInfo[]): ResidentPool[] {
  const used = new Set(residents.map((row) => poolOf(row.backend)));
  return (['wasm', 'gpu'] as ResidentPool[]).filter((pool) => used.has(pool));
}

/**
 * Whether a set of models can be held at once. Each pool is checked on its own:
 * a GPU session does not consume wasm heap, so the two never add up.
 */
export function fitsTogether(
  models: LocalModel[],
  backend: Backend,
  precision: GpuPrecision = 'fp16',
  threadsByTask: Partial<Record<EngineTask, number>> = {},
): boolean {
  const load: Record<ResidentPool, number> = { wasm: 0, gpu: 0 };
  for (const model of models) {
    load[poolOf(backend)] += sessionPeakMB(model, backend, precision, threadsByTask[model.task]);
  }
  return (['wasm', 'gpu'] as ResidentPool[]).every(
    (pool) => load[pool] === 0 || poolBaseMB(pool) + load[pool] <= poolBudgetMB(pool),
  );
}

/**
 * Whether `model` can join what is already in memory. Unlike `fitsTogether`
 * this reads each resident's own backend, so a GPU load is not charged for the
 * WASM sessions next to it, and a same-task load is free because it replaces
 * the session it would otherwise compete with.
 */
export function roomFor(
  residents: ResidentInfo[],
  model: LocalModel,
  backend: Backend,
  precision: GpuPrecision = 'fp16',
  threads = 0,
): boolean {
  const pool = poolOf(backend);
  const occupied = residents
    .filter((row) => poolOf(row.backend) === pool && row.task !== model.task)
    .reduce((sum, row) => sum + row.peakMB, 0);
  return (
    poolBaseMB(pool) + occupied + sessionPeakMB(model, backend, precision, threads) <=
    poolBudgetMB(pool)
  );
}

type RuntimeStore = {
  models: Record<string, ModelRuntimeState>;
  residents: ResidentInfo[];
  set: (id: string, patch: Partial<ModelRuntimeState>) => void;
  reset: (id: string) => void;
  setResident: (info: ResidentInfo) => void;
  dropResident: (modelId: string) => void;
  clearResident: () => void;
};

export const useModelRuntime = create<RuntimeStore>((set) => ({
  models: {},
  residents: [],
  set: (id, patch) =>
    set((state) => ({
      models: {
        ...state.models,
        [id]: { ...(state.models[id] ?? { state: 'idle', progress: 0 }), ...patch },
      },
    })),
  reset: (id) =>
    set((state) => ({
      models: { ...state.models, [id]: { state: 'idle', progress: 0 } },
      residents: state.residents.filter((row) => row.modelId !== id),
    })),
  // A task can only own one session, so an upsert also drops the old one.
  setResident: (info) =>
    set((state) => ({
      residents: [
        ...state.residents.filter((row) => row.task !== info.task && row.modelId !== info.modelId),
        info,
      ],
    })),
  dropResident: (modelId) =>
    set((state) => ({ residents: state.residents.filter((row) => row.modelId !== modelId) })),
  clearResident: () => set({ residents: [] }),
}));

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
