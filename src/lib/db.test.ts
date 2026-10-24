import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  KEY_PATHS,
  STORES,
  all,
  clear,
  get,
  getPref,
  put,
  resetConnection,
  setPref,
} from '@/lib/db';
import { loadEndpoints, saveEndpoint, type Endpoint } from '@/lib/providers';

const DB_NAME = 'loomscape';

function endpoint(patch: Partial<Endpoint> = {}): Endpoint {
  return {
    channel: 'text',
    preset: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-test-key-123456',
    model: 'deepseek-chat',
    shape: 'openai-chat',
    updatedAt: 0,
    ...patch,
  };
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

describe('object store key paths', () => {
  it('declares a key path for every store', () => {
    for (const store of Object.values(STORES)) {
      expect(KEY_PATHS[store], store).toBeTruthy();
    }
  });

  it('writes and reads a preference by its key field', async () => {
    await setPref('theme', { dark: false });
    await expect(getPref('theme', null)).resolves.toEqual({ dark: false });
    await expect(get<{ key: string }>(STORES.prefs, 'theme')).resolves.toMatchObject({
      key: 'theme',
    });
  });

  it('keys providers by channel instead of id', async () => {
    // Regression: v1 declared `providers` with keyPath `id` while endpoints
    // only carry `channel`, so every save threw a DataError.
    await expect(put(STORES.providers, endpoint())).resolves.toBe('text');
    await expect(get<Endpoint>(STORES.providers, 'text')).resolves.toMatchObject({
      channel: 'text',
      model: 'deepseek-chat',
    });
  });

  it('keeps one row per channel', async () => {
    await put(STORES.providers, endpoint());
    await put(STORES.providers, endpoint({ channel: 'image', model: 'gpt-image-1' }));
    await put(STORES.providers, endpoint({ model: 'deepseek-reasoner' }));

    const rows = await all<Endpoint>(STORES.providers);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.channel === 'text')?.model).toBe('deepseek-reasoner');
  });

  it('rejects a record that has no key value', async () => {
    await expect(
      put(STORES.providers, { preset: 'openai' } as unknown as Endpoint),
    ).rejects.toThrow(/缺少主键字段 "channel"/);

    await expect(put(STORES.memories, { owner: 'u1' } as never)).rejects.toThrow(
      /缺少主键字段 "id"/,
    );
  });

  it('rejects a non-object value', async () => {
    await expect(put(STORES.prefs, 'nope' as never)).rejects.toThrow(/必须是对象/);
  });
});

describe('saveEndpoint', () => {
  it('persists every channel and reads them back', async () => {
    await saveEndpoint(endpoint());
    await saveEndpoint(
      endpoint({
        channel: 'embedding',
        preset: 'dashscope-embedding',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'text-embedding-v3',
        shape: 'openai-embedding',
      }),
    );

    const loaded = await loadEndpoints();
    expect(loaded.text.model).toBe('deepseek-chat');
    expect(loaded.embedding.model).toBe('text-embedding-v3');
    expect(loaded.image.channel).toBe('image');
  });

  it('trims pasted whitespace before storing', async () => {
    await saveEndpoint(endpoint({ apiKey: '  sk-padded-key-123  ', baseUrl: '  https://x.dev/v1  ' }));
    const row = await get<Endpoint>(STORES.providers, 'text');
    expect(row?.apiKey).toBe('sk-padded-key-123');
    expect(row?.baseUrl).toBe('https://x.dev/v1');
  });

  it('refuses an endpoint without a channel', async () => {
    await expect(
      saveEndpoint({ ...endpoint(), channel: '' } as unknown as Endpoint),
    ).rejects.toThrow(
      /缺少渠道标识/,
    );
  });
});

describe('clearing', () => {
  it('empties one store without touching another', async () => {
    await put(STORES.providers, endpoint());
    await setPref('memory.enabled', true);

    await clear(STORES.providers);

    await expect(all(STORES.providers)).resolves.toHaveLength(0);
    await expect(getPref('memory.enabled', false)).resolves.toBe(true);
  });
});
