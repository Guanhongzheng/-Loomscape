import type { ModelDtype } from './engines';

/**
 * Which weight file a dtype resolves to. transformers.js picks the same names,
 * so checking one of them is the only way to know that *this* model can run:
 * a cached config, tokenizer, or a different quantisation would otherwise be
 * reported as ready and the load would fail on a missing ONNX file.
 */
export function weightFile(dtype: ModelDtype): string {
  if (dtype === 'q4f16') return 'model_q4f16.onnx';
  return dtype === 'fp16' ? 'model_fp16.onnx' : 'model_quantized.onnx';
}

export function isWeightRequest(url: string, repo: string, dtype: ModelDtype = 'q8'): boolean {
  if (!url.includes(repo)) return false;
  try {
    return new URL(url).pathname.endsWith(`/${weightFile(dtype)}`);
  } catch {
    return false;
  }
}

/**
 * How many cache entries belong to one precision. A split model writes the
 * graph and one `_data` file per shard, all sharing the graph's name as prefix,
 * so counting them is enough to tell a finished download from an interrupted
 * one that only got the 0.2MB graph.
 */
export function weightShards(files: Iterable<string>, dtype: ModelDtype): number {
  const prefix = weightFile(dtype);
  let count = 0;
  for (const path of files) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    if (name === prefix || name.startsWith(`${prefix}_data`)) count += 1;
  }
  return count;
}
