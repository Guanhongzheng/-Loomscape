import { describe, expect, it } from 'vitest';
import { callCount, imagesPerCall, MAX_IMAGES } from './image-limits';

describe('imagesPerCall', () => {
  it('caps CogView at one image per request', () => {
    expect(imagesPerCall({ model: 'cogview-4' })).toBe(1);
    expect(imagesPerCall({ model: 'cogview-4-flash' })).toBe(1);
    expect(imagesPerCall({ model: 'COGVIEW-3' })).toBe(1);
  });

  it('caps Stability at one image per request', () => {
    expect(imagesPerCall({ model: 'sd3.5-large', shape: 'stability' })).toBe(1);
  });

  it('keeps the OpenAI ceiling for everything else', () => {
    expect(imagesPerCall({ model: 'gpt-image-1' })).toBe(MAX_IMAGES);
    expect(imagesPerCall({ model: 'dall-e-3' })).toBe(MAX_IMAGES);
    expect(imagesPerCall({})).toBe(MAX_IMAGES);
  });

  it('only matches CogView by model prefix, not by substring', () => {
    expect(imagesPerCall({ model: 'my-cogview-proxy' })).toBe(MAX_IMAGES);
  });
});

describe('callCount', () => {
  it('needs one call per image for single-shot models', () => {
    expect(callCount({ model: 'cogview-4' }, 1)).toBe(1);
    expect(callCount({ model: 'cogview-4' }, 2)).toBe(2);
    expect(callCount({ model: 'cogview-4' }, 4)).toBe(4);
  });

  it('needs a single call where n is honoured', () => {
    expect(callCount({ model: 'gpt-image-1' }, 4)).toBe(1);
    expect(callCount({}, 2)).toBe(1);
  });

  it('clamps nonsense counts to the UI range', () => {
    expect(callCount({ model: 'cogview-4' }, 0)).toBe(1);
    expect(callCount({ model: 'cogview-4' }, Number.NaN)).toBe(1);
    expect(callCount({ model: 'cogview-4' }, 99)).toBe(MAX_IMAGES);
  });
});
