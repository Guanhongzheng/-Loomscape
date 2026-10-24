import { describe, expect, it } from 'vitest';
import { roomFor, type StorageUsage } from '@/lib/storage';

const usage = (used: number, quota: number): StorageUsage => ({
  used,
  quota,
  free: Math.max(quota - used, 0),
  ratio: quota > 0 ? used / quota : 0,
});

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe('roomFor', () => {
  it('accepts when there is plenty of quota left', () => {
    expect(roomFor(usage(1 * GB, 4 * GB), 490 * MB)).toBe(true);
  });

  it('refuses when the download would not fit', () => {
    // The case that produced an opaque abort: 200MB free, 490MB needed.
    expect(roomFor(usage(3.8 * GB, 4 * GB), 490 * MB)).toBe(false);
  });

  it('keeps a margin above the raw size', () => {
    // Free space just above the file size, but inside the 15% margin.
    expect(roomFor(usage(4 * GB - 500 * MB, 4 * GB), 490 * MB)).toBe(false);
  });

  it('does not block when the browser reports no quota', () => {
    expect(roomFor(null, 490 * MB)).toBe(true);
    expect(roomFor(usage(0, 0), 490 * MB)).toBe(true);
  });

  it('handles a zero-byte need', () => {
    expect(roomFor(usage(3 * GB, 4 * GB), 0)).toBe(true);
  });
});
