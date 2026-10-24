/**
 * Storage preflight. A browser refuses Cache API writes once the origin hits
 * its quota, and the failure surfaces as an opaque abort from inside
 * onnxruntime rather than as "you are out of space". Checking before a
 * download turns that into a sentence.
 */

export type StorageUsage = {
  used: number;
  quota: number;
  free: number;
  ratio: number;
};

export async function storageUsage(): Promise<StorageUsage | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const estimate = await navigator.storage.estimate();
    const used = estimate.usage ?? 0;
    const quota = estimate.quota ?? 0;
    return {
      used,
      quota,
      free: Math.max(quota - used, 0),
      ratio: quota > 0 ? used / quota : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Leaves a small margin: the quota is shared with IndexedDB and the browser
 * also needs room for the compiled session, not just the weight file.
 */
export function roomFor(usage: StorageUsage | null, needBytes: number): boolean {
  if (!usage || usage.quota <= 0) return true;
  const margin = Math.min(quotaMargin(usage.quota), needBytes * 0.15);
  return usage.free > needBytes + margin;
}

function quotaMargin(quota: number): number {
  return Math.max(16 * 1024 * 1024, quota * 0.02);
}
