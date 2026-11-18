/**
 * How many images one upstream request can actually produce.
 *
 * `n` is advisory, not a guarantee: several OpenAI-compatible providers accept
 * the field and ignore it. CogView (智谱) always returns a single image, and
 * Stability's sd3 endpoint takes no `n` at all, so a UI that says "4 张" would
 * silently hand back one. Knowing the cap per call lets the route loop instead
 * of passing the bug to the user.
 */
export const MAX_IMAGES = 4;

const SINGLE_PER_CALL = /^cogview/i;

export function imagesPerCall(endpoint: { model?: string; shape?: string }): number {
  if (endpoint.shape === 'stability') return 1;
  if (SINGLE_PER_CALL.test(endpoint.model ?? '')) return 1;
  return MAX_IMAGES;
}

/** Number of upstream requests needed to satisfy `count`. */
export function callCount(endpoint: { model?: string; shape?: string }, count: number): number {
  const wanted = Math.min(Math.max(Math.floor(count) || 1, 1), MAX_IMAGES);
  return Math.max(1, Math.ceil(wanted / imagesPerCall(endpoint)));
}
