import type { NextRequest } from 'next/server';

/**
 * Hosts that point back into a private network. Each pattern is anchored on
 * its own: an earlier version grouped them behind a single `$`, which made
 * `127.0.0.1` match the `127.` alternative only after the end-of-string check,
 * so private addresses slipped through.
 */
const PRIVATE_HOSTS: RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1$/,
  /^\[::1\]$/,
  /^\[?f[cd][0-9a-f]{2}:/i,
  /^\[?fe80:/i,
  /\.local$/i,
  /\.internal$/i,
];

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return PRIVATE_HOSTS.some((pattern) => pattern.test(host));
}

/**
 * The relay accepts a caller-supplied base URL. Reject anything that resolves
 * into a private range so a deployed instance cannot be used as an SSRF hop.
 * A hostname that resolves to a private address through DNS cannot be caught
 * here; deployment should still restrict egress where that matters.
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

  if (isPrivateHost(url.hostname)) {
    throw new Error('不允许访问内网地址');
  }

  return url;
}

export function trimBase(base: string): string {
  return base.replace(/\/+$/, '');
}

export type Resolved = { baseUrl: string; apiKey: string; model: string; source: 'client' | 'env' };

export function resolve(
  channel: 'text' | 'image' | 'speech' | 'embedding',
  body: { baseUrl?: string; apiKey?: string; model?: string },
): Resolved | null {
  const prefix =
    channel === 'text'
      ? 'OPENAI'
      : channel === 'image'
        ? 'IMAGE'
        : channel === 'speech'
          ? 'SPEECH'
          : 'EMBED';
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
