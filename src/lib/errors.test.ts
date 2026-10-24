import { describe, expect, it } from 'vitest';
import { describeError, looksLikeMemoryPressure } from '@/lib/errors';

class QuotaLike {
  name = 'QuotaExceededError';
  constructor(public message: string) {}
}

describe('describeError', () => {
  it('uses the message of a real error', () => {
    expect(describeError(new Error('模型文件已损坏'))).toBe('模型文件已损坏');
  });

  it('falls back to the name when the message is empty', () => {
    expect(describeError(new Error(''))).toBe('Error');
  });

  it('reads DOMException-shaped values, which are not Error instances', () => {
    // Quota errors are the common non-Error throw from IndexedDB and Cache.
    expect(describeError(new QuotaLike('配额不足'))).toBe('配额不足');
  });

  it('names a worker failure that only carries a type', () => {
    expect(describeError({ type: 'error' })).toBe('worker error');
  });

  it('handles thrown strings', () => {
    expect(describeError('failed to fetch')).toBe('failed to fetch');
  });

  it('never returns an empty label', () => {
    expect(describeError(null)).toBe('未知错误');
    expect(describeError(undefined)).toBe('未知错误');
    expect(describeError({})).toBe('未知错误');
    expect(describeError('')).toBe('未知错误');
  });
});

describe('looksLikeMemoryPressure', () => {
  it('recognises the usual wasm allocation errors', () => {
    expect(looksLikeMemoryPressure('RuntimeError: memory access out of bounds')).toBe(true);
    expect(looksLikeMemoryPressure('RangeError: Array buffer allocation failed')).toBe(true);
    expect(looksLikeMemoryPressure('Aborted(OOM)')).toBe(true);
  });

  it('does not claim a network error is memory pressure', () => {
    expect(looksLikeMemoryPressure('Failed to fetch')).toBe(false);
    expect(looksLikeMemoryPressure('Unexpected token < in JSON')).toBe(false);
  });
});
