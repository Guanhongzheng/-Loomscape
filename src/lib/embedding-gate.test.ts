import { describe, expect, it } from 'vitest';
import { DEFAULT_EMBED_PRICE, formatCost, formatDuration, isLocalEmbedder } from './embedding-gate';

describe('embedding gate formatting', () => {
  it('prices small libraries at four decimals so they never read as zero', () => {
    expect(formatCost(216, 3)).toBe('约 ¥0.0006');
    expect(formatCost(50_000, 3)).toBe('约 ¥0.150');
    expect(formatCost(2_000_000, 3)).toBe('约 ¥6.00');
  });

  it('treats a zero price as free', () => {
    expect(formatCost(120_000, 0)).toBe('免费');
  });

  it('uses a conservative default price', () => {
    expect(DEFAULT_EMBED_PRICE).toBeGreaterThan(0);
  });

  it('estimates local runs slower than API batches', () => {
    const api = formatDuration(160, false);
    const local = formatDuration(160, true);
    expect(api).toContain('秒');
    expect(local).not.toBe(api);
  });

  it('recognises local tags', () => {
    expect(isLocalEmbedder('local:bge-base-zh')).toBe(true);
    expect(isLocalEmbedder('api:text-embedding-v3')).toBe(false);
  });
});
