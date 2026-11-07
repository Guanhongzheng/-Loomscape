import type { CursorAction } from './actions';
import type { CreateTab } from '@/lib/create-tabs';

const TOOL_WORDS: Array<[RegExp, CreateTab]> = [
  [/图像|图片|绘图|画图/, 'image'],
  [/视频|影像|剪辑/, 'video'],
  [/声音|音频|语音|朗读/, 'voice'],
  [/故事|分镜/, 'story'],
  [/文本|写作|文字|文章|提纲|文案/, 'text'],
];

function toolIn(text: string): CreateTab | null {
  for (const [pattern, tool] of TOOL_WORDS) if (pattern.test(text)) return tool;
  return null;
}

function pushUnique(actions: CursorAction[], next: CursorAction) {
  const key = JSON.stringify(next);
  if (!actions.some((action) => JSON.stringify(action) === key)) actions.push(next);
}

/**
 * Small, deterministic understanding layer used when neither Gemma nor a
 * configured API model answers. It handles the short Chinese task shapes the
 * cursor advertises, so the input is never a dead end offline.
 */
export function localPlanFor(raw: string): CursorAction[] {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const actions: CursorAction[] = [];
  const parts = text
    .split(/[，,。；;]|然后|接着|并且|再/)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    if (/退出|关闭|恢复鼠标/.test(part)) continue;

    if (/问这页|总结这页|解释这页|看看这页/.test(part)) {
      pushUnique(actions, { action: 'askPage' });
      continue;
    }

    const highlight = part.match(/(?:高亮|标出|找到|定位)\s*(.+)/);
    if (highlight?.[1]) {
      pushUnique(actions, {
        action: 'highlight',
        target: highlight[1].replace(/[。.!！]$/, '').trim().slice(0, 100),
      });
      continue;
    }
    const scroll = part.match(/(?:滚动到|滚到|滚动至)\s*(.+)/);
    if (scroll?.[1]) {
      pushUnique(actions, {
        action: 'scrollTo',
        target: scroll[1].replace(/[。.!！]$/, '').trim().slice(0, 100),
      });
      continue;
    }

    if (/设置/.test(part)) {
      pushUnique(actions, { action: 'openSettings' });
      continue;
    }
    if (/工作台/.test(part) && !/创作/.test(part)) {
      pushUnique(actions, { action: 'openWorkspace' });
      continue;
    }

    const tool = toolIn(part);
    if (tool && /打开|去|进入|切到|切换|创作|写/.test(part)) {
      pushUnique(actions, { action: 'openTool', tool });
    }

    const fill = part.match(
      /(?:帮我|请)?(?:写|填写|填入|输入|起草|生成)(?:一个|一段|一下|关于)?\s*(.+)/,
    );
    const value = fill?.[1]?.replace(/^[:：]\s*/, '').trim();
    if (value && value.length > 1 && !/^(文本|图像|图片|视频|声音|故事|创作)$/.test(value)) {
      pushUnique(actions, { action: 'fillPrompt', value: value.slice(0, 800) });
      if (!actions.some((action) => action.action === 'openTool')) {
        pushUnique(actions, { action: 'openTool', tool: tool ?? 'text' });
        actions.sort((a, b) => (a.action === 'openTool' ? -1 : b.action === 'openTool' ? 1 : 0));
      }
    }
  }

  return actions.slice(0, 5);
}
