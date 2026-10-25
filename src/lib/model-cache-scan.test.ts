import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { INDEX_TRUST_MS, dropEntry, resetCacheConnection, saveEntry } from '@/lib/model-cache';
import { hasWeights, isModelCached, removeModel, scanModelCache } from '@/lib/local-runtime';

const REPO = 'onnx-community/Qwen3-0.6B-ONNX';
const at = (file: string) =>
  `https://modelscope.cn/models/${REPO}/resolve/master/onnx/${file}`;

type FakeCache = {
  hits: () => number;
  keys: () => number;
  remove: (url: string) => void;
};

/**
 * Minimal Cache Storage stand-in. `match` is the expensive call the index is
 * meant to skip, so the test counts it.
 */
function fakeCache(files: Record<string, number>): FakeCache {
  const sizes = new Map(Object.entries(files));
  let matches = 0;
  let keyReads = 0;

  const cache = {
    keys: async () => {
      keyReads += 1;
      return Array.from(sizes.keys()).map((url) => new Request(url));
    },
    match: async (request: Request | string) => {
      matches += 1;
      const url = typeof request === 'string' ? request : request.url;
      const size = sizes.get(url);
      if (size === undefined) return undefined;
      return new Response(null, { headers: { 'content-length': String(size) } });
    },
    delete: async (request: Request | string) => {
      const url = typeof request === 'string' ? request : request.url;
      return sizes.delete(url);
    },
  };

  (globalThis as unknown as { caches: unknown }).caches = {
    open: async () => cache,
  };

  return {
    hits: () => matches,
    keys: () => keyReads,
    remove: (url: string) => sizes.delete(url),
  };
}

beforeEach(async () => {
  resetCacheConnection();
  await dropEntry('qwen3-0.6b');
});

describe('scanModelCache', () => {
  it('measures a cold cache and writes the index', async () => {
    const cache = fakeCache({
      [at('config.json')]: 900,
      [at('model_quantized.onnx')]: 617_000_000,
    });

    const rows = await scanModelCache([{ id: 'qwen3-0.6b', repo: REPO }]);
    expect(rows['qwen3-0.6b'].files).toBe(2);
    expect(rows['qwen3-0.6b'].q8).toBe(true);
    expect(rows['qwen3-0.6b'].fp16).toBe(false);
    expect(rows['qwen3-0.6b'].bytes).toBe(617_000_900);
    expect(cache.hits()).toBe(2);
  });

  it('reuses the recorded sizes on the next scan', async () => {
    const cache = fakeCache({
      [at('config.json')]: 900,
      [at('model_quantized.onnx')]: 617_000_000,
    });
    await scanModelCache([{ id: 'qwen3-0.6b', repo: REPO }]);
    const before = cache.hits();

    const rows = await scanModelCache([{ id: 'qwen3-0.6b', repo: REPO }]);
    expect(rows['qwen3-0.6b'].bytes).toBe(617_000_900);
    // The whole point of the index: no per-file reads on the second pass.
    expect(cache.hits()).toBe(before);
  });

  it('sees a file the browser evicted', async () => {
    const cache = fakeCache({
      [at('config.json')]: 900,
      [at('model_quantized.onnx')]: 617_000_000,
    });
    await scanModelCache([{ id: 'qwen3-0.6b', repo: REPO }]);

    cache.remove(at('model_quantized.onnx'));
    const rows = await scanModelCache([{ id: 'qwen3-0.6b', repo: REPO }]);
    expect(rows['qwen3-0.6b'].files).toBe(1);
    expect(rows['qwen3-0.6b'].q8).toBe(false);
  });

  it('forgets a model whose cache was cleared', async () => {
    fakeCache({ [at('model_quantized.onnx')]: 10 });
    await scanModelCache([{ id: 'qwen3-0.6b', repo: REPO }]);
    expect(await isModelCached(REPO, 'q8')).toBe(true);

    fakeCache({});
    const rows = await scanModelCache([{ id: 'qwen3-0.6b', repo: REPO }]);
    expect(rows['qwen3-0.6b'].files).toBe(0);
    expect(await isModelCached(REPO, 'q8')).toBe(false);
  });
});

describe('cache deletion', () => {
  it('drops the index entry together with the files', async () => {
    const cache = fakeCache({ [at('model_quantized.onnx')]: 10 });
    await scanModelCache([{ id: 'qwen3-0.6b', repo: REPO }]);
    expect(await isModelCached(REPO, 'q8')).toBe(true);

    const removed = await removeModel(REPO);
    expect(removed).toBe(1);
    // The index must not outlive the bytes it describes.
    expect(await isModelCached(REPO, 'q8')).toBe(false);
    expect(cache.keys()).toBeGreaterThan(0);
  });
});

describe('cache lookups', () => {
  it('answers from the index without touching Cache Storage', async () => {
    const cache = fakeCache({ [at('model_quantized.onnx')]: 617_000_000 });
    await scanModelCache([{ id: 'qwen3-0.6b', repo: REPO }]);
    const keyReads = cache.keys();

    expect(await isModelCached(REPO, 'q8')).toBe(true);
    expect(await isModelCached(REPO, 'fp16')).toBe(false);
    expect(await hasWeights(REPO)).toBe(true);
    // Index hit means no `cache.keys()` at all.
    expect(cache.keys()).toBe(keyReads);
  });

  it('falls back to a scan when the index is stale', async () => {
    const cache = fakeCache({ [at('model_quantized.onnx')]: 617_000_000 });
    await saveEntry({
      id: 'qwen3-0.6b',
      repo: REPO,
      files: {},
      bytes: 0,
      q8: true,
      fp16: false,
      verifiedAt: Date.now() - INDEX_TRUST_MS - 1,
    });
    const keyReads = cache.keys();

    expect(await isModelCached(REPO, 'q8')).toBe(true);
    expect(cache.keys()).toBeGreaterThan(keyReads);
  });
});
