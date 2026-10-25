import { describe, expect, it } from 'vitest';
import {
  ALL_LOCAL_MODELS,
  DEFAULT_ENGINE_PREFS,
  LOCAL_EMBEDDINGS,
  LOCAL_TEXT,
  RETIRED_MODELS,
  findModel,
  normalisePrefs,
  sizeFor,
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
