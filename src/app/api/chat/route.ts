import type { NextRequest } from 'next/server';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import { assertPublicUrl, jsonError, originAllowed, resolve } from '@/lib/server/upstream';
import { buildLanguageModel } from '@/lib/server/model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Incoming = { role: 'user' | 'assistant' | 'system'; content: string };

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

function sanitise(input: unknown): Incoming[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as {
        role?: string;
        content?: string;
        parts?: Array<{ type?: string; text?: string }>;
      };
      const role = row.role === 'system' || row.role === 'assistant' ? row.role : 'user';
      const fromParts = (row.parts ?? [])
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('');
      const content = (row.content ?? fromParts ?? '').trim();
      if (!content) return null;
      return { role, content: content.slice(0, 24_000) } as Incoming;
    })
    .filter((row): row is Incoming => row !== null)
    .slice(-24);
}

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
      }
    | null;

  if (!body) return jsonError('请求体不是合法 JSON');

  const messages = sanitise(body.messages);
  if (messages.length === 0) return jsonError('缺少 messages');

  const config = resolve('text', body);
  if (!config) return jsonError('尚未配置文本端点', 412);

  try {
    assertPublicUrl(config.baseUrl);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : '端点不可用', 400);
  }

  const model = buildLanguageModel({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
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
        execute: async ({ text }) => {
          const paragraphs = text.split(/\n+/).filter((line) => line.trim().length > 0);
          const sentences = text.split(/[。！？!?；;]/).filter((line) => line.trim().length > 0);
          const longest = sentences.reduce((max, line) => Math.max(max, line.trim().length), 0);
          return {
            characters: text.replace(/\s/g, '').length,
            paragraphs: paragraphs.length,
            longestSentence: longest,
            readSeconds: Math.round((text.length / 5.2) * 10) / 10,
          };
        },
      }),
      title_variants: tool({
        description: '围绕一个主题给出若干标题备选，用于命名作品或章节。',
        parameters: z.object({
          subject: z.string().describe('主题或内容摘要'),
          count: z.number().min(1).max(5).optional().describe('需要几个备选，默认 3'),
        }),
        execute: async ({ subject, count }) => {
          const total = count ?? 3;
          const clean = subject.trim().slice(0, 18) || '未命名';
          const patterns = [
            (s: string) => `${s}，以及它留下的痕迹`,
            (s: string) => `关于${s}的第二次说明`,
            (s: string) => `${s}：一份不合时宜的记录`,
            (s: string) => `在${s}结束之前`,
            (s: string) => `${s}的另一种用法`,
          ];
          return { subject: clean, titles: patterns.slice(0, total).map((fn) => fn(clean)) };
        },
      }),
    },
  });

  return result.toDataStreamResponse({
    headers: { 'cache-control': 'no-store' },
    getErrorMessage: (error) => (error instanceof Error ? error.message : '生成失败'),
  });
}
