import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetConnection } from '@/lib/db';
import type { RecallHit } from '@/lib/memory';
import {
  deleteChat,
  deriveTitle,
  listChats,
  loadChat,
  newChatId,
  saveChat,
  type ChatTurn,
} from '@/lib/chats';

const DB_NAME = 'loomscape';

function turn(role: ChatTurn['role'], text: string, at = Date.now()): ChatTurn {
  return { id: `${role}_${at}_${Math.random().toString(16).slice(2, 6)}`, role, text, at };
}

beforeEach(async () => {
  resetConnection();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

describe('chat sessions', () => {
  it('saves a transcript and lists it for its owner only', async () => {
    const id = newChatId();
    await saveChat({ id, owner: 'usr_a', turns: [turn('user', '写一句开场'), turn('assistant', '灯先亮了。')] });
    await saveChat({ id: newChatId(), owner: 'usr_b', turns: [turn('user', '别人的对话')] });

    const mine = await listChats('usr_a');
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe('写一句开场');
    expect(mine[0].turns).toBe(1);
  });

  it('restores the turns with their citations intact', async () => {
    const id = newChatId();
    const source: RecallHit = {
      record: {
        id: 'mem_1',
        owner: 'usr_a',
        kind: 'doc',
        text: '光线沿直线传播',
        vector: [0.1, 0.2],
        embedder: 'hash',
        tags: [],
        createdAt: 1,
      },
      score: 0.5,
    };

    await saveChat({
      id,
      owner: 'usr_a',
      turns: [turn('user', '关于光线'), { ...turn('assistant', '见 [1]'), sources: [source] }],
    });

    const loaded = await loadChat(id);
    expect(loaded?.turns).toHaveLength(2);
    expect(loaded?.turns[1].sources).toHaveLength(1);
  });

  it('refuses to create a session that holds no text', async () => {
    const saved = await saveChat({ id: newChatId(), owner: 'usr_a', turns: [turn('user', '   ')] });
    expect(saved).toBeNull();
    expect(await listChats('usr_a')).toHaveLength(0);
  });

  it('keeps the newest 60 turns', async () => {
    const id = newChatId();
    const turns = Array.from({ length: 70 }, (_, index) => turn('user', `第 ${index} 问`));
    await saveChat({ id, owner: 'usr_a', turns });

    const loaded = await loadChat(id);
    expect(loaded?.turns).toHaveLength(60);
    // The tail is what matters: the first ten questions are dropped.
    expect(loaded?.turns[0].text).toBe('第 10 问');
  });

  it('keeps the original creation time across saves and bumps updatedAt', async () => {
    const id = newChatId();
    const first = await saveChat({ id, owner: 'usr_a', turns: [turn('user', '一')] });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await saveChat({ id, owner: 'usr_a', turns: [turn('user', '一'), turn('user', '二')] });

    expect(second?.createdAt).toBe(first?.createdAt);
    expect(second?.updatedAt).toBeGreaterThan(first?.updatedAt ?? 0);
    expect(second?.title).toBe('一');
  });

  it('honours an explicit title and drops the session on delete', async () => {
    const id = newChatId();
    await saveChat({ id, owner: 'usr_a', title: '品牌手册讨论', turns: [turn('user', '一')] });
    expect((await listChats('usr_a'))[0].title).toBe('品牌手册讨论');

    await deleteChat(id);
    expect(await listChats('usr_a')).toHaveLength(0);
    expect(await loadChat(id)).toBeNull();
  });

  it('sorts sessions by the last edit', async () => {
    const older = newChatId();
    await saveChat({ id: older, owner: 'usr_a', turns: [turn('user', '早的')] });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const newer = newChatId();
    await saveChat({ id: newer, owner: 'usr_a', turns: [turn('user', '晚的')] });

    expect((await listChats('usr_a')).map((row) => row.id)).toEqual([newer, older]);
  });
});

describe('deriveTitle', () => {
  it('flattens newlines and truncates long openers', () => {
    expect(deriveTitle([turn('user', '第一行\n第二行')])).toBe('第一行 第二行');
    const long = deriveTitle([turn('user', '这是一段特别特别长的开场白，长到必须被截断才行')]);
    expect(long.endsWith('…')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(23);
  });

  it('falls back when nothing was asked yet', () => {
    expect(deriveTitle([])).toBe('新会话');
    expect(deriveTitle([turn('assistant', '只有回答')])).toBe('新会话');
  });
});
