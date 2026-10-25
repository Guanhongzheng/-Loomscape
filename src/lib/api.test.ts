import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestEmbeddings } from '@/lib/api';
import type { Endpoint } from '@/lib/providers';

const endpoint: Endpoint = {
  channel: 'embedding',
  preset: 'openai',
  label: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  model: 'text-embedding-3-small',
  shape: 'openai-embedding',
  updatedAt: 0,
};

function stubFetch() {
  const sizes: number[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { input: string[] };
    sizes.push(body.input.length);
    return new Response(JSON.stringify({ embeddings: body.input.map(() => [1, 0, 0]) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return {
    sizes,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('requestEmbeddings', () => {
  it('splits a long input into batches the route accepts', async () => {
    const stub = stubFetch();
    try {
      const input = Array.from({ length: 70 }, (_, index) => `chunk ${index}`);
      const vectors = await requestEmbeddings({ endpoint, input });

      // The route rejects more than 32 per request, so an unbatched ingest
      // used to fail and get re-tagged as hash, making the document invisible.
      expect(stub.sizes).toEqual([32, 32, 6]);
      expect(vectors).toHaveLength(70);
      expect(vectors[0]).toEqual([1, 0, 0]);
    } finally {
      stub.restore();
    }
  });

  it('keeps a short input in one request', async () => {
    const stub = stubFetch();
    try {
      const vectors = await requestEmbeddings({ endpoint, input: ['a', 'b'] });
      expect(stub.sizes).toEqual([2]);
      expect(vectors).toHaveLength(2);
    } finally {
      stub.restore();
    }
  });

  it('surfaces the upstream message instead of a bare status', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: '额度不足' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    try {
      await expect(requestEmbeddings({ endpoint, input: ['a'] })).rejects.toThrow('额度不足');
    } finally {
      globalThis.fetch = original;
    }
  });
});
