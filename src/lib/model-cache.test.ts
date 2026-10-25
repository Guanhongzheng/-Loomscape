import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  INDEX_TRUST_MS,
  dropEntriesForRepo,
  dropEntry,
  entriesForRepo,
  isFresh,
  readEntries,
  readEntry,
  resetCacheConnection,
  saveEntry,
  type ModelCacheEntry,
} from '@/lib/model-cache';

const entry = (patch: Partial<ModelCacheEntry> = {}): ModelCacheEntry => ({
  id: 'qwen3-0.6b',
  repo: 'onnx-community/Qwen3-0.6B-ONNX',
  files: { '/models/x/onnx/model_quantized.onnx': 617_000_000 },
  bytes: 617_000_000,
  q8: true,
  fp16: false,
  verifiedAt: Date.now(),
  ...patch,
});

beforeEach(async () => {
  resetCacheConnection();
  await dropEntry('qwen3-0.6b');
  await dropEntry('bge-base-zh');
});

describe('cache index', () => {
  it('round-trips an entry', async () => {
    await saveEntry(entry());
    const back = await readEntry('qwen3-0.6b');
    expect(back?.repo).toBe('onnx-community/Qwen3-0.6B-ONNX');
    expect(back?.q8).toBe(true);
    expect(back?.bytes).toBe(617_000_000);
  });

  it('keeps entries addressable by repo', async () => {
    await saveEntry(entry());
    await saveEntry(entry({ id: 'bge-base-zh', repo: 'Xenova/bge-base-zh-v1.5', q8: true }));
    const rows = await entriesForRepo('Xenova/bge-base-zh-v1.5');
    expect(rows.map((row) => row.id)).toEqual(['bge-base-zh']);
  });

  it('drops one entry without touching the others', async () => {
    await saveEntry(entry());
    await saveEntry(entry({ id: 'bge-base-zh', repo: 'Xenova/bge-base-zh-v1.5' }));
    await dropEntry('qwen3-0.6b');
    expect(Object.keys(await readEntries())).toEqual(['bge-base-zh']);
  });

  it('drops everything for a repo', async () => {
    await saveEntry(entry());
    await dropEntriesForRepo('onnx-community/Qwen3-0.6B-ONNX');
    expect(await readEntry('qwen3-0.6b')).toBeNull();
  });

  it('treats only a recent verification as fresh', () => {
    const now = Date.now();
    expect(isFresh(entry({ verifiedAt: now }), now)).toBe(true);
    expect(isFresh(entry({ verifiedAt: now - INDEX_TRUST_MS + 1000 }), now)).toBe(true);
    expect(isFresh(entry({ verifiedAt: now - INDEX_TRUST_MS - 1 }), now)).toBe(false);
    expect(isFresh(null, now)).toBe(false);
  });
});
