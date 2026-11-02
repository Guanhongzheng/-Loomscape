/**
 * Keyboard order for a tab-like control. A `role="tablist"` is expected to
 * answer arrow keys, and a segmented control that only responds to mouse
 * clicks is a dead end for anyone without one.
 *
 * Wrapping is deliberate: at the last option ArrowRight goes back to the
 * first, which is what the tabs pattern describes.
 */
export function nextTabIndex(current: number, length: number, key: string): number {
  if (length <= 0) return 0;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (current + 1) % length;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (current - 1 + length) % length;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return current;
}
