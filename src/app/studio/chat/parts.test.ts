import { describe, expect, it, vi } from 'vitest';
import type { Message } from 'ai';
import { cloudTurns, sourcesOf, timeAgo } from '@/app/studio/chat/parts';
import type { ChatTurn } from '@/lib/chats';

const hit = (id: string) => ({ record: { id, text: 't', source: undefined } }) as never;

const message = (role: 'user' | 'assistant', text: string, id = text): Message =>
  ({
    id,
    role,
    content: text,
    parts: [{ type: 'text', text }],
  }) as unknown as Message;

describe('cloudTurns', () => {
  it('keeps one bubble per exchange when a tool call splits the answer', () => {
    const turns = cloudTurns(
      [message('user', '问'), message('assistant', '前半'), message('assistant', '后半')],
      new Map(),
    );
    expect(turns).toHaveLength(2);
    expect(turns[1].text).toBe('前半\n\n后半');
  });

  it('drops an assistant message that carries neither text nor a tool call', () => {
    const turns = cloudTurns([message('user', '问'), message('assistant', '')], new Map());
    expect(turns).toHaveLength(1);
  });

  it('attaches sources to the answer that followed the same question', () => {
    const sources = new Map([[0, [hit('a')]]]);
    const turns = cloudTurns([message('user', '问'), message('assistant', '答')], sources);
    expect(turns[1].sources?.[0].record.id).toBe('a');
  });
});

describe('sourcesOf', () => {
  it('rebuilds the rail by exchange number after a reload', () => {
    const turns: ChatTurn[] = [
      { id: '1', role: 'user', text: 'q1', at: 0 },
      { id: '2', role: 'assistant', text: 'a1', at: 0, sources: [hit('x')] },
      { id: '3', role: 'user', text: 'q2', at: 0 },
      { id: '4', role: 'assistant', text: 'a2', at: 0 },
    ];
    const map = sourcesOf(turns);
    expect(map.get(0)?.[0].record.id).toBe('x');
    expect(map.has(1)).toBe(false);
  });
});

describe('timeAgo', () => {
  it('uses minutes, hours and a date, in that order', () => {
    const now = new Date('2026-11-02T12:00:00Z').getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    expect(timeAgo(now - 30_000)).toBe('刚刚');
    expect(timeAgo(now - 5 * 60_000)).toBe('5 分钟前');
    expect(timeAgo(now - 3 * 3_600_000)).toBe('3 小时前');
    // Older than a day: falls through to a locale date ("10/30" with small-ICU,
    // "10月30日" with full ICU), never a relative label.
    const older = timeAgo(now - 3 * 86_400_000);
    expect(older).not.toMatch(/前|刚刚/);
    expect(older).toMatch(/\d/);

    vi.useRealTimers();
  });
});
