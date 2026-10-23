import type { NextRequest } from 'next/server';
import { assertPublicUrl, jsonError, originAllowed, resolve, sse } from '@/lib/server/upstream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Message = { role: 'system' | 'user' | 'assistant'; content: string };

function sanitise(input: unknown): Message[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item): item is Message => {
      if (!item || typeof item !== 'object') return false;
      const row = item as Record<string, unknown>;
      return (
        (row.role === 'system' || row.role === 'user' || row.role === 'assistant') &&
        typeof row.content === 'string'
      );
    })
    .map((item) => ({ role: item.role, content: item.content.slice(0, 24_000) }))
    .slice(-32);
}

export async function POST(request: NextRequest) {
  if (!originAllowed(request)) return jsonError('来源不被允许', 403);

  const body = (await request.json().catch(() => null)) as
    | { messages?: unknown; temperature?: number; maxTokens?: number; baseUrl?: string; apiKey?: string; model?: string }
    | null;

  if (!body) return jsonError('请求体不是合法 JSON');

  const messages = sanitise(body.messages);
  if (messages.length === 0) return jsonError('缺少 messages');

  const config = resolve('text', body);
  if (!config) return jsonError('尚未配置文本端点', 412);

  let endpoint: string;
  try {
    const base = assertPublicUrl(config.baseUrl);
    endpoint = base.pathname.replace(/\/$/, '').endsWith('/chat/completions')
      ? base.toString()
      : `${config.baseUrl}/chat/completions`;
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : '端点不可用', 400);
  }

  const upstream = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
      temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
      max_tokens: typeof body.maxTokens === 'number' ? body.maxTokens : 1600,
    }),
    signal: request.signal,
  }).catch((error: unknown) => {
    throw new Error(error instanceof Error ? error.message : '无法连接上游服务');
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    let message = `上游返回 ${upstream.status}`;
    try {
      const parsed = JSON.parse(detail) as { error?: { message?: string } | string };
      if (typeof parsed.error === 'string') message = parsed.error;
      else if (parsed.error?.message) message = parsed.error.message;
    } catch {
      if (detail) message = detail.slice(0, 240);
    }
    return jsonError(message, upstream.status === 401 ? 401 : 502);
  }

  // Some compatible services ignore `stream: true` and answer with plain JSON.
  if (!(upstream.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const payload = (await upstream.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: string } }> }
      | null;
    const text = payload?.choices?.[0]?.message?.content ?? '';
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sse({ type: 'delta', text })));
          controller.enqueue(encoder.encode(sse({ type: 'done' })));
          controller.close();
        },
      }),
      { headers: streamHeaders() },
    );
  }

  const reader = upstream.body?.getReader();
  if (!reader) return jsonError('上游没有返回内容', 502);

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      let buffer = '';
      const emit = (event: unknown) => controller.enqueue(encoder.encode(sse(event)));

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';

          for (const frame of frames) {
            for (const line of frame.split('\n')) {
              if (!line.startsWith('data:')) continue;
              const raw = line.slice(5).trim();
              if (!raw || raw === '[DONE]') continue;
              try {
                const parsed = JSON.parse(raw) as {
                  choices?: Array<{ delta?: { content?: string | null } }>;
                };
                const delta = parsed.choices?.[0]?.delta?.content;
                if (typeof delta === 'string' && delta.length > 0) {
                  emit({ type: 'delta', text: delta });
                }
              } catch {
                // keep-alive comments and partial frames are ignored
              }
            }
          }
        }
        emit({ type: 'done' });
      } catch (error) {
        emit({
          type: 'error',
          message: error instanceof Error ? error.message : '流式传输中断',
        });
      } finally {
        controller.close();
        void reader.cancel().catch(() => {});
      }
    },
    cancel() {
      void reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, { headers: streamHeaders() });
}

function streamHeaders(): HeadersInit {
  return {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  };
}
