import { describe, expect, it } from 'vitest';
import {
  ALL_LOCAL_MODELS,
  DEFAULT_ENGINE_PREFS,
  GPU_BASE_MB,
  LOCAL_EMBEDDINGS,
  LOCAL_TEXT,
  RETIRED_MODELS,
  RUNTIME_BASE_MB,
  WASM_BUDGET_MB,
  findModel,
  fitsTogether,
  normalisePrefs,
  poolPeakMB,
  roomFor,
  sessionPeakMB,
  sizeFor,
  useModelRuntime,
  usedPools,
} from '@/lib/engines';

describe('local catalogue', () => {
  it('keeps ids unique and each task in its own list', () => {
    const ids = ALL_LOCAL_MODELS.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(LOCAL_TEXT.every((model) => model.task === 'text')).toBe(true);
    expect(LOCAL_EMBEDDINGS.every((model) => model.task === 'embedding')).toBe(true);
  });

  it('points the defaults at models that exist', () => {
    expect(findModel(DEFAULT_ENGINE_PREFS.textModelId)?.task).toBe('text');
    expect(findModel(DEFAULT_ENGINE_PREFS.embeddingModelId)?.task).toBe('embedding');
  });

  it('quotes real weight sizes, never a fp32 graph', () => {
    for (const model of ALL_LOCAL_MODELS) {
      expect(model.sizesMB.q8).toBeGreaterThan(0);
      // fp16 must not be smaller than int8; that would be the fp32 figure.
      expect(model.sizesMB.fp16).toBeGreaterThanOrEqual(model.sizesMB.q8);
    }
  });

  it('retires the repos it stopped listing, so their weights stay removable', () => {
    const live = new Set(ALL_LOCAL_MODELS.map((model) => model.id));
    for (const model of RETIRED_MODELS) {
      expect(live.has(model.id)).toBe(false);
      expect(model.repo).toMatch(/.+\/.+/);
    }
    expect(RETIRED_MODELS.some((model) => model.id === DEFAULT_ENGINE_PREFS.textModelId)).toBe(
      false,
    );
  });
});

describe('sizeFor', () => {
  const model = LOCAL_TEXT[0];

  it('charges the precision that will be fetched', () => {
    expect(sizeFor(model, 'wasm')).toBe(model.sizesMB.q8);
    expect(sizeFor(model, 'auto')).toBe(model.sizesMB.q8);
    expect(sizeFor(model, 'webgpu')).toBe(model.sizesMB.fp16);
  });
});

describe('normalisePrefs', () => {
  it('replaces a retired model id with the default', () => {
    const prefs = normalisePrefs({ textModelId: 'qwen2.5-0.5b', embeddingModelId: 'e5-small' });
    expect(prefs.textModelId).toBe(DEFAULT_ENGINE_PREFS.textModelId);
    expect(prefs.embeddingModelId).toBe(DEFAULT_ENGINE_PREFS.embeddingModelId);
  });

  it('rejects a text id pointed at an embedding model', () => {
    expect(normalisePrefs({ textModelId: 'bge-m3' }).textModelId).toBe(
      DEFAULT_ENGINE_PREFS.textModelId,
    );
  });

  it('keeps a valid choice untouched', () => {
    const prefs = normalisePrefs({
      textModelId: 'qwen3-0.6b',
      embeddingModelId: 'bge-small-zh',
      textMode: 'local',
      backend: 'webgpu',
      source: 'huggingface',
    });
    expect(prefs.textModelId).toBe('qwen3-0.6b');
    expect(prefs.embeddingModelId).toBe('bge-small-zh');
    expect(prefs.textMode).toBe('local');
    expect(prefs.backend).toBe('webgpu');
    expect(prefs.source).toBe('huggingface');
  });

  it('repairs values that are not in the union', () => {
    const prefs = normalisePrefs({
      textMode: 'cloud' as never,
      embeddingMode: 'vector' as never,
      backend: 'cuda' as never,
      source: 'cdn' as never,
    });
    expect(prefs.textMode).toBe('api');
    expect(prefs.embeddingMode).toBe('hash');
    expect(prefs.backend).toBe('auto');
    expect(prefs.source).toBe('modelscope');
  });

  it('survives an empty store', () => {
    expect(normalisePrefs(null)).toEqual(DEFAULT_ENGINE_PREFS);
  });
});

