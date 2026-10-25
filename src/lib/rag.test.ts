import { describe, expect, it } from 'vitest';
import { chunkText, systemPrompt, composeRagContext, usedCitations } from '@/lib/rag';

const paragraph = (seed: string, length = 160) => `${seed}。${'这是一段测试内容，用来验证分块边界。'.repeat(Math.ceil(length / 18)).slice(0, length)}`;

describe('chunkText', () => {
  it('returns nothing for blank input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  ')).toEqual([]);
  });

  it('keeps a short document in one chunk', () => {
    const chunks = chunkText('只营业到凌晨两点的旧书店，灯是暖的。');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain('旧书店');
    expect(chunks[0].index).toBe(0);
  });

  it('splits long documents into ordered chunks under the ceiling', () => {
    const text = Array.from({ length: 8 }, (_, i) => paragraph(`第 ${i + 1} 节`)).join('\n\n');
    const chunks = chunkText(text, { size: 200, overlap: 40 });

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.map((chunk) => chunk.index)).toEqual(chunks.map((_, i) => i));
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(300);
      expect(chunk.text.trim()).toBe(chunk.text);
    }
  });

  it('carries an overlap across the boundary', () => {
    const first = '甲'.repeat(120);
    const second = '乙'.repeat(120);
    const chunks = chunkText(`${first}\n\n${second}`, { size: 140, overlap: 40 });
    expect(chunks.length).toBe(2);
    expect(chunks[1].text.startsWith('甲')).toBe(true);
    expect(chunks[1].text).toContain('乙');
  });

  it('hard-splits a paragraph with no punctuation', () => {
    const chunks = chunkText('无'.repeat(1200), { size: 300, overlap: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(300);

    // Without an overlap the ceiling is exact; with one, the tail is repeated.
    const overlapped = chunkText('无'.repeat(1200), { size: 300 });
    for (const chunk of overlapped) expect(chunk.text.length).toBeLessThanOrEqual(450);
  });

  it('records spans that cover the source text', () => {
    const chunks = chunkText(paragraph('起点') + '\n\n' + paragraph('终点'), { size: 120 });
    expect(chunks[0].start).toBe(0);
    const last = chunks[chunks.length - 1];
    expect(last.end).toBeGreaterThan(last.start);
  });

  it('normalises windows line endings', () => {
    const chunks = chunkText('第一段\r\n\r\n\r\n第二段');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('第一段\n\n第二段');
  });
});

describe('composeRagContext', () => {
  it('returns an empty string when there is nothing to cite', () => {
    expect(composeRagContext([])).toBe('');
  });

  it('numbers sources and asks for inline markers', () => {
    const context = composeRagContext([
      { order: 1, text: '书架的木头是旧的。', title: '品牌手册', chunk: 0, total: 3 },
      { order: 2, text: '夜里只开三盏灯。' },
    ]);

    expect(context).toContain('[1] 《品牌手册》 片段 1/3');
    expect(context).toContain('[2] 记忆');
    expect(context).toContain('标注它的编号');
  });

  it('stops before the character budget', () => {
    const sources = Array.from({ length: 10 }, (_, i) => ({
      order: i + 1,
      text: '内容'.repeat(200),
    }));
    const context = composeRagContext(sources, 600);
    expect(context.length).toBeLessThan(1400);
    expect(context).not.toContain('[10]');
  });
});

describe('usedCitations', () => {
  it('keeps only markers that point at a supplied source', () => {
    expect(usedCitations('开头 [1]，中间 [2]，越界 [9]。', 2)).toEqual([1, 2]);
  });

  it('deduplicates repeated markers', () => {
    expect(usedCitations('重复 [2] 和 [2]，还有 [1]', 3)).toEqual([1, 2]);
  });

  it('ignores unrelated brackets', () => {
    expect(usedCitations('他没有引用任何资料（见附录）[x]', 3)).toEqual([]);
  });

  it('handles an answer with no markers', () => {
    expect(usedCitations('一句普通的话。', 4)).toEqual([]);
  });
});

describe('systemPrompt', () => {
  it('uses the plain assistant prompt when nothing was retrieved', () => {
    const prompt = systemPrompt('');
    // Talking about "fragments" with an empty knowledge base is what made the
    // model answer a different question.
    expect(prompt).not.toContain('片段');
  });

  it('has a compact variant for on-device models', () => {
    const prompt = systemPrompt('', true);
    expect(prompt.length).toBeLessThan(60);
    expect(prompt).not.toContain('创作助理');

    const withContext = systemPrompt('[1] 《笔记》：夜里十点开门', true);
    expect(withContext).toContain('参考资料');
    expect(withContext).toContain('夜里十点开门');
  });

  it('appends the retrieved context when there is some', () => {
    const prompt = systemPrompt('[1] 《笔记》：夜里十点开门');
    expect(prompt).toContain('片段');
    expect(prompt).toContain('夜里十点开门');
  });
});
