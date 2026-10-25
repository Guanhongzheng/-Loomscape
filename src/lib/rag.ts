/**
 * Chunking and prompt assembly for retrieval augmented generation.
 *
 * Kept free of browser APIs so the behaviour can be tested directly: the
 * storage side lives in `memory.ts`, and this module only decides how a long
 * document is cut up, how the retrieved passages are presented to a model, and
 * which markers in an answer actually point at a passage.
 */

export type Chunk = {
  index: number;
  text: string;
  start: number;
  end: number;
};

export type ChunkOptions = {
  /** Soft ceiling for one chunk, in characters. */
  size?: number;
  /** Characters repeated from the end of the previous chunk. */
  overlap?: number;
};

const SENTENCE_END = /[。！？!?；;\n]/;

function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Splits an over-long paragraph on sentence boundaries, then hard-cuts. */
function splitLong(paragraph: string, size: number): string[] {
  const pieces: string[] = [];
  let buffer = '';

  const push = () => {
    if (buffer.trim()) pieces.push(buffer.trim());
    buffer = '';
  };

  for (const char of paragraph) {
    buffer += char;
    const longEnough = buffer.length >= size;
    const atBreak = SENTENCE_END.test(char) && buffer.length >= size * 0.5;
    if (longEnough || atBreak) push();
  }
  push();

  // A single sentence can still exceed the ceiling (no punctuation at all).
  const output: string[] = [];
  for (const piece of pieces) {
    if (piece.length <= size * 1.5) {
      output.push(piece);
      continue;
    }
    for (let i = 0; i < piece.length; i += size) {
      output.push(piece.slice(i, i + size));
    }
  }
  return output;
}

/**
 * Paragraph-first chunking with a small overlap. Paragraphs keep their
 * meaning, which matters more for retrieval than an exact character budget.
 */
export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  const size = Math.max(80, options.size ?? 420);
  const overlap = Math.min(Math.max(options.overlap ?? 60, 0), Math.floor(size / 3));
  const source = normalise(text);
  if (!source) return [];

  const paragraphs = source.split(/\n{2,}/).flatMap((paragraph) =>
    paragraph.length > size ? splitLong(paragraph, size) : [paragraph],
  );

  const chunks: Chunk[] = [];
  let buffer = '';
  let cursor = 0;
  let start = 0;

  const flush = () => {
    const body = buffer.trim();
    if (!body) return;
    chunks.push({ index: chunks.length, text: body, start, end: start + body.length });
    cursor = start + body.length;
  };

  for (const paragraph of paragraphs) {
    const clean = paragraph.trim();
    if (!clean) continue;

    if (!buffer) {
      buffer = clean;
      start = cursor;
    } else if (buffer.length + clean.length + 2 <= size) {
      buffer += `\n\n${clean}`;
    } else {
      flush();
      const tail = overlap > 0 ? buffer.slice(-overlap) : '';
      buffer = tail ? `${tail}\n\n${clean}` : clean;
      start = Math.max(cursor - tail.length, 0);
    }
  }
  flush();

  return chunks;
}

export type RagSource = {
  /** 1-based number used in the answer markers. */
  order: number;
  text: string;
  title?: string;
  chunk?: number;
  total?: number;
  score?: number;
};

export function composeRagContext(sources: RagSource[], budget = 2400): string {
  if (!sources.length) return '';

  const lines: string[] = [];
  let used = 0;

  for (const source of sources) {
    const label = source.title ? `《${source.title}》` : '记忆';
    const position =
      source.chunk !== undefined && source.total !== undefined
        ? ` 片段 ${source.chunk + 1}/${source.total}`
        : '';
    const snippet = source.text.replace(/\s+/g, ' ').trim().slice(0, 600);
    const line = `[${source.order}] ${label}${position}：${snippet}`;
    if (used + line.length > budget) break;
    used += line.length;
    lines.push(line);
  }

  if (!lines.length) return '';

  return [
    '以下是从这个人本地知识库检索到的片段，按相关度排序。',
    '回答时若引用了某条，在句末标注它的编号，例如 [1]；没有用到的不要标注，也不要编造编号。',
    ...lines,
  ].join('\n');
}

/** Numbers in brackets that actually correspond to a supplied source. */
export function usedCitations(answer: string, count: number): number[] {
  const found = new Set<number>();
  const pattern = /\[(\d{1,2})\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(answer)) !== null) {
    const value = Number(match[1]);
    if (value >= 1 && value <= count) found.add(value);
  }
  return Array.from(found).sort((a, b) => a - b);
}

/** Used when nothing was retrieved: talking about "fragments" would be a lie. */
export const ASSISTANT_PROMPT =
  '你是一位中文创作助理。直接回答用户的问题，必要时先确认你理解到的意图；' +
  '不确定的信息就说不知道，不要编造。语气克制，不复述问题，不写开场白，不要重复已经说过的话。';

export const RAG_SYSTEM_PROMPT =
  '你是一位中文创作助理。下面的片段只是参考，不是必须使用的内容；' +
  '片段与问题无关时直接忽略，用自己的话回答，不要为了用上片段而牵强附会。' +
  '确实引用了某条片段时，在句末标注它的编号，例如 [2]；没有引用就不要标注。' +
  '语气克制，不复述问题，不写开场白，不要重复已经说过的话。';

/** Picks the system prompt that matches whether retrieval produced anything. */
export function systemPrompt(context: string): string {
  return context.trim() ? `${RAG_SYSTEM_PROMPT}\n\n${context}` : ASSISTANT_PROMPT;
}
