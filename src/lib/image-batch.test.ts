import { describe, expect, it, vi } from 'vitest';
import { generateImages, type ImageResult } from './image-batch';

const shot = (i: number): ImageResult => ({ url: `https://cdn/${i}.png` });

describe('generateImages', () => {
  it('makes one call per image when the model ignores n (CogView)', async () => {
    // Upstream always answers with a single image, whatever n says.
    const fetchOnce = vi.fn(async (n: number) => [shot(n)]);
    const images = await generateImages({ model: 'cogview-4-flash', count: 4, fetchOnce });

    expect(images).toHaveLength(4);
    expect(fetchOnce).toHaveBeenCalledTimes(4);
    expect(fetchOnce.mock.calls.map(([n]) => n)).toEqual([1, 1, 1, 1]);
  });

  it('makes a single call when n is honoured', async () => {
    const fetchOnce = vi.fn(async (n: number) => Array.from({ length: n }, (_, i) => shot(i)));
    const images = await generateImages({ model: 'gpt-image-1', count: 4, fetchOnce });

    expect(images).toHaveLength(4);
    expect(fetchOnce).toHaveBeenCalledTimes(1);
    expect(fetchOnce).toHaveBeenCalledWith(4);
  });

  it('tops up an unknown provider that silently returns one image', async () => {
    let calls = 0;
    const fetchOnce = vi.fn(async (n: number) => {
      calls += 1;
      return [shot(calls)]; // ignores n, one image per call
    });
    const images = await generateImages({ model: 'mystery-model', count: 4, fetchOnce });

    expect(fetchOnce.mock.calls[0]).toEqual([4]);
    expect(images).toHaveLength(4);
    expect(calls).toBe(4);
  });

  it('keeps the images that arrived when one call fails', async () => {
    let index = 0;
    const fetchOnce = vi.fn(async () => {
      index += 1;
      if (index === 2) throw new Error('429');
      return [shot(index)];
    });
    const images = await generateImages({ model: 'cogview-4', count: 3, fetchOnce });

    expect(images).toHaveLength(3);
    expect(images.every((image) => image.url)).toBe(true);
  });

  it('throws the first error when every call fails', async () => {
    const fetchOnce = vi.fn(async () => {
      throw new Error('upstream 500');
    });
    await expect(generateImages({ model: 'gpt-image-1', count: 2, fetchOnce })).rejects.toThrow(
      'upstream 500',
    );
  });

  it('never returns more than requested', async () => {
    const fetchOnce = vi.fn(async (n: number) => Array.from({ length: n + 2 }, (_, i) => shot(i)));
    const images = await generateImages({ model: 'gpt-image-1', count: 2, fetchOnce });
    expect(images).toHaveLength(2);
  });

  it('stops topping up when the provider keeps refusing', async () => {
    let calls = 0;
    const fetchOnce = vi.fn(async () => {
      calls += 1;
      if (calls > 1) throw new Error('rate limited');
      return [shot(1)];
    });
    const images = await generateImages({ model: 'cogview-4', count: 4, fetchOnce });

    // 4 parallel attempts, one of which landed, plus a single top-up that failed.
    expect(images).toHaveLength(1);
    expect(calls).toBe(5);
  });
});
