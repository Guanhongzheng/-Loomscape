import type { NextRequest } from 'next/server';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import { assertPublicUrl, jsonError, originAllowed, resolve } from '@/lib/server/upstream';
import { buildLanguageModel } from '@/lib/server/model';
import { hasImages, sanitiseMessages, type ChatMessage } from '@/lib/server/messages';
import { looksVisionCapable } from '@/lib/providers';
import { measureText } from '@/lib/text-metrics';
import { titleVariants } from '@/lib/title-variants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STYLE_GUIDE: Record<string, string[]> = {
  克制: [
    '先给事实，再给判断；形容词只保留能验证的那些。',
    '句末落在具体名词上，不落在情绪上。',
    '允许句子长短不齐，但不允许为了整齐而加字。',
  ],
  明亮: [
    '让颜色和动作先出现，意义随后跟上。',
    '一段里至多一个比喻，多了会互相削弱。',
    '结尾不要收拢，留一个还在继续的动作。',
  ],
  锋利: [
    '删掉所有铺垫性的第一句，从第二句开始写。',
    '把代价写出来；不写代价的观点只是口号。',
    '允许一个不体面的细节，它比结论可信。',
  ],
};

export async function POST(request: NextRequest) {
  if (!originAllowed(request)) return jsonError('来源不被允许', 403);

  const body = (await request.json().catch(() => null)) as
    | {
        messages?: unknown;
        system?: string;
        temperature?: number;
        maxTokens?: number;
        baseUrl?: string;
        apiKey?: string;
        model?: string;
        wire?: string;
        /** Optional model for turns that carry an image. */
        visionModel?: string;
      }
    | null;

  if (!body) return jsonError('请求体不是合法 JSON');

  const messages: ChatMessage[] = sanitiseMessages(body.messages);
  if (messages.length === 0) return jsonError('缺少 messages');

  const config = resolve('text', body);
  if (!config) return jsonError('尚未配置文本端点', 412);

  try {
    assertPublicUrl(config.baseUrl);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : '端点不可用', 400);
  }

  // Images change which model can answer. The endpoint (baseUrl / key) stays
  // the same: vision is a message shape, not a fifth channel.
  const visionModel = (body.visionModel ?? '').trim();
  const carriesImage = hasImages(messages);
  if (carriesImage && !visionModel && !looksVisionCapable(config.model)) {
    return jsonError('当前文本模型未配置视觉能力，请在设置里填写「视觉模型」。', 412);
  }
  const modelId = carriesImage ? visionModel || config.model : config.model;

  const model = buildLanguageModel({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: modelId,
    wire: body.wire,
  });

  const system =
    (body.system ?? '').trim() ||
    '你是一位中文写作编辑。直接给出可用的文本，不写开场白，不解释创作过程。';

  const result = streamText({
    model,
    system,
    messages,
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
    maxTokens: typeof body.maxTokens === 'number' ? body.maxTokens : 1600,
    maxSteps: 3,
    tools: {
      style_guide: tool({
        description:
          '取出某种语气的写作规则。当用户要求调整语气、或你需要确认该语气的具体写法时调用。',
        parameters: z.object({
          tone: z.enum(['克制', '明亮', '锋利']).describe('语气名称'),
        }),
        execute: async ({ tone }) => ({
          tone,
          rules: STYLE_GUIDE[tone] ?? STYLE_GUIDE.克制,
        }),
      }),
      measure: tool({
        description: '统计一段文字的字数、段落数、最长句长度与预计朗读秒数，用于控制篇幅。',
        parameters: z.object({
          text: z.string().describe('需要测量的正文'),
        }),
        execute: async ({ text }) => measureText(text),
      }),
      title_variants: tool({
        description: '围绕一个主题给出若干标题备选，用于命名作品或章节。',
        parameters: z.object({
          subject: z.string().describe('主题或内容摘要'),
          count: z.number().min(1).max(5).optional().describe('需要几个备选，默认 3'),
        }),
        execute: async ({ subject, count }) => titleVariants(subject, count ?? 3),
      }),
    },
  });

  return result.toDataStreamResponse({
    headers: { 'cache-control': 'no-store' },
    getErrorMessage: (error) => (error instanceof Error ? error.message : '生成失败'),
  });
}
