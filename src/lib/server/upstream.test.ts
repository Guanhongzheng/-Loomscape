import { afterEach, describe, expect, it } from 'vitest';
import { assertPublicUrl, originAllowed } from '@/lib/server/upstream';

const request = (headers: Record<string, string>) =>
  ({
    headers: new Headers(headers),
    nextUrl: new URL('http://localhost:3000/api/chat'),
  }) as never;

afterEach(() => {
  delete process.env.ALLOW_ORIGINLESS;
  delete process.env.ALLOWED_ORIGINS;
});

describe('originAllowed', () => {
  it('rejects a request with no Origin, because that is not a browser', () => {
    // curl used to be allowed through, which made every route an open relay.
    expect(originAllowed(request({}))).toBe(false);
  });

  it('can be re-opened deliberately for scripts', () => {
    process.env.ALLOW_ORIGINLESS = '1';
    expect(originAllowed(request({}))).toBe(true);
  });

  it('accepts the app’s own origin', () => {
    expect(originAllowed(request({ origin: 'http://localhost:3000' }))).toBe(true);
  });

  it('rejects a different origin', () => {
    expect(originAllowed(request({ origin: 'https://evil.example' }))).toBe(false);
  });

  it('prefers the configured allow-list over the request host', () => {
    process.env.ALLOWED_ORIGINS = 'https://a.example, https://b.example';
    expect(originAllowed(request({ origin: 'https://b.example' }))).toBe(true);
    expect(originAllowed(request({ origin: 'http://localhost:3000' }))).toBe(false);
  });
});

describe('assertPublicUrl', () => {
  it('keeps public https endpoints', () => {
    expect(assertPublicUrl('https://api.example.com/v1').hostname).toBe('api.example.com');
  });

  it('refuses loopback, private ranges and the metadata address', () => {
    for (const raw of [
      'http://localhost:8080/v1',
      'http://127.0.0.1/v1',
      'http://10.0.0.5/v1',
      'http://192.168.1.10/v1',
      'http://172.16.0.1/v1',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/v1',
    ]) {
      expect(() => assertPublicUrl(raw)).toThrow(/内网地址/);
    }
  });

  it('refuses other schemes and malformed input', () => {
    expect(() => assertPublicUrl('file:///etc/passwd')).toThrow(/http/);
    expect(() => assertPublicUrl('not a url')).toThrow(/格式/);
  });
});
