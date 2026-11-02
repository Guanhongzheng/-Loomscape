import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SchedulingCard } from '@/components/studio/scheduling-card';

/**
 * The card is the only place the three profiles are discoverable, so a
 * rendering regression here silently removes a feature. Server rendering is
 * enough: the presets and the labels are static, only the numbers depend on
 * state.
 */
describe('SchedulingCard', () => {
  const html = renderToStaticMarkup(createElement(SchedulingCard));

  it('offers all three profiles', () => {
    expect(html).toContain('调度策略');
    expect(html).toContain('均衡');
    expect(html).toContain('省内存');
    expect(html).toContain('高吞吐');
  });

  it('shows the knobs a profile actually changes', () => {
    expect(html).toContain('线程');
    expect(html).toContain('权重精度');
    expect(html).toContain('每池会话');
  });

  it('shows both memory pools with their ceilings', () => {
    expect(html).toContain('WASM');
    expect(html).toContain('显存');
    expect(html).toMatch(/GB/);
  });
});
