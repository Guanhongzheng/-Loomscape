/**
 * Progress for the model weight download.
 *
 * transformers.js reports one `progress` event per chunk plus `initiate` and
 * `done` events around each file. The `done` event deliberately carries no
 * byte total (it only names the file), so a tracker that reads `event.total`
 * on every event never closes the last chunk: the bar stays a little short and
 * a finished single-file download looks stalled at 97%.
 *
 * Two more rules keep the number honest:
 *
 *  - the denominator is floored at the catalogue size, so starting a new shard
 *    cannot make the bar jump backwards;
 *  - the reported value stops at 0.99. `ready` is the only thing that writes
 *    1.0. A bar at 100% while ONNX Runtime is still parsing the graph is the
 *    "fake completion" this exists to avoid.
 */

export type WeightProgressEvent = {
  status: string;
  file?: string;
  loaded?: number;
  total?: number;
};

export type DownloadSnapshot = {
  /** File currently being read, when the runtime named one. */
  file?: string;
  /** Bytes accounted for across every file seen so far. */
  loaded: number;
  /** Expected bytes for the whole download; never smaller than `expectedBytes`. */
  total: number;
  /** 0–0.99 while bytes are moving; 1 belongs to the caller's ready state. */
  progress: number;
};

type FileProgress = { loaded: number; total: number };

export function createDownloadProgress(expectedBytes: number) {
  const files = new Map<string, FileProgress>();
  let current: string | undefined;

  const snapshot = (): DownloadSnapshot => {
    let loaded = 0;
    let total = 0;
    for (const row of files.values()) {
      // A browser can report a chunk past content-length on a bad proxy; the
      // file is never larger than its own total as far as this bar is concerned.
      loaded += Math.min(row.loaded, row.total);
      total += row.total;
    }
    const denominator = Math.max(total, expectedBytes);
    return {
      file: current,
      loaded,
      total: denominator,
      progress: denominator > 0 ? Math.min(loaded / denominator, 0.99) : 0,
    };
  };

  const apply = (event: WeightProgressEvent): DownloadSnapshot | null => {
    if (!event.file) return null;
    current = event.file;
    const known = files.get(event.file);

    if (event.status === 'progress') {
      if (typeof event.total !== 'number' || event.total <= 0) {
        // The runtime warns and expands its buffer when the host omits
        // content-length; without a total there is nothing to divide by, but
        // the file label still moves.
        return snapshot();
      }
      files.set(event.file, {
        loaded: Math.min(event.loaded ?? 0, event.total),
        total: event.total,
      });
      return snapshot();
    }

    if (event.status === 'done') {
      // This is the event without a total. Close the file from the last
      // progress event instead of leaving its final chunk unaccounted for.
      if (known && known.total > 0) {
        files.set(event.file, { loaded: known.total, total: known.total });
      }
      return snapshot();
    }

    if (event.status === 'initiate' || event.status === 'download') {
      return snapshot();
    }

    return null;
  };

  return { apply, snapshot };
}
