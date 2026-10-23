import type { NextRequest } from 'next/server';
import { assertPublicUrl, jsonError, originAllowed, resolve } from '@/lib/server/upstream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 24 * 1024 * 1024;

export async function POST(request: NextRequest) {
  if (!originAllowed(request)) return jsonError('来源不被允许', 403);

  const form = await request.formData().catch(() => null);
  if (!form) return jsonError('请求体必须是 multipart/form-data');

  const file = form.get('file');
  if (!(file instanceof File)) return jsonError('缺少音频文件');
  if (file.size > MAX_BYTES) return jsonError('音频超过 24MB', 413);

  const config = resolve('speech', {
    baseUrl: String(form.get('baseUrl') ?? ''),
    apiKey: String(form.get('apiKey') ?? ''),
    model: String(form.get('model') ?? ''),
  });
  if (!config) return jsonError('尚未配置语音端点', 412);

  try {
    assertPublicUrl(config.baseUrl);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : '端点不可用', 400);
  }

  const upstreamForm = new FormData();
  upstreamForm.append('file', file, file.name || 'audio.webm');
  upstreamForm.append('model', config.model);
  upstreamForm.append('response_format', 'json');

  const response = await fetch(`${config.baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.apiKey}` },
    body: upstreamForm,
  }).catch((error: unknown) => {
    throw new Error(error instanceof Error ? error.message : '无法连接上游服务');
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return jsonError(detail.slice(0, 240) || `上游返回 ${response.status}`, 502);
  }

  const payload = (await response.json()) as { text?: string };
  return Response.json({ text: payload.text ?? '' });
}
