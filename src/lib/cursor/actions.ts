import { isCreateTab, type CreateTab } from '@/lib/create-tabs';

export const TOOL_HREF: Record<CreateTab, string> = {
  text: '/studio/create?tab=text',
  image: '/studio/create?tab=image',
  video: '/studio/create?tab=video',
  voice: '/studio/create?tab=voice',
  story: '/studio/create?tab=story',
};

export type CursorAction =
  | { action: 'openTool'; tool: CreateTab }
  | { action: 'switchTab'; tool: CreateTab }
  | { action: 'navigate'; path: string }
  | { action: 'openSettings' }
  | { action: 'openWorkspace' }
  | { action: 'fillPrompt'; value: string }
  | { action: 'highlight'; target: string }
  | { action: 'scrollTo'; target: string }
  | { action: 'askPage' };

const SAFE_PATH = /^\/(?!\/)[A-Za-z0-9/_-]*(?:\?[A-Za-z0-9_=&%.-]*)?$/;

export function isCursorAction(value: unknown): value is CursorAction {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  switch (candidate.action) {
    case 'openTool':
    case 'switchTab':
      return typeof candidate.tool === 'string' && isCreateTab(candidate.tool);
    case 'navigate':
      return typeof candidate.path === 'string' && candidate.path.length <= 240 && SAFE_PATH.test(candidate.path);
    case 'openSettings':
    case 'openWorkspace':
    case 'askPage':
      return true;
    case 'fillPrompt':
      return typeof candidate.value === 'string' && candidate.value.trim().length > 0 && candidate.value.length <= 800;
    case 'highlight':
    case 'scrollTo':
      return typeof candidate.target === 'string' && candidate.target.trim().length > 0 && candidate.target.length <= 100;
    default:
      return false;
  }
}

export function sanitiseCursorPlan(value: unknown, maxSteps = 5): CursorAction[] {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { steps?: unknown }).steps)
      ? (value as { steps: unknown[] }).steps
      : [];
  return raw.filter(isCursorAction).slice(0, maxSteps);
}

const TOOL_LABEL: Record<CreateTab, string> = {
  text: '文本创作',
  image: '图像创作',
  video: '视频创作',
  voice: '声音创作',
  story: '故事创作',
};

export function describeCursorPlan(steps: CursorAction[]): string {
  const parts = steps.map((step) => {
    switch (step.action) {
      case 'openTool':
        return `打开${TOOL_LABEL[step.tool]}`;
      case 'switchTab':
        return `切到${TOOL_LABEL[step.tool]}`;
      case 'navigate':
        return '打开目标页面';
      case 'openSettings':
        return '打开模型设置';
      case 'openWorkspace':
        return '回到工作台';
      case 'fillPrompt':
        return `填入「${step.value.slice(0, 28)}」`;
      case 'highlight':
        return `高亮「${step.target.slice(0, 28)}」`;
      case 'scrollTo':
        return `滚动到「${step.target.slice(0, 28)}」`;
      case 'askPage':
        return '读一遍当前页';
      default:
        return '继续下一步';
    }
  });
  if (!parts.length) return '';
  return `好的，我会${parts.join('，然后')}。`;
}
