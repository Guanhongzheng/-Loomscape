/*
 * What is on disk, and whether it is complete. Kept beside the index rather
 * than inside the runtime: this answers a question about storage, and the
 * loading code only consumes the answer.
 */

import { MODEL_CACHE_NAME, entriesForRepo, isFresh } from './model-cache';
import { isWeightRequest, weightFile } from './weights';
import type { ModelDtype } from './engines';

/**
 * Bytes actually on disk for one precision, plus how many entries carried a
 * `content-length`. The index stores 0 when the header was missing, so a total
 * built only from those zeros proves nothing and the caller falls back to the
 * file count.
 */
function weightBytes(
  files: Record<string, number>,
  dtype: ModelDtype,
): { bytes: number; known: number; count: number } {
  const prefix = weightFile(dtype);
  let bytes = 0;
  let known = 0;
  let count = 0;
  for (const [path, size] of Object.entries(files)) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    if (name !== prefix && !name.startsWith(`${prefix}_data`)) continue;
    count += 1;
    if (size > 0) {
      bytes += size;
      known += 1;
    }
  }
  return { bytes, known, count };
}

export async function hasWeights(repo: string): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  // One lookup answers the common case; the fallback scan is only for a cold
  // or expired index, which `scanModelCache` refreshes on the settings page.
  const indexed = (await entriesForRepo(repo)).find((entry) => isFresh(entry));
  if (indexed) return indexed.q8 || indexed.fp16 || indexed.q4f16;
  try {
    const cache = await caches.open(MODEL_CACHE_NAME);
    const keys = await cache.keys();
    return keys.some(
      (request) =>
        isWeightRequest(request.url, repo, 'q8') ||
        isWeightRequest(request.url, repo, 'fp16') ||
        isWeightRequest(request.url, repo, 'q4f16'),
    );
  } catch {
    return false;
  }
}

/**
 * A completed download is a file-count *and* a byte total. Counting shards
 * alone let a truncated `_data` write — or a 206 that stopped halfway — pass as
 * ready, and the failure only surfaced after `Abort()` at session creation.
 *
 * The 90% floor tolerates the catalogue being rounded to whole MB. A half
 * written shard lands nowhere near it.
 */
const CACHE_SIZE_FLOOR = 0.9;

export async function isModelCached(
  repo: string,
  dtype: ModelDtype = 'q8',
  files = 1,
  expectedMB?: number,
): Promise<boolean> {
  if (typeof caches === 'undefined') return false;

  const complete = (bytes: number, known: number, count: number): boolean => {
    if (count < files) return false;
    if (!expectedMB || known === 0) return true;
    return bytes >= expectedMB * 1024 * 1024 * CACHE_SIZE_FLOOR;
  };

  const indexed = (await entriesForRepo(repo)).find((entry) => isFresh(entry));
  // Recompute from the recorded file list instead of trusting the stored
  // boolean: an interrupted split download used to look complete forever.
  if (indexed) {
    const { bytes, known, count } = weightBytes(indexed.files, dtype);
    return complete(bytes, known, count);
  }

  try {
    const cache = await caches.open(MODEL_CACHE_NAME);
    const requests = (await cache.keys()).filter((request) =>
      isWeightRequest(request.url, repo, dtype),
    );
    if (requests.length < files) return false;
    if (!expectedMB) return true;

    let bytes = 0;
    let known = 0;
    for (const request of requests) {
      const response = await cache.match(request);
      const size = Number(response?.headers.get('content-length') ?? 0);
      if (size > 0) {
        bytes += size;
        known += 1;
      }
    }
    // No headers to judge by: the count is all we have.
    return known === 0 ? true : bytes >= expectedMB * 1024 * 1024 * CACHE_SIZE_FLOOR;
  } catch {
    return false;
  }
}

