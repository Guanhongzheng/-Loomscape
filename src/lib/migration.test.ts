import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { STORES, all, get, resetConnection } from '@/lib/db';
import { newChatId, saveChat } from '@/lib/chats';
import { saveEndpoint, type Endpoint } from '@/lib/providers';

const DB_NAME = 'loomscape';

/** Builds the v1 schema by hand: providers used to be keyed by `id`. */
function seedV1(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('users', { keyPath: 'id' });
      db.createObjectStore('providers', { keyPath: 'id' });
      db.createObjectStore('prefs', { keyPath: 'key' });
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('users', 'readwrite');
      tx.objectStore('users').put({ id: 'usr_1', handle: '旧用户' });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
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

describe('v1 to v2 migration', () => {
  it('rebuilds the providers store so channel becomes the key', async () => {
    await seedV1();

    const endpoint: Endpoint = {
      channel: 'text',
      preset: 'openai',
      label: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-migrated-key-1234',
      model: 'gpt-4o-mini',
      shape: 'openai-chat',
      updatedAt: 0,
    };

    // Before the fix this threw: "Evaluating the object store's key path did
    // not yield a value", because the store still expected an `id`.
    await expect(saveEndpoint(endpoint)).resolves.toBeUndefined();

    const row = await get<Endpoint>(STORES.providers, 'text');
    expect(row?.apiKey).toBe('sk-migrated-key-1234');
  });

  it('adds the chats store so an older database can keep transcripts', async () => {
    await seedV1();

    // Opening runs the upgrade; v3 creates the store, so a database that
    // predates chat history still accepts one.
    expect(await all(STORES.chats)).toEqual([]);
    const saved = await saveChat({
      id: newChatId(),
      owner: 'usr_1',
      turns: [{ id: 'turn_1', role: 'user', text: '旧库里的第一条', at: 1 }],
    });
    expect(saved?.title).toBe('旧库里的第一条');
  });

  it('keeps unrelated stores intact', async () => {
    await seedV1();
    // Touch the database so the upgrade runs.
    await all(STORES.prefs);

    const users = await all<{ id: string; handle: string }>(STORES.users);
    expect(users).toHaveLength(1);
    expect(users[0].handle).toBe('旧用户');
  });

});
