import { describe, expect, it } from 'vitest';
import { dtypeFor, isWeightRequest, runtimeInfo, threadCount, weightFile } from '@/lib/local-runtime';
import { LOCAL_TEXT, sizeFor } from '@/lib/engines';

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

  it('caps a text session lower than an embedding one', () => {
    // Decoding holds a KV cache per thread; four threads can cost gigabytes.
    expect(threadCount(16, true, 'text')).toBe(2);
    expect(threadCount(16, true, 'embedding')).toBe(4);
    expect(threadCount(2, true, 'text')).toBe(1);
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

describe('dtype selection', () => {
  const model = LOCAL_TEXT[0];

  it('never asks WebGPU for fp32', () => {
    // fp32 for these repos is a topology file plus a 2.1GB external-data blob,
    // which is past the size a single Response can hold.
    expect(dtypeFor(model, 'webgpu')).toBe('fp16');
    expect(dtypeFor(model, 'wasm')).toBe('q8');
  });

  it('maps each dtype to a file the hub actually has', () => {
    expect(weightFile('q8')).toBe('model_quantized.onnx');
    expect(weightFile('fp16')).toBe('model_fp16.onnx');
  });

  it('quotes the size of the precision that will be fetched', () => {
    expect(sizeFor(model, 'wasm')).toBe(model.sizesMB.q8);
    expect(sizeFor(model, 'webgpu')).toBe(model.sizesMB.fp16);
    expect(sizeFor(model, 'auto')).toBe(model.sizesMB.q8);
    expect(sizeFor(model, 'webgpu')).toBeGreaterThan(sizeFor(model, 'wasm'));
  });
});

describe('isWeightRequest', () => {
  const repo = 'onnx-community/Qwen2.5-0.5B-Instruct';
  const at = (file: string) => `https://modelscope.cn/models/${repo}/resolve/master/onnx/${file}`;

  it('accepts the weight file that matches the dtype', () => {
    expect(isWeightRequest(at('model_quantized.onnx'), repo, 'q8')).toBe(true);
    expect(isWeightRequest(at('model_q4.onnx'), repo, 'q4')).toBe(true);
  });

  it('accepts fp16 for the WebGPU path', () => {
    expect(isWeightRequest(at('model_fp16.onnx'), repo, 'fp16')).toBe(true);
    expect(isWeightRequest(at('model_fp16.onnx'), repo, 'q8')).toBe(false);
  });

  it('rejects a different quantisation', () => {
    // Switching q4 to q8 must not leave the old file looking ready.
    expect(isWeightRequest(at('model_q4.onnx'), repo, 'q8')).toBe(false);
    expect(isWeightRequest(at('model_quantized.onnx'), repo, 'q4')).toBe(false);
  });

  it('rejects config and tokenizer entries', () => {
    // These land in the cache first, which is how a half-download looked ready.
    expect(isWeightRequest(at('config.json'), repo)).toBe(false);
    expect(isWeightRequest(at('tokenizer.json'), repo)).toBe(false);
  });

  it('ignores other repositories', () => {
    expect(isWeightRequest('https://x.dev/models/other/model_quantized.onnx', repo)).toBe(false);
  });

  it('survives a malformed url', () => {
    expect(isWeightRequest(`${repo}/resolve/master/onnx/model_quantized.onnx`, repo)).toBe(false);
  });
});
