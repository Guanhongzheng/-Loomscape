import { describe, expect, it } from 'vitest';
import { draftToText, offlineDraft, subjectOf } from '@/lib/demo';

describe('subjectOf', () => {
  it('strips the instruction wrapper', () => {
    const subject = subjectOf('为一家只在夜里营业的旧书店写一段开业预告，语气克制');
    expect(subject).toContain('旧书店');
    expect(subject).not.toContain('写一段');
    expect(subject).not.toContain('语气');
  });

  it('falls back to a placeholder for empty input', () => {
    expect(subjectOf('')).toBe('未命名主题');
  });

  it('never returns more than twelve characters', () => {
    expect(subjectOf('把一段非常非常长的描述写成一篇足够长的文章').length).toBeLessThanOrEqual(12);
  });

  it('keeps a bare subject untouched', () => {
    expect(subjectOf('雨夜')).toBe('雨夜');
  });
});

describe('offlineDraft', () => {
  const brief = '为一家只在夜里营业的旧书店写一段开业预告';

  it('is deterministic for the same brief and tone', () => {
    expect(offlineDraft(brief, '克制')).toEqual(offlineDraft(brief, '克制'));
  });

  it('changes the headline when the tone changes', () => {
    const plain = offlineDraft(brief, '克制');
    const sharp = offlineDraft(brief, '锋利');
    expect(plain.headline).not.toBe(sharp.headline);
  });

  it('marks itself as an offline draft', () => {
    const draft = offlineDraft(brief);
    expect(draft.offline).toBe(true);
    expect(draft.sections.length).toBeGreaterThanOrEqual(3);
    expect(draft.variants).toHaveLength(3);
  });

  it('does not paste the raw instruction into the body', () => {
    const draft = offlineDraft(brief, '克制');
    const body = draft.sections.map((section) => section.body).join('\n');
    expect(body).not.toContain(brief);
    expect(body).not.toContain('写一段');
  });

  it('renders markdown with the variants section', () => {
    const text = draftToText(offlineDraft(brief, '明亮'));
    expect(text).toContain('## 语气备选');
    expect(text.split('\n').filter((line) => line.startsWith('## ')).length).toBeGreaterThan(2);
  });
});
