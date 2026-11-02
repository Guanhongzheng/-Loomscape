import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Composer } from '@/app/studio/chat/composer';

const base = {
  value: '',
  onChange: () => undefined,
  onSend: () => undefined,
  onStop: () => undefined,
  busy: false,
  engineLabel: '本地 · Qwen3 0.6B',
  ragLabel: '哈希',
  localMode: false,
};

const render = (patch: Partial<typeof base> = {}) =>
  renderToStaticMarkup(createElement(Composer, { ...base, ...patch }));

describe('Composer', () => {
  it('does not offer to send an empty message', () => {
    expect(render()).toContain('aria-label="发送"');
    expect(render()).toMatch(/disabled/);
    expect(render({ value: '写一段开场' })).not.toMatch(/aria-label="发送"[^>]*disabled/);
  });

  it('turns the send button into stop while an answer streams', () => {
    const html = render({ busy: true, value: '问' });
    expect(html).not.toContain('aria-label="发送"');
    // The stop button carries no label, so the icon's path is the marker.
    expect(html).toContain('lucide-square');
  });

  it('states which engine and retrieval path is in use', () => {
    const html = render({ ragLabel: 'BGE Small 中文 · 512 维' });
    expect(html).toContain('本地 · Qwen3 0.6B');
    expect(html).toContain('BGE Small 中文 · 512 维');
    expect(html).not.toContain('端侧模型');
  });

  it('explains the trade-off only when the local model is the engine', () => {
    expect(render({ localMode: true })).toContain('端侧模型');
  });
});
