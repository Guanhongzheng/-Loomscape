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

/**
 * Every store uses an in-line key, so a record missing its key path cannot be
 * written at all. Keeping the map in one place lets `put` fail with a message
 * that names the field instead of surfacing a bare DOMException.
 */
export const KEY_PATHS: Record<StoreName, string> = {
  users: 'id',
  providers: 'channel',
  memories: 'id',
  projects: 'id',
  conversations: 'id',
  messages: 'id',
  contacts: 'uid',
  prefs: 'key',
};

const DB_NAME = 'loomscape';
/** v2: providers moved from an `id` key to `channel`. */
const DB_VERSION = 2;

let connection: Promise<IDBDatabase> | null = null;
let handle: IDBDatabase | null = null;

/** Drops and closes the cached connection; used by tests and after upgrades. */
export function resetConnection(): void {
  try {
    handle?.close();
  } catch {
    // already closed
  }
  handle = null;
  connection = null;
}

function createProviders(db: IDBDatabase): void {
  db.createObjectStore(STORES.providers, { keyPath: KEY_PATHS.providers });
}

function upgrade(db: IDBDatabase, oldVersion: number): void {
  if (!db.objectStoreNames.contains(STORES.users)) {
    const users = db.createObjectStore(STORES.users, { keyPath: KEY_PATHS.users });
    users.createIndex('email', 'email', { unique: true });
  }
  if (!db.objectStoreNames.contains(STORES.memories)) {
    const memories = db.createObjectStore(STORES.memories, { keyPath: KEY_PATHS.memories });
    memories.createIndex('createdAt', 'createdAt');
    memories.createIndex('owner', 'owner');
  }
  if (!db.objectStoreNames.contains(STORES.projects)) {
    const projects = db.createObjectStore(STORES.projects, { keyPath: KEY_PATHS.projects });
    projects.createIndex('kind', 'kind');
    projects.createIndex('owner', 'owner');
    projects.createIndex('updatedAt', 'updatedAt');
  }
  if (!db.objectStoreNames.contains(STORES.conversations)) {
    db.createObjectStore(STORES.conversations, { keyPath: KEY_PATHS.conversations });
  }
  if (!db.objectStoreNames.contains(STORES.messages)) {
    const messages = db.createObjectStore(STORES.messages, { keyPath: KEY_PATHS.messages });
    messages.createIndex('conversationId', 'conversationId');
    messages.createIndex('createdAt', 'createdAt');
  }
  if (!db.objectStoreNames.contains(STORES.contacts)) {
    db.createObjectStore(STORES.contacts, { keyPath: KEY_PATHS.contacts });
  }
  if (!db.objectStoreNames.contains(STORES.prefs)) {
    db.createObjectStore(STORES.prefs, { keyPath: KEY_PATHS.prefs });
  }

  // v1 declared `providers` with keyPath `id`, but endpoints are keyed by
  // channel, so every write failed. A key path cannot be altered in place, and
  // no row could ever have been stored, so deleting the empty store is safe.
  if (oldVersion < 2 && db.objectStoreNames.contains(STORES.providers)) {
    db.deleteObjectStore(STORES.providers);
  }
  if (!db.objectStoreNames.contains(STORES.providers)) {
    createProviders(db);
  }
}

function open(): Promise<IDBDatabase> {
  if (connection) return connection;

  connection = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this environment'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      upgrade(request.result, event.oldVersion ?? 0);
    };

    request.onsuccess = () => {
      const db = request.result;
      handle = db;
      db.onversionchange = () => {
        db.close();
        resetConnection();
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('Failed to open database'));
    request.onblocked = () => {
      // Another tab still holds the previous version. The request stays alive
      // and resolves once that tab closes, so nothing to do beyond logging.
      console.warn('[db] upgrade blocked by another tab');
    };
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
        let tx: IDBTransaction;
        try {
          tx = db.transaction(store, mode);
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Failed to open transaction'));
          return;
        }

        let result: T;
        let failed: unknown = null;

        tx.oncomplete = () => {
          if (failed) reject(failed);
          else resolve(result);
        };
        tx.onerror = () => {
          reject(tx.error ?? new Error(`Transaction failed on ${store}`));
        };
        tx.onabort = () => {
          reject(tx.error ?? new Error(`Transaction aborted on ${store}`));
        };

        try {
          const request = work(tx.objectStore(store));
          request.onsuccess = () => {
            result = request.result as T;
          };
          request.onerror = () => {
            // Let the abort handler reject; stop the default error event so the
            // browser does not log an unhandled exception for a handled failure.
            failed = request.error ?? new Error(`IndexedDB request failed on ${store}`);
            tx.abort();
          };
        } catch (error) {
          failed = error;
          try {
            tx.abort();
          } catch {
            reject(error);
          }
        }
      }),
  );
}

function assertKeyPath(store: StoreName, value: unknown): void {
  const path = KEY_PATHS[store];
  if (!value || typeof value !== 'object') {
    throw new Error(`写入 ${store} 的值必须是对象`);
  }
  const key = (value as Record<string, unknown>)[path];
  if (key === undefined || key === null || key === '') {
    throw new Error(`写入 ${store} 的记录缺少主键字段 "${path}"`);
  }
}

/** Async so a missing key surfaces as a rejection rather than a sync throw. */
export async function put<T>(
  store: StoreName,
  value: T,
  key?: IDBValidKey,
): Promise<IDBValidKey> {
  assertKeyPath(store, value);
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
