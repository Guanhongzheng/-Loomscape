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
