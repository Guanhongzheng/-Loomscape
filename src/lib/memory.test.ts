import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { STORES, clear, resetConnection } from '@/lib/db';
import { remember, retrieve, setMemoryPrefs } from '@/lib/memory';

describe('retrieve scope', () => {
  beforeEach(async () => {
    resetConnection();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('loomscape');
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
    await clear(STORES.memories).catch(() => undefined);
    await setMemoryPrefs({ enabled: true, depth: 'high' });
  });

  it('excludes assistant chatter when the caller asks for documents only', async () => {
    // Finished answers are stored as `note`; feeding them back as sources made
    // the model quote itself, which is what users read as repetition.
    await remember({
      owner: 'usr_1',
      kind: 'note',
      text: '旧书店只在夜里营业，晚上十点开门，凌晨两点关门。',
      tags: ['chat'],
    });
    await remember({
      owner: 'usr_1',
      kind: 'doc',
      text: '旧书店的营业时间写在门边的木牌上：夜里十点到凌晨两点。',
      tags: ['doc'],
    });

    const scoped = await retrieve('旧书店几点开门', 'usr_1', {
      topK: 4,
      kinds: ['doc', 'text', 'story'],
    });
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((hit) => hit.record.kind !== 'note')).toBe(true);

    const unscoped = await retrieve('旧书店几点开门', 'usr_1', { topK: 4 });
    expect(unscoped.some((hit) => hit.record.kind === 'note')).toBe(true);
  });

  it('drops a weak match instead of feeding it to the model', async () => {
    // Measured 0.144 before the floor moved: a short arithmetic question
    // "matched" a camera-settings note, and the answer came from that note.
    await remember({
      owner: 'usr_1',
      kind: 'doc',
      text: '拍摄参数：ISO 400，快门 1/60，光圈 f/2.8，白平衡 4200K。',
    });
    const hits = await retrieve('10-3是多少', 'usr_1', { topK: 4, kinds: ['doc'] });
    expect(hits).toEqual([]);
  });

  it('keeps owners apart', async () => {
    await remember({ owner: 'usr_1', kind: 'doc', text: '夜里的旧书店十点开门。' });
    const hits = await retrieve('旧书店开门时间', 'usr_2', { topK: 4 });
    expect(hits).toEqual([]);
  });
});
