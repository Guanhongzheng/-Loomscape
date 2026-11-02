import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Transcript } from '@/app/studio/chat/transcript';
import { KnowledgePanel } from '@/app/studio/chat/knowledge-panel';
import type { Turn } from '@/app/studio/chat/parts';
import type { DocumentSummary } from '@/lib/memory';

/**
 * These render the components to a string instead of mounting them. That needs
 * no jsdom and no testing library, and it still catches the regressions this
 * file exists for: a missing empty state, a bubble that forgets its sources,
 * a skeleton that leaks into a finished answer.
 */

const turn = (patch: Partial<Turn>): Turn => ({
  id: 't1',
  role: 'assistant',
  text: '',
  at: Date.UTC(2026, 10, 2, 12, 0, 0),
  ...patch,
});

const render = (turns: Turn[], extra: Partial<Parameters<typeof Transcript>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(Transcript, {
      turns,
      busy: false,
      bottomRef: createRef<HTMLDivElement>(),
      onSuggestion: () => undefined,
      ...extra,
    }),
  );

describe('Transcript', () => {
  it('shows the suggestions when there is nothing to read', () => {
    const html = render([]);
    expect(html).toContain('问点什么');
    expect(html).toContain('知识库里关于光线的描述');
  });

  it('renders a finished answer without the skeleton', () => {
    const html = render([turn({ text: '这是一段回答。' })]);
    expect(html).toContain('这是一段回答');
    expect(html).not.toContain('skeleton');
    expect(html).toContain('ai sdk stream');
  });

  it('keeps the skeleton for an answer that has not started', () => {
    const html = render([turn({})]);
    expect(html).toContain('skeleton');
  });

  it('marks the mode the turn actually used', () => {
    expect(render([turn({ text: '答', mode: 'retrieval' })])).toContain('retrieval only');
    expect(render([turn({ text: '2 + 2 = 4', mode: 'calc' })])).toContain('calculator');
    expect(render([turn({ text: '答', mode: 'local' })])).toContain('local runtime');
  });

  it('keeps a source list with the answer that cited it', () => {
    const hit = { record: { id: 'm1', text: '光的描述', source: undefined } } as never;
    const html = render([turn({ text: '见 [1]', sources: [hit] })]);
    expect(html).toContain('1 条来源');
    expect(html).toContain('[1]');
  });

  it('shows the failure text instead of an empty transcript', () => {
    const html = render([turn({ text: '答' })], { error: new Error('请求失败') });
    expect(html).toContain('请求失败');
  });
});

const doc = (patch: Partial<DocumentSummary> = {}): DocumentSummary =>
  ({ docId: 'd1', title: '品牌手册', chunks: 3, chars: 1200, ...patch }) as DocumentSummary;

describe('KnowledgePanel', () => {
  const base = {
    title: '',
    onTitle: () => undefined,
    note: '',
    onNote: () => undefined,
    importing: false,
    onImport: () => undefined,
    rag: true,
    onRag: () => undefined,
    docs: [] as DocumentSummary[],
    onDrop: () => undefined,
  };

  it('explains the empty state instead of showing an empty list', () => {
    const html = renderToStaticMarkup(createElement(KnowledgePanel, base));
    expect(html).toContain('还没有资料');
    expect(html).toContain('入库');
    expect(html).toContain('回答前先检索');
  });

  it('lists what is already retrievable, with its size', () => {
    const html = renderToStaticMarkup(
      createElement(KnowledgePanel, { ...base, docs: [doc()] }),
    );
    expect(html).toContain('品牌手册');
    expect(html).toContain('3 段');
    expect(html).toContain('移除 品牌手册');
  });
});
