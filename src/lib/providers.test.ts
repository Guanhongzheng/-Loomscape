import { describe, expect, it } from 'vitest';
import { cosine, hashEmbed } from '@/lib/memory';
import { EMPTY_ENDPOINTS, PRESETS, hasKey, presetFor } from '@/lib/providers';
import { assertPublicUrl, trimBase } from '@/lib/server/upstream';

describe('hashEmbed', () => {
  it('always returns a normalised 192 dimension vector', () => {
    const vector = hashEmbed('雨夜的旧书店');
    expect(vector).toHaveLength(192);
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 3);
  });

  it('is deterministic', () => {
    expect(hashEmbed('同一段文字')).toEqual(hashEmbed('同一段文字'));
  });

  it('returns a zero vector for empty input', () => {
    const vector = hashEmbed('   ');
    expect(vector.every((value) => value === 0)).toBe(true);
  });

  it('scores related phrasing above unrelated phrasing', () => {
    const query = '雨夜书店的灯光';
    const near = hashEmbed('雨夜书店的暖色灯光');
    const far = hashEmbed('机械键盘的轴体手感');
    const probe = hashEmbed(query);
    expect(cosine(probe, near)).toBeGreaterThan(cosine(probe, far));
  });
});

describe('cosine', () => {
  it('is zero for vectors of different lengths', () => {
    expect(cosine([1, 0], [1, 0, 0])).toBe(0);
  });

  it('is one for identical unit vectors', () => {
    const vector = hashEmbed('织');
    expect(cosine(vector, vector)).toBeCloseTo(1, 6);
  });
});

describe('provider presets', () => {
  const ids = PRESETS.text.map((preset) => preset.id);

  it('offers the five cloud vendors plus a custom slot', () => {
    expect(ids).toEqual(['openai', 'anthropic', 'google', 'zhipu', 'deepseek', 'custom']);
  });

  it('assigns a wire shape that matches the vendor protocol', () => {
    const shape = (id: string) => presetFor('text', id)?.shape;
    expect(shape('openai')).toBe('openai-chat');
    expect(shape('deepseek')).toBe('openai-chat');
    expect(shape('zhipu')).toBe('openai-chat');
    expect(shape('anthropic')).toBe('anthropic-chat');
    expect(shape('google')).toBe('google-chat');
  });

  it('gives every preset but the custom slot a base url and a model', () => {
    for (const preset of PRESETS.text.filter((item) => item.id !== 'custom')) {
      expect(preset.baseUrl, preset.id).toMatch(/^https:\/\//);
      expect(preset.models.length, preset.id).toBeGreaterThan(0);
    }
  });

  it('returns undefined for an unknown preset', () => {
    expect(presetFor('text', 'nonexistent')).toBeUndefined();
  });

  it('starts every channel with a channel field and an https address', () => {
    for (const [channel, endpoint] of Object.entries(EMPTY_ENDPOINTS)) {
      expect(endpoint.channel).toBe(channel);
      expect(endpoint.baseUrl).toMatch(/^https:\/\//);
    }
  });
});

describe('hasKey', () => {
  const base = EMPTY_ENDPOINTS.text;

  it('requires both a key and an address', () => {
    expect(hasKey({ ...base, apiKey: 'sk-123456789' })).toBe(true);
    expect(hasKey({ ...base, apiKey: 'short' })).toBe(false);
    expect(hasKey({ ...base, apiKey: 'sk-123456789', baseUrl: '' })).toBe(false);
  });
});

describe('assertPublicUrl', () => {
  it('accepts a public https endpoint', () => {
    expect(assertPublicUrl('https://api.deepseek.com/v1').hostname).toBe('api.deepseek.com');
  });

  it.each([
    'http://localhost:3000/v1',
    'http://127.0.0.1:8080/v1',
    'http://10.0.0.5/v1',
    'http://192.168.1.10/v1',
    'http://172.20.0.1/v1',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]:9000/v1',
    'http://printer.local/v1',
    'http://0.0.0.0/v1',
  ])('blocks the private address %s', (url) => {
    expect(() => assertPublicUrl(url)).toThrow(/内网地址/);
  });

  it('rejects non-http protocols and malformed input', () => {
    expect(() => assertPublicUrl('file:///etc/passwd')).toThrow(/http\/https/);
    expect(() => assertPublicUrl('not a url')).toThrow(/格式不正确/);
  });

  it('does not block a public host that merely starts with a private prefix', () => {
    expect(assertPublicUrl('https://128.0.0.1.example.com/v1').hostname).toBe(
      '128.0.0.1.example.com',
    );
  });
});

describe('trimBase', () => {
  it('removes trailing slashes only', () => {
    expect(trimBase('https://api.test/v1///')).toBe('https://api.test/v1');
    expect(trimBase('https://api.test/v1')).toBe('https://api.test/v1');
  });
});
