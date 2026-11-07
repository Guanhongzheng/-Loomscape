import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCursorMemory,
  cursorMemoryCount,
  cursorMemoryLines,
  readCursorMemory,
  rememberCursorTask,
} from './memory';

const store = new Map<string, string>();
const localStorageStub = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
};

beforeEach(() => {
  store.clear();
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', localStorageStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearCursorMemory();
});

describe('cursor memory', () => {
  it('remembers a task and its action names without page content', () => {
    rememberCursorTask('打开文本创作，写一个提纲', [
      { action: 'openTool', tool: 'text' },
      { action: 'fillPrompt', value: '提纲' },
    ]);
    const rows = readCursorMemory();
    expect(rows).toHaveLength(1);
    expect(rows[0].task).toContain('打开文本创作');
    expect(rows[0].actions).toEqual(['openTool', 'fillPrompt']);
    expect(rows[0]).not.toHaveProperty('value');
  });

  it('keeps newest first, deduplicates and exposes compact lines', () => {
    rememberCursorTask('旧任务旧任务', [{ action: 'askPage' }]);
    rememberCursorTask('新任务新任务', [{ action: 'highlight', target: '标题' }]);
    rememberCursorTask('旧任务旧任务', [{ action: 'askPage' }]);
    expect(cursorMemoryCount()).toBe(2);
    expect(readCursorMemory()[0].task).toBe('旧任务旧任务');
    expect(cursorMemoryLines()).toHaveLength(2);
  });
});
