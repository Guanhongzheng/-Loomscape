import type { NextRequest } from 'next/server';
import { assertPublicUrl, jsonError, originAllowed, resolve } from '@/lib/server/upstream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!originAllowed(request)) return jsonError('来源不被允许', 403);

  const body = (await request.json().catch(() => null)) as
    | { input?: unknown; baseUrl?: string; apiKey?: string; model?: string }
    | null;

  if (!body) return jsonError('请求体不是合法 JSON');

  const input = Array.isArray(body.input)
    ? body.input.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

  if (input.length === 0) return jsonError('缺少 input');
  if (input.length > 32) return jsonError('单次最多 32 条', 413);

  const config = resolve('embedding', body);
  if (!config) return jsonError('尚未配置嵌入端点', 412);

  try {
    assertPublicUrl(config.baseUrl);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : '端点不可用', 400);
  }

  const response = await fetch(`${config.baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      input: input.map((text) => text.slice(0, 4000)),
      encoding_format: 'float',
    }),
  }).catch((error: unknown) => {
    throw new Error(error instanceof Error ? error.message : '无法连接上游服务');
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    let message = `上游返回 ${response.status}`;
    try {
      const parsed = JSON.parse(detail) as { error?: { message?: string } | string };
      if (typeof parsed.error === 'string') message = parsed.error;
      else if (parsed.error?.message) message = parsed.error.message;
    } catch {
      if (detail) message = detail.slice(0, 240);
    }
    return jsonError(message, 502);
  }

  const payload = (await response.json()) as {
    data?: Array<{ embedding?: number[]; index?: number }>;
  };

  const rows = (payload.data ?? [])
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((row) => row.embedding ?? [])
    .filter((row) => row.length > 0);

  if (!rows.length) return jsonError('上游没有返回向量', 502);
  return Response.json({ embeddings: rows, dims: rows[0].length });
}
