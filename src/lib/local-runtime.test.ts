import { describe, expect, it } from 'vitest';
import { runtimeInfo, threadCount } from '@/lib/local-runtime';

describe('threadCount', () => {
  it('leaves one core to the UI and caps at four', () => {
    expect(threadCount(4, true)).toBe(3);
    expect(threadCount(6, true)).toBe(4);
    expect(threadCount(32, true)).toBe(4);
  });

  it('never drops below one thread', () => {
    expect(threadCount(1, true)).toBe(1);
    expect(threadCount(2, true)).toBe(1);
    expect(threadCount(0, true)).toBe(1);
  });

  it('uses a single thread without cross-origin isolation', () => {
    // SharedArrayBuffer is gated behind COOP/COEP; without it the wasm runtime
    // cannot spawn workers at all.
    expect(threadCount(16, false)).toBe(1);
  });

  it('floors fractional core counts', () => {
    expect(threadCount(5.9, true)).toBe(4);
  });
});

describe('runtimeInfo', () => {
  it('reports a usable shape outside a browser', () => {
    const info = runtimeInfo();
    expect(info.cores).toBeGreaterThanOrEqual(1);
    expect(info.threads).toBeGreaterThanOrEqual(1);
    expect(typeof info.isolated).toBe('boolean');
  });
});
