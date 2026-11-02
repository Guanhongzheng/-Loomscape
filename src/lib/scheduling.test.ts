import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROFILE,
  SCHEDULES,
  SCHEDULE_ORDER,
  isProfile,
  matchesProfile,
  residentCap,
  resolveSchedule,
  threadCap,
} from '@/lib/scheduling';

describe('scheduling profiles', () => {
  it('keeps the baseline as the default', () => {
    expect(DEFAULT_PROFILE).toBe('balanced');
    // Balanced must reproduce what the runtime did before profiles existed:
    // two threads for a decoder, four for an embedder, fp16, coexistence.
    expect(threadCap('balanced', 'text')).toBe(2);
    expect(threadCap('balanced', 'embedding')).toBe(4);
    expect(residentCap('balanced', 'wasm')).toBe(2);
    expect(SCHEDULES.balanced.gpuPrecision).toBe('fp16');
  });

  it('trades capacity for headroom in lean', () => {
    expect(threadCap('lean', 'text')).toBe(1);
    expect(threadCap('lean', 'embedding')).toBe(2);
    expect(residentCap('lean', 'wasm')).toBe(1);
    expect(residentCap('lean', 'gpu')).toBe(1);
    expect(SCHEDULES.lean.gpuPrecision).toBe('q4f16');
  });

  it('raises the decoder cap in throughput without touching coexistence', () => {
    expect(threadCap('throughput', 'text')).toBe(4);
    expect(residentCap('throughput', 'wasm')).toBe(2);
    expect(SCHEDULES.throughput.gpuPrecision).toBe('fp16');
  });

  it('falls back instead of throwing on a stale stored value', () => {
    // The preference is persisted, so an older build's value can arrive here.
    expect(resolveSchedule('turbo' as never).id).toBe('balanced');
    expect(resolveSchedule(undefined).id).toBe('balanced');
    expect(resolveSchedule(null).id).toBe('balanced');
  });

  it('validates the values that reach the store', () => {
    expect(isProfile('lean')).toBe(true);
    expect(isProfile('turbo')).toBe(false);
    expect(isProfile(undefined)).toBe(false);
  });

  it('reports a preset as active only while its precision still matches', () => {
    expect(matchesProfile('balanced', 'fp16')).toBe(true);
    expect(matchesProfile('balanced', 'q4f16')).toBe(false);
    expect(matchesProfile('lean', 'q4f16')).toBe(true);
  });

  it('lists every profile exactly once, so the picker cannot lose one', () => {
    expect(SCHEDULE_ORDER).toHaveLength(3);
    expect(new Set(SCHEDULE_ORDER).size).toBe(3);
    expect(SCHEDULE_ORDER.every((id) => SCHEDULES[id].id === id)).toBe(true);
  });
});
