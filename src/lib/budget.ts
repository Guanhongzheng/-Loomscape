/**
 * Memory budgets, derived from what the device reports instead of being the
 * same three numbers on every machine.
 *
 * `navigator.deviceMemory` is coarse and capped at 8 by the spec, so 8 means
 * "8 or more" — a 32GB workstation is indistinguishable from an 8GB laptop.
 * The ladder therefore only *lowers* the ceiling on small devices and keeps
 * the old numbers as the ceiling; guessing upwards from a capped signal would
 * hand a 16GB machine a budget nobody verified.
 */

export type PoolBudgets = { wasm: number; gpu: number };

/**
 * One linear memory tops out at 4GB, and it is not a wasm32 quirk. Probed on
 * Edge 156: a memory64 module validates and `new WebAssembly.Memory({index:'i64'})`
 * constructs, but both `initial` and `maximum` are rejected above 65536 pages,
 * and `grow` stops at exactly 4.00GB. The page needs the remainder.
 */
export const WASM_CEILING_MB = 3400;
/**
 * Stand-in for VRAM, which the platform does not report. Discrete cards have
 * far more, integrated ones share system memory, so this is a ceiling rather
 * than a measurement: high enough for a decoder plus an embedder, low enough
 * to catch a stack that would spill out of a 16GB machine.
 */
export const GPU_CEILING_MB = 6144;
/** What a device that reports nothing usable is assumed to have. */
export const ASSUMED_MEMORY_GB = 8;

export function budgetsFor(deviceMemoryGB?: number): PoolBudgets {
  const gb =
    typeof deviceMemoryGB === 'number' && Number.isFinite(deviceMemoryGB) && deviceMemoryGB > 0
      ? deviceMemoryGB
      : ASSUMED_MEMORY_GB;

  // A 2GB device cannot afford the 600MB runtime plus a decoder's ×3 peak, and
  // attempting it ends in `Aborted()` after a long download. Refusing early
  // with a smaller ceiling turns that into a readable message.
  if (gb <= 2) return { wasm: 1200, gpu: 2048 };
  if (gb <= 4) return { wasm: 2200, gpu: 3072 };
  return { wasm: WASM_CEILING_MB, gpu: GPU_CEILING_MB };
}
