'use client';

import { create } from 'zustand';
import { getPref, setPref } from './db';

export type EngineTask = 'embedding' | 'text';
export type ModelSource = 'modelscope' | 'huggingface';
export type Backend = 'webgpu' | 'wasm';

/** The precision that actually ships for a backend. */
export type ModelDtype = 'q8' | 'fp16';

export type LocalModel = {
  id: string;
  repo: string;
  task: EngineTask;
  label: string;
  note: string;
  /** Precision used on the WASM path; WebGPU always resolves to fp16. */
  dtype: ModelDtype;
  /** Real weight sizes on the hub, so the card cannot promise the wrong number. */
  sizesMB: Record<ModelDtype, number>;
  dims?: number;
  languages: string;
  /** ChatML prefill that closes a hybrid-reasoning model's think block. */
  prefill?: string;
  /** Rough free-memory floor, only used to warn before a large download. */
  minMemoryGB?: number;
};

/**
 * What a download will actually weigh. WebGPU runs fp16 rather than fp32: the
 * fp32 graph for these repos ships as an external-data file, which doubles the
 * download again and trips the 2GB ceiling of `new Response(buffer)`.
 */
export function sizeFor(model: LocalModel, backend: 'auto' | Backend): number {
  return backend === 'webgpu' ? model.sizesMB.fp16 : model.sizesMB.q8;
}

export const LOCAL_EMBEDDINGS: LocalModel[] = [
  {
    id: 'bge-small-zh',
    repo: 'Xenova/bge-small-zh-v1.5',
    task: 'embedding',
    label: 'BGE Small 中文',
    note: '最小的一档：中文短句够用，23MB，切换后秒级就绪',
    dtype: 'q8',
    sizesMB: { q8: 23, fp16: 45 },
    dims: 512,
    languages: '中文',
  },
  {
    id: 'bge-base-zh',
    repo: 'Xenova/bge-base-zh-v1.5',
    task: 'embedding',
    label: 'BGE Base 中文',
    note: '中文检索明显好于 Small，768 维，仍是百兆级',
    dtype: 'q8',
    sizesMB: { q8: 98, fp16: 194 },
    dims: 768,
    languages: '中文',
  },
  {
    id: 'bge-m3',
    repo: 'Xenova/bge-m3',
    task: 'embedding',
    label: 'BGE-M3',
    note: '多语言长文本，召回质量最好；WebGPU 需 1.1GB，低内存设备不建议',
    dtype: 'q8',
    sizesMB: { q8: 543, fp16: 1082 },
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
    dtype: 'q8',
    sizesMB: { q8: 589, fp16: 1147 },
    languages: '中英等 100+',
    // The model card's own template closes the think block this way for
    // non-thinking use; without it the answer starts with a reasoning trace.
    prefill: '<think>\n\n</think>\n\n',
    minMemoryGB: 4,
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
};

export const DEFAULT_ENGINE_PREFS: EnginePrefs = {
  textMode: 'api',
  textModelId: 'qwen3-0.6b',
  embeddingMode: 'hash',
  embeddingModelId: 'bge-base-zh',
  source: 'modelscope',
  backend: 'auto',
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
  if (merged.source !== 'modelscope' && merged.source !== 'huggingface') {
    merged.source = 'modelscope';
  }
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

/** wasm32 linear memory is 4GB; the page itself needs the remainder. */
export const WASM_BUDGET_MB = 3400;
/**
 * Standing in for VRAM, which the platform does not report. Discrete cards have
 * far more, integrated ones share system memory, so this is a ceiling rather
 * than a measurement: it is high enough to hold a decoder plus an embedder and
 * low enough to catch a stack that would spill out of a 16GB machine.
 */
export const GPU_BUDGET_MB = 6144;
/** ORT runtime, tokenizers and the JS side, charged to the wasm pool once. */
export const RUNTIME_BASE_MB = 600;
/** Buffers, staging copies and the command encoder, charged to the gpu pool once. */
export const GPU_BASE_MB = 256;

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
export function sessionPeakMB(model: LocalModel, backend: 'auto' | Backend): number {
  const weights = sizeFor(model, backend);
  return backend === 'webgpu' ? Math.round(weights * 1.15 + 128) : Math.round(weights * 3);
}

export function poolBudgetMB(pool: ResidentPool): number {
  return pool === 'gpu' ? GPU_BUDGET_MB : WASM_BUDGET_MB;
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
export function fitsTogether(models: LocalModel[], backend: Backend): boolean {
  const load: Record<ResidentPool, number> = { wasm: 0, gpu: 0 };
  for (const model of models) load[poolOf(backend)] += sessionPeakMB(model, backend);
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
export function roomFor(residents: ResidentInfo[], model: LocalModel, backend: Backend): boolean {
  const pool = poolOf(backend);
  const occupied = residents
    .filter((row) => poolOf(row.backend) === pool && row.task !== model.task)
    .reduce((sum, row) => sum + row.peakMB, 0);
  return poolBaseMB(pool) + occupied + sessionPeakMB(model, backend) <= poolBudgetMB(pool);
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
