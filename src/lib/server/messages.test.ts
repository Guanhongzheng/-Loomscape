import { describe, expect, it } from 'vitest';
import { sanitiseMessages } from '@/lib/server/messages';

describe('sanitiseMessages', () => {
  it('reads text from parts when content is an empty string', () => {
    // v5 messages carry `content: ''` plus a parts array. Preferring `content`
    // dropped the turn entirely, so the model lost its own previous answer.
    const rows = sanitiseMessages([
      { role: 'user', content: '第一问', parts: [] },
      { role: 'assistant', content: '', parts: [{ type: 'text', text: '第一答' }] },
      { role: 'user', content: '第二问', parts: [] },
    ]);
    expect(rows).toEqual([
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答' },
      { role: 'user', content: '第二问' },
    ]);
  });

  it('drops tool plumbing instead of relabelling it as user speech', () => {
    const rows = sanitiseMessages([
      { role: 'user', content: '查一下字数' },
      { role: 'tool', content: '{"characters":12}' },
      { role: 'assistant', content: '一共十二个字。' },
    ]);
    expect(rows.map((row) => row.role)).toEqual(['user', 'assistant']);
    expect(rows.some((row) => row.content.includes('characters'))).toBe(false);
  });

  it('collapses a duplicated turn so the model does not answer its echo', () => {
    const rows = sanitiseMessages([
      { role: 'user', content: '写一句开场' },
      { role: 'user', content: '写一句开场' },
      { role: 'assistant', content: '夜里十点，灯先亮了。' },
    ]);
    expect(rows).toHaveLength(2);
  });

  it('keeps genuinely repeated user turns apart when the assistant replied between', () => {
    const rows = sanitiseMessages([
      { role: 'user', content: '再来一句' },
      { role: 'assistant', content: '第一句。' },
      { role: 'user', content: '再来一句' },
    ]);
    expect(rows).toHaveLength(3);
  });

  it('ignores blank turns and non-array input', () => {
    expect(sanitiseMessages(null)).toEqual([]);
    expect(sanitiseMessages([{ role: 'user', content: '   ' }])).toEqual([]);
  });

  it('keeps only the most recent turns', () => {
    const rows = sanitiseMessages(
      Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `第${i}句` })),
    );
    expect(rows).toHaveLength(24);
    expect(rows[rows.length - 1].content).toBe('第39句');
  });
});
