import { chunkText } from '@/lib/rag';
import { measureText } from '@/lib/text-metrics';
import { titleVariants } from '@/lib/title-variants';
import { localPlanFor } from '@/lib/cursor/local-plan';
import type { McpTool } from './protocol';

/**
 * Four pure functions, no user data. Descriptions are written as "call me when",
 * because that sentence is the only thing the model sees when it picks a tool.
 */
export const TOOLS: McpTool[] = [
  {
    name: 'chunk_text',
    description:
      '把长文切成带编号的片段。当用户要把一篇文章拆成分镜、分段朗读或建立检索条目时调用。返回每段的序号、字数与起止位置。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '需要切分的正文' },
        size: { type: 'number', description: '每段目标字数，默认 420' },
        overlap: { type: 'number', description: '相邻段重叠字数，默认 60' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'measure_text',
    description:
      '统计字数、段落数、最长句长度与预计朗读秒数。当用户要求控制篇幅、判断是否超字数或估算朗读时长时调用。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '需要测量的正文' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'title_variants',
    description:
      '围绕一个主题生成若干中文标题备选。当用户要给作品、章节或卡片命名、或明确要"几个标题"时调用。',
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: '主题或内容摘要，最多取前 18 字' },
        count: { type: 'number', description: '需要几个备选，1–5，默认 3' },
      },
      required: ['subject'],
      additionalProperties: false,
    },
  },
  {
    name: 'plan_cursor_actions',
    description:
      '把一句自然语言拆成工作台里的可执行动作（打开工具、切标签、填提示词、滚动、高亮）。当用户说"帮我打开/切到/填好"这类操作指令时调用。',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '用户的原始指令' },
      },
      required: ['task'],
      additionalProperties: false,
    },
  },
];

type Args = Record<string, unknown>;

const str = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);

export async function runTool(name: string, args: Args): Promise<unknown> {
  switch (name) {
    case 'chunk_text': {
      const text = str(args.text);
      if (!text.trim()) throw new Error('text 不能为空');
      const size = typeof args.size === 'number' ? args.size : undefined;
      const overlap = typeof args.overlap === 'number' ? args.overlap : undefined;
      const chunks = chunkText(text, { size, overlap });
      return {
        count: chunks.length,
        characters: text.replace(/\s/g, '').length,
        chunks,
      };
    }

    case 'measure_text': {
      const text = str(args.text);
      if (!text.trim()) throw new Error('text 不能为空');
      return measureText(text);
    }

    case 'title_variants': {
      const subject = str(args.subject);
      if (!subject.trim()) throw new Error('subject 不能为空');
      const count = typeof args.count === 'number' ? args.count : 3;
      return titleVariants(subject, count);
    }

    case 'plan_cursor_actions': {
      const task = str(args.task);
      if (!task.trim()) throw new Error('task 不能为空');
      const actions = localPlanFor(task);
      return { steps: actions.length, actions };
    }

    default:
      throw new Error(`未知工具：${name}`);
  }
}

export function findTool(name: string): McpTool | undefined {
  return TOOLS.find((tool) => tool.name === name);
}
