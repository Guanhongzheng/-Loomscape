import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  recoverInterruptedLoad,
  runtimeInfo,
  threadCount,
} from '@/lib/local-runtime';
import {
  chatPrompt,
  createReasoningFilter,
  createStopFilter,
  promptFor,
} from '@/lib/local-prompts';
import { isWeightRequest, weightFile } from '@/lib/weights';
import { LOCAL_EMBEDDINGS, LOCAL_TEXT, dtypeFor, sizeFor, useModelRuntime } from '@/lib/engines';

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

  it('drops an embedder to two threads while a decoder shares the heap', () => {
    expect(threadCount(16, true, 'embedding', true)).toBe(2);
    // The paired cap only lowers the ceiling; a two-core machine stays at one.
    expect(threadCount(2, true, 'embedding', true)).toBe(1);
  });

  it('honours a scheduling profile cap in both directions', () => {
    // `lean` asks for one thread, `throughput` for four; the core count still
    // wins when it is lower, and the shared-heap rule still caps at two.
    expect(threadCount(16, true, 'text', false, 1)).toBe(1);
    expect(threadCount(16, true, 'text', false, 4)).toBe(4);
    expect(threadCount(3, true, 'text', false, 4)).toBe(2);
    expect(threadCount(16, true, 'embedding', true, 4)).toBe(2);
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

  it('runs 4-bit only when asked for, and only on WebGPU', () => {
    expect(dtypeFor(model, 'webgpu', 'q4f16')).toBe('q4f16');
    // WASM keeps int8: `model_q4.onnx` there carries fp32 activations and is
    // larger than the int8 file, so it would cost memory instead of saving it.
    expect(dtypeFor(model, 'wasm', 'q4f16')).toBe('q8');
  });

  it('keeps embedders on fp16 even when 4-bit is requested', () => {
    // A BGE q4f16 session fails to build under the WebGPU EP (ORT 1151160272),
    // so the saving stays on the decoder.
    const embedder = LOCAL_EMBEDDINGS[1];
    expect(dtypeFor(embedder, 'webgpu', 'q4f16')).toBe('fp16');
    expect(dtypeFor(embedder, 'webgpu')).toBe('fp16');
  });

  it('maps each dtype to a file the hub actually has', () => {
    expect(weightFile('q8')).toBe('model_quantized.onnx');
    expect(weightFile('fp16')).toBe('model_fp16.onnx');
    expect(weightFile('q4f16')).toBe('model_q4f16.onnx');
  });

  it('quotes the size of the precision that will be fetched', () => {
    expect(sizeFor(model, 'wasm')).toBe(model.sizesMB.q8);
    expect(sizeFor(model, 'webgpu')).toBe(model.sizesMB.fp16);
    expect(sizeFor(model, 'auto')).toBe(model.sizesMB.q8);
    expect(sizeFor(model, 'webgpu', 'q4f16')).toBe(model.sizesMB.q4f16);
    // The reason the option exists: 4-bit is smaller than both alternatives.
    expect(sizeFor(model, 'webgpu', 'q4f16')).toBeLessThan(sizeFor(model, 'wasm'));
    expect(sizeFor(model, 'webgpu', 'q4f16')).toBeLessThan(sizeFor(model, 'webgpu'));
  });
});

