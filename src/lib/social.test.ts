import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { STORES, clear, put, resetConnection } from '@/lib/db';
import { countUnread, listMessages, sendMessage, setAnnouncement, type Conversation } from '@/lib/social';

function conversation(patch: Partial<Conversation> = {}): Conversation {
  return {
    id: 'grp_test',
    kind: 'group',
    name: '夜班编辑',
    members: ['UID_ME', 'UID_OTHER'],
    code: 'ABC123',
    createdAt: 1_000,
    updatedAt: 1_000,
    ...patch,
  };
}

describe('conversation unread', () => {
  beforeEach(async () => {
    resetConnection();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('loomscape');
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
    await clear(STORES.messages).catch(() => undefined);
    await clear(STORES.conversations).catch(() => undefined);
  });

  it('counts only messages from others after the watermark', async () => {
    await sendMessage({
      conversationId: 'grp_test',
      authorUid: 'UID_OTHER',
      authorHandle: '另一位',
      text: '交了没',
    });
    await sendMessage({
      conversationId: 'grp_test',
      authorUid: 'UID_ME',
      authorHandle: '我',
      text: '在改',
    });

    const rows = await listMessages('grp_test');
    expect(rows).toHaveLength(2);
    expect(await countUnread('grp_test', 0, 'UID_ME')).toBe(1);
    // Everything before the watermark is read.
    expect(await countUnread('grp_test', Date.now() + 1_000, 'UID_ME')).toBe(0);
  });

  it('keeps counts per conversation', async () => {
    await sendMessage({
      conversationId: 'grp_a',
      authorUid: 'UID_OTHER',
      authorHandle: '另一位',
      text: 'a',
    });
    await sendMessage({
      conversationId: 'grp_b',
      authorUid: 'UID_OTHER',
      authorHandle: '另一位',
      text: 'b1',
    });
    await sendMessage({
      conversationId: 'grp_b',
      authorUid: 'UID_OTHER',
      authorHandle: '另一位',
      text: 'b2',
    });

    expect(await countUnread('grp_a', 0, 'UID_ME')).toBe(1);
    expect(await countUnread('grp_b', 0, 'UID_ME')).toBe(2);
  });

  it('stamps an announcement with a version the reader can compare against', async () => {
    const before = Date.now();
    const updated = await setAnnouncement(conversation(), '周五交稿', '我');
    expect(updated.announcement?.text).toBe('周五交稿');
    expect(updated.announcement?.updatedAt).toBeGreaterThanOrEqual(before);
    expect(updated.updatedAt).toBe(updated.announcement?.updatedAt);
  });

  it('persists messages and announcements through the same store', async () => {
    await put(STORES.conversations, conversation());
    await sendMessage({
      conversationId: 'grp_test',
      authorUid: 'UID_OTHER',
      authorHandle: '另一位',
      text: '第一条',
    });
    expect((await listMessages('grp_test')).map((row) => row.text)).toEqual(['第一条']);
  });
});
