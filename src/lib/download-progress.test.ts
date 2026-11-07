import { describe, expect, it } from 'vitest';
import { createDownloadProgress } from '@/lib/download-progress';

describe('download progress', () => {
  it('uses the catalogue size as the denominator from the first chunk', () => {
    const tracker = createDownloadProgress(1000);
    const first = tracker.apply({ status: 'progress', file: 'a.onnx', loaded: 250, total: 1000 });
    expect(first?.loaded).toBe(250);
    expect(first?.total).toBe(1000);
    expect(first?.progress).toBeCloseTo(0.25);
  });

  it('closes a file on done even though done carries no total', () => {
    const tracker = createDownloadProgress(1000);
    // The last chunk lands at 97%; transformers.js then reports `done` with
    // only a file name. Without closing the file here the bar never reaches the
    // end of a single-file model.
    tracker.apply({ status: 'progress', file: 'a.onnx', loaded: 970, total: 1000 });
    expect(tracker.apply({ status: 'done', file: 'a.onnx' })?.loaded).toBe(1000);
  });

  it('does not jump backwards at a shard boundary', () => {
    const tracker = createDownloadProgress(1000);
    tracker.apply({ status: 'progress', file: 'a.onnx', loaded: 300, total: 300 });
    tracker.apply({ status: 'done', file: 'a.onnx' });
    const midway = tracker.apply({
      status: 'progress',
      file: 'b.onnx_data',
      loaded: 100,
      total: 700,
    });
    expect(midway?.loaded).toBe(400);
    expect(midway?.total).toBe(1000);
    expect(midway?.progress).toBeCloseTo(0.4);
  });

  it('never reports 1.0 before ready', () => {
    const tracker = createDownloadProgress(1000);
    tracker.apply({ status: 'progress', file: 'a.onnx', loaded: 1000, total: 1000 });
    const done = tracker.apply({ status: 'done', file: 'a.onnx' });
    // `ready` writes 1; the transfer's own ceiling stays at 99% so the row
    // cannot look finished while ORT is still parsing the graph.
    expect(done?.progress).toBeLessThan(1);
    expect(Math.round((done?.progress ?? 0) * 100)).toBe(99);
  });

  it('keeps the current file name when a chunk has no total', () => {
    const tracker = createDownloadProgress(0);
    tracker.apply({ status: 'progress', file: 'a.onnx', loaded: 50, total: 100 });
    const unknown = tracker.apply({ status: 'progress', file: 'a.onnx', loaded: 60 });
    expect(unknown?.file).toBe('a.onnx');
    expect(unknown?.loaded).toBe(50);
  });

  it('names the file on initiate without resetting the byte count', () => {
    const tracker = createDownloadProgress(1000);
    tracker.apply({ status: 'progress', file: 'a.onnx', loaded: 100, total: 500 });
    const next = tracker.apply({ status: 'initiate', file: 'b.onnx_data' });
    expect(next?.file).toBe('b.onnx_data');
    expect(next?.loaded).toBe(100);
    expect(next?.progress).toBeCloseTo(0.1);
  });

  it('grows the denominator when the host sends more than the catalogue', () => {
    const tracker = createDownloadProgress(1000);
    const snapshot = tracker.apply({
      status: 'progress',
      file: 'a.onnx',
      loaded: 600,
      total: 1200,
    });
    expect(snapshot?.total).toBe(1200);
    expect(snapshot?.progress).toBeCloseTo(0.5);
  });

  it('ignores events that name no file or an unknown status', () => {
    const tracker = createDownloadProgress(1000);
    expect(tracker.apply({ status: 'progress', loaded: 10, total: 100 })).toBeNull();
    expect(
      tracker.apply({ status: 'metadata', file: 'a.onnx', loaded: 10, total: 100 }),
    ).toBeNull();
  });
});
