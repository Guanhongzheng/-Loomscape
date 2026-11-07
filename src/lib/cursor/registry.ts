import type { CreateTab } from '@/lib/create-tabs';
import type { CursorAction } from './actions';
import { TOOL_HREF } from './actions';

export type CursorExecutionContext = {
  navigate: (href: string) => Promise<void>;
  switchTab: (tab: CreateTab) => Promise<boolean>;
  fillPrompt: (value: string) => Promise<boolean>;
  highlight: (target: string) => boolean;
  scrollTo: (target: string) => boolean;
  askPage: () => void;
};

export type CursorExecutionResult = {
  ok: boolean;
  completed: number;
  error?: string;
};

/**
 * The Week 1 action registry. The model and the local menu both feed through
 * this function; only declarative, whitelisted actions reach the page.
 */
export async function runCursorActions(
  actions: CursorAction[],
  context: CursorExecutionContext,
  onStep?: (completed: number, total: number, action: CursorAction) => void,
): Promise<CursorExecutionResult> {
  let completed = 0;
  for (const action of actions) {
    try {
      switch (action.action) {
        case 'openTool':
          await context.navigate(TOOL_HREF[action.tool]);
          break;
        case 'switchTab':
          if (!(await context.switchTab(action.tool))) {
            return { ok: false, completed, error: `没有找到「${action.tool}」工具页` };
          }
          break;
        case 'navigate':
          await context.navigate(action.path);
          break;
        case 'openSettings':
          await context.navigate('/studio/settings');
          break;
        case 'openWorkspace':
          await context.navigate('/studio');
          break;
        case 'fillPrompt':
          if (!(await context.fillPrompt(action.value))) {
            return { ok: false, completed, error: '当前页面没有可填写的创作提示词' };
          }
          break;
        case 'highlight':
          if (!context.highlight(action.target)) {
            return { ok: false, completed, error: `没有找到「${action.target}」` };
          }
          break;
        case 'scrollTo':
          if (!context.scrollTo(action.target)) {
            return { ok: false, completed, error: `没有找到「${action.target}」` };
          }
          break;
        case 'askPage':
          context.askPage();
          break;
        default:
          return { ok: false, completed, error: '不支持的动作' };
      }
      completed += 1;
      onStep?.(completed, actions.length, action);
    } catch (error) {
      return {
        ok: false,
        completed,
        error: error instanceof Error ? error.message : '动作执行失败',
      };
    }
  }
  return { ok: true, completed };
}
