import type { NextRequest } from 'next/server';

const PRIVATE_HOST = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|::1|\[::1\])$/;
const PRIVATE_172 = /^172\.(1[6-9]|2\d|3[01])\./;

/**
 * The relay accepts a caller-supplied base URL. Reject anything that resolves
 * into a private range so a deployed instance cannot be used as an SSRF hop.
 */
export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('服务地址格式不正确');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('只支持 http/https 协议');
  }

  const host = url.hostname.toLowerCase();
  if (PRIVATE_HOST.test(host) || PRIVATE_172.test(host) || host.endsWith('.local')) {
    throw new Error('不允许访问内网地址');
  }

  return url;
}

export function trimBase(base: string): string {
  return base.replace(/\/+$/, '');
}

export type Resolved = { baseUrl: string; apiKey: string; model: string; source: 'client' | 'env' };

export function resolve(
  channel: 'text' | 'image' | 'speech',
  body: { baseUrl?: string; apiKey?: string; model?: string },
): Resolved | null {
  const prefix = channel === 'text' ? 'OPENAI' : channel === 'image' ? 'IMAGE' : 'SPEECH';
  const envBase = process.env[`${prefix}_BASE_URL`] ?? '';
  const envKey = process.env[`${prefix}_API_KEY`] ?? '';
  const envModel = process.env[`${prefix}_MODEL`] ?? '';

  const baseUrl = body.baseUrl?.trim() || envBase;
  const apiKey = body.apiKey?.trim() || envKey;
  const model = body.model?.trim() || envModel;

  if (!baseUrl || !apiKey || !model) return null;
  return {
    baseUrl: trimBase(baseUrl),
    apiKey,
    model,
    source: body.apiKey?.trim() ? 'client' : 'env',
  };
}

export function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function jsonError(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function clientSignal(request: NextRequest): AbortSignal {
  return request.signal;
}

/** Origin check for mutating routes; same-origin requests have no Origin header. */
export function originAllowed(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const allowList = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (allowList.length === 0) {
    try {
      return new URL(origin).host === request.headers.get('host');
    } catch {
      return false;
    }
  }
  return allowList.includes(origin);
}
