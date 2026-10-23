/**
 * Minimal IndexedDB layer. Everything the studio remembers about a person,
 * including provider credentials, stays in the browser; there is no server
 * side account database in this build.
 */

export const STORES = {
  users: 'users',
  providers: 'providers',
  memories: 'memories',
  projects: 'projects',
  conversations: 'conversations',
  messages: 'messages',
  contacts: 'contacts',
  prefs: 'prefs',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

const DB_NAME = 'loomscape';
const DB_VERSION = 1;

let connection: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (connection) return connection;

  connection = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this environment'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORES.users)) {
        const users = db.createObjectStore(STORES.users, { keyPath: 'id' });
        users.createIndex('email', 'email', { unique: true });
      }
      if (!db.objectStoreNames.contains(STORES.providers)) {
        db.createObjectStore(STORES.providers, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.memories)) {
        const memories = db.createObjectStore(STORES.memories, { keyPath: 'id' });
        memories.createIndex('createdAt', 'createdAt');
        memories.createIndex('owner', 'owner');
      }
      if (!db.objectStoreNames.contains(STORES.projects)) {
        const projects = db.createObjectStore(STORES.projects, { keyPath: 'id' });
        projects.createIndex('kind', 'kind');
        projects.createIndex('owner', 'owner');
        projects.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(STORES.conversations)) {
        db.createObjectStore(STORES.conversations, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.messages)) {
        const messages = db.createObjectStore(STORES.messages, { keyPath: 'id' });
        messages.createIndex('conversationId', 'conversationId');
        messages.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains(STORES.contacts)) {
        db.createObjectStore(STORES.contacts, { keyPath: 'uid' });
      }
      if (!db.objectStoreNames.contains(STORES.prefs)) {
        db.createObjectStore(STORES.prefs, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('Failed to open database'));
  });

  return connection;
}

function run<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = work(tx.objectStore(store));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
      }),
  );
}

export function put<T>(store: StoreName, value: T, key?: IDBValidKey): Promise<IDBValidKey> {
  return run<IDBValidKey>(store, 'readwrite', (s) =>
    key === undefined ? s.put(value as unknown as object) : s.put(value as unknown as object, key),
  );
}

export function get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return run<T | undefined>(store, 'readonly', (s) => s.get(key));
}

export function all<T>(store: StoreName): Promise<T[]> {
  return run<T[]>(store, 'readonly', (s) => s.getAll());
}

/** Reads a single index range without touching the rest of the store. */
export function byIndex<T>(
  store: StoreName,
  index: string,
  query: IDBValidKey | IDBKeyRange,
): Promise<T[]> {
  return run<T[]>(store, 'readonly', (s) => s.index(index).getAll(query));
}

export function remove(store: StoreName, key: IDBValidKey): Promise<void> {
  return run<undefined>(store, 'readwrite', (s) => s.delete(key)).then(() => undefined);
}

export function clear(store: StoreName): Promise<void> {
  return run<undefined>(store, 'readwrite', (s) => s.clear()).then(() => undefined);
}

export async function getPref<T>(key: string, fallback: T): Promise<T> {
  try {
    const row = await get<{ key: string; value: T }>(STORES.prefs, key);
    return row ? row.value : fallback;
  } catch {
    return fallback;
  }
}

export async function setPref<T>(key: string, value: T): Promise<void> {
  await put(STORES.prefs, { key, value });
}
