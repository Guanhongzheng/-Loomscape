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
    note: '中文短文本检索，体积最小，冷启动最快',
    dtype: 'q8',
    sizesMB: { q8: 23, fp16: 45 },
    dims: 512,
    languages: '中文',
  },
  {
    id: 'e5-small',
    repo: 'Xenova/multilingual-e5-small',
    task: 'embedding',
    label: 'E5 Small 多语',
    note: '中英混排稳定，适合跨语言作品库',
    dtype: 'q8',
    sizesMB: { q8: 113, fp16: 224 },
    dims: 384,
    languages: '多语',
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
    id: 'qwen2.5-0.5b',
    repo: 'onnx-community/Qwen2.5-0.5B-Instruct',
    task: 'text',
    label: 'Qwen2.5 0.5B',
    note: '端侧起草：改写与短句可靠，算术与事实问答不可靠；WASM 约 490MB',
    dtype: 'q8',
    sizesMB: { q8: 488, fp16: 951 },
    languages: '中英',
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
  textModelId: 'qwen2.5-0.5b',
  embeddingMode: 'hash',
  embeddingModelId: 'bge-small-zh',
  source: 'modelscope',
  backend: 'auto',
};

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
    set({ prefs: { ...DEFAULT_ENGINE_PREFS, ...stored }, loaded: true });
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

/** Only one local model is kept in memory; this is the one that is loaded. */
export type ResidentInfo = {
  modelId: string;
  backend: Backend;
  threads: number;
} | null;

type RuntimeStore = {
  models: Record<string, ModelRuntimeState>;
  resident: ResidentInfo;
  set: (id: string, patch: Partial<ModelRuntimeState>) => void;
  reset: (id: string) => void;
  setResident: (info: NonNullable<ResidentInfo>) => void;
  clearResident: () => void;
};

export const useModelRuntime = create<RuntimeStore>((set) => ({
  models: {},
  resident: null,
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
      resident: state.resident?.modelId === id ? null : state.resident,
    })),
  setResident: (info) => set({ resident: info }),
  clearResident: () => set({ resident: null }),
}));

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
