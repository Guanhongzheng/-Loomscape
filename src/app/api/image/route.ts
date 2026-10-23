import type { NextRequest } from 'next/server';
import { assertPublicUrl, jsonError, originAllowed, resolve } from '@/lib/server/upstream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ImageResult = { dataUrl?: string; url?: string };

export async function POST(request: NextRequest) {
  if (!originAllowed(request)) return jsonError('来源不被允许', 403);

  const body = (await request.json().catch(() => null)) as
    | {
        prompt?: string;
        size?: string;
        aspect?: string;
        count?: number;
        baseUrl?: string;
        apiKey?: string;
        model?: string;
        shape?: string;
      }
    | null;

  if (!body) return jsonError('请求体不是合法 JSON');

  const prompt = (body.prompt ?? '').trim().slice(0, 1600);
  if (prompt.length < 2) return jsonError('提示词太短');

  const config = resolve('image', body);
  if (!config) return jsonError('尚未配置图像端点', 412);

  const count = Math.min(Math.max(Number(body.count) || 1, 1), 4);
  const size = /^\d{3,4}x\d{3,4}$/.test(body.size ?? '') ? (body.size as string) : '1024x1024';
  const aspect = body.aspect && /^\d{1,2}:\d{1,2}$/.test(body.aspect) ? body.aspect : '1:1';

  try {
    assertPublicUrl(config.baseUrl);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : '端点不可用', 400);
  }

  try {
    const images =
      body.shape === 'stability'
        ? await stability(config, prompt, aspect, count)
        : await openaiImages(config, prompt, size, count);
    if (!images.length) return jsonError('上游没有返回图片', 502);
    return Response.json({ images });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : '生成失败', 502);
  }
}

async function openaiImages(
  config: { baseUrl: string; apiKey: string; model: string },
  prompt: string,
  size: string,
  count: number,
): Promise<ImageResult[]> {
  const response = await fetch(`${config.baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model: config.model, prompt, n: count, size }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(readError(detail) ?? `上游返回 ${response.status}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };

  const mapped: Array<ImageResult | null> = (payload.data ?? []).map((item): ImageResult | null => {
    if (item.b64_json) return { dataUrl: `data:image/png;base64,${item.b64_json}` };
    if (item.url) return { url: item.url };
    return null;
  });

  return mapped.filter((item): item is ImageResult => item !== null);
}

async function stability(
  config: { baseUrl: string; apiKey: string; model: string },
  prompt: string,
  aspect: string,
  count: number,
): Promise<ImageResult[]> {
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('model', config.model);
  form.append('aspect_ratio', aspect);
  form.append('output_format', 'png');

  const results: ImageResult[] = [];
  for (let i = 0; i < count; i += 1) {
    const response = await fetch(`${config.baseUrl}/v2beta/stable-image/generate/sd3`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        accept: 'application/json',
      },
      body: form,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(readError(detail) ?? `上游返回 ${response.status}`);
    }

    const payload = (await response.json()) as { image?: string };
    if (payload.image) results.push({ dataUrl: `data:image/png;base64,${payload.image}` });
  }

  return results;
}

function readError(detail: string): string | null {
  if (!detail) return null;
  try {
    const parsed = JSON.parse(detail) as { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === 'string') return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
    if (parsed.message) return parsed.message;
  } catch {
    return detail.slice(0, 240);
  }
  return null;
}
