import { describe, expect, it } from 'vitest';
import { localPlanFor } from './local-plan';

describe('local cursor understanding', () => {
  it('opens a tool and fills a requested prompt', () => {
    expect(localPlanFor('打开文本创作，写一个城市夜晚的提纲')).toEqual([
      { action: 'openTool', tool: 'text' },
      { action: 'fillPrompt', value: '城市夜晚的提纲' },
    ]);
  });

  it('understands highlight and scroll language', () => {
    expect(localPlanFor('高亮标题，然后滚动到工作台')).toEqual([
      { action: 'highlight', target: '标题' },
      { action: 'scrollTo', target: '工作台' },
    ]);
  });

  it('routes settings and workspace', () => {
    expect(localPlanFor('打开设置')).toEqual([{ action: 'openSettings' }]);
    expect(localPlanFor('回到工作台')).toEqual([{ action: 'openWorkspace' }]);
  });

  it('does not invent a prompt from a bare navigation command', () => {
    expect(localPlanFor('打开文本创作')).toEqual([{ action: 'openTool', tool: 'text' }]);
    expect(localPlanFor('今天天气怎么样')).toEqual([]);
  });
});
