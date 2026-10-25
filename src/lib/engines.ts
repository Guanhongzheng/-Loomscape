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
 * decoder and an embedder can share the heap when the budget below allows it.
 */
export type ResidentInfo = {
  modelId: string;
  task: EngineTask;
  backend: Backend;
  threads: number;
  /** Estimated peak contribution of this session, in MB. */
  peakMB: number;
};

/**
 * The wasm32 heap is 4GB and the page needs part of it, so model sessions are
 * budgeted rather than left to the allocator. `RUNTIME_BASE_MB` covers the
 * runtime and JS side once; each session adds a multiple of its weight size.
 */
export const RESIDENT_BUDGET_MB = 3400;
export const RUNTIME_BASE_MB = 600;

/**
 * Peak footprint of a session relative to its weights. Calibrated on two
 * measurements: 0.5B/int8 peaked at ~2.4GB of renderer memory, and 1.7B/int8
 * aborted at the 4GB ceiling. Three times the weight size reproduces both.
 */
export function weightPeakMB(model: LocalModel, backend: 'auto' | Backend): number {
  return Math.round(sizeFor(model, backend) * 3);
}

export function totalPeakMB(residents: ResidentInfo[]): number {
  return RUNTIME_BASE_MB + residents.reduce((sum, row) => sum + row.peakMB, 0);
}

/** Whether a set of models can be held at once, base overhead counted once. */
export function fitsTogether(models: LocalModel[], backend: 'auto' | Backend): boolean {
  const peak =
    RUNTIME_BASE_MB + models.reduce((sum, model) => sum + weightPeakMB(model, backend), 0);
  return peak <= RESIDENT_BUDGET_MB;
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
