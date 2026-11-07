import { describe, expect, it } from 'vitest';
import { isCursorAction, sanitiseCursorPlan } from './actions';
import { runCursorActions, type CursorExecutionContext } from './registry';

describe('cursor action protocol', () => {
  it('accepts the six Week 1 shapes', () => {
    expect(isCursorAction({ action: 'openTool', tool: 'text' })).toBe(true);
    expect(isCursorAction({ action: 'switchTab', tool: 'image' })).toBe(true);
    expect(isCursorAction({ action: 'fillPrompt', value: '城市夜晚' })).toBe(true);
    expect(isCursorAction({ action: 'highlight', target: '标题' })).toBe(true);
    expect(isCursorAction({ action: 'scrollTo', target: '工作台' })).toBe(true);
    expect(isCursorAction({ action: 'openSettings' })).toBe(true);
  });

  it('rejects scripts, external URLs and unknown tools', () => {
    expect(isCursorAction({ action: 'openTool', tool: 'terminal' })).toBe(false);
    expect(isCursorAction({ action: 'navigate', path: 'https://evil.example' })).toBe(false);
    expect(isCursorAction({ action: 'navigate', path: '//evil.example' })).toBe(false);
    expect(isCursorAction({ action: 'fillPrompt', value: '' })).toBe(false);
    expect(isCursorAction({ action: 'runScript', value: 'alert(1)' })).toBe(false);
  });

  it('limits model plans to five valid steps', () => {
    const plan = sanitiseCursorPlan({
      steps: [
        { action: 'openTool', tool: 'text' },
        { action: 'fillPrompt', value: '提纲' },
        { action: 'navigate', path: 'https://evil.example' },
        { action: 'askPage' },
        { action: 'askPage' },
        { action: 'askPage' },
        { action: 'askPage' },
      ],
    });
    expect(plan).toHaveLength(5);
    expect(plan.map((step) => step.action)).toEqual([
      'openTool',
      'fillPrompt',
      'askPage',
      'askPage',
      'askPage',
    ]);
  });

  it('executes in order and stops on failure', async () => {
    const calls: string[] = [];
    const context: CursorExecutionContext = {
      navigate: async (href) => {
        calls.push(`navigate:${href}`);
      },
      switchTab: async (tool) => {
        calls.push(`tab:${tool}`);
        return true;
      },
      fillPrompt: async (value) => {
        calls.push(`fill:${value}`);
        return value !== '失败';
      },
      highlight: () => true,
      scrollTo: () => true,
      askPage: () => calls.push('ask'),
    };

    const result = await runCursorActions(
      [
        { action: 'openTool', tool: 'text' },
        { action: 'fillPrompt', value: '城市夜晚' },
        { action: 'askPage' },
      ],
      context,
      (done, total, action) => calls.push(`step:${done}/${total}:${action.action}`),
    );
    expect(result).toEqual({ ok: true, completed: 3 });
    expect(calls).toEqual([
      'navigate:/studio/create?tab=text',
      'step:1/3:openTool',
      'fill:城市夜晚',
      'step:2/3:fillPrompt',
      'ask',
      'step:3/3:askPage',
    ]);

    const failed = await runCursorActions(
      [
        { action: 'fillPrompt', value: '失败' },
        { action: 'askPage' },
      ],
      context,
    );
    expect(failed.ok).toBe(false);
    expect(failed.completed).toBe(0);
  });
});