describe('isWeightRequest', () => {
  const repo = 'onnx-community/Qwen2.5-0.5B-Instruct';
  const at = (file: string) => `https://modelscope.cn/models/${repo}/resolve/master/onnx/${file}`;

  it('accepts the weight file that matches the dtype', () => {
    expect(isWeightRequest(at('model_quantized.onnx'), repo, 'q8')).toBe(true);
    expect(isWeightRequest(at('model_q4f16.onnx'), repo, 'q4f16')).toBe(true);
  });

  it('accepts fp16 for the WebGPU path', () => {
    expect(isWeightRequest(at('model_fp16.onnx'), repo, 'fp16')).toBe(true);
    expect(isWeightRequest(at('model_fp16.onnx'), repo, 'q8')).toBe(false);
  });

  it('rejects a different quantisation', () => {
    // Switching q4f16 to q8 must not leave the old file looking ready.
    expect(isWeightRequest(at('model_q4f16.onnx'), repo, 'q8')).toBe(false);
    expect(isWeightRequest(at('model_quantized.onnx'), repo, 'q4f16')).toBe(false);
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

describe('chatPrompt', () => {
  it('renders every turn and leaves the assistant slot open', () => {
    const prompt = chatPrompt('你是编辑', [
      { role: 'user', content: '写一句开场' },
      { role: 'assistant', content: '灯先亮了。' },
      { role: 'user', content: '再短一点' },
    ]);
    expect(prompt.match(/<\|im_start\|>user/g)).toHaveLength(2);
    expect(prompt).toContain('<|im_start|>assistant\n灯先亮了。<|im_end|>');
    expect(prompt.endsWith('<|im_start|>assistant\n')).toBe(true);
  });

  it('appends a model prefill inside the assistant turn', () => {
    const prompt = chatPrompt('你是编辑', [{ role: 'user', content: '一' }], '<think>\n\n</think>\n\n');
    expect(prompt.endsWith('<|im_start|>assistant\n<think>\n\n</think>\n\n')).toBe(true);
  });

  it('does not repeat the system block for each turn', () => {
    const prompt = chatPrompt('你是编辑', [
      { role: 'user', content: '一' },
      { role: 'assistant', content: '二' },
      { role: 'user', content: '三' },
    ]);
    expect(prompt.match(/<\|im_start\|>system/g)).toHaveLength(1);
  });
});

describe('promptFor', () => {
  const turns = [{ role: 'user' as const, content: '写一句开场' }];

  it('leaves ChatML models on the hand-written string', () => {
    const tokenizer = { apply_chat_template: () => '<|start_header_id|>x' };
    expect(promptFor(tokenizer, '你是编辑', turns, '', false)).toBe(chatPrompt('你是编辑', turns));
  });

  it('uses the repo template when the model declares one', () => {
    const tokenizer = {
      apply_chat_template: (_messages: unknown, options?: unknown) =>
        `<|start_header_id|>assistant<|end_header_id|>${
          (options as { add_generation_prompt?: boolean } | undefined)?.add_generation_prompt ? '!' : ''
        }`,
    };
    const prompt = promptFor(tokenizer, '你是编辑', turns, '<seed>', true);
    expect(prompt).toBe('<|start_header_id|>assistant<|end_header_id|>!<seed>');
  });

  it('falls back when the repo has no usable template', () => {
    const broken = {
      apply_chat_template: () => {
        throw new Error('no template');
      },
    };
    expect(promptFor(broken, '你是编辑', turns, '', true)).toBe(chatPrompt('你是编辑', turns));
    expect(promptFor(undefined, '你是编辑', turns, '', true)).toBe(chatPrompt('你是编辑', turns));
  });
});

describe('stop filter', () => {
  const run = (chunks: string[]) => {
    const out: string[] = [];
    const filter = createStopFilter((text) => out.push(text));
    chunks.forEach((chunk) => filter.push(chunk));
    filter.flush();
    return out.join('');
  };

  it('cuts the transcript at a turn marker', () => {
    expect(run(['潮汐是月球引力', '造成的。', '<|eot_id|>assistant 还想说'])).toBe('潮汐是月球引力造成的。');
  });

  it('holds a marker split across tokens so it never leaks', () => {
    expect(run(['答案', '<|eo', 't_id|>', '后面不要'])).toBe('答案');
  });

  it('keeps a trailing "<" that is not a marker', () => {
    expect(run(['a < b'])).toBe('a < b');
  });

  it('emits everything when no marker appears', () => {
    expect(run(['第一段', '，第二段'])).toBe('第一段，第二段');
  });
});

describe('reasoning filter', () => {
  const run = (chunks: string[]) => {
    let out = '';
    const filter = createReasoningFilter((text) => {
      out += text;
    });
    chunks.forEach((chunk) => filter.push(chunk));
    filter.flush();
    return out;
  };

  it('passes a plain answer through untouched', () => {
    expect(run(['灯', '先亮', '了。'])).toBe('灯先亮了。');
  });

  it('drops a reasoning block that opens the answer', () => {
    expect(run(['<think>先判断语气</think>', '灯先亮了。'])).toBe('灯先亮了。');
  });

  it('accepts the chat-template end token as the closer', () => {
    expect(run(['<think>想一想<｜end▁of▁thinking｜>', '答案'])).toBe('答案');
  });

  it('does not eat an English answer that opens with "think"', () => {
    expect(run(['thinking aloud is the brief'])).toBe('thinking aloud is the brief');
  });

  it('handles a tag split across tokens', () => {
    expect(run(['<thi', 'nk>推理</thi', 'nk>', '答案'])).toBe('答案');
  });

  it('swallows an unclosed block instead of printing reasoning', () => {
    expect(run(['<think>', '一直推理没有收尾'])).toBe('');
  });

  it('drops a stray closer left by the prompt prefill', () => {
    expect(run(['\n\n</think>\n\n', '答案'])).toBe('答案');
  });

  it('keeps text that merely starts with an angle bracket', () => {
    expect(run(['<3 这个方案'])).toBe('<3 这个方案');
  });

  it('does not strip a think tag in the middle of an answer', () => {
    expect(run(['答案里提到 <think> 标签'])).toBe('答案里提到 <think> 标签');
  });
});

describe('recoverInterruptedLoad', () => {
  const stash = new Map<string, string>();
  const KEY = 'loomscape:model-load';

  beforeEach(() => {
    stash.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => stash.get(key) ?? null,
      setItem: (key: string, value: string) => void stash.set(key, value),
      removeItem: (key: string) => void stash.delete(key),
    };
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('turns a dangling load marker into an error on that card', () => {
    stash.set(KEY, JSON.stringify({ modelId: 'qwen3-0.6b', at: Date.now() }));
    expect(recoverInterruptedLoad()).toBe('qwen3-0.6b');
    const state = useModelRuntime.getState().models['qwen3-0.6b'];
    expect(state.state).toBe('error');
    expect(state.message).toContain('内存');
  });

  it('clears the marker so the same failure is not reported twice', () => {
    stash.set(KEY, JSON.stringify({ modelId: 'qwen3-0.6b', at: Date.now() }));
    recoverInterruptedLoad();
    expect(stash.has(KEY)).toBe(false);
    expect(recoverInterruptedLoad()).toBeNull();
  });

  it('ignores a model this build no longer offers', () => {
    stash.set(KEY, JSON.stringify({ modelId: 'qwen2.5-0.5b', at: Date.now() }));
    expect(recoverInterruptedLoad()).toBeNull();
  });

  it('ignores a marker from a session the user left long ago', () => {
    stash.set(KEY, JSON.stringify({ modelId: 'qwen3-0.6b', at: Date.now() - 31 * 60 * 1000 }));
    expect(recoverInterruptedLoad()).toBeNull();
  });

  it('survives corrupted json', () => {
    stash.set(KEY, '{not json');
    expect(recoverInterruptedLoad()).toBeNull();
  });
});