describe('memory budget', () => {
  const text = findModel('qwen3-0.6b')!;
  const small = findModel('bge-small-zh')!;
  const base = findModel('bge-base-zh')!;
  const m3 = findModel('bge-m3')!;

  const row = (model: typeof text, backend: 'wasm' | 'webgpu') => ({
    modelId: model.id,
    task: model.task,
    backend,
    threads: 2,
    peakMB: sessionPeakMB(model, backend),
  });

  it('fits a decoder and an embedder in the wasm heap', () => {
    expect(fitsTogether([text, small], 'wasm')).toBe(true);
    expect(fitsTogether([text, base], 'wasm')).toBe(true);
  });

  it('refuses the wasm pair that would blow the 4GB ceiling', () => {
    // 0.6B + M3 leaves under 100MB between the estimate and 4GB.
    expect(fitsTogether([text, m3], 'wasm')).toBe(false);
  });

  it('allows the same pair on WebGPU, where sessions do not share that heap', () => {
    // Regression: 3× the fp16 weights (3.4GB) used to be charged against the
    // wasm budget, so a WebGPU decoder looked like it could not coexist with
    // anything — even though its weights sit in GPU buffers.
    expect(fitsTogether([text], 'webgpu')).toBe(true);
    expect(fitsTogether([text, base], 'webgpu')).toBe(true);
    expect(fitsTogether([text, m3], 'webgpu')).toBe(true);
  });

  it('estimates WebGPU from the buffers it actually allocates', () => {
    // fp16 weights are larger than int8, but they are uploaded once, not tripled.
    expect(sessionPeakMB(text, 'webgpu')).toBeGreaterThan(sizeFor(text, 'webgpu'));
    expect(sessionPeakMB(text, 'webgpu')).toBeLessThan(sessionPeakMB(text, 'wasm'));
  });

  it('charges each pool its own overhead exactly once', () => {
    expect(poolPeakMB([], 'wasm')).toBe(RUNTIME_BASE_MB);
    expect(poolPeakMB([], 'gpu')).toBe(GPU_BASE_MB);

    const residents = [row(text, 'wasm'), row(base, 'wasm')];
    expect(poolPeakMB(residents, 'wasm')).toBeLessThanOrEqual(WASM_BUDGET_MB);
    // A wasm session must not show up in the GPU figure.
    expect(poolPeakMB(residents, 'gpu')).toBe(GPU_BASE_MB);
    expect(usedPools(residents)).toEqual(['wasm']);
  });

  it('reads each resident backend instead of one global preference', () => {
    // A wasm embedder joins a GPU decoder: different pools, no eviction.
    expect(roomFor([row(text, 'webgpu')], base, 'wasm')).toBe(true);
    // The same pair the other way round still has to fit the wasm pool.
    expect(roomFor([row(text, 'wasm')], m3, 'wasm')).toBe(false);
  });

  it('lets a same-task load replace a session instead of counting both', () => {
    expect(roomFor([row(m3, 'wasm')], m3, 'wasm')).toBe(true);
  });
});

describe('runtime store', () => {
  const resident = (modelId: string, task: 'text' | 'embedding', peakMB: number) => ({
    modelId,
    task,
    backend: 'wasm' as const,
    threads: 2,
    peakMB,
  });

  it('keeps one session per task and swaps the old one out', () => {
    const store = useModelRuntime.getState();
    store.clearResident();
    store.setResident(resident('qwen3-0.6b', 'text', 1767));
    store.setResident(resident('bge-base-zh', 'embedding', 294));
    expect(useModelRuntime.getState().residents).toHaveLength(2);

    store.setResident(resident('bge-small-zh', 'embedding', 69));
    expect(useModelRuntime.getState().residents.map((row) => row.modelId)).toEqual([
      'qwen3-0.6b',
      'bge-small-zh',
    ]);
  });

  it('drops a single session without touching the pair', () => {
    const store = useModelRuntime.getState();
    store.clearResident();
    store.setResident(resident('qwen3-0.6b', 'text', 1767));
    store.setResident(resident('bge-base-zh', 'embedding', 294));
    store.dropResident('bge-base-zh');
    expect(useModelRuntime.getState().residents.map((row) => row.modelId)).toEqual(['qwen3-0.6b']);
  });
});
