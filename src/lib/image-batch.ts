import { imagesPerCall } from './image-limits';

export type ImageResult = { dataUrl?: string; url?: string };

/**
 * Turns a requested count into however many upstream calls it takes.
 *
 * Two things go wrong if the route just forwards `n`:
 *   - providers such as CogView return one image and ignore the field;
 *   - a partial failure should not throw away the images that did arrive.
 * So the batch asks in parallel, keeps the successes, and then tops up the
 * shortfall one call at a time. The caller still gets at most `count` images.
 */
export async function generateImages(input: {
  model: string;
  count: number;
  fetchOnce: (n: number) => Promise<ImageResult[]>;
}): Promise<ImageResult[]> {
  const { model, count, fetchOnce } = input;
  const perCall = imagesPerCall({ model });
  const calls = Math.max(1, Math.ceil(count / perCall));

  const settled = await Promise.allSettled(
    Array.from({ length: calls }, () => fetchOnce(Math.min(perCall, count))),
  );

  const images: ImageResult[] = [];
  let failure: unknown = null;
  for (const item of settled) {
    if (item.status === 'fulfilled') images.push(...item.value);
    else if (failure === null) failure = item.reason;
  }
  if (!images.length && failure !== null) throw failure;

  for (let guard = 0; images.length < count && guard < count; guard += 1) {
    try {
      images.push(...(await fetchOnce(count - images.length)));
    } catch {
      break;
    }
  }

  return images.slice(0, count);
}
