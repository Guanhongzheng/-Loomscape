import type { NextRequest } from 'next/server';
import { generateText } from 'ai';
import { assertPublicUrl, jsonError, originAllowed, resolve } from '@/lib/server/upstream';
import { buildLanguageModel } from '@/lib/server/model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Minimal round trip used by the settings panel to verify a key. */
export async function POST(request: NextRequest) {
  if (!originAllowed(request)) return jsonError('来源不被允许', 403);

  const body = (await request.json().catch(() => null)) as
    | { baseUrl?: string; apiKey?: string; model?: string; wire?: string }
    | null;

  if (!body) return jsonError('请求体不是合法 JSON');

  const config = resolve('text', body);
  if (!config) return jsonError('尚未配置文本端点', 412);

  try {
    assertPublicUrl(config.baseUrl);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : '端点不可用', 400);
  }

  try {
    const { text } = await generateText({
      model: buildLanguageModel({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        wire: body.wire,
      }),
      prompt: '只回复两个字：可用',
      maxTokens: 16,
      temperature: 0,
    });
    return Response.json({ text: text.trim() });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : '连接失败', 502);
  }
}
