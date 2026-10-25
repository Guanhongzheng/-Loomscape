'use client';

/**
 * The on-device model cache, in three tiers:
 *
 *  1. **session** — the parsed ONNX pipeline that `local-runtime` keeps in
 *     memory. Requesting the same repo/dtype/backend again returns that
 *     instance instead of re-parsing the weights; the memory budget decides
 *     when it is released.
 *  2. **disk** — weight bytes live in Cache Storage (`transformers-cache`,
 *     written by transformers.js), and this module keeps an IndexedDB index of
 *     what is there: file list, byte size, which dtype can run, and when it
 *     was last verified against the real cache.
 *  3. **delivery** — the hub's own CDN cache. We only pick the host and the
 *     revision; the browser's HTTP cache does the rest, and there is no point
 *     in a fourth copy of the bytes on our side.
 *
 * Weights stay out of IndexedDB on purpose: reading a 600MB blob from IDB is
 * slower than from Cache Storage, which exists for HTTP responses, and holding
 * it in both would double the memory during a load. The index is the part that
 * a real database does better — it turns "is this model on disk, and which
 * precision?" from a full cache scan into one lookup.
 */

export type ModelCacheEntry = {
  /** Model id from the catalogue. */
  id: string;
  repo: string;
  /** Cached URL path → byte size. 0 means the response had no content-length. */
  files: Record<string, number>;
  bytes: number;
  /** A weight file for the WASM (int8) path is on disk. */
  q8: boolean;
  /** A weight file for the WebGPU (fp16) path is on disk. */
  fp16: boolean;
  verifiedAt: number;
};

const DB_NAME = 'loomscape-cache';
const DB_VERSION = 1;
const STORE = 'models';

/**
 * How long a lookup may trust the index without asking Cache Storage again.
 * Browser eviction is the only way the two can disagree, and that is rare once
 * `persist()` is granted; ten minutes keeps a chat session from scanning the
 * cache on every message while still noticing a cleared browser.
 */
export const INDEX_TRUST_MS = 10 * 60 * 1000;

let connection: Promise<IDBDatabase> | null = null;

/** Drops the cached connection; used by tests. */
export function resetCacheConnection(): void {
  connection?.then((db) => db.close()).catch(() => undefined);
  connection = null;
}

function open(): Promise<IDBDatabase> | null {
  if (typeof indexedDB === 'undefined') return null;
  if (connection) return connection;

  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('repo', 'repo');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return connection;
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest,
  fallback: T,
): Promise<T> {
  const pending = open();
  if (!pending) return Promise.resolve(fallback);
  return pending
    .then(
      (db) =>
        new Promise<T>((resolve) => {
          try {
            const tx = db.transaction(STORE, mode);
            const request = work(tx.objectStore(STORE));
            request.onsuccess = () => resolve((request.result as T) ?? fallback);
            request.onerror = () => resolve(fallback);
          } catch {
            resolve(fallback);
          }
        }),
    )
    .catch(() => fallback);
}

export async function readEntries(): Promise<Record<string, ModelCacheEntry>> {
  const rows = await run<ModelCacheEntry[]>('readonly', (store) => store.getAll(), []);
  const index: Record<string, ModelCacheEntry> = {};
  for (const row of rows) index[row.id] = row;
  return index;
}

export async function readEntry(id: string): Promise<ModelCacheEntry | null> {
  const row = await run<ModelCacheEntry | undefined>('readonly', (store) => store.get(id), undefined);
  return row ?? null;
}

export async function entriesForRepo(repo: string): Promise<ModelCacheEntry[]> {
  const rows = await run<ModelCacheEntry[]>(
    'readonly',
    (store) => store.index('repo').getAll(repo),
    [],
  );
  return rows;
}

export async function saveEntry(entry: ModelCacheEntry): Promise<void> {
  await run('readwrite', (store) => store.put(entry), undefined);
}

export async function dropEntry(id: string): Promise<void> {
  await run('readwrite', (store) => store.delete(id), undefined);
}

export async function dropEntriesForRepo(repo: string): Promise<void> {
  const rows = await entriesForRepo(repo);
  await Promise.all(rows.map((row) => dropEntry(row.id)));
}

/** Whether the index is recent enough to answer without a cache scan. */
export function isFresh(entry: ModelCacheEntry | null | undefined, now = Date.now()): boolean {
  return Boolean(entry) && now - (entry as ModelCacheEntry).verifiedAt < INDEX_TRUST_MS;
}

let persistRequest: Promise<boolean> | null = null;

/**
 * Asks the browser to keep this origin's storage out of the automatic cleanup
 * pool. Without it, a few hundred megabytes of weights can disappear under
 * pressure and the next visit downloads them again — the exact failure this
 * cache is meant to prevent. Called once, when a download starts.
 */
export function ensurePersistentStorage(): Promise<boolean> {
  if (persistRequest) return persistRequest;
  persistRequest = (async () => {
    try {
      if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  })();
  return persistRequest;
}

export async function persistentStorageGranted(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persisted) return false;
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}
