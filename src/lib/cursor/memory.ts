import type { CursorAction } from './actions';

const KEY = 'loomscape:cursor-memory:v1';
const MAX_ENTRIES = 8;

export type CursorMemoryEntry = {
  task: string;
  actions: string[];
  path: string;
  at: number;
};

function readRaw(): CursorMemoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item): item is CursorMemoryEntry => {
        if (!item || typeof item !== 'object') return false;
        const row = item as Record<string, unknown>;
        return typeof row.task === 'string' && Array.isArray(row.actions);
      })
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function readCursorMemory(): CursorMemoryEntry[] {
  return readRaw();
}

export function cursorMemoryCount(): number {
  return readRaw().length;
}

export function cursorMemoryLines(limit = 4): string[] {
  return readRaw()
    .slice(0, limit)
    .map((entry) => `${entry.task}${entry.actions.length ? `（${entry.actions.join(' → ')}）` : ''}`)
    .map((line) => line.slice(0, 180));
}

export function rememberCursorTask(task: string, actions: CursorAction[], path = ''): CursorMemoryEntry | null {
  if (typeof window === 'undefined') return null;
  const clean = task.replace(/\s+/g, ' ').trim().slice(0, 220);
  if (!clean) return null;
  const entry: CursorMemoryEntry = {
    task: clean,
    actions: actions.map((action) => action.action).slice(0, 5),
    path: path.slice(0, 120),
    at: Date.now(),
  };
  try {
    const next = [entry, ...readRaw().filter((row) => row.task !== clean)].slice(0, MAX_ENTRIES);
    localStorage.setItem(KEY, JSON.stringify(next));
    return entry;
  } catch {
    return null;
  }
}

export function clearCursorMemory() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // storage may be blocked; nothing else to clear
  }
}
